import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface CustomerDoc {
  _id: string
  name: string
  email: string
  phone: string
  phoneKey?: string
  marketingOptIn: boolean
  blocked: boolean
  blockReason?: string
  deleted: boolean
}

export const Customer = model<CustomerDoc>(
  'Customer',
  new Schema<CustomerDoc>(
    {
      _id: { type: String, required: true },
      name: { type: String, required: true },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      // Normalised phone number. Guests have no accounts, so this identifies a returning customer.
      phoneKey: { type: String, unique: true, sparse: true },
      marketingOptIn: { type: Boolean, default: false },
      blocked: { type: Boolean, default: false },
      blockReason: String,
      deleted: { type: Boolean, default: false },
    },
    baseOptions,
  ),
)

export const normalisePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('44') ? `0${digits.slice(2)}` : digits
}
