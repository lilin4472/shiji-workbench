import { describe, expect, it, vi } from 'vitest'
import type { SearchRequest, SearchResult } from '../shared/search-contract.js'
import { SearchCache, createCachedSearchPort } from './search-cache.js'

function result(request: SearchRequest): SearchResult {
  return {
    ...request, sources: [], evidenceRecords: [], truncated: false, totalResults: 0,
    requestCount: 1, cacheHit: false, checkedAt: '2026-09-06T08:00:00.000Z',
  }
}

describe('SearchCache', () => {
  it.each(['doubao'] as const)('reuses an unexpired normalized %s query without another paid request', async (provider) => {
    let content: string | undefined
    const cache = new SearchCache({ read: async () => content, write: async (value) => { content = value } })
    const port = vi.fn(async (request: SearchRequest) => result(request))
    const cachedPort = createCachedSearchPort(port, cache, {
      provider,
      ttlMs: 60_000,
      now: () => new Date('2026-09-06T08:00:00.000Z'),
    })

    const first = await cachedPort({ provider, purpose: 'diagnostic', query: ' 成都   招标公告 ' })
    const second = await cachedPort({ provider, purpose: 'business-credit', query: '成都 招标公告' })

    expect(port).toHaveBeenCalledOnce()
    expect(first).toMatchObject({ provider, cacheHit: false, requestCount: 1 })
    expect(second).toMatchObject({ provider, purpose: 'business-credit', cacheHit: true, requestCount: 0 })
  })

  it('rejects a provider mismatch before calling the paid port', async () => {
    const cache = new SearchCache({ read: async () => undefined, write: async () => undefined })
    const port = vi.fn(async (request: SearchRequest) => result(request))
    const cachedPort = createCachedSearchPort(port, cache, { provider: 'deepseek-official', ttlMs: 60_000 })

    await expect(cachedPort({ provider: 'doubao', purpose: 'diagnostic', query: '成都 招标公告' }))
      .rejects.toThrow('不匹配')
    expect(port).not.toHaveBeenCalled()
  })

  it('runs a new request after the cache expires', async () => {
    let content: string | undefined
    let now = new Date('2026-09-06T08:00:00.000Z')
    const cache = new SearchCache({ read: async () => content, write: async (value) => { content = value } })
    const port = vi.fn(async (request: SearchRequest) => result(request))
    const cachedPort = createCachedSearchPort(port, cache, { provider: 'doubao', ttlMs: 1_000, now: () => now })
    const request = { provider: 'doubao', purpose: 'diagnostic', query: '成都 招标公告' } as const

    await cachedPort(request)
    now = new Date('2026-09-06T08:00:02.000Z')
    const refreshed = await cachedPort(request)

    expect(port).toHaveBeenCalledTimes(2)
    expect(refreshed.cacheHit).toBe(false)
  })

  it('does not reuse a five-result cache entry for a later twenty-result request', async () => {
    let content: string | undefined
    const cache = new SearchCache({ read: async () => content, write: async (value) => { content = value } })
    const port = vi.fn(async (request: SearchRequest) => result(request))
    const cachedPort = createCachedSearchPort(port, cache, {
      provider: 'doubao', ttlMs: 60_000, now: () => new Date('2026-09-06T08:00:00.000Z'),
    })

    await cachedPort({ provider: 'doubao', purpose: 'opportunity', query: '成都 招标公告', maxResults: 5 })
    await cachedPort({ provider: 'doubao', purpose: 'opportunity', query: '成都 招标公告', maxResults: 20 })
    const repeated = await cachedPort({ provider: 'doubao', purpose: 'opportunity', query: '成都 招标公告', maxResults: 5 })

    expect(port).toHaveBeenCalledTimes(2)
    expect(repeated.cacheHit).toBe(true)
  })

  it('hydrates evidence records when reading a cache written by the previous result shape', async () => {
    const content = JSON.stringify({
      version: 1,
      entries: {
        '成都 招标公告': {
          expiresAt: '2026-09-06T09:00:00.000Z',
          result: {
            provider: 'doubao',
            query: '成都 招标公告',
            sources: [{ url: 'https://ggzyjy.sc.gov.cn/item/1', sourceClass: 'government', title: '招标公告' }],
            truncated: false,
            totalResults: 1,
            requestCount: 1,
            cacheHit: false,
            checkedAt: '2026-09-06T08:00:00.000Z',
          },
        },
      },
    })
    const cache = new SearchCache({ read: async () => content, write: async () => undefined })

    const cached = await cache.get('成都 招标公告', 'diagnostic', new Date('2026-09-06T08:30:00.000Z'))

    expect(cached?.evidenceRecords).toHaveLength(1)
    expect(cached?.evidenceRecords[0]).toMatchObject({
      provenance: { publisher: 'ggzyjy.sc.gov.cn', provenanceType: 'unknown' },
      assessment: { status: 'pending' },
    })
  })
})
