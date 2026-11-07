import express, { Router } from 'express'
import { badRequest } from '../../lib/errors.js'
import { readWebhookEvent } from '../../services/payments.js'
import { confirmAmendmentPayment } from './amendments.js'
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
    const { id, amount_received: amount } = event.data.object
    // Each only acts on its own payments: a new order, or a top-up for replacement items.
    await confirmCardPayment(id, amount)
    await confirmAmendmentPayment(id, amount)
  }
  res.json({ received: true })
})
