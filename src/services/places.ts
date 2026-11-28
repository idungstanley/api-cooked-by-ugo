import { env } from '../config/env.js'
import { unprocessable } from '../lib/errors.js'

/**
 * Address search with Google Places (New). Calls go through the API, so the key never reaches
 * the browser. A session token groups the typing and the final pick into one billed session.
 */

const BASE = 'https://places.googleapis.com/v1'

export const addressSearchEnabled = () => Boolean(env.GOOGLE_MAPS_API_KEY)

export interface AddressSuggestion {
  id: string
  text: string
  secondary: string
}

export interface PlaceAddress {
  line1: string
  city: string
  postcode: string
}

const headers = (fieldMask?: string) => ({
  'content-type': 'application/json',
  'x-goog-api-key': env.GOOGLE_MAPS_API_KEY ?? '',
  ...(fieldMask ? { 'x-goog-fieldmask': fieldMask } : {}),
})

const SEARCH_FAILED = 'Address search is not available right now. Please type your address.'

/** Where results should come from first: a circle around the kitchen. */
export interface SearchNear {
  lat: number
  lng: number
  miles: number
}

/** Google allows a bias circle of up to 50 km. */
const MAX_RADIUS_METRES = 50_000

/** Suggestions for what the customer has typed so far, UK only, nearest the kitchen first. */
export const suggestAddresses = async (
  input: string,
  sessionToken: string,
  near?: SearchNear,
): Promise<AddressSuggestion[]> => {
  if (!addressSearchEnabled() || input.trim().length < 3) return []
  const response = await fetch(`${BASE}/places:autocomplete`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ['gb'],
      languageCode: 'en-GB',
      ...(near && {
        locationBias: {
          circle: {
            center: { latitude: near.lat, longitude: near.lng },
            radius: Math.min(near.miles * 1609.34, MAX_RADIUS_METRES),
          },
        },
        origin: { latitude: near.lat, longitude: near.lng },
      }),
    }),
  }).catch(() => null)
  if (!response?.ok) throw unprocessable(SEARCH_FAILED)

  const { suggestions = [] } = (await response.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string
        structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }
        text?: { text: string }
      }
    }[]
  }
  return suggestions.flatMap(({ placePrediction: place }) =>
    place
      ? [
          {
            id: place.placeId,
            text: place.structuredFormat?.mainText?.text ?? place.text?.text ?? '',
            secondary: place.structuredFormat?.secondaryText?.text ?? '',
          },
        ]
      : [],
  )
}

type Component = { longText: string; shortText: string; types: string[] }

/** Turns Google's address parts into the street, town and postcode the shop stores. */
export const toAddress = (components: Component[]): PlaceAddress => {
  const part = (type: string) =>
    components.find(({ types }) => types.includes(type))?.longText ?? ''
  const street = [part('street_number'), part('route')].filter(Boolean).join(' ')
  const line1 = [part('subpremise'), part('premise'), street].filter(Boolean).join(', ')
  return {
    line1,
    city: part('postal_town') || part('locality') || part('administrative_area_level_2'),
    postcode: part('postal_code'),
  }
}

/** The chosen suggestion's full address. Ends the billed session. */
export const placeAddress = async (
  placeId: string,
  sessionToken: string,
): Promise<PlaceAddress> => {
  if (!addressSearchEnabled()) throw unprocessable(SEARCH_FAILED)
  const url = `${BASE}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en-GB`
  const response = await fetch(url, { headers: headers('addressComponents') }).catch(() => null)
  if (!response?.ok) throw unprocessable(SEARCH_FAILED)
  const { addressComponents = [] } = (await response.json()) as { addressComponents?: Component[] }
  const address = toAddress(addressComponents)
  if (!address.postcode)
    throw unprocessable('That place has no postcode. Please pick your exact address.')
  return address
}
