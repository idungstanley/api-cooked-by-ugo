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

/**
 * Times left today for a scheduled order. A slot is when the kitchen starts on it, so it must
 * be in the future and inside opening hours. The food arrives preparation plus delivery later.
 */
export const getTodaySlots = (settings: ShopSettingsDoc, time = new Date()) => {
  const window = todaysWindow(settings, time)
  if (!window) return []

  const { minutes } = shopNow(time)
  const earliest = Math.max(minutes + 1, window.opens)
  const first = Math.ceil(earliest / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES
  const lead = leadMinutes(settings) * 60_000
  const slots: { at: number; label: string; arrivesAt: number; arrivalLabel: string }[] = []

  for (let slot = first; slot < window.closes; slot += SLOT_STEP_MINUTES) {
    const at = new Date(time.getTime() + (slot - minutes) * 60_000)
    at.setSeconds(0, 0)
    const arrives = new Date(at.getTime() + lead)
    slots.push({
      at: at.getTime(),
      label: formatSlot(at),
      arrivesAt: arrives.getTime(),
      arrivalLabel: formatSlot(arrives),
    })
  }
  return slots
}
