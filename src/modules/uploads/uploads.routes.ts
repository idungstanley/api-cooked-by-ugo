import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { v2 as cloudinary } from 'cloudinary'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../../config/env.js'
import { AppError, badRequest } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'

/** Phone photos are often over 5MB. Cloudinary's free plan accepts up to 10MB. */
const MAX_BYTES = 10 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

/** A copied placeholder such as `<your_api_secret>` passes start-up but fails every upload. */
if (env.CLOUDINARY_URL && !/^cloudinary:\/\/\d+:[^<>@\s]+@[\w-]+$/.test(env.CLOUDINARY_URL)) {
  console.warn('CLOUDINARY_URL should look like cloudinary://<api_key>:<api_secret>@<cloud_name>')
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, done) => done(null, file.mimetype in EXTENSIONS),
})

const saveToCloudinary = (buffer: Buffer) =>
  new Promise<string>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'cooked-by-ugo', resource_type: 'image' }, (error, result) => {
        if (error || !result) {
          // Cloudinary rejects with a plain object, so log it and give staff a clear message.
          console.error('Cloudinary upload failed', error)
          reject(
            new AppError(
              502,
              'Image storage rejected the upload. Check CLOUDINARY_URL on the server.',
            ),
          )
        } else resolve(result.secure_url)
      })
      .end(buffer)
  })

export const UPLOADS_DIR = path.resolve('uploads')

const saveLocally = async (buffer: Buffer, extension: string, origin: string) => {
  await mkdir(UPLOADS_DIR, { recursive: true })
  const name = `${createId('image')}${extension}`
  await writeFile(path.join(UPLOADS_DIR, name), buffer)
  return `${origin}/uploads/${name}`
}

export const uploadsRouter = Router()

uploadsRouter.post(
  '/',
  requireAuth,
  requirePermission('menu.edit', 'deals'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw badRequest('Upload a JPEG, PNG or WebP image under 10MB')
    const url = env.CLOUDINARY_URL
      ? await saveToCloudinary(req.file.buffer)
      : await saveLocally(
          req.file.buffer,
          EXTENSIONS[req.file.mimetype] ?? '',
          `${req.protocol}://${req.get('host')}`,
        )
    res.status(201).json({ url })
  },
)
