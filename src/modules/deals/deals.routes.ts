import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Deal } from './deals.model.js'

const dealInput = z
  .object({
    name: z.string().trim().min(2),
    tag: z.string().trim().min(2),
    description: z.string().trim().min(5),
    price: z.number().int().positive(),
    wasPrice: z.number().int().positive(),
    image: z.string().min(1),
    theme: z.enum(['jollof', 'ewedu', 'indigo']),
    active: z.boolean(),
    activeDays: z.array(z.number().int().min(0).max(6)).min(1),
    startsOn: z.string().optional(),
    endsOn: z.string().optional(),
  })
  .refine(({ price, wasPrice }) => price < wasPrice, 'The deal price must be below the full price')

export const dealsRouter = Router()
dealsRouter.use(requireAuth, requirePermission('deals'))

dealsRouter.get('/', async (_req, res) => {
  res.json(await Deal.find().sort({ createdAt: 1 }))
})

dealsRouter.post('/', async (req, res) => {
  res.status(201).json(await Deal.create({ ...parse(dealInput, req.body), _id: createId('deal') }))
})

dealsRouter.put('/:id', async (req, res) => {
  const deal = await Deal.findByIdAndUpdate(req.params.id, parse(dealInput, req.body), {
    returnDocument: 'after',
  })
  if (!deal) throw notFound('Deal')
  res.json(deal)
})

dealsRouter.patch('/:id/active', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body)
  const deal = await Deal.findByIdAndUpdate(req.params.id, { active }, { returnDocument: 'after' })
  if (!deal) throw notFound('Deal')
  res.json(deal)
})

dealsRouter.delete('/:id', async (req, res) => {
  if (!(await Deal.findByIdAndDelete(req.params.id))) throw notFound('Deal')
  res.status(204).end()
})
