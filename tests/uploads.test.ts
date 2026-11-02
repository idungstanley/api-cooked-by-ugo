import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { UPLOADS_DIR } from '../src/modules/uploads/uploads.routes.js'
import { resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(async () => {
  await stopDb()
  await rm(UPLOADS_DIR, { recursive: true, force: true })
})
beforeEach(resetDb)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('image uploads', () => {
  it('stores an image and serves it back', async () => {
    const owner = await signIn('owner@test.com')
    const response = await owner
      .post('/api/uploads')
      .attach('file', PNG, { filename: 'dish.png', contentType: 'image/png' })

    expect(response.status).toBe(201)
    const path = new URL(response.body.url).pathname
    await owner.get(path).expect(200).expect('content-type', /png/)
  })

  it('rejects other file types and staff without menu access', async () => {
    const owner = await signIn('owner@test.com')
    await owner
      .post('/api/uploads')
      .attach('file', Buffer.from('<script>'), { filename: 'bad.html', contentType: 'text/html' })
      .expect(400)

    const kitchen = await signIn('kitchen@test.com')
    await kitchen
      .post('/api/uploads')
      .attach('file', PNG, { filename: 'dish.png', contentType: 'image/png' })
      .expect(403)
  })
})
