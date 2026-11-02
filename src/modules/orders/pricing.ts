import { unprocessable } from '../../lib/errors.js'
import { shopNow } from '../../lib/shopTime.js'
import { Dish, OptionGroup, type DishDoc, type OptionGroupDoc } from '../catalog/catalog.model.js'
import { Deal, isDealAvailable } from '../deals/deals.model.js'
import type { ShopSettingsDoc } from '../settings/settings.model.js'
import type { CartInput } from './orders.schema.js'

const priceDish = (
  dish: DishDoc,
  groups: Map<string, OptionGroupDoc>,
  selection: Record<string, string[]>,
) => {
  if (dish.soldOut) throw unprocessable(`${dish.name} has just sold out`)

  const labels: string[] = []
  let unitPrice = dish.price

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
      unitPrice += choice.priceDelta
      labels.push(choice.label)
    })
  })

  return { unitPrice, summary: labels.join(' · ') || undefined }
}

export const outwardCode = (postcode: string) => {
  const compact = postcode.replace(/\s/g, '').toUpperCase()
  return compact.slice(0, -3)
}

/** The single source of truth for what an order costs. Client totals are display only. */
export const priceCart = async ({ items, postcode }: CartInput, settings: ShopSettingsDoc) => {
  const ids = items.map(({ productId }) => productId)
  const [dishes, deals] = await Promise.all([
    Dish.find({ _id: { $in: ids } }).lean(),
    Deal.find({ _id: { $in: ids } }).lean(),
  ])
  const groupIds = dishes.flatMap(({ optionGroupIds }) => optionGroupIds)
  const groups = new Map(
    (await OptionGroup.find({ _id: { $in: groupIds } }).lean()).map((group) => [group._id, group]),
  )
  const today = shopNow()

  const priced = items.map(({ productId, quantity, selection }, index) => {
    const line = { id: `line-${index + 1}`, productId, quantity }
    const dish = dishes.find(({ _id }) => _id === productId)
    if (dish) return { ...line, name: dish.name, ...priceDish(dish, groups, selection) }

    const deal = deals.find(({ _id }) => _id === productId)
    if (!deal || !isDealAvailable(deal, today)) {
      throw unprocessable('Something in your basket is no longer available')
    }
    return { ...line, name: deal.name, unitPrice: deal.price, summary: undefined }
  })

  const subtotal = priced.reduce((sum, { unitPrice, quantity }) => sum + unitPrice * quantity, 0)
  const code = outwardCode(postcode)
  const zone = settings.zones.find(({ prefix, active }) => active && prefix === code)
  if (!zone) throw unprocessable(`Sorry, we do not deliver to ${code} yet`)
  if (subtotal < zone.minimumOrder) {
    throw unprocessable(`The minimum order for ${code} is £${(zone.minimumOrder / 100).toFixed(2)}`)
  }

  const deliveryFee = subtotal >= settings.freeDeliveryThreshold ? 0 : zone.fee
  return { items: priced, subtotal, deliveryFee, total: subtotal + deliveryFee }
}
