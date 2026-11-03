import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { notFound } from '../../lib/errors.js'
import { shopNow } from '../../lib/shopTime.js'
import { enquiryLimiter, orderLimiter } from '../../middleware/rateLimit.js'
import { parse } from '../../middleware/validate.js'
import { escapeHtml, sendEmail } from '../../services/email.js'
import { Category, Dish, OptionGroup } from '../catalog/catalog.model.js'
import { getContent } from '../content/content.model.js'
import { Deal, isDealAvailable } from '../deals/deals.model.js'
import { Enquiry } from '../enquiries/enquiries.model.js'
import { getTodaySlots, isOpenAt } from '../settings/availability.js'
import { getSettings, type ShopSettingsDoc } from '../settings/settings.model.js'
import { Order } from './orders.model.js'
import { cartInput, orderInput } from './orders.schema.js'
import { createOrder } from './orders.service.js'
import { priceCart } from './pricing.js'

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
    deliveryWindow: `${settings.etaMinutes} min`,
    hours,
    isOpen: !settings.ordersPaused && isOpenAt(settings),
    ordersPaused: settings.ordersPaused,
    todayHours: hours.find(({ days }) => days.includes(today.day))?.hoursLabel ?? '',
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    cardEnabled: settings.cardEnabled,
    payOnDeliveryEnabled: settings.payOnDeliveryEnabled,
  })
})

publicRouter.get('/slots', async (_req, res) => {
  res.json(getTodaySlots(await getSettings()))
})

publicRouter.post('/quote', orderLimiter, async (req, res) => {
  const { items: _items, ...totals } = await priceCart(
    parse(cartInput, req.body),
    await getSettings(),
  )
  res.json(totals)
})

publicRouter.post('/orders', orderLimiter, async (req, res) => {
  res.status(201).json(await createOrder(parse(orderInput, req.body)))
})

/** Guests have no accounts, so the private key from checkout is what grants access. */
publicRouter.get('/orders/:id', async (req, res) => {
  const { key } = parse(z.object({ key: z.string().min(1) }), req.query)
  const order = await Order.findOne({ _id: req.params.id, trackingKey: key })
  if (!order) throw notFound('Order')

  const { number, status, etaMinutes, items, total, paymentMethod, paymentStatus } = order
  res.json({ id: order.id, number, status, etaMinutes, items, total, paymentMethod, paymentStatus })
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
