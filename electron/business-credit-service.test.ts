import { describe, expect, it, vi } from 'vitest'
import { createBusinessCreditDiscoveryService } from './business-credit-service.js'

describe('business credit discovery service', () => {
  it('uses one provider-neutral search call and returns the product-owned report', async () => {
    const search = vi.fn(async (request) => ({
      ...request,
      sources: [],
      evidenceRecords: [],
      truncated: false,
      requestCount: 1 as const,
      cacheHit: false,
      checkedAt: '2026-09-06T10:00:00.000Z',
    }))
    const discover = createBusinessCreditDiscoveryService(search)

    const result = await discover(' 示例建设发展有限公司 ', 'doubao')

    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith({
      provider: 'doubao',
      purpose: 'business-credit',
      query: '示例建设发展有限公司 工商登记 经营异常列入原因 移出原因 严重违法失信 行政处罚 违法事实 处罚决定书 处罚日期 处罚金额 履行情况 处理结果 失信被执行人 详情 官方',
    })
    expect(result.provider).toBe('doubao')
    expect(result).toMatchObject({ requestCount: 1, cacheHit: false, checkedAt: '2026-09-06T10:00:00.000Z' })
    expect(result.report).toMatchObject({ subjectName: '示例建设发展有限公司', overallStatus: 'unverified' })
  })

  it('uses the user focus as the dynamic discovery scope', async () => {
    const search = vi.fn(async (request) => ({
      ...request, sources: [], evidenceRecords: [], truncated: false,
      requestCount: 1 as const, cacheHit: false, checkedAt: '2026-09-13T10:00:00.000Z',
    }))
    const discover = createBusinessCreditDiscoveryService(search)

    const result = await discover('示例建设发展有限公司', 'doubao', '查近一年法定代表人变更和行政处罚')

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: '示例建设发展有限公司 查近一年法定代表人变更和行政处罚 工商信息 违法事实 处罚决定书 处罚日期 处罚金额 履行情况 处理结果 列入原因 移出原因 详情 公开来源',
    }))
    expect(result.focus).toBe('查近一年法定代表人变更和行政处罚')
  })

  it('rejects empty or implausibly long subjects before a provider call', async () => {
    const search = vi.fn()
    const discover = createBusinessCreditDiscoveryService(search)

    await expect(discover('   ', 'doubao')).rejects.toThrow('企业名称')
    await expect(discover('企'.repeat(121), 'doubao')).rejects.toThrow('企业名称')
    expect(search).not.toHaveBeenCalled()
  })
})
