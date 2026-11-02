import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface EnquiryDoc {
  name: string
  email: string
  phone: string
  eventDate: string
  guests: number
  message: string
  status: 'new' | 'replied' | 'closed'
  createdAt: Date
}

const options = {
  ...baseOptions,
  toJSON: {
    ...(baseOptions.toJSON as object),
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = String(ret._id)
      ret.createdAt = new Date(ret.createdAt as Date).getTime()
      delete ret._id
      delete ret.updatedAt
      return ret
    },
  },
}

export const Enquiry = model<EnquiryDoc>(
  'Enquiry',
  new Schema<EnquiryDoc>(
    {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      eventDate: { type: String, required: true },
      guests: { type: Number, required: true },
      message: { type: String, required: true },
      status: { type: String, enum: ['new', 'replied', 'closed'], default: 'new' },
    },
    options,
  ),
)
