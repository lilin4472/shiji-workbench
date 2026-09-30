// 产业链数据契约（需求文档 §5.5：产业链与获客共用一张关系事实图 + 用户 2026-09-16 收敛口径）
//
// 用户口径：
//   核心节点 = 用户搜到的招标项目发布方（甲方 / 招标人 / 业主）公司；
//   只做两类关系：① 以往中标企业 ② 上下游供应链企业（供应商 / 分包 / 联合体 / 代理）；
//   每家公司只展示四个维度：公司名称、法人、行业领域、联系方式（本模块只求有个电话）。
//   本模块不画图、不碰地图。
//
// 纪律（禁止编造）：公司名必须是正文里出现过的完整主体名；每条关系必须带原句与来源；
// 法人 / 行业领域 / 电话抽不到就留空，由界面显示"未取得"，绝不用模型补。

export type IndustryRelationKind = 'historical-winner' | 'supplier' | 'contractor' | 'subcontractor' | 'tender-agent' | 'consortium-member' | 'parent-company' | 'subsidiary' | 'branch-company'
export type IndustryConfidence = 'confirmed' | 'candidate'

export interface IndustrySourceRef {
  evidenceId: string
  title: string
  publisher: string
  pageUrl?: string
  tier: SourceTier
}

export interface IndustryCompany {
  id: string
  name: string
  relation: IndustryRelationKind
  /** 关系原句（从正文里截出来的那一句），不是模型概括。 */
  relationQuote: string
  legalPerson?: string
  industryField?: string
  phone?: string
  sources: IndustrySourceRef[]
  confidence: IndustryConfidence
}

export interface IndustryOwner {
  name: string
  legalPerson?: string
  industryField?: string
  phone?: string
  sources: IndustrySourceRef[]
}

export interface IndustryChainRequest {
  opportunityId: string
  projectTitle: string
  companyName: string
  address?: string
  industry: string
}

export interface IndustryChainResult {
  schemaVersion: typeof INDUSTRY_CHAIN_SCHEMA_VERSION
  opportunityId: string
  projectTitle: string
  owner: IndustryOwner
  /** 以往中标企业。 */
  winners: IndustryCompany[]
  /** 上下游供应链（供应商 / 分包 / 联合体 / 代理）。 */
  suppliers: IndustryCompany[]
  queries: string[]
  requestCount: number
  cacheHit: boolean
  checkedAt: string
  gaps: string[]
  boundary: string
}

export type IndustryChainResponse =
  | { ok: true; value: IndustryChainResult }
  | { ok: false; message: string }

export const INDUSTRY_CHAIN_BOUNDARY = '产业链只记录公告与公开页面里写明的企业与关系原句：中标/成交关系来自对应公告正文，供应链、承包/分包、代理、联合体与集团组织关系按来源强度标注；字段抽不到就显示"未取得"，不做推测，也不把同名或集团名称相似当成已确认关系。'
export const INDUSTRY_CHAIN_SCHEMA_VERSION = 3

/** 来源性质：政府公告原文 / 工商公示平台 / 媒体转载（本模块要把工商平台单独标出来）。 */
export type SourceTier = 'official' | 'registry' | 'media'

/** 把政策链算出的 official/media 再细分出"工商平台"：第二阶段补法人/行业/电话主要靠它们。 */
export function resolveIndustrySourceTier(pageUrl: string | undefined, publisher: string, base: SourceTier): SourceTier {
  const host = safeHost(pageUrl)
  const registryPublisher = /(企查查|爱企查|启信宝|天眼查|国家企业信用信息公示系统|信用中国|水滴信用|企查查科技)/
  const registryHost = ['qcc.com', 'aiqicha.baidu.com', 'qixin.com', 'tianyancha.com', 'gsxt.gov.cn', 'creditchina.gov.cn', 'shuidi.cn']
  if (registryPublisher.test(publisher)) return 'registry'
  if (registryHost.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'registry'
  return base
}

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  official: '官方公告',
  registry: '工商平台',
  media: '媒体参考',
}

function safeHost(pageUrl: string | undefined): string {
  if (!pageUrl) return ''
  try {
    return new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const RELATION_LABELS: Record<IndustryRelationKind, string> = {
  'historical-winner': '以往中标企业',
  supplier: '供应商',
  contractor: '承包单位',
  subcontractor: '分包单位',
  'tender-agent': '招标/采购代理',
  'consortium-member': '联合体成员',
  'parent-company': '上级/母公司',
  subsidiary: '子公司',
  'branch-company': '分公司',
}

// ── 公司名识别 ─────────────────────────────────────────────────────────
// 只认完整主体名后缀；首字符限定为中英文数字，避免从"）受…有限公司委托"这种串里截出脏名字。
// “集团”只有在主体名边界处才算后缀。否则“中铁二局集团装饰装修工程有限公司”
// 会被错误拆成“中铁二局集团”与“装饰装修工程有限公司”。
const COMPANY_PATTERN = /[\u4e00-\u9fffA-Za-z0-9][\u4e00-\u9fff（）()·A-Za-z0-9]{1,59}?(?:股份有限公司|有限责任公司|集团有限公司|有限公司|集团(?=$|[\s|,，、。;；:：)）】\]])|设计院|研究院|勘察院|勘测院|工程局|工程公司|建设公司|科技公司|实业公司|事务所|合伙企业)/g
/** 名字前可能黏上标点（"…有限公司）受成都市武侯区…有限公司委托"）。 */
const LEADING_NOISE = /^[）)】\]》」”"'、，,。；;:：\s-]+/
/** 名字前可能黏上介词/动词（"受XX有限公司委托"）。 */
const LEADING_VERB = /^(?:受|由|经|据|向|与|和|及|为|至|从|对|在|该|本|其|并|等|其中|以及)/
/** 明显不是企业的主体（政府机关 / 事业单位 / 军队），不当产业链公司。 */
const NON_COMPANY_HINT = /(人民政府|人民政府办公室|管理委员会|管委会|发展和改革委员会|财政局|住房和城乡建设局|教育局|卫生健康委员会|公安|法院|检察院|人民法院|管理中心|社会保障|街道办事处|乡镇人民政府|工会|协会|学会|大学|学院|医院|疾病预防控制|社区)/
/** 企业信息站的导航栏词串不是公司名，曾被“分支机构”标签后的页面菜单误识别。 */
const COMPANY_NAV_NOISE = /(财务数据|企业年报|最终受益人|实际控制人|协同股东|疑似关系|同业分析|关联方认定|空壳指数|经营风险|司法案件|知识产权|变更记录|主要人员|社保人数|间接持股|控制企业)/

export function extractCompanyNames(text: string): string[] {
  const names = [...text.matchAll(COMPANY_PATTERN)].map((match) => normalizeCompanyName(match[0]))
  return uniqueStrings(names.filter((name) => name.length >= 4
    && /^[\u4e00-\u9fffA-Za-z0-9]/.test(name)
    && !NON_COMPANY_HINT.test(name)
    && !COMPANY_NAV_NOISE.test(name)))
}

export function normalizeCompanyName(value: string): string {
  let name = value.replace(LEADING_NOISE, '').replace(LEADING_VERB, '')
  name = name.replace(/^[（(【\[]/, '').replace(/[）)】\]]$/, '')
  name = name.replace(/^[\s:：,，、。;；-]+/, '').replace(/[\s:：,，、。;；]+$/, '')
  return name.replace(/\s+/g, '').trim()
}

// ── 带标签的关系抽取 ───────────────────────────────────────────────────
const RELATION_LABEL_PATTERNS: Array<{ relation: IndustryRelationKind; labels: string[] }> = [
  { relation: 'historical-winner', labels: ['中标人', '中标单位', '中标供应商', '成交供应商', '成交人', '中标方', '成交单位', '第一中标候选人', '中标候选人第一名'] },
  { relation: 'parent-company', labels: ['母公司', '上级单位', '控股股东'] },
  { relation: 'subsidiary', labels: ['全资子公司', '控股子公司', '子公司', '所属企业'] },
  { relation: 'branch-company', labels: ['分支机构', '分公司'] },
  { relation: 'consortium-member', labels: ['联合体成员', '联合体牵头人', '联合体主办方', '联合体'] },
  { relation: 'contractor', labels: ['总承包单位', '承包单位', '施工单位', '承包人'] },
  { relation: 'subcontractor', labels: ['分包单位', '分包人', '专业分包'] },
  { relation: 'tender-agent', labels: ['招标代理机构', '采购代理机构', '招标代理', '采购代理', '代理机构'] },
  { relation: 'supplier', labels: ['供应商', '供货商', '材料供应商', '设备供应商'] },
]

export interface IndustryMention {
  name: string
  relation: IndustryRelationKind
  quote: string
}

/** 抽取"标签 + 公司名"的关系提及；同一句里可能有多家。 */
export function extractIndustryMentions(text: string): IndustryMention[] {
  const mentions: IndustryMention[] = []
  for (const sentence of splitSentences(text)) {
    for (const { relation, labels } of RELATION_LABEL_PATTERNS) {
      for (const label of labels) {
        const index = sentence.indexOf(label)
        if (index < 0) continue
        // 标签后 60 字内出现的公司名都算该关系的候选（公告常见"中标人：A公司、B公司"）。
        const tail = sentence.slice(index + label.length, index + label.length + 60)
        // 企业信息页常把“分支机构”与后续导航菜单连在一起；导航词不能当关系声明。
        if (/^\s*(?:[|｜]\s*)?(?:财务数据|企业年报|最终受益人|实际控制人|协同股东|疑似关系|同业分析|关联方认定|变更记录|工商信息|主要人员|社保人数)/.test(tail)) continue
        // “供应商选择/管理/评估体系”是在讨论方法，不是在声明某家公司是供应商。
        if (relation === 'supplier' && !/^\s*(?:[:：]|名称\s*[:：]?|为\s*[:：]?|是\s*[:：]?)/.test(tail)) continue
        for (const name of extractCompanyNames(tail)) {
          mentions.push({ name, relation, quote: sentence.trim().slice(0, 160) })
        }
      }
    }
  }
  return dedupeMentions(mentions)
}

/** 关系材料必须提到当前甲方或当前项目；仅因搜索结果里出现“供应商”等词不能建立关系边。 */
export function documentSupportsIndustryTarget(text: string, request: Pick<IndustryChainRequest, 'companyName' | 'projectTitle'>): boolean {
  const compact = (value: string) => value.replace(/[\s（）()\-—_/·]/g, '').toLocaleLowerCase('zh-CN')
  const body = compact(text)
  const owner = compact(request.companyName)
  const title = compact(request.projectTitle)
  const titleAnchor = title.slice(0, Math.min(18, title.length))
  return (owner.length >= 4 && body.includes(owner)) || (titleAnchor.length >= 8 && body.includes(titleAnchor))
}

/** 只有"中标/成交 + 公司名"同时出现在一句里，才认历史中标关系（防止把招标公告里的投标人要求当中标）。 */
export function isWinnerSentence(sentence: string): boolean {
  return /(中标|成交|中选)/.test(sentence) && !/(招标公告|采购公告|竞争性磋商公告|资格预审|投标邀请|询价公告)/.test(sentence)
}

// ── 四个维度的抽取（抽不到就返回 undefined） ───────────────────────────
export function extractLegalPerson(text: string): string | undefined {
  const match = text.match(/(?:法定代表人|法人代表)\s*[:：]?\s*(?:为|是)?\s*([\u4e00-\u9fff·]{2,6})/)
  if (!match) return undefined
  const value = match[1].trim()
  if (/^(?:信息|姓名|待核验|未取得|本项目|该公司)$/.test(value)) return undefined
  return value
}

/** 本模块只求"有个电话就行"；手机号 / 固话都认。 */
export function extractPhone(text: string): string | undefined {
  const labeled = text.match(/(?:联系电话|联系方式|电话|Tel|手机)\s*[:：]?\s*((?:0\d{2,3}[-—\s]?\d{7,8}(?:[-—]\s?\d{1,6})?)|(?:1[3-9]\d{9}))/i)
  if (labeled) return labeled[1].replace(/\s+/g, '')
  const bare = text.match(/(?:^|[^\d])((?:0\d{2,3}[-—]\d{7,8}(?:[-—]\d{1,6})?)|(?:1[3-9]\d{9}))(?:[^\d]|$)/)
  return bare ? bare[1].replace(/\s+/g, '') : undefined
}

/** 电话只认公司名附近 120 字内：公告里常把代理机构电话写在别处，串给别的公司就是错的。 */
export function extractPhoneNear(text: string, name: string): string | undefined {
  const index = text.indexOf(name)
  if (index < 0) return extractPhone(text)
  return extractPhone(text.slice(index, index + 120))
}

/** 工期 / 日期 / 金额片段不是行业领域（真实数据里出现过"全部完成之日止"）。 */
const NOT_INDUSTRY_HINT = /(之日止|之日起|之前|日历天|工期|日内|为止|详见|见附件|另行通知|万元|元|%|％)/
/** 公告表格的表头词连成一串也不是行业领域（真实数据里出现过"预计招标时间 联系人及联系方式…"）。 */
const TABLE_NOISE_HINT = /(预计招标时间|招标时间|联系人|联系方式|采购需求概况|项目名称|预算金额|序号|备注|采购品目|落实政府采购政策|中小企业|预留份额)/

export function extractIndustryField(text: string): string | undefined {
  const labeled = text.match(/(?:经营范围|所属行业|行业类别|主营业务|专业类别)\s*[:：]?\s*([^\n。；;]{2,40})/)?.[1]
  if (labeled) return cleanIndustryValue(labeled, 40)
  const scope = text.match(/(?:招标范围|采购内容|项目内容|采购需求|施工范围|服务内容)\s*[:：]?\s*([^\n。；;]{2,40})/)?.[1]
  if (!scope) return undefined
  const value = cleanIndustryValue(scope, 24)
  return value ? `${value}（本次项目范围）` : undefined
}

/** 去掉 markdown 加粗/表格符号等噪声（真实数据里抽到过 "**"），并做最小长度校验。 */
function cleanIndustryValue(value: string, maxLength: number): string | undefined {
  const cleaned = value
    .split(/[，,；;]/)[0]
    .replace(/[*#`|>\[\]【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 2 || NOT_INDUSTRY_HINT.test(cleaned) || TABLE_NOISE_HINT.test(cleaned)) return undefined
  // 里面还嵌套了标签（"2.1建设地点：…"）说明抓串了，不是行业领域。
  if (/[：:]/.test(cleaned) || /^[\d.、\-—_]/.test(cleaned)) return undefined
  if ((cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length < 2) return undefined
  return cleaned.slice(0, maxLength)
}

/** 甲方（招标人/采购人/建设单位）名称：优先用项目已有主体名，正文里再补法人/电话/行业。 */
export function extractOwnerFacts(text: string, ownerName: string): { legalPerson?: string; phone?: string; industryField?: string } {
  const window = windowAround(text, ownerName, 400)
  const scoped = window || text.slice(0, 1500)
  return {
    legalPerson: extractLegalPerson(scoped),
    phone: extractPhone(scoped),
    industryField: extractIndustryField(scoped),
  }
}

function windowAround(text: string, keyword: string, radius: number): string {
  const index = keyword ? text.indexOf(keyword) : -1
  if (index < 0) return ''
  return text.slice(Math.max(0, index - radius), index + radius)
}

// ── 检索计划（第一阶段 3 次 + 第二阶段工商核对） ─────────────────────────
export function buildIndustrySearchTargets(request: IndustryChainRequest): string[] {
  const owner = request.companyName.trim()
  const project = request.projectTitle.trim()
  const industry = request.industry.trim() && !/^(?:不限|其他|未知|全部)$/.test(request.industry.trim()) ? request.industry.trim() : ''
  return [
    `"${owner}" 中标 成交 结果 公告 ${industry}`.trim(),
    `"${project}" 中标 成交 联合体 分包 供应商`.trim(),
    `"${owner}" 母公司 子公司 分公司 供应商 承包商 招标代理 ${industry}`.trim(),
  ]
}

/**
 * 第二阶段：第一阶段拿到公司名后，去工商/企业信息页补法人、行业领域、电话。
 * 只查公司名 + 三个字段词，泛词会把新闻和无关页面捞上来。
 */
export function buildCompanyEnrichmentQuery(companyName: string): string {
  return `"${companyName.trim()}" 法定代表人 经营范围 所属行业 联系电话`
}

/** 每个项目最多做几次工商核对：太多会把调用量撑爆，优先给中标与官方来源。 */
export const INDUSTRY_ENRICHMENT_LIMIT = 4

// ── 文件类型门禁：中标关系只能来自"结果类"公告 ─────────────────────────
const RESULT_NOTICE_HINT = /(中标|成交|中选|结果|公示|合同公告|签约)/
const TENDER_NOTICE_HINT = /(招标公告|采购公告|竞争性磋商公告|竞争性谈判公告|询价公告|比选公告|资格预审|投标邀请|采购意向|招标计划)/

/**
 * 用户口径：点进去是**中标文件**才对（说明这家单位中了标 → 它是甲方的供应链或以往中标单位）；
 * 如果只是**招标文件**，那家单位只是在被招（可能是甲方或投标人），不能写成中标关系。
 */
export function documentSupportsWinner(title: string, lead: string): boolean {
  const text = `${title}\n${lead.slice(0, 400)}`
  if (RESULT_NOTICE_HINT.test(title)) return true
  if (TENDER_NOTICE_HINT.test(title)) return false
  return /(中标人|中标单位|成交供应商|成交人|中标金额|中标价)/.test(text) && RESULT_NOTICE_HINT.test(text)
}

// ── 结果装配辅助 ───────────────────────────────────────────────────────
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function dedupeMentions(mentions: IndustryMention[]): IndustryMention[] {
  const byKey = new Map<string, IndustryMention>()
  for (const mention of mentions) {
    const key = `${mention.relation}:${mention.name}`
    if (!byKey.has(key)) byKey.set(key, mention)
  }
  return [...byKey.values()]
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/[\n。；;]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 6)
}

// ── 校验 ───────────────────────────────────────────────────────────────
export function assertIndustryChainRequest(value: unknown): asserts value is IndustryChainRequest {
  if (!isRecord(value)
    || !isText(value.opportunityId, 200)
    || !isText(value.projectTitle, 300)
    || !isText(value.companyName, 160)
    || (value.address !== undefined && !isText(value.address, 200))
    || !isText(value.industry, 80)) {
    throw new Error('产业链请求参数不完整或超出当前支持范围。')
  }
}

export function isIndustryChainResult(value: unknown): value is IndustryChainResult {
  if (!isRecord(value)) return false
  return value.schemaVersion === INDUSTRY_CHAIN_SCHEMA_VERSION
    && typeof value.opportunityId === 'string'
    && isRecord(value.owner)
    && typeof (value.owner as unknown as IndustryOwner).name === 'string'
    && Array.isArray(value.winners)
    && Array.isArray(value.suppliers)
    && Array.isArray(value.queries)
    && typeof value.checkedAt === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}
