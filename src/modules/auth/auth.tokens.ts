import { createHash } from 'node:crypto'
import type { CookieOptions } from 'express'
import jwt from 'jsonwebtoken'
import { CHALLENGE_MINUTES, SESSION_HOURS } from '../../config/constants.js'
import { env, isProduction } from '../../config/env.js'

export const SESSION_COOKIE = 'cbu_session'

interface SessionPayload {
  sub: string
  version: number
  purpose: 'session'
}

interface ChallengePayload {
  sub: string
  purpose: 'two-factor'
}

export const signSession = (staffId: string, version: number) =>
  jwt.sign({ sub: staffId, version, purpose: 'session' }, env.JWT_SECRET, {
    expiresIn: `${SESSION_HOURS}h`,
  })

export const signChallenge = (staffId: string) =>
  jwt.sign({ sub: staffId, purpose: 'two-factor' }, env.JWT_SECRET, {
    expiresIn: `${CHALLENGE_MINUTES}m`,
  })

const verify = <T>(token: string) => jwt.verify(token, env.JWT_SECRET) as T

export const readSession = (token: string) => {
  const payload = verify<SessionPayload>(token)
  if (payload.purpose !== 'session') throw new Error('Wrong token type')
  return payload
}

export const readChallenge = (token: string) => {
  const payload = verify<ChallengePayload>(token)
  if (payload.purpose !== 'two-factor') throw new Error('Wrong token type')
  return payload
}

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_HOURS * 3_600_000,
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
