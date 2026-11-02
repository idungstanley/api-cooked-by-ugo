import { z } from 'zod'

const optional = z
  .string()
  .optional()
  .transform((value) => value || undefined)

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    MONGODB_URI: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
    ADMIN_URL: z.string().default('http://localhost:5174'),
    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,
    BREVO_API_KEY: optional,
    EMAIL_FROM: z.string().default('orders@cookbyugo.co.uk'),
    KITCHEN_EMAIL: optional,
    CLOUDINARY_URL: optional,
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') return
    const required = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'BREVO_API_KEY',
      'CLOUDINARY_URL',
    ] as const
    required
      .filter((key) => !value[key])
      .forEach((key) =>
        context.addIssue({ code: 'custom', path: [key], message: 'Required in production' }),
      )
  })

export const env = schema.parse(process.env)
export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
export const isProduction = env.NODE_ENV === 'production'
