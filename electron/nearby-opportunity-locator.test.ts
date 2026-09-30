import { describe, expect, it, vi } from 'vitest'
import type { NearbyEnterpriseSearchTask, Opportunity } from '../shared/agent-contract.js'
import { createNearbyOpportunityLocator } from './nearby-opportunity-locator.js'

const task: NearbyEnterpriseSearchTask = {
  id: 'nearby-1', kind: 'nearby-enterprise-search', prompt: '附近项目',
  criteria: { address: '北京市东城区', radiusKm: 20, specialty: '机电安装', amountMin: 0, amountMax: 10000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 10 },
}

function opportunity(id: string, locationAddress: string | null): Opportunity {
  return {
    id, title: id, companyId: `company-${id}`, companyName: '示例公司', amountWan: 100, locationAddress,
    distanceKm: null, deadline: null, matchScore: 80, projectType: '工程', reason: '正文候选', evidenceIds: ['ev-1'],
    followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
  }
}

describe('nearby opportunity locator', () => {
  it('filters only located out-of-range items and keeps failed or missing addresses as pending', async () => {
    const geocode = vi.fn(async (address: string) => {
      if (address === task.criteria.address) return { longitude: 116.3942, latitude: 39.9048, normalizedAddress: address, checkedAt: '2026-09-07T00:00:00.000Z', requestCount: 1 as const, cacheHit: false }
      if (address === '北京市东城区东华门街道') return { longitude: 116.401, latitude: 39.91, normalizedAddress: address, checkedAt: '2026-09-07T00:00:00.000Z', requestCount: 1 as const, cacheHit: false }
      if (address === '上海市浦东新区') return { longitude: 121.55, latitude: 31.23, normalizedAddress: address, checkedAt: '2026-09-07T00:00:00.000Z', requestCount: 1 as const, cacheHit: false }
      throw new Error('地址无法定位')
    })
    const locate = createNearbyOpportunityLocator(geocode)

    const result = await locate(task, [
      opportunity('near', '北京市东城区东华门街道'),
      opportunity('far', '上海市浦东新区'),
      opportunity('failed', '北京市某待核地址'),
      opportunity('missing', null),
    ])

    expect(result.opportunities.map((item) => item.id)).toEqual(['near', 'failed', 'missing'])
    expect(result.opportunities[0]?.distanceKm).toBeGreaterThan(0)
    expect(result.opportunities[0]?.locationPoint).toEqual({ longitude: 116.401, latitude: 39.91 })
    expect(result.opportunities[1]?.distanceKm).toBeNull()
    expect(result.opportunities[1]?.locationPoint).toBeNull()
    expect(result.stats).toMatchObject({ centerLocated: true, locatedCount: 2, unlocatedCount: 2, filteredOutCount: 1 })
  })

  it('filters a geocoded Mianyang project beyond Chengdu 100km and never geocodes the tendering body as a substitute', async () => {
    const chengduTask: NearbyEnterpriseSearchTask = {
      ...task,
      criteria: { ...task.criteria, address: '成都天府软件园', radiusKm: 100 },
    }
    const geocode = vi.fn(async (address: string) => {
      if (address === '成都天府软件园') return { longitude: 104.06939, latitude: 30.54252, normalizedAddress: address, checkedAt: '2026-09-23T00:00:00.000Z', requestCount: 1 as const, cacheHit: false }
      if (address === '绵阳市涪城区项目施工地点') return { longitude: 104.73, latitude: 31.46, normalizedAddress: address, checkedAt: '2026-09-23T00:00:00.000Z', requestCount: 1 as const, cacheHit: false }
      throw new Error('unexpected geocode request')
    })
    const result = await createNearbyOpportunityLocator(geocode)(chengduTask, [
      opportunity('mianyang-project', '绵阳市涪城区项目施工地点'),
      { ...opportunity('company-only', null), companyName: '绵阳市某建设单位' },
    ])

    expect(result.stats.filteredOutCount).toBe(1)
    expect(result.opportunities.map((item) => item.id)).toEqual(['company-only'])
    expect(result.opportunities[0]).toMatchObject({ locationPoint: null, distanceKm: null })
    expect(geocode.mock.calls.map(([address]) => address)).not.toContain('绵阳市某建设单位')
  })
})
