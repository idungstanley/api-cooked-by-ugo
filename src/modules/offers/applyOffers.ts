import type { OfferDoc } from './offers.model.js'

interface PricedLine {
  productId: string
  unitPrice: number
  quantity: number
}

export interface AppliedOffer {
  offerId: string
  name: string
  discount: number
  freeDelivery: boolean
}

const eligible = (offer: OfferDoc, lines: PricedLine[]) =>
  offer.dishIds.length === 0
    ? lines
    : lines.filter(({ productId }) => offer.dishIds.includes(productId))

const lineTotal = (lines: PricedLine[]) =>
  lines.reduce((sum, { unitPrice, quantity }) => sum + unitPrice * quantity, 0)

/** Every second unit of an offer dish is free, and the cheaper of each pair is the free one. */
const bogoDiscount = (lines: PricedLine[]) => {
  const byDish = new Map<string, number[]>()
  lines.forEach(({ productId, unitPrice, quantity }) => {
    const prices = byDish.get(productId) ?? []
    byDish.set(productId, [...prices, ...Array<number>(quantity).fill(unitPrice)])
  })
  return [...byDish.values()].reduce((sum, prices) => {
    const sorted = [...prices].sort((a, b) => b - a)
    return (
      sum + sorted.filter((_, index) => index % 2 === 1).reduce((total, price) => total + price, 0)
    )
  }, 0)
}

const discountFor = (offer: OfferDoc, lines: PricedLine[]) => {
  const covered = eligible(offer, lines)
  const coveredTotal = lineTotal(covered)
  if (offer.type === 'bogo') return offer.dishIds.length > 0 ? bogoDiscount(covered) : 0
  if (offer.type === 'percent') return Math.floor((coveredTotal * Math.min(offer.value, 100)) / 100)
  if (offer.type === 'amount') {
    // With dishes it is money off each one, and without dishes it is money off the order.
    const amount =
      offer.dishIds.length > 0
        ? covered.reduce(
            (sum, { unitPrice, quantity }) => sum + Math.min(offer.value, unitPrice) * quantity,
            0,
          )
        : offer.value
    return Math.min(amount, coveredTotal)
  }
  return 0
}

/**
 * Offers do not stack: the order gets the single biggest saving, plus free delivery when a
 * free delivery offer also applies. This keeps the maths easy for customers to check.
 */
export const applyOffers = (offers: OfferDoc[], lines: PricedLine[]) => {
  const subtotal = lineTotal(lines)
  const qualifying = offers.filter(({ minSubtotal }) => subtotal >= minSubtotal)

  const best = qualifying
    .filter(({ type }) => type !== 'free-delivery')
    .map((offer) => ({ offer, discount: discountFor(offer, lines) }))
    .filter(({ discount }) => discount > 0)
    .sort((a, b) => b.discount - a.discount)[0]
  const delivery = qualifying.find(({ type }) => type === 'free-delivery')

  const applied: AppliedOffer[] = []
  if (best) {
    applied.push({
      offerId: best.offer._id,
      name: best.offer.name,
      discount: best.discount,
      freeDelivery: false,
    })
  }
  if (delivery) {
    applied.push({ offerId: delivery._id, name: delivery.name, discount: 0, freeDelivery: true })
  }

  return {
    discount: Math.min(best?.discount ?? 0, subtotal),
    freeDelivery: Boolean(delivery),
    applied,
  }
}
