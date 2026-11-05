import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Offer } from '../src/modules/offers/offers.model.js'
import { Order } from '../src/modules/orders/orders.model.js'
import { app, jollof, orderBody, placeOrder, resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const signUp = async (email = 'ada@example.com') => {
  const response = await request(app)
    .post('/api/account/signup')
    .send({ name: 'Ada Obi', email, password: 'jollof-rice-1' })
    .expect(201)
  return response.body as { token: string; account: { id: string } }
}

const deliver = (orderId: string) => Order.updateOne({ _id: orderId }, { status: 'delivered' })

describe('customer accounts', () => {
  it('signs up, signs in, and keeps the password private', async () => {
    const { token, account } = await signUp()
    expect(JSON.stringify(account)).not.toContain('passwordHash')

    await request(app)
      .post('/api/account/signup')
      .send({
        name: 'Someone',
        email: 'ADA@example.com',
        password: 'another-password',
      })
      .expect(409)

    await request(app)
      .post('/api/account/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' })
      .expect(401)
    const login = await request(app)
      .post('/api/account/login')
      .send({ email: 'Ada@Example.com', password: 'jollof-rice-1' })
      .expect(200)
    expect(login.body.account.id).toBe(account.id)

    await request(app).get('/api/account/me').set('authorization', `Bearer ${token}`).expect(200)
  })

  it('links orders to the signed-in account, and only shows the owner', async () => {
    const ada = await signUp()
    const ben = await signUp('ben@example.com')

    await request(app)
      .post('/api/public/orders')
      .set('authorization', `Bearer ${ada.token}`)
      .send(orderBody())
      .expect(201)
    await placeOrder()

    const adaOrders = await request(app)
      .get('/api/account/orders')
      .set('authorization', `Bearer ${ada.token}`)
      .expect(200)
    expect(adaOrders.body).toHaveLength(1)
    expect(adaOrders.body[0]).toHaveProperty('trackingKey')

    const benOrders = await request(app)
      .get('/api/account/orders')
      .set('authorization', `Bearer ${ben.token}`)
      .expect(200)
    expect(benOrders.body).toHaveLength(0)
  })

  it('signs out everywhere, and a staff token cannot act as a customer', async () => {
    const { token } = await signUp()
    await request(app)
      .post('/api/account/logout')
      .set('authorization', `Bearer ${token}`)
      .expect(204)
    await request(app).get('/api/account/me').set('authorization', `Bearer ${token}`).expect(401)

    const staff = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.com', password: 'correct-horse-battery' })
    await request(app)
      .get('/api/account/me')
      .set('authorization', `Bearer ${staff.body.token}`)
      .expect(401)
  })
})

describe('reviews', () => {
  it('only accepts one review per delivered order, from someone with the order key', async () => {
    const { order, trackingKey } = await placeOrder()
    const review = (key: string) =>
      request(app)
        .post(`/api/public/orders/${order.id}/review`)
        .query({ key })
        .send({ rating: 5, comment: 'Best jollof in Newcastle', likedItems: ['Party Jollof Rice'] })

    await review(trackingKey).expect(422)
    await deliver(order.id)
    await review('wrong').expect(404)
    await review(trackingKey).expect(201)
    await review(trackingKey).expect(409)

    const site = await request(app).get('/api/public/reviews').expect(200)
    expect(site.body.summary).toMatchObject({ average: 5, count: 1 })
    expect(site.body.reviews[0]).toMatchObject({ displayName: 'Test C', rating: 5 })
    expect(JSON.stringify(site.body)).not.toContain('customer@example.com')
  })

  it('lets staff reply and hide reviews', async () => {
    const { order, trackingKey } = await placeOrder()
    await deliver(order.id)
    await request(app)
      .post(`/api/public/orders/${order.id}/review`)
      .query({ key: trackingKey })
      .send({ rating: 2, comment: 'Arrived cold' })
      .expect(201)

    const owner = await signIn('owner@test.com')
    const list = await owner.get('/api/reviews').expect(200)
    const reviewId = list.body.reviews[0].id as string
    await owner
      .patch(`/api/reviews/${reviewId}/reply`)
      .send({ reply: 'Sorry, next one is on us' })
      .expect(200)
    await owner.patch(`/api/reviews/${reviewId}/hidden`).send({ hidden: true }).expect(200)

    const site = await request(app).get('/api/public/reviews').expect(200)
    expect(site.body.summary.count).toBe(0)

    const rider = await signIn('rider@test.com')
    await rider.get('/api/reviews').expect(403)
  })
})

describe('offers', () => {
  const createOffer = async (offer: Record<string, unknown>) => {
    const owner = await signIn('owner@test.com')
    return owner.post('/api/offers').send({ name: 'Test offer', ...offer })
  }

  it('gives every second jollof free on buy one get one free', async () => {
    await createOffer({ type: 'bogo', dishIds: ['party-jollof-rice'] }).then(({ status }) =>
      expect(status).toBe(201),
    )
    const { order } = await placeOrder()
    // Two jollof at £14.49 each, so one is free.
    expect(order).toMatchObject({ subtotal: 2898, total: 1449 + 299 })
  })

  it('applies the single biggest saving rather than stacking offers', async () => {
    await createOffer({ type: 'percent', value: 10 })
    await createOffer({ type: 'amount', value: 500 })
    const response = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof] })
    expect(response.body).toMatchObject({ subtotal: 2898, discount: 500 })
    expect(response.body.appliedOffers).toHaveLength(1)
  })

  it('ignores offers that have not started, have ended, or need a bigger order', async () => {
    const now = Date.now()
    await createOffer({ type: 'percent', value: 50, startsAt: now + 86_400_000 })
    await createOffer({
      type: 'percent',
      value: 50,
      endsAt: now - 1000,
      startsAt: now - 86_400_000,
    })
    await createOffer({ type: 'percent', value: 50, minSubtotal: 10_000 })
    await createOffer({ type: 'free-delivery' })

    const response = await request(app)
      .post('/api/public/quote')
      .send({ items: [{ ...jollof, quantity: 1 }], postcode: 'NE1 4ST' })
    expect(response.body).toMatchObject({ discount: 0, deliveryFee: 0 })

    const live = await request(app).get('/api/public/offers').expect(200)
    // The minimum spend offer is still live, it just needs a bigger basket.
    expect(live.body.map(({ label }: { label: string }) => label).sort()).toEqual([
      '50% off',
      'Free delivery',
    ])
  })

  it('checks offers make sense, and only staff with deal access can manage them', async () => {
    expect((await createOffer({ type: 'bogo' })).status).toBe(400)
    expect((await createOffer({ type: 'percent', value: 150 })).status).toBe(400)
    const kitchen = await signIn('kitchen@test.com')
    await kitchen
      .post('/api/offers')
      .send({ name: 'Sneaky', type: 'percent', value: 90 })
      .expect(403)
    expect(await Offer.countDocuments()).toBe(0)
  })
})

describe('menu editing', () => {
  it('creates a dish with only a name, category and price', async () => {
    const owner = await signIn('owner@test.com')
    const response = await owner
      .post('/api/catalog/dishes')
      .send({ name: 'Rice and Beans', categoryId: 'rice-swallow', price: 1099 })
      .expect(201)
    expect(response.body).toMatchObject({ name: 'Rice and Beans', description: '', image: '' })
    expect(response.body).not.toHaveProperty('kcal')
  })
})
