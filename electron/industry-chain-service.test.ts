import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchSource } from '../shared/search-contract.js'
import type { SearchDocumentReadResult } from './search-document-reader.js'
import { createIndustryChainService } from './industry-chain-service.js'

function readResult(source: SearchSource, text: string): SearchDocumentReadResult {
  return {
    sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 0, mediaKind: 'text', sizeBytes: text.length,
    extraction: { processingStatus: 'content-ready', text, provenanceTypeCandidate: 'unknown', documentIdentifiers: [], truncated: false, warnings: [] },
  }
}

const WINNER_TEXT = [
  '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务中标结果公告',
  '中标人：四川中测检测技术有限公司',
  '中标金额：118.6 万元',
  '招标代理机构：华夏城投项目管理有限公司',
  '招标范围：地铁保护监测与配套服务',
  '采购人：成都市武侯区智慧宜居建设开发有限公司',
].join('\n')

const REGISTRY_TEXT = [
  '四川中测检测技术有限公司 工商信息 - 企查查',
  '法定代表人：王强',
  '所属行业：检验检测服务',
  '经营范围：建设工程质量检测；地铁保护监测技术服务。',
  '联系电话：028-86001234',
  '统一社会信用代码：91510100MA6XXXXXXX',
].join('\n')

const SUPPLIER_TEXT = [  '成都市武侯区智慧宜居建设开发有限公司采购意向公开',
  '采购人：成都市武侯区智慧宜居建设开发有限公司  联系电话：028-85123456',
  '供应商：成都智联机电设备有限公司',
  '分包单位：成都恒信劳务有限公司',
  '联合体成员：成都建工第八建筑工程有限公司',
  '法定代表人：张伟',
].join('\n')

function searchResult(query: string, sources: SearchSource[]): SearchResult {
  return {
    provider: 'doubao', purpose: 'industry-chain', query, sources,
    evidenceRecords: sources.map((source, index) => ({
      id: `ev-${index}-${source.url}`,
      subject: { kind: 'company', name: '示例' },
      title: source.title ?? '未命名',
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: {
        pageUrl: source.url, publisher: source.publisher ?? '未取得', provenanceType: 'original',
        documentIdentifiers: [], capturedAt: '2026-09-16T08:00:00.000Z', corroboratingEvidenceIds: [],
      },
      assessment: {
        status: 'assessed', claimType: 'general', grade: 'A', permittedUses: ['discovery'],
        reasons: [], missingChecks: [], assessedAt: '2026-09-16T08:00:00.000Z',
      },
    })),
    truncated: false, requestCount: 1, cacheHit: false, checkedAt: '2026-09-16T08:00:00.000Z',
  }
}

const request = {
  opportunityId: 'opp-1',
  projectTitle: '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
  companyName: '成都市武侯区智慧宜居建设开发有限公司',
  address: '四川省成都市武侯区',
  industry: '市政基础设施',
}

describe('产业链执行器', () => {
  it('第一阶段 3 组检索 + 第二阶段工商核对；中标人进"以往中标"，供应商/分包/联合体/代理进"上下游"', async () => {
    const search = vi.fn(async (input: { query: string }) => {
      if (input.query.includes('法定代表人')) {
        // 第二阶段：工商信息页（企查查类），用来补法人/行业/电话。
        return searchResult(input.query, [{ url: 'https://www.qcc.com/firm/abc.html', sourceClass: 'other', title: '企业信息 - 企查查', publisher: '企查查' }])
      }
      if (input.query.includes('中标')) {
        return searchResult(input.query, [{ url: 'https://www.cdwh.gov.cn/win.shtml', sourceClass: 'government', title: '中标结果公告', publisher: '成都市武侯区人民政府' }])
      }
      return searchResult(input.query, [{ url: 'https://www.cdwh.gov.cn/buy.shtml', sourceClass: 'government', title: '采购意向公开', publisher: '成都市武侯区人民政府' }])
    })
    const reader = vi.fn(async (source: SearchSource) => readResult(
      source,
      source.url.includes('qcc') ? REGISTRY_TEXT : source.url.includes('win') ? WINNER_TEXT : SUPPLIER_TEXT,
    ))
    const service = createIndustryChainService(search as never, async () => 'doubao', reader)

    const result = await service(request)

    // 第一阶段 3 组 + 第二阶段工商核对（默认最多 4 家）。
    expect(search.mock.calls.length).toBe(7)
    expect(search.mock.calls.filter((call) => call[0].query.includes('法定代表人')).length).toBe(4)
    expect(result.owner.name).toBe('成都市武侯区智慧宜居建设开发有限公司')
    expect(result.winners.map((company) => company.name)).toContain('四川中测检测技术有限公司')
    expect(result.winners[0].relationQuote).toContain('中标人')
    expect(result.winners[0].confidence).toBe('confirmed')
    const supplierNames = result.suppliers.map((company) => company.name)
    expect(supplierNames).toContain('成都智联机电设备有限公司')
    expect(supplierNames).toContain('成都恒信劳务有限公司')
    expect(supplierNames).toContain('成都建工第八建筑工程有限公司')
    expect(supplierNames).toContain('华夏城投项目管理有限公司')
    // 四维度：中标公告里没有法人/电话 → 由第二阶段工商页补上；行业领域保留公告里的招标范围（公告优先）。
    const winner = result.winners[0]
    expect(winner.legalPerson).toBe('王强')
    expect(winner.phone).toBe('028-86001234')
    expect(winner.industryField).toContain('地铁保护监测')
    expect(winner.sources.some((source) => source.tier === 'registry')).toBe(true)
    expect(result.queries).toHaveLength(7)
    expect(result.requestCount).toBe(7)
    // 用户口径（2026-09-17）：工商核对属于内部过程，不上卡片；核对确实发生了由上面的法人/电话字段证明。
    expect(result.gaps.some((gap) => gap.includes('工商信息核对'))).toBe(false)
  })

  it('一条关系都抽不到时如实记缺口，不编造公司与字段', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, [{ url: 'https://blog.example.com/x', sourceClass: 'other', title: '施工小知识' }]))
    const service = createIndustryChainService(search as never, async () => 'doubao', async (source) => readResult(source, '今天讲解道路施工的常见问题，与本次项目无关。'))

    const result = await service(request)

    expect(result.winners).toEqual([])
    expect(result.suppliers).toEqual([])
    expect(result.gaps.length).toBeGreaterThan(0)
    expect(result.gaps.some((gap) => gap.includes('未检索到以往中标'))).toBe(true)
  })

  it('网页直读失败时回退搜索服务正文（与时间链/政策链同一套兜底）', async () => {
    const body = `${WINNER_TEXT}\n${'补充说明。'.repeat(60)}`
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, [{
      url: 'https://www.cdwh.gov.cn/blocked.shtml', sourceClass: 'government', title: '中标结果公告', publisher: '成都市武侯区人民政府', content: body,
    }]))
    const service = createIndustryChainService(search as never, async () => 'doubao', async (source) => {
      if (source.content) return readResult(source, source.content)
      throw new Error('网页读取失败（HTTP 412）。')
    })

    const result = await service(request)

    expect(result.winners.length).toBeGreaterThan(0)
  })
})
