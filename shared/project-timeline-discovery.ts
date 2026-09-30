import type { EvidenceDocumentIdentifier, EvidenceRecord } from './evidence-contract.js'
import { isProjectStageId, type ProjectStageEvidence, type ProjectStageId } from './project-timeline.js'
import type { SearchProviderId } from './search-contract.js'

export type ProjectTimelineDiscoveryMode = 'full' | 'watch-next'

export interface ProjectTimelineDiscoveryRequest {
  opportunityId: string
  projectTitle: string
  companyName: string
  knownIdentifiers: EvidenceDocumentIdentifier[]
  mode: ProjectTimelineDiscoveryMode
  lastKnownStageId?: ProjectStageId
}

export interface ProjectTimelineDiscoveryResult {
  opportunityId: string
  mode: ProjectTimelineDiscoveryMode
  provider: SearchProviderId
  query: string
  checkedAt: string
  requestCount: 0 | 1
  cacheHit: boolean
  evidenceRecords: EvidenceRecord[]
  confirmedStageEvidence: ProjectStageEvidence[]
  candidateEvidenceIds: string[]
  rejectedEvidenceIds: string[]
  boundary: string
}

export type ProjectTimelineDiscoveryResponse =
  | { ok: true; value: ProjectTimelineDiscoveryResult }
  | { ok: false; message: string }

export function assertProjectTimelineDiscoveryRequest(value: unknown): asserts value is ProjectTimelineDiscoveryRequest {
  if (!isRecord(value)
    || !isShortText(value.opportunityId, 200)
    || !isShortText(value.projectTitle, 300)
    || !isShortText(value.companyName, 160)
    || (value.mode !== 'full' && value.mode !== 'watch-next')
    || !Array.isArray(value.knownIdentifiers)
    || value.knownIdentifiers.length > 30
    || !value.knownIdentifiers.every(isIdentifier)
    || (value.lastKnownStageId !== undefined && !isProjectStageId(value.lastKnownStageId))) {
    throw new Error('项目时间链请求参数不完整或超出当前支持范围。')
  }
}

function isIdentifier(value: unknown): value is EvidenceDocumentIdentifier {
  return isRecord(value)
    && ['project-number', 'purchase-number', 'document-number', 'unified-social-credit-code', 'other'].includes(String(value.kind))
    && isShortText(value.value, 200)
}

function isShortText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
