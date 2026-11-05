import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { locatePostcode } from '../../services/postcodes.js'
import { getSettings, SETTINGS_ID, ShopSettings } from './settings.model.js'

const clock = z.string().regex(/^\d{2}:\d{2}$/)
const pence = z.number().int().min(0)

const settingsInput = z.object({
  hours: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        open: z.boolean(),
        opensAt: clock,
        closesAt: clock,
      }),
    )
    .length(7),
  closures: z.array(
    z.object({ id: z.string(), date: z.string().min(1), label: z.string().min(1) }),
  ),
  kitchenPostcode: z.string().trim().min(5),
  deliveryRadii: z
    .array(
      z.object({
        id: z.string(),
        maxMiles: z.number().positive().max(50),
        fee: pence,
        minimumOrder: pence,
        active: z.boolean(),
      }),
    )
    .min(1, 'Add at least one delivery radius'),
  freeDeliveryThreshold: pence,
  prepMinutes: z.number().int().min(5).max(240),
  deliveryMinutes: z.number().int().min(5).max(180),
})

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

// Every signed-in role sees the paused status in the top bar.
settingsRouter.get('/', async (_req, res) => {
  res.json(await getSettings())
})

settingsRouter.put('/', requirePermission('settings'), async (req, res) => {
  const { kitchenPostcode, ...input } = parse(settingsInput, req.body)
  // The map and every delivery distance are measured from this point.
  const { postcode, lat, lng } = await locatePostcode(kitchenPostcode)
  res.json(
    await ShopSettings.findByIdAndUpdate(
      SETTINGS_ID,
      { ...input, kitchen: { postcode, lat, lng } },
      { returnDocument: 'after' },
    ),
  )
})

settingsRouter.patch('/paused', requirePermission('settings'), async (req, res) => {
  const { ordersPaused } = parse(z.object({ ordersPaused: z.boolean() }), req.body)
  await ShopSettings.updateOne({ _id: SETTINGS_ID }, { ordersPaused })
  res.json({ ordersPaused })
})
