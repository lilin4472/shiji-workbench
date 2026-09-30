import type {
  EvidenceAssessment,
  EvidenceClaimType,
  EvidenceGrade,
  EvidenceRecord,
  EvidenceUse,
} from './evidence-contract.js'

export type PublisherRole =
  | 'government'
  | 'transaction-platform'
  | 'project-owner'
  | 'registry'
  | 'court'
  | 'mainstream-media'
  | 'industry-media'
  | 'commercial-media'
  | 'aggregator'
  | 'unknown'

export type PublisherReputation = 'high' | 'medium' | 'unknown'

export interface PublisherProfile {
  role: PublisherRole
  reputation: PublisherReputation
}

export interface EvidenceAssessmentFacts {
  claimType: EvidenceClaimType
  publisher: PublisherProfile
  originalSourceConfirmed: boolean
  subjectIdentityConfirmed: boolean
  recordIdentityConfirmed: boolean
  eventDateConfirmed: boolean
  keyContentConsistent: boolean
  currentStatusConfirmed: boolean
}

const originalAuthorityRoles = new Set<PublisherRole>([
  'government',
  'transaction-platform',
  'project-owner',
  'registry',
  'court',
])

export function assessEvidenceRecord(
  record: EvidenceRecord,
  facts: EvidenceAssessmentFacts,
  assessedAt = new Date().toISOString(),
): EvidenceRecord {
  const grade = evidenceGrade(record, facts)
  const assessment: EvidenceAssessment = {
    status: 'assessed',
    claimType: facts.claimType,
    grade,
    permittedUses: permittedUses(grade, facts),
    reasons: reasonsFor(grade),
    missingChecks: missingChecks(record, facts),
    assessedAt,
  }
  return { ...record, assessment }
}

function evidenceGrade(record: EvidenceRecord, facts: EvidenceAssessmentFacts): EvidenceGrade {
  const coreFactsConfirmed = facts.originalSourceConfirmed
    && facts.subjectIdentityConfirmed
    && facts.recordIdentityConfirmed
    && facts.eventDateConfirmed
    && facts.keyContentConsistent

  if (record.provenance.provenanceType === 'original'
    && originalAuthorityRoles.has(facts.publisher.role)
    && facts.publisher.reputation === 'high'
    && coreFactsConfirmed) return 'A'

  const traceableRepost = record.provenance.provenanceType === 'explicit-repost'
    && Boolean(record.provenance.originalPublisher)
    && (Boolean(record.provenance.originalUrl) || record.provenance.documentIdentifiers.length > 0)
  if (traceableRepost && facts.publisher.reputation === 'high' && coreFactsConfirmed) return 'B'

  const usableReporting = record.provenance.provenanceType !== 'aggregator'
    && record.artifact.processingStatus === 'content-ready'
    && facts.publisher.reputation !== 'unknown'
    && facts.subjectIdentityConfirmed
    && facts.keyContentConsistent
  return usableReporting ? 'C' : 'D'
}

function permittedUses(grade: EvidenceGrade, facts: EvidenceAssessmentFacts): EvidenceUse[] {
  const uses: EvidenceUse[] = ['discovery']
  if (grade !== 'D') uses.push('report-candidate')
  if (facts.claimType === 'project-stage' && (grade === 'A' || grade === 'B')) uses.push('stage-confirmation')
  if (facts.claimType === 'business-credit' && grade !== 'D') uses.push('credit-candidate')
  if (facts.claimType === 'business-credit' && grade === 'A' && facts.currentStatusConfirmed) uses.push('credit-confirmation')
  return uses
}

function reasonsFor(grade: EvidenceGrade): string[] {
  if (grade === 'A') return ['原始发布者及关键事实已核对，可作为对应事项的原始证据。']
  if (grade === 'B') return ['转载发布者信誉较高，且原发布单位、出处链和关键事实可以对应。']
  if (grade === 'C') return ['内容和主体可识别，但原始出处链或关键标识尚不完整。']
  return ['当前只能作为继续搜索的发现线索，不能形成事实结论。']
}

function missingChecks(record: EvidenceRecord, facts: EvidenceAssessmentFacts): string[] {
  const missing: string[] = []
  if (facts.publisher.reputation === 'unknown') missing.push('发布者信誉尚未评估。')
  if (!facts.originalSourceConfirmed) missing.push('原始发布者或出处链尚未确认。')
  if (!facts.subjectIdentityConfirmed) missing.push('主体身份尚未确认。')
  if (!facts.recordIdentityConfirmed) missing.push('项目编号、文号或事项唯一标识尚未确认。')
  if (!facts.eventDateConfirmed) missing.push('事项日期尚未确认。')
  if (!facts.keyContentConsistent) missing.push('关键内容尚未完成一致性核对。')
  if (record.provenance.provenanceType === 'explicit-repost'
    && !record.provenance.originalUrl
    && record.provenance.documentIdentifiers.length === 0) {
    missing.push('转载页面缺少原文链接或可追溯文档标识。')
  }
  if (facts.claimType === 'business-credit' && !facts.currentStatusConfirmed) missing.push('工商事项当前有效状态尚未确认。')
  return missing
}
