import { describe, expect, it } from 'vitest'
import { toAddress } from '../src/services/places.js'

const component = (types: string[], longText: string) => ({ types, longText, shortText: longText })

describe('Google address parts', () => {
  it('builds the street, town and postcode the shop stores', () => {
    expect(
      toAddress([
        component(['street_number'], '12'),
        component(['route'], 'Daisy Field Way'),
        component(['postal_town'], 'Newcastle upon Tyne'),
        component(['administrative_area_level_2'], 'Tyne and Wear'),
        component(['postal_code'], 'NE13 9EW'),
      ]),
    ).toEqual({ line1: '12 Daisy Field Way', city: 'Newcastle upon Tyne', postcode: 'NE13 9EW' })
  })

  it('keeps the flat and building name in front of the street', () => {
    expect(
      toAddress([
        component(['subpremise'], 'Flat 3'),
        component(['premise'], 'Grey House'),
        component(['street_number'], '5'),
        component(['route'], 'Grey Street'),
        component(['locality'], 'Newcastle'),
        component(['postal_code'], 'NE1 6EE'),
      ]).line1,
    ).toBe('Flat 3, Grey House, 5 Grey Street')
  })
})
