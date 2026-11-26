import mongoose from 'mongoose'
import { INVITE_TOKEN_HOURS } from '../config/constants.js'
import { env } from '../config/env.js'
import { issueResetToken } from '../modules/auth/auth.routes.js'
import { Staff } from '../modules/staff/staff.model.js'
import { createId } from '../lib/ids.js'

/** Creates the owner, or renews their link, and returns where they set their password. */
export const createOwner = async (email: string, name: string) => {
  const address = email.trim().toLowerCase()
  const staff =
    (await Staff.findOne({ email: address })) ??
    (await Staff.create({ _id: createId('staff'), name, email: address, role: 'owner' }))

  if (staff.role !== 'owner') throw new Error(`${address} already exists as ${staff.role}`)

  const token = await issueResetToken(staff, INVITE_TOKEN_HOURS)
  return `${env.ADMIN_URL}/reset-password?token=${token}`
}

const main = async () => {
  // cPanel's "Run JS script" cannot pass arguments, so OWNER_EMAIL and OWNER_NAME work too.
  const [email = process.env.OWNER_EMAIL, name = process.env.OWNER_NAME ?? 'Ugo'] =
    process.argv.slice(2)
  if (!email?.includes('@'))
    throw new Error('Usage: npm run create-owner -- <email> [name], or set OWNER_EMAIL')

  await mongoose.connect(env.MONGODB_URI)
  const link = await createOwner(email, name)
  await mongoose.disconnect()

  console.log(`Owner ready. Set the password within ${INVITE_TOKEN_HOURS} hours:\n${link}`)
}

// Runs from source (tsx) and from the built file on the server.
if (/create-owner\.[jt]s$/.test(process.argv[1] ?? '')) await main()
