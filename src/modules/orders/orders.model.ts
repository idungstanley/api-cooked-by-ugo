import { model, Schema } from 'mongoose'
import { ORDER_STATUSES, type OrderStatus } from '../../config/constants.js'
import { isDuplicateKey } from '../../lib/errors.js'
import { baseOptions } from '../../lib/schemaOptions.js'

export type PaymentStatus = 'pending' | 'paid' | 'due' | 'partially-refunded' | 'refunded'

export interface OrderItemOption {
  groupTitle: string
  label: string
  price: number
}

export interface OrderItemDoc {
  id: string
  productId: string
  name: string
  /** The dish on its own, before options. Older orders do not have it. */
  basePrice?: number
  options: OrderItemOption[]
  note?: string
  summary?: string
  quantity: number
  unitPrice: number
}

/** One card charge, so refunds can be spread across the original payment and any top-up. */
export interface OrderPayment {
  intentId: string
  amount: number
  refunded: number
}

/** The kitchen's request to change an order, and the customer's answer. */
export interface OrderAmendment {
  state: 'waiting' | 'awaiting-payment' | 'resolved'
  unavailableItemIds: string[]
  message?: string
  requestedAt: Date
  requestedBy: string
  resolution?: 'removed' | 'replaced' | 'cancelled'
  resolvedAt?: Date
  /** Replacements that cost more, held until the customer pays the difference. */
  pending?: {
    items: OrderItemDoc[]
    subtotal: number
    discount: number
    appliedOffers?: OrderDoc['appliedOffers']
    total: number
    intentId: string
  }
}

export interface OrderDoc {
  _id: string
  number: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  address: string
  postcode: string
  deliveryNote?: string
  allergyNote?: string
  items: OrderItemDoc[]
  subtotal: number
  discount: number
  appliedOffers: { offerId: string; name: string; discount: number; freeDelivery: boolean }[]
  deliveryFee: number
  total: number
  distanceMiles?: number
  /** Signed-in customers. Guest orders have no account. */
  accountId?: string
  paymentMethod: 'card' | 'on-delivery'
  paymentStatus: PaymentStatus
  collectedBy?: 'cash' | 'card'
  refundedAmount: number
  scheduledFor?: Date
  /** Minutes from order to door, for orders wanted as soon as possible. */
  etaMinutes: number
  /** Time on the road, so the kitchen knows when the food must be ready. */
  deliveryMinutes: number
  riderId?: string
  status: OrderStatus
  events: { id: string; at: Date; actor: string; message: string }[]
  trackingKey: string
  stripePaymentIntentId?: string
  payments: OrderPayment[]
  amendment?: OrderAmendment
  idempotencyKey?: string
  reminderSentAt?: Date
  createdAt: Date
}

const secretFields = [
  'trackingKey',
  'stripePaymentIntentId',
  'payments',
  'idempotencyKey',
  'reminderSentAt',
  'updatedAt',
]

const schema = new Schema<OrderDoc>(
  {
    _id: { type: String, required: true },
    number: { type: String, required: true, unique: true },
    customerId: { type: String, required: true, index: true },
    customerName: String,
    customerPhone: String,
    customerEmail: String,
    address: String,
    postcode: String,
    deliveryNote: String,
    allergyNote: String,
    items: [
      {
        _id: false,
        id: String,
        productId: String,
        name: String,
        basePrice: Number,
        options: [{ _id: false, groupTitle: String, label: String, price: Number }],
        note: String,
        summary: String,
        quantity: Number,
        unitPrice: Number,
      },
    ],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    appliedOffers: [
      { _id: false, offerId: String, name: String, discount: Number, freeDelivery: Boolean },
    ],
    deliveryFee: { type: Number, required: true },
    total: { type: Number, required: true },
    distanceMiles: Number,
    accountId: { type: String, index: true, sparse: true },
    paymentMethod: { type: String, enum: ['card', 'on-delivery'], required: true },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'due', 'partially-refunded', 'refunded'],
      required: true,
    },
    collectedBy: { type: String, enum: ['cash', 'card'] },
    refundedAmount: { type: Number, default: 0 },
    scheduledFor: Date,
    etaMinutes: { type: Number, required: true },
    deliveryMinutes: { type: Number, default: 20 },
    riderId: { type: String, index: true },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    events: [{ _id: false, id: String, at: Date, actor: String, message: String }],
    trackingKey: { type: String, required: true },
    stripePaymentIntentId: { type: String, index: true, sparse: true },
    payments: [{ _id: false, intentId: String, amount: Number, refunded: Number }],
    amendment: {
      type: new Schema(
        {
          state: { type: String, enum: ['waiting', 'awaiting-payment', 'resolved'] },
          unavailableItemIds: [String],
          message: String,
          requestedAt: Date,
          requestedBy: String,
          resolution: { type: String, enum: ['removed', 'replaced', 'cancelled'] },
          resolvedAt: Date,
          pending: {
            type: new Schema(
              {
                items: [Schema.Types.Mixed],
                appliedOffers: [Schema.Types.Mixed],
                subtotal: Number,
                discount: Number,
                total: Number,
                intentId: { type: String, index: true, sparse: true },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
    },
    idempotencyKey: { type: String, unique: true, sparse: true },
    reminderSentAt: Date,
  },
  {
    ...baseOptions,
    toJSON: {
      versionKey: false,
      // Dates leave as timestamps, which is what the admin app formats.
      transform: (_doc, ret) => {
        const output = ret as unknown as Record<string, unknown>
        output.id = String(output._id)
        delete output._id
        secretFields.forEach((field) => delete output[field])
        output.createdAt = new Date(output.createdAt as Date).getTime()
        if (output.scheduledFor)
          output.scheduledFor = new Date(output.scheduledFor as Date).getTime()
        output.events = (output.events as OrderDoc['events']).map((event) => ({
          ...event,
          at: new Date(event.at).getTime(),
        }))
        const amendment = output.amendment as OrderAmendment | undefined
        if (amendment) {
          output.amendment = {
            state: amendment.state,
            unavailableItemIds: amendment.unavailableItemIds,
            message: amendment.message,
            requestedAt: new Date(amendment.requestedAt).getTime(),
            requestedBy: amendment.requestedBy,
            resolution: amendment.resolution,
            resolvedAt: amendment.resolvedAt && new Date(amendment.resolvedAt).getTime(),
          }
        }
        return output
      },
    },
  },
)

schema.index({ status: 1, createdAt: -1 })
schema.index({ createdAt: -1 })

export const Order = model<OrderDoc>('Order', schema)

const Counter = model<{ _id: string; value: number }>(
  'Counter',
  new Schema({ _id: String, value: { type: Number, default: 0 } }, { versionKey: false }),
)

/** Atomic, so two orders placed together can never share a number. */
export const nextOrderNumber = async (): Promise<string> => {
  const increment = () =>
    Counter.findByIdAndUpdate(
      'order',
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' },
    )
  // Two first-ever orders can race to create the counter, and the loser simply tries again.
  const counter = await increment().catch((error) => {
    if (isDuplicateKey(error)) return increment()
    throw error
  })
  return `UGO-${1000 + (counter?.value ?? 0)}`
}
