import type { NearbyEnterpriseSearchTask, Opportunity } from '../shared/agent-contract.js'
import { haversineDistanceKm } from '../shared/geography.js'
import type { TiandituGeocodePort } from './tianditu-geocoder.js'

const MAX_PROJECT_ADDRESSES_PER_RUN = 5

export interface NearbyLocationStats {
  centerLocated: boolean
  locatedCount: number
  unlocatedCount: number
  filteredOutCount: number
  skippedForBudgetCount: number
}

export interface NearbyLocationResult {
  opportunities: Opportunity[]
  stats: NearbyLocationStats
}

export type NearbyOpportunityLocator = (task: NearbyEnterpriseSearchTask, opportunities: Opportunity[]) => Promise<NearbyLocationResult>

export function createNearbyOpportunityLocator(geocode: TiandituGeocodePort): NearbyOpportunityLocator {
  return async (task, opportunities) => {
    let center
    try {
      center = await geocode(task.criteria.address)
    } catch {
      return { opportunities, stats: { centerLocated: false, locatedCount: 0, unlocatedCount: opportunities.length, filteredOutCount: 0, skippedForBudgetCount: 0 } }
    }
    const addresses = [...new Set(opportunities.map((item) => item.locationAddress).filter((value): value is string => Boolean(value)))].slice(0, MAX_PROJECT_ADDRESSES_PER_RUN)
    const skippedAddresses = new Set([...new Set(opportunities.map((item) => item.locationAddress).filter((value): value is string => Boolean(value)))].slice(MAX_PROJECT_ADDRESSES_PER_RUN))
    const points = new Map<string, Awaited<ReturnType<TiandituGeocodePort>> | undefined>()
    await Promise.all(addresses.map(async (address) => {
      try { points.set(address, await geocode(address)) } catch { points.set(address, undefined) }
    }))
    let locatedCount = 0
    let unlocatedCount = 0
    let filteredOutCount = 0
    const located = opportunities.map((opportunity) => {
      const point = opportunity.locationAddress ? points.get(opportunity.locationAddress) : undefined
      if (!point) {
        unlocatedCount += 1
        return { ...opportunity, locationPoint: null, distanceKm: null }
      }
      locatedCount += 1
      return {
        ...opportunity,
        locationPoint: { longitude: point.longitude, latitude: point.latitude },
        distanceKm: Number(haversineDistanceKm(center, point).toFixed(1)),
      }
    }).filter((opportunity) => {
      if (opportunity.distanceKm === null || opportunity.distanceKm <= task.criteria.radiusKm) return true
      filteredOutCount += 1
      return false
    })
    return {
      opportunities: located,
      stats: {
        centerLocated: true, locatedCount, unlocatedCount, filteredOutCount,
        skippedForBudgetCount: opportunities.filter((item) => item.locationAddress && skippedAddresses.has(item.locationAddress)).length,
      },
    }
  }
}
