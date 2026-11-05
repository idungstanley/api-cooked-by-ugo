import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'
import { notFound } from '../../lib/errors.js'

/** One ring on the delivery map. A postcode pays the fee of the smallest ring it falls inside. */
export interface DeliveryRadius {
  id: string
  maxMiles: number
  fee: number
  minimumOrder: number
  active: boolean
}

export interface ShopSettingsDoc {
  _id: string
  ordersPaused: boolean
  hours: { day: number; open: boolean; opensAt: string; closesAt: string }[]
  closures: { id: string; date: string; label: string }[]
  kitchen: { postcode: string; lat: number; lng: number }
  deliveryRadii: DeliveryRadius[]
  freeDeliveryThreshold: number
  /** Average time to cook an order, like the preparation time on Uber Eats. */
  prepMinutes: number
  /** Average time on the road from the kitchen to the door. */
  deliveryMinutes: number
}

export const SETTINGS_ID = 'shop'

/** Central Newcastle, until the owner sets the kitchen's own postcode. */
export const DEFAULT_KITCHEN = { postcode: 'NE1 4ST', lat: 54.9713, lng: -1.6174 }

export const DEFAULT_RADII: DeliveryRadius[] = [
  { id: 'radius-near', maxMiles: 3, fee: 299, minimumOrder: 1200, active: true },
  { id: 'radius-mid', maxMiles: 6, fee: 399, minimumOrder: 1500, active: true },
  { id: 'radius-far', maxMiles: 10, fee: 549, minimumOrder: 1500, active: true },
]

export const ShopSettings = model<ShopSettingsDoc>(
  'ShopSettings',
  new Schema<ShopSettingsDoc>(
    {
      _id: { type: String, default: SETTINGS_ID },
      ordersPaused: { type: Boolean, default: false },
      hours: [{ _id: false, day: Number, open: Boolean, opensAt: String, closesAt: String }],
      closures: [{ _id: false, id: String, date: String, label: String }],
      kitchen: {
        type: new Schema({ postcode: String, lat: Number, lng: Number }, { _id: false }),
        default: () => ({ ...DEFAULT_KITCHEN }),
      },
      deliveryRadii: {
        type: [
          {
            _id: false,
            id: String,
            maxMiles: Number,
            fee: Number,
            minimumOrder: Number,
            active: Boolean,
          },
        ],
        default: () => DEFAULT_RADII.map((radius) => ({ ...radius })),
      },
      freeDeliveryThreshold: { type: Number, default: 2500 },
      prepMinutes: { type: Number, default: 30 },
      deliveryMinutes: { type: Number, default: 20 },
    },
    baseOptions,
  ),
)

export const getSettings = async () => {
  const settings = await ShopSettings.findById(SETTINGS_ID)
  if (!settings) throw notFound('Shop settings')
  return settings
}

/** From order to door for an order placed now. */
export const leadMinutes = (settings: Pick<ShopSettingsDoc, 'prepMinutes' | 'deliveryMinutes'>) =>
  settings.prepMinutes + settings.deliveryMinutes
