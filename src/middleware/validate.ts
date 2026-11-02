import type { z } from 'zod'
import { badRequest } from '../lib/errors.js'

export const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw badRequest(result.error.issues[0]?.message ?? 'Invalid request')
}
