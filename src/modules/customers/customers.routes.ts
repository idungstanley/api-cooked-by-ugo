import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../../lib/errors.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Order } from '../orders/orders.model.js'
import { Customer } from './customers.model.js'

export const customersRouter = Router()
customersRouter.use(requireAuth, requirePermission('customers'))

customersRouter.get('/', async (_req, res) => {
  const [customers, totals] = await Promise.all([
    Customer.find(),
    Order.aggregate<{ _id: string; orderCount: number; totalSpent: number; lastOrderAt: Date }>([
      { $match: { status: { $nin: ['cancelled', 'pending-payment'] } } },
      {
        $group: {
          _id: '$customerId',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: { $subtract: ['$total', '$refundedAmount'] } },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
    ]),
  ])
  const byCustomer = new Map(totals.map((entry) => [entry._id, entry]))

  res.json(
    customers.map((customer) => {
      const total = byCustomer.get(customer.id)
      const { phoneKey: _phoneKey, ...details } = customer.toJSON() as unknown as Record<
        string,
        unknown
      >
      return {
        ...details,
        orderCount: total?.orderCount ?? 0,
        totalSpent: total?.totalSpent ?? 0,
        lastOrderAt: total?.lastOrderAt.getTime(),
      }
    }),
  )
})

customersRouter.patch('/:id/block', async (req, res) => {
  const { blocked, reason } = parse(
    z.object({ blocked: z.boolean(), reason: z.string().optional() }),
    req.body,
  )
  const customer = await Customer.findByIdAndUpdate(
    req.params.id,
    { blocked, blockReason: blocked ? reason : undefined },
    { returnDocument: 'after' },
  )
  if (!customer) throw notFound('Customer')
  res.status(204).end()
})

/** Removes personal details for a privacy request. Order totals stay for the accounts. */
customersRouter.delete('/:id/data', async (req, res) => {
  const customer = await Customer.findByIdAndUpdate(req.params.id, {
    name: 'Deleted customer',
    email: '',
    phone: '',
    marketingOptIn: false,
    deleted: true,
    $unset: { phoneKey: 1, blockReason: 1 },
    blocked: false,
  })
  if (!customer) throw notFound('Customer')

  await Order.updateMany(
    { customerId: customer.id },
    {
      customerName: 'Deleted customer',
      customerEmail: '',
      customerPhone: '',
      address: '',
      postcode: '',
      $unset: { deliveryNote: 1, allergyNote: 1 },
    },
  )
  res.status(204).end()
})
