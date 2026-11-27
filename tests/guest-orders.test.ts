import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Order } from '../src/modules/orders/orders.model.js'
import { ShopSettings } from '../src/modules/settings/settings.model.js'
import { app, jollof, orderBody, placeOrder, resetDb, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const markPaid = (orderId: string) => Order.updateOne({ _id: orderId }, { status: 'received' })

const signUp = async () => {
  const response = await request(app)
    .post('/api/account/signup')
    .send({
      name: 'Ada Obi',
      email: 'Customer@Example.com',
      password: 'jollof-rice-1',
      phone: '07400 123456',
      address: { line1: '1 Test Street', city: 'Newcastle upon Tyne', postcode: 'NE1 4ST' },
    })
    .expect(201)
  return response.body as { token: string; account: { id: string } }
}

const myOrders = (token: string) =>
  request(app).get('/api/account/orders').set('Authorization', `Bearer ${token}`)

describe('guest orders and accounts', () => {
  it('shows earlier guest orders when both the email and phone match', async () => {
    const { order } = await placeOrder()
    await markPaid(order.id)
    // Same email but a different phone: someone else's order stays hidden.
    const { order: stranger } = await placeOrder({
      delivery: { ...orderBody().delivery, phone: '07400 654321' },
    })
    await markPaid(stranger.id)

    const { token } = await signUp()
    const orders = (await myOrders(token)).body as { id: string }[]
    expect(orders.map(({ id }) => id)).toEqual([order.id])
  })
})

describe('accounts required', () => {
  it('asks guests to sign in before ordering, and lets account holders order', async () => {
    await ShopSettings.updateOne({}, { accountRequired: true })
    const guest = await request(app).post('/api/public/orders').send(orderBody())
    expect(guest.status).toBe(401)
    expect(guest.body.message).toMatch(/sign in or create an account/)

    const { token } = await signUp()
    await request(app)
      .post('/api/public/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(orderBody())
      .expect(201)
  })
})

describe('free delivery', () => {
  it('charges the delivery fee when free delivery is switched off', async () => {
    await ShopSettings.updateOne({}, { freeDeliveryThreshold: null })
    const quote = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof], postcode: 'NE3 1DA' })
      .expect(200)
    expect(quote.body.deliveryFee).toBe(399)
  })
})

describe('address lookup', () => {
  it('checks any UK postcode, even outside the delivery area', async () => {
    const far = await request(app).get('/api/public/addresses/SW1A1AA').expect(200)
    // Without an Ideal Postcodes key the list is empty and the customer types the street.
    expect(far.body).toMatchObject({ postcode: 'SW1A 1AA', city: 'Westminster', addresses: [] })
  })
})
