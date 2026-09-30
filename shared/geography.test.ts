import { describe, expect, it } from 'vitest'
import { haversineDistanceKm } from './geography.js'

describe('geography', () => {
  it('calculates distance locally from two validated coordinates', () => {
    const distance = haversineDistanceKm(
      { longitude: 116.3942, latitude: 39.9048 },
      { longitude: 116.4042, latitude: 39.9048 },
    )

    expect(distance).toBeGreaterThan(0.84)
    expect(distance).toBeLessThan(0.87)
  })
})
