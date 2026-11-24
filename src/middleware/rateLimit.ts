import type { Request } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { env } from '../config/env.js'

/**
 * Behind the Cloudflare Tunnel every request reaches the API from the tunnel, so the visitor's
 * own address comes from Cloudflare's header. Only trusted when the API is reachable through
 * Cloudflare alone, as on the VM, because anyone could send the header otherwise.
 */
const visitorKey = (req: Request) => {
  const cloudflareIp = req.headers['cf-connecting-ip']
  const ip = env.TRUST_CLOUDFLARE && typeof cloudflareIp === 'string' ? cloudflareIp : req.ip
  return ipKeyGenerator(ip ?? 'unknown')
}

const limiter = (limit: number, minutes: number) =>
  rateLimit({
    windowMs: minutes * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: visitorKey,
    message: { message: 'Too many attempts. Please try again shortly.' },
  })

export const authLimiter = limiter(10, 15)
export const orderLimiter = limiter(20, 10)
export const enquiryLimiter = limiter(5, 60)
