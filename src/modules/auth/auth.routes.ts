import bcrypt from 'bcryptjs'
import { Router, type Response } from 'express'
import { authenticator } from 'otplib'
import { z } from 'zod'
import { RESET_TOKEN_HOURS } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { badRequest, unauthorised } from '../../lib/errors.js'
import { createSecret } from '../../lib/ids.js'
import { currentStaff, requireAuth } from '../../middleware/auth.js'
import { authLimiter } from '../../middleware/rateLimit.js'
import { parse } from '../../middleware/validate.js'
import { sendEmail } from '../../services/email.js'
import { Staff, type StaffDoc } from '../staff/staff.model.js'
import {
  hashToken,
  readChallenge,
  SESSION_COOKIE,
  sessionCookieOptions,
  signChallenge,
  signSession,
} from './auth.tokens.js'

const BCRYPT_ROUNDS = 12
const INVALID_LOGIN = 'Email or password is incorrect'
// Compared against when the email is unknown, so timing does not reveal who has an account.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS)

const password = z.string().min(10, 'Use at least 10 characters')

export const authRouter = Router()

const startSession = async (res: Response, staff: InstanceType<typeof Staff>) => {
  staff.lastActiveAt = new Date()
  await staff.save()
  res.cookie(SESSION_COOKIE, signSession(staff.id, staff.tokenVersion), sessionCookieOptions)
  res.json({ user: staff })
}

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string(), password: z.string() }), req.body)
  const staff = await Staff.findOne({ email: body.email.trim().toLowerCase() })
  const matches = await bcrypt.compare(body.password, staff?.passwordHash ?? DUMMY_HASH)

  if (!staff?.passwordHash || !matches || !staff.active) throw unauthorised(INVALID_LOGIN)

  if (staff.twoFactorEnabled) {
    res.json({ requiresTwoFactor: true, challengeToken: signChallenge(staff.id) })
    return
  }
  await startSession(res, staff)
})

authRouter.post('/verify-code', authLimiter, async (req, res) => {
  const body = parse(z.object({ challengeToken: z.string(), code: z.string() }), req.body)
  let staffId: string
  try {
    staffId = readChallenge(body.challengeToken).sub
  } catch {
    throw unauthorised('Your sign-in timed out. Please start again.')
  }

  const staff = await Staff.findById(staffId)
  if (!staff?.active || !staff.twoFactorSecret) throw unauthorised()
  if (!authenticator.check(body.code.trim(), staff.twoFactorSecret)) {
    throw unauthorised('That code is not right')
  }
  await startSession(res, staff)
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined })
  res.status(204).end()
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentStaff(req) })
})

const emailResetLink = (staff: Pick<StaffDoc, 'email' | 'name'>, token: string, subject: string) =>
  sendEmail({
    to: staff.email,
    subject,
    html: `<p>Hi ${staff.name},</p><p><a href="${env.ADMIN_URL}/reset-password?token=${token}">Set your password</a></p><p>This link expires soon. If you did not expect it, ignore this email.</p>`,
  })

export const issueResetToken = async (staff: InstanceType<typeof Staff>, hours: number) => {
  const token = createSecret()
  staff.passwordResetHash = hashToken(token)
  staff.passwordResetExpires = new Date(Date.now() + hours * 3_600_000)
  await staff.save()
  return token
}

export const sendInvite = async (staff: InstanceType<typeof Staff>, hours: number) =>
  emailResetLink(
    staff,
    await issueResetToken(staff, hours),
    'You have been invited to Cooked by Ugo',
  )

// Always the same response, so this cannot be used to find out who has an account.
authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string() }), req.body)
  const staff = await Staff.findOne({ email: email.trim().toLowerCase(), active: true })
  if (staff)
    emailResetLink(staff, await issueResetToken(staff, RESET_TOKEN_HOURS), 'Reset your password')
  res.status(204).end()
})

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string(), password }), req.body)
  const staff = await Staff.findOne({
    passwordResetHash: hashToken(body.token),
    passwordResetExpires: { $gt: new Date() },
  })
  if (!staff) throw badRequest('This link has expired. Please ask for a new one.')

  staff.passwordHash = await hashPassword(body.password)
  staff.passwordResetHash = undefined
  staff.passwordResetExpires = undefined
  staff.tokenVersion += 1
  await staff.save()
  res.status(204).end()
})

authRouter.post('/two-factor/setup', requireAuth, async (req, res) => {
  const staff = currentStaff(req)
  if (staff.twoFactorEnabled) throw badRequest('Two-step sign-in is already on')

  staff.twoFactorSecret = authenticator.generateSecret()
  await staff.save()
  res.json({
    secret: staff.twoFactorSecret,
    otpauthUrl: authenticator.keyuri(staff.email, 'Cooked by Ugo', staff.twoFactorSecret),
  })
})

authRouter.post('/two-factor/enable', requireAuth, async (req, res) => {
  const { code } = parse(z.object({ code: z.string() }), req.body)
  const staff = currentStaff(req)
  if (!staff.twoFactorSecret || !authenticator.check(code.trim(), staff.twoFactorSecret)) {
    throw badRequest('That code is not right')
  }
  staff.twoFactorEnabled = true
  await staff.save()
  res.json({ user: staff })
})
