import { describe, expect, it } from 'vitest'
import type { Opportunity } from './domain'
import { opportunityMapPosition, splitNearbyMapOpportunities, splitNearbyOpportunities } from './nearby'

const base: Opportunity = {
  id: 'opp-1', title: '示例项目', companyId: 'company-1', companyName: '示例公司', amountWan: null,
  locationAddress: null, distanceKm: null, deadline: null, matchScore: 80, projectType: '工程', reason: '正文候选', evidenceIds: ['ev-1'],
  followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
}

describe('nearby opportunity positioning', () => {
  it('keeps candidates without a locally calculated distance off the map', () => {
    const result = splitNearbyOpportunities([base, { ...base, id: 'opp-2', distanceKm: 8.2 }])

    expect(result.located.map((item) => item.id)).toEqual(['opp-2'])
    expect(result.unlocated.map((item) => item.id)).toEqual(['opp-1'])
  })

  it('never substitutes a company or tendering-body address for a missing project location', () => {
    const companyOnly = { ...base, companyName: '绵阳市示例建设单位', locationAddress: null, distanceKm: null }
    const result = splitNearbyMapOpportunities([companyOnly, { ...base, id: 'located', locationAddress: '成都市武侯区项目现场', locationPoint: { longitude: 104.06, latitude: 30.65 }, distanceKm: 8.2 }])

    expect(result.located.map((item) => item.id)).toEqual(['located'])
    expect(result.pending.map((item) => item.id)).toEqual(['opp-1'])
  })

  it('keeps a candidate without a computed distance pending even if it has a raw point', () => {
    const result = splitNearbyMapOpportunities([{ ...base, locationPoint: { longitude: 104.06, latitude: 30.65 } }])

    expect(result.located).toEqual([])
    expect(result.pending).toHaveLength(1)
  })

  it('uses real distance for radial placement while keeping direction explicitly illustrative', () => {
    const near = opportunityMapPosition({ ...base, distanceKm: 2 }, 0, 10)
    const far = opportunityMapPosition({ ...base, distanceKm: 8 }, 0, 10)

    expect(Math.abs(far.top - 48)).toBeGreaterThan(Math.abs(near.top - 48))
  })
})
