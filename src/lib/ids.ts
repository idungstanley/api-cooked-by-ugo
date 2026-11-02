import { nanoid } from 'nanoid'

export const createId = (prefix: string) => `${prefix}-${nanoid(10)}`
export const createSecret = () => nanoid(32)
