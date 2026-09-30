// 公开风险真实执行器（需求文档 §5.8 + 用户 2026-09-16 口径）：
//   对象 = 发布招标的招标单位（甲方）；政府机关/事业单位同样受理（它们没有工商注册信息，
//   改看机构登记与行政诉讼），门禁按用户要求放宽；4 组全网检索 → 读正文 → 确定性抽取
//   "基础登记信息 + 逐条风险事实（含简洁事由）"。不调用模型，抽不到就留"—"。
import { isCourtAnnouncementSource, parseCourtAnnouncement } from '../shared/court-announcement.js'
import { policySourceTier } from '../shared/policy-chain.js'
import { resolveIndustrySourceTier } from '../shared/industry-chain.js'
import type { SearchSource, SearchPort } from '../shared/search-contract.js'
import type {
  CreditRiskFact, CreditRiskRequest, CreditRiskResult, CreditRiskSubjectProfile, CreditRiskSubjectType,
} from '../shared/credit-risk.js'
import {
  CREDIT_RISK_BOUNDARY, buildCreditRiskQueries, codeLabelFor, detectSubjectType,
  buildClueVerificationQueries, buildFactSourceQueries, buildRegistrationFieldQueries, buildVerifications, extractClueIdentifiers, extractCreditFacts, extractRegistrationProfile, extractRegistrationProfileWide, isAggregatorSource, isLoginWalledSource,
} from '../shared/credit-risk.js'
import { buildEvidenceTable, parseSynthesisResponse, stripMarkup, toCreditRiskFacts, validateSynthesis } from '../shared/evidence-synthesis.js'
import type { EvidenceSynthesisPayload } from './evidence-synthesis-backend.js'
import type { CreditClueIdentifier } from '../shared/credit-risk.js'
import { AGENT_LOOP_MAX_STEPS, parseLoopAction, toCreditRiskFactsFromLoop, type LoopAction, validateLoopReport, type LoopReport } from '../shared/agent-loop.js'
import type { LoopStepPayload } from './evidence-synthesis-backend.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import type { OpportunityDocumentReader } from './opportunity-source-preparer.js'

export type CreditRiskService = (request: CreditRiskRequest) => Promise<CreditRiskResult>

// 可读诊断日志（纯文本）。主进程落到 userData\logs\credit-risk.log，
// 用来回答"为什么没搜到内容"：每一组检索、每一条来源归类、每一轮模型原始返回都留痕。
export type RiskLog = (message: string) => void
const noopRiskLog: RiskLog = () => {}

export function createCreditRiskService(
  search: SearchPort,
  provider: () => Promise<'doubao'> = async () => 'doubao',
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
  synthesize?: (payload: EvidenceSynthesisPayload) => Promise<string>,
  runLoopStep?: (payload: LoopStepPayload) => Promise<string>,
  log: RiskLog = noopRiskLog,
): CreditRiskService {
  return async (request) => {
    // 主体名来自检索结果，可能带 <u> 之类 HTML 标记 → 先清洗（用户反馈 U 字符问题）。
    const subjectName = stripMarkup(request.companyName.trim())
    const { type: subjectType, basis: subjectTypeBasis } = detectSubjectType(subjectName)
    const queries = buildCreditRiskQueries(request, subjectType)
    const facts: CreditRiskFact[] = []
    const clues: CreditClueIdentifier[] = []
    const evidenceRaw: Array<{ id: string; title: string; publisher: string; date: string; url?: string; tier: 'official' | 'registry' | 'media'; walled: boolean; text: string }> = []
    const profileCandidates: Array<{ fields: Partial<CreditRiskSubjectProfile>; fields_count: number; title: string; url?: string }> = []
    const gaps: string[] = []
    let requestCount = 0
    let modelCalls = 0
    let modelAssessment: string | undefined
    let anyLive = false
    let checkedAt = new Date().toISOString()
    log(`[开始] 主体=${subjectName}｜机构类型=${subjectType}（${subjectTypeBasis}）｜项目=${request.projectTitle}｜首轮检索 ${queries.length} 组`)

    // 逐条检索，不要改成并发：SearchManager 对同一供应商是单飞锁（并发第二次会抛「搜索正在运行」），
    // SearchCache 也是整文件读改写；两者都要求同一供应商串行。改并发会让本模块 0 次调用即失败。
    for (const [index, query] of queries.entries()) {
      const result = await search({ provider: await provider(), purpose: 'business-credit', query, maxResults: 10 })
      requestCount += result.requestCount
      if (!result.cacheHit) anyLive = true
      checkedAt = result.checkedAt
      let matched = 0

      for (const [sourceIndex, source] of result.sources.entries()) {
        const record = result.evidenceRecords[sourceIndex]
        if (!record) continue
        const text = await readCreditBody(readDocument, source)
        if (!text) continue
        const pageUrl = record.provenance.pageUrl ?? source.url
        const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
        const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
        const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))

        evidenceRaw.push({ id: `E${evidenceRaw.length + 1}`, title, publisher, date: checkedAt.slice(0, 10), ...(pageUrl ? { url: pageUrl } : {}), tier, walled: isLoginWalledSource(pageUrl, publisher), text })
        // 聚合站（需登录）不产事实（只抽案号/文号线索）；但正文仍进模型证据表，供模型判断与归纳。
        log(`  [来源 E${evidenceRaw.length}] tier=${tier}｜${isAggregatorSource(pageUrl, publisher, title) ? '聚合站(只取线索)' : '非聚合站'}｜正文 ${text.length} 字｜${title.slice(0, 50)}｜${(pageUrl ?? '').slice(0, 70)}`)
        if (isAggregatorSource(pageUrl, publisher, title)) {
          clues.push(...extractClueIdentifiers(text, subjectName))
          continue
        }        const extracted = extractCreditFacts({ subjectName, title, publisher, pageUrl, text, tier })
        if (extracted.length > 0) {
          facts.push(...extracted)
          matched += extracted.length
        }

        // 基础登记信息：只认"页面在讲这个主体"的来源，取字段最全的一份。
        if (text.includes(subjectName)) {
          const fields = extractRegistrationProfile(text, subjectName, subjectType)
          const fieldCount = Object.keys(fields).length
          if (fieldCount > 0) {
            profileCandidates.push({ fields, fields_count: fieldCount, title, ...(pageUrl ? { url: pageUrl } : {}) })
            matched += 1
          }
        }
      }

      log(`[首轮 ${index + 1}/${queries.length}] 来源 ${result.sources.length} 条｜命中事实 ${matched} 条｜缓存=${result.cacheHit ? '是' : '否'}｜${truncate(query, 70)}`)
      if (matched === 0) log(`第 ${index + 1} 组检索（${truncate(query, 40)}）未取得可核验的主体信息。`)
    }

    // ── 阶段二：事实缺"案情/公开链接"时，去公开站点定向补搜（每类别最多 1 组，总量封顶 4 组） ──
    const needSource = dedupe(facts).filter((fact) => fact.reason.includes('来源未写明具体事由'))
    const hunted = new Set<string>()
    for (const fact of needSource) {
      if (hunted.size >= 6 || hunted.has(fact.category)) continue
      hunted.add(fact.category)
      for (const query of buildFactSourceQueries(subjectName, fact.category).slice(0, 1)) {
        const result = await search({ provider: await provider(), purpose: 'business-credit', query, maxResults: 10 })
        requestCount += result.requestCount
        if (!result.cacheHit) anyLive = true
        for (const [sourceIndex, source] of result.sources.entries()) {
          const record = result.evidenceRecords[sourceIndex]
          if (!record) continue
          const text = await readCreditBody(readDocument, source)
          if (!text || !text.includes(subjectName)) continue
          const pageUrl = record.provenance.pageUrl ?? source.url
          const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
          const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
          const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
          const better = extractCreditFacts({ subjectName, title, publisher, pageUrl, text, tier })
            .find((candidate) => candidate.category === fact.category && !candidate.sourceWalled && !candidate.reason.includes('来源未写明具体事由'))
          if (!better) continue
          fact.reason = better.reason
          fact.sourceTitle = better.sourceTitle
          fact.publisher = better.publisher
          fact.sourceUrl = better.sourceUrl
          fact.tier = better.tier
          fact.sourceWalled = false
          if (better.occurredAt) fact.occurredAt = better.occurredAt
          if (better.amount) fact.amount = better.amount
          if (better.authority) fact.authority = better.authority
          if (better.documentNumber) fact.documentNumber = better.documentNumber
          if (better.location) fact.location = better.location
          log(`「${fact.categoryLabel}」已改用公开来源：${publisher}`)
          break
        }
      }
    }

    // ── 阶段三：登记字段缺失（用户反馈"组织机构代码、法人还是没有"）→ 按字段定向补搜公开来源 ──
    const profileExtra: Partial<CreditRiskSubjectProfile> = {}
    let profileExtraSource: { title: string; url?: string } | undefined
    const needRegistration = profileCandidates.length === 0
      || !profileCandidates.some((candidate) => candidate.fields.code)
      || !profileCandidates.some((candidate) => candidate.fields.legalPerson)
    if (needRegistration) {
      for (const query of buildRegistrationFieldQueries(subjectName, subjectType)) {
        if (profileExtra.code && profileExtra.legalPerson && profileExtra.address) break
        const result = await search({ provider: await provider(), purpose: 'business-credit', query, maxResults: 10 })
        log(`[登记补搜] 来源 ${result.sources.length} 条｜缓存=${result.cacheHit ? '是' : '否'}｜${truncate(query, 70)}`)
        requestCount += result.requestCount
        if (!result.cacheHit) anyLive = true
        for (const [sourceIndex, source] of result.sources.entries()) {
          const record = result.evidenceRecords[sourceIndex]
          if (!record) continue
          const text = await readCreditBody(readDocument, source)
          if (!text || !text.includes(subjectName)) continue
          const pageUrl = record.provenance.pageUrl ?? source.url
          const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
          const fields = extractRegistrationProfileWide(text, subjectName, subjectType)
          if (Object.keys(fields).length === 0) continue
          for (const [key, value] of Object.entries(fields)) {
            if (value === undefined || value === '') continue
            if ((profileExtra as Record<string, unknown>)[key] === undefined) (profileExtra as Record<string, unknown>)[key] = value
          }
          if (!profileExtraSource) profileExtraSource = { title: (source.title ?? record.title ?? '').trim() || '登记信息页', ...(pageUrl ? { url: pageUrl } : {}) }
        }
      }
    }

    // 用户反馈"组织机构代码、法人没有" → 不再只取字段最全的一份，而是把各来源互补合并：
    // 谁先有值就用谁，后面的只补空缺；原文链接优先给不需要登录/扫码的公开来源。
    const ordered = [...profileCandidates].sort((left, right) => {
      const walledDiff = Number(isLoginWalledSource(left.url, left.title)) - Number(isLoginWalledSource(right.url, right.title))
      if (walledDiff !== 0) return walledDiff
      return right.fields_count - left.fields_count
    })
    const merged: Partial<CreditRiskSubjectProfile> = {}
    for (const candidate of ordered) {
      for (const [key, value] of Object.entries(candidate.fields)) {
        if (value === undefined || value === '') continue
        if ((merged as Record<string, unknown>)[key] === undefined) (merged as Record<string, unknown>)[key] = value
      }
    }
    const openSource = ordered.find((candidate) => !isLoginWalledSource(candidate.url, candidate.title)) ?? ordered[0]
    const profile: CreditRiskSubjectProfile = {
      name: subjectName,
      subjectType,
      subjectTypeBasis,
      codeLabel: codeLabelFor(subjectType),
      ...merged,
      ...profileExtra,
      ...(profileExtraSource?.title ? { sourceTitle: profileExtraSource.title } : openSource?.title ? { sourceTitle: openSource.title } : {}),
      ...(profileExtraSource?.url ? { sourceUrl: profileExtraSource.url } : openSource?.url ? { sourceUrl: openSource.url } : {}),
    }

    // 聚合站（启信宝/爱企查/企查查/天眼查）只给栏目名、没有正文 → 降级为栏目级线索，不占事由列。
    const AGGREGATOR = /(启信宝|爱企查|企查查|天眼查|水滴信用)/
    for (const fact of facts) {
      if (fact.reason.includes('来源未写明具体事由') && AGGREGATOR.test(fact.publisher)) fact.leadOnly = true
    }
    // ── 阶段三点五：线索 → 权威平台核验（聚合站给的案号/文号，拿去裁判文书网/信用中国核） ──
    const clueVerificationQueries = buildClueVerificationQueries(clues, subjectName)
    for (const query of clueVerificationQueries) {
      const result = await search({ provider: await provider(), purpose: 'business-credit', query, maxResults: 10 })
      log(`[线索核验] 来源 ${result.sources.length} 条｜缓存=${result.cacheHit ? '是' : '否'}｜${truncate(query, 70)}`)
      requestCount += result.requestCount
      if (!result.cacheHit) anyLive = true
      checkedAt = result.checkedAt
      for (const [sourceIndex, source] of result.sources.entries()) {
        const record = result.evidenceRecords[sourceIndex]
        if (!record) continue
        const text = await readCreditBody(readDocument, source)
        if (!text || !text.includes(subjectName)) continue
        const pageUrl = record.provenance.pageUrl ?? source.url
        const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
        const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
        if (isAggregatorSource(pageUrl, publisher, title)) continue
        const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
        evidenceRaw.push({ id: `E${evidenceRaw.length + 1}`, title, publisher, date: checkedAt.slice(0, 10), ...(pageUrl ? { url: pageUrl } : {}), tier, walled: false, text: withCourtSummary(text, pageUrl, publisher) })
        facts.push(...extractCreditFacts({ subjectName, title, publisher, pageUrl, text, tier }))
      }
    }
    if (clues.length > 0) log(`已提取 ${clues.length} 条线索标识符（案号/文号/当事人），并按其中 ${clueVerificationQueries.length} 条去权威平台核验。`)
    // ── 阶段三点七：Agent Loop（模型主导检索）──────────────────────────
    // 模型每轮只回一个动作：search（自己决定查什么）或 submit（交结构化报告）；
    // 检索结果编号进证据表回灌给下一轮；最终报告的引文由本地逐字校验。
    const loopHistory: string[] = []
    let loopReport: LoopReport | undefined
    let loopRejected = 0
    if (runLoopStep) {
      const goal = '查清该主体涉诉与处罚的：案号、原告、被告、案由、金额、过程、结果；判决拿不到就穷举二审/执行/法院公告/交易所或政府披露，并如实列出查不到的部分。'
      for (let step = 1; step <= AGENT_LOOP_MAX_STEPS; step += 1) {
        // 单轮坏返回不再废掉整轮研究：同一轮最多试 2 次（调用抛错、返回不可解析都算）。
        // 原始返回全部留痕，出问题能直接看出是模型没按 JSON 回、还是 DSH 返回了报错文本。
        let action: LoopAction | undefined
        let lastProblem = ''
        let lastRaw = ''
        for (let attempt = 1; attempt <= 2 && !action; attempt += 1) {
          try {
            modelCalls += 1
            lastRaw = await runLoopStep({
              goal, subject: subjectName, subjectType,
              step, history: loopHistory,
              // 最后一轮强制收口：否则模型会把额度耗在重复检索上，结构化事件（原告/被告/金额/结果）全丢。
              final: step === AGENT_LOOP_MAX_STEPS,
              // 增量证据：只带最近 8 条全文（早前条目已在上一轮给过），令牌不再随轮数线性膨胀。
              evidence: evidenceRaw.slice(-8).map((item) => ({ id: item.id, title: item.title, publisher: item.publisher, date: item.date, ...(item.url ? { url: item.url } : {}), tier: item.tier, text: item.text.slice(0, 1500) })),
            })
          } catch (error) {
            lastProblem = `第 ${attempt} 次调用抛错：${error instanceof Error ? error.message : '未知错误'}`
            log(`[循环 step=${step} attempt=${attempt}] 抛错：${lastProblem}`)
            continue
          }
          log(`[循环 step=${step} attempt=${attempt}] 模型原始返回 ${lastRaw.length} 字：${lastRaw.slice(0, 1500)}`)
          action = parseLoopAction(lastRaw)
          if (!action) lastProblem = `第 ${attempt} 次返回无法解析（原文见日志）`
        }
        if (!action) {
          log(`模型第 ${step} 轮未给出可执行动作（已重试 1 次）：${lastProblem}`)
          log(`[循环 step=${step}] 放弃循环：${lastProblem}`)
          break
        }
        if (action.tool === 'submit') {
          const validated = validateLoopReport(action.report, evidenceRaw)
          loopReport = validated.report
          loopRejected = validated.rejected
          log(`模型循环：${step} 轮结束（提交报告），通过证据校验 ${validated.accepted} 条，丢弃 ${validated.rejected} 条。`)
          log(`[循环 step=${step}] 动作=submit｜事件 ${validated.report.events.length} 条｜校验通过 ${validated.accepted}｜丢弃 ${validated.rejected}`)
          break
        }
        log(`模型循环第 ${step} 轮：检索「${action.query}」`)
        log(`[循环 step=${step}] 动作=search｜查询=${action.query}｜目的=${action.purpose ?? ''}`)
        loopHistory.push(`${action.query}${action.purpose ? `（${action.purpose}）` : ''}`)
        const result = await search({ provider: await provider(), purpose: 'business-credit', query: action.query, maxResults: 10 })
        log(`[循环检索] 来源 ${result.sources.length} 条｜缓存=${result.cacheHit ? '是' : '否'}｜${action.query}`)
        requestCount += result.requestCount
        if (!result.cacheHit) anyLive = true
        checkedAt = result.checkedAt
        for (const [sourceIndex, source] of result.sources.entries()) {
          const record = result.evidenceRecords[sourceIndex]
          if (!record) continue
          const text = await readCreditBody(readDocument, source)
          if (!text || !text.includes(subjectName)) continue
          const pageUrl = record.provenance.pageUrl ?? source.url
          const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
          const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
          if (isAggregatorSource(pageUrl, publisher, title)) continue
          const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
          evidenceRaw.push({ id: `E${evidenceRaw.length + 1}`, title, publisher, date: checkedAt.slice(0, 10), ...(pageUrl ? { url: pageUrl } : {}), tier, walled: false, text: withCourtSummary(text, pageUrl, publisher) })
        }
      }
      if (!loopReport && loopHistory.length >= AGENT_LOOP_MAX_STEPS) log(`模型检索循环达到上限（${AGENT_LOOP_MAX_STEPS} 轮）仍未提交报告。`)
    }
    // ── 阶段四：大模型归纳（证据约束）──────────────────────────────
    // 算法只做编号与校验；概括过程、责任归属、结论、建议由模型完成。
    // 模型输出必须带 E 编号 + 逐字引文，本地校验不通过的一律丢弃。
    let synthesizedFacts: CreditRiskFact[] | undefined
    if (synthesize && evidenceRaw.length > 0) {
      try {
        const evidence = buildEvidenceTable(evidenceRaw)
        modelCalls += 1
        const raw = await synthesize({ scope: 'credit-risk', subject: subjectName, subjectType, evidence })
        log(`[归纳] 模型原始返回 ${raw.length} 字：${raw.slice(0, 1500)}`)
        const draft = parseSynthesisResponse(raw)
        if (draft) {
          const validated = validateSynthesis(draft, evidence)
            const mapped = toCreditRiskFacts(validated, subjectName, profile, evidence)
            synthesizedFacts = mapped.filter((fact, index) => mapped.findIndex((other) => other.reason === fact.reason) === index)
          log(`模型归纳：通过证据校验 ${validated.accepted} 条，丢弃 ${validated.rejected} 条${validated.rejected > 0 ? `（${validated.rejectedReasons.slice(0, 2).join('；')}）` : ''}。`)
          if (validated.assessment) modelAssessment = validated.assessment
        } else {
          log('模型归纳返回无法解析，本次仅保留检索抽取结果。')
        }
      } catch (error) {
        log(`模型归纳未完成：${error instanceof Error ? error.message : '未知错误'}（已保留检索抽取结果）。`)
      }
    }
    const loopFacts = loopReport && loopReport.events.length > 0
      ? toCreditRiskFactsFromLoop(loopReport, subjectName, evidenceRaw) as unknown as CreditRiskFact[]
      : undefined
    // 三路事实必须合并，不能"谁先有就只用谁"：模型循环只拿到它查到的那一起，
    // 归纳通道拿到的其他案件不能被它顶掉（2026-09-17 实测：1 条循环事实曾把 3 条归纳事实全丢掉）。
    const dedupedFacts = mergeFactSources(loopFacts, synthesizedFacts, dedupe(facts))
    if (dedupedFacts.length === 0) {
      gaps.push('本次没有取得可核验的公开风险事实（搜不到不等于没有风险，权威页面可能需要付费或登录）。')
    }
    if (!profile.legalPerson && !profile.address && !profile.code) {
      gaps.push(`主体「${subjectName}」的统一社会信用代码 / 法人 / 地址本次未取得（${subjectType === 'enterprise' ? '工商公示页' : '机构登记页'}未命中、需登录或未公开）。`)
    }

    log(`[结束] 事实 ${dedupedFacts.length} 条（检索抽取 ${facts.length} / 模型循环 ${loopFacts?.length ?? 0} / 归纳 ${synthesizedFacts?.length ?? 0}）｜检索调用 ${requestCount} 次｜线索 ${clues.length} 条｜缺口 ${gaps.length} 条`)
    for (const gap of gaps) log(`  [缺口] ${gap}`)
    return {
      opportunityId: request.opportunityId,
      projectTitle: request.projectTitle,
      subjectName,
      profile,
      facts: dedupedFacts,
      queries,
      requestCount,
      modelCalls,
      cacheHit: !anyLive,
      checkedAt,
      ...(modelAssessment ? { assessment: modelAssessment } : {}),
      gaps,
      ...(loopReport ? { inferences: loopReport.inferences, openQuestions: loopReport.openQuestions } : {}),
      verifications: buildVerifications(dedupedFacts, [...new Set(facts.map((fact) => fact.publisher).filter(Boolean))], checkedAt.slice(0, 10)),
      boundary: CREDIT_RISK_BOUNDARY,
    }
  }
}

async function readCreditBody(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  const providerBody = source.content?.trim() ?? ''
  const attempt = await tryRead(readDocument, providerBody.length >= 200 ? source : { ...source, content: undefined })
  const pageText = attempt ?? (await tryRead(readDocument, source)) ?? ''
  // 用户口径：豆包搜索返回的摘要就是它智能体自己用的正文，必须当主文本，页面直读只作补充。
  const merged = [providerBody, pageText].filter((part) => part.length > 0).join('\n')
  return merged.length >= 60 ? merged : undefined
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

function dedupe(facts: CreditRiskFact[]): CreditRiskFact[] {
  return [...new Map(facts.map((fact) => [`${fact.category}:${fact.sourceUrl ?? fact.sourceTitle}:${fact.reason.slice(0, 20)}`, fact])).values()]
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`
}

export type { CreditRiskSubjectType }

/** 法院公告/执行信息：把解析出的案号、当事人、阶段、开庭时间、结果做成抬头，喂给模型与证据表。
 *  只写正文里写明的字段——解析器已保证这一点（禁止编造）。 */
function withCourtSummary(text: string, pageUrl: string | undefined, publisher: string): string {
  if (!isCourtAnnouncementSource(pageUrl, publisher)) return text
  const parsed = parseCourtAnnouncement(text, pageUrl, publisher)
  const lines: string[] = []
  if (parsed.caseNumber) lines.push(`案号：${parsed.caseNumber}`)
  if (parsed.court) lines.push(`法院：${parsed.court}`)
  if (parsed.stage) lines.push(`阶段：${parsed.stage}`)
  if (parsed.hearingAt) lines.push(`开庭时间：${parsed.hearingAt}`)
  for (const party of parsed.parties) lines.push(`${party.role}：${party.name}`)
  if (parsed.result) lines.push(`结果：${parsed.result}`)
  if (lines.length === 0) return text
  return `【法院公开信息（原文摘录）】\n${lines.join('\n')}\n\n${text}`
}

/** 三路事实合并去重：模型循环 / 模型归纳 / 确定性抽取；先出现的优先（循环字段最细）。 */
function mergeFactSources(...groups: Array<CreditRiskFact[] | undefined>): CreditRiskFact[] {
  const seen = new Set<string>()
  const out: CreditRiskFact[] = []
  for (const group of groups) {
    for (const fact of group ?? []) {
      const key = `${fact.category}|${fact.reason.replace(/\s+/g, ' ').trim().slice(0, 90)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(fact)
    }
  }
  return out
}
