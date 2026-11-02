import express, { Router } from 'express'
import { badRequest } from '../../lib/errors.js'
import { readWebhookEvent } from '../../services/payments.js'
import { confirmCardPayment } from './orders.service.js'

export const webhookRouter = Router()

// Stripe signs the raw bytes, so this must run before the JSON body parser.
webhookRouter.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = readWebhookEvent(req.body as Buffer, String(req.headers['stripe-signature']))
  } catch {
    throw badRequest('Invalid signature')
  }

  if (event.type === 'payment_intent.succeeded') {
    await confirmCardPayment(event.data.object.id, event.data.object.amount_received)
  }
  res.json({ received: true })
})
