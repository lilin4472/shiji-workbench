import { canonicalizeLeadValue, classifyLeadValue } from './lead-contacts.js'

// Agent Loop 契约（2026-09-16）：把"固定流水线"换成"模型主导的检索循环"。
//
// 分工（这是整个设计的核心）：
//   模型 → 决定下一步查什么（每轮只回一个 JSON 动作：search 或 submit）
//   算法 → 决定什么能写进报告（证据编号 E1..En + 最终逐字引文校验）
//
// 与 DSH 的关系：复用它已有的执行器接缝（createExecutor(promptBuilder)），
// 不扩 AgentTask 联合类型、不改现有三种搜索任务。

export const AGENT_LOOP_MAX_STEPS = 6

import { isAggregatorSource } from './credit-risk.js'

export interface LoopEvidenceItem {
  id: string
  title: string
  publisher: string
  date: string
  url?: string
  /** 权威性：official=政府/法院/信用中国；registry=工商公示；media=大型媒体。 */
  tier: 'official' | 'registry' | 'media'
  text: string
}

export type LoopAction =
  | { tool: 'search'; query: string; purpose: string }
  | { tool: 'submit'; report: LoopReport }

export interface LoopReportEvent {
  subject: string
  scope: 'company' | 'individual'
  time: string
  place: string
  plaintiff: string
  defendant: string
  cause: string
  amount: string
  process: string
  conclusion: string
  evidenceIds: string[]
  quotes: string[]
}

export interface LoopReport {
  events: LoopReportEvent[]
  verifications: Array<{ item: string; conclusion: string; evidenceIds: string[] }>
  /** 推断层：必须自带依据与置信度，绝不与证据混写。 */
  inferences: Array<{ claim: string; basis: string; confidence: 'high' | 'medium' | 'low' }>
  /** 查不到的东西如实列出，而不是编一个。 */
  openQuestions: string[]
  assessment: string
}

/** 每轮的提示词：目标是"查清事实"，不是"总结材料"。 */
export function buildLoopPrompt(input: {
  goal: string
  subject: string
  subjectType: string
  step: number
  evidence: LoopEvidenceItem[]
  history: string[]
  /** 最后一轮标志：交给提示词强制模型收口。 */
  final?: boolean
}): string {
  const materials = input.evidence.length === 0
    ? '（暂无材料）'
    : input.evidence.map((item) => [
        `【${item.id}】${item.title}`,
        `发布机构：${item.publisher}｜日期：${item.date}｜性质：${item.tier}${item.url ? `｜链接：${item.url}` : ''}`,
        item.text,
      ].join('\n')).join('\n\n')

  return [
    `你在做公开风险核查。核查对象：${input.subject}（机构类型：${input.subjectType}）。`,
    `任务目标：${input.goal}`,
    `这是第 ${input.step} 轮（最多 ${AGENT_LOOP_MAX_STEPS} 轮）。`,
    input.history.length > 0 ? `已执行过的检索：\n${input.history.map((line) => `- ${line}`).join('\n')}` : '尚未执行任何检索。',
    input.final ? '【最后一轮】必须先收口：只能用 submit 输出报告；拿不到的原被告、判项、结果、金额一律写进 openQuestions，禁止再 search。' : '',
    '',
    '已有材料：',
    materials,
    '',
    '请只输出一个 JSON（不要解释文字、不要 markdown 代码块）：',
    '{"tool":"search","query":"下一轮要搜的关键词","purpose":"这一步想确认什么"}',
    '或',
    '{"tool":"submit","report":{"events":[…],"verifications":[…],"inferences":[…],"openQuestions":[…],"assessment":"…"}}',
    '',
    '强制顺序（务必遵守）：① 只要材料里出现案号，下一步必须先用该案号做当事人反查（查询词含 原告 被告），拿到原被告后再考虑 submit；',
    '② 反查不到当事人时，才允许提交，并在 openQuestions 写明 未取得原被告；',
    '检索策略（按需选择，不要每轮都重复同一类查询）：',
    '① 案号直达：拿到案号就先查判决；② 主体反查：拿当事人名单；③ 二审/执行：案号查不到判决就换这两路；',
    '④ 法院公告网送达公告；⑤ 发债主体的交易所披露（"重大诉讼"表述）；⑥ 政府门户/公共资源交易网的项目背景。',
    '',
    'report 字段要求：',
    'events 每条必须有 subject/scope/time/place/plaintiff/defendant/cause/amount/process/conclusion/evidenceIds/quotes；',
    'quotes 必须是材料里的连续原文（本地会逐字校验，命中不了整条作废）；',
    'inferences 只写推断，必须给 basis 与 confidence，不得与 events 混写；',
    '查不到就写进 openQuestions，绝不编造金额、判项、日期。',
  ].join('\n')
}

/** 解析模型返回的动作（容忍代码块/前后解释）。 */
export function parseLoopAction(raw: string): LoopAction | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as Partial<LoopAction> & { report?: Partial<LoopReport> }
    if (value.tool === 'search') {
      const query = String((value as { query?: unknown }).query ?? '').trim()
      if (query.length < 2 || query.length > 120) return undefined
      return { tool: 'search', query, purpose: String((value as { purpose?: unknown }).purpose ?? '').slice(0, 80) }
    }
    if (value.tool === 'submit' && value.report) {
      return { tool: 'submit', report: normalizeReport(value.report) }
    }
    return undefined
  } catch {
    return undefined
  }
}

function normalizeReport(report: Partial<LoopReport>): LoopReport {
  return {
    events: Array.isArray(report.events) ? report.events : [],
    verifications: Array.isArray(report.verifications) ? report.verifications : [],
    inferences: Array.isArray(report.inferences) ? report.inferences : [],
    openQuestions: Array.isArray(report.openQuestions) ? report.openQuestions.filter((item): item is string => typeof item === 'string') : [],
    assessment: typeof report.assessment === 'string' ? report.assessment : '',
  }
}

export interface LoopValidation {
  report: LoopReport
  accepted: number
  rejected: number
  rejectedReasons: string[]
}

/** 最终护栏：每条事件的引文必须在它自己声明的证据里逐字命中，否则丢弃。 */
export function validateLoopReport(report: LoopReport, evidence: LoopEvidenceItem[]): LoopValidation {
  const byId = new Map(evidence.map((item) => [item.id, item]))
  const normalize = (value: string) => value.replace(/[\s\u3000]+/g, '')
  const rejectedReasons: string[] = []
  const events = report.events.filter((event) => {
    const ids = (event.evidenceIds ?? []).filter((id) => byId.has(id))
    if (ids.length === 0) {
      rejectedReasons.push(`「${event.cause || event.conclusion || '未命名事件'}」引用了不存在的材料编号`)
      return false
    }
    const hit = (event.quotes ?? []).some((quote) => normalize(quote).length >= 4
      && ids.some((id) => normalize(byId.get(id)!.text).includes(normalize(quote))))
    if (!hit) {
      rejectedReasons.push(`「${event.cause || event.conclusion || '未命名事件'}」引文未在材料中命中`)
      return false
    }
    return true
  })
  // 推断层必须带依据与置信度，否则不算推断（宁可不要）。
  const inferences = report.inferences.filter((item) => Boolean(item.claim && item.basis && item.confidence))
  return {
    report: { ...report, events, inferences },
    accepted: events.length,
    rejected: rejectedReasons.length,
    rejectedReasons,
  }
}

/** 循环产出的报告 → 模块事实结构（类别归一与当事人拼接在这里做）。 */
export interface LoopFactShape {
  id: string
  subjectName: string
  category: string
  categoryLabel: string
  reason: string
  occurredAt?: string
  amount?: string
  authority?: string
  location?: string
  sourceTitle: string
  publisher: string
  sourceUrl?: string
  tier: 'official' | 'registry' | 'media'
  sourceWalled: boolean
  subjectScope: 'company' | 'individual'
}

export function toCreditRiskFactsFromLoop(report: LoopReport, subjectName: string, evidence: LoopEvidenceItem[]): LoopFactShape[] {
  const byId = new Map(evidence.map((item) => [item.id, item]))
  return report.events.map((event, index) => {
    const source = byId.get(event.evidenceIds[0])
    const parties = [event.plaintiff ? `原告 ${event.plaintiff}` : '', event.defendant ? `被告 ${event.defendant}` : ''].filter(Boolean).join('，')
    const reason = [event.time, parties, event.cause, event.place, event.amount ? `金额 ${event.amount}` : '', event.process, event.conclusion]
      .filter(Boolean).join('，')
    const raw = `${event.cause} ${event.conclusion}`.toLowerCase()
    // 类别必须"负面语义成立"才归类（募投收益不及预期曾被误判为经营异常/行政处罚）；命中不了就落中性类别。
    const category = /litigation|judicial|案号|开庭|判决|裁定|裁判|诉讼|纠纷/.test(raw) ? 'administrative-litigation'
      : /tender|bidding|串通投标|招标投标|违规/.test(raw) ? 'tender-violation'
        : /列入经营异常名录|经营异常名录/.test(raw) ? 'business-abnormal'
          : /严重违法失信名单|严重违法失信/.test(raw) ? 'serious-violation'
            : /失信被执行人|被执行人|限制高消费/.test(raw) ? 'dishonest-enforcement'
              : /行政处罚|罚款|罚没|处罚决定/.test(raw) ? 'administrative-penalty' : 'registration'
    return {
      id: `loop:${index}:${event.evidenceIds[0]}`,
      subjectName: event.scope === 'individual' ? (event.subject || '高管个人') : subjectName,
      category,
      categoryLabel: category,
      reason: reason || event.conclusion || '（材料未写明具体事由）',
      ...(event.time ? { occurredAt: event.time } : {}),
      ...(event.amount ? { amount: event.amount } : {}),
      ...(event.place ? { authority: event.place } : {}),
      ...(event.place ? { location: event.place } : {}),
      sourceTitle: source?.title ?? '未命名来源',
      publisher: source?.publisher ?? '未取得',
      ...(source?.url ? { sourceUrl: source.url } : {}),
      tier: source?.tier ?? 'media',
      sourceWalled: false,
      subjectScope: event.scope === 'individual' ? 'individual' : 'company',
    }
  })
}


//  获客接触点循环（2026-09-18 用户口径）：与公开风险同一套"模型主导 + 逐字校验"，只是目标不同 
// 目标：把这家公司的联系人 / 邮箱 / 电话 / 地址**尽量搜全**（至少 12 种）；
//      模型认为"公开网络上已经没有新的可核验联系方式"就自己 submit 收口，程序不数轮数（6 轮只是保险丝）。
export interface LeadLoopContact {
  kind: 'contact' | 'email' | 'phone' | 'address'
  value: string
  evidenceId: string
  quote: string
}

export interface LeadLoopReport {
  contacts: LeadLoopContact[]
  openQuestions: string[]
  assessment: string
}

export type LeadLoopAction =
  | { tool: 'search'; query: string; purpose?: string }
  | { tool: 'submit'; report: LeadLoopReport }

/** 解析模型返回的动作（获客版：只认 search / submit，容忍代码块与前后解释）。 */
export function parseLeadLoopAction(raw: string): LeadLoopAction | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const action = value as { tool?: unknown; query?: unknown; purpose?: unknown; report?: unknown }
  if (action.tool === 'search' && typeof action.query === 'string' && action.query.trim().length > 0) {
    return { tool: 'search', query: action.query.trim(), ...(typeof action.purpose === 'string' ? { purpose: action.purpose } : {}) }
  }
  if (action.tool === 'submit') {
    const report = (action.report ?? {}) as Partial<LeadLoopReport>
    return {
      tool: 'submit',
      report: {
        contacts: Array.isArray(report.contacts) ? (report.contacts as LeadLoopContact[]) : [],
        openQuestions: Array.isArray(report.openQuestions) ? (report.openQuestions as string[]).filter((item) => typeof item === 'string') : [],
        assessment: typeof report.assessment === 'string' ? report.assessment : '',
      },
    }
  }
  return undefined
}

/** 逐字校验：模型提交的每条联系方式必须在证据正文里有连续原文（value 必须出现在 quote 里）。 */
export function validateLeadReport(report: LeadLoopReport, evidence: LoopEvidenceItem[]): { contacts: LeadLoopContact[]; rejected: string[] } {
  const kinds = new Set(['contact', 'email', 'phone', 'address'])
  const contacts: LeadLoopContact[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const item of report.contacts) {
    const kind = String(item?.kind ?? '')
    const value = String(item?.value ?? '').trim()
    const quote = String(item?.quote ?? '').trim()
    if (!kinds.has(kind) || value.length < 2 || quote.length < 2) { rejected.push(`${value || '（空值）'}：字段或引文不完整`); continue }
    const evidenceId = String(item?.evidenceId ?? '').trim()
    const pool = evidenceId ? evidence.filter((entry) => entry.id === evidenceId) : evidence
    const hit = pool.find((entry) => entry.text.includes(quote) && quote.includes(value))
    if (!hit) { rejected.push(`${value}：引文在证据正文里找不到逐字原文`); continue }
    const classifiedKind = classifyLeadValue(value, quote)
    if (!classifiedKind) { rejected.push(`${value}：字段类型与原文语义不符`); continue }
    const canonicalValue = canonicalizeLeadValue(classifiedKind, value)
    const key = `${classifiedKind}:${canonicalValue.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    contacts.push({ kind: classifiedKind, value: canonicalValue, evidenceId: hit.id, quote })
  }
  return { contacts, rejected }
}

/** 获客循环提示词：模型只决定"再查什么"或"收口"，值必须逐字来自证据。 */
export function buildLeadLoopPrompt(input: {
  companyName: string
  ownerName: string
  projectTitle: string
  step: number
  maxSteps?: number
  missing: string[]
  known: string[]
  evidence: LoopEvidenceItem[]
  history: string[]
  final?: boolean
}): string {
  const materials = input.evidence.length === 0
    ? '（暂无材料）'
    : input.evidence.map((item) => [`【${item.id}】${item.title}`, `发布机构：${item.publisher}｜日期：${item.date}｜性质：${item.tier}${item.url ? `｜链接：${item.url}` : ''}`, item.text].join('\n')).join('\n\n')
  const missing = input.missing.length > 0 ? input.missing.join('、') : '（无，四列都已取得）'
  const known = input.known.length > 0 ? input.known.join('；') : '尚未取得任何联系方式'
  return [
    `你在为「获客」把一家公司的公开联系方式搜全。公司：${input.companyName}`,
    `它是甲方「${input.ownerName}」的项目「${input.projectTitle}」的关系单位。`,
    `这是第 ${input.step} 轮（本次成本上限 ${input.maxSteps ?? AGENT_LOOP_MAX_STEPS} 轮，你判断搜不到了就 submit 收口，不用等轮数）。`,
    `还缺：${missing}。已取得：${known}。`,
    input.history.length > 0 ? `已经搜过的词（不要重复）：\n${input.history.map((line) => `- ${line}`).join('\n')}` : '尚未执行任何检索。',
    input.final ? '【最后一轮】只能用 submit 收口：把拿不到的写进 openQuestions，禁止再 search。' : '',
    '',
    '已有材料（引用只能来自这里）：',
    materials,
    '',
    '请只输出一个 JSON（不要解释文字、不要 markdown 代码块）：',
    '{"tool":"search","query":"下一轮要搜的关键词","purpose":"这一步想确认什么"}',
    '或',
    '{"tool":"submit","report":{"contacts":[{"kind":"phone|email|address|contact","value":"原文里的值","evidenceId":"E1","quote":"包含该值的连续原文"}],"openQuestions":[],"assessment":""}}',
    '',
    '策略： 换渠道，不要重复同一类查询（企业官网 / 工商平台 / 招投标公告的联系人栏 / 行业协会名录 / 地图分类站 / 邮箱专项）；',
    ' 程序用正则已经扫过标准格式，你要补的是**非标准写法**：中文括号电话、"总机转 8021"、邮箱后面带（招聘）、"联系人：张主任（办公室）"、公告落款里的地址；',
    ' contacts 里每条都必须给 evidenceId 与 quote，且 quote 是材料里的**连续原文**、value 必须出现在 quote 里本地会逐字校验，命中不了整条作废；',
    ' 只要还缺列就继续 search 换渠道；确实搜不到了就 submit，并把没拿到的写进 openQuestions，绝不编造号码 / 邮箱 / 姓名。',
  ].join('\n')
}
