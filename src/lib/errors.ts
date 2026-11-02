export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (message: string) => new AppError(400, message)
export const unauthorised = (message = 'Please sign in') => new AppError(401, message)
export const forbidden = (message = 'You do not have access to this') => new AppError(403, message)
export const notFound = (label: string) => new AppError(404, `${label} not found`)
export const conflict = (message: string) => new AppError(409, message)
export const unprocessable = (message: string) => new AppError(422, message)

export const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000
