import { describe, expect, it } from 'vitest'
import { opportunityRetrievalLimit, requestedOpportunityCount } from './opportunity-request.js'

describe('opportunity request count', () => {
  it('honors an explicit project count without changing the persisted preset', () => {
    expect(requestedOpportunityCount('原始自由输入', 5, 2)).toBe(2)
    expect(opportunityRetrievalLimit('原始自由输入', 5, 2)).toBe(10)
  })

  it('keeps the selected preset when free input has no explicit count', () => {
    expect(requestedOpportunityCount('找机电安装招标公告', 10)).toBe(10)
    expect(opportunityRetrievalLimit('找机电安装招标公告', 10)).toBe(10)
  })

  it('caps wider retrieval at the supported 20-source limit', () => {
    expect(requestedOpportunityCount('原始自由输入', 5, 20)).toBe(20)
    expect(opportunityRetrievalLimit('原始自由输入', 5, 20)).toBe(20)
  })
})
