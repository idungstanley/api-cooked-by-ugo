import type { Request, RequestHandler } from 'express'
import { ROLE_PERMISSIONS, type Permission } from '../config/constants.js'
import { forbidden, unauthorised } from '../lib/errors.js'
import { readSession, SESSION_COOKIE } from '../modules/auth/auth.tokens.js'
import { Staff, type StaffDoc } from '../modules/staff/staff.model.js'

declare module 'express-serve-static-core' {
  interface Request {
    staff?: InstanceType<typeof Staff>
  }
}

export const staffFromToken = async (token: string | undefined) => {
  if (!token) return null
  try {
    const { sub, version } = readSession(token)
    const staff = await Staff.findById(sub)
    return staff?.active && staff.tokenVersion === version ? staff : null
  } catch {
    return null
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const staff = await staffFromToken(req.cookies?.[SESSION_COOKIE])
  if (!staff) throw unauthorised()
  req.staff = staff
  next()
}

export const hasPermission = (staff: Pick<StaffDoc, 'role'>, permission: Permission) =>
  ROLE_PERMISSIONS[staff.role].includes(permission)

/** Allows anyone holding at least one of the listed permissions. */
export const requirePermission =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const { staff } = req
    if (!staff || !permissions.some((permission) => hasPermission(staff, permission))) {
      throw forbidden()
    }
    next()
  }

export const currentStaff = (req: Request) => {
  if (!req.staff) throw unauthorised()
  return req.staff
}
