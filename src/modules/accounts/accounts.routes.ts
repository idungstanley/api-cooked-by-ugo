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

const sendSession = (res: Response, account: InstanceType<typeof Account>, status = 200) =>
  res.status(status).json({ account, token: signAccountSession(account.id, account.tokenVersion) })

export const accountsRouter = Router()

accountsRouter.post('/signup', authLimiter, async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(2, 'Enter your name').max(100),
      email,
      password,
      phone: phoneNumber.optional(),
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

accountsRouter.get('/orders', requireAccount, async (req, res) => {
  const account = currentAccount(req)
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
      html: `<p>Hi ${escapeHtml(account.name)},</p><p><a href="${env.SITE_URL}/account/reset-password?token=${token}">Choose a new password</a>. The link works for ${RESET_TOKEN_HOURS} hours.</p><p>If you did not ask for this, you can ignore this email.</p>`,
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
  await account.save()
  sendSession(res, account)
})
