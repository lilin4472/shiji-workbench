import { PROJECT_STAGE_DEFINITIONS, type ProjectStageFilter, type ProjectStageId } from './project-timeline.js'
import { projectBaseTitle } from './business-objects.js'
import type { LockedSearchTargets } from './locked-search-target.js'

export type StageSourceTier = 'primary' | 'owner' | 'discovery'

export interface StageSearchPlan {
  purpose: 'discovery' | 'nearby-enterprise' | 'timeline' | 'watch'
  targetStageId: ProjectStageFilter
  query: string
  maxCalls: 1
  acceptedSourceTiers: StageSourceTier[]
  cacheTtlMs: number
}

interface DiscoveryStageInput extends LockedSearchTargets {
  address: string
  specialty: string
  projectType: string
  timeWindow?: string
  targetStageId: ProjectStageFilter
}

interface NearbyEnterpriseSearchInput extends DiscoveryStageInput {
  radiusKm: number
}

export interface NearbyEnterpriseSearchPlan extends StageSearchPlan {
  purpose: 'nearby-enterprise'
  centerAddress: string
  radiusKm: number
  requiresLocalDistance: true
}

const stageTerms: Record<ProjectStageId, string> = {
  initiation: '立项 批复 备案 可行性研究',
  intention: '采购意向 招标计划 采购计划',
  tender: '招标公告 资格预审 投标截止',
  evaluation: '开标记录 评标报告 评审结果',
  candidate: '中标候选人公示 候选人',
  award: '中标结果 中标公告 成交公告',
  contract: '合同公告 采购合同 合同签订',
}

const FAST_STAGE_CACHE_MS = 6 * 60 * 60 * 1_000
const STABLE_STAGE_CACHE_MS = 24 * 60 * 60 * 1_000

function compact(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')
}

function ttlForStage(stageId: ProjectStageFilter): number {
  return stageId === 'tender' || stageId === 'evaluation' || stageId === 'candidate' || stageId === 'award'
    ? FAST_STAGE_CACHE_MS
    : STABLE_STAGE_CACHE_MS
}

export function buildDiscoveryStageSearchPlan(input: DiscoveryStageInput): StageSearchPlan {
  const projectType = input.projectType === '不限' ? '' : input.projectType
  // Search providers often interpret “未来/近 N 天” as a literal keyword and
  // collapse the result set to one page. Keep time as a local deterministic
  // gate; use a broad current-year hint for recall instead.
  const temporalHint = input.timeWindow && input.timeWindow !== '不限时间'
    ? `${new Date().getFullYear()} 最新`
    : ''
  const terms = input.targetStageId === 'all'
    ? '立项 采购意向 招标公告 中标结果 合同公告'
    : stageTerms[input.targetStageId]
  return {
    purpose: 'discovery',
    targetStageId: input.targetStageId,
    query: compact([quotePhrase(input.targetCompanyName ?? ''), quotePhrase(input.targetProjectName ?? ''), input.address, input.specialty, projectType, temporalHint, terms, '官方']),
    maxCalls: 1,
    acceptedSourceTiers: ['primary', 'owner'],
    cacheTtlMs: ttlForStage(input.targetStageId),
  }
}

export function buildNearbyEnterpriseSearchPlan(input: NearbyEnterpriseSearchInput, currentYear = new Date().getFullYear()): NearbyEnterpriseSearchPlan {
  const projectType = input.projectType === '不限' ? '' : input.projectType
  // Nearby searches need a current-period hint even when the UI leaves the
  // window open; otherwise the provider tends to return unrelated historical
  // pages and the local distance filter has nothing useful to rank.
  const temporalHint = `${currentYear} 最新`
  const terms = input.targetStageId === 'all'
    ? '采购意向 招标公告 中标结果 合同公告'
    : stageTerms[input.targetStageId]
  return {
    purpose: 'nearby-enterprise',
    targetStageId: input.targetStageId,
    // Keep the user-entered location as an exact phrase. Search providers do
    // not enforce a radius; this improves locality recall before the local
    // geocoder applies the actual distance check.
    query: compact([quotePhrase(input.targetCompanyName ?? ''), quotePhrase(input.targetProjectName ?? ''), quotePhrase(input.address), input.specialty, projectType, temporalHint, terms, '附近 招标 采购 项目']),
    maxCalls: 1,
    acceptedSourceTiers: ['primary', 'owner', 'discovery'],
    cacheTtlMs: ttlForStage(input.targetStageId),
    centerAddress: input.address.trim(),
    radiusKm: input.radiusKm,
    requiresLocalDistance: true,
  }
}

function quotePhrase(value: string): string {
  const normalized = value.replace(/["“”]/g, '').trim()
  return normalized ? `"${normalized}"` : ''
}

export function buildWatchStageSearchPlan(projectTitle: string, lastKnownStageId?: ProjectStageId): StageSearchPlan {
  if (!lastKnownStageId) return buildTimelineStageSearchPlan(projectTitle)
  const currentIndex = lastKnownStageId
    ? PROJECT_STAGE_DEFINITIONS.findIndex((stage) => stage.id === lastKnownStageId)
    : -1
  const nextStage = PROJECT_STAGE_DEFINITIONS[Math.min(currentIndex + 1, PROJECT_STAGE_DEFINITIONS.length - 1)]
  return {
    purpose: 'watch',
    targetStageId: nextStage.id,
    query: compact([quotePhrase(projectBaseTitle(projectTitle)), stageTerms[nextStage.id], stageTerms[lastKnownStageId], '更正 终止 官方']),
    maxCalls: 1,
    acceptedSourceTiers: ['primary', 'owner'],
    cacheTtlMs: ttlForStage(nextStage.id),
  }
}

export function buildTimelineStageSearchPlan(projectTitle: string, companyName = ''): StageSearchPlan {
  return {
    purpose: 'timeline',
    targetStageId: 'all',
    query: compact([quotePhrase(projectBaseTitle(projectTitle)), companyName, '立项 批复 备案 可行性研究 采购意向 招标计划 招标公告 开标 评标 中标候选人 中标结果 合同公告']),
    maxCalls: 1,
    acceptedSourceTiers: ['primary', 'owner', 'discovery'],
    cacheTtlMs: FAST_STAGE_CACHE_MS,
  }
}
