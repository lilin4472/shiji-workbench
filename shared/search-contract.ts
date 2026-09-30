import type { EvidenceRecord } from './evidence-contract.js'
import type { ProjectStageId } from './project-timeline.js'

export type SearchProviderId = 'doubao' | 'deepseek-official'
export type SearchPurpose = 'diagnostic' | 'business-credit' | 'opportunity-discovery' | 'deep-radar' | 'nearby-enterprise' | 'project-timeline' | 'project-watch' | 'policy-chain' | 'industry-chain' | 'lead-search'
export type SearchResultLimit = 5 | 10 | 20
export type EvidenceSourceClass = 'registry' | 'credit-china' | 'court' | 'government' | 'other'

export type OpportunitySourceReadStatus = 'body-ready' | 'summary-only' | 'read-failed'

export interface OpportunitySourceChecks {
  readStatus: OpportunitySourceReadStatus
  eligibleForModel: boolean
  subjectCandidates: string[]
  stageIds: ProjectStageId[]
  stageDateCandidates: string[]
  deadlineCandidates: string[]
  amountWanCandidates: number[]
  addressCandidates: string[]
  reasons: string[]
}

export interface SearchSource {
  url: string
  sourceClass: EvidenceSourceClass
  title?: string
  publisher?: string
  snippet?: string
  content?: string
  publishedAt?: string
  rankScore?: number
  authorityLabel?: string
  authorityLevel?: number
  opportunityChecks?: OpportunitySourceChecks
}

export interface SearchRequest {
  provider: SearchProviderId
  purpose: SearchPurpose
  query: string
  maxResults?: SearchResultLimit
}

export interface SearchResult extends SearchRequest {
  sources: SearchSource[]
  evidenceRecords: EvidenceRecord[]
  truncated: boolean
  requestCount: 0 | 1
  cacheHit: boolean
  checkedAt: string
  expiresAt?: string
  totalResults?: number
  searchTimeMs?: number
}

export type SearchResponse =
  | { ok: true; value: SearchResult }
  | { ok: false; message: string }

export type SearchPort = (request: SearchRequest) => Promise<SearchResult>

const providers = new Set<SearchProviderId>(['doubao', 'deepseek-official'])
const purposes = new Set<SearchPurpose>(['diagnostic', 'business-credit', 'opportunity-discovery', 'deep-radar', 'nearby-enterprise', 'project-timeline', 'project-watch', 'policy-chain', 'industry-chain', 'lead-search'])

export function assertSearchRequest(value: unknown): asserts value is SearchRequest {
  if (!isRecord(value)
    || !providers.has(value.provider as SearchProviderId)
    || !purposes.has(value.purpose as SearchPurpose)
    || typeof value.query !== 'string'
    || value.query.trim().length === 0
    || value.query.length > 500
    || (value.maxResults !== undefined && value.maxResults !== 5 && value.maxResults !== 10 && value.maxResults !== 20)) {
    throw new Error('搜索请求参数不完整或超出当前支持范围。')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
