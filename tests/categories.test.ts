import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Category } from '../src/modules/catalog/catalog.model.js'
import request from 'supertest'
import { app, resetDb, signIn, startDb, stopDb } from './helpers.js'

beforeAll(startDb)
afterAll(stopDb)
beforeEach(resetDb)

describe('menu categories', () => {
  it('lets the owner add a category at the end of the menu', async () => {
    const owner = await signIn('owner@test.com')
    const response = await owner.post('/api/catalog/categories').send({ name: 'Small Chops' })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      id: 'small-chops',
      name: 'Small Chops',
      shortName: 'Small Chops',
      accent: 'jollof',
    })
    const last = await Category.findOne().sort({ sortOrder: -1 })
    expect(last?.id).toBe('small-chops')

    const again = await owner.post('/api/catalog/categories').send({ name: 'Small chops' })
    expect(again.body.id).toBe('small-chops-2')
  })

  it('renames, reorders and deletes an empty category', async () => {
    const owner = await signIn('owner@test.com')
    const { body } = await owner.post('/api/catalog/categories').send({ name: 'Soups' })

    const renamed = await owner.put(`/api/catalog/categories/${body.id}`).send({
      name: 'Soups and Swallow',
      shortName: 'Soups',
      accent: 'ewedu',
      notes: 'Weekends only',
    })
    expect(renamed.body).toMatchObject({
      name: 'Soups and Swallow',
      shortName: 'Soups',
      notes: 'Weekends only',
    })
    const shown = await request(app).get('/api/public/categories')
    const soups = shown.body.find(({ id }: { id: string }) => id === body.id)
    expect(soups.name).toBe('Soups and Swallow')
    expect(soups).not.toHaveProperty('notes')

    const before = (await Category.findById(body.id))!.sortOrder
    await owner.post(`/api/catalog/categories/${body.id}/move`).send({ direction: -1 }).expect(204)
    expect((await Category.findById(body.id))!.sortOrder).toBeLessThan(before)

    await owner.delete(`/api/catalog/categories/${body.id}`).expect(204)
    expect(await Category.findById(body.id)).toBeNull()
  })

  it('keeps a category that still has dishes', async () => {
    const owner = await signIn('owner@test.com')
    const response = await owner.delete('/api/catalog/categories/drinks')
    expect(response.status).toBe(409)
    expect(await Category.findById('drinks')).not.toBeNull()
  })

  it('does not let the kitchen change categories', async () => {
    const kitchen = await signIn('kitchen@test.com')
    await kitchen.post('/api/catalog/categories').send({ name: 'Secret menu' }).expect(403)
  })
})
