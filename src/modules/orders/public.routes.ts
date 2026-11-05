import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { notFound } from '../../lib/errors.js'
import { shopNow } from '../../lib/shopTime.js'
import { enquiryLimiter, orderLimiter } from '../../middleware/rateLimit.js'
import { parse } from '../../middleware/validate.js'
import { escapeHtml, sendEmail } from '../../services/email.js'
import { addressLookupEnabled, listAddresses } from '../../services/postcodes.js'
import { optionalAccount } from '../accounts/accounts.auth.js'
import { Category, Dish, OptionGroup } from '../catalog/catalog.model.js'
import { getContent } from '../content/content.model.js'
import { Deal, isDealAvailable } from '../deals/deals.model.js'
import { Enquiry } from '../enquiries/enquiries.model.js'
import { getTodaySlots, isOpenAt } from '../settings/availability.js'
import { findLiveOffers, offerLabel } from '../offers/offers.model.js'
import { createReview, publicReviews, reviewInput } from '../reviews/reviews.routes.js'
import { Review, summariseReviews } from '../reviews/reviews.model.js'
import { getSettings, leadMinutes, type ShopSettingsDoc } from '../settings/settings.model.js'
import { Order } from './orders.model.js'
import { orderInput, quoteInput } from './orders.schema.js'
import { createOrder } from './orders.service.js'
import { priceCart, quoteDelivery } from './pricing.js'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

const hourLabel = (clock: string) => {
  const [hour = 0, minute = 0] = clock.split(':').map(Number)
  const period = hour >= 12 ? 'pm' : 'am'
  const display = hour % 12 || 12
  return `${display}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${period}`
}

/** Joins neighbouring days with the same hours, as in "Mon to Thu". */
const groupHours = (settings: ShopSettingsDoc) => {
  const groups: { label: string; days: number[]; hoursLabel: string }[] = []

  WEEK_ORDER.forEach((day) => {
    const hours = settings.hours.find((entry) => entry.day === day)
    const hoursLabel = hours?.open
      ? `${hourLabel(hours.opensAt)} to ${hourLabel(hours.closesAt)}`
      : 'Closed'
    const last = groups.at(-1)
    if (last?.hoursLabel === hoursLabel) last.days.push(day)
    else groups.push({ label: '', days: [day], hoursLabel })
  })

  return groups.map((group) => {
    if (group.days.length === 7) return { ...group, label: 'Every day' }
    const first = DAY_LABELS[group.days[0] ?? 0]
    const last = DAY_LABELS[group.days.at(-1) ?? 0]
    return { ...group, label: first === last ? (first ?? '') : `${first} to ${last}` }
  })
}

export const publicRouter = Router()

publicRouter.get('/categories', async (_req, res) => {
  res.json(await Category.find().sort({ sortOrder: 1 }))
})

publicRouter.get('/dishes', async (_req, res) => {
  res.json(await Dish.find().sort({ sortOrder: 1 }))
})

publicRouter.get('/option-groups', async (_req, res) => {
  res.json(await OptionGroup.find())
})

publicRouter.get('/favourites', async (_req, res) => {
  const { favouriteDishIds } = await getContent()
  const dishes = await Dish.find({ _id: { $in: favouriteDishIds } })

  res.json(
    favouriteDishIds.flatMap((dishId, index) => {
      const dish = dishes.find(({ id }) => id === dishId)
      if (!dish) return []
      return [
        {
          dishId,
          tag: index === 0 ? 'Most ordered' : (dish.badges[0] ?? 'Favourite'),
          description: dish.description,
        },
      ]
    }),
  )
})

publicRouter.get('/deals', async (_req, res) => {
  const today = shopNow()
  const deals = await Deal.find({ active: true }).sort({ createdAt: 1 })
  res.json(deals.filter((deal) => isDealAvailable(deal, today)))
})

publicRouter.get('/site', async (_req, res) => {
  const [settings, content] = await Promise.all([getSettings(), getContent()])
  const today = shopNow()
  const hours = groupHours(settings)

  res.json({
    announcement: content.announcement,
    heroHeadline: content.heroHeadline,
    heroText: content.heroText,
    storyText: content.storyText,
    phone: content.phone,
    phoneHref: `tel:${content.phone.replace(/\s/g, '')}`,
    email: content.email,
    whatsappNumber: content.whatsappNumber,
    areaLabel: content.areaLabel,
    directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(content.areaLabel)}`,
    deliveryWindow: `${leadMinutes(settings)} min`,
    leadMinutes: leadMinutes(settings),
    hours,
    isOpen: !settings.ordersPaused && isOpenAt(settings),
    ordersPaused: settings.ordersPaused,
    todayHours: hours.find(({ days }) => days.includes(today.day))?.hoursLabel ?? '',
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    addressLookup: addressLookupEnabled,
  })
})

publicRouter.get('/slots', async (_req, res) => {
  res.json(getTodaySlots(await getSettings()))
})

publicRouter.post('/quote', orderLimiter, async (req, res) => {
  const { items: _items, ...totals } = await priceCart(
    parse(quoteInput, req.body),
    await getSettings(),
  )
  res.json(totals)
})

/** Checks a postcode at checkout: is it real, which city, do we deliver, and its addresses. */
publicRouter.get('/postcodes/:postcode', orderLimiter, async (req, res) => {
  const delivery = await quoteDelivery(String(req.params.postcode), await getSettings())
  const addresses = delivery.covered ? await listAddresses(delivery.postcode) : []
  res.json({ ...delivery, addresses })
})

publicRouter.get('/offers', async (_req, res) => {
  const offers = await findLiveOffers()
  res.json(
    offers.map(({ _id, name, type, value, dishIds, minSubtotal, endsAt }) => ({
      id: _id,
      name,
      type,
      label: offerLabel({ type, value }),
      dishIds,
      minSubtotal,
      endsAt: endsAt?.getTime(),
    })),
  )
})

publicRouter.get('/reviews', async (_req, res) => {
  const [summary, reviews] = await Promise.all([summariseReviews(), publicReviews(12)])
  res.json({ summary, reviews })
})

publicRouter.post('/orders', orderLimiter, optionalAccount, async (req, res) => {
  res.status(201).json(await createOrder(parse(orderInput, req.body), req.account?.id))
})

/** Guests have no accounts, so the private key from checkout is what grants access. */
const findTrackedOrder = async (orderId: string, query: unknown) => {
  const { key } = parse(z.object({ key: z.string().min(1) }), query)
  const order = await Order.findOne({ _id: orderId, trackingKey: key })
  if (!order) throw notFound('Order')
  return order
}

publicRouter.get('/orders/:id', async (req, res) => {
  const order = await findTrackedOrder(String(req.params.id), req.query)
  const review = await Review.findOne({ orderId: order.id })
  res.json({
    id: order.id,
    number: order.number,
    status: order.status,
    etaMinutes: order.etaMinutes,
    createdAt: order.createdAt.getTime(),
    scheduledFor: order.scheduledFor?.getTime(),
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryFee: order.deliveryFee,
    total: order.total,
    paymentStatus: order.paymentStatus,
    review: review ? { rating: review.rating, comment: review.comment, reply: review.reply } : null,
  })
})

publicRouter.post('/orders/:id/review', orderLimiter, async (req, res) => {
  const order = await findTrackedOrder(String(req.params.id), req.query)
  const review = await createReview(order, parse(reviewInput, req.body))
  res.status(201).json({ rating: review.rating, comment: review.comment })
})

publicRouter.post('/enquiries', enquiryLimiter, async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(2).max(100),
      email: z.email(),
      phone: z.string().trim().min(6).max(30),
      eventDate: z.string().min(1),
      guests: z.number().int().positive().max(5000),
      message: z.string().trim().min(5).max(2000),
    }),
    req.body,
  )
  const enquiry = await Enquiry.create(input)
  if (env.KITCHEN_EMAIL) {
    sendEmail({
      to: env.KITCHEN_EMAIL,
      subject: `Catering enquiry from ${input.name}`,
      html: `<p>${input.guests} guests on ${escapeHtml(input.eventDate)}.</p><p>${escapeHtml(input.message)}</p>`,
    })
  }
  res.status(201).json({ id: enquiry.id })
})
