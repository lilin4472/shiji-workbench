// 产业链真实执行器（需求文档 §5.5 + 用户 2026-09-16 收敛口径）：
//   甲方（招标人）为核心节点 → 第一阶段 3 次全网定向检索（历史中标 / 本项目履约 / 供应商与代理）
//   → 拿到公司名后 → 第二阶段对重点公司做工商信息核对（企查查类页面）补法人/行业领域/电话。
// 本文件不调用任何模型：抽不到就留空，由界面显示"—"。不画图、不碰地图。
import { policySourceTier } from '../shared/policy-chain.js'
import type { SearchSource, SearchPort } from '../shared/search-contract.js'
import type { EvidenceRecord } from '../shared/evidence-contract.js'
import type {
  IndustryChainRequest, IndustryChainResult, IndustryCompany, IndustryOwner, IndustryRelationKind, IndustrySourceRef, SourceTier,
} from '../shared/industry-chain.js'
import {
  extractCompanyNames, extractIndustryField, extractIndustryMentions, extractLegalPerson, extractPhoneNear,
  extractOwnerFacts, INDUSTRY_CHAIN_BOUNDARY, INDUSTRY_ENRICHMENT_LIMIT, buildCompanyEnrichmentQuery,
  buildIndustrySearchTargets, documentSupportsIndustryTarget, documentSupportsWinner, INDUSTRY_CHAIN_SCHEMA_VERSION, resolveIndustrySourceTier, uniqueStrings,
} from '../shared/industry-chain.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import type { OpportunityDocumentReader } from './opportunity-source-preparer.js'

export type IndustryChainService = (request: IndustryChainRequest) => Promise<IndustryChainResult>

interface Candidate {
  name: string
  relation: IndustryRelationKind
  quote: string
  tier: SourceTier
  source: IndustrySourceRef
  documentText: string
}

export function createIndustryChainService(
  search: SearchPort,
  provider: () => Promise<'doubao'> = async () => 'doubao',
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
): IndustryChainService {
  return async (request) => {
    const queries = buildIndustrySearchTargets(request)
    const candidates: Candidate[] = []
    const ownerFacts: Array<{ legalPerson?: string; phone?: string; industryField?: string; source: IndustrySourceRef }> = []
    const gaps: string[] = []
    let requestCount = 0
    let anyLive = false
    let checkedAt = new Date().toISOString()

    for (const [index, query] of queries.entries()) {
      const result = await search({ provider: await provider(), purpose: 'industry-chain', query, maxResults: 10 })
      requestCount += result.requestCount
      if (!result.cacheHit) anyLive = true
      checkedAt = result.checkedAt
      let matched = 0

      for (const [sourceIndex, source] of result.sources.entries()) {
        const record = result.evidenceRecords[sourceIndex]
        if (!record) continue
        const text = await readIndustryBody(readDocument, source)
        if (!text) continue
        const pageUrl = record.provenance.pageUrl ?? source.url
        const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
        const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
        // 用户口径：中标关系必须来自"结果类"公告；纯招标公告里的公司不算中标方。
        const resultNotice = documentSupportsWinner(title, text)
        const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
        const sourceRef: IndustrySourceRef = {
          evidenceId: record.id, title, publisher,
          ...(record.provenance.pageUrl ? { pageUrl: record.provenance.pageUrl } : {}),
          tier,
        }

        // 甲方四维度：只在提到甲方的窗口里抽。
        if (request.companyName && text.includes(request.companyName)) {
          const facts = extractOwnerFacts(text, request.companyName)
          if (facts.legalPerson || facts.phone || facts.industryField) ownerFacts.push({ ...facts, source: sourceRef })
        }

        // 搜索结果本身不是关系证据：正文必须出现当前甲方或当前项目，才允许建产业关系边。
        if (!documentSupportsIndustryTarget(text, request)) continue
        const mentions = extractIndustryMentions(text)
        for (const mention of mentions) {
          if (normalizeName(mention.name) === normalizeName(request.companyName)) continue
          if (mention.relation === 'historical-winner' && !resultNotice) continue
          candidates.push({
            name: mention.name, relation: mention.relation, quote: mention.quote, tier, source: sourceRef,
            documentText: text,
          })
          matched += 1
        }
      }

      if (matched === 0) void 0 /* 每组检索命中数只进日志，不上卡片 */
    }

    const winners = buildCompanies(candidates, 'winner')
    // 同一家既被写成中标人又被写成供应商时，只在中标清单里出现一次（中标是更强的关系）。
    const winnerKeys = new Set(winners.map((company) => normalizeName(company.name)))
    const suppliers = buildCompanies(candidates.filter((candidate) => !winnerKeys.has(normalizeName(candidate.name))), 'supplier')
    const owner = buildOwner(request, ownerFacts)

    // ── 第二阶段：拿到公司名后去工商/企业信息页补法人、行业领域、电话 ──────
    const enrichTargets = pickEnrichmentTargets(winners, suppliers, owner)
    const enrichNotes: string[] = []
    for (const target of enrichTargets) {
      const query = buildCompanyEnrichmentQuery(target.name)
      const result = await search({ provider: await provider(), purpose: 'industry-chain', query, maxResults: 5 })
      requestCount += result.requestCount
      if (!result.cacheHit) anyLive = true
      let filled = false
      for (const [sourceIndex, source] of result.sources.entries()) {
        const record = result.evidenceRecords[sourceIndex]
        if (!record) continue
        const pageUrl = record.provenance.pageUrl ?? source.url
        const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
        const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
        const text = await readIndustryBody(readDocument, source)
        if (!text || !text.includes(target.name)) continue
        const window = windowAround(text, target.name, 500)
        const legalPerson = target.legalPerson ?? extractLegalPerson(window)
        const industryField = target.industryField ?? extractIndustryField(window)
        const phone = target.phone ?? extractPhoneNear(text, target.name)
        if (!target.legalPerson && legalPerson) filled = true
        if (!target.industryField && industryField) filled = true
        if (!target.phone && phone) filled = true
        target.legalPerson = legalPerson
        target.industryField = industryField
        target.phone = phone
        if (legalPerson || industryField || phone) {
          target.sources = [...target.sources, { evidenceId: record.id, title: (source.title ?? record.title ?? '').trim() || '企业信息页', publisher, ...(record.provenance.pageUrl ? { pageUrl: record.provenance.pageUrl } : {}), tier }].slice(0, 4)
          break
        }
      }
      if (!filled) enrichNotes.push(`「${target.name}」的工商信息本次未取得。`)
    }
    // 甲方的那份是复制出来的对象，把核对结果写回 owner（企业中标的公司是同一引用，已就地更新）。
    const ownerTarget = enrichTargets.find((target) => normalizeName(target.name) === normalizeName(owner.name))
    if (ownerTarget) {
      owner.legalPerson = ownerTarget.legalPerson
      owner.industryField = ownerTarget.industryField
      owner.phone = ownerTarget.phone
      owner.sources = ownerTarget.sources
    }
    if (enrichTargets.length > 0) {
      void 0 /* 工商核对过程不上卡片 */
    }
    void 0 /* 单家未取得工商信息在表格里已逐格显示""，不再汇总进缺口 */
    if (owner.name && !owner.legalPerson && !owner.phone && !owner.industryField) {
      gaps.push(`甲方「${owner.name}」的法人 / 行业领域 / 电话在本次公开来源里未取得。`)
    }
    if (winners.length === 0) gaps.push('本次未检索到以往中标/成交企业（公告正文里没有可核验的中标人字段）。')
    if (suppliers.length === 0) gaps.push('本次未检索到可核验的上下游供应链企业（供应商/分包/联合体/代理）。')

    return {
      schemaVersion: INDUSTRY_CHAIN_SCHEMA_VERSION,
      opportunityId: request.opportunityId,
      projectTitle: request.projectTitle,
      owner,
      winners,
      suppliers,
      queries: [...queries, ...enrichTargets.map((target) => buildCompanyEnrichmentQuery(target.name))],
      requestCount: Math.min(requestCount, 8) as number,
      cacheHit: !anyLive,
      checkedAt,
      gaps: uniqueStrings(gaps),
      boundary: INDUSTRY_CHAIN_BOUNDARY,
    }
  }
}

/** 把候选按关系归到"以往中标企业 / 上下游供应链"两块，并把四维度补齐（抽不到就留空）。 */
function buildCompanies(candidates: Candidate[], bucket: 'winner' | 'supplier'): IndustryCompany[] {
  const wanted: IndustryRelationKind[] = bucket === 'winner'
    ? ['historical-winner']
    : ['supplier', 'contractor', 'subcontractor', 'consortium-member', 'tender-agent', 'parent-company', 'subsidiary', 'branch-company']
  const byName = new Map<string, IndustryCompany>()
  for (const candidate of candidates.filter((item) => wanted.includes(item.relation))) {
    const key = normalizeName(candidate.name)
    const existing = byName.get(key)
    const enriched: IndustryCompany = {
      id: existing?.id ?? `company:${key}`,
      name: existing?.name ?? candidate.name,
      relation: existing?.relation ?? candidate.relation,
      relationQuote: existing?.relationQuote ?? candidate.quote,
      legalPerson: existing?.legalPerson ?? extractLegalPerson(windowAround(candidate.documentText, candidate.name, 400)),
      industryField: existing?.industryField ?? extractIndustryField(windowAround(candidate.documentText, candidate.name, 400)),
      phone: existing?.phone ?? extractPhoneNear(candidate.documentText, candidate.name),
      sources: dedupeSources([...(existing?.sources ?? []), candidate.source]),
      // 官方原文里的明确标签算确认，媒体转载只算线索候选。
      confidence: (existing?.confidence === 'confirmed' || candidate.tier === 'official') ? 'confirmed' : 'candidate',
    }
    byName.set(key, enriched)
  }
  return [...byName.values()].sort((left, right) => {
    if (left.confidence !== right.confidence) return left.confidence === 'confirmed' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function buildOwner(
  request: IndustryChainRequest,
  facts: Array<{ legalPerson?: string; phone?: string; industryField?: string; source: IndustrySourceRef }>,
): IndustryOwner {
  const owner: IndustryOwner = { name: request.companyName.trim(), sources: [] }
  for (const fact of facts) {
    if (!owner.legalPerson && fact.legalPerson) owner.legalPerson = fact.legalPerson
    if (!owner.phone && fact.phone) owner.phone = fact.phone
    if (!owner.industryField && fact.industryField) owner.industryField = fact.industryField
    owner.sources = dedupeSources([...owner.sources, fact.source])
  }
  return owner
}

async function readIndustryBody(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  const providerBody = source.content?.trim() ?? ''
  const attempt = await tryRead(readDocument, providerBody.length >= 200 ? source : { ...source, content: undefined })
  const pageText = attempt ?? (await tryRead(readDocument, source)) ?? ''
  // 用户口径：豆包搜索返回的摘要就是它智能体自己用的正文，必须当主文本，页面直读只作补充。
  const merged = [providerBody, pageText].filter((part) => part.length > 0).join('\n')
  return merged.length >= 60 ? merged : undefined
  return undefined
}

async function tryRead(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  try {
    const read = await readDocument(source)
    if (read.extraction.processingStatus !== 'content-ready') return undefined
    const text = read.extraction.text.trim()
    return text.length >= 60 ? text : undefined
  } catch {
    return undefined
  }
}

function dedupeSources(sources: IndustrySourceRef[]): IndustrySourceRef[] {
  return [...new Map(sources.map((source) => [source.evidenceId, source])).values()].slice(0, 4)
}

/**
 * 第二阶段核对谁：优先"官方公告确认的中标企业"，再补上下游与甲方；
 * 三个字段都齐的不用再查；每项目最多 INDUSTRY_ENRICHMENT_LIMIT 家。
 */
interface EnrichTarget {
  name: string
  legalPerson?: string
  industryField?: string
  phone?: string
  sources: IndustrySourceRef[]
}

function pickEnrichmentTargets(winners: IndustryCompany[], suppliers: IndustryCompany[], owner: IndustryOwner): EnrichTarget[] {
  const ordered: EnrichTarget[] = [
    { name: owner.name, legalPerson: owner.legalPerson, industryField: owner.industryField, phone: owner.phone, sources: owner.sources },
    ...winners.filter((company) => company.confidence === 'confirmed'),
    ...suppliers.filter((company) => company.confidence === 'confirmed'),
    ...winners.filter((company) => company.confidence !== 'confirmed'),
    ...suppliers.filter((company) => company.confidence !== 'confirmed'),
  ]
  const picked: EnrichTarget[] = []
  const seen = new Set<string>()
  for (const target of ordered) {
    if (!target.name || seen.has(normalizeName(target.name))) continue
    seen.add(normalizeName(target.name))
    if (target.legalPerson && target.industryField && target.phone) continue
    picked.push(target)
    if (picked.length >= INDUSTRY_ENRICHMENT_LIMIT) break
  }
  return picked
}

function normalizeName(value: string): string {
  return value.replace(/[\s（）()·]/g, '').toLocaleLowerCase('zh-CN')
}

function windowAround(text: string, keyword: string, radius: number): string {
  const index = text.indexOf(keyword)
  if (index < 0) return text.slice(0, radius * 2)
  return text.slice(Math.max(0, index - radius), index + radius)
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`
}
