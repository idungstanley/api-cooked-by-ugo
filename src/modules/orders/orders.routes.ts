import { Router } from 'express'
import { z } from 'zod'
import {
  ACTIVE_WINDOW_HOURS,
  MAX_ORDERS_RETURNED,
  type OrderStatus,
} from '../../config/constants.js'
import { notFound } from '../../lib/errors.js'
import {
  currentStaff,
  hasPermission,
  requireAuth,
  requirePermission,
} from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Order } from './orders.model.js'
import {
  assertCanAccess,
  assignRider,
  cancelOrder,
  recordCollection,
  refundOrder,
  updateEta,
  updateStatus,
} from './orders.service.js'

const OPEN_STATUSES: OrderStatus[] = ['received', 'preparing', 'out-for-delivery']

const param = (value: string | string[] | undefined) => String(value)

export const ordersRouter = Router()
ordersRouter.use(requireAuth)

/** Live service. Riders only ever receive orders assigned to them. */
ordersRouter.get('/active', requirePermission('orders', 'deliveries'), async (req, res) => {
  const staff = currentStaff(req)
  const since = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 3_600_000)
  const open = { status: { $in: OPEN_STATUSES } }
  const filter = hasPermission(staff, 'orders')
    ? { $or: [open, { status: 'delivered' as const, createdAt: { $gte: since } }] }
    : { ...open, riderId: staff.id }

  res.json(await Order.find(filter).sort({ createdAt: -1 }))
})

ordersRouter.get('/', requirePermission('history'), async (_req, res) => {
  const orders = await Order.find({ status: { $ne: 'pending-payment' } })
    .sort({ createdAt: -1 })
    .limit(MAX_ORDERS_RETURNED)
  res.json(orders)
})

ordersRouter.get('/:id', requirePermission('orders', 'deliveries'), async (req, res) => {
  const order = await Order.findById(req.params.id)
  if (!order) throw notFound('Order')
  assertCanAccess(order, currentStaff(req))
  res.json(order)
})

ordersRouter.patch('/:id/status', requirePermission('orders', 'deliveries'), async (req, res) => {
  const { status } = parse(
    z.object({ status: z.enum(['preparing', 'out-for-delivery', 'delivered']) }),
    req.body,
  )
  res.json(await updateStatus(param(req.params.id), status, currentStaff(req)))
})

ordersRouter.patch('/:id/rider', requirePermission('orders'), async (req, res) => {
  const { riderId } = parse(z.object({ riderId: z.string() }), req.body)
  res.json(await assignRider(param(req.params.id), riderId, currentStaff(req)))
})

ordersRouter.patch('/:id/eta', requirePermission('orders'), async (req, res) => {
  const { etaMinutes } = parse(z.object({ etaMinutes: z.number().int().min(5).max(240) }), req.body)
  res.json(await updateEta(param(req.params.id), etaMinutes, currentStaff(req)))
})

ordersRouter.post(
  '/:id/collection',
  requirePermission('orders', 'deliveries'),
  async (req, res) => {
    const { collectedBy } = parse(z.object({ collectedBy: z.enum(['cash', 'card']) }), req.body)
    res.json(await recordCollection(param(req.params.id), collectedBy, currentStaff(req)))
  },
)

ordersRouter.post('/:id/refund', requirePermission('refunds'), async (req, res) => {
  const { amount, reason } = parse(
    z.object({ amount: z.number().int().positive(), reason: z.string().trim().min(3) }),
    req.body,
  )
  res.json(await refundOrder(param(req.params.id), amount, reason, currentStaff(req)))
})

ordersRouter.post('/:id/cancel', requirePermission('refunds'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3) }), req.body)
  res.json(await cancelOrder(param(req.params.id), reason, currentStaff(req)))
})
