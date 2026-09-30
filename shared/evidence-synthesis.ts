// 证据约束归纳层（算法 × 豆包搜索 × 大模型 的中间件）
//
// 分工：豆包搜索负责"把材料捞回来"；算法负责"编号 + 校验"；大模型只负责
// "概括过程 / 判断责任归属 / 写核查结论 / 给建议性判断"。
//
// 防幻觉铁律（本地强制，不依赖模型自觉）：
//   ① 模型只能引用输入里 E1..En 的材料，不得引入材料外的事实；
//   ② 每条结论必须带 evidence 编号 + quote 逐字引文；
//   ③ 引文在对应材料里**逐字命中**才保留，不命中直接丢弃；
//   ④ 材料里没有的类别只能输出"未发现"，不允许编造事件。
import type { CreditRiskCategory, CreditRiskFact, CreditRiskSubjectProfile } from './credit-risk.js'
import { CREDIT_RISK_CATEGORY_LABELS, isAggregatorSource } from './credit-risk.js'

/** 一段被编号的材料（摘要或正文），是模型的唯一信息来源。 */
export interface EvidenceItem {
  id: string
  title: string
  publisher: string
  date: string
  url?: string
  tier: 'official' | 'registry' | 'media'
  /** 需要登录/扫码的站点：可作线索，不作原文链接。 */
  walled: boolean
  text: string
}

export interface SynthesizedEvent {
  subject: string
  time: string
  place: string
  cause: string
  amount: string
  process: string
  conclusion: string
  scope: 'company' | 'individual'
  /** 诉讼/执行类：谁起诉谁（材料未写明就留空，绝不推测）。 */
  plaintiff?: string
  defendant?: string
  category: CreditRiskCategory
  evidenceIds: string[]
  quotes: string[]
}

export interface SynthesizedVerification {
  item: string
  conclusion: string
  evidenceIds: string[]
  quotes: string[]
}

export interface SynthesisDraft {
  events: SynthesizedEvent[]
  verifications: SynthesizedVerification[]
  assessment: string
}

export interface SynthesisResult extends SynthesisDraft {
  /** 通过证据校验的条数 / 被丢弃的条数（卡片上如实显示）。 */
  accepted: number
  rejected: number
  rejectedReasons: string[]
}

/** 把检索结果编成证据表（超长材料截断，避免把上下文吃光）。 */
export function buildEvidenceTable(input: Array<{ id: string; title: string; publisher: string; date: string; url?: string; tier: 'official' | 'registry' | 'media'; walled: boolean; text: string }>): EvidenceItem[] {
  return input
    .filter((item) => item.text.trim().length >= 40)
    .map((item) => ({ ...item, text: item.text.trim().slice(0, 4000) }))
    .slice(0, 24)
}

/** 公开风险模块的归纳提示词：只描述任务与输出格式，不塞任何"知识"。 */
export function buildCreditRiskSynthesisPrompt(subject: string, subjectType: string, evidence: EvidenceItem[]): string {
  const materials = evidence.map((item) => [
    `【${item.id}】${item.title}`,
    `发布机构：${item.publisher}｜日期：${item.date}｜来源性质：${item.tier}${item.walled ? '｜需登录（不得作为原文链接）' : ''}`,
    item.text,
  ].join('\n')).join('\n\n')

  return [
    `你是公开风险核查助手。核查对象：${subject}（机构类型：${subjectType}）。`,
    `下面是检索到的全部材料，编号 ${evidence.map((item) => item.id).join('、')}：`,
    '',
    materials,
    '',
    '请只依据上述材料输出 JSON（不要输出任何解释文字、不要用 markdown 代码块）：',
    '{',
    '  "events": [{',
    '    "subject": "该事件的责任主体名称（公司名，或高管姓名）",',
    '    "time": "发生/立案/开庭/处罚时间，材料未写明写 空字符串",',
    '    "place": "法院/机关/地点，未写明写 空字符串",',
    '    "cause": "事由（案由、违法行为、列入原因），未写明写 空字符串",',
    '    "amount": "金额（罚款/执行标的），未写明写 空字符串",',
    '    "process": "过程（一审/二审、立案、执行等），未写明写 空字符串",',
    '    "conclusion": "大概结论（判决结果、处罚内容、是否影响投标）",',
    '    "scope": "company 或 individual（高管个人违纪必须写 individual）",',
    '    "category": "administrative-penalty|business-abnormal|serious-violation|dishonest-enforcement|administrative-litigation|tender-violation",',
    '    "evidenceIds": ["E1"],',
    '    "quotes": ["从材料中原样复制的句子"]',
    '  }],',
    '  "verifications": [{ "item": "行政处罚|经营异常|严重违法失信|失信被执行", "conclusion": "未发现…记录", "evidenceIds": ["E2"], "quotes": [] }],',
    '  "assessment": "一到三句建议性判断（是否影响投标资格、需要重点核实什么）"',
    '}',
    '',
    '硬性要求：① 不得写入材料里没有的事实、案号、日期、金额；② 每条的 quotes 必须是材料中的连续原文；',
    '③ 材料里没有的类别，只能放进 verifications 写"未发现"，不得编造事件；④ 诉讼/执行类必须写清原告、被告、案由、金额、结果，材料没写就留空，绝不推测；⑤ 没有把握的条目宁可不写。',
  ].join('\n')
}

/** 从模型返回里抠出 JSON（容忍代码块、前后解释文字）。 */
export function parseSynthesisResponse(raw: string): SynthesisDraft | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as Partial<SynthesisDraft>
    return {
      events: Array.isArray(value.events) ? value.events : [],
      verifications: Array.isArray(value.verifications) ? value.verifications : [],
      assessment: typeof value.assessment === 'string' ? value.assessment : '',
    }
  } catch {
    return undefined
  }
}

/** 引文是否在某段材料里逐字存在（去空白后比对，容忍换行差异）。 */
export function quoteHitsMaterial(quote: string, text: string): boolean {
  const normalize = (value: string) => value.replace(/[\s\u3000]+/g, '')
  const needle = normalize(quote)
  if (needle.length < 4) return false
  return normalize(text).includes(needle)
}

/**
 * 本地证据校验：引文必须命中它自己声明的材料；E 编号必须存在；否则丢弃。
 * 这是"算法约束大模型幻觉"的落点——模型写得多漂亮，过不了这里就进不了界面。
 */
export function validateSynthesis(draft: SynthesisDraft, evidence: EvidenceItem[]): SynthesisResult {
  const byId = new Map(evidence.map((item) => [item.id, item]))
  const rejectedReasons: string[] = []
  const events: SynthesizedEvent[] = []
  for (const event of draft.events) {
    const ids = (event.evidenceIds ?? []).filter((id) => byId.has(id))
    if (ids.length === 0) { rejectedReasons.push(`「${event.cause || event.conclusion || '未命名事件'}」引用了不存在的材料编号`); continue }
    const quotes = event.quotes ?? []
    const hit = quotes.some((quote) => ids.some((id) => quoteHitsMaterial(quote, byId.get(id)!.text)))
    if (!hit) { rejectedReasons.push(`「${event.cause || event.conclusion || '未命名事件'}」引文未在材料中命中`); continue }
    events.push({ ...event, evidenceIds: ids, quotes })
  }
  const verifications = draft.verifications.filter((item) => {
    if ((item.evidenceIds ?? []).every((id) => byId.has(id))) return true
    rejectedReasons.push(`核查结论「${item.item}」引用了不存在的材料编号`)
    return false
  })
  return {
    events,
    verifications,
    assessment: draft.assessment,
    accepted: events.length + verifications.length,
    rejected: rejectedReasons.length,
    rejectedReasons,
  }
}

/** 去掉 HTML/富文本标记与多余空白（真实数据里出现过 <u>、** 等标记）。 */
export function stripMarkup(value: string): string {
  return value
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/[*#`>]+/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 模型可能返回英文枚举或自造类别（如 administrative-tender-violation），统一归一到我们的类别。 */
export function normalizeCategory(value: string, context: string): CreditRiskCategory {
  const raw = `${value} ${context}`.toLowerCase()
  // 顺序很关键：诉讼类特征（案号/开庭/判决/诉讼/裁判/纠纷）优先，否则模型返回的
  // administrative-tender-violation 会把普通合同纠纷误标成"招标投标违规"。
  if (/litigation|judicial|lawsuit|案号|开庭|判决|裁定|裁判|诉讼|纠纷/.test(raw)) return 'administrative-litigation'
  if (/tender|bidding|串通投标|招标投标|招标违规|投标违规/.test(raw)) return 'tender-violation'
  if (/abnormal|异常/.test(raw)) return 'business-abnormal'
  if (/serious|严重/.test(raw)) return 'serious-violation'
  if (/dishonest|enforcement|被执行|失信/.test(raw)) return 'dishonest-enforcement'
  if (/penalt|penal|处罚|罚款/.test(raw)) return 'administrative-penalty'
  if (/litigation|judicial|lawsuit|诉讼|开庭|判决|案号|裁判/.test(raw)) return 'administrative-litigation'
  return 'administrative-litigation'
}

/** 把通过校验的事件转成模块既有的事实结构（供结果卡复用）。 */
export function toCreditRiskFacts(result: SynthesisResult, subjectName: string, profile: CreditRiskSubjectProfile, evidence: EvidenceItem[]): CreditRiskFact[] {
  const byId = new Map(evidence.map((item) => [item.id, item]))
  return result.events
    .map((event, index) => {
    const source = byId.get(event.evidenceIds[0])
    const category = normalizeCategory(String(event.category ?? ''), `${event.cause} ${event.conclusion}`)
    const parties = [event.plaintiff ? `原告 ${event.plaintiff}` : '', event.defendant ? `被告 ${event.defendant}` : ''].map((part) => stripMarkup(part)).filter(Boolean).join('，')
    const detail = [event.time, parties, event.cause, event.place, event.amount ? `金额 ${event.amount}` : '', event.process, event.conclusion]
      .map((part) => stripMarkup(part ?? '')).filter(Boolean).join('，')
    return {
      id: `synthesis:${index}:${event.evidenceIds[0]}`,
      subjectName: event.scope === 'individual' ? stripMarkup(event.subject) || '高管个人' : subjectName,
      category,
      categoryLabel: CREDIT_RISK_CATEGORY_LABELS[category],
      reason: detail || stripMarkup(event.conclusion) || '（材料未写明具体事由）',
      ...(event.time ? { occurredAt: stripMarkup(event.time) } : {}),
      ...(event.amount ? { amount: stripMarkup(event.amount) } : {}),
      ...(event.place ? { authority: stripMarkup(event.place) } : {}),
      ...(event.place ? { location: stripMarkup(event.place) } : {}),
      sourceTitle: stripMarkup(source?.title ?? '未命名来源'),
      publisher: stripMarkup(source?.publisher ?? '未取得'),
      ...(source?.url ? { sourceUrl: source.url } : {}),
      tier: source?.tier ?? 'media',
      sourceWalled: Boolean(source?.walled),
      subjectScope: event.scope === 'individual' ? 'individual' : 'company',
    } satisfies CreditRiskFact
  })
}
