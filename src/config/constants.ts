export type Role = 'owner' | 'kitchen' | 'rider'

export type Permission =
  | 'orders'
  | 'refunds'
  | 'deliveries'
  | 'history'
  | 'menu'
  | 'menu.edit'
  | 'options'
  | 'deals'
  | 'settings'
  | 'customers'
  | 'content'
  | 'reports'
  | 'staff'

/** Mirrors `src/constants/roles.ts` in the admin app. This copy is the one that is enforced. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'orders',
    'refunds',
    'deliveries',
    'history',
    'menu',
    'menu.edit',
    'options',
    'deals',
    'settings',
    'customers',
    'content',
    'reports',
    'staff',
  ],
  kitchen: ['orders', 'menu'],
  rider: ['deliveries'],
}

export const ORDER_STATUSES = [
  'pending-payment',
  'received',
  'preparing',
  'out-for-delivery',
  'delivered',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Status moves staff can make. Anything else is rejected. */
export const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  received: ['preparing'],
  preparing: ['out-for-delivery'],
  'out-for-delivery': ['delivered'],
}

export const SESSION_HOURS = 12
export const CHALLENGE_MINUTES = 5
export const RESET_TOKEN_HOURS = 2
export const INVITE_TOKEN_HOURS = 72
export const UNPAID_ORDER_MINUTES = 30
export const SHOP_TIME_ZONE = 'Europe/London'
export const MAX_ORDERS_RETURNED = 10_000
export const ACTIVE_WINDOW_HOURS = 24
export const SLOT_STEP_MINUTES = 30
