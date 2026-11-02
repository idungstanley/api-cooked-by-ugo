import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real signature checks with no network calls: only signed test payloads are sent.
vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_placeholder')
vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_placeholder')

const { default: Stripe } = await import('stripe')
const { default: request } = await import('supertest')
const { Order } = await import('../src/modules/orders/orders.model.js')
const { app, resetDb, startDb, stopDb } = await import('./helpers.js')

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const stripe = new Stripe('sk_test_placeholder')

const pendingOrder = () =>
  Order.create({
    _id: 'order-1',
    number: 'UGO-1',
    customerId: 'customer-1',
    customerName: 'Test Customer',
    customerEmail: 'customer@example.com',
    subtotal: 2000,
    deliveryFee: 0,
    total: 2000,
    paymentMethod: 'card',
    paymentStatus: 'pending',
    etaMinutes: 40,
    status: 'pending-payment',
    trackingKey: 'key',
    stripePaymentIntentId: 'pi_123',
  })

const sendEvent = (amount: number, secret = 'whsec_test_placeholder') => {
  const payload = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_123', amount_received: amount } },
  })
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })
  return request(app)
    .post('/api/webhooks/stripe')
    .set('stripe-signature', signature)
    .set('content-type', 'application/json')
    .send(payload)
}

describe('Stripe webhook', () => {
  it('confirms the order, and is safe to receive twice', async () => {
    await pendingOrder()
    await sendEvent(2000).expect(200)
    await sendEvent(2000).expect(200)

    const order = await Order.findById('order-1')
    expect(order).toMatchObject({ status: 'received', paymentStatus: 'paid' })
    expect(order?.events.filter(({ message }) => message.includes('confirmed'))).toHaveLength(1)
  })

  it('rejects a forged signature', async () => {
    await pendingOrder()
    await sendEvent(2000, 'whsec_wrong').expect(400)
    expect((await Order.findById('order-1'))?.status).toBe('pending-payment')
  })

  it('does not confirm a payment for the wrong amount', async () => {
    await pendingOrder()
    await sendEvent(1).expect(200)
    expect((await Order.findById('order-1'))?.status).toBe('pending-payment')
  })
})
