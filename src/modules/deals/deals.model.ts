import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface DealDoc {
  _id: string
  name: string
  tag: string
  description: string
  price: number
  wasPrice: number
  image: string
  theme: 'jollof' | 'ewedu' | 'indigo'
  active: boolean
  activeDays: number[]
  startsOn?: string
  endsOn?: string
}

export const Deal = model<DealDoc>(
  'Deal',
  new Schema<DealDoc>(
    {
      _id: { type: String, required: true },
      name: { type: String, required: true },
      tag: { type: String, required: true },
      description: { type: String, required: true },
      price: { type: Number, required: true, min: 0 },
      wasPrice: { type: Number, required: true, min: 0 },
      image: { type: String, required: true },
      theme: { type: String, enum: ['jollof', 'ewedu', 'indigo'], default: 'jollof' },
      active: { type: Boolean, default: true },
      activeDays: [Number],
      startsOn: String,
      endsOn: String,
    },
    baseOptions,
  ),
)

interface ShopDay {
  day: number
  date: string
}

export const isDealAvailable = (deal: DealDoc, { day, date }: ShopDay) =>
  deal.active &&
  deal.activeDays.includes(day) &&
  (!deal.startsOn || deal.startsOn <= date) &&
  (!deal.endsOn || deal.endsOn >= date)
