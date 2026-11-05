import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { allowedOrigins, isProduction } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { accountsRouter } from './modules/accounts/accounts.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { catalogRouter } from './modules/catalog/catalog.routes.js'
import { contentRouter } from './modules/content/content.routes.js'
import { customersRouter } from './modules/customers/customers.routes.js'
import { dealsRouter } from './modules/deals/deals.routes.js'
import { offersRouter } from './modules/offers/offers.routes.js'
import { ordersRouter } from './modules/orders/orders.routes.js'
import { publicRouter } from './modules/orders/public.routes.js'
import { webhookRouter } from './modules/orders/webhook.routes.js'
import { reviewsRouter } from './modules/reviews/reviews.routes.js'
import { settingsRouter } from './modules/settings/settings.routes.js'
import { staffRouter } from './modules/staff/staff.routes.js'
import { UPLOADS_DIR, uploadsRouter } from './modules/uploads/uploads.routes.js'

export const createApp = () => {
  const app = express()
  if (isProduction) app.set('trust proxy', 1)

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors({ origin: allowedOrigins, credentials: true }))
  app.use('/api/webhooks', webhookRouter)
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  app.get('/health', (_req, res) => {
    const healthy = mongoose.connection.readyState === 1
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' })
  })

  app.use('/uploads', express.static(UPLOADS_DIR))
  app.use('/api/public', publicRouter)
  app.use('/api/account', accountsRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/orders', ordersRouter)
  app.use('/api/staff', staffRouter)
  app.use('/api/catalog', catalogRouter)
  app.use('/api/deals', dealsRouter)
  app.use('/api/offers', offersRouter)
  app.use('/api/reviews', reviewsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/content', contentRouter)
  app.use('/api/customers', customersRouter)
  app.use('/api/uploads', uploadsRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
