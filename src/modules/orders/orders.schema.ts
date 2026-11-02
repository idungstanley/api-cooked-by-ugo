import { z } from 'zod'

const UK_PHONE = /^(\+44\s?|0)\d[\d\s]{8,12}$/
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i

export const cartInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(50),
        /** Chosen option ids, keyed by option group id. Prices are never accepted from the client. */
        selection: z.record(z.string(), z.array(z.string())).default({}),
      }),
    )
    .min(1, 'Your basket is empty')
    .max(50),
  postcode: z.string().trim().regex(UK_POSTCODE, 'Enter a valid postcode'),
})

export const orderInput = cartInput.extend({
  idempotencyKey: z.string().min(8).max(100),
  delivery: z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.email().max(200),
    phone: z.string().trim().regex(UK_PHONE, 'Enter a valid UK phone number'),
    address: z.string().trim().min(4).max(200),
    city: z.string().trim().min(2).max(100),
    note: z.string().trim().max(200).optional(),
    allergyNote: z.string().trim().max(200).optional(),
    scheduledFor: z.number().int().optional(),
    marketingOptIn: z.boolean().default(false),
  }),
  paymentMethod: z.enum(['card', 'on-delivery']),
})

export type CartInput = z.infer<typeof cartInput>
export type OrderInput = z.infer<typeof orderInput>
