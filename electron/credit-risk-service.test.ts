import { describe, expect, it } from 'vitest'
import { buildCreditRiskQueries, detectSubjectType, type CreditRiskRequest } from '../shared/credit-risk.js'
import type { SearchPort, SearchRequest, SearchResult } from '../shared/search-contract.js'
import { SearchManager } from './search-manager.js'
import { createCreditRiskService } from './credit-risk-service.js'

// 回归（真实故障）：提交 a3efce0 把公开风险首轮 9 组检索改成 Promise.all 并发，
// 但 SearchManager 对同一供应商是单飞锁（并发第二个调用直接抛「搜索正在运行，请稍候」），
// 于是 Promise.all 立刻 reject、requestCount 停在 0，界面显示
// 「失败  实际调用 0 次搜索 / 0 次模型」公开风险完全无法检索。
// 这里按 main.ts 的真实组合（service -> SearchManager -> provider port）锁死这条路径，
// 保证首轮检索是串行的，且计划里的每一组查询都真的发出去。

const request: CreditRiskRequest = {
  opportunityId: 'risk-regression-1',
  projectTitle: '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
  companyName: '成都市武侯区智慧宜居建设开发有限公司',
  industry: '工程改造',
}

function emptyResult(searchRequest: SearchRequest): SearchResult {
  return { ...searchRequest, sources: [], evidenceRecords: [], truncated: false, requestCount: 1, cacheHit: false, checkedAt: '2026-09-17T08:00:00.000Z' }
}

function recordingPort(queries: string[], state: { live: number; maxLive: number }): SearchPort {
  return async (searchRequest) => {
    state.live += 1
    state.maxLive = Math.max(state.maxLive, state.live)
    queries.push(searchRequest.query)
    // 把并发窗口放宽一点：调用方只要并发，单飞锁一定命中。
    await new Promise((resolve) => setTimeout(resolve, 5))
    state.live -= 1
    return emptyResult(searchRequest)
  }
}

describe('createCreditRiskService + SearchManager（公开风险首轮检索）', () => {
  it('首轮检索串行执行，不会被单飞锁打断（0 次调用即失败的回归）', async () => {
    const manager = new SearchManager()
    const queries: string[] = []
    const state = { live: 0, maxLive: 0 }
    manager.register('doubao', recordingPort(queries, state))

    const service = createCreditRiskService((searchRequest) => manager.search(searchRequest))
    const result = await service(request)

    const planned = buildCreditRiskQueries(request, detectSubjectType(request.companyName).type)
    expect(planned.length).toBeGreaterThanOrEqual(5)
    for (const query of planned) expect(queries).toContain(query)
    expect(queries.length).toBeGreaterThanOrEqual(planned.length)
    // SearchManager 对同一供应商同一时刻只允许一个在跑。
    expect(state.maxLive).toBe(1)
    expect(result.subjectName).toBe(request.companyName)
    expect(result.requestCount).toBeGreaterThan(0)
  })

  it('同一供应商的并发检索会被 SearchManager 拒绝（这是"必须串行"的前提）', async () => {
    const manager = new SearchManager()
    manager.register('doubao', async (searchRequest) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return emptyResult(searchRequest)
    })

    const settled = await Promise.allSettled([
      manager.search({ provider: 'doubao', purpose: 'business-credit', query: '并发用例甲' }),
      manager.search({ provider: 'doubao', purpose: 'business-credit', query: '并发用例乙' }),
    ])
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1)
  })
})