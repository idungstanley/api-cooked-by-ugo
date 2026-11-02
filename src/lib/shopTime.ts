import { SHOP_TIME_ZONE } from '../config/constants.js'

const parts = (time: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: SHOP_TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(time)
      .map(({ type, value }) => [type, value]),
  )

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The shop's local time, whatever time zone the server runs in. */
export const shopNow = (time = new Date()) => {
  const { weekday, year, month, day, hour, minute } = parts(time)
  return {
    day: WEEKDAYS.indexOf(weekday ?? ''),
    date: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
  }
}

export const toMinutes = (clock: string) => {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

const labelFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export const formatSlot = (time: Date) => `Today, ${labelFormat.format(time).replace(' ', '')}`
