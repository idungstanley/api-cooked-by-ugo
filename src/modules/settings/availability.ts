import { SLOT_STEP_MINUTES } from '../../config/constants.js'
import { formatSlot, shopNow, toMinutes } from '../../lib/shopTime.js'
import { leadMinutes, type ShopSettingsDoc } from './settings.model.js'

const todaysWindow = (settings: ShopSettingsDoc, time: Date) => {
  const { day, date } = shopNow(time)
  if (settings.closures.some((closure) => closure.date === date)) return null
  const hours = settings.hours.find((entry) => entry.day === day)
  return hours?.open ? { opens: toMinutes(hours.opensAt), closes: toMinutes(hours.closesAt) } : null
}

export const isOpenAt = (settings: ShopSettingsDoc, time = new Date()) => {
  const window = todaysWindow(settings, time)
  const { minutes } = shopNow(time)
  return Boolean(window && minutes >= window.opens && minutes < window.closes)
}

/** Delivery times left today, far enough ahead to cook and deliver, and inside opening hours. */
export const getTodaySlots = (settings: ShopSettingsDoc, time = new Date()) => {
  const window = todaysWindow(settings, time)
  if (!window) return []

  const { minutes } = shopNow(time)
  const earliest = Math.max(minutes + leadMinutes(settings), window.opens)
  const first = Math.ceil(earliest / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES
  const slots: { at: number; label: string }[] = []

  for (let slot = first; slot < window.closes; slot += SLOT_STEP_MINUTES) {
    const at = new Date(time.getTime() + (slot - minutes) * 60_000)
    at.setSeconds(0, 0)
    slots.push({ at: at.getTime(), label: formatSlot(at) })
  }
  return slots
}
