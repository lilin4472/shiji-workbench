export const EXTENSION_ANALYSIS_MODULE_IDS = ['timeline', 'policy', 'industry', 'risk', 'leads'] as const
export const ANALYSIS_RUN_STATUSES = ['not-started', 'running', 'partial', 'completed', 'failed', 'stale'] as const

export type ExtensionAnalysisModuleId = typeof EXTENSION_ANALYSIS_MODULE_IDS[number]
export type AnalysisRunStatus = typeof ANALYSIS_RUN_STATUSES[number]

export interface AnalysisRunState {
  opportunityId: string
  moduleId: ExtensionAnalysisModuleId
  targetSubjectName: string
  status: AnalysisRunStatus
  updatedAt: string
  message: string
  actualSearchCalls: number
  actualModelCalls: number
}

export function analysisRunKey(opportunityId: string, moduleId: ExtensionAnalysisModuleId): string {
  return `${opportunityId}:${moduleId}`
}

export function isAnalysisRunState(value: unknown): value is AnalysisRunState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<AnalysisRunState>
  return typeof state.opportunityId === 'string' && state.opportunityId.length > 0
    && EXTENSION_ANALYSIS_MODULE_IDS.includes(state.moduleId as ExtensionAnalysisModuleId)
    && typeof state.targetSubjectName === 'string' && state.targetSubjectName.length > 0
    && ANALYSIS_RUN_STATUSES.includes(state.status as AnalysisRunStatus)
    && typeof state.updatedAt === 'string' && !Number.isNaN(Date.parse(state.updatedAt))
    && typeof state.message === 'string'
    && Number.isInteger(state.actualSearchCalls) && (state.actualSearchCalls ?? -1) >= 0
    && Number.isInteger(state.actualModelCalls) && (state.actualModelCalls ?? -1) >= 0
}

/**
 * 一次运行的调用性质判定（用户口径 2026-09-17）：
 *   live      = 这次真的联网检索了（有新调用）
 *   cached    = 这次没新增调用，但用的是本机 6 小时缓存（缓存只能由真实检索写入）
 *   no-search = 一次都没搜、也没有缓存可用 => 不能算成功，必须按失败展示
 */
export type RunCallOutcome = 'live' | 'cached' | 'no-search'

/** 模块结果复用窗口（与搜索缓存同一个 6 小时）：窗口内点"重新分析"直接复用本机结果，0 次新调用。 */
export const ANALYSIS_RESULT_TTL_MS = 6 * 60 * 60 * 1_000

export function isAnalysisResultFresh(checkedAt: string, now: Date = new Date(), ttlMs: number = ANALYSIS_RESULT_TTL_MS): boolean {
  const time = Date.parse(checkedAt)
  if (!Number.isFinite(time)) return false
  const age = now.getTime() - time
  return age >= 0 && age < ttlMs
}

/** 卡片与对话栏统一口径：命中本机缓存时写这一句（用户 2026-09-17 指定）。 */
export function formatCachedResultLabel(checkedAt: string): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = Number.isNaN(date.getTime())
    ? '时间未知'
    : `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `检索成功 · 命中缓存（数据抓取于 ${stamp}） · 暂无更新`
}
export function runCallOutcome(result: { requestCount: number; cacheHit: boolean }): RunCallOutcome {
  if (result.requestCount > 0) return 'live'
  if (result.cacheHit) return 'cached'
  return 'no-search'
}
export function upsertAnalysisRun(states: AnalysisRunState[], next: AnalysisRunState): AnalysisRunState[] {
  const key = analysisRunKey(next.opportunityId, next.moduleId)
  return [next, ...states.filter((state) => analysisRunKey(state.opportunityId, state.moduleId) !== key)]
}

/**
 * A verified project-stage change can make existing downstream conclusions outdated.
 * Only mark analyses that actually exist; never create results for modules the user has not run.
 * Timeline owns the new stage evidence itself, so it remains current.
 */
export function markOpportunityAnalysesStale(
  states: AnalysisRunState[],
  opportunityId: string,
  updatedAt = new Date().toISOString(),
): AnalysisRunState[] {
  return states.map((state) => {
    if (state.opportunityId !== opportunityId || state.moduleId === 'timeline') return state
    if (state.status !== 'completed' && state.status !== 'partial') return state
    return {
      ...state,
      status: 'stale',
      updatedAt,
      message: '项目阶段已有新证据，原分析结果可能过期；请按需重新分析。',
    }
  })
}
