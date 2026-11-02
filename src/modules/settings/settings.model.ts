import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'
import { notFound } from '../../lib/errors.js'

export interface ShopSettingsDoc {
  _id: string
  ordersPaused: boolean
  hours: { day: number; open: boolean; opensAt: string; closesAt: string }[]
  closures: { id: string; date: string; label: string }[]
  zones: { id: string; prefix: string; fee: number; minimumOrder: number; active: boolean }[]
  freeDeliveryThreshold: number
  etaMinutes: number
  cardEnabled: boolean
  payOnDeliveryEnabled: boolean
  payOnDeliveryLimit: number
}

export const SETTINGS_ID = 'shop'

export const ShopSettings = model<ShopSettingsDoc>(
  'ShopSettings',
  new Schema<ShopSettingsDoc>(
    {
      _id: { type: String, default: SETTINGS_ID },
      ordersPaused: { type: Boolean, default: false },
      hours: [{ _id: false, day: Number, open: Boolean, opensAt: String, closesAt: String }],
      closures: [{ _id: false, id: String, date: String, label: String }],
      zones: [
        {
          _id: false,
          id: String,
          prefix: String,
          fee: Number,
          minimumOrder: Number,
          active: Boolean,
        },
      ],
      freeDeliveryThreshold: Number,
      etaMinutes: Number,
      cardEnabled: Boolean,
      payOnDeliveryEnabled: Boolean,
      payOnDeliveryLimit: Number,
    },
    baseOptions,
  ),
)

export const getSettings = async () => {
  const settings = await ShopSettings.findById(SETTINGS_ID)
  if (!settings) throw notFound('Shop settings')
  return settings
}
