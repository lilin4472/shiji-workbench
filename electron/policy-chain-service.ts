// 政策链真实执行器（对应需求文档 §5.6）：
//   国家 → 省/直辖市 → 市/区县，一级一次定向检索，读正文后做**确定性**抽取：
//   · 每一级只保留真的像政策/预算文件的正文（办法/细则/方案/通知/规划/预算/资金…）；
//   · 穿透性只用"正文点名下級"的原句作证据，不靠层级关系推定资金已到某单位；
//   · 预测交给 shared/policy-chain.ts 的规则引擎，没有依据就不输出预测。
// 本文件不做任何模型调用，也不需要模型：抽不到就如实写"未取得"。
import type { PolicyChainRequest, PolicyChainResult, PolicyFinding, PolicyInstrumentKind, PolicyPenetrationLink, PolicyPredictionInput } from '../shared/policy-chain.js'
import {
  buildPolicyPredictions, buildPolicySearchTargets, isPolicyListingPage, matchesPolicyScope, parsePolicyRegion,
  policyEvidenceRef, policyScopeKeywords, policySourceTier, readPolicySignals,
  POLICY_CHAIN_BOUNDARY, POLICY_LEVEL_IDS, type PolicyLevelId,
} from '../shared/policy-chain.js'
import type { SearchPort, SearchSource } from '../shared/search-contract.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import type { OpportunityDocumentReader } from './opportunity-source-preparer.js'
import type { EvidenceRecord } from '../shared/evidence-contract.js'

export type PolicyChainService = (request: PolicyChainRequest) => Promise<PolicyChainResult>

export function createPolicyChainService(
  search: SearchPort,
  provider: () => Promise<'doubao'> = async () => 'doubao',
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
): PolicyChainService {
  return async (request) => {
    const region = parsePolicyRegion(request.address, request.companyName)
    const targets = buildPolicySearchTargets(request)
    const findings: PolicyFinding[] = []
    const documents: PolicyPredictionInput['documents'] = []
    const gaps: string[] = [...region.gaps]
    // 相关性用"行业域关键词族"判定，不再要求正文出现行业原词（实测那会把真政策全拦掉）。
    const scopeKeywords = policyScopeKeywords({ industry: request.industry, projectTitle: request.projectTitle, address: request.address })
    let requestCount = 0
    let anyLive = false
    let checkedAt = new Date().toISOString()

    for (const target of targets) {
      const result = await search({ provider: await provider(), purpose: 'policy-chain', query: target.query, maxResults: 10 })
      requestCount += result.requestCount
      if (!result.cacheHit) anyLive = true
      checkedAt = result.checkedAt
      const lowerLabels = region.path.filter((level) => levelOrder(level.id) > levelOrder(target.levelId)).map((level) => level.label)
      let matched = 0

      for (const [index, source] of result.sources.entries()) {
        const record = result.evidenceRecords[index]
        if (!record) continue
        const text = await readPolicyBody(readDocument, source)
        if (!text) continue
        const title = readTitle(source, record)
        // 标题是判断"是不是政策/预算文件"最强的信号（招标公告必须被排除）。
        const signals = readPolicySignals(text, lowerLabels, request.industry, title)
        if (!signals.isPolicyDocument) continue
        // 与本次行业域相关的才留下（域关键词族命中任一即可）。
        if (!matchesPolicyScope(title, text, scopeKeywords)) continue
        // 栏目列表页/门户首页不是政策文件本身。
        if (isPolicyListingPage(title, record.provenance.pageUrl)) continue
        matched += 1
        const publisher = signals.publisher ?? source.publisher ?? record.provenance.publisher
        const penetration: PolicyPenetrationLink[] = lowerLabels
          .map((label) => {
            const quote = signals.penetrationQuotes.find((item) => item.includes(label))
            return quote ? { targetLevelId: lowerLevelId(region.path, label), targetLabel: label, quote } : undefined
          })
          .filter((item): item is PolicyPenetrationLink => Boolean(item))
        const tier = policySourceTier(record.provenance.pageUrl, publisher)
        findings.push({
          id: `policy-${target.levelId}-${record.id}`,
          levelId: target.levelId,
          levelLabel: target.label,
          kind: signals.kind,
          title,
          publisher,
          ...(signals.documentNumber ? { documentNumber: signals.documentNumber } : {}),
          industries: unique([request.industry, ...(request.industry ? [request.industry] : [])]),
          instruments: signals.instruments,
          ...(signals.effectiveAt ? { effectiveAt: signals.effectiveAt } : {}),
          transmission: transmissionOf(signals.kind, signals.instruments, target.label, lowerLabels),
          penetration,
          relatedSubjects: unique([request.companyName, request.projectTitle].filter(Boolean)),
          sources: [policyEvidenceRef(record)],
          sourceTier: tier,
          // 媒体转载即使字段齐全也只算参考，不能升到"依据完整"。
          confidence: tier === 'official'
            ? (signals.documentNumber && signals.effectiveAt ? 'high' : 'medium')
            : 'low',
        })
        documents.push({ levelId: target.levelId, levelLabel: target.label, evidenceId: record.id, title, publisher, signals })
      }

      if (matched === 0) { /* 三级梯里每个层级已直接显示"本次未检索到可核验的政策/预算文件"，不再重复进缺口 */ }
    }

    const predictions = buildPolicyPredictions({
      documents, industry: request.industry, stageDates: request.stageDates ?? [], now: new Date(checkedAt),
    })
    if (predictions.length === 0) {
      gaps.push('本次未取得可支撑预测的依据（缺少预算年度文件、历史采购节奏或正式采购意向），因此不输出预测时间。')
    }

    // 门禁放宽后一级可能命中很多份；每级默认展示 5 份（官方优先），其余只报数量不塞满卡片。
    const MAX_FINDINGS_PER_LEVEL = 5
    const ordered = dedupeFindings(findings).sort((left, right) => {
      if (left.levelId !== right.levelId) return levelOrder(left.levelId) - levelOrder(right.levelId)
      // 国家级优先放中央发文；其它级别官方原文优先，再按生效时间倒序。
      const fit = levelFit(right) - levelFit(left)
      if (fit !== 0) return fit
      return (right.effectiveAt ?? '').localeCompare(left.effectiveAt ?? '')
    })
    const visible = POLICY_LEVEL_IDS.flatMap((levelId) => ordered.filter((finding) => finding.levelId === levelId).slice(0, MAX_FINDINGS_PER_LEVEL))
    for (const levelId of POLICY_LEVEL_IDS) {
      const total = ordered.filter((finding) => finding.levelId === levelId).length
      if (total > MAX_FINDINGS_PER_LEVEL) {
        const label = region.path.find((level) => level.id === levelId)?.label ?? levelId
        { /* 截断只影响展示数量，卡片头部已写"N 份"，不进缺口污染版面 */ }
      }
    }

    return {
      opportunityId: request.opportunityId,
      subjectName: request.companyName,
      industry: request.industry,
      regionPath: region.path,
      findings: visible,
      predictions,
      queries: targets,
      requestCount: Math.min(requestCount, 3) as 0 | 1 | 2 | 3,
      cacheHit: !anyLive,
      checkedAt,
      gaps: unique(gaps),
      boundary: POLICY_CHAIN_BOUNDARY,
    }
  }
}

function levelOrder(id: PolicyLevelId): number {
  return POLICY_LEVEL_IDS.indexOf(id)
}

function lowerLevelId(path: Array<{ id: PolicyLevelId; label: string }>, label: string): PolicyLevelId {
  return path.find((level) => level.label === label)?.id ?? 'municipal'
}

async function readPolicyBody(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  const providerBody = source.content?.trim() ?? ''
  const attempt = await tryRead(readDocument, providerBody.length >= 200 ? source : { ...source, content: undefined })
  if (attempt) return attempt
  // 与时间链同一套回退：网页直读被 WAF 挡住时，用搜索服务返回的正文继续（不丢真实来源）。
  if (providerBody.length >= 200) return tryRead(readDocument, source)
  return undefined
}

async function tryRead(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  try {
    const read = await readDocument(source)
    if (read.extraction.processingStatus !== 'content-ready') return undefined
    const text = read.extraction.text.trim()
    return text.length >= 80 ? text : undefined
  } catch {
    return undefined
  }
}

function readTitle(source: SearchSource, record: EvidenceRecord): string {
  const title = (source.title ?? record.title ?? '').trim()
  return title.length > 0 ? title : '未命名政策文件'
}

function transmissionOf(kind: PolicyInstrumentKind, instruments: string[], levelLabel: string, lowerLabels: string[]): string {
  const target = lowerLabels.length > 0 ? lowerLabels.join(' / ') : '未取得更下一级'
  const channel = instruments.length > 0 ? instruments.join('、') : '文件任务'
  return kind === 'budget'
    ? `${levelLabel}通过「${channel}」向 ${target} 传导资金；是否已到具体招标单位仍需下一级文件或采购公告确认。`
    : `${levelLabel}通过「${channel}」向 ${target} 传导任务与方向；不等于资金已到具体招标单位。`
}

function dedupeFindings(findings: PolicyFinding[]): PolicyFinding[] {
  // 同一份文件经常在多个站点重复（实测川府发〔2026〕13号同时出现在省住建厅和投资项目网），
  // 有文号按"层级 + 文号"归一，没有文号退回"层级 + 标题"；键里必须带层级，跨级命中是合法的。
  return [...new Map(findings.map((finding) => {
    const identity = finding.documentNumber ?? finding.title.replace(/\s+/g, '').slice(0, 40)
    return [`${finding.levelId}:${identity}`, finding]
  })).values()]
}

/** 排序权重：官方原文 > 媒体；国家级优先中央发文机关（地方转发/解读排在后面）。 */
function levelFit(finding: PolicyFinding): number {
  const official = finding.sourceTier === 'official' ? 10 : 0
  const central = finding.levelId === 'national' && /(国务院|国家|中央|中国政府网|财政部|发展改革委|住房和城乡建设部|人民银行|国家统计局)/.test(`${finding.publisher} ${finding.title}`) ? 5 : 0
  const hasNumber = finding.documentNumber ? 2 : 0
  return official + central + hasNumber
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
