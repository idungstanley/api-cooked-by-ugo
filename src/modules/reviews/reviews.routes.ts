import { Router } from 'express'
import { z } from 'zod'
import { conflict, isDuplicateKey, notFound, unprocessable } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { currentStaff, requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Order } from '../orders/orders.model.js'
import { displayNameFor, Review, summariseReviews } from './reviews.model.js'

export const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  likedItems: z.array(z.string()).max(50).default([]),
})

/** Only the person who placed a delivered order can review it, once. */
export const createReview = async (
  order: InstanceType<typeof Order>,
  input: z.infer<typeof reviewInput>,
) => {
  if (order.status !== 'delivered') {
    throw unprocessable('You can review your order once it has been delivered')
  }
  const itemNames = new Set(order.items.map(({ name }) => name))
  return Review.create({
    _id: createId('review'),
    orderId: order.id,
    orderNumber: order.number,
    orderTotal: order.total,
    customerId: order.customerId,
    accountId: order.accountId,
    displayName: displayNameFor(order.customerName),
    rating: input.rating,
    comment: input.comment || undefined,
    likedItems: input.likedItems.filter((name) => itemNames.has(name)),
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict('You have already reviewed this order')
    throw error
  })
}

/** What the website shows: comments only, newest first, without any private details. */
export const publicReviews = async (limit: number) =>
  (
    await Review.find({ hidden: false, comment: { $nin: [null, ''] } })
      .sort({ createdAt: -1 })
      .limit(limit)
  ).map(({ id, displayName, rating, comment, likedItems, reply, createdAt }) => ({
    id,
    displayName,
    rating,
    comment,
    likedItems,
    reply,
    createdAt: createdAt.getTime(),
  }))

export const reviewsRouter = Router()
reviewsRouter.use(requireAuth, requirePermission('customers'))

reviewsRouter.get('/', async (_req, res) => {
  const [reviews, summary] = await Promise.all([
    Review.find().sort({ createdAt: -1 }).limit(1000),
    summariseReviews(),
  ])
  const orderCounts = await Order.aggregate<{ _id: string; count: number }>([
    { $match: { customerId: { $in: [...new Set(reviews.map(({ customerId }) => customerId))] } } },
    { $group: { _id: '$customerId', count: { $sum: 1 } } },
  ])
  res.json({
    summary,
    reviews: reviews.map((review) => ({
      ...review.toJSON(),
      createdAt: review.createdAt.getTime(),
      repliedAt: review.repliedAt?.getTime(),
      customerOrders: orderCounts.find(({ _id }) => _id === review.customerId)?.count ?? 1,
    })),
  })
})

reviewsRouter.patch('/:id/reply', async (req, res) => {
  const { reply } = parse(z.object({ reply: z.string().trim().min(1).max(1000) }), req.body)
  const staff = currentStaff(req)
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { reply, repliedAt: new Date(), repliedBy: staff.name },
    { returnDocument: 'after' },
  )
  if (!review) throw notFound('Review')
  res.json(review)
})

reviewsRouter.patch('/:id/hidden', async (req, res) => {
  const { hidden } = parse(z.object({ hidden: z.boolean() }), req.body)
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { hidden },
    { returnDocument: 'after' },
  )
  if (!review) throw notFound('Review')
  res.json(review)
})
