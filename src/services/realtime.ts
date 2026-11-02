import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { allowedOrigins } from '../config/env.js'
import { hasPermission, staffFromToken } from '../middleware/auth.js'
import { SESSION_COOKIE } from '../modules/auth/auth.tokens.js'

const KITCHEN_ROOM = 'kitchen'
const riderRoom = (riderId: string) => `rider:${riderId}`

let io: Server | null = null

const readCookie = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

export const startRealtime = (server: HttpServer) => {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } })

  io.use(async (socket, next) => {
    const staff = await staffFromToken(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE))
    if (!staff) {
      next(new Error('Please sign in'))
      return
    }
    socket.join(hasPermission(staff, 'orders') ? KITCHEN_ROOM : riderRoom(staff.id))
    next()
  })
}

/** Sends only an id, so order details always come through the permission-checked API. */
export const announceOrderChange = (order: { id: string; riderId?: string }) => {
  io?.to(KITCHEN_ROOM).emit('orders:changed', { id: order.id })
  if (order.riderId) io?.to(riderRoom(order.riderId)).emit('orders:changed', { id: order.id })
}
