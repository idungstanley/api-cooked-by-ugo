import { model, Schema } from 'mongoose'
import type { Role } from '../../config/constants.js'
import { baseOptions, jsonOptions } from '../../lib/schemaOptions.js'

export interface StaffDoc {
  _id: string
  name: string
  email: string
  role: Role
  active: boolean
  passwordHash?: string
  twoFactorSecret?: string
  twoFactorEnabled: boolean
  /** Raising this signs the person out everywhere. */
  tokenVersion: number
  passwordResetHash?: string
  passwordResetExpires?: Date
  lastActiveAt: Date
}

const hiddenFields = [
  'passwordHash',
  'twoFactorSecret',
  'passwordResetHash',
  'passwordResetExpires',
  'tokenVersion',
]

const schema = new Schema<StaffDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ['owner', 'kitchen', 'rider'], required: true },
    active: { type: Boolean, default: true },
    passwordHash: String,
    twoFactorSecret: String,
    twoFactorEnabled: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    passwordResetHash: String,
    passwordResetExpires: Date,
    lastActiveAt: { type: Date, default: Date.now },
  },
  {
    ...baseOptions,
    toJSON: {
      ...jsonOptions,
      transform: (doc, ret) => {
        const output = ret as unknown as Record<string, unknown>
        hiddenFields.forEach((field) => delete output[field])
        output.lastActiveAt = new Date(output.lastActiveAt as Date).getTime()
        return jsonOptions.transform(doc, output)
      },
    },
  },
)

export const Staff = model<StaffDoc>('Staff', schema)
