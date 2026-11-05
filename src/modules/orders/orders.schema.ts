import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'
import { UK_POSTCODE } from '../../services/postcodes.js'

/** Any real number, from any country, stored in the international format. */
export const phoneNumber = z
  .string()
  .trim()
  .transform((value, context) => {
    const phone = parsePhoneNumberFromString(value, 'GB')
    if (!phone?.isValid()) {
      context.addIssue({ code: 'custom', message: 'Enter a valid phone number' })
      return z.NEVER
    }
    return phone.formatInternational()
  })

const cartItems = z
  .array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1).max(50),
      /** Chosen option ids, keyed by option group id. Prices are never accepted from the client. */
      selection: z.record(z.string(), z.array(z.string())).default({}),
      /** How the customer wants it, such as "not too spicy". */
      note: z.string().trim().max(200).optional(),
    }),
  )
  .min(1, 'Your basket is empty')
  .max(50)

const postcode = z.string().trim().regex(UK_POSTCODE, 'Enter a valid postcode')

/** The basket can be priced before a postcode is known, without a delivery fee. */
export const quoteInput = z.object({ items: cartItems, postcode: postcode.optional() })

export const cartInput = z.object({ items: cartItems, postcode })

export const orderInput = cartInput.extend({
  idempotencyKey: z.string().min(8).max(100),
  delivery: z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.email().max(200),
    phone: phoneNumber,
    address: z.string().trim().min(4).max(200),
    city: z.string().trim().min(2).max(100),
    note: z.string().trim().max(200).optional(),
    allergyNote: z.string().trim().max(200).optional(),
    scheduledFor: z.number().int().optional(),
    marketingOptIn: z.boolean().default(false),
  }),
  /** Every order is paid for when it is placed. */
  paymentMethod: z.literal('card').default('card'),
})

export type QuoteInput = z.infer<typeof quoteInput>
export type CartInput = z.infer<typeof cartInput>
export type OrderInput = z.infer<typeof orderInput>
