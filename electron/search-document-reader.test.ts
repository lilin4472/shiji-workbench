import { describe, expect, it, vi } from 'vitest'
import type { SearchSource } from '../shared/search-contract.js'
import { createSearchDocumentReader } from './search-document-reader.js'

const publicResolution = async () => [{ address: '93.184.216.34', family: 4 as const }]

describe('search document reader', () => {
  // 2026-09-16：政府/交易平台站点对"非浏览器"UA 直接回 412（实测成都武侯区政府公告页），
  // 这里锁定"用常规浏览器请求头"，避免以后又被改回明显的爬虫标识。
  it('sends browser-like headers so official sites do not answer 412', async () => {
    const fetchImplementation = vi.fn(async () => new Response('<html><body><article>招标公告</article></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    await reader({ url: 'https://www.cdwh.gov.cn/wuhou/content_1.shtml', sourceClass: 'government' })

    const [, init] = fetchImplementation.mock.calls[0]
    const headers = ((init?.headers ?? {}) as Record<string, string>)
    expect(headers['user-agent']).toMatch(/^Mozilla\/5\.0/)
    expect(headers['accept-language']).toContain('zh-CN')
  })

  it('uses provider content without another network request', async () => {
    const fetchImplementation = vi.fn()
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })
    const source: SearchSource = {
      url: 'https://news.example.com/company/1',
      sourceClass: 'other',
      title: '企业信用报道',
      content: '来源：示例财经\n深圳市示例企业有限公司涉及一项待核验的行政处罚报道。',
    }

    const result = await reader(source)

    expect(fetchImplementation).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sourceUrl: source.url, finalUrl: source.url, httpRequestCount: 0, mediaKind: 'text' })
    expect(result.extraction.processingStatus).toBe('content-ready')
    expect(result.extraction.text).toContain('待核验')
  })

  it('reads and extracts a public commercial repost instead of rejecting it as non-government', async () => {
    const fetchImplementation = vi.fn(async () => new Response(`<!doctype html><html><head>
      <meta property="og:site_name" content="示例行业媒体"><title>项目公告转载</title>
    </head><body><article>
      <p>转载自：成都市公共资源交易服务中心</p>
      <p>发布日期：2026年9月7日</p>
      <p>项目编号：CD-2026-101</p>
      <p>这是公开商业网站转载的项目公告正文。</p>
    </article></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }))
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    const result = await reader({
      url: 'https://industry-media.example.com/repost/101',
      sourceClass: 'other',
    })

    expect(result.httpRequestCount).toBe(1)
    expect(result.extraction).toMatchObject({
      processingStatus: 'content-ready',
      publisherCandidate: '示例行业媒体',
      originalPublisherCandidate: '成都市公共资源交易服务中心',
      provenanceTypeCandidate: 'explicit-repost',
      publishedAtCandidate: '2026-09-07',
      documentIdentifiers: [{ kind: 'project-number', value: 'CD-2026-101' }],
    })
  })

  it('follows up to two explicit original links to reach the final tender page', async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/repost')) return new Response('<article><p>转载自：省公共资源交易中心</p><p><a href="/mirror">原文链接</a></p></article>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
      if (url.endsWith('/mirror')) return new Response('<article><p><a href="/detail">原文链接</a></p></article>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
      return new Response('<article><h1>机电安装工程招标公告</h1><p>招标人：最终建设单位</p></article>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
    })
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    const result = await reader({ url: 'https://industry.example.com/repost', sourceClass: 'other' })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      sourceUrl: 'https://industry.example.com/repost',
      finalUrl: 'https://industry.example.com/detail',
      httpRequestCount: 3,
    })
    expect(result.extraction.text).toContain('最终建设单位')
    expect(result.extraction.originalPublisherCandidate).toBe('省公共资源交易中心')
    expect(result.extraction.provenanceTypeCandidate).toBe('explicit-repost')
  })

  it('uses the search title to leave a same-host listing page for its matching detail page', async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/list')) return new Response('<main><a href="/other">其他采购项目公告</a><a href="/detail">四川省南部县机电安装工程招标公告</a></main>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
      return new Response('<article><h1>四川省南部县机电安装工程招标公告</h1><p>招标人：南部县示例建设单位</p></article>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
    })
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    const result = await reader({
      url: 'https://tender.example.com/list', sourceClass: 'other',
      title: '四川省南部县机电安装工程招标公告', snippet: '南部县 机电安装 招标公告',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(result.finalUrl).toBe('https://tender.example.com/detail')
    expect(result.extraction.text).toContain('南部县示例建设单位')
  })

  it('pins the actual request to the public address that passed validation', async () => {
    const requestImplementation = vi.fn(async () => new Response('<main>招标人：示例公司<br>招标公告</main>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
    const reader = createSearchDocumentReader({ requestImplementation, resolveHost: publicResolution })

    await reader({ url: 'https://public.example.com/tender/1', sourceClass: 'other' })

    expect(requestImplementation).toHaveBeenCalledWith(
      new URL('https://public.example.com/tender/1'),
      { address: '93.184.216.34', family: 4 },
      expect.any(AbortSignal),
    )
  })

  it('validates every redirect target before following it', async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    }))
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    await expect(reader({ url: 'https://public.example.com/start', sourceClass: 'other' }))
      .rejects.toThrow('本机或内网')
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it.each([
    'http://127.0.0.1/admin',
    'http://localhost/admin',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'https://user:password@example.com/page',
  ])('rejects unsafe URL %s before requesting it', async (url) => {
    const fetchImplementation = vi.fn()
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    await expect(reader({ url, sourceClass: 'other' })).rejects.toThrow()
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to a private address', async () => {
    const fetchImplementation = vi.fn()
    const reader = createSearchDocumentReader({
      fetchImplementation,
      resolveHost: async () => [{ address: '192.168.1.8', family: 4 }],
    })

    await expect(reader({ url: 'https://rebind.example.com/page', sourceClass: 'other' }))
      .rejects.toThrow('本机或内网')
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('stops before buffering a response declared over the size limit', async () => {
    const fetchImplementation = vi.fn(async () => new Response('small body', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-length': String(8 * 1024 * 1024 + 1),
      },
    }))
    const reader = createSearchDocumentReader({ fetchImplementation, resolveHost: publicResolution })

    await expect(reader({ url: 'https://public.example.com/large', sourceClass: 'other' }))
      .rejects.toThrow('过大')
  })
})
