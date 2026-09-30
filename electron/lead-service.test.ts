import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchSource } from '../shared/search-contract.js'
import type { IndustryChainResult } from '../shared/industry-chain.js'
import { buildLeadNodes, type LeadSourceNode } from '../shared/lead-contacts.js'
import type { SearchDocumentReadResult } from './search-document-reader.js'
import { buildLeadBootstrapQueries, createLeadService } from './lead-service.js'

function readResult(source: SearchSource, text: string): SearchDocumentReadResult {
  return {
    sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 0, mediaKind: 'text', sizeBytes: text.length,
    extraction: { processingStatus: 'content-ready', text, provenanceTypeCandidate: 'unknown', documentIdentifiers: [], truncated: false, warnings: [] },
  }
}
const PAD = '本页面由企业自行维护，联系电话与办公地址以公开信息为准。'.repeat(3)
const NAME = '成都智联机电设备有限公司'
const fullText = (name: string) => [`${name} 官网 - 联系我们`, '联系人：李静  手机：13800001111', '邮箱：sales@zhilian.example.com', '地址：成都市武侯区人民南路四段11号', PAD].join('\n')
const plainText = (name: string) => `${name}成立于2019年，主营机电设备销售与安装，服务市政基础设施项目。${PAD}`

function searchResult(query: string, sources: SearchSource[]): SearchResult {
  return {
    provider: 'doubao', purpose: 'lead-search', query, sources,
    evidenceRecords: sources.map((source, index) => ({
      id: `ev-${index}-${source.url}`, subject: { kind: 'company', name: '示例' }, title: source.title ?? '未命名',
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: { pageUrl: source.url, publisher: source.publisher ?? '未取得', provenanceType: 'original', documentIdentifiers: [], capturedAt: '2026-09-18T06:00:00.000Z', corroboratingEvidenceIds: [] },
      assessment: { status: 'assessed', claimType: 'general', grade: 'A', permittedUses: ['discovery'], reasons: [], missingChecks: [], assessedAt: '2026-09-18T06:00:00.000Z' },
    })),
    truncated: false, requestCount: 1, cacheHit: false, checkedAt: '2026-09-18T06:00:00.000Z',
  }
}
const node = (name: string): LeadSourceNode => ({
  id: `company:${name}`, name, relation: 'supplier', relationLabel: '供应商', relationQuote: `供应商：${name}`,
  confidence: 'confirmed', sources: [{ evidenceId: 'ev-seed', title: '采购意向公开', publisher: '示例采购人', tier: 'official' }],
})
const request = (nodes: LeadSourceNode[]) => ({
  opportunityId: 'opp-1', projectTitle: '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
  ownerName: '成都市武侯区智慧宜居建设开发有限公司', industry: '市政基础设施', nodes,
})
const source = (url: string): SearchSource[] => [{ url, sourceClass: 'other', title: '联系信息', publisher: '企业官网' }]

describe('获客执行器 v3（串行渠道铺底 + 模型循环 + 逐字校验）', () => {
  it('渠道铺底按顺序执行，首个渠道已取得四列时立即停止并逐值绑定来源', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, source('https://www.zhilian.example.com/contact')))
    const service = createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, fullText(NAME)))
    const result = await service(request([node(NAME)]))

    expect(search.mock.calls.length).toBe(1)
    expect(result.rows[0].contact[0].normalized).toBe('李静')
    expect(result.rows[0].email[0].normalized).toBe('sales@zhilian.example.com')
    expect(result.rows[0].phone[0].normalized).toBe('13800001111')
    expect(result.rows[0].address[0].normalized).toContain('成都市武侯区人民南路四段11号')
    expect(result.rows[0].email[0].sources[0].observedAt).toBe('2026-09-18T06:00:00.000Z')
    expect(result.rows[0].missing).toEqual([])
  })

  it('模型换渠道 search：继续检索并把新值补进来', async () => {
    let call = 0
    const search = vi.fn(async (input: { query: string }) => {
      call += 1
      return searchResult(input.query, source(`https://www.example.com/p${call}`))
    })
    const reader = vi.fn(async (r: SearchSource) => readResult(r, r.url.endsWith('p1') ? `${NAME} 联系人：李静\n${PAD}` : `${NAME} 邮箱：hr@zhilian.example.com\n${PAD}`))
    const runner = vi.fn(async () => JSON.stringify({ tool: 'search', query: `"${NAME}" 邮箱 官方` }))
    const service = createLeadService(search as never, async () => 'doubao', reader, runner)
    const result = await service(request([node(NAME)]))

    // 第一轮模型给的查询被采纳并真检索；第二轮它给了同一个词  按重复查询收口。
    expect(runner).toHaveBeenCalledTimes(2)
    expect(search.mock.calls.length).toBe(5)
    expect(result.rows[0].email[0].normalized).toBe('hr@zhilian.example.com')
    expect(result.queries).toContain(`"${NAME}" 邮箱 官方`)
  })

  it('模型 submit：逐字校验通过的非标准写法被采用，引文对不上的被丢弃并记缺口', async () => {
    const body = `${NAME} 总机电话 028-86112233 转 8021（办公室）\n${PAD}`
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, source('https://www.example.com/a')))
    const runner = vi.fn(async () => JSON.stringify({
      tool: 'submit',
      report: {
        contacts: [
          { kind: 'phone', value: '028-86112233 转 8021', evidenceId: 'E1', quote: '总机电话 028-86112233 转 8021（办公室）' },
          { kind: 'email', value: 'fake@example.com', evidenceId: 'E1', quote: '总机电话 028-86112233 转 8021' },
        ],
        openQuestions: ['没有找到邮箱'], assessment: '只拿到总机',
      },
    }))
    const service = createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, body), runner)
    const result = await service(request([node(NAME)]))

    expect(result.rows[0].phone.map((point) => point.normalized)).toContain('028-86112233 转 8021')
    expect(result.rows[0].email).toEqual([])
    expect(result.gaps.some((gap) => gap.includes('引文对不上原文'))).toBe(true)
  })

  it('模型重复查询 / 调用失败：都按已取得的确定性结果收口，不让获客失败', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, source('https://www.example.com/a')))
    const reader = async (r: SearchSource) => readResult(r, plainText(NAME))
    const repeat = createLeadService(search as never, async () => 'doubao', reader, async () => JSON.stringify({ tool: 'search', query: buildLeadBootstrapQueries(NAME)[0] }))
    const a = await repeat(request([node(NAME)]))
    expect(a.rows).toHaveLength(1)
    expect(search.mock.calls.length).toBe(4)

    const boom = createLeadService(search as never, async () => 'doubao', reader, async () => { throw new Error('DSH 不可用') })
    const b = await boom(request([node(NAME)]))
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0].missing).toEqual(['contact', 'email', 'phone', 'address'])
    expect(b.gaps.some((gap) => gap.includes('没有可核验的联系方式'))).toBe(true)
  })

  it('没有产业链节点时 0 次检索（硬门禁）', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, []))
    const result = await createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, ''))(request([]))
    expect(search).not.toHaveBeenCalled()
    expect(result.gaps[0]).toContain('请先在产业链跑一次')
  })

  it('同页别家公司不串号 + 节点排序不含甲方', async () => {
    const other = '成都别家设备有限公司'
    const text = [`${NAME} 联系方式：电话 028-86112233`, PAD, PAD, PAD, PAD, PAD, PAD, `${other} 电话 13900002222 邮箱 other@example.com`].join('\n')
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, source('https://www.example.com/list')))
    const result = await createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, text))(request([node(NAME)]))
    expect(result.rows[0].phone.map((point) => point.normalized)).toEqual(['028-86112233'])
    expect(result.rows[0].email).toEqual([])

    const chain: IndustryChainResult = {
      schemaVersion: 3,
      opportunityId: 'opp-1', projectTitle: '示例项目', owner: { name: '甲方单位', sources: [] },
      winners: [
        { id: 'c1', name: '线索中标', relation: 'historical-winner', relationQuote: '中标候选人：', sources: [], confidence: 'candidate' },
        { id: 'c2', name: '确认中标', relation: 'historical-winner', relationQuote: '中标人：', sources: [], confidence: 'confirmed' },
      ],
      suppliers: [{ id: 'c3', name: '确认供应商', relation: 'supplier', relationQuote: '供应商：', sources: [], confidence: 'confirmed' }],
      queries: [], requestCount: 3, cacheHit: false, checkedAt: '2026-09-18T06:00:00.000Z', gaps: [], boundary: '',
    }
    const nodes = buildLeadNodes(chain)
    expect(nodes.map((item) => item.name)).toEqual(['确认中标', '线索中标', '确认供应商'])
    expect(nodes.some((item) => item.name === '甲方单位')).toBe(false)
  })

  it('目标公司后紧跟另一家公司时，在下一主体处截断，不能吸入其联系人与电话', async () => {
    const other = '成都别家设备有限公司'
    const text = [
      `${NAME} 联系人：李静 电话：028-86112233`,
      `${other}`,
      '联系人：王强 电话：13900002222 邮箱：other@other.example.com',
      PAD,
    ].join('\n')
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, source('https://www.example.com/directory')))
    const result = await createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, text))(request([node(NAME)]))

    expect(result.rows[0].contact.map((point) => point.normalized)).toEqual(['李静'])
    expect(result.rows[0].phone.map((point) => point.normalized)).toEqual(['028-86112233'])
    expect(result.rows[0].email).toEqual([])
  })

  it('联系人可位于电话上一行，且不能因页面标题含报到须知而被整页误杀', async () => {
    const text = [
      `${NAME} 人力资源部联系方式`,
      '联 系 人：廖老师、夏老师',
      '联系 电话：028-87517072、028-87517135',
      PAD,
    ].join('\n')
    const sources: SearchSource[] = [{ url: 'https://www.example.com/notice', sourceClass: 'other', title: '毕业生报到须知', publisher: NAME }]
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, sources))
    const result = await createLeadService(search as never, async () => 'doubao', async (r) => readResult(r, text))(request([node(NAME)]))

    expect(result.rows[0].contact.map((point) => point.normalized)).toEqual(['廖老师', '夏老师'])
    expect(result.rows[0].phone.map((point) => point.normalized)).toEqual(['028-87517072', '028-87517135'])
  })
})
