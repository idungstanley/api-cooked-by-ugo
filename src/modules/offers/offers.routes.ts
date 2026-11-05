import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Offer, OFFER_TYPES } from './offers.model.js'

const offerInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(OFFER_TYPES),
    value: z.number().int().min(0).default(0),
    dishIds: z.array(z.string()).default([]),
    minSubtotal: z.number().int().min(0).default(0),
    startsAt: z.number().int().nullish(),
    endsAt: z.number().int().nullish(),
    active: z.boolean().default(true),
  })
  .refine(({ type, value }) => type !== 'percent' || (value >= 1 && value <= 100), {
    message: 'Enter a percentage between 1 and 100',
  })
  .refine(({ type, value }) => type !== 'amount' || value > 0, {
    message: 'Enter the amount off',
  })
  .refine(({ type, dishIds }) => type !== 'bogo' || dishIds.length > 0, {
    message: 'Choose the dishes for buy one get one free',
  })
  .refine(({ startsAt, endsAt }) => !startsAt || !endsAt || endsAt > startsAt, {
    message: 'The offer must end after it starts',
  })

/** A cleared start or end date is removed, so the offer runs from now or until switched off. */
const toDocument = ({ startsAt, endsAt, ...input }: z.infer<typeof offerInput>) => {
  const cleared = { ...(startsAt ? {} : { startsAt: 1 }), ...(endsAt ? {} : { endsAt: 1 }) }
  return {
    ...input,
    ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
    ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
    ...(Object.keys(cleared).length ? { $unset: cleared } : {}),
  }
}

export const offersRouter = Router()
offersRouter.use(requireAuth, requirePermission('deals'))

offersRouter.get('/', async (_req, res) => {
  res.json(await Offer.find().sort({ createdAt: -1 }))
})

offersRouter.post('/', async (req, res) => {
  const { $unset: _cleared, ...fields } = toDocument(parse(offerInput, req.body))
  const offer = await Offer.create({ ...fields, _id: createId('offer') })
  res.status(201).json(offer)
})

offersRouter.put('/:id', async (req, res) => {
  const offer = await Offer.findByIdAndUpdate(
    req.params.id,
    toDocument(parse(offerInput, req.body)),
    { returnDocument: 'after', runValidators: true },
  )
  if (!offer) throw notFound('Offer')
  res.json(offer)
})

offersRouter.patch('/:id/active', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body)
  const offer = await Offer.findByIdAndUpdate(
    req.params.id,
    { active },
    { returnDocument: 'after' },
  )
  if (!offer) throw notFound('Offer')
  res.json(offer)
})

offersRouter.delete('/:id', async (req, res) => {
  const offer = await Offer.findByIdAndDelete(req.params.id)
  if (!offer) throw notFound('Offer')
  res.status(204).end()
})
