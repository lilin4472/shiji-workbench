import { describe, expect, it, vi } from 'vitest'
import { createDoubaoPort, DOUBAO_BUSINESS_RESULTS, testDoubaoConnection } from './doubao-provider.js'

describe('Doubao Custom search provider', () => {
  it('uses one bounded request and preserves provider structure for evidence', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'req-1' },
      Result: {
        ResultCount: 2,
        TimeCost: 372,
        WebResults: [
          {
            Title: '临港机电安装工程招标公告',
            SiteName: '上海市公共资源交易中心',
            Url: 'https://example.gov.cn/tender/1',
            Snippet: '短摘要',
            Summary: '招标人：示例建设有限公司。招标公告。',
            Content: '招标人：示例建设有限公司。招标公告。预算金额：2000万元。',
            PublishTime: '2026-09-08T08:00:00+08:00',
            RankScore: 0.96,
            AuthInfoDes: '非常权威',
            AuthInfoLevel: 1,
          },
          { Title: '无链接卡片', Url: '', Snippet: '不应返回' },
        ],
      },
    }), { status: 200 }))
    const search = createDoubaoPort(async () => 'doubao-local-key', fetchMock as typeof fetch)

    const result = await search({ provider: 'doubao', purpose: 'nearby-enterprise', query: '上海临港 机电安装 招标公告', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://open.feedcoopapi.com/search_api/web_search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer doubao-local-key' }),
    }))
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(request).toMatchObject({
      Query: '上海临港 机电安装 招标公告',
      SearchType: 'web',
      Count: 5,
      EnableWaiting: true,
      MaxWaitTime: 10_000,
      Filter: { NeedContent: true, NeedUrl: true, AuthInfoLevel: 0 },
      QueryControl: { QueryRewrite: true },
      ContentFormats: 'markdown',
    })
    expect(result).toMatchObject({ provider: 'doubao', requestCount: 1, totalResults: 2, searchTimeMs: 372 })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      publisher: '上海市公共资源交易中心',
      sourceClass: 'government',
      snippet: '招标人：示例建设有限公司。招标公告。',
      content: '招标人：示例建设有限公司。招标公告。预算金额：2000万元。',
      authorityLabel: '非常权威',
      authorityLevel: 1,
      rankScore: 0.96,
    })
    expect(result.evidenceRecords[0]).toMatchObject({
      provenance: { publisher: '上海市公共资源交易中心' },
      discovery: { provider: 'doubao', providerAuthorityLabel: '非常权威', rankScore: 0.96 },
    })
    expect(JSON.stringify(result)).not.toContain('doubao-local-key')
  })

  it('keeps the bounded business default when a caller does not specify a result limit', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'req-default' },
      Result: { ResultCount: 0, WebResults: [] },
    }), { status: 200 }))
    const search = createDoubaoPort(async () => 'doubao-local-key', fetchMock as typeof fetch)

    await search({ provider: 'doubao', purpose: 'business-credit', query: '示例公司 信用' })

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(request.Count).toBe(DOUBAO_BUSINESS_RESULTS)
  })

  it('maps structured quota errors without exposing provider details', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ResponseMetadata: { Error: { CodeN: 10406, Message: 'secret provider text' } },
      Result: null,
    }), { status: 200 }))
    const search = createDoubaoPort(async () => 'doubao-secret', fetchMock as typeof fetch)

    await expect(search({ provider: 'doubao', purpose: 'diagnostic', query: '成都招标' }))
      .rejects.toThrow('免费额度')
  })

  it('requires a saved key and tests with one minimal result', async () => {
    const absentFetch = vi.fn()
    const absent = createDoubaoPort(async () => undefined, absentFetch)
    await expect(absent({ provider: 'doubao', purpose: 'diagnostic', query: '成都招标' })).rejects.toThrow('豆包搜索 Custom 版 API Key')
    expect(absentFetch).not.toHaveBeenCalled()

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ResponseMetadata: { RequestId: 'req-2' },
      Result: { ResultCount: 1, TimeCost: 100, WebResults: [{ Title: '中国政府网', Url: 'https://www.gov.cn/' }] },
    }), { status: 200 }))
    const result = await testDoubaoConnection('doubao-secret', fetchMock as typeof fetch)
    expect(result).toMatchObject({ connected: true, resultCount: 1 })
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(request.Count).toBe(1)
    expect(request.Filter.NeedContent).toBe(false)
  })
})
