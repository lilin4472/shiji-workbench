// 公开风险（工商信用）模块契约 —— 需求文档 §5.8「工商档案采用固定外壳、动态内容」+
// 用户 2026-09-16 口径：对象是**发布招标的招标单位（甲方）**，很可能是政府机关或事业单位
// （它们本来就没有工商注册信息，门禁必须放宽）；展示走**紧凑表格**（与产业链一致），
// 但风险要写清楚"事由"，并包含**行政诉讼/裁判文书**这类全网来源。
//
// 纪律（禁止编造）：基础信息与风险事实都只来自公开来源原文；抽不到就留"—"；
// 搜不到 ≠ 无风险（边界必须显示）。
import { isReputablePublisher } from './source-reputation.js'

export type CreditRiskCategory =
  | 'registration'
  | 'business-abnormal'
  | 'serious-violation'
  | 'administrative-penalty'
  | 'dishonest-enforcement'
  | 'administrative-litigation'
  | 'tender-violation'

export type CreditRiskSubjectType = 'enterprise' | 'public-institution' | 'government' | 'unknown'
export type SourceTier = 'official' | 'registry' | 'media'

export interface CreditRiskSubjectProfile {
  name: string
  subjectType: CreditRiskSubjectType
  /** 机构类型是按名称后缀判断的，界面必须写"按名称判断"。 */
  subjectTypeBasis: string
  legalPerson?: string
  industry?: string
  address?: string
  /** 企业＝统一社会信用代码；政府/事业单位＝机构登记代码/事业单位法人证书号。 */
  code?: string
  codeLabel: string
  phone?: string
  registrationStatus?: string
  sourceTitle?: string
  sourceUrl?: string
}

export interface CreditRiskFact {
  id: string
  subjectName: string
  category: CreditRiskCategory
  categoryLabel: string
  /** 简洁事由（≤60 字）：优先取"违法事实/处罚事由/列入原因/案由"字段。 */
  reason: string
  occurredAt?: string
  amount?: string
  authority?: string
  location?: string
  documentNumber?: string
  sourceTitle: string
  publisher: string
  sourceUrl?: string
  tier: 'official' | 'registry' | 'media'
  /** 原文链接是否需要登录/扫码（这类站点按用户要求不作原文链接来源）。 */
  sourceWalled: boolean
  /** 责任主体：公司 / 高管个人（个人违纪不能算公司处罚）。 */
  subjectScope?: 'company' | 'individual'
  /** 栏目级线索（聚合站只给"有这类记录"、没有正文）：只在界面上汇总提示，不占事由列。 */
  leadOnly?: boolean
  /** 司法信息（诉讼/判决类才有）：案号、法院、审级、原被告、开庭时间。 */
  caseInfo?: CreditCaseInfo
}

export interface CreditRiskRequest {
  opportunityId: string
  projectTitle: string
  companyName: string
  address?: string
  industry: string
}

export interface CreditRiskResult {
  opportunityId: string
  projectTitle: string
  subjectName: string
  profile: CreditRiskSubjectProfile
  facts: CreditRiskFact[]
  queries: string[]
  requestCount: number
  /** 本次实际发生的 DSH 循环与证据归纳调用；旧本地结果可能没有该字段。 */
  modelCalls?: number
  cacheHit: boolean
  checkedAt: string
  gaps: string[]
  /** 查无记录的类别给出明确核查结论（"未发现行政处罚记录"这类）。 */
  verifications: CreditRiskVerification[]
  /** 推断层：与证据严格分离，每条必须带依据与置信度。 */
  inferences?: Array<{ claim: string; basis: string; confidence: 'high' | 'medium' | 'low' }>
  /** 查不到的东西如实列出，而不是编一个。 */
  openQuestions?: string[]
  /** 模型的整体判断（归纳通道产出）：放在"核查结论"里展示，不再混进缺口列表。 */
  assessment?: string
  boundary: string
}

export interface CreditRiskVerification {
  category: CreditRiskCategory
  label: string
  conclusion: string
  basis: string
}

export type CreditRiskResponse =
  | { ok: true; value: CreditRiskResult }
  | { ok: false; message: string }

export const CREDIT_RISK_BOUNDARY = '公开风险只记录公开来源里写明的主体与事项：搜不到、页面需付费或不可访问时一律标"未核验"，不等于该主体没有风险；商业与媒体转载只作相关参考，不作最终判断；机构类型按名称后缀判断，需人工确认。'

export const CREDIT_RISK_CATEGORY_LABELS: Record<CreditRiskCategory, string> = {
  registration: '登记信息',
  'business-abnormal': '经营异常',
  'serious-violation': '严重违法失信',
  'administrative-penalty': '行政处罚',
  'dishonest-enforcement': '失信被执行',
  'administrative-litigation': '行政诉讼/裁判文书',
  'tender-violation': '招标投标违规',
}

// ── 主体类型（按名称后缀判断，不做静默断言） ─────────────────────────────
const GOVERNMENT_HINT = /(人民政府|人民政府办公室|管理委员会|管委会|街道办事处|委员会|财政局|住房和城乡建设局|发展和改革委员会|自然资源局|城市管理局|教育局|卫生健康委员会|水务局|交通运输局|公安局|生态环境局|农业农村局|园林局|机关事务管理局|党组|镇党委)/
const PUBLIC_INSTITUTION_HINT = /(大学|学院|学校|中学|小学|幼儿园|医院|疾病预防控制中心|卫生院|研究院|研究所|设计院|勘测院|勘察院|检测中心|检验中心|图书馆|博物馆|文化馆|体育馆|中心|报社|电视台|广播电台|公积金管理中心|公共资源交易中心|政府采购中心|人才服务中心|社会福利院|救助站|基金会|协会|学会|民主党派)/
const ENTERPRISE_HINT = /(股份有限公司|有限责任公司|有限公司|集团公司|集团|合伙企业|事务所|个体工商户|合作社)/

export function detectSubjectType(name: string): { type: CreditRiskSubjectType; basis: string } {
  const value = name.trim()
  if (ENTERPRISE_HINT.test(value)) return { type: 'enterprise', basis: '名称含企业组织形式后缀' }
  if (GOVERNMENT_HINT.test(value)) return { type: 'government', basis: '名称含政府/行政机关后缀' }
  if (PUBLIC_INSTITUTION_HINT.test(value)) return { type: 'public-institution', basis: '名称含事业单位/公共机构后缀' }
  return { type: 'unknown', basis: '名称无法判断机构类型' }
}

export function codeLabelFor(type: CreditRiskSubjectType): string {
  return type === 'enterprise' ? '统一社会信用代码' : '机构登记代码'
}

// ── 责任主体区分（用户口径：高管个人违纪不等于公司被罚） ────────────────
const INDIVIDUAL_ROLE = /(董事长|副董事长|总经理|副总经理|党委书记|党委副书记|纪委书记|总工程师|总会计师|财务总监|法定代表人|法人代表|董事|监事|项目经理|负责人|主任|局长|院长)/
const INDIVIDUAL_EVENT = /(涉嫌|严重违纪|违纪违法|接受审查|审查调查|被查|被留置|开除党籍|开除公职|立案审查|双开)/

export function isIndividualMatter(text: string, subjectName: string, termIndex: number): boolean {
  const window = text.slice(Math.max(0, termIndex - 200), Math.min(text.length, termIndex + 200))
  if (!INDIVIDUAL_ROLE.test(window) || !INDIVIDUAL_EVENT.test(window)) return false
  const escaped = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const companyAction = new RegExp(`${escaped}[^。；\\n]{0,20}(?:被罚|被处罚|罚款|列入|被执行|判决|败诉)`).test(window)
  return !companyAction
}

// ── 司法信息（法院公开体系口径） ────────────────────────────────────────
export interface CreditCaseInfo {
  caseNumber?: string
  court?: string
  stage?: string
  parties?: string
  hearingDate?: string
}

export function extractCaseInfo(text: string): CreditCaseInfo {
  const caseNumber = text.match(/[（(]\s*20\d{2}\s*[）)][\u4e00-\u9fff]{1,4}\d{1,5}[\u4e00-\u9fff]{0,6}\d{0,6}\s*号/)?.[0]?.replace(/\s+/g, '')
  const court = text.match(/[\u4e00-\u9fff]{2,12}(?:人民法院|中级法院|高级法院|知识产权法院|海事法院)/)?.[0]
  const stage = /(二审|第二审)/.test(text) ? '二审' : /再审/.test(text) ? '再审' : /(一审|第一审)/.test(text) ? '一审' : undefined
  const parties = text.match(/(?:原告|上诉人|申请人)[：:\s]*([\u4e00-\u9fff（）()]{2,30})/)?.[1]?.trim()
  const hearingDate = extractFactDate(text)
  return {
    ...(caseNumber ? { caseNumber } : {}),
    ...(court ? { court } : {}),
    ...(stage ? { stage } : {}),
    ...(parties ? { parties } : {}),
    ...(hearingDate ? { hearingDate } : {}),
  }
}

/** 某类别查无记录时输出明确核查结论。 */
export function buildVerifications(facts: CreditRiskFact[], sourceTitles: string[], checkedAtLabel: string): CreditRiskVerification[] {
  const covered = new Set(facts.filter((fact) => fact.subjectScope === 'company').map((fact) => fact.category))
  const definitions: Array<{ category: CreditRiskCategory; label: string; conclusion: string }> = [
    { category: 'administrative-penalty', label: '行政处罚', conclusion: '未发现对该主体的行政处罚记录' },
    { category: 'business-abnormal', label: '经营异常', conclusion: '未发现经营异常名录记录' },
    { category: 'serious-violation', label: '严重违法失信', conclusion: '未发现严重违法失信记录' },
    { category: 'dishonest-enforcement', label: '失信被执行', conclusion: '未发现失信被执行人 / 限制高消费记录' },
  ]
  return definitions
    .filter((definition) => !covered.has(definition.category))
    .map((definition) => ({
      ...definition,
      basis: `${checkedAtLabel} 核查；公开来源 ${sourceTitles.length} 处${sourceTitles.length > 0 ? `（${sourceTitles.slice(0, 3).join('、')} 等）` : ''}；未命中不代表绝对没有。`,
    }))
}

// ── 检索计划（全网；政府/事业单位走机构登记 + 行政诉讼） ────────────────
export function buildCreditRiskQueries(request: CreditRiskRequest, subjectType: CreditRiskSubjectType): string[] {
  const name = request.companyName.trim()
  const project = request.projectTitle.trim()
  // 用户反馈"组织机构代码、法人没有" → 登记组拆成两条，并把组织机构代码/负责人写进查询词。
  const registration = subjectType === 'enterprise'
    ? `"${name}" 统一社会信用代码 组织机构代码 法定代表人 注册资本 登记状态`
    : `"${name}" 统一社会信用代码 组织机构代码 事业单位法人证书 负责人 地址`
  const contact = `"${name}" 注册地址 联系电话 所属行业 成立日期`
  const adverse = `"${name}" 行政处罚 违法事实 处罚决定书 罚款 信用中国 双公示`
  const court = `"${name}" 开庭公告 裁判文书 行政诉讼 原告 被告 案由 金额 人民法院公告网`
  const tender = `"${project}" 串通投标 提供虚假材料 招标投标 处罚 违规`
  // 用户参考口径：并行 fan-out，多维度各一条（含工商变更、高管个人通报，用于区分主体责任）。
  const changes = `"${name}" 工商变更记录 股东 注册资本 变更`
  const executives = `"${name}" 董事长 总经理 副总经理 涉嫌 纪委 通报 审查`
  const penaltyFull = `"${name}" 行政处罚决定书 全文 信用中国 国家企业信用信息公示系统`
  const judgmentFull = `"${name}" 裁判文书 全文 中国裁判文书网 人民法院公告网`
  return [registration, contact, adverse, court, tender, changes, executives, penaltyFull, judgmentFull]
}

/** 需要登录/扫码才能看原文的站点：用户要求这类站点不作为"原文链接"来源。 */
const LOGIN_WALLED_HOSTS = ['qcc.com', 'aiqicha.baidu.com', 'qixin.com', 'tianyancha.com', 'shuidi.cn', 'wenshu.court.gov.cn']
const LOGIN_WALLED_PUBLISHER = /(企查查|爱企查|启信宝|天眼查|水滴信用|裁判文书网)/

/** 聚合/黄页类站点（需登录或只给栏目名）：按用户要求不再作为来源，也不进模型证据表。 */
const AGGREGATOR_HINT = /(企查查|爱企查|启信宝|天眼查|水滴信用|企知道|公司详情查询系统|黄页网|顺企网|11467|qcc\.com|aiqicha|qixin\.com|tianyancha|shuidi\.cn|qichacha|kanzhun)/i

export function isAggregatorSource(pageUrl: string | undefined, publisher: string, title = ''): boolean {
  if (AGGREGATOR_HINT.test(`${publisher} ${title}`)) return true
  if (AGGREGATOR_HINT.test(pageUrl ?? '')) return true
  return isLoginWalledSource(pageUrl, publisher)
}
export function isLoginWalledSource(pageUrl: string | undefined, publisher: string): boolean {
  if (LOGIN_WALLED_PUBLISHER.test(publisher)) return true
  if (!pageUrl) return false
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
    return LOGIN_WALLED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/** 处罚决定书文号 / 文件号（如"川环罚〔2026〕12号""成武市监罚〔2026〕5号"）。 */
export function extractDocumentNumber(text: string): string | undefined {
  return text.match(/[\u4e00-\u9fff]{0,8}[〔\[（(]\s*20\d{2}\s*[〕\]）)]\s*\d{1,5}\s*号/)?.[0]?.replace(/\s+/g, '') || undefined
}

/** 事发/文书地点（用户要求"时间地点"）。 */
export function extractFactLocation(text: string): string | undefined {
  const match = text.match(/(?:违法地点|违法行为发生地|案发地|经营场所|注册地址|住所|单位地址)[：:\s]*([^\n。；;，,]{4,40})/)
  return match?.[1]?.trim() || undefined
}

/**
 * 用户要求：事由列要么给出"案情＋时间＋结果"的简述，要么必须给出可公开访问的原文链接。
 * 这里把已抽到的结构化片段拼成一句简述；拼不出（只有类别名）就返回 undefined。
 */
export function composeFactSummary(fact: Pick<CreditRiskFact, 'categoryLabel' | 'reason' | 'occurredAt' | 'amount' | 'authority' | 'location' | 'documentNumber'>): string | undefined {
  const reason = fact.reason.replace('（来源未写明具体事由）', '').trim()
  const hasRealReason = reason.length >= 4 && reason !== fact.categoryLabel
  if (!hasRealReason) return undefined
  const head = fact.occurredAt ? `${fact.occurredAt}，` : ''
  const where = fact.location ? `（${fact.location}）` : ''
  const tail = [fact.authority ? `由${fact.authority}作出` : '', fact.amount ? `罚没 ${fact.amount}` : '', fact.documentNumber ?? ''].filter(Boolean).join('，')
  return `${head}${reason}${where}${tail ? `，${tail}` : ''}`
}

/** 公开可访问、且常带文件号/发布机构注释的站点（用户指定方向：政府公示、信用中国、法院公告、大型门户）。 */
const PUBLIC_SOURCE_HOSTS = [
  'creditchina.gov.cn', 'gsxt.gov.cn', 'zxgk.court.gov.cn', 'rmfygg.court.gov.cn', 'wenshu.court.gov.cn',
  'gov.cn', 'sina.com.cn', 'news.qq.com', 'qq.com', '163.com', 'weibo.com', 'thepaper.cn', 'caixin.com',
  'yicai.com', 'cebpubservice.cn', 'ggzy.gov.cn', 'ccgp.gov.cn', 'chinabidding.cn', 'bidcenter.com.cn',
]
const PUBLIC_SOURCE_PUBLISHER = /(信用中国|国家企业信用信息公示系统|中国执行信息公开网|人民法院公告网|人民政府|财政局|住房和城乡建设局|市场监督管理局|公共资源交易|新浪|腾讯|网易|微博|澎湃|第一财经|财新)/

/** 是否需要登录/扫码（由"需要登录"的站点只作线索，不作原文链接）。 */
export function isPublicSource(pageUrl: string | undefined, publisher: string): boolean {
  if (PUBLIC_SOURCE_PUBLISHER.test(publisher)) return true
  if (!pageUrl) return false
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
    return PUBLIC_SOURCE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/**
 * 某条事实缺"案情/链接"时，按类别去公开站点定向补搜（用户口径：换新浪、腾讯、微博等公开站点，
 * 只要带文件号或发布机构注释即可）。
 */
export function buildFactSourceQueries(subjectName: string, category: CreditRiskCategory): string[] {
  const name = subjectName.trim()
  switch (category) {
    case 'administrative-penalty':
      return [`"${name}" 行政处罚决定书 违法事实 处罚机关`, `"${name}" 处罚 公示 site:gov.cn`]
    case 'administrative-litigation':
      return [`"${name}" 开庭公告 案号 案由`, `"${name}" 行政诉讼 判决书 法院公告`]
    case 'dishonest-enforcement':
      return [`"${name}" 被执行人 执行案号 执行标的`, `"${name}" 失信被执行人 立案 法院`]
    case 'business-abnormal':
    case 'serious-violation':
      return [`"${name}" 列入经营异常名录原因 严重违法失信名单`]
    case 'tender-violation':
      return [`"${name}" 招标投标 处罚 通报 违规`]
    default:
      return [`"${name}" 公示 公告 详情`]
  }
}

/** 主体基础登记字段缺失时，按字段定向补搜（企业走工商，机关/事业单位走机构登记）。 */
export function buildRegistrationFieldQueries(subjectName: string, type: CreditRiskSubjectType): string[] {
  const name = subjectName.trim()
  return type === 'enterprise'
    ? [`"${name}" 统一社会信用代码 法定代表人`, `"${name}" 注册地址 所属行业 成立日期 登记状态`]
    : [`"${name}" 统一社会信用代码 负责人`, `"${name}" 事业单位法人证书 单位地址`]
}

/**
 * 宽窗口抽取（不再只看主体名前后 600 字）：用于"公告/公示页把统一社会信用代码、法人写在中后段"的情况。
 */
export function extractRegistrationProfileWide(text: string, subjectName: string, type: CreditRiskSubjectType): Partial<CreditRiskSubjectProfile> {
  const windowed = extractRegistrationProfile(text, subjectName, type)
  const compact = text.replace(/[\s\u3000]/g, '')
  const code = windowed.code
    ?? compact.match(/统一社会信用代码[^0-9A-Z]{0,40}([0-9A-Z]{18})/i)?.[1]
    ?? compact.match(/(?:组织机构代码|机构代码)[：:]?([0-9A-Z]{8}-?[0-9A-Z])/i)?.[1]
  const legal = windowed.legalPerson
    ?? text.match(/(?:法定代表人|法人代表|法定负责人|负责人|法人)[：:\s]*([\u4e00-\u9fff·]{2,6})/)?.[1]?.trim()
  const address = windowed.address
    ?? text.match(/(?:注册地址|住所|单位地址|办公地址)[：:\s]*([^\n；;]{6,80})/)?.[1]?.trim()
  const industry = windowed.industry
    ?? text.match(/(?:所属行业|行业类别|经营范围|主要职责|业务范围)[：:\s]*([^\n。；;]{2,30})/)?.[1]?.trim()
  return {
    ...windowed,
    ...(code ? { code } : {}),
    ...(legal ? { legalPerson: legal } : {}),
    ...(address ? { address } : {}),
    ...(industry ? { industry } : {}),
  }
}

export const PUBLIC_SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  official: '官方公告',
  registry: '工商平台',
  media: '媒体参考',
}

// ── 事实抽取（确定性；带否定句与非不利角色守卫） ───────────────────────
const FACT_PATTERNS: Array<{ category: CreditRiskCategory; pattern: RegExp }> = [
  { category: 'business-abnormal', pattern: /经营异常|异常名录/ },
  { category: 'serious-violation', pattern: /严重违法|严重失信/ },
  { category: 'administrative-penalty', pattern: /行政处罚|处罚决定|罚款|罚没|警告/ },
  { category: 'dishonest-enforcement', pattern: /失信被执行人|被执行人|执行标的|限制高消费/ },
  { category: 'administrative-litigation', pattern: /行政诉讼|裁判文书|开庭公告|判决书|裁定书|起诉状|行政复议/ },
  { category: 'tender-violation', pattern: /串通投标|围标|提供虚假材料|中标无效|招标投标.{0,6}(?:处罚|违法|违规)/ },
]

const REASON_PATTERNS: RegExp[] = [
  /(?:主要违法事实|违法事实|处罚事由|违法依据|处罚依据)[：:\s]*([^\n。；]{6,60})/,
  /(?:列入原因|列入经营异常名录原因|列入严重违法失信名单原因)[：:\s]*([^\n。；]{4,60})/,
  /(?:案由|诉讼请求|裁判结果)[：:\s]*([^\n。；]{4,60})/,
  /(?:失信行为|失信情形)[：:\s]*([^\n。；]{4,60})/,
]

/** 抽到的原始事由太长时截到第一个分句，控制在 60 字内。 */
export function extractFactReason(text: string): string | undefined {
  for (const pattern of REASON_PATTERNS) {
    const value = text.match(pattern)?.[1]?.trim()
    const cleaned = value ? cleanFactText(value) : undefined
    if (cleaned) return cleaned
  }
  return undefined
}

const LABEL_LIKE = /^(?:历史)?(?:裁判文书|法律诉讼|开庭公告|行政处罚|经营异常|严重违法|失信被执行人|被执行人|司法案件|立案信息|法院公告)\d*$/

function cleanFactText(value: string): string | undefined {
  const cleaned = value.replace(/[*#`|>\[\]【】]/g, '').replace(/\s+/g, ' ').trim().split(/[，,；;]/)[0]
  const navHits = ['工商信息', '股东信息', '主要人员', '变更记录', '立案信息', '开庭公告', '法院公告', '送达公告', '法律文书', '失信被执行人', '终本案件', '限制高消费'].filter((token) => cleaned.includes(token)).length
  if (navHits >= 3) return undefined
  if (cleaned.length < 4 || LABEL_LIKE.test(cleaned)) return undefined
  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned
}

export function extractFactDate(text: string): string | undefined {
  const match = text.match(/(?:处罚决定日期|决定日期|处罚日期|立案日期|裁判日期|发布日期|公示日期|列入日期)[：:\s]*(20\d{2})[年\-/.](\d{1,2})[月\-/.]?(\d{1,2})?/)
  if (!match) return undefined
  const month = match[2].padStart(2, '0')
  return match[3] ? `${match[1]}-${month}-${match[3].padStart(2, '0')}` : `${match[1]}-${month}`
}

export function extractFactAmount(text: string): string | undefined {
  const match = text.match(/(?:罚款|罚没|处罚金额|执行标的)[^\d]{0,8}([0-9][0-9,，.]*)\s*(万元|元|亿元)/)
  return match ? `${match[1]} ${match[2]}` : undefined
}

export function extractAuthority(text: string): string | undefined {
  // 必须是真机构名（带机构后缀），否则会出现"结果：由|作出"这种空占位。
  const match = text.match(/(?:处罚机关|作出决定机关|决定机关|执行法院|审理法院|发布机关|列入机关)[：:\s]*([\u4e00-\u9fff]{2,24}(?:法院|局|委员会|厅|部|中心|署|办公室))/)
  const value = match?.[1]?.trim()
  if (!value || value.length < 4) return undefined
  return value
}

/** 政府/事业单位的登记字段与企业不同：事业单位法人证书、机构登记代码也算。 */
export function extractRegistrationProfile(text: string, subjectName: string, type: CreditRiskSubjectType): Partial<CreditRiskSubjectProfile> {
  const window = windowAround(text, subjectName, 600)
  const source = window || text.slice(0, 1500)
  // 代码：统一社会信用代码 18 位（允许空格/全角）；组织机构代码 9 位；事业单位法人证书号/登记证号。
  const compact = source.replace(/[\s\u3000]/g, '')
  const code = compact.match(/统一社会信用代码[^0-9A-Z]{0,40}([0-9A-Z]{18})/i)?.[1]
    ?? compact.match(/(?:组织机构代码|机构代码|组织代码)[^0-9A-Z]{0,30}([0-9A-Z]{8}-?[0-9A-Z])/i)?.[1]
    ?? compact.match(/(?:事业单位法人证书号|法人证书号|机构登记代码|登记证号)[：:]?([0-9A-Z\-]{8,24})/i)?.[1]
  return {
    ...(code ? { code: code.trim() } : {}),
    ...(source.match(/(?:法定代表人|法人代表|负责人)[：:\s]*([^\s，,；;]{2,20})/)?.[1]?.trim()
      ? { legalPerson: source.match(/(?:法定代表人|法人代表|负责人)[：:\s]*([^\s，,；;]{2,20})/)![1].trim() } : {}),
    ...(source.match(/(?:所属行业|行业类别|经营范围)[：:\s]*([^\n。；;]{2,30})/)?.[1]?.trim()
      ? { industry: source.match(/(?:所属行业|行业类别|经营范围)[：:\s]*([^\n。；;]{2,30})/)![1].trim() } : {}),
    ...(source.match(/(?:注册地址|住所|单位地址|办公地址|地址)[：:\s]*([^\n；;]{6,80})/)?.[1]?.trim()
      ? { address: source.match(/(?:注册地址|住所|单位地址|办公地址|地址)[：:\s]*([^\n；;]{6,80})/)![1].trim() } : {}),
    ...(source.match(/(?:联系电话|联系方式|电话)[：:\s]*((?:0\d{2,3}[-—]?\d{7,8}(?:[-—]\d{1,6})?)|(?:1[3-9]\d{9}))/)?.[1]?.trim()
      ? { phone: source.match(/(?:联系电话|联系方式|电话)[：:\s]*((?:0\d{2,3}[-—]?\d{7,8}(?:[-—]\d{1,6})?)|(?:1[3-9]\d{9}))/)![1].trim() } : {}),
    ...(source.match(/(?:登记状态|经营状态|机构状态)[：:\s]*([^\s，,；;]{2,12})/)?.[1]?.trim()
      ? { registrationStatus: source.match(/(?:登记状态|经营状态|机构状态)[：:\s]*([^\s，,；;]{2,12})/)![1].trim() } : {}),
  }
}

/**
 * 从一篇正文里抽"主体相关的不利事实"。门禁已按用户要求放宽：
 * 不再要求法院来源，政府/事业单位同样适用；来源只要求"官方或权威"（媒体转载可作参考）。
 */
export function extractCreditFacts(input: {
  subjectName: string
  title: string
  publisher: string
  pageUrl?: string
  text: string
  tier: 'official' | 'registry' | 'media'
}): CreditRiskFact[] {
  const { subjectName, title, publisher, pageUrl, text, tier } = input
  // 摘要里常混着站点导航串（""工商信息 股东信息 立案信息 开庭公告…""），这种页面整篇不作事实来源。
  const haystack = `${title}\n${text}`
  if (!subjectName || !haystack.includes(subjectName)) return []
  if (!tier || (tier === 'media' && !isReputablePublisher(publisher || title))) {
    // 媒体来源只在信誉名单内才作参考；否则整篇跳过。
    if (tier === 'media') return []
  }
  const walled = isLoginWalledSource(pageUrl, publisher)
  const facts: CreditRiskFact[] = []
  for (const { category, pattern } of FACT_PATTERNS) {
    const index = findAffirmativeIndex(haystack, subjectName, pattern)
    if (index < 0) continue
    const label = CREDIT_RISK_CATEGORY_LABELS[category]
    const quoted = extractFactReason(text)
    const candidate = quoted ?? composeReasonFromFields(text, category) ?? fallbackReason(text, index, category)
    // 计数串/概览句/导航串不是事由；不合格就退回"来源未写明"，交给模型归纳或折叠展示。
    const fallback = isCountOrOverviewJunk(candidate) ? label : candidate
    const hasRealReason = fallback !== label
    // 用户口径：事由列要么能拼出"时间＋案情＋结果"简述，要么必须给可公开访问的原文链接；
    // 需要登录/扫码的站点不作原文链接（前端标"需登录"），事实本身保留为线索。
    const reason = hasRealReason ? fallback : `${label}（来源未写明具体事由）`
    facts.push({
      id: `fact:${category}:${pageUrl ?? title}:${index}`,
      subjectName,
      category,
      categoryLabel: label,
      reason,
      ...(extractFactDate(text) ? { occurredAt: extractFactDate(text) as string } : {}),
      ...(extractFactAmount(text) ? { amount: extractFactAmount(text) as string } : {}),
      ...(extractAuthority(text) ? { authority: extractAuthority(text) as string } : {}),
      ...(extractFactLocation(text) ? { location: extractFactLocation(text) as string } : {}),
      ...(extractDocumentNumber(text) ? { documentNumber: extractDocumentNumber(text) as string } : {}),
      sourceTitle: title || publisher || '未命名来源',
      publisher: publisher || '未取得',
      ...(pageUrl ? { sourceUrl: pageUrl } : {}),
      tier,
      sourceWalled: walled,
      subjectScope: isIndividualMatter(text, subjectName, index) ? 'individual' : 'company',
      ...(Object.keys(extractCaseInfo(text)).length > 0 ? { caseInfo: extractCaseInfo(text) } : {}),
    })
  }
  return dedupeFacts(facts)
}

/** 没有结构化"事由"字段时，取包含关键词的那一句并压到 ≤60 字（排除导航/登录类噪声句）。 */
/**
 * 用户口径：既然抓到了判例/文书条目，就要把字段行组织成"结论句"，而不是写"来源未写明"。
 * 认的是字段行（案号 / 执行法院 / 立案日期 / 案由 / 处罚内容 / 执行标的 / 列入原因）——
 * 企查查、爱企查、裁判文书、信用中国的条目基本都是这种结构。
 */
/**
 * 已停用（2026-09-16）：按字段行拼接事由会把页面栏目串、"案号 案号"重复、空的"由|作出"当成案情，
 * 并且会把一个案号串到相邻类别上。事由只允许两个来源：① 结构化字段的原文引用；② 大模型归纳（本地引文校验）。
 */
export function composeReasonFromFields(_text: string, _category: CreditRiskCategory): string | undefined {
  return undefined
}
export function isNegated(text: string, termIndex: number): boolean {
  const prefix = text.slice(Math.max(0, termIndex - 120), termIndex)
  return /(?:未被|没有被|未曾被|不得被|不在|未列入|未纳入|查询未发现|查询结果[^。；\n]{0,30}(?:无|没有))[^。；\n]{0,110}$/.test(prefix)
}

/** 主体是原告/申请执行人/举报人时，该条不是它自己的不利记录。 */
export function hasNonAdverseRole(text: string, subjectName: string, termIndex: number): boolean {
  const window = text.slice(Math.max(0, termIndex - 180), Math.min(text.length, termIndex + 180))
  const escaped = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:申请执行人|原告|举报人|投诉人|权利人)[：:\\s]*${escaped}`).test(window)
}

function dedupeFacts(facts: CreditRiskFact[]): CreditRiskFact[] {
  return [...new Map(facts.map((fact) => [`${fact.category}:${fact.sourceUrl ?? fact.sourceTitle}`, fact])).values()]
}

/** 栏目计数串 / 概览句 / 导航串不是事由（"国企 2家…招投标 889"、"风险方面共发现…2条"）。 */
export function isCountOrOverviewJunk(value: string): boolean {
  return /(概览|共发现|风险方面|含有司法案件|\d+\s*(?:条|家|个|项)|招投标\s*\d|行政许可|一般纳税人|国企\s*\d|股东信息|主要人员|变更记录)/.test(value)
}

function windowAround(text: string, keyword: string, radius: number): string {
  const index = keyword ? text.indexOf(keyword) : -1
  if (index < 0) return ''
  return text.slice(Math.max(0, index - radius), index + radius)
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

// ── 校验 ───────────────────────────────────────────────────────────────
function fallbackReason(text: string, index: number, category: CreditRiskCategory): string {
  const pattern = FACT_PATTERNS.find((item) => item.category === category)?.pattern
  const window = text.slice(Math.max(0, index - 200), index + 240)
  const sentence = window.split(/[。；;\n]/).map((part) => part.trim()).find((part) => pattern?.test(part)
    && (part.match(/[\u4e00-\u9fff]/g) ?? []).length >= 6
    && !/(登录|注册|APP|下载|查看|详情|首页|客服|广告|版权|免责)/.test(part))
  const cleaned = sentence ? cleanFactText(sentence) : undefined
  return cleaned ?? CREDIT_RISK_CATEGORY_LABELS[category]
}
function findAffirmativeIndex(text: string, subjectName: string, pattern: RegExp): number {
  const subjectIndexes = indexesOf(text, subjectName)
  const termPattern = new RegExp(pattern.source, "g")
  for (const match of text.matchAll(termPattern)) {
    const termIndex = match.index ?? -1
    if (termIndex < 0) continue
    if (!subjectIndexes.some((subjectIndex) => Math.abs(subjectIndex - termIndex) <= 160)) continue
    if (isNegated(text, termIndex)) continue
    if (hasNonAdverseRole(text, subjectName, termIndex)) continue
    return termIndex
  }
  return -1
}
export function assertCreditRiskRequest(value: unknown): asserts value is CreditRiskRequest {
  if (!isRecord(value)
    || !isText(value.opportunityId, 200)
    || !isText(value.projectTitle, 300)
    || !isText(value.companyName, 200)
    || (value.address !== undefined && !isText(value.address, 200))
    || !isText(value.industry, 80)) {
    throw new Error('公开风险请求参数不完整或超出当前支持范围。')
  }
}

export function isCreditRiskResult(value: unknown): value is CreditRiskResult {
  if (!isRecord(value)) return false
  return typeof value.opportunityId === 'string'
    && typeof value.subjectName === 'string'
    && isRecord(value.profile)
    && Array.isArray(value.facts)
    && typeof value.checkedAt === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

/** 结果页的导航/栏目串不是事实：命中 5 个以上栏目词且没有实质文书字段时判为噪声。 */
export function isNavigationJunk(text: string): boolean {
  const tokens = ['工商信息', '股东信息', '主要人员', '变更记录', '减资公告', '立案信息', '开庭公告', '法院公告', '送达公告', '法律文书', '被执行人', '终本案件', '限制高消费', '企业年报', '行政许可', '税务信息', '司法拍卖', '对外投资', '分支机构', '清算信息']
  const hits = tokens.filter((token) => text.includes(token)).length
  const hasDocumentField = /(违法事实|处罚决定|案由|执行标的|判决如下|本院认为|列入原因)/.test(text)
  return hits >= 5 && !hasDocumentField
}

// ── 线索段（2026-09-16）：聚合站只用来提取"标识符"，不作来源，也不进证据表 ──────────
export interface CreditClueIdentifier {
  kind: 'case-number' | 'penalty-number' | 'court' | 'party' | 'cause' | 'credit-code'
  value: string
  quote: string
}

const CLUE_PATTERNS: Array<{ kind: CreditClueIdentifier['kind']; pattern: RegExp }> = [
  { kind: 'case-number', pattern: /[（(]\s*20\d{2}\s*[）)][\u4e00-\u9fff]{1,4}\d{1,5}[\u4e00-\u9fff]{0,6}\d{0,6}\s*号/g },
  { kind: 'penalty-number', pattern: /[\u4e00-\u9fff]{0,10}[〔\[（(]\s*20\d{2}\s*[〕\]）)]\s*\d{1,5}\s*号/g },
  { kind: 'court', pattern: /[\u4e00-\u9fff]{2,12}(?:人民法院|中级法院|高级法院)/g },
  { kind: 'credit-code', pattern: /[0-9A-HJ-NPQRTUWXY]{18}/g },
]

/** 从（可能是聚合站的）正文里抽出可去权威平台核验的标识符。 */
export function extractClueIdentifiers(text: string, subjectName: string): CreditClueIdentifier[] {
  const clues: CreditClueIdentifier[] = []
  for (const { kind, pattern } of CLUE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      const value = match[0].replace(/\s+/g, '')
      if (kind === 'credit-code' && !/^(91|92|11|12|13|15|19)/.test(value)) continue
      clues.push({ kind, value, quote: sentenceAround(text, match.index ?? 0) })
    }
  }
  for (const [label, kind] of [['原告', 'party'], ['被告', 'party'], ['案由', 'cause']] as const) {
    const match = text.match(new RegExp(label + '[：:\\s]*([^\\n。；;，,]{2,30})'))
    if (match?.[1]) clues.push({ kind, value: `${label}:${match[1].trim()}`, quote: match[0].trim() })
  }
  void subjectName
  return [...new Map(clues.map((clue) => [`${clue.kind}:${clue.value}`, clue])).values()].slice(0, 20)
}

/** 用标识符去权威平台定向核验（裁判文书网 / 人民法院公告网 / 执行信息公开网 / 信用中国）。 */
export function buildClueVerificationQueries(clues: CreditClueIdentifier[], subjectName: string): string[] {
  const queries: string[] = []
  for (const clue of clues.filter((item) => item.kind === 'case-number').slice(0, 3)) {
    // 案号直达：优先免登录的法院公开平台（公告网有送达/开庭公告与当事人；执行公开网有被执行信息）。
    queries.push(`"${clue.value}" 送达公告 开庭公告 当事人 人民法院公告网`)
    queries.push(`"${clue.value}" 被执行人 执行标的 中国执行信息公开网`)
  }
  for (const clue of clues.filter((item) => item.kind === 'penalty-number').slice(0, 2)) {
    queries.push(`"${clue.value}" 行政处罚决定书 信用中国 公示`)
  }
  if (clues.some((clue) => clue.kind === 'court')) {
    queries.push(`"${subjectName}" 失信被执行人 执行案号 限制高消费 中国执行信息公开网`)
  }
  return [...new Set(queries)].slice(0, 6)
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1)
  const end = text.indexOf('\n', index)
  return text.slice(start, end < 0 ? Math.min(text.length, index + 120) : end).trim().slice(0, 120)
}
