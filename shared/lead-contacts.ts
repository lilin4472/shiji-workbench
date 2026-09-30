import { RELATION_LABELS, type IndustryChainResult, type IndustryRelationKind } from './industry-chain.js'

// 获客联系方式：**只做确定性抽取 + 逐值来源绑定**（需求 5.5）。
// 值必须从已读取正文里逐字取到；抽不到就留空（界面显示""），绝不编造。
// 用户口径（2026-09-18）：公开来源里写明手机号就保留（有就要、没有就算了）；
// 法人 / 法定代表人**不算联系人**，不得拿来顶替「联系人」列。
export type LeadContactKind = 'email' | 'phone' | 'address' | 'contact'

export interface LeadContactSourceRef {
  title: string
  publisher: string
  pageUrl?: string
  tier: 'official' | 'registry' | 'media'
  observedAt: string
}

export interface LeadContactPoint {
  companyName: string
  kind: LeadContactKind
  value: string
  normalized: string
  /** 包含该值的连续原文；用于核对，也用于阻止字段类型错配。 */
  evidenceQuote: string
  sources: LeadContactSourceRef[]
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE = /(?<![0-9])(?:(?:0\d{2,3}[-\s]?\d{7,8}(?:[-转]\d{1,6})?)|(?:1[3-9]\d{9}))(?![0-9])/g
// 公司地址不再从正文中的任意地名裸抽：项目建设地点、采购人地址都不是目标公司的地址。
// 必须先出现地址字段，再结合当前公司名或该公司的专属来源页复核归属。
const LABELED_ADDRESS = /(?:公司地址|企业地址|法人机构地址|注册地址|办公地址|联系地址|经营地址|住所|所在地|地\s*址)\s*(?:[:：]|为|是|位于)\s*([^；;\n]{6,100}?)(?=(?:\s*(?:联系人|联系电话|电话|手机|邮箱|邮编)\s*[:：])|[；;\n]|$)/g
const EMAIL_FULL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PHONE_FULL = /^(?:(?:0\d{2,3}[-\s]?\d{7,8})|(?:1[3-9]\d{9}))(?:\s*(?:转|分机|-)?\s*\d{1,6})?$/
const ADDRESS_LABEL = /(?:公司地址|企业地址|法人机构地址|注册地址|办公地址|联系地址|经营地址|住所|所在地|地\s*址)\s*(?:[:：]|为|是|位于)/
const ADDRESS_ADMIN_START = /^(?:中国)?(?:[\u4e00-\u9fff]{2,12}(?:省|自治区|特别行政区|市|自治州|州|盟))/
const ADDRESS_STRONG_LOCATOR = /(?:路|街|巷|大道|镇|乡|村|社区|产业园|工业园|软件园|科技园|开发区|高新区|大厦|广场|园区|栋|幢|楼|组|单元|\d+\s*号)/
const ADDRESS_SENTENCE_NOISE = /(?:荣誉|称号|工程|项目|公告|公示|招标|中标|采购|投诉|经营范围|成立于|公司是|单位是|供应商|有限公司|有限责任公司|集团公司|委员会|办事处|公众号|上发布|同意你单位|住所由|变更)/
const ADDRESS_ORGANIZATION_END = /(?:委员会|办事处|服务中心|交易中心|有限公司|集团|公司|单位)$/
// 热线号必须按独立号码匹配，不能子串匹配：028-85123456 里恰好含 12345，子串匹配曾把真座机误杀。
const NOISE = /(?:400-?[0-9]{3}-?[0-9]{3,4}|(?<![0-9])(?:12345|12315)(?![0-9])|x{3,}|X{3,}|示例|样例|你的邮箱|test@|example@)/

// 联系人字段允许网页排版插空格、换行，并允许同一字段列 1—5 人；每个人仍须在后续门禁中
// 与电话 / 邮箱等公开触达方式处于同一小段，不能把负责人名单当联系方式。
const CONTACT = /(?:(?:项目|采购|业务|招标)\s*(?:联\s*系\s*人|负责人)|联\s*系\s*人)(?:\s*姓名)?\s*[:：]?\s*([\u4e00-\u9fff·]{2,4}(?:\s*[、,，/]\s*[\u4e00-\u9fff·]{2,4}){0,4})/g
// 命中这些标签说明抓到的不是人名（"联系人电话：028-"会先抓到"电话"）。
const CONTACT_BLOCK = /^(?:电话|手机|邮箱|邮件|地址|姓名|名单|方式|号码|法人|法定|详见|待定|暂无|以上|如下|情况|信息|联系)/

const toHalfWidth = (value: string): string => value.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
const normalize = (value: string): string => toHalfWidth(value).replace(/\s+/g, ' ').trim()

function normalizeAddress(value: string): string {
  return normalize(value)
    .replace(/<[^>]+>/g, '')
    .replace(/^\|\s*|\s*\|$/g, '')
    .replace(/^(?:(?:公司|企业)?(?:公司地址|企业地址|法人机构地址|注册地址|办公地址|联系地址|经营地址|住所|所在地|地\s*址)\s*(?:[:：]|为|是|位于)?|位于|坐落于|可到)\s*/, '')
    .replace(/^[:：\s]+/, '')
    .replace(/[，,。]\s*(?:公司人员|法定代表人|注册资本|统一社会信用|所属行业|经营范围).*$/, '')
    .replace(/\s*[（(]怎么走.*$/, '')
    .replace(/(?:乘车路线|来访|欢迎|联\s*系\s*人|联系电话|联系方式|电话|手机|电子邮件|邮箱|邮编).*$/, '')
    .replace(/[，,。；;、）)]+$/, '')
    .trim()
}

/** 展示与去重使用的标准值；证据原文仍保留模型/页面逐字提交的原句。 */
export function canonicalizeLeadValue(kind: LeadContactKind, value: string): string {
  return kind === 'address' ? normalizeAddress(value) : normalize(value)
}

function quoteAround(text: string, index: number, followingLines = 0): string {
  let from = index
  // 联系页常把公司名、联系人、电话、地址拆成相邻多行；保留最多三行上文用于主体归属核验。
  for (let count = 0; count < 4; count += 1) {
    const previous = text.lastIndexOf('\n', Math.max(0, from - 1))
    if (previous < 0) { from = 0; break }
    from = previous
  }
  if (from > 0) from += 1
  let to = text.indexOf('\n', index)
  if (to < 0) to = text.length
  for (let count = 0; count < followingLines && to < text.length; count += 1) {
    const following = text.indexOf('\n', to + 1)
    to = following < 0 ? text.length : following
  }
  const raw = text.slice(from, to).trim()
  if (raw.length <= 360) return raw
  const relative = Math.max(0, index - from)
  return raw.slice(Math.max(0, relative - 220), Math.min(raw.length, relative + 140)).trim()
}

/** 模型的 kind 不可信；最终字段类型必须由值格式与原文标签共同决定。 */
export function classifyLeadValue(value: string, quote = ''): LeadContactKind | undefined {
  const normalized = normalize(value)
  if (EMAIL_FULL.test(normalized) && !NOISE.test(normalized)) return 'email'
  if (PHONE_FULL.test(normalized) && !NOISE.test(normalized)) return 'phone'
  const addressValue = normalizeAddress(normalized)
  const hasAddressLabel = ADDRESS_LABEL.test(`${normalized} ${quote}`)
  if (addressValue.length >= 6
    && addressValue.length <= 100
    && ADDRESS_STRONG_LOCATOR.test(addressValue)
    && (hasAddressLabel || ADDRESS_ADMIN_START.test(addressValue))
    && !ADDRESS_SENTENCE_NOISE.test(addressValue)
    && !ADDRESS_ORGANIZATION_END.test(addressValue)) return 'address'
  if (/^[\u4e00-\u9fff·]{2,4}$/.test(normalized)
    && !CONTACT_BLOCK.test(normalized)
    && /(?:(?:项目|采购|业务|招标)\s*(?:联\s*系\s*人|负责人)|联\s*系\s*人)(?:\s*姓名)?\s*[:：]?\s*[\u4e00-\u9fff·]{2,4}/.test(quote)) return 'contact'
  return undefined
}

export function isLeadValueForKind(kind: LeadContactKind, value: string, quote = ''): boolean {
  return classifyLeadValue(value, quote) === kind
}

function companyAliases(companyName: string): string[] {
  const normalized = normalize(companyName)
  const short = normalized.replace(/(?:股份有限|有限责任|集团有限|集团|有限)公司$/, '')
  return [...new Set([normalized, short].filter((item) => item.length >= 4))]
}

/** 地址除了格式正确，还必须能归属于当前公司，而不是同一页面里的项目地点或别的主体地址。 */
export function isLeadAddressForCompany(point: Pick<LeadContactPoint, 'companyName' | 'value' | 'evidenceQuote' | 'sources'>): boolean {
  if (!isLeadValueForKind('address', point.value, point.evidenceQuote)) return false
  if (!ADDRESS_LABEL.test(point.evidenceQuote)) return false
  const escaped = normalize(point.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 施工企业名出现在同一条记录里，不代表“建设地址/项目地址”是该企业办公地址。
  if (new RegExp(`(?:建设|项目|工程|施工|开标|采购人|招标人)地址\\s*[:：]?\\s*${escaped}`).test(normalize(point.evidenceQuote))) return false
  if (hasOnlyInjectedContactSources(point)) return false
  return hasCompanyAssociation(point)
}

const POINT_LABELS: Record<Exclude<LeadContactKind, 'address'>, RegExp> = {
  contact: /(?:(?:项目|采购|业务|招标)\s*(?:联\s*系\s*人|负责人)|联\s*系\s*人)(?:\s*姓名)?\s*[:：]?/,
  email: /(?:电子邮箱|联系邮箱|邮箱|邮件|email)\s*[:：]?/i,
  phone: /(?:联系电话|联系手机|联系方式|电话|手机|总机)\s*[:：]?/,
}
// 第三方招标聚合站常在企业页面末尾放自己的销售/会员客服。即使同一页出现目标公司名，
// 这些值也不属于目标公司，必须整段剔除。
const POINT_CONTEXT_NOISE = /(?:版权联系|版权邮箱|投稿邮箱|新闻热线|举报邮箱|网站邮箱|网站客服|客服邮箱|仅供正式会员查看|权限不能浏览|办理入网|联系工作人员|欢迎拨打手机\s*[/／]\s*微信同号)/
/** 已由真实结果确认会把平台销售客服注入企业页的聚合站；只禁其联系方式，不否定其公告线索。 */
const CONTACT_INJECTION_HOSTS = ['bidnews.cn', 'zbytb.com']

function sourceInjectsPlatformContacts(source: Pick<LeadContactSourceRef, 'pageUrl'>): boolean {
  if (!source.pageUrl) return false
  try {
    const host = new URL(source.pageUrl).hostname.toLowerCase().replace(/^www\./, '')
    return CONTACT_INJECTION_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

function hasOnlyInjectedContactSources(point: Pick<LeadContactPoint, 'sources'>): boolean {
  return point.sources.length > 0 && point.sources.every(sourceInjectsPlatformContacts)
}

function hasCompanyAssociation(point: Pick<LeadContactPoint, 'companyName' | 'value' | 'evidenceQuote' | 'sources'>): boolean {
  const aliases = companyAliases(point.companyName)
  const quote = normalize(point.evidenceQuote)
  const valueIndex = quote.indexOf(normalize(point.value))
  const companyBeforeValue = aliases.some((alias) => {
    const index = quote.indexOf(alias)
    return index >= 0 && valueIndex >= index && valueIndex - index <= 180
  })
  const companyOwnedSource = point.sources.some((source) => {
    const sourceIdentity = normalize(`${source.title} ${source.publisher}`)
    return aliases.some((alias) => sourceIdentity.includes(alias))
  })
  return companyBeforeValue || companyOwnedSource
}

/** 四类获客字段都必须有类型标签与当前公司归属，避免新闻页脚邮箱或同页其他主体串入。 */
export function isLeadPointForCompany(point: Pick<LeadContactPoint, 'companyName' | 'kind' | 'value' | 'evidenceQuote' | 'sources'>): boolean {
  if (!isLeadValueForKind(point.kind, point.value, point.evidenceQuote)) return false
  if (POINT_CONTEXT_NOISE.test(point.evidenceQuote)) return false
  if (point.kind === 'address') return isLeadAddressForCompany(point)
  if (!POINT_LABELS[point.kind].test(point.evidenceQuote)) return false
  if (hasOnlyInjectedContactSources(point)) return false
  return hasCompanyAssociation(point)
}

export function extractLeadContacts(input: { text: string; companyName: string; source: LeadContactSourceRef }): LeadContactPoint[] {
  const { text, companyName, source } = input
  if (!text || !companyName) return []
  const out = new Map<string, LeadContactPoint>()
  const push = (kind: LeadContactKind, raw: string, evidenceQuote: string) => {
    const value = canonicalizeLeadValue(kind, raw)
    if (kind !== 'contact' && value.length < 5) return
    if (NOISE.test(value)) return
    if (!isLeadValueForKind(kind, value, evidenceQuote)) return
    const normalized = normalize(value)
    const key = `${kind}:${normalized}`
    const existing = out.get(key)
    if (existing) {
      if (!existing.sources.some((item) => item.title === source.title && item.pageUrl === source.pageUrl)) existing.sources.push(source)
      return
    }
    const point = { companyName, kind, value, normalized, evidenceQuote, sources: [source] }
    if (!isLeadPointForCompany(point)) return
    out.set(key, point)
  }
  for (const match of text.matchAll(EMAIL)) push('email', match[0], quoteAround(text, match.index ?? 0))
  for (const match of text.matchAll(PHONE)) push('phone', match[0], quoteAround(text, match.index ?? 0))
  for (const match of text.matchAll(LABELED_ADDRESS)) push('address', match[1].trim(), quoteAround(text, match.index ?? 0))
  for (const match of text.matchAll(CONTACT)) {
    // 联系人姓名常在电话 / 邮箱上一行；只为联系人向后保留两行，既能绑定触达方式，
    // 又避免把整页无关号码混进证据。
    const quote = quoteAround(text, match.index ?? 0, 2)
    for (const name of match[1].split(/\s*[、,，/]\s*/)) {
      if (CONTACT_BLOCK.test(name)) continue
      push('contact', name, quote)
    }
  }
  return [...out.values()]
}

/** 一个公司的多条来源一起抽，按 kind 归并、同值合并来源。 */
export function collectLeadContacts(input: {
  companyName: string
  sources: Array<LeadContactSourceRef & { text: string }>
}): Record<LeadContactKind, LeadContactPoint[]> {
  const grouped: Record<LeadContactKind, LeadContactPoint[]> = { email: [], phone: [], address: [], contact: [] }
  for (const entry of input.sources) {
    const ref: LeadContactSourceRef = {
      title: entry.title,
      publisher: entry.publisher,
      tier: entry.tier,
      observedAt: entry.observedAt,
      ...(entry.pageUrl ? { pageUrl: entry.pageUrl } : {}),
    }
    const points = extractLeadContacts({ text: entry.text, companyName: input.companyName, source: ref })
    for (const point of points) {
      const list = grouped[point.kind]
      const same = list.find((item) => item.normalized === point.normalized)
      if (!same) { list.push(point); continue }
      for (const item of point.sources) {
        if (!same.sources.some((known) => known.title === item.title && known.pageUrl === item.pageUrl)) same.sources.push(item)
      }
    }
  }
  return grouped
}


//  获客执行契约（2026-09-18 用户逐条确认） 
// 口径：获客**不独立重搜一套潜在客户**，只消费产业链已经发现的同一批关系节点
//      （甲方关联的以往中标企业 / 上下游供应链 / 代理），每项目最多 7 家；
//      每家按官网 / 工商 / 公告 / 邮箱四个渠道依次检索（字段齐全立即停止）；只有缺字段时才进模型补充轮，每家最多 2 轮
//      （只缺邮箱这类次要字段最多 1 轮）；模型只决定"再查什么"，**值必须逐字来自正文**。
//      联系方式按公司缓存，同一家公司在别的项目里出现时命中 6 小时窗口  0 次新调用。
export const LEAD_SCHEMA_VERSION = 10 as const
export const LEAD_COMPANY_LIMIT = 7
export const LEAD_SUPPLEMENT_ROUNDS = 2
export const LEAD_SUPPLEMENT_ROUNDS_EMAIL_ONLY = 1
/** 抽值只在"公司名字附近"这么多字内进行：同一页面常列多家公司，全页抽取会把别家的电话串过来。 */
export const LEAD_EXTRACT_WINDOW = 800
export const LEAD_BOUNDARY = '获客只消费产业链已经发现的同一批关系节点，再由公开来源补联系人 / 邮箱 / 电话 / 公司地址：每个值都必须逐字来自正文并绑定来源、原文与观察时间，字段类型由本地复核；没有证据证明姓名与联系方式属于同一人时不做配对，抽不到就明确显示未发现，不由模型生成或推测。'

export interface LeadNodeSourceRef {
  evidenceId: string
  title: string
  publisher: string
  pageUrl?: string
  tier: 'official' | 'registry' | 'media'
}

/** 与产业链同一批节点：公司名 + 关系类型 + 关系原句 + 证据来源 + 置信状态。 */
export interface LeadSourceNode {
  id: string
  name: string
  relation: IndustryRelationKind
  relationLabel: string
  relationQuote: string
  confidence: 'confirmed' | 'candidate'
  industry?: string
  sources: LeadNodeSourceRef[]
}

export interface LeadRequest {
  opportunityId: string
  projectTitle: string
  /** 甲方主体名字＝该项目的招标发布主体（与产业链核心节点同一主体），只作列，不作行。 */
  ownerName: string
  industry: string
  nodes: LeadSourceNode[]
}

export interface LeadRow {
  id: string
  name: string
  ownerName: string
  industry?: string
  relation: IndustryRelationKind
  relationLabel: string
  relationQuote: string
  confidence: 'confirmed' | 'candidate'
  /** 四个维度各自独立：抽不到就是空数组，界面显示""。 */
  contact: LeadContactPoint[]
  email: LeadContactPoint[]
  phone: LeadContactPoint[]
  address: LeadContactPoint[]
  sources: LeadNodeSourceRef[]
  requestCount: number
  supplementRounds: number
  missing: LeadContactKind[]
}

export interface LeadResult {
  schemaVersion: typeof LEAD_SCHEMA_VERSION
  inputFingerprint: string
  opportunityId: string
  projectTitle: string
  ownerName: string
  rows: LeadRow[]
  queries: string[]
  requestCount: number
  /** 模型循环实际发生的轮次（不是固定值）：未接模型时必须是 0。 */
  modelCalls: number
  cacheHit: boolean
  checkedAt: string
  gaps: string[]
  boundary: string
}

export type LeadResponse = { ok: true; value: LeadResult } | { ok: false; message: string }

export const LEAD_KIND_LABELS: Record<LeadContactKind, string> = {
  contact: '联系人', email: '邮箱', phone: '电话', address: '地址',
}

/** 每家公司的定向检索：只查公司名 + 联系方式词，泛词会把新闻和无关页面捞上来。 */
export function buildLeadSearchQuery(companyName: string): string {
  return `"${companyName.trim()}" 官网 邮箱 电话 地址`
}

/** 模型不可用时的兜底补充查询（按缺的字段直接拼）。 */
export function buildLeadFallbackEnrichmentQuery(companyName: string, missing: LeadContactKind[]): string {
  const words = missing.map((kind) => (kind === 'contact' ? '联系人' : LEAD_KIND_LABELS[kind])).join(' ')
  return `"${companyName.trim()}" ${words} 官方`.trim()
}

/**
 * 从产业链结果取出这批节点（**不含甲方自己**甲方是表格里的列，不是获客对象）：
 * 官方确认的中标  线索级中标  官方确认的上下游  线索级上下游，最多 LEAD_COMPANY_LIMIT 家。
 */
export function buildLeadNodes(result: IndustryChainResult): LeadSourceNode[] {
  const toNode = (company: IndustryChainResult['winners'][number]): LeadSourceNode => ({
    id: company.id,
    name: company.name,
    relation: company.relation,
    relationLabel: RELATION_LABELS[company.relation],
    relationQuote: company.relationQuote,
    confidence: company.confidence,
    ...(company.industryField ? { industry: company.industryField } : {}),
    sources: company.sources.map((source) => ({
      evidenceId: source.evidenceId, title: source.title, publisher: source.publisher,
      ...(source.pageUrl ? { pageUrl: source.pageUrl } : {}), tier: source.tier,
    })),
  })
  const rank = (company: { relation: IndustryRelationKind; confidence: string }) => {
    const winner = company.relation === 'historical-winner' ? 0 : 1
    return winner * 2 + (company.confidence === 'confirmed' ? 0 : 1)
  }
  return [...result.winners, ...result.suppliers]
    .sort((left, right) => rank(left) - rank(right))
    .slice(0, LEAD_COMPANY_LIMIT)
    .map(toNode)
}

/** 产业链节点改变后，旧获客结果必须失效；节点排序变化本身不应造成误失效。 */
export function buildLeadInputFingerprint(input: Pick<LeadRequest, 'ownerName' | 'nodes'>): string {
  const nodes = input.nodes.map((node) => [normalize(node.name), node.relation, node.confidence].join(':')).sort()
  return JSON.stringify([normalize(input.ownerName), nodes])
}

export function missingLeadKinds(points: Record<LeadContactKind, LeadContactPoint[]>): LeadContactKind[] {
  return (['contact', 'email', 'phone', 'address'] as LeadContactKind[]).filter((kind) => points[kind].length === 0)
}

/** 只有邮箱可缺时只给 1 轮：次要字段不值得再花两次调用。 */
export function leadSupplementRoundLimit(missing: LeadContactKind[]): number {
  if (missing.length === 0) return 0
  if (missing.length === 1 && missing[0] === 'email') return LEAD_SUPPLEMENT_ROUNDS_EMAIL_ONLY
  return LEAD_SUPPLEMENT_ROUNDS
}

export function uniqueLeadStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

export function assertLeadRequest(value: unknown): asserts value is LeadRequest {
  const request = value as Partial<LeadRequest> | undefined
  if (!request || typeof request !== 'object'
    || typeof request.opportunityId !== 'string' || request.opportunityId.length === 0
    || typeof request.projectTitle !== 'string' || typeof request.ownerName !== 'string'
    || typeof request.industry !== 'string' || !Array.isArray(request.nodes)) {
    throw new Error('获客请求参数不完整：缺少项目、甲方或产业链节点。')
  }
}

export function isLeadResult(value: unknown): value is LeadResult {
  const result = value as Partial<LeadResult> | undefined
  if (!result || typeof result !== 'object' || result.schemaVersion !== LEAD_SCHEMA_VERSION
    || typeof result.inputFingerprint !== 'string' || typeof result.opportunityId !== 'string'
    || !Array.isArray(result.rows) || typeof result.requestCount !== 'number' || typeof result.modelCalls !== 'number'
    || !Array.isArray(result.gaps)) return false
  const isSource = (source: unknown) => Boolean(source && typeof source === 'object'
    && typeof (source as LeadContactSourceRef).title === 'string'
    && typeof (source as LeadContactSourceRef).publisher === 'string')
  const isPoint = (point: unknown, kind: LeadContactKind) => {
    if (!(point && typeof point === 'object')) return false
    const candidate = point as LeadContactPoint
    return candidate.kind === kind
      && typeof candidate.companyName === 'string'
      && typeof candidate.value === 'string'
      && typeof candidate.normalized === 'string'
      && typeof candidate.evidenceQuote === 'string'
      && isLeadPointForCompany(candidate)
      && Array.isArray(candidate.sources) && candidate.sources.every(isSource)
  }
  return result.rows.every((row) => Boolean(row && typeof row === 'object'
    && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.ownerName === 'string'
    && Array.isArray(row.contact) && row.contact.every((point) => isPoint(point, 'contact'))
    && Array.isArray(row.email) && row.email.every((point) => isPoint(point, 'email'))
    && Array.isArray(row.phone) && row.phone.every((point) => isPoint(point, 'phone'))
    && Array.isArray(row.address) && row.address.every((point) => isPoint(point, 'address'))))
}
