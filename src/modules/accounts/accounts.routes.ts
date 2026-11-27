import bcrypt from 'bcryptjs'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { RESET_TOKEN_HOURS } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { conflict, isDuplicateKey, unauthorised } from '../../lib/errors.js'
import { createId, createSecret } from '../../lib/ids.js'
import { authLimiter } from '../../middleware/rateLimit.js'
import { parse } from '../../middleware/validate.js'
import { escapeHtml, sendEmail } from '../../services/email.js'
import { button, layout, paragraph } from '../../services/emailLayout.js'
import { hashPassword } from '../auth/auth.routes.js'
import { hashToken } from '../auth/auth.tokens.js'
import { phoneNumber } from '../orders/orders.schema.js'
import { Order } from '../orders/orders.model.js'
import { Review } from '../reviews/reviews.model.js'
import { currentAccount, requireAccount, signAccountSession } from './accounts.auth.js'
import { Account } from './accounts.model.js'

const INVALID_LOGIN = 'Email or password is incorrect'
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12)
const ORDERS_SHOWN = 50

const password = z.string().min(8, 'Use at least 8 characters').max(200)
const email = z.email('Enter a valid email').transform((value) => value.trim().toLowerCase())

const address = z.object({
  line1: z.string().trim().min(2).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  postcode: z.string().trim().min(5).max(10),
})

/** Emails a link that proves the customer owns the address. */
const sendVerification = async (account: InstanceType<typeof Account>) => {
  const token = createSecret()
  account.verifyTokenHash = hashToken(token)
  await account.save()
  sendEmail({
    to: account.email,
    subject: 'Confirm your email for Cooked by Ugo',
    html: layout({
      heading: 'Confirm your email',
      preview: 'One tap to finish setting up your account',
      body: `${paragraph(`Hi ${escapeHtml(account.name)}, welcome to Cooked by Ugo.`)}${paragraph(
        'Confirm your email so we can show every order you place with it, including any you placed before you signed up.',
      )}${button('Confirm my email', `${env.SITE_URL}/account/verify-email?token=${token}`)}${paragraph(
        'If you did not create this account, you can ignore this email.',
      )}`,
    }),
  })
}

const escapeRegex = (value: string) => value.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')

const digits = (value = '') => value.replace(/\D/g, '')

/**
 * Gives an account the guest orders placed before it existed. Both the email and the phone
 * must match, so signing up with someone else's email alone shows nothing.
 */
const claimGuestOrders = async (account: InstanceType<typeof Account>) => {
  const phone = digits(account.phone)
  if (!phone) return
  const candidates = await Order.find(
    {
      accountId: { $exists: false },
      customerEmail: new RegExp(`^${escapeRegex(account.email)}$`, 'i'),
    },
    { customerPhone: 1 },
  )
  const ids = candidates
    .filter((order) => digits(order.customerPhone) === phone)
    .map(({ id }) => id)
  if (ids.length > 0) await Order.updateMany({ _id: { $in: ids } }, { accountId: account.id })
}

const sendSession = (res: Response, account: InstanceType<typeof Account>, status = 200) =>
  res.status(status).json({ account, token: signAccountSession(account.id, account.tokenVersion) })

export const accountsRouter = Router()

accountsRouter.post('/signup', authLimiter, async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(2, 'Enter your name').max(100),
      email,
      password,
      phone: phoneNumber,
      address,
      marketingOptIn: z.boolean().default(false),
    }),
    req.body,
  )
  const account = await Account.create({
    ...input,
    _id: createId('account'),
    passwordHash: await hashPassword(input.password),
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict('That email already has an account. Please sign in.')
    throw error
  })
  await claimGuestOrders(account)
  sendSession(res, account, 201)
})

accountsRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(z.object({ email, password: z.string() }), req.body)
  const account = await Account.findOne({ email: input.email })
  const matches = await bcrypt.compare(input.password, account?.passwordHash ?? DUMMY_HASH)
  if (!account || !matches) throw unauthorised(INVALID_LOGIN)
  sendSession(res, account)
})

/** Signing out ends the session on every device. */
accountsRouter.post('/logout', requireAccount, async (req, res) => {
  const account = currentAccount(req)
  account.tokenVersion += 1
  await account.save()
  res.status(204).end()
})

accountsRouter.get('/me', requireAccount, (req, res) => {
  res.json(currentAccount(req))
})

accountsRouter.patch('/me', requireAccount, async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(2).max(100),
      phone: phoneNumber.optional(),
      address: address.optional(),
      marketingOptIn: z.boolean().optional(),
    }),
    req.body,
  )
  const account = currentAccount(req)
  account.set(input)
  await account.save()
  res.json(account)
})

/** Opened from the confirmation email. */
accountsRouter.post('/verify-email', authLimiter, async (req, res) => {
  const input = parse(z.object({ token: z.string().min(10) }), req.body)
  const account = await Account.findOne({ verifyTokenHash: hashToken(input.token) })
  if (!account) throw unauthorised('This link has expired. Please ask for a new one.')
  account.emailVerifiedAt = account.emailVerifiedAt ?? new Date()
  account.verifyTokenHash = undefined
  await account.save()
  await claimGuestOrders(account)
  res.json(account)
})

accountsRouter.post('/resend-verification', requireAccount, authLimiter, async (req, res) => {
  const account = currentAccount(req)
  if (!account.emailVerifiedAt) await sendVerification(account)
  res.json({ ok: true })
})

accountsRouter.get('/orders', requireAccount, async (req, res) => {
  const account = currentAccount(req)
  // Picks up guest orders too, for example after the customer adds their phone number.
  await claimGuestOrders(account)
  const orders = await Order.find({ accountId: account.id, status: { $ne: 'pending-payment' } })
    .sort({ createdAt: -1 })
    .limit(ORDERS_SHOWN)
  const reviewed = new Set(
    (await Review.find({ orderId: { $in: orders.map(({ id }) => id) } }, { orderId: 1 })).map(
      ({ orderId }) => orderId,
    ),
  )
  res.json(
    orders.map((order) => ({
      ...order.toJSON(),
      trackingKey: order.trackingKey,
      reviewed: reviewed.has(order.id),
    })),
  )
})

/** Always answers the same way, so it cannot be used to find out who has an account. */
accountsRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const input = parse(z.object({ email }), req.body)
  const account = await Account.findOne({ email: input.email })
  if (account) {
    const token = createSecret()
    account.resetTokenHash = hashToken(token)
    account.resetTokenExpires = new Date(Date.now() + RESET_TOKEN_HOURS * 3_600_000)
    await account.save()
    sendEmail({
      to: account.email,
      subject: 'Reset your Cooked by Ugo password',
      html: layout({
        heading: 'Reset your password',
        preview: `The link works for ${RESET_TOKEN_HOURS} hours`,
        body: `${paragraph(`Hi ${escapeHtml(account.name)},`)}${button(
          'Choose a new password',
          `${env.SITE_URL}/account/reset-password?token=${token}`,
        )}${paragraph(
          `The link works for ${RESET_TOKEN_HOURS} hours. If you did not ask for this, you can ignore this email.`,
        )}`,
      }),
    })
  }
  res.json({ ok: true })
})

accountsRouter.post('/reset-password', authLimiter, async (req, res) => {
  const input = parse(z.object({ token: z.string().min(10), password }), req.body)
  const account = await Account.findOne({
    resetTokenHash: hashToken(input.token),
    resetTokenExpires: { $gt: new Date() },
  })
  if (!account) throw unauthorised('This link has expired. Please ask for a new one.')

  account.passwordHash = await hashPassword(input.password)
  account.resetTokenHash = undefined
  account.resetTokenExpires = undefined
  account.tokenVersion += 1
  // The reset link arrived by email, which proves the customer owns the address.
  account.emailVerifiedAt = account.emailVerifiedAt ?? new Date()
  await account.save()
  await claimGuestOrders(account)
  sendSession(res, account)
})
