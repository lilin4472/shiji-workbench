import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Opportunity } from '../shared/agent-contract.js'
import type { AnalysisRunState } from '../shared/analysis-run.js'
import {
  businessGraphForOpportunity, loadAnalysisRuns, loadBusinessObjects, loadBusinessProfile, loadDeepRadarResults, loadOpportunities, loadOpportunityCatalog, loadOpportunitySearchCriteria,
  loadBusinessCreditDiscovery, loadBusinessCreditReviews, loadColorTheme, loadWorkspace, leadCandidatesForOpportunity, saveBusinessCreditDiscovery, saveBusinessCreditReview, saveBusinessObjects, saveBusinessProfile, saveOpportunitySearchCriteria,
  saveAnalysisRuns, saveColorTheme, saveDeepRadarResults, saveOpportunityCatalog,
} from './repository.js'

const searchCriteria = {
  address: '上海市临港新片区', radiusKm: 50, specialty: '机电安装', amountMin: 100,
  amountMax: 9000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all' as const, candidateLimit: 5 as const,
}

const searchedOpportunity: Opportunity = {
  id: 'opp-real-1', title: '真实搜索项目候选', companyId: 'company-real-1', companyName: '真实招标主体有限公司',
  amountWan: null, locationAddress: null, distanceKm: null, deadline: null, matchScore: 70, projectType: '工程建设',
  reason: '正文主体与招标阶段已命中。', evidenceIds: ['web:https://example.com/tender/1'],
  followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
}

describe('business graph repository', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds the selected real opportunity graph instead of falling back to the fixed demo project', () => {
    const graph = businessGraphForOpportunity(searchedOpportunity)

    expect(graph.project.name).toBe('真实搜索项目候选')
    expect(graph.companies).toContainEqual(expect.objectContaining({ id: 'company-real-1', name: '真实招标主体有限公司' }))
    expect(graph.relationships).toContainEqual(expect.objectContaining({ type: 'project-owner', evidenceIds: searchedOpportunity.evidenceIds }))
  })

  it('derives lead cards from that same graph and leaves missing contact details explicit', () => {
    const leads = leadCandidatesForOpportunity(searchedOpportunity)

    expect(leads).toEqual([expect.objectContaining({
      company: '真实招标主体有限公司', channel: '公开联系方式待提取', relationshipIds: expect.any(Array),
    })])
  })

  it('starts empty and removes persisted legacy demo opportunities', () => {
    const values = new Map<string, string>()
    values.set('shiji.opportunities.v3', JSON.stringify([
      { ...searchedOpportunity, id: 'opp-lingang-001' },
      searchedOpportunity,
    ]))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    expect(loadWorkspace()).toEqual({ activeView: 'simulation' })
    expect(loadOpportunities()).toEqual([searchedOpportunity])
  })

  it('returns users saved on the removed report view to the overview', () => {
    const values = new Map<string, string>([
      ['shiji.workspace.v3', JSON.stringify({ activeView: 'report', selectedOpportunityId: searchedOpportunity.id })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    expect(loadWorkspace()).toEqual({ activeView: 'overview', selectedOpportunityId: searchedOpportunity.id })
  })

  it('persists the porcelain theme and rejects unknown theme values', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    saveColorTheme('porcelain')
    expect(loadColorTheme()).toBe('porcelain')

    values.set('shiji.color-theme.v1', 'unknown')
    expect(loadColorTheme()).toBe('current')
  })

  it('migrates existing real search results into the single opportunity catalog', () => {
    const values = new Map<string, string>([
      ['shiji.opportunities.v3', JSON.stringify([searchedOpportunity])],
      ['shiji.search-evidence.v2', JSON.stringify([])],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    const catalog = loadOpportunityCatalog()

    expect(catalog.records[searchedOpportunity.id]).toEqual(searchedOpportunity)
    expect(catalog.currentResultIds).toEqual([searchedOpportunity.id])
  })

  it('moves legacy auto-selected nearby hits back to nearby without deleting project records', () => {
    const values = new Map<string, string>([
      ['shiji.opportunity-catalog.v1', JSON.stringify({
        version: 1, records: { [searchedOpportunity.id]: searchedOpportunity },
        currentResultIds: [searchedOpportunity.id], currentEvidenceIds: searchedOpportunity.evidenceIds, lifecycle: {},
      })],
      ['shiji.workspace.v3', JSON.stringify({ activeView: 'nearby', currentTask: { mode: 'nearby', opportunityIds: [searchedOpportunity.id] } })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    const catalog = loadOpportunityCatalog()
    expect(catalog.records[searchedOpportunity.id]).toEqual(searchedOpportunity)
    expect(catalog.nearbyResultIds).toEqual([searchedOpportunity.id])
    expect(catalog.currentResultIds).toEqual([])

    values.set('shiji.analysis-selection.v1', JSON.stringify([searchedOpportunity.id]))
    const explicitlyAnalyzed = loadOpportunityCatalog()
    expect(explicitlyAnalyzed.nearbyResultIds).toEqual([searchedOpportunity.id])
    expect(explicitlyAnalyzed.currentResultIds).toEqual([searchedOpportunity.id])
  })

  it('removes the three legacy demo records from the unified catalog on read', () => {
    const legacy = { ...searchedOpportunity, id: 'opp-lingang-001' }
    const values = new Map<string, string>()
    values.set('shiji.opportunity-catalog.v1', JSON.stringify({
      version: 1,
      records: { [legacy.id]: legacy, [searchedOpportunity.id]: searchedOpportunity },
      currentResultIds: [legacy.id, searchedOpportunity.id],
      currentEvidenceIds: ['ev-001', searchedOpportunity.evidenceIds[0]],
      lifecycle: { [legacy.id]: { status: 'active', updatedAt: '2026-09-10T10:00:00.000Z' } },
    }))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    const catalog = loadOpportunityCatalog()

    expect(catalog.records[legacy.id]).toBeUndefined()
    expect(catalog.records[searchedOpportunity.id]).toEqual(searchedOpportunity)
    expect(catalog.currentResultIds).toEqual([searchedOpportunity.id])
    expect(catalog.currentEvidenceIds).toEqual([searchedOpportunity.evidenceIds[0]])
    expect(catalog.lifecycle[legacy.id]).toBeUndefined()
  })


  it('persists archived and ignored states in the opportunity catalog', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const catalog = {
      version: 1 as const,
      records: { [searchedOpportunity.id]: searchedOpportunity },
      currentResultIds: [searchedOpportunity.id],
      currentEvidenceIds: searchedOpportunity.evidenceIds,
      lifecycle: { [searchedOpportunity.id]: { status: 'archived' as const, updatedAt: '2026-09-10T10:00:00.000Z' } },
    }

    saveOpportunityCatalog(catalog)

    expect(loadOpportunityCatalog()).toEqual(catalog)
  })

  it('persists reusable project and company objects separately from result cards', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    const saved = saveBusinessObjects([searchedOpportunity], [])
    const reloaded = loadBusinessObjects()

    expect(reloaded).toEqual(saved)
    expect(reloaded.companies['company-real-1']).toMatchObject({ name: '真实招标主体有限公司' })
    expect(reloaded.opportunityProjectIds['opp-real-1']).toMatch(/^project-/)
  })

  it('persists the visible one-time search criteria so restored results keep their original context', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    saveOpportunitySearchCriteria(searchCriteria)

    expect(loadOpportunitySearchCriteria({ ...searchCriteria, amountMin: 1000, candidateLimit: 10 })).toEqual(searchCriteria)
  })

  it('ignores malformed persisted search criteria instead of creating an invalid task', () => {
    const values = new Map<string, string>([['shiji.opportunity-search-criteria.v1', JSON.stringify({ ...searchCriteria, amountMax: 10 })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const fallback = { ...searchCriteria, amountMin: 1000, candidateLimit: 10 as const }

    expect(loadOpportunitySearchCriteria(fallback)).toEqual(fallback)
  })

  it('persists a complete long-term business profile separately from one-time search criteria', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const businessProfile = {
      subjectType: 'enterprise' as const, name: '示例机电公司', businessRegions: ['上海'], companyNature: '民营企业', scale: '50人',
      industries: ['建筑安装'], specialties: ['机电安装'], qualifications: ['机电一级'], assetsAndEquipment: '',
      personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced' as const,
    }

    saveBusinessProfile(businessProfile)

    expect(loadBusinessProfile()).toEqual(businessProfile)
    expect(values.get('shiji.opportunity-search-criteria.v1')).toBeUndefined()
  })

  it('persists deep radar results outside the automatic opportunity catalog', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    saveDeepRadarResults([searchedOpportunity])
    expect(loadDeepRadarResults()).toEqual([searchedOpportunity])
    expect(loadOpportunityCatalog().currentResultIds).toEqual([])
  })

  it('persists only valid extension analysis states', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const riskState: AnalysisRunState = {
      opportunityId: searchedOpportunity.id, moduleId: 'risk', targetSubjectName: searchedOpportunity.companyName,
      status: 'partial', updatedAt: '2026-09-10T10:00:00.000Z', message: '已取得公开知识参考，仍需核验。',
      actualSearchCalls: 1, actualModelCalls: 0,
    }

    saveAnalysisRuns([riskState])
    values.set('shiji.analysis-runs.v1', JSON.stringify([riskState, { ...riskState, moduleId: 'invalid' }]))

    expect(loadAnalysisRuns()).toEqual([riskState])
  })

  it('persists the complete credit discovery result by project and subject', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const result = {
      provider: 'doubao', query: '真实招标主体有限公司 经营异常', checkedAt: '2026-09-13T08:00:00.000Z', requestCount: 1 as const, cacheHit: false,
      report: {
        subjectName: searchedOpportunity.companyName, generatedAt: '2026-09-13T08:00:00.000Z', overallStatus: 'unverified' as const,
        coverage: { confirmed: 0, total: 5 }, checks: [], candidateSources: [], boundary: '未取得证据时保持未核验。',
      },
    }

    saveBusinessCreditDiscovery(searchedOpportunity.id, result)

    expect(loadBusinessCreditDiscovery(searchedOpportunity.id, searchedOpportunity.companyName)).toEqual(result)
    expect(loadBusinessCreditDiscovery('another-project', searchedOpportunity.companyName)).toBeUndefined()
  })

  it('persists one evidence-bound credit review per project, subject and dimension', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const first = {
      dimension: 'registration' as const, outcome: 'verified-clear' as const,
      evidence: { kind: 'web' as const, url: 'https://example.gov.cn/1' }, reviewedAt: '2026-09-13T09:00:00.000Z', note: '',
    }
    const replacement = { ...first, outcome: 'record-found' as const, reviewedAt: '2026-09-13T10:00:00.000Z' }

    saveBusinessCreditReview(searchedOpportunity.id, searchedOpportunity.companyName, first)
    saveBusinessCreditReview(searchedOpportunity.id, searchedOpportunity.companyName, replacement)

    expect(loadBusinessCreditReviews(searchedOpportunity.id, searchedOpportunity.companyName)).toEqual([replacement])
    expect(loadBusinessCreditReviews('other-project', searchedOpportunity.companyName)).toEqual([])
  })
})
