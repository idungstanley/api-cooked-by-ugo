import { env } from '../config/env.js'
import { unprocessable } from '../lib/errors.js'

export interface PostcodeLocation {
  postcode: string
  lat: number
  lng: number
  city: string
}

export interface AddressOption {
  id: string
  line1: string
  line2: string
  city: string
}

const POSTCODES_URL = 'https://api.postcodes.io/postcodes'
const IDEAL_POSTCODES_URL = 'https://api.ideal-postcodes.co.uk/v1/postcodes'
const CACHE_HOURS = 24

export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i

export const normalisePostcode = (postcode: string) => {
  const compact = postcode.replace(/\s/g, '').toUpperCase()
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

const cache = new Map<string, { location: PostcodeLocation; expires: number }>()

/** Lets tests and seed data skip the network for known postcodes. */
export const rememberPostcode = (location: PostcodeLocation) => {
  cache.set(normalisePostcode(location.postcode), {
    location: { ...location, postcode: normalisePostcode(location.postcode) },
    expires: Number.POSITIVE_INFINITY,
  })
}

/** Checks the postcode exists and finds where it is, using the free postcodes.io service. */
export const locatePostcode = async (postcode: string): Promise<PostcodeLocation> => {
  if (!UK_POSTCODE.test(postcode.trim())) throw unprocessable('Enter a valid UK postcode')
  const key = normalisePostcode(postcode)
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.location

  const response = await fetch(`${POSTCODES_URL}/${encodeURIComponent(key)}`).catch(() => null)
  if (response?.status === 404) throw unprocessable(`We could not find ${key}. Please check it.`)
  if (!response?.ok) throw unprocessable('We could not check your postcode. Please try again.')

  const { result } = (await response.json()) as {
    result: {
      postcode: string
      latitude: number | null
      longitude: number | null
      admin_district: string | null
    }
  }
  if (result.latitude === null || result.longitude === null) {
    throw unprocessable(`We could not find ${key}. Please check it.`)
  }

  const location = {
    postcode: result.postcode,
    lat: result.latitude,
    lng: result.longitude,
    city: result.admin_district ?? '',
  }
  cache.set(key, { location, expires: Date.now() + CACHE_HOURS * 3_600_000 })
  return location
}

export const addressLookupEnabled = Boolean(env.IDEAL_POSTCODES_API_KEY)

/**
 * Royal Mail addresses for a postcode, from Ideal Postcodes. Without a key the customer types
 * the street themselves, and the postcode and city are still checked.
 */
export const listAddresses = async (postcode: string): Promise<AddressOption[]> => {
  if (!env.IDEAL_POSTCODES_API_KEY) return []
  const url = `${IDEAL_POSTCODES_URL}/${encodeURIComponent(normalisePostcode(postcode))}?api_key=${env.IDEAL_POSTCODES_API_KEY}`
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) return []

  const { result } = (await response.json()) as {
    result: {
      udprn: number
      line_1: string
      line_2: string
      line_3: string
      post_town: string
    }[]
  }
  return result.map((address) => ({
    id: String(address.udprn),
    line1: address.line_1,
    line2: [address.line_2, address.line_3].filter(Boolean).join(', '),
    city: address.post_town,
  }))
}

const EARTH_RADIUS_MILES = 3958.8
const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** Straight-line distance, which is how the delivery radius on the map is drawn. */
export const milesBetween = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a))
}
