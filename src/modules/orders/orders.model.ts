import { model, Schema } from 'mongoose'
import { ORDER_STATUSES, type OrderStatus } from '../../config/constants.js'
import { isDuplicateKey } from '../../lib/errors.js'
import { baseOptions } from '../../lib/schemaOptions.js'

export type PaymentStatus = 'pending' | 'paid' | 'due' | 'partially-refunded' | 'refunded'

export interface OrderItemDoc {
  id: string
  productId: string
  name: string
  summary?: string
  quantity: number
  unitPrice: number
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
  deliveryFee: number
  total: number
  paymentMethod: 'card' | 'on-delivery'
  paymentStatus: PaymentStatus
  collectedBy?: 'cash' | 'card'
  refundedAmount: number
  scheduledFor?: Date
  etaMinutes: number
  riderId?: string
  status: OrderStatus
  events: { id: string; at: Date; actor: string; message: string }[]
  trackingKey: string
  stripePaymentIntentId?: string
  idempotencyKey?: string
  reminderSentAt?: Date
  createdAt: Date
}

const secretFields = [
  'trackingKey',
  'stripePaymentIntentId',
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
        summary: String,
        quantity: Number,
        unitPrice: Number,
      },
    ],
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    total: { type: Number, required: true },
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
    riderId: { type: String, index: true },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    events: [{ _id: false, id: String, at: Date, actor: String, message: String }],
    trackingKey: { type: String, required: true },
    stripePaymentIntentId: { type: String, index: true, sparse: true },
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
