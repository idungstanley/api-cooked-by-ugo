import { z } from 'zod'
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js'
import {
  cancelPaymentIntent,
  createPaymentIntent,
  getPaymentClientSecret,
  paymentsEnabled,
} from '../../services/payments.js'
import { announceOrderChange } from '../../services/realtime.js'
import type { StaffDoc } from '../staff/staff.model.js'
import { Dish } from '../catalog/catalog.model.js'
import { applyOffers } from '../offers/applyOffers.js'
import { findLiveOffers } from '../offers/offers.model.js'
import { emailChangesNeeded, emailOrderUpdated } from './orders.emails.js'
import { Order, type OrderItemDoc } from './orders.model.js'
import { cartItems } from './orders.schema.js'
import { cancelOrder, event, refundAcrossCharges } from './orders.service.js'
import { priceLines } from './pricing.js'

type OrderRecord = InstanceType<typeof Order>

export const changeRequestInput = z.object({
  itemIds: z.array(z.string()).min(1, 'Choose at least one item that is out of stock'),
  message: z.string().trim().max(500).optional(),
  /** Also mark the dishes sold out, so nobody else can order them. */
  markSoldOut: z.boolean().default(true),
})

export const changeResponseInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove') }),
  z.object({ action: z.literal('replace'), items: cartItems }),
  z.object({ action: z.literal('cancel') }),
])

const CHANGEABLE_STATUSES = ['received', 'preparing']

/**
 * The kitchen marks items it cannot make. The order waits for the customer to remove them,
 * swap them for something else or cancel, all on the same order and delivery fee.
 */
export const requestChanges = async (
  orderId: string,
  input: z.infer<typeof changeRequestInput>,
  staff: StaffDoc,
) => {
  const order = await Order.findById(orderId)
  if (!order) throw notFound('Order')
  if (!CHANGEABLE_STATUSES.includes(order.status)) {
    throw conflict('Only new or preparing orders can be changed')
  }
  const unavailable = order.items.filter(({ id }) => input.itemIds.includes(id))
  if (unavailable.length !== input.itemIds.length) {
    throw unprocessable('Those items are not on this order')
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order.id, status: order.status },
    {
      status: 'awaiting-customer',
      amendment: {
        state: 'waiting',
        unavailableItemIds: input.itemIds,
        message: input.message || undefined,
        requestedAt: new Date(),
        requestedBy: staff.name,
      },
      $push: {
        events: event(
          staff.name,
          `Asked the customer about ${unavailable.map(({ name }) => name).join(', ')}`,
        ),
      },
    },
    { returnDocument: 'after' },
  )
  if (!updated) throw conflict('This order has already moved on')

  if (input.markSoldOut) {
    await Dish.updateMany(
      { _id: { $in: unavailable.map(({ productId }) => productId) } },
      { soldOut: true },
    )
  }
  emailChangesNeeded(updated, unavailable)
  announceOrderChange(updated)
  return updated
}

const lineTotal = (items: Pick<OrderItemDoc, 'unitPrice' | 'quantity'>[]) =>
  items.reduce((sum, { unitPrice, quantity }) => sum + unitPrice * quantity, 0)

/** The order's new lines and totals. Delivery is charged once, so the fee never changes. */
const repriceOrder = async (order: OrderRecord, items: OrderItemDoc[]) => {
  const subtotal = lineTotal(items)
  const offers = applyOffers(await findLiveOffers(), items)
  return {
    items,
    subtotal,
    discount: offers.discount,
    appliedOffers: offers.applied,
    total: subtotal - offers.discount + order.deliveryFee,
  }
}

/** Saves the changed order, returns any difference to the card, and tells everyone. */
const applyChange = async (
  order: OrderRecord,
  change: Awaited<ReturnType<typeof repriceOrder>>,
  resolution: 'removed' | 'replaced',
  actor: string,
) => {
  const refund = Math.max(order.total - change.total, 0)
  const payments =
    refund > 0 ? await refundAcrossCharges(order, refund, `amend-${order.id}`) : order.payments

  const updated = await Order.findOneAndUpdate(
    { _id: order.id, status: 'awaiting-customer' },
    {
      ...change,
      payments,
      status: 'received',
      'amendment.state': 'resolved',
      'amendment.resolution': resolution,
      'amendment.resolvedAt': new Date(),
      $unset: { 'amendment.pending': 1 },
      $push: {
        events: event(
          actor,
          resolution === 'removed'
            ? `Removed the unavailable items${refund ? `, refunded £${(refund / 100).toFixed(2)}` : ''}`
            : `Chose replacement items${refund ? `, refunded £${(refund / 100).toFixed(2)}` : ''}`,
        ),
      },
    },
    { returnDocument: 'after' },
  )
  if (!updated) throw conflict('This order has already been updated')
  emailOrderUpdated(updated, refund)
  announceOrderChange(updated)
  return updated
}

/** The customer's answer, from their tracking page. */
export const respondToChanges = async (
  order: OrderRecord,
  input: z.infer<typeof changeResponseInput>,
) => {
  const amendment = order.amendment
  if (order.status !== 'awaiting-customer' || !amendment || amendment.state === 'resolved') {
    throw conflict('This order does not need any changes')
  }
  // A customer who changes their mind about paying for replacements starts afresh.
  if (amendment.pending?.intentId) await cancelPaymentIntent(amendment.pending.intentId)

  if (input.action === 'cancel') {
    await cancelOrder(order.id, 'Customer cancelled after items were unavailable', {
      name: 'Customer',
    })
    return { order: await Order.findById(order.id) }
  }

  const kept = order.items.filter(({ id }) => !amendment.unavailableItemIds.includes(id))

  if (input.action === 'remove') {
    if (kept.length === 0) {
      await cancelOrder(order.id, 'Nothing left on the order after removing items', {
        name: 'Customer',
      })
      return { order: await Order.findById(order.id) }
    }
    return {
      order: await applyChange(order, await repriceOrder(order, kept), 'removed', 'Customer'),
    }
  }

  const priced = await priceLines(input.items)
  const firstId = Math.max(0, ...order.items.map(({ id }) => Number(id.split('-')[1]) || 0)) + 1
  const added = priced.map((line, index) => ({ ...line, id: `line-${firstId + index}` }))
  const change = await repriceOrder(order, [...kept, ...added])
  const extra = change.total - order.total

  // Replacements that cost the same or less are settled straight away.
  if (extra <= 0 || !paymentsEnabled) {
    return { order: await applyChange(order, change, 'replaced', 'Customer') }
  }

  try {
    const intent = await createPaymentIntent(order.id, extra, `amend-${order.id}-${Date.now()}`)
    order.set('amendment.state', 'awaiting-payment')
    order.set('amendment.pending', { ...change, intentId: intent.id })
    await order.save()
    return { order, clientSecret: intent.client_secret ?? undefined, extra }
  } catch (error) {
    console.error(`Could not start top-up payment for ${order.number}`, error)
    throw new AppError(503, 'Card payments are not working right now. Please try again shortly.')
  }
}

/** Exactly what removing the unavailable items would give back, after offers are re-checked. */
export const removalRefund = async (order: OrderRecord) => {
  const amendment = order.amendment
  if (!amendment || amendment.state === 'resolved') return null
  const kept = order.items.filter(({ id }) => !amendment.unavailableItemIds.includes(id))
  if (kept.length === 0) return order.total
  const change = await repriceOrder(order, kept)
  return Math.max(order.total - change.total, 0)
}

/** The payment form for a top-up the customer started but has not finished. */
export const pendingTopUp = async (order: OrderRecord) => {
  const pending =
    order.amendment?.state === 'awaiting-payment' ? order.amendment.pending : undefined
  if (!pending) return null
  return {
    extra: pending.total - order.total,
    clientSecret: await getPaymentClientSecret(pending.intentId),
  }
}

/** Only Stripe's signed webhook confirms a top-up, then the replacement items are applied. */
export const confirmAmendmentPayment = async (paymentIntentId: string, amountPaid: number) => {
  const order = await Order.findOne({
    'amendment.pending.intentId': paymentIntentId,
    'amendment.state': 'awaiting-payment',
  })
  const pending = order?.amendment?.pending
  if (!order || !pending || pending.total - order.total !== amountPaid) return false

  order.payments.push({ intentId: paymentIntentId, amount: amountPaid, refunded: 0 })
  await order.save()
  await applyChange(
    order,
    {
      items: pending.items,
      subtotal: pending.subtotal,
      discount: pending.discount,
      appliedOffers: pending.appliedOffers ?? [],
      total: pending.total,
    },
    'replaced',
    'Stripe',
  )
  return true
}
