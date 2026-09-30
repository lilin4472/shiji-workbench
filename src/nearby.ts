import type { Opportunity } from './domain'

export function splitNearbyOpportunities(opportunities: Opportunity[]): {
  located: Opportunity[]
  unlocated: Opportunity[]
} {
  const located: Opportunity[] = []
  const unlocated: Opportunity[] = []
  for (const opportunity of opportunities) {
    if (opportunity.distanceKm === null) unlocated.push(opportunity)
    else located.push(opportunity)
  }
  return { located, unlocated }
}

/** Only a locally computed project-address point may be rendered as a tender location. */
export function splitNearbyMapOpportunities(opportunities: Opportunity[]): {
  located: Opportunity[]
  pending: Opportunity[]
} {
  const located: Opportunity[] = []
  const pending: Opportunity[] = []
  for (const opportunity of opportunities) {
    if (opportunity.locationPoint && opportunity.distanceKm !== null) located.push(opportunity)
    else pending.push(opportunity)
  }
  return { located, pending }
}

/** Distance is factual; angle only separates overlapping cards until a true basemap is connected. */
export function opportunityMapPosition(opportunity: Opportunity, index: number, radiusKm: number): { left: number; top: number } {
  const distance = opportunity.distanceKm ?? 0
  const radialPercent = Math.min(42, Math.max(8, radiusKm > 0 ? distance / radiusKm * 42 : 8))
  const angle = (-90 + index * 137.508) * Math.PI / 180
  return {
    left: 50 + Math.cos(angle) * radialPercent,
    top: 48 + Math.sin(angle) * radialPercent,
  }
}
