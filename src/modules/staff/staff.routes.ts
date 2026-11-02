import { Router } from 'express'
import { z } from 'zod'
import { INVITE_TOKEN_HOURS } from '../../config/constants.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { currentStaff, requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { sendInvite } from '../auth/auth.routes.js'
import { Staff } from './staff.model.js'

const staffInput = z.object({
  name: z.string().trim().min(2),
  email: z.email().toLowerCase(),
  role: z.enum(['owner', 'kitchen', 'rider']),
})

const assertNotLastOwner = async (staff: InstanceType<typeof Staff>) => {
  if (staff.role !== 'owner') return
  const owners = await Staff.countDocuments({ role: 'owner', active: true })
  if (owners <= 1) throw conflict('There must always be one active owner')
}

export const staffRouter = Router()
staffRouter.use(requireAuth)

/** Name and role only, so the kitchen can assign riders without seeing staff details. */
staffRouter.get('/riders', requirePermission('orders'), async (_req, res) => {
  const riders = await Staff.find({ role: 'rider', active: true }).select('name')
  res.json(riders.map(({ id, name }) => ({ id, name })))
})

staffRouter.use(requirePermission('staff'))

staffRouter.get('/', async (_req, res) => {
  res.json(await Staff.find().sort({ createdAt: 1 }))
})

staffRouter.post('/', async (req, res) => {
  const input = parse(staffInput, req.body)
  if (await Staff.exists({ email: input.email })) throw conflict('Someone already uses that email')

  const staff = await Staff.create({ ...input, _id: createId('staff') })
  await sendInvite(staff, INVITE_TOKEN_HOURS)
  res.status(201).json(staff)
})

staffRouter.put('/:id', async (req, res) => {
  const input = parse(staffInput, req.body)
  const staff = await Staff.findById(req.params.id)
  if (!staff) throw notFound('Staff member')
  if (input.role !== 'owner') await assertNotLastOwner(staff)

  if (input.role !== staff.role) staff.tokenVersion += 1
  staff.set(input)
  await staff.save()
  res.json(staff)
})

staffRouter.patch('/:id/active', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body)
  const staff = await Staff.findById(req.params.id)
  if (!staff) throw notFound('Staff member')
  if (staff.id === currentStaff(req).id) throw badRequest('You cannot deactivate yourself')
  if (!active) await assertNotLastOwner(staff)

  staff.active = active
  staff.tokenVersion += 1
  await staff.save()
  res.json(staff)
})
