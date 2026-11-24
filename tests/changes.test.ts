import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Dish } from '../src/modules/catalog/catalog.model.js'
import { app, jollof, placeOrder, resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const zobo = { productId: 'zobo', quantity: 1, selection: {} }

/** Two jollof (£28.98) and a zobo (£2.99), with free delivery. */
const placeTwoLineOrder = () => placeOrder({ items: [jollof, zobo] })

const askAboutJollof = async (orderId: string) => {
  const kitchen = await signIn('kitchen@test.com')
  return kitchen
    .post(`/api/orders/${orderId}/changes`)
    .send({ itemIds: ['line-1'], message: 'Sorry, the jollof pot is finished.' })
}

const respond = (orderId: string, key: string, body: object) =>
  request(app).post(`/api/public/orders/${orderId}/changes`).query({ key }).send(body)

const track = (orderId: string, key: string) =>
  request(app).get(`/api/public/orders/${orderId}`).query({ key })

describe('out of stock items', () => {
  it('puts the order on hold, marks the dish sold out and shows the customer', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    const response = await askAboutJollof(order.id)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'awaiting-customer',
      amendment: { state: 'waiting', unavailableItemIds: ['line-1'] },
    })
    expect((await Dish.findById('party-jollof-rice'))?.soldOut).toBe(true)

    const tracked = await track(order.id, trackingKey)
    expect(tracked.body.amendment).toMatchObject({
      state: 'waiting',
      unavailableItemIds: ['line-1'],
      message: 'Sorry, the jollof pot is finished.',
      // Two jollof at £14.49 and a £2.99 zobo, with free delivery: removing the jollof refunds £28.98.
      removalRefund: 2898,
    })

    // The kitchen cannot start cooking until the customer has answered.
    const kitchen = await signIn('kitchen@test.com')
    await kitchen.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }).expect(409)
  })

  it('removes the item and lowers the total, keeping the delivery fee as charged', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    await askAboutJollof(order.id)

    const response = await respond(order.id, trackingKey, { action: 'remove' }).expect(200)
    expect(response.body).toMatchObject({ status: 'received', total: 299 })

    const tracked = await track(order.id, trackingKey)
    expect(tracked.body.items.map(({ name }: { name: string }) => name)).toEqual([
      'Zobo (Hibiscus)',
    ])
    expect(tracked.body).toMatchObject({ subtotal: 299, deliveryFee: 0, total: 299 })
    expect(tracked.body.amendment).toMatchObject({ state: 'resolved', resolution: 'removed' })
  })

  it('swaps in replacements on the same order, without a second delivery fee', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    await askAboutJollof(order.id)

    await respond(order.id, trackingKey, {
      action: 'replace',
      items: [{ productId: 'zobo', quantity: 3, selection: {} }],
    }).expect(200)

    const tracked = await track(order.id, trackingKey)
    expect(tracked.body.items).toHaveLength(2)
    expect(tracked.body.items[1]).toMatchObject({
      id: 'line-3',
      name: 'Zobo (Hibiscus)',
      quantity: 3,
    })
    expect(tracked.body).toMatchObject({ subtotal: 1196, deliveryFee: 0, total: 1196 })
  })

  it('takes off just a flagged side, keeping the dish', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    const kitchen = await signIn('kitchen@test.com')
    // Line 1 is jollof with Vegetarian, Fried Plantain (+£1.50) and Naija hot: flag the plantain.
    await kitchen
      .post(`/api/orders/${order.id}/changes`)
      .send({ itemIds: ['line-1#1'] })
      .expect(200)

    const tracked = await track(order.id, trackingKey)
    expect(tracked.body.amendment.removalRefund).toBe(300)
    await respond(order.id, trackingKey, { action: 'remove' }).expect(200)

    const updated = await track(order.id, trackingKey)
    expect(updated.body.items[0]).toMatchObject({
      name: 'Party Jollof Rice',
      unitPrice: 1299,
      summary: 'Vegetarian · Naija hot',
    })
    expect(updated.body.total).toBe(order.total - 300)
  })

  it('lets the customer cancel instead, with everything refunded', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    await askAboutJollof(order.id)

    await respond(order.id, trackingKey, { action: 'cancel' }).expect(200)
    const owner = await signIn('owner@test.com')
    const saved = await owner.get(`/api/orders/${order.id}`).expect(200)
    expect(saved.body).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'refunded',
      amendment: { state: 'resolved', resolution: 'cancelled' },
    })
  })

  it('cancels the order when every item is removed', async () => {
    const { order, trackingKey } = await placeOrder()
    await askAboutJollof(order.id)
    const response = await respond(order.id, trackingKey, { action: 'remove' }).expect(200)
    expect(response.body.status).toBe('cancelled')
  })

  it('needs the order key, an open request and items that are on the order', async () => {
    const { order, trackingKey } = await placeTwoLineOrder()
    await respond(order.id, trackingKey, { action: 'remove' }).expect(409)

    const kitchen = await signIn('kitchen@test.com')
    await kitchen
      .post(`/api/orders/${order.id}/changes`)
      .send({ itemIds: ['line-9'] })
      .expect(422)

    const rider = await signIn('rider@test.com')
    await rider
      .post(`/api/orders/${order.id}/changes`)
      .send({ itemIds: ['line-1'] })
      .expect(403)

    await askAboutJollof(order.id)
    await respond(order.id, 'wrong-key', { action: 'remove' }).expect(404)
    await respond(order.id, trackingKey, { action: 'remove' }).expect(200)
    await respond(order.id, trackingKey, { action: 'remove' }).expect(409)
  })
})
