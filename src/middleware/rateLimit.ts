import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'

const limiter = (limit: number, minutes: number) =>
  rateLimit({
    windowMs: minutes * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { message: 'Too many attempts. Please try again shortly.' },
  })

export const authLimiter = limiter(10, 15)
export const orderLimiter = limiter(20, 10)
export const enquiryLimiter = limiter(5, 60)
