import { describe, expect, it, vi } from 'vitest'
import type { AgentTask } from '../shared/agent-contract.js'
import { searchSourceToEvidenceRecord } from '../shared/evidence-contract.js'
import { createOpportunityDiscoveryService } from './opportunity-discovery-service.js'

const task: AgentTask = {
  id: 'opportunity-task-1', kind: 'opportunity-search', prompt: '找项目',
  criteria: { address: '成都', radiusKm: 50, specialty: '机电安装', amountMin: 1000, amountMax: 9000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'tender', candidateLimit: 10 },
}

describe('opportunity discovery service', () => {
  it('uses the local default provider for one stage-aware search call', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao')

    const result = await discover(task)

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'doubao', purpose: 'opportunity-discovery', query: expect.stringContaining('招标公告'), maxResults: 10,
    }))
    expect(result.provider).toBe('doubao')
  })

  it('widens one search result pool when free input explicitly asks for two projects', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao')

    await discover({ ...task, prompt: '任意自由描述', inputMode: 'free', requestedCount: 2 })

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 10 }))
  })

  it('carries visible target conditions into the query and deterministic document gate', async () => {
    const source = { url: 'https://example.com/tender/target', sourceClass: 'government' as const, title: '目标园区机电工程招标公告' }
    const search = vi.fn(async (request) => ({
      ...request, sources: [source], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const readDocument = vi.fn(async () => ({
      sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 1, mediaKind: 'html' as const, sizeBytes: 80,
      extraction: {
        processingStatus: 'content-ready' as const,
        text: '招标人：成都其他建设有限公司\n目标园区机电工程招标公告',
        provenanceTypeCandidate: 'unknown' as const, documentIdentifiers: [], truncated: false, warnings: [],
      },
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao', readDocument)

    const result = await discover({ ...task, criteria: { ...task.criteria, targetCompanyName: '成都目标建设有限公司', targetProjectName: '目标园区机电工程' } })

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringMatching(/"成都目标建设有限公司".*"目标园区机电工程"/),
    }))
    expect(result.sources[0]?.opportunityChecks?.eligibleForModel).toBe(false)
  })

  it('honors a per-task provider override without calling the default resolver', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false, requestCount: 0 as const,
      cacheHit: true, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const getDefault = vi.fn(async () => 'doubao' as const)
    const discover = createOpportunityDiscoveryService(search, getDefault)

    await discover({ ...task, searchProvider: 'doubao' })

    expect(getDefault).not.toHaveBeenCalled()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ provider: 'doubao' }))
  })

  it('routes a nearby enterprise task through its own search purpose while reusing document checks', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao')

    await discover({ ...task, kind: 'nearby-enterprise-search' })

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'nearby-enterprise', query: expect.stringContaining('成都'), maxResults: 10,
    }))
  })

  it('keeps a nearby subject page without concrete procurement evidence out of project candidates', async () => {
    const source = {
      url: 'https://example.com/company/profile', sourceClass: 'other' as const,
      title: '成都示例建设有限公司企业介绍',
    }
    const search = vi.fn(async (request) => ({
      ...request, sources: [source], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-23T02:00:00.000Z',
    }))
    const readDocument = vi.fn(async () => ({
      sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 1, mediaKind: 'html' as const, sizeBytes: 120,
      extraction: {
        processingStatus: 'content-ready' as const,
        text: '建设单位：成都示例建设有限公司\n公司主营房屋建筑、机电安装和园区运营业务。',
        provenanceTypeCandidate: 'unknown' as const, documentIdentifiers: [], truncated: false, warnings: [],
      },
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao', readDocument)

    const result = await discover({ ...task, kind: 'nearby-enterprise-search' })

    expect(result.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: false,
      stageIds: [],
    })
    expect(result.sources[0]?.opportunityChecks?.reasons.join('')).toContain('具体招采项目证据')
  })

  it('keeps a concrete nearby tender notice available as a project candidate', async () => {
    const source = {
      url: 'https://example.com/tender/nearby-1', sourceClass: 'government' as const,
      title: '成都高新区产业园机电安装工程招标公告',
    }
    const search = vi.fn(async (request) => ({
      ...request, sources: [source], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-23T02:00:00.000Z',
    }))
    const readDocument = vi.fn(async () => ({
      sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 1, mediaKind: 'html' as const, sizeBytes: 180,
      extraction: {
        processingStatus: 'content-ready' as const,
        text: '招标人：成都高新建设有限公司\n项目编号：CDGX-2026-001\n投标截止时间：2026年10月20日',
        provenanceTypeCandidate: 'official' as const,
        documentIdentifiers: [{ kind: 'project-number' as const, value: 'CDGX-2026-001' }],
        truncated: false, warnings: [],
      },
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao', readDocument)

    const result = await discover({ ...task, kind: 'nearby-enterprise-search' })

    expect(result.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: true,
      stageIds: ['tender'],
    })
  })

  it('routes deep radar through an isolated search purpose', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false, requestCount: 1 as const,
      cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao')
    await discover({ ...task, kind: 'deep-radar-search', profile: {
      subjectType: 'enterprise', name: '示例安装企业', businessRegions: ['成都'], companyNature: '民营', scale: '50人',
      industries: ['建筑安装'], specialties: ['机电安装'], qualifications: [], assetsAndEquipment: '', personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
    } })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'deep-radar' }))
  })

  it('returns sources only after the formal discovery path applies document checks', async () => {
    const checkedAt = '2026-09-07T02:00:00.000Z'
    const source = { url: 'https://example.com/tender/1', sourceClass: 'other' as const, title: '园区招标公告' }
    const search = vi.fn(async (request) => ({
      ...request, sources: [source],
      evidenceRecords: [searchSourceToEvidenceRecord(source, { provider: 'doubao', query: request.query, capturedAt: checkedAt })],
      truncated: false, requestCount: 1 as const, cacheHit: false, checkedAt,
    }))
    const readDocument = vi.fn(async () => ({
      sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 1, mediaKind: 'html' as const, sizeBytes: 80,
      extraction: {
        processingStatus: 'content-ready' as const,
        text: '招标人：成都示例建设有限公司\n项目编号：CD-2026-1\n发布日期：2026年9月7日\n招标公告',
        provenanceTypeCandidate: 'unknown' as const,
        documentIdentifiers: [{ kind: 'project-number' as const, value: 'CD-2026-1' }],
        publishedAtCandidate: '2026-09-07', truncated: false, warnings: [],
      },
    }))
    const discover = createOpportunityDiscoveryService(search, async () => 'doubao', readDocument)

    const result = await discover(task)

    expect(readDocument).toHaveBeenCalledOnce()
    expect(result.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: true, stageIds: ['tender'] })
    expect(result.evidenceRecords[0]?.provenance.documentIdentifiers).toEqual([{ kind: 'project-number', value: 'CD-2026-1' }])
  })
})
