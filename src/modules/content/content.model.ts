import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'
import { notFound } from '../../lib/errors.js'

export interface SiteContentDoc {
  _id: string
  announcement: string
  heroHeadline: string
  heroText: string
  storyText: string
  phone: string
  email: string
  whatsappNumber: string
  areaLabel: string
  favouriteDishIds: string[]
}

export const CONTENT_ID = 'site'

export const SiteContent = model<SiteContentDoc>(
  'SiteContent',
  new Schema<SiteContentDoc>(
    {
      _id: { type: String, default: CONTENT_ID },
      announcement: { type: String, default: '' },
      heroHeadline: String,
      heroText: String,
      storyText: String,
      phone: String,
      email: String,
      whatsappNumber: String,
      areaLabel: String,
      favouriteDishIds: [String],
    },
    baseOptions,
  ),
)

export const getContent = async () => {
  const content = await SiteContent.findById(CONTENT_ID)
  if (!content) throw notFound('Site content')
  return content
}
