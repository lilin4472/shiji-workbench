import { describe, expect, it } from 'vitest'
import { analysisRunKey, formatCachedResultLabel, isAnalysisResultFresh, isAnalysisRunState, markOpportunityAnalysesStale, runCallOutcome, upsertAnalysisRun } from './analysis-run.js'

describe('extension analysis run state', () => {
  const partialRisk = {
    opportunityId: 'opp-real-1',
    moduleId: 'risk' as const,
    targetSubjectName: '真实招标主体有限公司',
    status: 'partial' as const,
    updatedAt: '2026-09-10T10:00:00.000Z',
    message: '已取得公开知识参考，仍需核验。',
    actualSearchCalls: 1,
    actualModelCalls: 0,
  }

  it('uses one stable key for the same opportunity and module', () => {
    expect(analysisRunKey('opp-real-1', 'risk')).toBe('opp-real-1:risk')
  })

  it('replaces an earlier status instead of creating a second state path', () => {
    const running = { ...partialRisk, status: 'running' as const, message: '正在搜索。' }
    expect(upsertAnalysisRun([running], partialRisk)).toEqual([partialRisk])
  })

  it('rejects malformed persisted states', () => {
    expect(isAnalysisRunState(partialRisk)).toBe(true)
    expect(isAnalysisRunState({ ...partialRisk, moduleId: 'unknown' })).toBe(false)
    expect(isAnalysisRunState({ ...partialRisk, actualSearchCalls: -1 })).toBe(false)
  })

  it('marks completed downstream analyses stale after a verified stage change without inventing unrun modules', () => {
    const timeline = { ...partialRisk, moduleId: 'timeline' as const, status: 'completed' as const }
    const policy = { ...partialRisk, moduleId: 'policy' as const, status: 'completed' as const }
    const otherProject = { ...partialRisk, opportunityId: 'opp-other', moduleId: 'industry' as const, status: 'completed' as const }

    const next = markOpportunityAnalysesStale([timeline, policy, partialRisk, otherProject], 'opp-real-1', '2026-09-12T10:00:00.000Z')

    expect(next.find((state) => state.moduleId === 'timeline')?.status).toBe('completed')
    expect(next.find((state) => state.moduleId === 'policy')?.status).toBe('stale')
    expect(next.find((state) => state.moduleId === 'risk')?.status).toBe('stale')
    expect(next.find((state) => state.opportunityId === 'opp-other')?.status).toBe('completed')
    expect(next.some((state) => state.moduleId === 'leads')).toBe(false)
  })
})

describe('runCallOutcome（这次到底检索没检索）', () => {
  it('有新调用 = live（真的联网检索了）', () => {
    expect(runCallOutcome({ requestCount: 3, cacheHit: false })).toBe('live')
  })
  it('没新调用但命中本机缓存 = cached（缓存只能由真实检索写入）', () => {
    expect(runCallOutcome({ requestCount: 0, cacheHit: true })).toBe('cached')
  })
  it('一次都没搜、也没有缓存 = no-search（必须按失败展示，不能算成功）', () => {
    expect(runCallOutcome({ requestCount: 0, cacheHit: false })).toBe('no-search')
  })
})

describe('模块结果复用窗口与命中缓存文案', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')
  it('6 小时内算新鲜，超过 6 小时就不新鲜，非法时间也不新鲜', () => {
    expect(isAnalysisResultFresh('2026-09-17T11:00:00.000Z', now)).toBe(true)
    expect(isAnalysisResultFresh('2026-09-17T06:30:00.000Z', now)).toBe(true)
    expect(isAnalysisResultFresh('2026-09-17T05:59:00.000Z', now)).toBe(false)
    expect(isAnalysisResultFresh('不是时间', now)).toBe(false)
  })
  it('命中缓存文案＝用户指定那句（检索成功 / 命中缓存 / 暂无更新 + 抓取时间）', () => {
    const label = formatCachedResultLabel('2026-09-17T08:43:00.000Z')
    expect(label).toContain('检索成功')
    expect(label).toContain('命中缓存')
    expect(label).toContain('暂无更新')
    expect(label).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/)
  })
})
