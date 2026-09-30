import type { SearchSource } from './search-contract.js'
import type { ProjectStageId } from './project-timeline.js'

export type LocalEvidenceMediaKind = 'pdf' | 'image' | 'text' | 'html'
export type LocalEvidenceProcessingStatus = 'stored-unparsed' | 'content-ready' | 'needs-ocr' | 'failed'

export type EvidenceSubjectKind = 'company' | 'project' | 'opportunity' | 'geo-subject' | 'unknown'
export type EvidenceArtifactOrigin = 'web' | 'local-file'
export type EvidenceMediaKind = LocalEvidenceMediaKind | 'webpage'
export type EvidenceProcessingStatus = 'discovered' | LocalEvidenceProcessingStatus
export type EvidenceProvenanceType = 'original' | 'explicit-repost' | 'reported-summary' | 'aggregator' | 'unknown'
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D'
export type EvidenceClaimType = 'project-stage' | 'business-credit' | 'general'
export type EvidenceUse =
  | 'discovery'
  | 'report-candidate'
  | 'stage-confirmation'
  | 'credit-candidate'
  | 'credit-confirmation'
export type EvidenceDocumentIdentifierKind =
  | 'project-number'
  | 'purchase-number'
  | 'document-number'
  | 'unified-social-credit-code'
  | 'other'

export interface EvidenceSubjectRef {
  kind: EvidenceSubjectKind
  id?: string
  name?: string
}

export interface EvidenceArtifact {
  origin: EvidenceArtifactOrigin
  mediaKind: EvidenceMediaKind
  processingStatus: EvidenceProcessingStatus
  fileName?: string
  extension?: string
  sizeBytes?: number
}

export interface EvidenceDocumentIdentifier {
  kind: EvidenceDocumentIdentifierKind
  value: string
}

/**
 * Deterministic extraction output. Every provenance field is only a candidate
 * until EvidenceAssessment confirms the publisher, subject and record identity.
 */
export interface EvidenceDocumentExtraction {
  processingStatus: Extract<EvidenceProcessingStatus, 'content-ready' | 'needs-ocr' | 'failed'>
  text: string
  title?: string
  publisherCandidate?: string
  originalPublisherCandidate?: string
  originalUrlCandidate?: string
  /** Internal, deterministic detail links found on an index/listing page. */
  detailUrlCandidates?: string[]
  /** Public download links found in the page. They are recorded, not fetched. */
  attachmentCandidates?: Array<{ label: string; url: string }>
  provenanceTypeCandidate: Extract<EvidenceProvenanceType, 'explicit-repost' | 'unknown'>
  documentIdentifiers: EvidenceDocumentIdentifier[]
  publishedAtCandidate?: string
  pageCount?: number
  truncated: boolean
  warnings: string[]
}

export type LocalEvidenceExtractionSummary = Omit<EvidenceDocumentExtraction, 'text'> & {
  textCharacters: number
}

export interface EvidenceProvenance {
  pageUrl?: string
  publisher: string
  originalPublisher?: string
  originalUrl?: string
  provenanceType: EvidenceProvenanceType
  documentIdentifiers: EvidenceDocumentIdentifier[]
  publishedAt?: string
  capturedAt: string
  contentHash?: string
  corroboratingEvidenceIds: string[]
}

export interface EvidenceDiscovery {
  provider: string
  query: string
  providerSourceClass?: string
  providerPublisher?: string
  providerAuthorityLabel?: string
  providerAuthorityLevel?: number
  rankScore?: number
}

/** Deterministic tender fields shown on a source card; never model-generated. */
export interface EvidenceOpportunityDetails {
  companyCandidates: string[]
  amountWanCandidates: number[]
  stageIds: ProjectStageId[]
  deadlineCandidates: string[]
  addressCandidates: string[]
  overview?: string
  agencyCandidates?: string[]
  lotCandidates?: string[]
  scopeCandidates?: string[]
  qualificationCandidates?: string[]
  consortiumCandidates?: string[]
  documentAccessCandidates?: string[]
  depositCandidates?: string[]
  openingTimeCandidates?: string[]
  evaluationMethodCandidates?: string[]
  contactCandidates: string[]
  attachmentCandidates: Array<{ label: string; url: string }>
}

export type EvidenceAssessment =
  | {
    status: 'pending'
    reasons: string[]
    missingChecks: string[]
  }
  | {
    status: 'assessed'
    claimType: EvidenceClaimType
    grade: EvidenceGrade
    permittedUses: EvidenceUse[]
    reasons: string[]
    missingChecks: string[]
    assessedAt: string
  }

export interface EvidenceRecord {
  id: string
  subject: EvidenceSubjectRef
  title: string
  artifact: EvidenceArtifact
  provenance: EvidenceProvenance
  discovery?: EvidenceDiscovery
  opportunityDetails?: EvidenceOpportunityDetails
  assessment: EvidenceAssessment
}

export interface SearchEvidenceContext {
  provider: string
  query: string
  capturedAt: string
  subject?: EvidenceSubjectRef
}

export interface LocalEvidenceRecord {
  id: string
  subjectName: string
  fileName: string
  extension: string
  mediaKind: LocalEvidenceMediaKind
  sizeBytes: number
  sha256: string
  importedAt: string
  processingStatus: LocalEvidenceProcessingStatus
  extraction?: LocalEvidenceExtractionSummary
}

export type LocalEvidenceImportResponse =
  | { ok: true; value: LocalEvidenceRecord; cancelled?: false }
  | { ok: true; cancelled: true }
  | { ok: false; message: string }

export type LocalEvidenceListResponse =
  | { ok: true; value: LocalEvidenceRecord[] }
  | { ok: false; message: string }

export type LocalEvidenceTextResponse =
  | { ok: true; value: { recordId: string; text: string } }
  | { ok: false; message: string }

/**
 * Bridges the existing version-1 local evidence index into the unified
 * evidence model. Importing a file never implies that its content or source
 * has been verified.
 */
export function toEvidenceRecord(record: LocalEvidenceRecord): EvidenceRecord {
  const extraction = record.extraction
  return {
    id: record.id,
    subject: { kind: 'company', name: record.subjectName },
    title: extraction?.title ?? record.fileName,
    artifact: {
      origin: 'local-file',
      mediaKind: record.mediaKind,
      processingStatus: record.processingStatus,
      fileName: record.fileName,
      extension: record.extension,
      sizeBytes: record.sizeBytes,
    },
    provenance: {
      publisher: extraction?.publisherCandidate ?? '用户本地导入',
      ...(extraction?.originalPublisherCandidate ? { originalPublisher: extraction.originalPublisherCandidate } : {}),
      ...(extraction?.originalUrlCandidate ? { originalUrl: extraction.originalUrlCandidate } : {}),
      provenanceType: extraction?.provenanceTypeCandidate ?? 'unknown',
      documentIdentifiers: extraction?.documentIdentifiers ?? [],
      ...(extraction?.publishedAtCandidate ? { publishedAt: extraction.publishedAtCandidate } : {}),
      capturedAt: record.importedAt,
      contentHash: `sha256:${record.sha256}`,
      corroboratingEvidenceIds: [],
    },
    assessment: {
      status: 'pending',
      reasons: [],
      missingChecks: [record.processingStatus === 'content-ready'
        ? '已提取正文和出处候选，尚未核对发布者、主体和关键事实。'
        : record.processingStatus === 'needs-ocr'
          ? '材料需要 OCR，尚未取得可核验正文。'
          : '尚未解析材料内容和核对出处。'],
    },
  }
}

/** Search providers only discover candidates; authority and business use stay pending. */
export function searchSourceToEvidenceRecord(source: SearchSource, context: SearchEvidenceContext): EvidenceRecord {
  const pageUrl = new URL(source.url)
  const title = source.title?.trim() || pageUrl.hostname
  return {
    id: `web:${pageUrl.href}`,
    subject: context.subject ?? { kind: 'unknown' },
    title,
    artifact: {
      origin: 'web',
      mediaKind: pageUrl.pathname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'webpage',
      processingStatus: source.content?.trim() ? 'content-ready' : 'discovered',
    },
    provenance: {
      pageUrl: pageUrl.href,
      publisher: source.publisher?.trim() || pageUrl.hostname.toLowerCase(),
      provenanceType: 'unknown',
      documentIdentifiers: [],
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      capturedAt: context.capturedAt,
      corroboratingEvidenceIds: [],
    },
    discovery: {
      provider: context.provider,
      query: context.query,
      providerSourceClass: source.sourceClass,
      ...(source.publisher ? { providerPublisher: source.publisher } : {}),
      ...(source.authorityLabel ? { providerAuthorityLabel: source.authorityLabel } : {}),
      ...(source.authorityLevel !== undefined ? { providerAuthorityLevel: source.authorityLevel } : {}),
      ...(source.rankScore !== undefined ? { rankScore: source.rankScore } : {}),
    },
    ...(source.opportunityChecks ? {
      opportunityDetails: {
        companyCandidates: source.opportunityChecks.subjectCandidates,
        amountWanCandidates: source.opportunityChecks.amountWanCandidates,
        stageIds: source.opportunityChecks.stageIds,
        deadlineCandidates: source.opportunityChecks.deadlineCandidates,
        addressCandidates: source.opportunityChecks.addressCandidates,
        contactCandidates: [],
        attachmentCandidates: [],
      },
    } : {}),
    assessment: {
      status: 'pending',
      reasons: [],
      missingChecks: ['尚未核对页面原始出处和关键事实。'],
    },
  }
}

export function assessmentPermits(assessment: EvidenceAssessment, use: EvidenceUse): boolean {
  return assessment.status === 'assessed' && assessment.permittedUses.includes(use)
}

const subjectKinds = new Set<EvidenceSubjectKind>(['company', 'project', 'opportunity', 'geo-subject', 'unknown'])
const artifactOrigins = new Set<EvidenceArtifactOrigin>(['web', 'local-file'])
const mediaKinds = new Set<EvidenceMediaKind>(['pdf', 'image', 'text', 'html', 'webpage'])
const processingStatuses = new Set<EvidenceProcessingStatus>(['discovered', 'stored-unparsed', 'content-ready', 'needs-ocr', 'failed'])
const provenanceTypes = new Set<EvidenceProvenanceType>(['original', 'explicit-repost', 'reported-summary', 'aggregator', 'unknown'])
const evidenceGrades = new Set<EvidenceGrade>(['A', 'B', 'C', 'D'])
const evidenceClaimTypes = new Set<EvidenceClaimType>(['project-stage', 'business-credit', 'general'])
const evidenceUses = new Set<EvidenceUse>(['discovery', 'report-candidate', 'stage-confirmation', 'credit-candidate', 'credit-confirmation'])
const identifierKinds = new Set<EvidenceDocumentIdentifierKind>([
  'project-number',
  'purchase-number',
  'document-number',
  'unified-social-credit-code',
  'other',
])

export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id)
    && isEvidenceSubject(value.subject)
    && isNonEmptyString(value.title)
    && isEvidenceArtifact(value.artifact)
    && isEvidenceProvenance(value.provenance, value.artifact.origin)
    && (value.discovery === undefined || isEvidenceDiscovery(value.discovery))
    && (value.opportunityDetails === undefined || isEvidenceOpportunityDetails(value.opportunityDetails))
    && isEvidenceAssessment(value.assessment)
}

function isEvidenceSubject(value: unknown): value is EvidenceSubjectRef {
  if (!isRecord(value) || !subjectKinds.has(value.kind as EvidenceSubjectKind)) return false
  if (value.id !== undefined && !isNonEmptyString(value.id)) return false
  if (value.name !== undefined && !isNonEmptyString(value.name)) return false
  return value.kind === 'unknown' || isNonEmptyString(value.id) || isNonEmptyString(value.name)
}

function isEvidenceArtifact(value: unknown): value is EvidenceArtifact {
  if (!isRecord(value)
    || !artifactOrigins.has(value.origin as EvidenceArtifactOrigin)
    || !mediaKinds.has(value.mediaKind as EvidenceMediaKind)
    || !processingStatuses.has(value.processingStatus as EvidenceProcessingStatus)) return false
  if (value.origin !== 'local-file') return true
  return isNonEmptyString(value.fileName)
    && isNonEmptyString(value.extension)
    && typeof value.sizeBytes === 'number'
    && Number.isFinite(value.sizeBytes)
    && value.sizeBytes >= 0
}

function isEvidenceProvenance(value: unknown, origin: EvidenceArtifactOrigin): value is EvidenceProvenance {
  if (!isRecord(value)
    || !isNonEmptyString(value.publisher)
    || !provenanceTypes.has(value.provenanceType as EvidenceProvenanceType)
    || !Array.isArray(value.documentIdentifiers)
    || !value.documentIdentifiers.every(isDocumentIdentifier)
    || !isNonEmptyString(value.capturedAt)
    || !isStringArray(value.corroboratingEvidenceIds)) return false
  if (origin === 'web' && !isNonEmptyString(value.pageUrl)) return false
  return optionalString(value.pageUrl)
    && optionalString(value.originalPublisher)
    && optionalString(value.originalUrl)
    && optionalString(value.publishedAt)
    && optionalString(value.contentHash)
}

function isDocumentIdentifier(value: unknown): value is EvidenceDocumentIdentifier {
  return isRecord(value)
    && identifierKinds.has(value.kind as EvidenceDocumentIdentifierKind)
    && isNonEmptyString(value.value)
}

function isEvidenceAssessment(value: unknown): value is EvidenceAssessment {
  if (!isRecord(value) || !isStringArray(value.reasons) || !isStringArray(value.missingChecks)) return false
  if (value.status === 'pending') return true
  return value.status === 'assessed'
    && evidenceClaimTypes.has(value.claimType as EvidenceClaimType)
    && evidenceGrades.has(value.grade as EvidenceGrade)
    && Array.isArray(value.permittedUses)
    && value.permittedUses.every((use) => evidenceUses.has(use as EvidenceUse))
    && isNonEmptyString(value.assessedAt)
}

function isEvidenceDiscovery(value: unknown): value is EvidenceDiscovery {
  return isRecord(value)
    && isNonEmptyString(value.provider)
    && isNonEmptyString(value.query)
    && optionalString(value.providerSourceClass)
    && optionalString(value.providerPublisher)
    && optionalString(value.providerAuthorityLabel)
    && (value.providerAuthorityLevel === undefined || (typeof value.providerAuthorityLevel === 'number' && Number.isFinite(value.providerAuthorityLevel)))
    && (value.rankScore === undefined || (typeof value.rankScore === 'number' && Number.isFinite(value.rankScore)))
}

function isEvidenceOpportunityDetails(value: unknown): value is EvidenceOpportunityDetails {
  return isRecord(value)
    && isStringArray(value.companyCandidates)
    && isNumberArray(value.amountWanCandidates)
    && isStringArray(value.stageIds)
    && isStringArray(value.deadlineCandidates)
    && isStringArray(value.addressCandidates)
    && optionalString(value.overview)
    && optionalStringArray(value.agencyCandidates)
    && optionalStringArray(value.lotCandidates)
    && optionalStringArray(value.scopeCandidates)
    && optionalStringArray(value.qualificationCandidates)
    && optionalStringArray(value.consortiumCandidates)
    && optionalStringArray(value.documentAccessCandidates)
    && optionalStringArray(value.depositCandidates)
    && optionalStringArray(value.openingTimeCandidates)
    && optionalStringArray(value.evaluationMethodCandidates)
    && isStringArray(value.contactCandidates)
    && Array.isArray(value.attachmentCandidates)
    && value.attachmentCandidates.every((item) => isRecord(item) && isNonEmptyString(item.label) && isNonEmptyString(item.url))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}
