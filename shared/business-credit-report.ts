import type { SearchSource } from './search-contract.js'
import { isReputablePublisher } from './source-reputation.js'

export type CreditCheckDimension =
  | 'registration'
  | 'business-abnormal'
  | 'serious-violation'
  | 'administrative-penalty'
  | 'dishonest-enforcement'

export type CreditCheckStatus = 'record-found' | 'verified-clear' | 'unverified'
export type CreditOverallStatus = 'attention' | 'partial' | 'verified-clear' | 'unverified'

export interface CreditCheckDefinition {
  dimension: CreditCheckDimension
  label: string
  adverse: boolean
}

export interface BusinessCreditCheck extends CreditCheckDefinition {
  status: CreditCheckStatus
  note: string
  sources: SearchSource[]
  /** Relevant public references shown under this dimension; these are not automatically trusted evidence. */
  referenceSources: SearchSource[]
  localEvidenceIds: string[]
  review?: BusinessCreditReviewDecision
}

export type CreditReviewEvidenceRef =
  | { kind: 'web'; url: string }
  | { kind: 'local'; id: string }

export interface BusinessCreditReviewDecision {
  dimension: CreditCheckDimension
  outcome: Extract<CreditCheckStatus, 'record-found' | 'verified-clear'>
  evidence: CreditReviewEvidenceRef
  reviewedAt: string
  note: string
}

export interface LocalCreditEvidence {
  id: string
  subjectName: string
  title: string
  text: string
}

export interface BusinessCreditReport {
  subjectName: string
  generatedAt: string
  overallStatus: CreditOverallStatus
  coverage: { confirmed: number; total: number }
  checks: BusinessCreditCheck[]
  candidateSources: SearchSource[]
  registrationSummary?: BusinessRegistrationSummary
  boundary: string
}

export interface BusinessRegistrationSummary {
  unifiedSocialCreditCode?: string
  legalRepresentative?: string
  registeredCapital?: string
  establishedAt?: string
  operatingStatus?: string
  address?: string
  sourceUrl: string
  sourceTitle: string
}

export interface BusinessCreditDiscoveryResult {
  provider: string
  query: string
  focus?: string
  checkedAt: string
  requestCount: 0 | 1
  cacheHit: boolean
  report: BusinessCreditReport
}

export type BusinessCreditDiscoveryResponse =
  | { ok: true; value: BusinessCreditDiscoveryResult }
  | { ok: false; message: string }

export function isBusinessCreditDiscoveryResult(value: unknown): value is BusinessCreditDiscoveryResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BusinessCreditDiscoveryResult>
  const report = candidate.report as Partial<BusinessCreditReport> | undefined
  return typeof candidate.provider === 'string'
    && typeof candidate.query === 'string'
    && (candidate.focus === undefined || typeof candidate.focus === 'string')
    && typeof candidate.checkedAt === 'string'
    && (candidate.requestCount === 0 || candidate.requestCount === 1)
    && typeof candidate.cacheHit === 'boolean'
    && typeof report?.subjectName === 'string'
    && typeof report.generatedAt === 'string'
    && Array.isArray(report.checks)
    && Array.isArray(report.candidateSources)
}

export const CREDIT_CHECK_DEFINITIONS: readonly CreditCheckDefinition[] = [
  { dimension: 'registration', label: '登记主体', adverse: false },
  { dimension: 'business-abnormal', label: '经营异常', adverse: true },
  { dimension: 'serious-violation', label: '严重违法失信', adverse: true },
  { dimension: 'administrative-penalty', label: '行政处罚', adverse: true },
  { dimension: 'dishonest-enforcement', label: '失信被执行人', adverse: true },
]

const dimensionPatterns: Partial<Record<CreditCheckDimension, RegExp>> = {
  'business-abnormal': /经营异常|异常名录/,
  'serious-violation': /严重违法|严重失信/,
  'administrative-penalty': /行政处罚|处罚决定|处以[^。；\n]{0,30}罚款|罚没(?:款|合计)?/,
  'dishonest-enforcement': /失信被执行人|被执行人信息|执行信息/,
}

const officialSourceClasses = new Set<SearchSource['sourceClass']>(['registry', 'credit-china', 'court', 'government'])

/**
 * Converts search discovery into a conservative report. Search hits are only
 * candidate records; this function never creates a "verified clear" outcome.
 */
export function buildCreditDiscoveryReport(
  subjectNameValue: string,
  sources: readonly SearchSource[],
  generatedAt = new Date().toISOString(),
  localEvidence: readonly LocalCreditEvidence[] = [],
  reviews: readonly BusinessCreditReviewDecision[] = [],
): BusinessCreditReport {
  const subjectName = subjectNameValue.trim()
  const candidateSources = dedupeSources(sources)
  const checks = CREDIT_CHECK_DEFINITIONS.map<BusinessCreditCheck>((definition) => {
    const matching = candidateSources.filter((source) => matchesDimension(subjectName, definition.dimension, source))
    const referenceSources = candidateSources.filter((source) => matchesReferenceDimension(subjectName, definition.dimension, source))
    const matchingLocal = localEvidence.filter((item) => matchesLocalDimension(subjectName, definition.dimension, item))
    const found = matching.length > 0 || matchingLocal.length > 0
    const review = reviews.find((item) => item.dimension === definition.dimension
      && canBusinessCreditEvidenceSupportReview(subjectName, item.dimension, item.outcome, item.evidence, candidateSources, localEvidence))
    return {
      ...definition,
      status: review?.outcome ?? (found ? 'record-found' : 'unverified'),
      note: review
        ? `${review.outcome === 'verified-clear' ? '人工核验未发现对应事项' : '人工核验确认发现记录'}；依据已绑定，复核时间 ${formatReviewTime(review.reviewedAt)}。${review.note ? ` ${review.note}` : ''}`
        : found
        ? `发现与主体名称匹配的候选记录（机构网页 ${matching.length} 条 / 本地材料 ${matchingLocal.length} 条），仍需核对主体标识、事项和有效状态。`
        : referenceSources.length > 0
          ? `取得 ${referenceSources.length} 条与本事项相关的公开参考；当前没有足够依据直接归属于该主体。`
        : '当前发现链没有取得可核验的官方证据，不代表该事项不存在。',
      sources: matching,
      referenceSources,
      localEvidenceIds: matchingLocal.map((item) => item.id),
      review,
    }
  })
  const confirmed = checks.filter((check) => Boolean(check.review)).length
  const hasAdverseCandidate = checks.some((check) => check.adverse && check.status === 'record-found')
  const hasAnyCandidate = checks.some((check) => check.status === 'record-found')
  const allVerifiedClear = checks.every((check) => check.status === 'verified-clear')

  return {
    subjectName,
    generatedAt,
    overallStatus: hasAdverseCandidate ? 'attention' : allVerifiedClear ? 'verified-clear' : (hasAnyCandidate || confirmed > 0) ? 'partial' : 'unverified',
    coverage: { confirmed, total: checks.length },
    checks,
    candidateSources,
    registrationSummary: extractRegistrationSummary(subjectName, candidateSources),
    boundary: '搜索不到、页面不可访问或模型没有返回，只能标记为“未核验”，不得表述为企业无风险。',
  }
}

function extractRegistrationSummary(subjectName: string, sources: readonly SearchSource[]): BusinessRegistrationSummary | undefined {
  const candidates = sources.flatMap((source) => {
    const text = `${source.title ?? ''}\n${source.snippet ?? ''}\n${source.content ?? ''}`
    if (!text.includes(subjectName)) return []
    // A procurement notice or a news article can mention both the purchaser and
    // a bidder's registration fields. Only a registry page or a reputable
    // business-information profile whose title is about this exact subject may
    // populate the compact registration snapshot.
    if (!isBusinessRegistrationSource(source, subjectName)) return []
    const summary: BusinessRegistrationSummary = {
      ...captured('unifiedSocialCreditCode', text, /统一社会信用代码[：:\s]*([0-9A-Z]{18})/i),
      ...captured('legalRepresentative', text, /法定代表人[：:\s]*([^\s，,；;]{2,20})/),
      ...captured('registeredCapital', text, /注册资本[：:\s]*([0-9,.]+\s*(?:万|亿)?(?:元|人民币)?)/),
      ...captured('establishedAt', text, /(?:成立日期|成立时间)[：:\s]*(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/),
      ...captured('operatingStatus', text, /(?:经营状态|登记状态)[：:\s]*([^\s，,；;]{2,12})/),
      ...captured('address', text, /(?:注册地址|住所|地址)[：:\s]*([^\n；;]{6,100})/),
      sourceUrl: source.url,
      sourceTitle: source.title?.trim() || source.publisher?.trim() || source.url,
    }
    const fieldCount = Object.values(summary).filter(Boolean).length - 2
    return fieldCount > 0 ? [{ summary, fieldCount }] : []
  })
  return candidates.sort((left, right) => right.fieldCount - left.fieldCount)[0]?.summary
}

function isBusinessRegistrationSource(source: SearchSource, subjectName: string): boolean {
  if (source.sourceClass === 'registry') return true
  const title = source.title?.trim() ?? ''
  if (!title.includes(subjectName)) return false
  const businessProfileSignal = /qcc\.com|aiqicha\.baidu\.com|qixin\.com|tianyancha\.com/i.test(source.url)
    || /企查查|爱企查|启信宝|天眼查/.test(`${source.publisher ?? ''} ${title}`)
  return businessProfileSignal
}

function captured<K extends keyof BusinessRegistrationSummary>(key: K, text: string, pattern: RegExp): Partial<BusinessRegistrationSummary> {
  const value = text.match(pattern)?.[1]?.trim()
  return value ? { [key]: value } : {}
}

export function isBusinessCreditReviewDecision(value: unknown): value is BusinessCreditReviewDecision {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BusinessCreditReviewDecision>
  const evidence = candidate.evidence as Partial<CreditReviewEvidenceRef> | undefined
  return CREDIT_CHECK_DEFINITIONS.some((item) => item.dimension === candidate.dimension)
    && (candidate.outcome === 'record-found' || candidate.outcome === 'verified-clear')
    && typeof candidate.reviewedAt === 'string'
    && typeof candidate.note === 'string'
    && ((evidence?.kind === 'web' && typeof (evidence as { url?: unknown }).url === 'string')
      || (evidence?.kind === 'local' && typeof (evidence as { id?: unknown }).id === 'string'))
}

export function canBusinessCreditEvidenceSupportReview(
  subjectName: string,
  dimension: CreditCheckDimension,
  outcome: BusinessCreditReviewDecision['outcome'],
  evidenceRef: CreditReviewEvidenceRef,
  sources: readonly SearchSource[],
  localEvidence: readonly LocalCreditEvidence[],
): boolean {
  if (evidenceRef.kind === 'local') {
    const local = localEvidence.find((item) => item.id === evidenceRef.id && item.subjectName.trim() === subjectName.trim())
    return Boolean(local && evidenceCoversDimension(subjectName, dimension, `${local.title}\n${local.text}`))
  }
  const source = sources.find((item) => item.url === evidenceRef.url)
  if (!source) return false
  const searchable = `${source.title ?? ''}\n${source.snippet ?? ''}`
  if (!evidenceCoversDimension(subjectName, dimension, searchable)) return false
  // A knowledge-reference page can support a discovered candidate, but it cannot
  // prove that an official register was checked and contained no adverse record.
  return outcome === 'record-found' || officialSourceClasses.has(source.sourceClass)
}

function evidenceCoversDimension(subjectName: string, dimension: CreditCheckDimension, text: string): boolean {
  if (!text.includes(subjectName)) return false
  if (dimension === 'registration') return /统一社会信用代码|事业单位法人证书|登记状态|登记机关|工商登记/.test(text)
  return Boolean(dimensionPatterns[dimension]?.test(text))
}

function formatReviewTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function matchesLocalDimension(subjectName: string, dimension: CreditCheckDimension, evidence: LocalCreditEvidence): boolean {
  if (evidence.subjectName.trim() !== subjectName) return false
  const searchable = `${evidence.title}\n${evidence.text}`
  if (!searchable.includes(subjectName)) return false
  if (dimension === 'registration') return /统一社会信用代码|事业单位法人证书|登记状态|登记机关/.test(searchable)
  const pattern = dimensionPatterns[dimension]
  return pattern ? hasSubjectLinkedAffirmativeClaim(searchable, subjectName, pattern) : false
}

function matchesDimension(subjectName: string, dimension: CreditCheckDimension, source: SearchSource): boolean {
  if (!subjectName || !isCreditCandidateSource(source)) return false
  const searchable = `${source.title ?? ''}\n${source.snippet ?? ''}\n${source.content ?? ''}`
  if (!searchable.includes(subjectName)) return false
  if (dimension === 'registration') return source.sourceClass === 'registry' || /统一社会信用代码|法定代表人|注册资本|成立日期|经营状态|登记状态|注册地址|工商登记|企业登记/.test(searchable)
  if (dimension === 'dishonest-enforcement' && source.sourceClass !== 'court') return false
  const pattern = dimensionPatterns[dimension]
  return pattern ? hasSubjectLinkedAffirmativeClaim(searchable, subjectName, pattern) : false
}

function matchesReferenceDimension(subjectName: string, dimension: CreditCheckDimension, source: SearchSource): boolean {
  if (!subjectName) return false
  const searchable = `${source.title ?? ''}\n${source.snippet ?? ''}\n${source.content ?? ''}`
  if (!searchable.includes(subjectName)) return false
  if (dimension === 'registration') return /统一社会信用代码|法定代表人|注册资本|成立日期|经营状态|登记状态|注册地址|工商登记|企业登记/.test(searchable)
  const pattern = dimensionPatterns[dimension]
  return pattern ? hasSubjectLinkedAffirmativeClaim(searchable, subjectName, pattern) : false
}

function isCreditCandidateSource(source: SearchSource): boolean {
  if (officialSourceClasses.has(source.sourceClass)) return true
  return [source.url, source.publisher ?? '', source.title ?? ''].some(isReputablePublisher)
}

function hasSubjectLinkedAffirmativeClaim(text: string, subjectName: string, pattern: RegExp): boolean {
  const subjectIndexes = indexesOf(text, subjectName)
  const termPattern = new RegExp(pattern.source, 'g')
  for (const match of text.matchAll(termPattern)) {
    const termIndex = match.index
    if (termIndex === undefined) continue
    const subjectLinked = subjectIndexes.some((subjectIndex) => Math.abs(subjectIndex - termIndex) <= 160)
    if (!subjectLinked || isNegatedOrEligibilityClause(text, termIndex) || subjectHasNonAdverseRole(text, subjectName, termIndex)) continue
    return true
  }
  return false
}

function subjectHasNonAdverseRole(text: string, subjectName: string, termIndex: number): boolean {
  const window = text.slice(Math.max(0, termIndex - 180), Math.min(text.length, termIndex + 180))
  const escaped = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:申请执行人|原告|举报人|投诉人|权利人)[：:\\s]*${escaped}`).test(window)
}

function indexesOf(text: string, value: string): number[] {
  const indexes: number[] = []
  let fromIndex = 0
  while (fromIndex < text.length) {
    const index = text.indexOf(value, fromIndex)
    if (index < 0) break
    indexes.push(index)
    fromIndex = index + Math.max(1, value.length)
  }
  return indexes
}

function isNegatedOrEligibilityClause(text: string, termIndex: number): boolean {
  const prefix = text.slice(Math.max(0, termIndex - 120), termIndex)
  return /(?:未被|没有被|未曾被|不得被|不在|未列入|未纳入|查询未发现|查询结果[^。；\n]{0,30}(?:无|没有))[^。；\n]{0,110}$/.test(prefix)
}

function dedupeSources(sources: readonly SearchSource[]): SearchSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (!source?.url || seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}
