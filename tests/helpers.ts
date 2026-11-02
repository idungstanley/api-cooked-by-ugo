import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { hashPassword } from '../src/modules/auth/auth.routes.js'
import { Staff } from '../src/modules/staff/staff.model.js'
import { ShopSettings } from '../src/modules/settings/settings.model.js'
import { seedCatalog } from '../src/seed/run.js'

export const PASSWORD = 'correct-horse-battery'

export const app = createApp()

let server: MongoMemoryServer

export const startDb = async () => {
  server = await MongoMemoryServer.create()
  await mongoose.connect(server.getUri())
}

export const stopDb = async () => {
  await mongoose.disconnect()
  await server.stop()
}

/** A clean database for each test, open all day so results do not depend on the clock. */
export const resetDb = async () => {
  await mongoose.connection.dropDatabase()
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()))
  await seedCatalog()
  await ShopSettings.updateOne(
    {},
    {
      hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: true,
        opensAt: '00:00',
        closesAt: '23:59',
      })),
    },
  )
  const passwordHash = await hashPassword(PASSWORD)
  await Staff.create([
    { _id: 'owner', name: 'Owner', email: 'owner@test.com', role: 'owner', passwordHash },
    { _id: 'kitchen', name: 'Kitchen', email: 'kitchen@test.com', role: 'kitchen', passwordHash },
    { _id: 'rider', name: 'Rider', email: 'rider@test.com', role: 'rider', passwordHash },
    { _id: 'rider2', name: 'Rider Two', email: 'rider2@test.com', role: 'rider', passwordHash },
  ])
}

export const signIn = async (email: string) => {
  const agent = request.agent(app)
  await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)
  return agent
}

export const jollof = {
  productId: 'party-jollof-rice',
  quantity: 2,
  selection: { protein: ['vegetarian'], sides: ['fried-plantain'], spice: ['naija-hot'] },
}

let orderCount = 0

export const orderBody = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: `test-order-${(orderCount += 1)}`,
  items: [jollof],
  postcode: 'NE1 4ST',
  paymentMethod: 'on-delivery',
  delivery: {
    fullName: 'Test Customer',
    email: 'customer@example.com',
    phone: '07700 900123',
    address: '1 Test Street',
    city: 'Newcastle upon Tyne',
  },
  ...overrides,
})

export const placeOrder = async (overrides: Record<string, unknown> = {}) => {
  const response = await request(app).post('/api/public/orders').send(orderBody(overrides))
  if (response.status !== 201) throw new Error(`Order failed: ${JSON.stringify(response.body)}`)
  return response.body as {
    order: { id: string; number: string; total: number }
    trackingKey: string
  }
}
