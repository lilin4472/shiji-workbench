import { normalizeProjectName } from '../shared/business-objects.js'
import { assessEvidenceRecord } from '../shared/evidence-assessment.js'
import { assessmentPermits, type EvidenceDocumentIdentifier, type EvidenceRecord } from '../shared/evidence-contract.js'
import type { ProjectTimelineDiscoveryRequest, ProjectTimelineDiscoveryResult } from '../shared/project-timeline-discovery.js'
import type { ProjectStageEvidence } from '../shared/project-timeline.js'
import type { SearchPort, SearchSource } from '../shared/search-contract.js'
import type { UserSearchProviderId } from '../shared/search-preference.js'
import { isReputablePublisher } from '../shared/source-reputation.js'
import { buildTimelineStageSearchPlan, buildWatchStageSearchPlan } from '../shared/stage-search-plan.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import { prepareOpportunitySources, type OpportunityDocumentReader } from './opportunity-source-preparer.js'

export type ProjectTimelineDiscoveryService = (request: ProjectTimelineDiscoveryRequest) => Promise<ProjectTimelineDiscoveryResult>

export function createProjectTimelineDiscoveryService(
  search: SearchPort,
  getDefaultProvider: () => Promise<UserSearchProviderId>,
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
): ProjectTimelineDiscoveryService {
  return async (request) => {
    const provider = await getDefaultProvider()
    const plan = request.mode === 'full'
      ? buildTimelineStageSearchPlan(request.projectTitle, request.companyName)
      : buildWatchStageSearchPlan(request.projectTitle, request.lastKnownStageId)
    const purpose = request.mode === 'full' ? 'project-timeline' : 'project-watch'
    const raw = await search({ provider, purpose, query: plan.query, maxResults: 20 })
    const prepared = await prepareOpportunitySources(raw, plan.targetStageId, readDocument)
    const evidenceByUrl = new Map(prepared.evidenceRecords.flatMap((record) => record.provenance.pageUrl ? [[record.provenance.pageUrl, record] as const] : []))
    const confirmedStageEvidence: ProjectStageEvidence[] = []
    const candidateEvidenceIds: string[] = []
    const rejectedEvidenceIds: string[] = []
    const retainedRecords: EvidenceRecord[] = []

    for (const source of prepared.sources) {
      const record = evidenceByUrl.get(source.url) ?? prepared.evidenceRecords.find((item) => item.id === webEvidenceId(source.url))
      if (!record) continue
      const checks = source.opportunityChecks
      const identity = projectIdentity(request, record)
      const subjectMatched = Boolean(checks?.subjectCandidates.some((candidate) => sameCompany(candidate, request.companyName)))
      const subjectConflicted = Boolean(checks?.subjectCandidates.length) && !subjectMatched
      if (!identity || subjectConflicted) {
        rejectedEvidenceIds.push(record.id)
        continue
      }

      const subjectConfirmed = subjectMatched || (!checks?.subjectCandidates.length && identity)
      const assessed = assessStageRecord(record, source, request, subjectConfirmed)
      retainedRecords.push(assessed)
      if (!checks || checks.stageIds.length === 0 || checks.stageDateCandidates.length === 0) {
        candidateEvidenceIds.push(assessed.id)
        continue
      }
      if (!assessmentPermits(assessed.assessment, 'stage-confirmation')) {
        candidateEvidenceIds.push(assessed.id)
        continue
      }
      for (const stageId of checks.stageIds) {
        confirmedStageEvidence.push({
          evidenceId: assessed.id,
          stageId,
          occurredAt: checks.stageDateCandidates[0],
          title: assessed.title,
          source: assessed.provenance.publisher,
        })
      }
    }

    return {
      opportunityId: request.opportunityId,
      mode: request.mode,
      provider: prepared.provider,
      query: prepared.query,
      checkedAt: prepared.checkedAt,
      requestCount: prepared.requestCount,
      cacheHit: prepared.cacheHit,
      evidenceRecords: dedupeRecords(retainedRecords),
      confirmedStageEvidence: dedupeStageEvidence(confirmedStageEvidence),
      candidateEvidenceIds: unique(candidateEvidenceIds),
      rejectedEvidenceIds: unique(rejectedEvidenceIds),
      boundary: '阶段只由同一项目且达到来源门槛的正文证据推进；高质量商业来源可保留为候选，不能因搜索不到或时间经过而自动生成中标、合同事实。',
    }
  }
}

function assessStageRecord(
  record: EvidenceRecord,
  source: SearchSource,
  request: ProjectTimelineDiscoveryRequest,
  subjectConfirmed: boolean,
): EvidenceRecord {
  const official = source.sourceClass === 'government'
  const originalPlatform = isOriginalStagePublisher(source)
  const originalAuthority = official || originalPlatform
  const reputable = originalAuthority
    || isReputablePublisher(source.publisher ?? '')
    || isReputablePublisher(source.url)
    || isReputablePublisher(record.provenance.publisher)
  const traceableRepost = record.provenance.provenanceType === 'explicit-repost'
    && Boolean(record.provenance.originalPublisher)
    && (Boolean(record.provenance.originalUrl) || record.provenance.documentIdentifiers.length > 0)
  const provenance = originalAuthority && record.provenance.provenanceType === 'unknown'
    ? { ...record.provenance, provenanceType: 'original' as const }
    : record.provenance
  const preparedRecord: EvidenceRecord = {
    ...record,
    subject: { kind: 'opportunity', id: request.opportunityId, name: request.projectTitle },
    provenance,
  }
  const checks = source.opportunityChecks
  return assessEvidenceRecord(preparedRecord, {
    claimType: 'project-stage',
    publisher: {
      role: official ? 'government' : originalPlatform ? 'transaction-platform' : reputable ? 'industry-media' : 'unknown',
      reputation: reputable ? 'high' : 'unknown',
    },
    originalSourceConfirmed: originalAuthority || traceableRepost,
    subjectIdentityConfirmed: subjectConfirmed,
    recordIdentityConfirmed: projectIdentity(request, record),
    eventDateConfirmed: Boolean(checks?.stageDateCandidates.length),
    keyContentConsistent: Boolean(checks?.stageIds.length && subjectConfirmed),
    currentStatusConfirmed: true,
  }, preparedRecord.provenance.capturedAt)
}

function isOriginalStagePublisher(source: SearchSource): boolean {
  const publisher = `${source.publisher ?? ''} ${source.url}`.toLocaleLowerCase('zh-CN')
  return /中国招标投标公共服务平台|全国公共资源交易平台/.test(publisher)
    || /(^|\.)cebpubservice\.cn(?=\/|$)/.test(safeHostname(source.url))
    || /(^|\.)ggzy\.gov\.cn(?=\/|$)/.test(safeHostname(source.url))
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function projectIdentity(request: ProjectTimelineDiscoveryRequest, record: EvidenceRecord): boolean {
  if (identifiersOverlap(request.knownIdentifiers, record.provenance.documentIdentifiers)) return true
  const target = normalizeProjectName(request.projectTitle)
  const candidate = normalizeProjectName(record.title)
  if (target.length < 6 || candidate.length < 6) return false
  return target === candidate || target.includes(candidate) || candidate.includes(target)
}

function identifiersOverlap(left: EvidenceDocumentIdentifier[], right: EvidenceDocumentIdentifier[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  const keys = new Set(left.map(identifierKey))
  return right.some((item) => keys.has(identifierKey(item)))
}

function identifierKey(item: EvidenceDocumentIdentifier): string {
  return `${item.kind}:${item.value.replace(/\s+/g, '').toLowerCase()}`
}

function sameCompany(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[\s()（）:：,，。;；\-—_]/g, '').toLocaleLowerCase('zh-CN')
  return normalize(left) === normalize(right)
}

function webEvidenceId(url: string): string {
  try {
    return `web:${new URL(url).href}`
  } catch {
    return `web:${url}`
  }
}

function dedupeRecords(records: EvidenceRecord[]): EvidenceRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()]
}

function dedupeStageEvidence(evidence: ProjectStageEvidence[]): ProjectStageEvidence[] {
  return [...new Map(evidence.map((item) => [`${item.evidenceId}:${item.stageId}`, item])).values()]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
