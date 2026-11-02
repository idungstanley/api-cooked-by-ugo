import mongoose from 'mongoose'
import { env, isProduction } from '../config/env.js'
import { hashPassword } from '../modules/auth/auth.routes.js'
import { Category, Dish, OptionGroup } from '../modules/catalog/catalog.model.js'
import { CONTENT_ID, SiteContent } from '../modules/content/content.model.js'
import { Deal } from '../modules/deals/deals.model.js'
import { SETTINGS_ID, ShopSettings } from '../modules/settings/settings.model.js'
import { Staff } from '../modules/staff/staff.model.js'
import { seedCategories, seedDeals, seedDishes, seedOptionGroups } from './menu.js'
import { seedContent, seedSettings } from './site.js'

const STAFF = [
  { _id: 'staff-owner', name: 'Ugo', email: 'owner@example.com', role: 'owner' },
  { _id: 'staff-kitchen', name: 'Bisi Ade', email: 'kitchen@example.com', role: 'kitchen' },
  { _id: 'staff-rider', name: 'Tunde Bello', email: 'rider@example.com', role: 'rider' },
  { _id: 'staff-rider-2', name: 'Sam Clarke', email: 'sam@example.com', role: 'rider' },
]

/** Safe to re-run. Only documents that do not exist yet are created, so edits are never overwritten. */
const insertMissing = async <T extends { _id: string }>(
  target: { updateOne: (...args: never[]) => unknown },
  documents: T[],
) => {
  await Promise.all(
    documents.map((document) =>
      (target.updateOne as (...args: unknown[]) => Promise<unknown>)(
        { _id: document._id },
        { $setOnInsert: document },
        { upsert: true },
      ),
    ),
  )
}

export const seedCatalog = async () => {
  await insertMissing(Category, seedCategories)
  await insertMissing(Dish, seedDishes)
  await insertMissing(OptionGroup, seedOptionGroups)
  await insertMissing(Deal, seedDeals)
  await insertMissing(ShopSettings, [{ ...seedSettings, _id: SETTINGS_ID }])
  await insertMissing(SiteContent, [{ ...seedContent, _id: CONTENT_ID }])
}

export const isLocalDatabase = (uri: string) => /\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri)

const canCreateSampleStaff = () => !isProduction && isLocalDatabase(env.MONGODB_URI)

const main = async () => {
  await mongoose.connect(env.MONGODB_URI)
  await seedCatalog()

  // Sample logins must never exist on a live database, including when seeding one from a laptop.
  const password = process.env.SEED_PASSWORD
  if (password && canCreateSampleStaff()) {
    const passwordHash = await hashPassword(password)
    await insertMissing(
      Staff,
      STAFF.map((member) => ({ ...member, passwordHash })),
    )
    console.log(`Seeded staff: ${STAFF.map(({ email }) => email).join(', ')}`)
  }

  await mongoose.disconnect()
  console.log('Seed complete')
}

if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) await main()
