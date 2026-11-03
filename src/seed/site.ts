const hours = (day: number, opensAt: string, closesAt: string) => ({
  day,
  open: true,
  opensAt,
  closesAt,
})

/** Delivery values are assumptions until the client confirms them. */
export const seedSettings = {
  ordersPaused: false,
  hours: [1, 2, 3, 4, 5, 6, 0].map((day) => hours(day, '12:00', '20:00')),
  closures: [{ id: 'christmas', date: '2026-12-25', label: 'Christmas Day' }],
  zones: [
    { id: 'ne1', prefix: 'NE1', fee: 299, minimumOrder: 1200, active: true },
    { id: 'ne2', prefix: 'NE2', fee: 299, minimumOrder: 1200, active: true },
    { id: 'ne3', prefix: 'NE3', fee: 349, minimumOrder: 1500, active: true },
    { id: 'ne4', prefix: 'NE4', fee: 349, minimumOrder: 1500, active: true },
    { id: 'ne6', prefix: 'NE6', fee: 399, minimumOrder: 1500, active: false },
  ],
  freeDeliveryThreshold: 2500,
  etaMinutes: 40,
  cardEnabled: true,
  payOnDeliveryEnabled: true,
  payOnDeliveryLimit: 6000,
}

export const seedContent = {
  announcement: 'Suya Night is back every Friday.',
  heroHeadline: 'Lagos flavour, Newcastle doorstep.',
  heroText:
    'Jollof, suya, egusi and dodo, cooked from scratch every day by Ugo and delivered hot in 35 to 45 minutes.',
  storyText:
    'At Cooked by Ugo, we believe good food starts with fresh ingredients, a little patience and a whole lot of love.\n\nEvery dish is freshly prepared from scratch, bringing the warmth and comfort of home cooking to your table. From rich, slow-cooked stews and smoky party jollof to flavour-packed suya-spiced favourites, every pot is made with care, using recipes and flavours inspired by home.',
  phone: '0191 234 5678',
  email: 'orders@cookedbyugo.com',
  whatsappNumber: '441912345678',
  areaLabel: 'Newcastle upon Tyne, NE1',
  favouriteDishIds: ['party-jollof-rice', 'suya-platter', 'pounded-yam-egusi', 'fried-plantain'],
}
