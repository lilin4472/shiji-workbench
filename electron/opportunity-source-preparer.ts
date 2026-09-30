import type { EvidenceOpportunityDetails, EvidenceRecord } from '../shared/evidence-contract.js'
import type { ProjectStageFilter, ProjectStageId } from '../shared/project-timeline.js'
import type { OpportunitySourceChecks, SearchResult, SearchSource } from '../shared/search-contract.js'
import type { SearchDocumentReadResult } from './search-document-reader.js'
import { matchesLockedSearchTarget, type LockedSearchTargets } from '../shared/locked-search-target.js'

const DEFAULT_MAX_EXTERNAL_READS = 3

const stagePatterns: ReadonlyArray<[ProjectStageId, RegExp]> = [
  ['initiation', /(?:项目立项|立项批复|项目审批|项目核准|项目备案|可行性研究(?:报告)?批复)/i],
  ['intention', /(?:采购意向|招标计划|采购计划)/i],
  ['tender', /(?:招标公告|采购公告|公开招标公告|竞争性磋商公告|竞争性谈判公告|询价公告|征集公告|资格预审|招标文件|投标截止|响应文件提交截止|(?:工程|施工|货物|服务)招标(?:信息|项目)?|招标(?:信息|项目)|采购(?:信息|项目))/i],
  ['evaluation', /(?:开标记录|评标报告|评审结果)/i],
  ['candidate', /(?:中标候选(?:人|单位)?|成交候选(?:人|供应商)?)/i],
  ['award', /(?:中标[（(]成交[）)]结果|中标结果|中标公告|成交公告|成交结果)/i],
  ['contract', /(?:合同公告|采购合同|合同签订)/i],
]

const stagePriority: readonly ProjectStageId[] = ['contract', 'candidate', 'award', 'evaluation', 'tender', 'intention', 'initiation']

export type OpportunityDocumentReader = (source: SearchSource) => Promise<SearchDocumentReadResult>

export interface OpportunitySourcePreparerOptions extends LockedSearchTargets {
  maxExternalReads?: number
  /** Nearby enterprise results must be concrete procurement documents, not merely identifiable organizations. */
  requireConcreteOpportunityEvidence?: boolean
}

export async function prepareOpportunitySources(
  result: SearchResult,
  targetStageId: ProjectStageFilter,
  readDocument: OpportunityDocumentReader,
  options: OpportunitySourcePreparerOptions = {},
): Promise<SearchResult> {
  const maxExternalReads = nonNegativeInteger(options.maxExternalReads, DEFAULT_MAX_EXTERNAL_READS)
  let externalReads = 0
  const jobs = result.sources.map(async (source, index) => {
    // Doubao may return a long-looking summary/list snippet in `Content`.
    // It is not a substitute for the linked announcement body: without both
    // a recognizable subject and stage, force a page read so detail links can
    // be followed and the model never receives an index-page fragment.
    const providerBody = source.content?.trim() ?? ''
    const hasProviderBody = isUsableProviderBody(source)
    if (!hasProviderBody && externalReads >= maxExternalReads) {
      return {
        source: withChecks(source, summaryOnlyChecks()),
        evidence: result.evidenceRecords[index],
      }
    }
    if (!hasProviderBody) externalReads += 1

    const attempt = await readSourceSafely(readDocument, hasProviderBody ? source : { ...source, content: undefined })
    if (attempt.read && readLandedOnDifferentProject(source, attempt.read)) {
      const mismatch = '网页跳转到标题不符的另一项目，已拒绝将其正文并入当前项目。'
      if (providerBody.length >= PROVIDER_BODY_FALLBACK_MIN_LENGTH && titleAppearsInText(source.title, providerBody)) {
        const fallback = await readSourceSafely(readDocument, source)
        if (fallback.read && !readLandedOnDifferentProject(source, fallback.read)) {
          const preparedSource = withFallbackReason(sourceFromRead(source, fallback.read, targetStageId, options), mismatch)
          return {
            source: preparedSource,
            evidence: evidenceFromRead(result.evidenceRecords[index], preparedSource, fallback.read, targetStageId),
          }
        }
      }
      return {
        source: withChecks(source, {
          readStatus: 'read-failed', eligibleForModel: false, subjectCandidates: [], stageIds: [],
          stageDateCandidates: [], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [],
          reasons: [mismatch],
        }),
        evidence: failedEvidence(result.evidenceRecords[index], mismatch),
      }
    }
    if (attempt.read) {
      const preparedSource = sourceFromRead(source, attempt.read, targetStageId, options)
      return {
        source: preparedSource,
        evidence: evidenceFromRead(result.evidenceRecords[index], preparedSource, attempt.read, targetStageId),
      }
    }

    // 2026-09-16 真实端到端发现的缺口：搜索服务其实已经带回正文，但页面直读经常被
    // 政府站点的 WAF 挡住（实测 HTTP 412 / 非 UTF-8）。原实现此时把整条真实来源丢掉，
    // 结果项目明明检索到了原始公告，却显示"未取得阶段证据"。
    // 兜底：网页直读失败时改用搜索服务返回的正文继续做本机确定性提取，并在原因里写明。
    if (providerBody.length >= PROVIDER_BODY_FALLBACK_MIN_LENGTH) {
      const fallback = await readSourceSafely(readDocument, source)
      if (fallback.read) {
        const preparedSource = withFallbackReason(sourceFromRead(source, fallback.read, targetStageId, options), attempt.message)
        return {
          source: preparedSource,
          evidence: evidenceFromRead(result.evidenceRecords[index], preparedSource, fallback.read, targetStageId),
        }
      }
    }

    return {
      source: withChecks(source, {
        readStatus: 'read-failed', eligibleForModel: false, subjectCandidates: [], stageIds: [],
        stageDateCandidates: [], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [],
        reasons: [`正文未读取：${attempt.message}`],
      }),
      evidence: failedEvidence(result.evidenceRecords[index], attempt.message),
    }
  })

  const prepared = await Promise.all(jobs)
  return {
    ...result,
    sources: prepared.map((item) => item.source),
    evidenceRecords: prepared.map((item, index) => item.evidence ?? result.evidenceRecords[index]).filter((item): item is EvidenceRecord => Boolean(item)),
  }
}

/** 搜索服务返回的正文达到这个长度才作为回退正文使用，避免拿一句摘要当公告全文。 */
const PROVIDER_BODY_FALLBACK_MIN_LENGTH = 200

function titleAppearsInText(title: string | undefined, text: string): boolean {
  const normalizedTitle = projectIdentityText(title ?? '')
  const normalizedText = projectIdentityText(text)
  if (normalizedTitle.length < 6) return false
  for (let index = 0; index <= normalizedTitle.length - 6; index += 1) {
    if (normalizedText.includes(normalizedTitle.slice(index, index + 6))) return true
  }
  return false
}

function projectIdentityText(value: string): string {
  return value.toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/(?:施工标段|招标公告|采购公告|资审公告|资格预审公告|询价公告|磋商公告|项目|工程|公告)/g, '')
}

function readLandedOnDifferentProject(source: SearchSource, read: SearchDocumentReadResult): boolean {
  if (read.finalUrl === source.url || !source.title || !read.extraction.title) return false
  const title = projectIdentityText(source.title)
  const landedTitle = projectIdentityText(read.extraction.title)
  if (title.length < 6 || landedTitle.length < 6) return false
  return !titleAppearsInText(source.title, read.extraction.title)
}

async function readSourceSafely(
  readDocument: OpportunityDocumentReader,
  source: SearchSource,
): Promise<{ read: SearchDocumentReadResult } | { read?: undefined; message: string }> {
  try {
    const read = await readDocument(source)
    if (read.extraction.processingStatus !== 'content-ready' || read.extraction.text.trim().length === 0) {
      return { message: read.extraction.warnings[0] ?? '正文没有可用文字。' }
    }
    return { read }
  } catch (error) {
    return { message: error instanceof Error ? error.message : '网页正文读取失败。' }
  }
}

function withFallbackReason(source: SearchSource, message: string): SearchSource {
  const checks = source.opportunityChecks
  if (!checks) return source
  return withChecks(source, {
    ...checks,
    reasons: [`正文回退：直接读取网页失败（${message}），已改用搜索服务返回的正文。`, ...checks.reasons],
  })
}

function isUsableProviderBody(source: SearchSource): boolean {
  const content = source.content?.trim() ?? ''
  const text = [source.title, content].filter(Boolean).join('\n')
  const hasSubject = extractSubjectCandidates(text).length > 0
  const hasStage = detectProjectStages(text, source.title).length > 0
  if (hasSubject && hasStage && content.length >= 8) return true
  if (content.length < 600) return false
  return hasSubject
    && hasStage
    && !/(?:搜索结果|相关信息|信息汇总|招标采购信息|采购信息汇总|招标信息汇总)/i.test(source.title ?? '')
}

function sourceFromRead(source: SearchSource, read: SearchDocumentReadResult, targetStageId: ProjectStageFilter, options: OpportunitySourcePreparerOptions): SearchSource {
  if (read.extraction.processingStatus !== 'content-ready') {
    return withChecks(source, {
      readStatus: 'read-failed', eligibleForModel: false, subjectCandidates: [], stageIds: [],
      stageDateCandidates: [], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [],
      reasons: read.extraction.warnings.length > 0 ? read.extraction.warnings : ['正文没有可用文字。'],
    })
  }
  // 搜索服务通常给出具体公告标题，而商业站点直读后常只剩“招标公告”等通用页标题。
  // 阶段身份优先采用具体搜索标题，只有缺失时才回退正文抽取标题。
  const documentTitle = source.title?.trim() || read.extraction.title?.trim() || ''
  const documentText = [documentTitle, read.extraction.text].filter(Boolean).join('\n')
  const deterministicText = normalizeMarkdownTableRows(documentText)
  const subjectCandidates = extractSubjectCandidates(deterministicText)
  const stageIds = detectProjectStages(deterministicText, documentTitle)
  const stageDateCandidates = extractStageDateCandidates(deterministicText, source.publishedAt, read.extraction.publishedAtCandidate)
  const deadlineCandidates = extractDeadlineCandidates(deterministicText)
  const amountWanCandidates = extractAmountWanCandidates(deterministicText)
  const addressCandidates = extractAddressCandidates(deterministicText)
  // 2026-09-15 按用户决定放宽：主体或阶段任一命中即可进入模型，由模型结合正文判断，
  // 是否放入项目库由用户自行决定（归档/忽略已实现）。本机仍拦截聚合列表、门户首页和锁定目标不符的页面。
  const stageMatched = targetStageId === 'all' ? stageIds.length > 0 : stageIds.includes(targetStageId)
  const explicitStageMismatch = targetStageId !== 'all' && stageIds.length > 0 && !stageMatched
  const nonOpportunityNotice = isNonOpportunityNotice(documentTitle)
  const listingDocument = isListingDocument(source, documentTitle, documentText)
  const editorialGuide = isEditorialGuideDocument(documentTitle)
  const portalHomePage = isPortalOrSiteHomePage(source, documentTitle, deadlineCandidates, read.extraction.documentIdentifiers.length, (read.extraction.attachmentCandidates ?? []).length)
  const concreteOpportunityEvidence = hasConcreteOpportunityEvidence(
    deterministicText,
    stageIds,
    read.extraction.documentIdentifiers.length,
    deadlineCandidates.length,
    (read.extraction.attachmentCandidates ?? []).length,
  )
  const targetCompanyMatched = matchesLockedSearchTarget(deterministicText, options.targetCompanyName)
  const targetProjectMatched = matchesLockedSearchTarget(deterministicText, options.targetProjectName)
  const eligibleForModel = (subjectCandidates.length > 0 || stageIds.length > 0)
    && !explicitStageMismatch && !nonOpportunityNotice && !listingDocument && !editorialGuide && !portalHomePage
    && (!options.requireConcreteOpportunityEvidence || concreteOpportunityEvidence)
    && targetCompanyMatched && targetProjectMatched
  const reasons: string[] = []
  if (subjectCandidates.length === 0) reasons.push('正文未识别采购人、招标人、建设单位或项目业主，已交由模型结合正文判断。')
  if (!stageMatched) reasons.push(targetStageId === 'all'
    ? '正文未识别明确项目阶段，已交由模型结合正文判断。'
    : explicitStageMismatch
      ? '正文明确属于其他阶段，与本次选择的目标阶段不符，仅保留为参考来源。'
      : '正文未识别明确阶段，已交由模型结合正文判断。')
  if (nonOpportunityNotice) reasons.push('当前页面是异常、终止、废标或流标公告，不作为可跟进项目卡。')
  if (listingDocument) reasons.push('当前页面是多项目聚合列表，仅保留为发现线索；需进入单个公告页后再交给模型。')
  if (editorialGuide) reasons.push('当前页面是行业指南或查询攻略，不是单个项目公告，仅保留为参考来源。')
  if (portalHomePage) reasons.push('当前页面是平台或门户首页（无项目编号、截止时间与附件），仅保留为发现线索；请进入具体公告页。')
  if (options.requireConcreteOpportunityEvidence && !concreteOpportunityEvidence) reasons.push('附近企业商机未取得具体招采项目证据（明确阶段公告、项目编号、截止时间或附件），不生成项目卡。')
  if (!targetCompanyMatched) reasons.push(`正文未命中已锁定的目标单位“${options.targetCompanyName?.trim()}”。`)
  if (!targetProjectMatched) reasons.push(`正文未命中已锁定的目标项目“${options.targetProjectName?.trim()}”。`)
  if (eligibleForModel) reasons.push(subjectCandidates.length > 0 && stageMatched ? '正文中已识别业务主体和目标阶段。' : '正文具备可判断线索，已放行给模型结构化；结论由用户核验。')
  if (read.extraction.documentIdentifiers.length === 0) reasons.push('项目编号或文号待核验。')
  if (stageDateCandidates.length === 0) reasons.push('发布日期或阶段事项日期待核验。')
  if (deadlineCandidates.length === 0) reasons.push('投标或响应截止日期待核验。')
  if (amountWanCandidates.length === 0) reasons.push('项目预算、控制价或合同金额待核验。')
  if (addressCandidates.length === 0) reasons.push('项目建设或实施地点待定位。')

  return withChecks({
    ...source,
    ...(read.extraction.title && !source.title ? { title: read.extraction.title } : {}),
    content: read.extraction.text,
    ...(read.extraction.publishedAtCandidate ? { publishedAt: read.extraction.publishedAtCandidate } : {}),
  }, {
    readStatus: 'body-ready', eligibleForModel, subjectCandidates, stageIds,
    stageDateCandidates, deadlineCandidates, amountWanCandidates, addressCandidates, reasons,
  })
}

const concreteOpportunityNoticePattern = /(?:项目立项|立项批复|项目审批|项目核准|项目备案|可行性研究(?:报告)?批复|采购意向|招标计划|采购计划|招标公告|采购公告|公开招标公告|竞争性磋商公告|竞争性谈判公告|询价公告|征集公告|资格预审|招标文件|投标截止|响应文件提交截止|开标记录|评标报告|评审结果|中标候选(?:人|单位)?|成交候选(?:人|供应商)?|中标[（(]成交[）)]结果|中标结果|中标公告|成交公告|成交结果|合同公告|采购合同|合同签订)/i

function hasConcreteOpportunityEvidence(
  text: string,
  stageIds: readonly ProjectStageId[],
  documentIdentifierCount: number,
  deadlineCount: number,
  attachmentCount: number,
): boolean {
  if (stageIds.length === 0) return false
  return concreteOpportunityNoticePattern.test(text)
    || documentIdentifierCount > 0
    || deadlineCount > 0
    || attachmentCount > 0
}

function evidenceFromRead(
  record: EvidenceRecord | undefined,
  source: SearchSource,
  read: SearchDocumentReadResult,
  targetStageId: ProjectStageFilter,
): EvidenceRecord | undefined {
  if (!record) return undefined
  const extraction = read.extraction
  const checks = source.opportunityChecks
  const missingChecks = [...(checks?.reasons ?? [])]
  if (!extraction.originalPublisherCandidate && !extraction.originalUrlCandidate) missingChecks.push('原始发布者或出处链尚未确认。')
  if (extraction.processingStatus !== 'content-ready') missingChecks.push(...extraction.warnings)
  if (checks?.eligibleForModel && targetStageId !== 'all') missingChecks.push('阶段文字已命中，但仍需按证据等级确认后才能更新项目时间链。')
  return {
    ...record,
    title: extraction.title ?? record.title,
    artifact: {
      ...record.artifact,
      mediaKind: read.mediaKind,
      processingStatus: extraction.processingStatus,
      sizeBytes: read.sizeBytes,
    },
    provenance: {
      ...record.provenance,
      // Open the deepest page actually read (often the official tender page),
      // while retaining the repost/original provenance fields below.
      pageUrl: read.finalUrl,
      publisher: extraction.publisherCandidate ?? record.provenance.publisher,
      ...(extraction.originalPublisherCandidate ? { originalPublisher: extraction.originalPublisherCandidate } : {}),
      ...(extraction.originalUrlCandidate ? { originalUrl: extraction.originalUrlCandidate } : {}),
      provenanceType: extraction.provenanceTypeCandidate,
      documentIdentifiers: extraction.documentIdentifiers,
      ...(extraction.publishedAtCandidate ? { publishedAt: extraction.publishedAtCandidate } : {}),
    },
    assessment: {
      status: 'pending',
      reasons: extraction.processingStatus === 'content-ready' ? ['已取得正文并完成确定性字段提取；尚未形成事实结论。'] : [],
      missingChecks: unique(missingChecks),
    },
    ...(checks ? { opportunityDetails: buildOpportunityDetails(source, read, checks, extraction.text) } : {}),
  }
}

function buildOpportunityDetails(
  source: SearchSource,
  read: SearchDocumentReadResult,
  checks: OpportunitySourceChecks,
  text: string,
): EvidenceOpportunityDetails {
  const deterministicText = normalizeMarkdownTableRows(text)
  return {
    companyCandidates: checks.subjectCandidates,
    amountWanCandidates: checks.amountWanCandidates,
    stageIds: checks.stageIds,
    deadlineCandidates: checks.deadlineCandidates,
    addressCandidates: checks.addressCandidates,
    ...(overviewFromText(text, source.title) ? { overview: overviewFromText(text, source.title) } : {}),
    agencyCandidates: extractLabeledCandidates(deterministicText, /(?:(?:招标|采购)?代理机构名称|(?:招标|采购)代理机构(?!信息))/i)
      .filter((value) => !/(?:中标人|中标价|评标委员会|定标原因)/.test(value)),
    lotCandidates: extractLabeledCandidates(deterministicText, /(?:标段|标包|包组|包号)(?:名称)?/i),
    scopeCandidates: extractLabeledCandidates(deterministicText, /(?:招标范围|采购内容|项目内容|采购需求|施工范围)/i, 300),
    qualificationCandidates: extractLabeledCandidates(deterministicText, /(?:投标人资格要求|供应商资格条件|申请人资格要求)/i, 300),
    consortiumCandidates: extractLabeledCandidates(deterministicText, /(?:联合体要求|是否接受联合体|联合体投标)/i, 200),
    documentAccessCandidates: extractLabeledCandidates(deterministicText, /(?:招标文件获取方式|采购文件获取方式|获取招标文件|获取采购文件|报名方式)/i, 300),
    depositCandidates: extractLabeledCandidates(deterministicText, /(?:投标保证金|响应保证金|保证金金额)/i, 160),
    openingTimeCandidates: extractLabeledCandidates(deterministicText, /(?:开标时间|开启时间)/i, 160),
    evaluationMethodCandidates: extractLabeledCandidates(deterministicText, /(?:评标办法|评审方法|评标方法|定标方式)/i, 200),
    contactCandidates: extractContactCandidates(deterministicText),
    attachmentCandidates: uniqueAttachments([
      ...(read.extraction.attachmentCandidates ?? []),
      ...(read.mediaKind === 'pdf' ? [{ label: '公告附件（PDF）', url: read.finalUrl }] : []),
    ]),
  }
}

function overviewFromText(text: string, fallbackTitle?: string): string | undefined {
  const line = text.split(/\n+/).map((value) => value.trim()).find((value) => value.length >= 12)
  const overview = (line ?? fallbackTitle)?.trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '')
  return overview ? overview.slice(0, 180) : undefined
}

function extractContactCandidates(text: string): string[] {
  const candidates = new Set<string>()
  const patterns = [
    /(?:联系人|联 系 人|联系电话|联系电话（咨询）|联系方式|电话|手机|邮箱|电子邮箱)[ \t]*[:：]?[ \t]*([^\n。；;]{3,80})/gi,
    /\b1[3-9]\d{9}\b/g,
    /\b0\d{2,3}[-－]?\d{7,8}(?:(?:[-－]|\\\*)\d{1,6})?\b/g,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = cleanInlineCandidate(match[1] ?? match[0]).replace(/\\([*])/g, '$1').replace(/[，,；;。]+$/g, '')
      if (value.length >= 3 && value.length <= 100
        && !/(?:联系人及联系方式|Project Contact)|^[:：/\s*]+$/i.test(value)) candidates.add(value.slice(0, 100))
    }
  }
  return [...candidates].slice(0, 6)
}

function normalizeMarkdownTableRows(text: string): string {
  const plainLines: string[] = []
  const labeledRows: string[] = []
  let headers: string[] | undefined
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      plainLines.push(line)
      if (trimmed) headers = undefined
      continue
    }
    const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.replace(/\*\*/g, '').trim())
    if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/.test(cell) || !cell)) continue
    if (/^(?:序号|包号|标项号)$/.test(cells[0])) {
      headers = cells
      continue
    }
    if (headers && cells.length >= 2 && /^\d+$/.test(cells[0])) {
      headers.forEach((header, index) => {
        if (header && cells[index]) labeledRows.push(`${header}: ${cells[index]}`)
      })
      continue
    }
    headers = undefined
    if (cells[0] && cells[1]) labeledRows.push(`${cells[0]}: ${cells[1]}`)
  }
  return labeledRows.length > 0 ? `${plainLines.join('\n')}\n${labeledRows.join('\n')}` : text
}

function extractLabeledCandidates(text: string, labelPattern: RegExp, maxLength = 220): string[] {
  const pattern = new RegExp(`(?:${labelPattern.source})\\s*[:：为]?\\s*([^\\n]{2,${maxLength + 20}})`, 'gi')
  const values: string[] = []
  for (const match of text.matchAll(pattern)) {
    const value = cleanInlineCandidate(match[1])
      .replace(/\s*(?:联系人|联系电话|项目编号|招标人|采购人)\s*[:：].*$/i, '')
      .replace(/[。；;]+$/g, '')
      .trim()
      .slice(0, maxLength)
    if (value.length >= 2) values.push(value)
  }
  return unique(values)
}

function cleanInlineCandidate(value: string): string {
  return value
    .trim()
    .replace(/^\|\s*/, '')
    .split('|', 1)[0]
    .trim()
}

function uniqueAttachments(items: Array<{ label: string; url: string }>): Array<{ label: string; url: string }> {
  const byUrl = new Map<string, { label: string; url: string }>()
  for (const item of items) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item)
  }
  return [...byUrl.values()].slice(0, 20)
}

function failedEvidence(record: EvidenceRecord | undefined, message: string): EvidenceRecord | undefined {
  if (!record) return undefined
  return {
    ...record,
    artifact: { ...record.artifact, processingStatus: 'failed' },
    assessment: {
      status: 'pending', reasons: [],
      missingChecks: unique([...record.assessment.missingChecks, `正文未读取：${message}`]),
    },
  }
}

function summaryOnlyChecks(): OpportunitySourceChecks {
  return {
    readStatus: 'summary-only', eligibleForModel: false, subjectCandidates: [], stageIds: [],
    stageDateCandidates: [], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [],
    reasons: ['本次已达到 3 个外部页面的安全读取上限，当前仅保留为发现线索。'],
  }
}

function withChecks(source: SearchSource, opportunityChecks: OpportunitySourceChecks): SearchSource {
  return { ...source, opportunityChecks }
}

export function extractSubjectCandidates(text: string): string[] {
  const candidates: string[] = []
  const patterns = [
    /(?:招标人|采购人|建设单位|项目业主|业主单位|招标单位|采购单位)(?:（[^）]{0,20}）)?(?:名称)?\s*[:：为]\s*([^\n。；;，,]{2,80})/gi,
    /(?:采购人|招标人)信息[\s\S]{0,80}?名\s*称\s*[:：]\s*([^\n。；;，,]{2,80})/gi,
    // 无冒号但有空格的公告版式： “招标人 成都示例建设有限公司”
    /(?<![\u4e00-\u9fffA-Za-z0-9])(?:招标人|采购人|建设单位|项目业主|业主单位|招标单位|采购单位)(?:（[^）]{0,20}）)?(?:名称)?\s+([^\n。；;，,]{2,80})/gi,
    // 标题或正文首行里的主体： “成都示例建设有限公司关于××项目招标公告”
    /(?:^|\n)([^\n]{2,60}?(?:集团有限公司|有限责任公司|有限公司|集团|中心|研究院|设计院|学院|大学|医院|政府|管理局|委员会|管理处|指挥部))[^\n]{0,40}?(?:招标公告|采购公告|竞争性磋商公告|竞争性谈判公告|询价公告|比选公告|征集公告|招标信息|采购信息)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeSubjectCandidate(match[1])
      if (value) candidates.push(value)
    }
  }
  return unique(candidates)
}

function normalizeSubjectCandidate(rawValue: string): string | undefined {
  const value = rawValue
    .replace(/(?:联系人|地\s*址|联系方式|代理机构).*$/i, '')
    .replace(/\\([*_`[\]])/g, '$1')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[：:：\-—|]+|[：:：\-—|]+$/g, '')
    .trim()
    .slice(0, 80)
  if (value.length < 2) return undefined
  // Portal CTAs and redacted paywall placeholders are not business entities.
  // Keep the rule narrow: unfamiliar but readable organization names remain
  // valid discovery clues, while masked values never enter the model contract.
  if (/(?:\\?\*){2,}|[（(]\s*略\s*[）)]|立即查看|点击查看|查看(?:招标|详情|全文)?|登录|注册|获取(?:联系方式|全文)|咨询本项目|下载|报名|暂未提供|暂无|未知|保密/i.test(value)) {
    return undefined
  }
  // 价格 / 数量 / 工期片段不是主体：公告里"本次招标最高限价万元"常紧跟主体名换行后出现。
  if (/^(?:本次|本项目|该项目|本工程)|最高限价|投标限价|控制价|预算金额|万元|元整|费率|日历天|平方米|立方米/.test(value)) return undefined
  if (/^(?:某|相关|该)(?:单位|公司|机构)$/.test(value)) return undefined
  if (!/[\p{L}\p{N}]/u.test(value)) return undefined
  if (/^(?:招标人|采购人|建设单位|项目业主|业主单位|招标单位|采购单位|名称|单位)$/i.test(value)) return undefined
  return value
}

export function detectProjectStages(text: string, documentTitle?: string): ProjectStageId[] {
  const titleMatches = matchingStages(documentTitle ?? '')
  if (titleMatches.length > 0) return [highestPriorityStage(titleMatches)]
  const lead = text.slice(0, 1200)
  const leadMatches = stagePatterns
    .map(([stageId, pattern]) => ({ stageId, index: lead.search(pattern) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
  return leadMatches.length > 0 ? [leadMatches[0].stageId] : []
}

function matchingStages(text: string): ProjectStageId[] {
  return stagePatterns.filter(([, pattern]) => pattern.test(text)).map(([stageId]) => stageId)
}

function highestPriorityStage(stages: ProjectStageId[]): ProjectStageId {
  return stagePriority.find((stageId) => stages.includes(stageId)) ?? stages[0]
}

function extractStageDateCandidates(text: string, ...knownDates: Array<string | undefined>): string[] {
  const dates = knownDates.map(normalizeDate).filter((value): value is string => Boolean(value))
  const pattern = /(?:发布日期|发布时间|公示日期|公告日期|中标日期|成交日期|合同签订日期|立项日期|备案日期)\s*[:：为]?\s*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/gi
  for (const match of text.matchAll(pattern)) {
    const date = normalizeDateParts(match[1], match[2], match[3])
    if (date) dates.push(date)
  }
  return unique(dates)
}

function extractDeadlineCandidates(text: string): string[] {
  const dates: string[] = []
  const patterns = [
    /(?:提交投标文件截止时间|投标文件(?:提交|递交)(?:的)?截止时间(?:（[^）]{0,40}）)?|响应文件(?:提交|递交)(?:的)?截止时间|投标截止(?:时间|日期)?|响应截止(?:时间|日期)?|报名截止(?:时间|日期)?)\s*[:：为]?\s*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/gi,
    /(?:资格预审申请文件(?:提交|递交)(?:的)?截止时间|递交截止时间)\s*[:：为]?\s*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/gi,
    /(?:并)?于\s*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?(?:[^\n。；;]{0,50})?前\s*(?:提交|递交)(?:投标|响应)文件/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const date = normalizeDateParts(match[1], match[2], match[3])
      if (date) dates.push(date)
    }
  }
  return unique(dates)
}

export function extractAmountWanCandidates(text: string): number[] {
  const amounts: number[] = []
  const pattern = /(?:项目总投资|总投资|预算金额|采购预算|项目预算|估算金额|招标控制价|最高投标限价|最高限价|合同金额|项目金额|招标金额|成交金额|总中标金额|预中标金额|中标(?:[（(]成交[）)])?金额|中标价)(?:\s*[（(](?:元|万元)[）)])?\s*[:：为]?\s*(?:人民币|[￥¥])?\s*([0-9][0-9,，]*(?:\.\d+)?)\s*[（(]?\s*(亿元|万元|万|元)\s*[）)]?/gi
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1].replace(/[,，]/g, ''))
    if (!Number.isFinite(value) || value < 0) continue
    const amountWan = match[2] === '亿元' ? value * 10_000 : match[2] === '元' ? value / 10_000 : value
    amounts.push(Number(amountWan.toFixed(4)))
  }
  return [...new Set(amounts)]
}

export function extractAddressCandidates(text: string): string[] {
  const addresses: string[] = []
  const patterns = [
    /(?:项目(?:建设|实施|服务)?地点|建设地点|项目地址|实施地点|施工地点|服务地点|交付地点|交货地点|履约地点|采购标的所在地)\s*[:：为]\s*([^\n。；;]{2,160})/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]
        .trim()
        // 招标平台常把多个字段压成同一段：地址之后紧跟“招标范围/项目规模/计划工期”等。
        // 不能把整段业务描述当成地理地址送给 DSH 或天地图。
        .replace(/\s*(?:招标人|采购人|建设单位|联系人|联系方式|联系电话|项目编号|预算金额|招标范围|施工范围|招标内容|采购内容|建设内容|项目规模|建设规模|合同估算价|计划工期|工期|资金来源|采购方式|履约期限)\s*[:：].*$/i, '')
        .replace(/[，,]\s*$/, '')
        .trim()
      if (value.length >= 2) addresses.push(value.slice(0, 100))
    }
  }
  return unique(addresses)
}

function isListingDocument(source: SearchSource, title: string, text: string): boolean {
  // “某单位招标中标信息”是企业维度的历史记录聚合页，不是一个具体项目。
  // 只按这种明确的聚合标题拦截，不能因为来源是商业网站就整站排除。
  if (/(?:招标采购信息|招标中标信息|采购信息汇总|招标信息汇总|中标结果\s*[-—]|全行业)/i.test(title)) return true
  if (/\/(?:zbkeyw|diqumore|bid_gov_full)-/i.test(source.url)) return true
  const datedItems = text.match(/20\d{2}[-年]\d{1,2}[-月]\d{1,2}日?\s*[丨|]/g)?.length ?? 0
  return datedItems >= 3
}

// 搜索服务会把“哪里查项目”“实操指南”“几种渠道”一类编辑文章排在具体公告之前。
// 它们可以作为行业参考，但不能生成项目卡；规则只看强编辑型标题，不按商业站点域名一刀切。
function isEditorialGuideDocument(title: string): boolean {
  return /(?:实操指南|实战指南|操作指南|入门指南|避坑指南|哪里查|怎么查|如何查询|落地渠道|查询渠道|全拆解|渠道盘点|平台盘点|网站推荐|网站盘点)/i.test(title)
}

function isNonOpportunityNotice(title: string): boolean {
  return /(?:项目)?(?:异常|终止|废标|流标|失败)公告/i.test(title)
}

// 2026-09-15 新增：招采平台/公共资源交易门户的首页或导航页不是项目公告。
// 特征：标题或域名带平台/门户词，且正文没有项目编号、投标截止时间和附件——
// 这类页面即使提及"采购单位""招标信息"也绝不进入模型（实测曾把成都市政府招采平台首页当成合格项目）。
function isPortalOrSiteHomePage(
  source: SearchSource,
  title: string,
  deadlineCandidates: string[],
  documentIdentifierCount: number,
  attachmentCount: number,
): boolean {
  const portalWord = /(?:政府采购云平台|公共资源交易|招采平台|招投标?平台|采购平台|招标平台|门户|网站首页|平台首页|官方?网站|导航|主页)/i
  let parsed: URL
  try { parsed = new URL(source.url) } catch { return false }
  const rootPath = /^\/?(?:index\.[a-z]+)?\/?$/i.test(parsed.pathname)
  if (!portalWord.test(title) && !portalWord.test(parsed.hostname) && !rootPath) return false
  return deadlineCandidates.length === 0 && documentIdentifierCount === 0 && attachmentCount === 0
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/.exec(value.trim())
  return match ? normalizeDateParts(match[1], match[2], match[3]) : undefined
}

function normalizeDateParts(year: string, monthValue: string, dayValue: string): string | undefined {
  const month = Number(monthValue)
  const day = Number(dayValue)
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const candidate = `${year}-${monthValue.padStart(2, '0')}-${dayValue.padStart(2, '0')}`
  const parsed = new Date(`${candidate}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? undefined : candidate
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : fallback
}
