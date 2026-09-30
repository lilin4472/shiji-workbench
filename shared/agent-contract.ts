import { isProjectStageId, type ProjectStageEvidence, type ProjectStageFilter } from './project-timeline.js'
import type { UserSearchProviderId } from './search-preference.js'
import { isEvidenceRecord, type EvidenceRecord } from './evidence-contract.js'
import { isGeoPoint, type GeoPoint } from './geography.js'

export type NearbyAudience = 'personal' | 'enterprise'

export type CandidateLimit = 5 | 10 | 20
export type SearchInputMode = 'conditions' | 'free'

/** Long-term user capability profile used by deep matching, never by a single search request alone. */
export interface BusinessProfile {
  subjectType: 'enterprise' | 'team' | 'individual'
  name: string
  businessRegions: string[]
  companyNature: string
  scale: string
  industries: string[]
  specialties: string[]
  qualifications: string[]
  assetsAndEquipment: string
  personnelAndExperience: string
  deliveryBoundary: string
  riskPreference: 'conservative' | 'balanced' | 'growth'
}

export function isBusinessProfile(value: unknown): value is BusinessProfile {
  if (!isRecord(value)) return false
  return (value.subjectType === 'enterprise' || value.subjectType === 'team' || value.subjectType === 'individual')
    && typeof value.name === 'string'
    && stringArray(value.businessRegions)
    && typeof value.companyNature === 'string'
    && typeof value.scale === 'string'
    && stringArray(value.industries)
    && stringArray(value.specialties)
    && stringArray(value.qualifications)
    && typeof value.assetsAndEquipment === 'string'
    && typeof value.personnelAndExperience === 'string'
    && typeof value.deliveryBoundary === 'string'
    && (value.riskPreference === 'conservative' || value.riskPreference === 'balanced' || value.riskPreference === 'growth')
}

/** Conditions for one search run. This is not the user's long-term capability profile. */
export interface OpportunitySearchCriteria {
  /** Optional visible locks for an exact company/project-directed search. */
  targetCompanyName?: string
  targetProjectName?: string
  address: string
  radiusKm: number
  specialty: string
  amountMin: number
  amountMax: number
  projectType: string
  timeWindow: string
  targetStageId: ProjectStageFilter
  candidateLimit: CandidateLimit
}

export interface Opportunity {
  id: string
  title: string
  companyId: string
  companyName: string
  amountWan: number | null
  locationAddress: string | null
  /** Added only by the local Tianditu geocoder; never model-generated. */
  locationPoint?: GeoPoint | null
  distanceKm: number | null
  deadline: string | null
  matchScore: number
  projectType: string
  reason: string
  evidenceIds: string[]
  followUpLevel: '重点跟进' | '值得验证' | '持续观察'
  confidence: '高' | '中' | '中低'
  timelineEvidence: ProjectStageEvidence[]
}

export interface OpportunitySearchTask {
  id: string
  kind: 'opportunity-search'
  prompt: string
  criteria: OpportunitySearchCriteria
  /** Free mode sends the untouched prompt through the DSH intent pass first. */
  inputMode?: SearchInputMode
  /** Filled by the DSH intent pass; never inferred from a keyword parser. */
  requestedCount?: number
  searchQuery?: string
  searchProvider?: UserSearchProviderId
}

export interface NearbyEnterpriseSearchTask {
  id: string
  kind: 'nearby-enterprise-search'
  prompt: string
  criteria: OpportunitySearchCriteria
  inputMode?: SearchInputMode
  requestedCount?: number
  searchQuery?: string
  searchProvider?: UserSearchProviderId
}

export interface DeepRadarSearchTask {
  id: string
  kind: 'deep-radar-search'
  prompt: string
  /** Radar owns this profile. It must never be filled from automatic discovery. */
  profile: BusinessProfile
  /** Operational search criteria derived only from profile + radar input. */
  criteria: OpportunitySearchCriteria
  inputMode?: SearchInputMode
  requestedCount?: number
  searchQuery?: string
  searchProvider?: UserSearchProviderId
}

export type AgentTask = OpportunitySearchTask | NearbyEnterpriseSearchTask | DeepRadarSearchTask
/** 归纳任务独立导出：待 dsh-agent-backend 的类型收窄改完后，再考虑并入 AgentTask。 */
export type SynthesisTask = EvidenceSynthesisTask

export interface AgentRunEvent {
  taskId: string
  type: 'status' | 'result' | 'error'
  message: string
}

export interface AgentRunResult {
  taskId: string
  backend: string
  completedAt: string
  opportunities: Opportunity[]
  /** Model-selected handoff or clarification; must not overwrite project results. */
  handoff?: { route: 'risk' | 'clarify'; subject: string; message: string }
  interpretedCriteria?: OpportunitySearchCriteria
  evidenceRecords?: EvidenceRecord[]
  discovery?: {
    provider: UserSearchProviderId
    query: string
    sourceCount: number
    requestCount: 0 | 1
    cacheHit: boolean
  }
}

export type AgentErrorCode = 'INVALID_TASK' | 'INVALID_RESULT' | 'TIMEOUT' | 'CANCELLED' | 'RUNTIME_ERROR'

export interface AgentErrorPayload {
  code: AgentErrorCode
  message: string
}

export type AgentRunResponse =
  | { ok: true; result: AgentRunResult }
  | { ok: false; error: AgentErrorPayload }

const followUpLevels = new Set<Opportunity['followUpLevel']>(['重点跟进', '值得验证', '持续观察'])
const confidences = new Set<Opportunity['confidence']>(['高', '中', '中低'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isOpportunitySearchCriteria(value: unknown): value is OpportunitySearchCriteria {
  if (!isRecord(value)) return false
  return (value.targetCompanyName === undefined || (typeof value.targetCompanyName === 'string' && value.targetCompanyName.length <= 120))
    && (value.targetProjectName === undefined || (typeof value.targetProjectName === 'string' && value.targetProjectName.length <= 180))
    && typeof value.address === 'string'
    && isFiniteNumber(value.radiusKm)
    && typeof value.specialty === 'string'
    && isFiniteNumber(value.amountMin)
    && isFiniteNumber(value.amountMax)
    && typeof value.projectType === 'string'
    && typeof value.timeWindow === 'string'
    && (value.targetStageId === 'all' || isProjectStageId(value.targetStageId))
    && (value.candidateLimit === 5 || value.candidateLimit === 10 || value.candidateLimit === 20)
    && value.radiusKm > 0
    && value.amountMin >= 0
    && value.amountMax >= value.amountMin
}

export function isOpportunity(value: unknown): value is Opportunity {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.companyId === 'string'
    && typeof value.companyName === 'string'
    && (value.amountWan === null || isFiniteNumber(value.amountWan))
    && (value.locationAddress === null || typeof value.locationAddress === 'string')
    && (value.locationPoint === undefined || value.locationPoint === null || isGeoPoint(value.locationPoint))
    && (value.distanceKm === null || isFiniteNumber(value.distanceKm))
    && (value.deadline === null || typeof value.deadline === 'string')
    && isFiniteNumber(value.matchScore)
    && typeof value.projectType === 'string'
    && typeof value.reason === 'string'
    && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every((id) => typeof id === 'string')
    && followUpLevels.has(value.followUpLevel as Opportunity['followUpLevel'])
    && confidences.has(value.confidence as Opportunity['confidence'])
    && Array.isArray(value.timelineEvidence)
    && value.timelineEvidence.every(isProjectStageEvidence)
}

function isProjectStageEvidence(value: unknown): value is ProjectStageEvidence {
  if (!isRecord(value)) return false
  return typeof value.evidenceId === 'string'
    && isProjectStageId(value.stageId)
    && typeof value.occurredAt === 'string'
    && typeof value.title === 'string'
    && typeof value.source === 'string'
}

export function assertAgentTask(value: unknown): asserts value is AgentTask {
  // 新任务类型单独校验，不影响原有三种任务的断言逻辑。
  if (isEvidenceSynthesisTask(value)) return
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || (value.kind !== 'opportunity-search' && value.kind !== 'nearby-enterprise-search' && value.kind !== 'deep-radar-search')
    || typeof value.prompt !== 'string'
    || value.prompt.trim().length === 0
    || value.prompt.length > 300
    || (value.inputMode !== undefined && value.inputMode !== 'conditions' && value.inputMode !== 'free')
    || (value.requestedCount !== undefined && (!isFiniteNumber(value.requestedCount) || value.requestedCount < 1 || value.requestedCount > 20 || !Number.isInteger(value.requestedCount)))
    || (value.searchQuery !== undefined && (typeof value.searchQuery !== 'string' || value.searchQuery.length > 1000))
    || (value.searchProvider !== undefined && value.searchProvider !== 'doubao')
    || !isOpportunitySearchCriteria(value.criteria)
    || (value.kind === 'deep-radar-search' && !isBusinessProfile(value.profile))
    || (value.kind !== 'deep-radar-search' && value.profile !== undefined)) {
    throw new Error('任务参数不完整或超出当前支持范围。')
  }
}

export function assertAgentRunResult(value: unknown): asserts value is AgentRunResult {
  if (!isRecord(value)
    || typeof value.taskId !== 'string'
    || typeof value.backend !== 'string'
    || typeof value.completedAt !== 'string'
    || !Array.isArray(value.opportunities)
    || !value.opportunities.every(isOpportunity)
    || (value.interpretedCriteria !== undefined && !isOpportunitySearchCriteria(value.interpretedCriteria))
    || (value.handoff !== undefined && (!isRecord(value.handoff)
      || (value.handoff.route !== 'risk' && value.handoff.route !== 'clarify')
      || typeof value.handoff.subject !== 'string' || typeof value.handoff.message !== 'string'))
    || (value.evidenceRecords !== undefined && (!Array.isArray(value.evidenceRecords) || !value.evidenceRecords.every(isEvidenceRecord)))
    || (value.discovery !== undefined && !isDiscoverySummary(value.discovery))) {
    throw new Error('运行结果不符合识机业务数据格式。')
  }
}

function isDiscoverySummary(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.provider === 'doubao'
    && typeof value.query === 'string'
    && Number.isSafeInteger(value.sourceCount)
    && (value.sourceCount as number) >= 0
    && (value.requestCount === 0 || value.requestCount === 1)
    && typeof value.cacheHit === 'boolean'
}


/**
 * 第 4 种任务（2026-09-16 新增，只增不改）：证据约束归纳。
 * 输入只有编号材料 E1..En，模型只做"概括/责任归属/结论/建议性判断"，
 * 输出经本地引文校验后才允许进入界面（见 shared/evidence-synthesis.ts）。
 */
export interface EvidenceSynthesisTask {
  id: string
  kind: 'evidence-synthesis'
  /** 归纳场景：公开风险 / 政策预测。 */
  scope: 'credit-risk' | 'policy-forecast'
  subject: string
  subjectType?: string
  prompt: string
  evidenceIds: string[]
}

export function isEvidenceSynthesisTask(value: unknown): value is EvidenceSynthesisTask {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Partial<EvidenceSynthesisTask>
  return typeof task.id === 'string'
    && task.kind === 'evidence-synthesis'
    && (task.scope === 'credit-risk' || task.scope === 'policy-forecast')
    && typeof task.subject === 'string'
    && typeof task.prompt === 'string'
    && Array.isArray(task.evidenceIds)
}
