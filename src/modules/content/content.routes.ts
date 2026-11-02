import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../../lib/errors.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'
import { parse } from '../../middleware/validate.js'
import { Enquiry } from '../enquiries/enquiries.model.js'
import { CONTENT_ID, getContent, SiteContent } from './content.model.js'

const contentInput = z.object({
  announcement: z.string().trim(),
  heroHeadline: z.string().trim().min(3),
  heroText: z.string().trim().min(3),
  storyText: z.string().trim().min(3),
  phone: z.string().trim().min(6),
  email: z.email(),
  whatsappNumber: z.string().regex(/^\d{8,15}$/),
  areaLabel: z.string().trim().min(2),
  favouriteDishIds: z.array(z.string()).length(4),
})

export const contentRouter = Router()
contentRouter.use(requireAuth, requirePermission('content'))

contentRouter.get('/', async (_req, res) => {
  res.json(await getContent())
})

contentRouter.put('/', async (req, res) => {
  const input = parse(contentInput, req.body)
  res.json(await SiteContent.findByIdAndUpdate(CONTENT_ID, input, { returnDocument: 'after' }))
})

contentRouter.get('/enquiries', async (_req, res) => {
  res.json(await Enquiry.find().sort({ createdAt: -1 }))
})

contentRouter.patch('/enquiries/:id', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['new', 'replied', 'closed']) }), req.body)
  const enquiry = await Enquiry.findByIdAndUpdate(
    req.params.id,
    { status },
    { returnDocument: 'after' },
  )
  if (!enquiry) throw notFound('Enquiry')
  res.json(enquiry)
})
