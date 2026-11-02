import Stripe from 'stripe'
import { env } from '../config/env.js'

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null

/** Off in local development and tests. `env.ts` makes Stripe mandatory in production. */
export const paymentsEnabled = Boolean(stripe)

export const createPaymentIntent = async (
  orderId: string,
  amount: number,
  idempotencyKey: string,
) => {
  if (!stripe) throw new Error('Stripe is not configured')
  return stripe.paymentIntents.create(
    {
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata: { orderId },
    },
    { idempotencyKey },
  )
}

export const refundPayment = async (
  paymentIntentId: string | undefined,
  amount: number,
  idempotencyKey: string,
) => {
  if (!stripe) return
  if (!paymentIntentId) throw new Error('This order has no card payment')
  await stripe.refunds.create({ payment_intent: paymentIntentId, amount }, { idempotencyKey })
}

export const cancelPaymentIntent = async (paymentIntentId: string) => {
  await stripe?.paymentIntents.cancel(paymentIntentId)
}

export const readWebhookEvent = (payload: Buffer, signature: string) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe is not configured')
  return stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
}
