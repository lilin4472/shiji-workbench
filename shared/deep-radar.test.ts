import { describe, expect, it } from 'vitest'
import type { BusinessProfile, Opportunity } from './agent-contract.js'
import { eligibleDeepRadarOpportunities, evaluateDeepRadarMatch } from './deep-radar.js'

const profile: BusinessProfile = {
  subjectType: 'enterprise', name: '示例机电公司', businessRegions: ['上海'], companyNature: '民营企业', scale: '50-100人',
  industries: ['建筑安装'], specialties: ['机电安装'], qualifications: ['建筑机电安装工程专业承包一级'],
  assetsAndEquipment: '常用施工设备', personnelAndExperience: '机电建造师 5 人', deliveryBoundary: '可承接单项 5000 万元项目', riskPreference: 'balanced',
}

const opportunity: Opportunity = {
  id: 'opp-1', title: '上海临港变配电安装工程', companyId: 'company-1', companyName: '上海示例建设中心',
  amountWan: 1200, locationAddress: '上海市浦东新区临港大道', distanceKm: null, deadline: null, matchScore: 95,
  projectType: '机电安装', reason: '正文确认为机电安装项目。', evidenceIds: ['ev-1'], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
}

describe('deep radar deterministic matching', () => {
  it('keeps a matching real opportunity eligible', () => {
    const result = evaluateDeepRadarMatch(profile, opportunity)

    expect(result.eligible).toBe(true)
    expect(result.hardMismatches).toEqual([])
    expect(result.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'region', status: 'match' }),
      expect.objectContaining({ id: 'specialty', status: 'match' }),
    ]))
  })

  it('does not let a high model score hide an explicit service-region mismatch', () => {
    const result = evaluateDeepRadarMatch(profile, { ...opportunity, locationAddress: '广东省深圳市南山区', matchScore: 99 })

    expect(result.eligible).toBe(false)
    expect(result.hardMismatches).toContain('服务地域不匹配')
    expect(result.dimensions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'region', status: 'hard-mismatch' })]))
  })

  it('keeps an unavailable project address unknown instead of inventing a region match', () => {
    const result = evaluateDeepRadarMatch(profile, { ...opportunity, locationAddress: null })

    expect(result.eligible).toBe(true)
    expect(result.dimensions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'region', status: 'unknown' })]))
  })

  it('removes an explicit out-of-region result from the radar result set', () => {
    const beijing = { ...opportunity, id: 'opp-beijing', locationAddress: '北京市朝阳区' }
    expect(eligibleDeepRadarOpportunities(profile, [beijing, opportunity])).toEqual([opportunity])
  })
})
