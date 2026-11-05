import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface ReviewDoc {
  _id: string
  orderId: string
  orderNumber: string
  orderTotal: number
  customerId: string
  accountId?: string
  /** First name and initial, which is all the public site shows. */
  displayName: string
  rating: number
  comment?: string
  /** Dishes the customer gave a thumbs up. */
  likedItems: string[]
  reply?: string
  repliedAt?: Date
  repliedBy?: string
  hidden: boolean
  createdAt: Date
}

const schema = new Schema<ReviewDoc>(
  {
    _id: { type: String, required: true },
    orderId: { type: String, required: true, unique: true },
    orderNumber: String,
    orderTotal: Number,
    customerId: { type: String, index: true },
    accountId: { type: String, index: true, sparse: true },
    displayName: String,
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: String,
    likedItems: { type: [String], default: [] },
    reply: String,
    repliedAt: Date,
    repliedBy: String,
    hidden: { type: Boolean, default: false },
  },
  baseOptions,
)
schema.index({ createdAt: -1 })

export const Review = model<ReviewDoc>('Review', schema)

export const displayNameFor = (fullName: string) => {
  const [first = '', ...rest] = fullName.trim().split(/\s+/)
  const initial = rest.at(-1)?.[0]
  return initial ? `${first} ${initial.toUpperCase()}` : first
}

/** Average rating and how many reviews gave each star, for visible reviews only. */
export const summariseReviews = async () => {
  const counts = await Review.aggregate<{ _id: number; count: number }>([
    { $match: { hidden: false } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ])
  const breakdown = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: counts.find(({ _id }) => _id === stars)?.count ?? 0,
  }))
  const count = breakdown.reduce((total, entry) => total + entry.count, 0)
  const points = breakdown.reduce((total, entry) => total + entry.stars * entry.count, 0)
  return { average: count ? Math.round((points / count) * 10) / 10 : 0, count, breakdown }
}
