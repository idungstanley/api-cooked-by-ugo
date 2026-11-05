import type { Request, RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { unauthorised } from '../../lib/errors.js'
import { Account } from './accounts.model.js'

const ACCOUNT_SESSION_DAYS = 30

interface AccountPayload {
  sub: string
  version: number
  purpose: 'account'
}

declare module 'express-serve-static-core' {
  interface Request {
    account?: InstanceType<typeof Account>
  }
}

/** Separate from staff sessions, so a customer token can never open the admin. */
export const signAccountSession = (accountId: string, version: number) =>
  jwt.sign({ sub: accountId, version, purpose: 'account' }, env.JWT_SECRET, {
    expiresIn: `${ACCOUNT_SESSION_DAYS}d`,
  })

const BEARER_PREFIX = 'Bearer '

export const accountFromRequest = async (req: Request) => {
  const header = req.headers.authorization
  if (!header?.startsWith(BEARER_PREFIX)) return null
  try {
    const payload = jwt.verify(header.slice(BEARER_PREFIX.length), env.JWT_SECRET) as AccountPayload
    if (payload.purpose !== 'account') return null
    const account = await Account.findById(payload.sub)
    return account?.tokenVersion === payload.version ? account : null
  } catch {
    return null
  }
}

export const requireAccount: RequestHandler = async (req, _res, next) => {
  const account = await accountFromRequest(req)
  if (!account) throw unauthorised()
  req.account = account
  next()
}

/** For routes that work for guests too, such as placing an order. */
export const optionalAccount: RequestHandler = async (req, _res, next) => {
  req.account = (await accountFromRequest(req)) ?? undefined
  next()
}

export const currentAccount = (req: Request) => {
  if (!req.account) throw unauthorised()
  return req.account
}
