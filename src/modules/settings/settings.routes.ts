import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
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
  zones: z.array(
    z.object({
      id: z.string(),
      prefix: z
        .string()
        .toUpperCase()
        .regex(/^[A-Z]{1,2}\d{1,2}[A-Z]?$/),
      fee: pence,
      minimumOrder: pence,
      active: z.boolean(),
    }),
  ),
  freeDeliveryThreshold: pence,
  etaMinutes: z.number().int().positive(),
  cardEnabled: z.boolean(),
  payOnDeliveryEnabled: z.boolean(),
  payOnDeliveryLimit: pence,
})

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

// Every signed-in role sees the paused status in the top bar.
settingsRouter.get('/', async (_req, res) => {
  res.json(await getSettings())
})

settingsRouter.put('/', requirePermission('settings'), async (req, res) => {
  const input = parse(settingsInput, req.body)
  res.json(await ShopSettings.findByIdAndUpdate(SETTINGS_ID, input, { returnDocument: 'after' }))
})

settingsRouter.patch('/paused', requirePermission('settings'), async (req, res) => {
  const { ordersPaused } = parse(z.object({ ordersPaused: z.boolean() }), req.body)
  await ShopSettings.updateOne({ _id: SETTINGS_ID }, { ordersPaused })
  res.json({ ordersPaused })
})
