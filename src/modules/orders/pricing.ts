import { unprocessable } from '../../lib/errors.js'
import { shopNow } from '../../lib/shopTime.js'
import { locatePostcode, milesBetween } from '../../services/postcodes.js'
import { Dish, OptionGroup, type DishDoc, type OptionGroupDoc } from '../catalog/catalog.model.js'
import { Deal, isDealAvailable } from '../deals/deals.model.js'
import { applyOffers } from '../offers/applyOffers.js'
import { findLiveOffers } from '../offers/offers.model.js'
import type { ShopSettingsDoc } from '../settings/settings.model.js'
import type { QuoteInput } from './orders.schema.js'

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

const priceDish = (
  dish: DishDoc,
  groups: Map<string, OptionGroupDoc>,
  selection: Record<string, string[]>,
) => {
  if (dish.soldOut) throw unprocessable(`${dish.name} has just sold out`)

  const options: { groupTitle: string; label: string; price: number }[] = []

  dish.optionGroupIds.forEach((groupId) => {
    const group = groups.get(groupId)
    if (!group) return

    const chosen = selection[groupId] ?? []
    if (group.required && chosen.length === 0) {
      throw unprocessable(`${dish.name}: ${group.title.toLowerCase()} is required`)
    }
    if (chosen.length > group.maxChoices) {
      throw unprocessable(`${dish.name}: too many choices for ${group.title.toLowerCase()}`)
    }
    chosen.forEach((choiceId) => {
      const choice = group.choices.find(({ id }) => id === choiceId)
      if (!choice) throw unprocessable(`${dish.name}: that option is no longer available`)
      options.push({ groupTitle: group.title, label: choice.label, price: choice.priceDelta })
    })
  })

  return {
    basePrice: dish.price,
    options,
    unitPrice: options.reduce((sum, { price }) => sum + price, dish.price),
    summary: options.map(({ label }) => label).join(' · ') || undefined,
  }
}

/** Which delivery ring a postcode falls in, measured in a straight line from the kitchen. */
export const quoteDelivery = async (postcode: string, settings: ShopSettingsDoc) => {
  const location = await locatePostcode(postcode)
  const distanceMiles = milesBetween(settings.kitchen, location)
  const rings = settings.deliveryRadii
    .filter(({ active }) => active)
    .sort((a, b) => a.maxMiles - b.maxMiles)
  const ring = rings.find(({ maxMiles }) => distanceMiles <= maxMiles)

  return {
    postcode: location.postcode,
    city: location.city,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    covered: Boolean(ring),
    fee: ring?.fee ?? 0,
    minimumOrder: ring?.minimumOrder ?? 0,
    maxMiles: rings.at(-1)?.maxMiles ?? 0,
  }
}

/** The single source of truth for what an order costs. Client totals are display only. */
export const priceCart = async ({ items, postcode }: QuoteInput, settings: ShopSettingsDoc) => {
  const ids = items.map(({ productId }) => productId)
  const [dishes, deals, offers] = await Promise.all([
    Dish.find({ _id: { $in: ids } }).lean(),
    Deal.find({ _id: { $in: ids } }).lean(),
    findLiveOffers(),
  ])
  const groupIds = dishes.flatMap(({ optionGroupIds }) => optionGroupIds)
  const groups = new Map(
    (await OptionGroup.find({ _id: { $in: groupIds } }).lean()).map((group) => [group._id, group]),
  )
  const today = shopNow()

  const priced = items.map(({ productId, quantity, selection, note }, index) => {
    const line = { id: `line-${index + 1}`, productId, quantity, note: note || undefined }
    const dish = dishes.find(({ _id }) => _id === productId)
    if (dish) return { ...line, name: dish.name, ...priceDish(dish, groups, selection) }

    const deal = deals.find(({ _id }) => _id === productId)
    if (!deal || !isDealAvailable(deal, today)) {
      throw unprocessable('Something in your basket is no longer available')
    }
    return {
      ...line,
      name: deal.name,
      basePrice: deal.price,
      options: [],
      unitPrice: deal.price,
      summary: undefined,
    }
  })

  const subtotal = priced.reduce((sum, { unitPrice, quantity }) => sum + unitPrice * quantity, 0)
  const offerResult = applyOffers(offers, priced)
  const afterDiscount = subtotal - offerResult.discount

  const base = {
    items: priced,
    subtotal,
    discount: offerResult.discount,
    appliedOffers: offerResult.applied,
  }
  if (!postcode) return { ...base, deliveryFee: 0, total: afterDiscount, delivery: null }

  const delivery = await quoteDelivery(postcode, settings)
  if (!delivery.covered) {
    throw unprocessable(
      `Sorry, ${delivery.postcode} is ${delivery.distanceMiles} miles away. We deliver up to ${delivery.maxMiles} miles from the kitchen.`,
    )
  }
  if (subtotal < delivery.minimumOrder) {
    throw unprocessable(
      `The minimum order for ${delivery.postcode} is ${money(delivery.minimumOrder)}`,
    )
  }

  const deliveryFee =
    offerResult.freeDelivery || afterDiscount >= settings.freeDeliveryThreshold ? 0 : delivery.fee
  return { ...base, deliveryFee, total: afterDiscount + deliveryFee, delivery }
}
