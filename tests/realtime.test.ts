import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { io as connect } from 'socket.io-client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { startRealtime } from '../src/services/realtime.js'
import { app, PASSWORD, placeOrder, resetDb, startDb, stopDb } from './helpers.js'

let server: Server
let url: string

beforeAll(async () => {
  await startDb()
  server = createServer(app)
  startRealtime(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  url = `http://localhost:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await stopDb()
})
beforeEach(resetDb)

const tokenFor = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).body
    .token as string

describe('live order updates', () => {
  it('reach the kitchen when signed in with a token', async () => {
    const socket = connect(url, {
      auth: { token: await tokenFor('kitchen@test.com') },
      transports: ['websocket'],
    })
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()))

    const received = new Promise<{ id: string }>((resolve) => socket.on('orders:changed', resolve))
    const { order } = await placeOrder()
    expect((await received).id).toBe(order.id)
    socket.disconnect()
  })

  it('refuses connections without a valid session', async () => {
    const socket = connect(url, { auth: { token: 'nope' }, transports: ['websocket'] })
    const error = await new Promise<Error>((resolve) => socket.on('connect_error', resolve))
    expect(error.message).toBe('Please sign in')
    socket.disconnect()
  })
})
