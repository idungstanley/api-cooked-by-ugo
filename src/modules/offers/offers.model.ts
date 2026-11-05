import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export const OFFER_TYPES = ['bogo', 'percent', 'amount', 'free-delivery'] as const
export type OfferType = (typeof OFFER_TYPES)[number]

export interface OfferDoc {
  _id: string
  name: string
  type: OfferType
  /** Percent for `percent`, pence for `amount`. Unused for the other types. */
  value: number
  /** Dishes the offer covers. Empty means the whole order. Buy one get one free needs dishes. */
  dishIds: string[]
  minSubtotal: number
  startsAt?: Date
  endsAt?: Date
  active: boolean
}

export const Offer = model<OfferDoc>(
  'Offer',
  new Schema<OfferDoc>(
    {
      _id: { type: String, required: true },
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: OFFER_TYPES, required: true },
      value: { type: Number, default: 0, min: 0 },
      dishIds: { type: [String], default: [] },
      minSubtotal: { type: Number, default: 0, min: 0 },
      startsAt: Date,
      endsAt: Date,
      active: { type: Boolean, default: true },
    },
    baseOptions,
  ),
)

export const isOfferLive = (offer: OfferDoc, now = new Date()) =>
  offer.active &&
  (!offer.startsAt || offer.startsAt <= now) &&
  (!offer.endsAt || offer.endsAt > now)

export const findLiveOffers = async (now = new Date()) =>
  (await Offer.find({ active: true }).lean()).filter((offer) => isOfferLive(offer, now))

/** The short label customers see on a dish or in the basket. */
export const offerLabel = ({ type, value }: Pick<OfferDoc, 'type' | 'value'>) => {
  if (type === 'bogo') return 'Buy 1, get 1 free'
  if (type === 'percent') return `${value}% off`
  if (type === 'amount') return `£${(value / 100).toFixed(2).replace(/\.00$/, '')} off`
  return 'Free delivery'
}
