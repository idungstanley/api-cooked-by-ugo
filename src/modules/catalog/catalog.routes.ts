import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Category, Dish, OptionGroup } from './catalog.model.js'

const dishInput = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2),
  description: z.string().trim().min(5),
  price: z.number().int().positive(),
  kcal: z.number().int().min(0),
  image: z.string().min(1),
  badges: z.array(z.enum(['Popular', 'Spicy'])),
  allergens: z.array(z.string()),
  optionGroupIds: z.array(z.string()),
})

const optionGroupInput = z.object({
  title: z.string().trim().min(2),
  required: z.boolean(),
  maxChoices: z.number().int().min(1),
  choices: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().trim().min(1),
        priceDelta: z.number().int().min(0),
      }),
    )
    .min(1),
  dishIds: z.array(z.string()),
})

const syncGroupDishes = async (groupId: string, dishIds: string[]) => {
  await Dish.updateMany(
    { optionGroupIds: groupId, _id: { $nin: dishIds } },
    { $pull: { optionGroupIds: groupId } },
  )
  await Dish.updateMany({ _id: { $in: dishIds } }, { $addToSet: { optionGroupIds: groupId } })
}

export const catalogRouter = Router()
catalogRouter.use(requireAuth)

catalogRouter.get('/categories', requirePermission('menu'), async (_req, res) => {
  res.json(await Category.find().sort({ sortOrder: 1 }))
})

catalogRouter.get('/dishes', requirePermission('menu'), async (_req, res) => {
  res.json(await Dish.find().sort({ sortOrder: 1 }))
})

catalogRouter.get('/option-groups', requirePermission('menu'), async (_req, res) => {
  res.json(await OptionGroup.find().sort({ createdAt: 1 }))
})

catalogRouter.post('/dishes', requirePermission('menu.edit'), async (req, res) => {
  const input = parse(dishInput, req.body)
  const last = await Dish.findOne({ categoryId: input.categoryId }).sort({ sortOrder: -1 })
  const dish = await Dish.create({
    ...input,
    _id: createId('dish'),
    shortDescription: input.description,
    sortOrder: (last?.sortOrder ?? 0) + 1,
  })
  res.status(201).json(dish)
})

catalogRouter.put('/dishes/:id', requirePermission('menu.edit'), async (req, res) => {
  const input = parse(dishInput, req.body)
  const dish = await Dish.findByIdAndUpdate(
    req.params.id,
    { ...input, shortDescription: input.description },
    { returnDocument: 'after', runValidators: true },
  )
  if (!dish) throw notFound('Dish')
  res.json(dish)
})

catalogRouter.delete('/dishes/:id', requirePermission('menu.edit'), async (req, res) => {
  const dish = await Dish.findByIdAndDelete(req.params.id)
  if (!dish) throw notFound('Dish')
  res.status(204).end()
})

// The kitchen can use this one, because sold-out switches are part of service.
catalogRouter.patch('/dishes/:id/sold-out', requirePermission('menu'), async (req, res) => {
  const { soldOut } = parse(z.object({ soldOut: z.boolean() }), req.body)
  const dish = await Dish.findByIdAndUpdate(req.params.id, { soldOut }, { returnDocument: 'after' })
  if (!dish) throw notFound('Dish')
  res.json(dish)
})

catalogRouter.post('/dishes/:id/move', requirePermission('menu.edit'), async (req, res) => {
  const { direction } = parse(
    z.object({ direction: z.union([z.literal(-1), z.literal(1)]) }),
    req.body,
  )
  const dish = await Dish.findById(req.params.id)
  if (!dish) throw notFound('Dish')

  const neighbour = await Dish.findOne({
    categoryId: dish.categoryId,
    sortOrder: direction === -1 ? { $lt: dish.sortOrder } : { $gt: dish.sortOrder },
  }).sort({ sortOrder: direction === -1 ? -1 : 1 })

  if (neighbour) {
    const { sortOrder } = dish
    dish.sortOrder = neighbour.sortOrder
    neighbour.sortOrder = sortOrder
    await Promise.all([dish.save(), neighbour.save()])
  }
  res.status(204).end()
})

catalogRouter.post('/option-groups', requirePermission('options'), async (req, res) => {
  const { dishIds, ...input } = parse(optionGroupInput, req.body)
  const group = await OptionGroup.create({
    ...input,
    _id: createId('group'),
    kind: input.required ? 'radio' : 'chips',
  })
  await syncGroupDishes(group.id, dishIds)
  res.status(201).json(group)
})

catalogRouter.put('/option-groups/:id', requirePermission('options'), async (req, res) => {
  const { dishIds, ...input } = parse(optionGroupInput, req.body)
  const group = await OptionGroup.findByIdAndUpdate(req.params.id, input, {
    returnDocument: 'after',
  })
  if (!group) throw notFound('Option group')
  await syncGroupDishes(group.id, dishIds)
  res.json(group)
})

catalogRouter.delete('/option-groups/:id', requirePermission('options'), async (req, res) => {
  const group = await OptionGroup.findByIdAndDelete(req.params.id)
  if (!group) throw notFound('Option group')
  await Dish.updateMany({ optionGroupIds: group.id }, { $pull: { optionGroupIds: group.id } })
  res.status(204).end()
})
