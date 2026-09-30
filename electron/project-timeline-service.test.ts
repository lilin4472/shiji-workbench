import { describe, expect, it, vi } from 'vitest'
import { searchSourceToEvidenceRecord, type EvidenceDocumentExtraction } from '../shared/evidence-contract.js'
import type { ProjectTimelineDiscoveryRequest } from '../shared/project-timeline-discovery.js'
import type { SearchPort, SearchSource } from '../shared/search-contract.js'
import { createProjectTimelineDiscoveryService } from './project-timeline-service.js'

const request: ProjectTimelineDiscoveryRequest = {
  opportunityId: 'opp-1',
  projectTitle: '临港科创园二期机电安装工程招标公告',
  companyName: '临港建设有限公司',
  knownIdentifiers: [{ kind: 'project-number', value: 'LG-2026-01' }],
  mode: 'full',
}

function searchWith(source: SearchSource): SearchPort {
  return vi.fn(async (searchRequest) => ({
    ...searchRequest,
    sources: [source],
    evidenceRecords: [searchSourceToEvidenceRecord(source, {
      provider: searchRequest.provider,
      query: searchRequest.query,
      capturedAt: '2026-09-10T08:00:00.000Z',
    })],
    truncated: false,
    requestCount: 1 as const,
    cacheHit: false,
    checkedAt: '2026-09-10T08:00:00.000Z',
  }))
}

function readerFor(source: SearchSource, overrides: Partial<EvidenceDocumentExtraction> = {}) {
  return vi.fn(async () => ({
    sourceUrl: source.url,
    finalUrl: source.url,
    httpRequestCount: 1,
    mediaKind: 'html' as const,
    sizeBytes: 180,
    extraction: {
      processingStatus: 'content-ready' as const,
      text: '招标人：临港建设有限公司\n项目编号：LG-2026-01\n发布日期：2026年9月10日\n招标公告',
      title: source.title,
      publisherCandidate: source.publisher,
      provenanceTypeCandidate: 'unknown' as const,
      documentIdentifiers: [{ kind: 'project-number' as const, value: 'LG-2026-01' }],
      publishedAtCandidate: '2026-09-10',
      truncated: false,
      warnings: [],
      ...overrides,
    },
  }))
}

describe('project timeline discovery service', () => {
  it('uses one full-timeline search and confirms an official same-project stage without DSH', async () => {
    const source: SearchSource = {
      url: 'https://www.ccgp.gov.cn/timeline/tender', sourceClass: 'government',
      title: '临港科创园二期机电安装工程招标公告', publisher: '中国政府采购网',
    }
    const search = searchWith(source)
    const discover = createProjectTimelineDiscoveryService(search, async () => 'doubao', readerFor(source))

    const result = await discover(request)

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ provider: 'doubao', purpose: 'project-timeline', maxResults: 20 }))
    expect(result.confirmedStageEvidence).toEqual([expect.objectContaining({ evidenceId: `web:${source.url}`, stageId: 'tender', occurredAt: '2026-09-10' })])
    expect(result.evidenceRecords[0]?.assessment).toMatchObject({ status: 'assessed', grade: 'A', permittedUses: expect.arrayContaining(['stage-confirmation']) })
    expect(result.candidateEvidenceIds).toEqual([])
  })

  it('accepts a traceable repost from a configured reputable commercial publisher as grade B', async () => {
    const source: SearchSource = {
      url: 'https://www.bidcenter.com.cn/timeline/tender', sourceClass: 'other',
      title: '临港科创园二期机电安装工程招标公告', publisher: '中国采招网',
    }
    const read = readerFor(source, {
      provenanceTypeCandidate: 'explicit-repost',
      originalPublisherCandidate: '上海公共资源交易中心',
      originalUrlCandidate: 'https://www.shggzy.com/tender/1',
    })
    const discover = createProjectTimelineDiscoveryService(searchWith(source), async () => 'doubao', read)

    const result = await discover(request)

    expect(result.confirmedStageEvidence).toHaveLength(1)
    expect(result.evidenceRecords[0]?.assessment).toMatchObject({ status: 'assessed', grade: 'B' })
  })

  it('accepts an exact project page from the national transaction platform even when the body omits the owner name', async () => {
    const source: SearchSource = {
      url: 'https://bulletin.cebpubservice.cn/timeline/tender', sourceClass: 'other',
      title: '临港科创园二期机电安装工程招标公告', publisher: '中国招标投标公共服务平台',
    }
    const read = readerFor(source, {
      text: '项目编号：LG-2026-01\n发布日期：2026年9月10日\n招标公告',
    })
    const discover = createProjectTimelineDiscoveryService(searchWith(source), async () => 'doubao', read)

    const result = await discover(request)

    expect(result.confirmedStageEvidence).toHaveLength(1)
    expect(result.evidenceRecords[0]?.assessment).toMatchObject({ status: 'assessed', grade: 'A' })
  })

  it('keeps a matching but untraceable commercial page as a visible candidate', async () => {
    const source: SearchSource = {
      url: 'https://unknown.example.com/tender/1', sourceClass: 'other',
      title: '临港科创园二期机电安装工程招标公告', publisher: '未知聚合站',
    }
    const discover = createProjectTimelineDiscoveryService(searchWith(source), async () => 'doubao', readerFor(source))

    const result = await discover(request)

    expect(result.confirmedStageEvidence).toEqual([])
    expect(result.candidateEvidenceIds).toEqual([`web:${source.url}`])
    expect(result.evidenceRecords).toHaveLength(1)
  })

  it('rejects a different project even when it is an official stage page', async () => {
    const source: SearchSource = {
      url: 'https://www.ccgp.gov.cn/timeline/other', sourceClass: 'government',
      title: '另一园区道路工程招标公告', publisher: '中国政府采购网',
    }
    const read = readerFor(source, {
      title: source.title,
      text: '招标人：其他建设有限公司\n项目编号：OTHER-1\n发布日期：2026年9月10日\n招标公告',
      documentIdentifiers: [{ kind: 'project-number', value: 'OTHER-1' }],
    })
    const discover = createProjectTimelineDiscoveryService(searchWith(source), async () => 'doubao', read)

    const result = await discover(request)

    expect(result.confirmedStageEvidence).toEqual([])
    expect(result.evidenceRecords).toEqual([])
    expect(result.rejectedEvidenceIds).toEqual([`web:${source.url}`])
  })

  it('routes an immediate watch check to the next-stage purpose', async () => {
    const source: SearchSource = {
      url: 'https://www.ccgp.gov.cn/timeline/award', sourceClass: 'government',
      title: '临港科创园二期机电安装工程中标结果公告', publisher: '中国政府采购网',
    }
    const search = searchWith(source)
    const read = readerFor(source, {
      title: source.title,
      text: '招标人：临港建设有限公司\n项目编号：LG-2026-01\n发布日期：2026年9月20日\n中标结果公告',
      publishedAtCandidate: '2026-09-20',
    })
    const discover = createProjectTimelineDiscoveryService(search, async () => 'doubao', read)

    const result = await discover({ ...request, mode: 'watch-next', lastKnownStageId: 'candidate' })

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'project-watch', query: expect.stringContaining('中标结果') }))
    expect(result.confirmedStageEvidence[0]?.stageId).toBe('award')
  })
})
