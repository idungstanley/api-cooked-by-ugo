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
      basePrice: 1299,
      unitPrice: 1449,
      summary: 'Vegetarian · Fried Plantain · Naija hot',
      options: [
        { groupTitle: 'Choose your protein', label: 'Vegetarian', price: 0 },
        { groupTitle: 'Add a side', label: 'Fried Plantain', price: 150 },
        { groupTitle: 'Spice level', label: 'Naija hot', price: 0 },
      ],
    })
  })

  it("keeps the customer's note on each dish", async () => {
    const { order } = await placeOrder({ items: [{ ...jollof, note: 'Not too spicy please' }] })
    expect((order as unknown as { items: { note: string }[] }).items[0]?.note).toBe(
      'Not too spicy please',
    )
  })

  it('accepts phone numbers from other countries', async () => {
    const response = await post(
      orderBody({ delivery: { ...orderBody().delivery, phone: '+234 803 123 4567' } }),
    )
    expect(response.status).toBe(201)
    expect(response.body.order.customerPhone).toBe('+234 803 123 4567')
  })

  it('charges the fee for the delivery ring the postcode falls in', async () => {
    const { order } = await placeOrder({
      items: [
        { ...jollof, quantity: 1 },
        { productId: 'zobo', quantity: 1 },
      ],
      postcode: 'NE3 1DA',
    })
    // Four miles out is the middle ring.
    expect(order).toMatchObject({ subtotal: 1748, deliveryFee: 399, total: 2147 })
  })

  it('quotes the same totals before an order is placed, with or without a postcode', async () => {
    const withPostcode = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof], postcode: 'NE1 4ST' })
    expect(withPostcode.body).toMatchObject({
      subtotal: 2898,
      discount: 0,
      deliveryFee: 0,
      total: 2898,
    })

    const basketOnly = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof] })
    expect(basketOnly.body).toMatchObject({ subtotal: 2898, total: 2898, delivery: null })
  })

  it('checks a postcode and says whether it is covered', async () => {
    const near = await request(app).get('/api/public/postcodes/NE3 1DA').expect(200)
    expect(near.body).toMatchObject({ covered: true, fee: 399, distanceMiles: 4, addresses: [] })

    const far = await request(app).get('/api/public/postcodes/SW1A1AA').expect(200)
    expect(far.body.covered).toBe(false)
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
    ['a postcode outside the delivery radius', { postcode: 'SW1A 1AA' }, 'deliver up to 10 miles'],
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
      (await post(orderBody({ delivery: { ...orderBody().delivery, phone: '+44 7400 123456' } })))
        .status,
    ).toBe(403)
  })

  it('reuses the customer record for a returning phone number', async () => {
    await placeOrder()
    await placeOrder({ delivery: { ...orderBody().delivery, phone: '+447400123456' } })
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

  it('requires payment to be recorded before an older pay-on-delivery order closes', async () => {
    const { order } = await placeOrder()
    await Order.updateOne({ _id: order.id }, { paymentMethod: 'on-delivery', paymentStatus: 'due' })
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

  it('has nothing to refund on an older pay-on-delivery order', async () => {
    const { order } = await placeOrder()
    await Order.updateOne({ _id: order.id }, { paymentMethod: 'on-delivery', paymentStatus: 'due' })
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

describe('delivery radius', () => {
  it('turns away postcodes in a ring that has been switched off', async () => {
    await ShopSettings.updateOne(
      { 'deliveryRadii.maxMiles': 10 },
      { $set: { 'deliveryRadii.$.active': false } },
    )
    const response = await post(orderBody({ postcode: 'NE13 6AA' }))
    expect(response.status).toBe(422)
    expect(response.body.message).toContain('deliver up to 6 miles')
  })
})

describe('timing', () => {
  it('sets the arrival time from preparation plus delivery time', async () => {
    await ShopSettings.updateOne({}, { prepMinutes: 60, deliveryMinutes: 25 })
    const { order } = await placeOrder()
    expect(order).toMatchObject({ etaMinutes: 85, deliveryMinutes: 25 })

    const slots = await request(app).get('/api/public/slots').expect(200)
    const earliest = (slots.body as { at: number }[])[0]?.at ?? Infinity
    expect(earliest - Date.now()).toBeGreaterThanOrEqual(85 * 60_000 - 60_000)
  })
})

describe('existing shops', () => {
  it('fills in the new delivery settings for a shop saved before they existed', async () => {
    await ShopSettings.collection.updateOne(
      {},
      { $unset: { kitchen: 1, deliveryRadii: 1, prepMinutes: 1, deliveryMinutes: 1 } },
    )
    const response = await request(app)
      .post('/api/public/quote')
      .send({ items: [jollof], postcode: 'NE3 1DA' })
      .expect(200)
    expect(response.body.delivery).toMatchObject({ covered: true, fee: 399 })

    const site = await request(app).get('/api/public/site').expect(200)
    expect(site.body.leadMinutes).toBe(50)
  })
})
