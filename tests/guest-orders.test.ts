import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashToken } from '../src/modules/auth/auth.tokens.js'
import { Account } from '../src/modules/accounts/accounts.model.js'
import { Order } from '../src/modules/orders/orders.model.js'
import { ShopSettings } from '../src/modules/settings/settings.model.js'
import { app, jollof, placeOrder, resetDb, startDb, stopDb } from './helpers.js'

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
  it('shows guest orders with the same email only after the email is confirmed', async () => {
    const { order } = await placeOrder()
    await markPaid(order.id)
    const { token, account } = await signUp()

    // Anyone could sign up with someone else's email, so nothing shows until it is confirmed.
    expect((await myOrders(token)).body).toHaveLength(0)

    await Account.updateOne(
      { _id: account.id },
      { verifyTokenHash: hashToken('confirm-token-123') },
    )
    const verified = await request(app)
      .post('/api/account/verify-email')
      .send({ token: 'confirm-token-123' })
      .expect(200)
    expect(verified.body.emailVerifiedAt).toBeTruthy()

    const orders = (await myOrders(token)).body as { id: string }[]
    expect(orders.map(({ id }) => id)).toEqual([order.id])

    // Guest orders placed later, while signed out, are picked up too.
    const { order: later } = await placeOrder()
    await markPaid(later.id)
    expect((await myOrders(token)).body).toHaveLength(2)
  })

  it('rejects an unknown confirmation link', async () => {
    await request(app)
      .post('/api/account/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(401)
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
