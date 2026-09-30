import { describe, expect, it, vi } from 'vitest'
import type { SearchPort, SearchRequest, SearchResult } from '../shared/search-contract.js'
import { SearchManager } from './search-manager.js'

function result(request: SearchRequest): SearchResult {
  return {
    ...request,
    sources: [],
    evidenceRecords: [],
    truncated: false,
    requestCount: 1,
    cacheHit: false,
    checkedAt: '2026-09-06T10:00:00.000Z',
  }
}

describe('SearchManager', () => {
  it('routes all purposes through the registered provider port', async () => {
    const port: SearchPort = vi.fn(async (request) => result(request))
    const manager = new SearchManager()
    manager.register('doubao', port)
    const request: SearchRequest = { provider: 'doubao', purpose: 'business-credit', query: '示例公司 行政处罚' }

    await expect(manager.search(request)).resolves.toMatchObject(request)
    expect(port).toHaveBeenCalledWith(request)
  })

  it('rejects unavailable providers before a paid call can start', async () => {
    const manager = new SearchManager()

    await expect(manager.search({ provider: 'deepseek-official', purpose: 'diagnostic', query: '成都 招标' }))
      .rejects.toThrow('不可用')
  })
})
