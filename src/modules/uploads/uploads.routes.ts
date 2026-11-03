import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { v2 as cloudinary } from 'cloudinary'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../../config/env.js'
import { badRequest } from '../../lib/errors.js'
import { createId } from '../../lib/ids.js'
import { requireAuth, requirePermission } from '../../middleware/auth.js'

const MAX_BYTES = 5 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
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
        if (error || !result) reject(error ?? new Error('Upload failed'))
        else resolve(result.secure_url)
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
    if (!req.file) throw badRequest('Upload a JPEG, PNG or WebP image under 5MB')
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
