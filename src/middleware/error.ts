import type { ErrorRequestHandler, RequestHandler } from 'express'
import multer from 'multer'
import { AppError } from '../lib/errors.js'

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: 'Not found' })
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.status).json({ message: error.message })
    return
  }
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'That image is too large. Use one under 10MB.'
        : error.message
    res.status(400).json({ message })
    return
  }
  // Internal details stay in the logs, never in the response.
  console.error(error)
  res.status(500).json({ message: 'Something went wrong' })
}
