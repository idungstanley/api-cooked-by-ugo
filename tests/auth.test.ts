import { authenticator } from 'otplib'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashToken } from '../src/modules/auth/auth.tokens.js'
import { Staff } from '../src/modules/staff/staff.model.js'
import { app, PASSWORD, placeOrder, resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

const login = (email: string, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password })

describe('sign-in', () => {
  it('uses an httpOnly session cookie and never returns password fields', async () => {
    const response = await login('owner@test.com').expect(200)

    expect(String(response.headers['set-cookie'])).toContain('HttpOnly')
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|twoFactorSecret|tokenVersion/)
  })

  it('gives the same message for a wrong password and an unknown email', async () => {
    const wrong = await login('owner@test.com', 'wrong-password').expect(401)
    const unknown = await login('nobody@test.com').expect(401)
    expect(wrong.body.message).toBe(unknown.body.message)
  })

  it('rejects anyone deactivated, including their existing session', async () => {
    const rider = await signIn('rider@test.com')
    const owner = await signIn('owner@test.com')
    await owner.patch('/api/staff/rider/active').send({ active: false }).expect(200)

    await rider.get('/api/auth/me').expect(401)
    await login('rider@test.com').expect(401)
  })

  it('requires a valid authenticator code when two-step is on', async () => {
    const owner = await signIn('owner@test.com')
    const { body: setup } = await owner.post('/api/auth/two-factor/setup').expect(200)
    await owner.post('/api/auth/two-factor/enable').send({ code: '000000' }).expect(400)
    await owner
      .post('/api/auth/two-factor/enable')
      .send({ code: authenticator.generate(setup.secret) })
      .expect(200)

    const first = await login('owner@test.com').expect(200)
    expect(first.body.requiresTwoFactor).toBe(true)
    expect(first.headers['set-cookie']).toBeUndefined()

    const verify = { challengeToken: first.body.challengeToken }
    await request(app)
      .post('/api/auth/verify-code')
      .send({ ...verify, code: '000000' })
      .expect(401)
    await request(app)
      .post('/api/auth/verify-code')
      .send({ ...verify, code: authenticator.generate(setup.secret) })
      .expect(200)
  })

  it('does not accept a two-step token as a session', async () => {
    await Staff.updateOne(
      { _id: 'owner' },
      { twoFactorEnabled: true, twoFactorSecret: authenticator.generateSecret() },
    )
    const { body } = await login('owner@test.com')
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', `cbu_session=${body.challengeToken}`)
      .expect(401)
  })
})

describe('password reset', () => {
  it('uses a single-use token and signs out old sessions', async () => {
    const session = await signIn('kitchen@test.com')
    await Staff.updateOne(
      { _id: 'kitchen' },
      {
        passwordResetHash: hashToken('reset-token'),
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    )
    const reset = { token: 'reset-token', password: 'a-brand-new-password' }

    await request(app).post('/api/auth/reset-password').send(reset).expect(204)
    await request(app).post('/api/auth/reset-password').send(reset).expect(400)
    await session.get('/api/auth/me').expect(401)
    await login('kitchen@test.com', reset.password).expect(200)
  })

  it('answers the same whether or not the account exists', async () => {
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'owner@test.com' })
      .expect(204)
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.com' })
      .expect(204)
  })
})

describe('permissions', () => {
  it('blocks signed-out requests', async () => {
    for (const path of [
      '/api/orders',
      '/api/customers',
      '/api/staff',
      '/api/catalog/dishes',
      '/api/content',
    ]) {
      await request(app).get(path).expect(401)
    }
  })

  it('limits the kitchen', async () => {
    const kitchen = await signIn('kitchen@test.com')
    await kitchen.get('/api/orders/active').expect(200)
    await kitchen.patch('/api/catalog/dishes/zobo/sold-out').send({ soldOut: true }).expect(200)

    await kitchen.get('/api/orders').expect(403)
    await kitchen.get('/api/customers').expect(403)
    await kitchen.get('/api/staff').expect(403)
    await kitchen.delete('/api/catalog/dishes/zobo').expect(403)
    await kitchen.patch('/api/settings/paused').send({ ordersPaused: true }).expect(403)
    const { order } = await placeOrder({ paymentMethod: 'card' })
    await kitchen
      .post(`/api/orders/${order.id}/refund`)
      .send({ amount: 100, reason: 'Nope' })
      .expect(403)
  })

  it('only shows riders their own deliveries', async () => {
    const { order } = await placeOrder()
    const kitchen = await signIn('kitchen@test.com')
    const rider = await signIn('rider@test.com')
    const otherRider = await signIn('rider2@test.com')

    await kitchen.patch(`/api/orders/${order.id}/rider`).send({ riderId: 'rider' })

    expect((await rider.get('/api/orders/active')).body).toHaveLength(1)
    expect((await otherRider.get('/api/orders/active')).body).toHaveLength(0)
    await otherRider.get(`/api/orders/${order.id}`).expect(404)
    await otherRider
      .post(`/api/orders/${order.id}/collection`)
      .send({ collectedBy: 'cash' })
      .expect(404)
    await rider.patch(`/api/orders/${order.id}/status`).send({ status: 'preparing' }).expect(403)
    await rider.get('/api/customers').expect(403)
  })
})

describe('staff rules', () => {
  it('always keeps one active owner, and blocks deactivating yourself', async () => {
    const owner = await signIn('owner@test.com')
    await owner.patch('/api/staff/owner/active').send({ active: false }).expect(400)
    await owner
      .put('/api/staff/owner')
      .send({ name: 'Owner', email: 'owner@test.com', role: 'kitchen' })
      .expect(409)
  })

  it('rejects duplicate emails, and removes access when a role changes', async () => {
    const owner = await signIn('owner@test.com')
    await owner
      .post('/api/staff')
      .send({ name: 'Copy', email: 'KITCHEN@test.com', role: 'rider' })
      .expect(409)

    const kitchen = await signIn('kitchen@test.com')
    await owner
      .put('/api/staff/kitchen')
      .send({ name: 'Kitchen', email: 'kitchen@test.com', role: 'rider' })
      .expect(200)
    await kitchen.get('/api/auth/me').expect(401)
  })
})
