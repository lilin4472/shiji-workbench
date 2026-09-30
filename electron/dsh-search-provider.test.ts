import { describe, expect, it, vi } from 'vitest'
import { createDshDeepSeekSearchPort, DSH_SEARCH_MAX_RESULTS, DSH_SEARCH_MAX_TOKENS, DSH_SEARCH_MAX_USES } from './dsh-search-provider'
import { classifyEvidenceUrl } from './search-source'

describe('DSH DeepSeek search provider probe', () => {
  it('uses one bounded provider request and returns only product-owned evidence fields', async () => {
    const search = vi.fn(async () => ({
      sources: Array.from({ length: 7 }, (_, index) => ({
        url: `https://example.com/${index}`,
        title: `来源 ${index}`,
        snippet: `摘要 ${index}`,
        publishedAt: '2026-09-06',
      })),
      truncated: false,
    }))
    const Provider = vi.fn(class {
      constructor(readonly resolveOptions: () => unknown) {}
      search = search
    })
    const port = createDshDeepSeekSearchPort(
      async () => ({ DeepSeekSearchProvider: Provider }),
      async () => 'sk-local-only',
    )

    const result = await port({ provider: 'deepseek-official', purpose: 'diagnostic', query: '成都 施工 招标公告 官方' })

    expect(Provider).toHaveBeenCalledOnce()
    expect(Provider.mock.instances[0].resolveOptions()).toMatchObject({
      apiKey: 'sk-local-only',
      model: 'deepseek-v4-flash',
      maxTokens: DSH_SEARCH_MAX_TOKENS,
      maxUses: DSH_SEARCH_MAX_USES,
    })
    expect(search).toHaveBeenCalledWith({ query: '成都 施工 招标公告 官方', maxResults: DSH_SEARCH_MAX_RESULTS }, expect.any(AbortSignal))
    expect(result.sources).toHaveLength(DSH_SEARCH_MAX_RESULTS)
    expect(result.evidenceRecords).toHaveLength(DSH_SEARCH_MAX_RESULTS)
    expect(result.evidenceRecords[0]).toMatchObject({
      provenance: { provenanceType: 'unknown', publisher: 'example.com' },
      assessment: { status: 'pending' },
      discovery: { provider: 'deepseek-official' },
    })
    expect(result).not.toHaveProperty('apiKey')
    expect(JSON.stringify(result)).not.toContain('sk-local-only')
  })

  it('rejects blank queries before loading the provider or reading credentials', async () => {
    const loadProvider = vi.fn()
    const readKey = vi.fn()
    const port = createDshDeepSeekSearchPort(loadProvider, readKey)

    await expect(port({ provider: 'deepseek-official', purpose: 'diagnostic', query: '   ' })).rejects.toThrow('搜索词')
    expect(loadProvider).not.toHaveBeenCalled()
    expect(readKey).not.toHaveBeenCalled()
  })

  it.each([
    ['https://www.gsxt.gov.cn/index.html', 'registry'],
    ['https://www.creditchina.gov.cn/xinyongfuwu/', 'credit-china'],
    ['https://zxgk.court.gov.cn/shixin/', 'court'],
    ['https://ggzyjy.sc.gov.cn/jyxx/1.html', 'government'],
    ['https://example.com/company', 'other'],
  ] as const)('classifies %s as %s', (url, sourceClass) => {
    expect(classifyEvidenceUrl(url)).toBe(sourceClass)
  })
})
