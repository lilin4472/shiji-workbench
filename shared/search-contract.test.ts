import { describe, expect, it } from 'vitest'
import { assertSearchRequest } from './search-contract.js'

describe('search contract', () => {
  it('accepts a bounded product search request', () => {
    const request: unknown = { provider: 'doubao', purpose: 'business-credit', query: '示例公司 行政处罚', maxResults: 10 }

    expect(() => assertSearchRequest(request)).not.toThrow()
  })

  it('accepts Doubao through the product search contract', () => {
    const request: unknown = { provider: 'doubao', purpose: 'diagnostic', query: '成都 施工 招标公告' }

    expect(() => assertSearchRequest(request)).not.toThrow()
  })

  it('accepts the separate nearby enterprise search purpose', () => {
    const request: unknown = { provider: 'doubao', purpose: 'nearby-enterprise', query: '成都高新区 机电安装 招标公告' }

    expect(() => assertSearchRequest(request)).not.toThrow()
  })

  it('accepts the separate deep radar search purpose', () => {
    expect(() => assertSearchRequest({ provider: 'doubao', purpose: 'deep-radar', query: '成都 机电安装 招标公告' })).not.toThrow()
  })

  it.each([
    { provider: 'unknown', purpose: 'diagnostic', query: '测试' },
    { provider: 'doubao', purpose: 'unknown', query: '测试' },
    { provider: 'doubao', purpose: 'diagnostic', query: '   ' },
    { provider: 'doubao', purpose: 'diagnostic', query: '查'.repeat(501) },
    { provider: 'doubao', purpose: 'opportunity', query: '成都 招标', maxResults: 12 },
  ])('rejects an unsupported or unbounded request', (request) => {
    expect(() => assertSearchRequest(request)).toThrow('搜索请求')
  })
})
