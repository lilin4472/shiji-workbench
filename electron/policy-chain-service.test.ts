import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchSource } from '../shared/search-contract.js'
import type { SearchDocumentReadResult } from './search-document-reader.js'
import { createPolicyChainService } from './policy-chain-service.js'

function readResult(source: SearchSource, text: string): SearchDocumentReadResult {
  return {
    sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 0, mediaKind: 'text', sizeBytes: text.length,
    extraction: { processingStatus: 'content-ready', text, provenanceTypeCandidate: 'unknown', documentIdentifiers: [], truncated: false, warnings: [] },
  }
}

const NATIONAL_TEXT = [
  '财政部关于下达2026年度中央预算内投资计划的通知',
  '财建〔2026〕30号',
  '来源：财政部',
  '发布日期：2026年4月2日',
  '本次下达资金重点支持市政基础设施更新，纳入中央预算内投资管理。',
  '四川省、成都市应按项目清单于2026年内完成分解落实。',
  '各地要严格按照项目库管理要求组织申报，不得挤占挪用，资金使用情况按季度报送。',
  '对未按期完成分解的地区，将在下一年度额度分配中予以扣减。',
  '本通知自印发之日起执行，由财政部经济建设司负责解释，执行中如有问题请及时反馈。',
  '请各地发展改革、财政部门加强协同，确保项目按期开工并按月报送进展情况。',
].join('\n')

const PROVINCIAL_TEXT = [
  '四川省财政厅关于下达2026年度地方政府专项债券额度的通知',
  '川财债〔2026〕15号',
  '来源：四川省财政厅',
  '发布日期：2026年3月12日',
  '本次额度用于市政基础设施与城市更新，成都市应于2026年6月底前完成项目分解。',
].join('\n')

const MUNICIPAL_TEXT = [
  '成都市住房和城乡建设局关于印发市政基础设施提升实施细则的通知',
  '来源：成都市住房和城乡建设局',
  '发布日期：2026年5月20日',
  '本细则适用于本市市政基础设施提升项目。',
].join('\n')

function searchResult(query: string, sources: Array<{ source: SearchSource; text: string }>): SearchResult {
  return {
    provider: 'doubao', purpose: 'policy-chain', query,
    sources: sources.map((item) => item.source),
    evidenceRecords: sources.map((item, index) => ({
      id: `ev-${index}-${item.source.url}`,
      subject: { kind: 'company', name: '示例' },
      title: item.source.title ?? '未命名',
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: {
        pageUrl: item.source.url, publisher: item.source.publisher ?? '未取得', provenanceType: 'original',
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
  opportunityId: 'opp-1', projectTitle: '悦湖片区市政道路基础设施配套工程（四期）',
  companyName: '成都市武侯区智慧宜居建设开发有限公司', address: '四川省成都市武侯区',
  industry: '市政基础设施',
  stageDates: [{ stageId: 'tender', occurredAt: '2025-09-08' }, { stageId: 'tender', occurredAt: '2026-09-08' }],
}

describe('政策链执行器', () => {
  it('三级各检索一次，按正文抽文件并把"点名下級"的原句作为穿透证据', async () => {
    const docs: Record<string, string> = { national: NATIONAL_TEXT, provincial: PROVINCIAL_TEXT, municipal: MUNICIPAL_TEXT }
    const search = vi.fn(async (input: { query: string }) => {
      if (input.query.includes('国家')) {
        return searchResult(input.query, [{ source: { url: 'https://www.mof.gov.cn/n1', sourceClass: 'government', title: '财政部关于下达2026年度中央预算内投资计划的通知', publisher: '财政部' }, text: docs.national }])
      }
      if (input.query.includes('四川省')) {
        return searchResult(input.query, [{ source: { url: 'https://czt.sc.gov.cn/p1', sourceClass: 'government', title: '四川省财政厅关于下达2026年度地方政府专项债券额度的通知', publisher: '四川省财政厅' }, text: docs.provincial }])
      }
      return searchResult(input.query, [{ source: { url: 'https://cdzj.chengdu.gov.cn/m1', sourceClass: 'government', title: '成都市住房和城乡建设局关于印发市政基础设施提升实施细则的通知', publisher: '成都市住房和城乡建设局' }, text: docs.municipal }])
    })
    const service = createPolicyChainService(search as never, async () => 'doubao', async (source) => readResult(source, docs[source.url.includes('mof') ? 'national' : source.url.includes('czt.sc') ? 'provincial' : 'municipal']))

    const result = await service(request)

    expect(search).toHaveBeenCalledTimes(3)
    expect(result.regionPath.map((level) => level.label)).toEqual(['国家级', '四川省', '成都市'])
    expect(result.findings.map((finding) => finding.levelId)).toEqual(['national', 'provincial', 'municipal'])
    expect(result.findings[0]).toMatchObject({ kind: 'budget', documentNumber: '财建〔2026〕30号', publisher: '财政部', effectiveAt: '2026-04-02' })
    // 国家级正文点名"成都市"，省级正文点名"成都市" → 都有穿透证据；市级没有下级 → 无穿透。
    expect(result.findings[0].penetration.map((link) => link.targetLabel)).toContain('成都市')
    expect(result.findings[2].penetration).toEqual([])
    expect(result.predictions.length).toBeGreaterThan(0)
    expect(result.predictions.every((prediction) => prediction.basis.length > 0)).toBe(true)
    expect(result.cacheHit).toBe(false)
    expect(result.requestCount).toBe(3)
  })

  it('某一级没有可核验文件时如实说明（写在三级梯里，不进缺口），不补造', async () => {
    const search = vi.fn(async (input: { query: string }) => input.query.includes('四川省')
      ? searchResult(input.query, [{ source: { url: 'https://blog.example.com/x', sourceClass: 'other', title: '城市道路施工小知识' }, text: '今天讲解道路施工的常见问题，与政策无关。' }])
      : searchResult(input.query, []))
    const service = createPolicyChainService(search as never, async () => 'doubao', async (source) => readResult(source, source.url.includes('blog') ? '今天讲解道路施工的常见问题，与政策无关。' : ''))

    // 历史节奏也算依据，这里刻意不给阶段历史，验证"没有依据 ⇒ 没有预测"。
    const result = await service({ ...request, stageDates: [] })

    expect(result.findings).toEqual([])
    expect(result.predictions).toEqual([])
    // 用户口径（2026-09-17）：哪一级没检索到由三级梯自己显示，不再重复进缺口污染版面。
    expect(result.gaps.some((gap) => gap.includes('未检索到可核验的政策'))).toBe(false)
    expect(result.gaps.some((gap) => gap.includes('未取得可支撑预测的依据'))).toBe(true)
  })

  it('只有历史采购节奏时也会给预测，并在依据里写明历史日期', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, []))
    const service = createPolicyChainService(search as never, async () => 'doubao', async (source) => readResult(source, ''))

    const result = await service(request)

    expect(result.findings).toEqual([])
    expect(result.predictions).toHaveLength(1)
    expect(result.predictions[0]).toMatchObject({ basisKind: 'historical-cadence', certainty: 'forecast' })
    expect(result.predictions[0].basis).toContain('2025-09-08')
    // 有预测时不再报"缺少预测依据"的缺口，但仍要如实说明三级都没有文件。
    expect(result.gaps.some((gap) => gap.includes('未取得可支撑预测的依据'))).toBe(false)
    // 同上：三级都没有文件时也不再往缺口里写三行。
    expect(result.gaps.filter((gap) => gap.includes('未检索到可核验的政策'))).toHaveLength(0)
  })

  it('网页直读失败时回退搜索服务正文（与时间链同一套兜底）', async () => {
    const search = vi.fn(async (input: { query: string }) => searchResult(input.query, [{
      source: { url: 'https://www.mof.gov.cn/n2', sourceClass: 'government', title: '财政部关于下达2026年度中央预算内投资计划的通知', content: NATIONAL_TEXT },
      text: NATIONAL_TEXT,
    }]))
    const service = createPolicyChainService(search as never, async () => 'doubao', async (source) => {
      if (source.content) return readResult(source, source.content)
      throw new Error('网页读取失败（HTTP 412）。')
    })

    const result = await service(request)

    expect(result.findings.some((finding) => finding.levelId === 'national')).toBe(true)
  })
})
