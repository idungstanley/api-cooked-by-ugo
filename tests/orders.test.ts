import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Dish } from '../src/modules/catalog/catalog.model.js'
import { Customer } from '../src/modules/customers/customers.model.js'
import { Deal } from '../src/modules/deals/deals.model.js'
import { Order } from '../src/modules/orders/orders.model.js'
import { ShopSettings } from '../src/modules/settings/settings.model.js'
import { app, jollof, orderBody, placeOrder, resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const post = (body: unknown) =>
  request(app)
    .post('/api/public/orders')
    .send(body as object)

describe('pricing', () => {
  it('works out prices itself and ignores anything else the client sends', async () => {
    const response = await post(
      orderBody({ total: 1, subtotal: 1, items: [{ ...jollof, unitPrice: 1 }] }),
    )

    expect(response.status).toBe(201)
    // Two at £12.99 plus £1.50 plantain, over the free delivery threshold.
    expect(response.body.order).toMatchObject({ subtotal: 2898, deliveryFee: 0, total: 2898 })
    expect(response.body.order.items[0]).toMatchObject({
      name: 'Party Jollof Rice',
      unitPrice: 1449,
      summary: 'Vegetarian · Fried Plantain · Naija hot',
    })
  })

  it('charges the zone fee below the free delivery threshold', async () => {
    const { order } = await placeOrder({
      items: [
        { ...jollof, quantity: 1 },
        { productId: 'zobo', quantity: 1 },
      ],
      postcode: 'NE3 1DA',
    })
    expect(order).toMatchObject({ subtotal: 1748, deliveryFee: 349, total: 2097 })
  })

  it('quotes the same totals before an order is placed', async () => {
    const response = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof], postcode: 'NE1 4ST' })
    expect(response.body).toEqual({ subtotal: 2898, deliveryFee: 0, total: 2898 })
  })

  it.each([
    ['a missing required option', { items: [{ ...jollof, selection: {} }] }, 'required'],
    [
      'too many sides',
      {
        items: [
          {
            ...jollof,
            selection: { ...jollof.selection, sides: ['moi-moi', 'coleslaw', 'extra-sauce'] },
          },
        ],
      },
      'too many',
    ],
    [
      'an invented option',
      { items: [{ ...jollof, selection: { ...jollof.selection, sides: ['free-lobster'] } }] },
      'no longer available',
    ],
    ['an unknown product', { items: [{ productId: 'nope', quantity: 1 }] }, 'no longer available'],
    ['a postcode outside the zones', { postcode: 'SW1A 1AA' }, 'do not deliver'],
    ['an inactive zone', { postcode: 'NE6 1AB' }, 'do not deliver'],
    [
      'an order below the minimum',
      { items: [{ productId: 'zobo', quantity: 1 }] },
      'minimum order',
    ],
  ])('rejects %s', async (_label, overrides, message) => {
    const response = await post(orderBody(overrides))
    expect(response.status).toBe(422)
    expect(response.body.message).toContain(message)
  })

  it('rejects sold-out dishes and deals that are not running', async () => {
    await Dish.updateOne({ _id: jollof.productId }, { soldOut: true })
    expect((await post(orderBody())).status).toBe(422)

    await Deal.updateOne({ _id: 'naija-family-box' }, { active: false })
    const deal = await post(orderBody({ items: [{ productId: 'naija-family-box', quantity: 1 }] }))
    expect(deal.status).toBe(422)
  })
})

describe('placing orders', () => {
  it('returns the same order when a request is repeated', async () => {
    const body = orderBody()
    const first = await post(body)
    const second = await post(body)

    expect(second.body.order.id).toBe(first.body.order.id)
    expect(await Order.countDocuments()).toBe(1)
  })

  it('gives orders placed at the same time different numbers', async () => {
    const orders = await Promise.all(Array.from({ length: 8 }, () => placeOrder()))
    expect(new Set(orders.map(({ order }) => order.number)).size).toBe(8)
  })

  it('stops orders when paused, closed or blocked', async () => {
    await ShopSettings.updateOne({}, { ordersPaused: true })
    expect((await post(orderBody())).status).toBe(422)
    await ShopSettings.updateOne({}, { ordersPaused: false })

    await ShopSettings.updateOne(
      {},
      {
        hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          open: false,
          opensAt: '12:00',
          closesAt: '21:00',
        })),
      },
    )
    expect((await post(orderBody())).body.message).toContain('closed')
    await resetDb()

    await placeOrder()
    await Customer.updateOne({}, { blocked: true })
    expect(
      (await post(orderBody({ delivery: { ...orderBody().delivery, phone: '+44 7700 900123' } })))
        .status,
    ).toBe(403)
  })

  it('enforces the pay-on-delivery limit', async () => {
    await ShopSettings.updateOne({}, { payOnDeliveryLimit: 1000 })
    const response = await post(orderBody())
    expect(response.body.message).toContain('must be paid by card')
  })

  it('reuses the customer record for a returning phone number', async () => {
    await placeOrder()
    await placeOrder({ delivery: { ...orderBody().delivery, phone: '+447700900123' } })
    expect(await Customer.countDocuments()).toBe(1)
  })
})

describe('tracking', () => {
  it('needs the private key, and hides personal details', async () => {
    const { order, trackingKey } = await placeOrder()

    await request(app).get(`/api/public/orders/${order.id}`).query({ key: 'wrong' }).expect(404)
    const response = await request(app)
      .get(`/api/public/orders/${order.id}`)
      .query({ key: trackingKey })
      .expect(200)

    expect(response.body.status).toBe('received')
    expect(response.body).not.toHaveProperty('address')
    expect(response.body).not.toHaveProperty('customerPhone')
    expect(JSON.stringify(response.body)).not.toContain(trackingKey)
  })

  it('never exposes the tracking key to staff lists', async () => {
    const { trackingKey } = await placeOrder()
    const owner = await signIn('owner@test.com')
    const response = await owner.get('/api/orders')
    expect(JSON.stringify(response.body)).not.toContain(trackingKey)
  })
})

describe('order lifecycle', () => {
  it('runs from new to delivered, recording who did what', async () => {
    const { order } = await placeOrder({ paymentMethod: 'card' })
    const kitchen = await signIn('kitchen@test.com')
    const rider = await signIn('rider@test.com')

    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }).expect(200)
    const noRider = await kitchen
      .patch(`/api/orders/${order.id}/status`)
      .send({ status: 'out-for-delivery' })
    expect(noRider.body.message).toContain('rider')

    await kitchen.patch(`/api/orders/${order.id}/rider`).send({ riderId: 'rider' }).expect(200)
    await kitchen
      .patch(`/api/orders/${order.id}/status`)
      .send({ status: 'out-for-delivery' })
      .expect(200)
    const done = await rider
      .patch(`/api/orders/${order.id}/status`)
      .send({ status: 'delivered' })
      .expect(200)

    expect(done.body.status).toBe('delivered')
    expect(done.body.events.map(({ actor }: { actor: string }) => actor)).toEqual([
      'Website',
      'Kitchen',
      'Kitchen',
      'Kitchen',
      'Rider',
    ])
  })

  it('rejects skipped or repeated steps', async () => {
    const { order } = await placeOrder()
    const kitchen = await signIn('kitchen@test.com')
    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'delivered' }).expect(409)
    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }).expect(200)
    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }).expect(409)
  })

  it('only lets one of two simultaneous updates win', async () => {
    const { order } = await placeOrder()
    const kitchen = await signIn('kitchen@test.com')
    const results = await Promise.all([
      kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }),
      kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }),
    ])
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409])
  })

  it('requires payment to be recorded before a pay-on-delivery order closes', async () => {
    const { order } = await placeOrder()
    const kitchen = await signIn('kitchen@test.com')
    const rider = await signIn('rider@test.com')

    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' })
    await kitchen.patch(`/api/orders/${order.id}/rider`).send({ riderId: 'rider' })
    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'out-for-delivery' })

    await rider.patch(`/api/orders/${order.id}/status`).send({ status: 'delivered' }).expect(422)
    const paid = await rider
      .post(`/api/orders/${order.id}/collection`)
      .send({ collectedBy: 'cash' })
      .expect(200)
    expect(paid.body).toMatchObject({
      status: 'delivered',
      paymentStatus: 'paid',
      collectedBy: 'cash',
    })
  })
})

describe('refunds and cancellation', () => {
  it('handles partial then full refunds, and never more than was paid', async () => {
    const { order } = await placeOrder({ paymentMethod: 'card' })
    const owner = await signIn('owner@test.com')

    const part = await owner
      .post(`/api/orders/${order.id}/refund`)
      .send({ amount: 898, reason: 'Wrong item' })
      .expect(200)
    expect(part.body).toMatchObject({ paymentStatus: 'partially-refunded', refundedAmount: 898 })

    await owner
      .post(`/api/orders/${order.id}/refund`)
      .send({ amount: 2001, reason: 'Too much' })
      .expect(422)
    const rest = await owner
      .post(`/api/orders/${order.id}/refund`)
      .send({ amount: 2000, reason: 'Rest' })
      .expect(200)
    expect(rest.body.paymentStatus).toBe('refunded')
  })

  it('cannot refund twice from two simultaneous requests', async () => {
    const { order } = await placeOrder({ paymentMethod: 'card' })
    const owner = await signIn('owner@test.com')
    await Promise.all([
      owner
        .post(`/api/orders/${order.id}/refund`)
        .send({ amount: order.total, reason: 'Double click' }),
      owner
        .post(`/api/orders/${order.id}/refund`)
        .send({ amount: order.total, reason: 'Double click' }),
    ])
    const saved = await Order.findById(order.id)
    expect(saved?.refundedAmount).toBe(order.total)
  })

  it('has nothing to refund on a pay-on-delivery order', async () => {
    const { order } = await placeOrder()
    const owner = await signIn('owner@test.com')
    await owner
      .post(`/api/orders/${order.id}/refund`)
      .send({ amount: 100, reason: 'No payment' })
      .expect(422)
  })

  it('refunds the card in full when an order is cancelled', async () => {
    const { order } = await placeOrder({ paymentMethod: 'card' })
    const owner = await signIn('owner@test.com')
    const response = await owner
      .post(`/api/orders/${order.id}/cancel`)
      .send({ reason: 'Out of stock' })
      .expect(200)
    expect(response.body).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refunded',
      refundedAmount: order.total,
    })
  })
})

describe('customer privacy', () => {
  it('removes personal details but keeps totals', async () => {
    const { order } = await placeOrder()
    const customer = await Customer.findOne()
    const owner = await signIn('owner@test.com')
    await owner.delete(`/api/customers/${customer?.id}/data`).expect(204)

    const saved = await Order.findById(order.id)
    expect(saved).toMatchObject({
      customerName: 'Deleted customer',
      customerPhone: '',
      address: '',
      postcode: '',
      total: order.total,
    })
  })
})
