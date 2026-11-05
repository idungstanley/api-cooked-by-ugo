import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface SavedAddress {
  line1: string
  line2?: string
  city: string
  postcode: string
}

/** A customer who signed up on the website. Guests can still order without one. */
export interface AccountDoc {
  _id: string
  name: string
  email: string
  passwordHash: string
  phone?: string
  address?: SavedAddress
  marketingOptIn: boolean
  tokenVersion: number
  resetTokenHash?: string
  resetTokenExpires?: Date
}

const hiddenFields = ['passwordHash', 'tokenVersion', 'resetTokenHash', 'resetTokenExpires']

export const Account = model<AccountDoc>(
  'Account',
  new Schema<AccountDoc>(
    {
      _id: { type: String, required: true },
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      phone: String,
      address: { _id: false, line1: String, line2: String, city: String, postcode: String },
      marketingOptIn: { type: Boolean, default: false },
      tokenVersion: { type: Number, default: 0 },
      resetTokenHash: { type: String, index: true, sparse: true },
      resetTokenExpires: Date,
    },
    {
      ...baseOptions,
      toJSON: {
        versionKey: false,
        transform: (_doc, ret) => {
          const output = ret as unknown as Record<string, unknown>
          output.id = String(output._id)
          delete output._id
          hiddenFields.forEach((field) => delete output[field])
          return output
        },
      },
    },
  ),
)
