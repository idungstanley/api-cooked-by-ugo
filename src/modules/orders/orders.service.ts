import {
  ALLOWED_TRANSITIONS,
  UNPAID_ORDER_MINUTES,
  type OrderStatus,
} from '../../config/constants.js'
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  isDuplicateKey,
  notFound,
  unprocessable,
} from '../../lib/errors.js'
import { createId, createSecret } from '../../lib/ids.js'
import { hasPermission } from '../../middleware/auth.js'
import {
  cancelPaymentIntent,
  createPaymentIntent,
  getPaymentClientSecret,
  paymentsEnabled,
  refundPayment,
} from '../../services/payments.js'
import { announceOrderChange } from '../../services/realtime.js'
import { Customer, normalisePhone } from '../customers/customers.model.js'
import { isOpenAt } from '../settings/availability.js'
import { getSettings, leadMinutes } from '../settings/settings.model.js'
import type { StaffDoc } from '../staff/staff.model.js'
import { Staff } from '../staff/staff.model.js'
import {
  emailCancelled,
  emailDelivered,
  emailOrderConfirmation,
  emailOutForDelivery,
  emailRefund,
  emailScheduledReminder,
} from './orders.emails.js'
import { nextOrderNumber, Order, type OrderDoc } from './orders.model.js'
import type { OrderInput } from './orders.schema.js'
import { priceCart } from './pricing.js'

type OrderRecord = InstanceType<typeof Order>

const event = (actor: string, message: string) => ({
  id: createId('event'),
  at: new Date(),
  actor,
  message,
})

const upsertCustomer = async ({ delivery }: OrderInput) => {
  const phoneKey = normalisePhone(delivery.phone)
  const save = () =>
    Customer.findOneAndUpdate(
      { phoneKey },
      {
        $set: { name: delivery.fullName, email: delivery.email, phone: delivery.phone },
        $setOnInsert: { _id: createId('customer') },
        ...(delivery.marketingOptIn ? { $max: { marketingOptIn: true } } : {}),
      },
      { upsert: true, returnDocument: 'after' },
    )
  // Two first orders from the same phone can race, and the loser finds the winner's record.
  const customer = await save().catch((error) => {
    if (isDuplicateKey(error)) return save()
    throw error
  })
  if (!customer) throw notFound('Customer')
  if (customer.blocked) throw forbidden('Please call us to place this order')
  return customer
}

/** The order is already saved by now, so a notification problem must not fail the request. */
const announceNewOrder = (order: OrderRecord) => {
  try {
    announceOrderChange(order)
    emailOrderConfirmation(order)
  } catch (error) {
    console.error(`Could not announce ${order.number}`, error)
  }
}

const orderResult = (order: OrderRecord, clientSecret?: string) => ({
  order: order.toJSON(),
  trackingKey: order.trackingKey,
  clientSecret,
})

/** A retry of an unpaid order gets its payment form back, so the customer can finish paying. */
const repeatResult = async (order: OrderRecord) =>
  order.status === 'pending-payment' && order.stripePaymentIntentId
    ? orderResult(order, await getPaymentClientSecret(order.stripePaymentIntentId))
    : orderResult(order)

export const createOrder = async (input: OrderInput, accountId?: string) => {
  // A repeated tap or a retry returns the first order rather than creating a second one.
  const repeat = await Order.findOne({ idempotencyKey: input.idempotencyKey })
  if (repeat) return repeatResult(repeat)

  const settings = await getSettings()
  if (settings.ordersPaused) throw unprocessable('We are not taking orders right now')

  const { scheduledFor } = input.delivery
  if (scheduledFor) {
    if (scheduledFor <= Date.now() || !isOpenAt(settings, new Date(scheduledFor))) {
      throw unprocessable('Please choose another delivery time')
    }
  } else if (!isOpenAt(settings)) {
    throw unprocessable('We are closed right now. Please schedule your order for later.')
  }

  const { delivery, ...priced } = await priceCart(input, settings)
  const customer = await upsertCustomer(input)
  // Without Stripe, in local development and tests, card orders are treated as paid.
  const awaitingCard = paymentsEnabled

  const order = await new Order({
    ...priced,
    distanceMiles: delivery?.distanceMiles,
    accountId,
    _id: createId('order'),
    number: await nextOrderNumber(),
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    address: `${input.delivery.address}, ${input.delivery.city}`,
    postcode: delivery?.postcode ?? input.postcode.toUpperCase(),
    deliveryNote: input.delivery.note || undefined,
    allergyNote: input.delivery.allergyNote || undefined,
    paymentMethod: 'card',
    paymentStatus: awaitingCard ? 'pending' : 'paid',
    scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    etaMinutes: leadMinutes(settings),
    deliveryMinutes: settings.deliveryMinutes,
    status: awaitingCard ? 'pending-payment' : 'received',
    events: [event('Website', 'Order placed')],
    trackingKey: createSecret(),
    idempotencyKey: input.idempotencyKey,
  })
    .save()
    .catch((error) => {
      if (!isDuplicateKey(error)) throw error
      return null
    })

  // A simultaneous double tap gets past the first check, and the unique index catches it here.
  if (!order) {
    const winner = await Order.findOne({ idempotencyKey: input.idempotencyKey })
    if (!winner) throw conflict('Please try again')
    return repeatResult(winner)
  }

  if (awaitingCard) {
    try {
      const intent = await createPaymentIntent(order.id, order.total, `order-${order.id}`)
      order.stripePaymentIntentId = intent.id
      await order.save()
      return orderResult(order, intent.client_secret ?? undefined)
    } catch (error) {
      // Usually a missing or wrong Stripe key. The order is closed so it never reaches the kitchen.
      console.error(`Could not start payment for ${order.number}`, error)
      order.status = 'cancelled'
      order.events.push(event('System', 'Payment could not be started'))
      await order.save()
      throw new AppError(503, 'Card payments are not working right now. Please try again shortly.')
    }
  }

  announceNewOrder(order)
  return orderResult(order)
}

/** Only Stripe's signed webhook can mark a card order as paid. */
export const confirmCardPayment = async (paymentIntentId: string, amountPaid: number) => {
  const order = await Order.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId, status: 'pending-payment', total: amountPaid },
    {
      status: 'received',
      paymentStatus: 'paid',
      $push: { events: event('Stripe', 'Card payment confirmed') },
    },
    { returnDocument: 'after' },
  )
  if (order) {
    announceNewOrder(order)
    return
  }

  // A payment landing after the order expired is returned, so nobody pays for food they never get.
  const expired = await Order.findOne({
    stripePaymentIntentId: paymentIntentId,
    status: 'cancelled',
    paymentStatus: 'pending',
  })
  if (expired) {
    await refundPayment(paymentIntentId, amountPaid, `late-${expired.id}`)
    expired.paymentStatus = 'refunded'
    expired.refundedAmount = amountPaid
    expired.events.push(event('Stripe', 'Late payment refunded'))
    await expired.save()
  }
}

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

export const getRefundableAmount = (
  order: Pick<OrderDoc, 'paymentMethod' | 'paymentStatus' | 'total' | 'refundedAmount'>,
) =>
  order.paymentMethod === 'card' && ['paid', 'partially-refunded'].includes(order.paymentStatus)
    ? order.total - order.refundedAmount
    : 0

const findOrder = async (orderId: string) => {
  const order = await Order.findById(orderId)
  if (!order) throw notFound('Order')
  return order
}

/** Riders may only act on orders assigned to them. */
export const assertCanAccess = (order: OrderDoc, staff: StaffDoc) => {
  if (!hasPermission(staff, 'orders') && order.riderId !== staff._id) throw notFound('Order')
}

export const updateStatus = async (orderId: string, status: OrderStatus, staff: StaffDoc) => {
  const order = await findOrder(orderId)
  assertCanAccess(order, staff)

  if (!ALLOWED_TRANSITIONS[order.status]?.includes(status)) {
    throw conflict('This order has already moved on')
  }
  if (!hasPermission(staff, 'orders') && status !== 'delivered') throw forbidden()
  if (status === 'out-for-delivery' && !order.riderId) throw unprocessable('Assign a rider first')
  if (status === 'delivered' && order.paymentStatus === 'due') {
    throw unprocessable('Record the payment before marking this order delivered')
  }

  // The status in the filter stops two staff moving the same order at once.
  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: order.status },
    {
      status,
      $push: { events: event(staff.name, `Status changed to ${status.replaceAll('-', ' ')}`) },
    },
    { returnDocument: 'after' },
  )
  if (!updated) throw conflict('This order has already moved on')

  if (status === 'out-for-delivery') emailOutForDelivery(updated)
  if (status === 'delivered') emailDelivered(updated)
  announceOrderChange(updated)
  return updated
}

export const assignRider = async (orderId: string, riderId: string, staff: StaffDoc) => {
  const rider = await Staff.findOne({ _id: riderId, role: 'rider', active: true })
  if (!rider) throw badRequest('Choose an active rider')

  const order = await findOrder(orderId)
  order.riderId = rider.id
  order.events.push(event(staff.name, `Assigned to ${rider.name}`))
  await order.save()
  announceOrderChange(order)
  return order
}

export const updateEta = async (orderId: string, etaMinutes: number, staff: StaffDoc) => {
  const order = await findOrder(orderId)
  order.etaMinutes = etaMinutes
  order.events.push(event(staff.name, `ETA changed to ${etaMinutes} minutes`))
  await order.save()
  announceOrderChange(order)
  return order
}

export const recordCollection = async (
  orderId: string,
  collectedBy: 'cash' | 'card',
  staff: StaffDoc,
) => {
  const order = await findOrder(orderId)
  assertCanAccess(order, staff)

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: 'due', status: 'out-for-delivery' },
    {
      paymentStatus: 'paid',
      collectedBy,
      status: 'delivered',
      $push: { events: event(staff.name, `Payment collected by ${collectedBy}, order delivered`) },
    },
    { returnDocument: 'after' },
  )
  if (!updated) throw conflict('This order has already moved on')

  emailDelivered(updated)
  announceOrderChange(updated)
  return updated
}

/** Claims the money in the database first, so a double click can never refund twice. */
const claimRefund = async (order: OrderRecord, amount: number, extra: object = {}) => {
  const refundedAmount = order.refundedAmount + amount
  return Order.findOneAndUpdate(
    { _id: order.id, refundedAmount: order.refundedAmount },
    {
      refundedAmount,
      paymentStatus: refundedAmount === order.total ? 'refunded' : 'partially-refunded',
      ...extra,
    },
    { returnDocument: 'after' },
  )
}

export const refundOrder = async (
  orderId: string,
  amount: number,
  reason: string,
  staff: StaffDoc,
) => {
  const order = await findOrder(orderId)
  if (amount <= 0 || amount > getRefundableAmount(order)) {
    throw unprocessable('Enter an amount up to the refundable total')
  }

  const claimed = await claimRefund(order, amount)
  if (!claimed) throw conflict('This order was just refunded')

  try {
    await refundPayment(
      order.stripePaymentIntentId,
      amount,
      `refund-${order.id}-${order.refundedAmount}-${amount}`,
    )
  } catch (error) {
    await Order.updateOne(
      { _id: order.id },
      { refundedAmount: order.refundedAmount, paymentStatus: order.paymentStatus },
    )
    throw error
  }

  claimed.events.push(event(staff.name, `Refunded ${money(amount)}: ${reason}`))
  await claimed.save()
  emailRefund(claimed, amount)
  announceOrderChange(claimed)
  return claimed
}

export const cancelOrder = async (orderId: string, reason: string, staff: StaffDoc) => {
  const order = await findOrder(orderId)
  if (['delivered', 'cancelled'].includes(order.status))
    throw conflict('This order cannot be cancelled')

  const refundable = getRefundableAmount(order)
  if (refundable > 0) {
    const claimed = await claimRefund(order, refundable)
    if (!claimed) throw conflict('This order was just changed')
    await refundPayment(order.stripePaymentIntentId, refundable, `cancel-${order.id}`)
  }

  const cancelled = await Order.findByIdAndUpdate(
    order.id,
    { status: 'cancelled', $push: { events: event(staff.name, `Order cancelled: ${reason}`) } },
    { returnDocument: 'after' },
  )
  if (!cancelled) throw notFound('Order')

  emailCancelled(cancelled, refundable)
  announceOrderChange(cancelled)
  return cancelled
}

export const expireUnpaidOrders = async () => {
  const cutoff = new Date(Date.now() - UNPAID_ORDER_MINUTES * 60_000)
  const orders = await Order.find({ status: 'pending-payment', createdAt: { $lt: cutoff } })

  for (const order of orders) {
    try {
      if (order.stripePaymentIntentId) await cancelPaymentIntent(order.stripePaymentIntentId)
      order.status = 'cancelled'
      order.events.push(event('System', 'Payment was not completed'))
      await order.save()
    } catch (error) {
      // Usually means the payment has just succeeded, so the webhook will finish this order.
      console.error(`Could not expire ${order.number}`, error)
    }
  }
}

export const sendScheduledReminders = async () => {
  const soon = new Date(Date.now() + 60 * 60_000)
  const orders = await Order.find({
    status: { $in: ['received', 'preparing'] },
    scheduledFor: { $gt: new Date(), $lte: soon },
    reminderSentAt: { $exists: false },
  })

  for (const order of orders) {
    order.reminderSentAt = new Date()
    await order.save()
    emailScheduledReminder(order)
  }
}
