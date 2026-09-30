// 政策链数据契约（对应需求文档 §5.6 / §5 数据流表"政策链"一行）
//
// 两个侧重点（用户 2026-09-16 口径）：
//   1. 政策/预算的"国家 → 地方穿透性"：每一级都要能看出它把钱或任务传给了哪一级，
//      并且只有正文里"点名下級"的句子才算穿透证据，不能靠层级关系推定资金已到某单位。
//   2. 预测必须带依据（五年规划 / 预算下达文件 / 地方实施计划 / 本单位历史采购节奏 /
//      正式采购意向），没有依据就不输出预测——禁止编造时间与文件。
//
// 本文件只放纯函数（无 IO、无 Electron 依赖）：地区解析、三级检索计划、正文信号抽取、
// 预测规则。真实检索与正文读取在 electron/policy-chain-service.ts。
import type { EvidenceRecord } from './evidence-contract.js'

export const POLICY_LEVEL_IDS = ['national', 'provincial', 'municipal'] as const
export type PolicyLevelId = typeof POLICY_LEVEL_IDS[number]

export type PolicyInstrumentKind = 'policy' | 'budget'
export type PolicyConfidence = 'high' | 'medium' | 'low'
/** 来源性质：政府/部委官网原文，还是媒体/聚合站转载（只能作参考）。 */
export type PolicySourceTier = 'official' | 'media'
export type PolicyCertainty = 'confirmed' | 'forecast'
export type PolicyBasisKind =
  | 'five-year-plan'
  | 'budget-document'
  | 'implementation-plan'
  | 'historical-cadence'
  | 'procurement-intent'

export interface PolicyLevelRef {
  id: PolicyLevelId
  label: string
}

export interface PolicyRegion {
  /** 普通省份 = 省/自治区名；直辖市 = 直辖市名。 */
  province?: string
  /** 普通省份 = 地级市；直辖市 = 区县/功能区。 */
  city?: string
  isMunicipality: boolean
  /** 国家 → 省/直辖市 → 市/区县（拿不到的那一级不补造，直接缺席）。 */
  path: PolicyLevelRef[]
  /** 解析不到的地区信息，如实记录，供界面显示"该级未取得"。 */
  gaps: string[]
}

export interface PolicyEvidenceRef {
  evidenceId: string
  title: string
  publisher: string
  pageUrl?: string
  publishedAt?: string
}

export interface PolicyPenetrationLink {
  targetLevelId: PolicyLevelId
  targetLabel: string
  /** 原文中点名下级的句子（穿透证据），不是模型概括。 */
  quote: string
}

export interface PolicyFinding {
  id: string
  levelId: PolicyLevelId
  levelLabel: string
  kind: PolicyInstrumentKind
  title: string
  publisher: string
  documentNumber?: string
  industries: string[]
  instruments: string[]
  effectiveAt?: string
  transmission: string
  penetration: PolicyPenetrationLink[]
  relatedSubjects: string[]
  sources: PolicyEvidenceRef[]
  confidence: PolicyConfidence
  /** 官方原文还是媒体转载；媒体转载只能作参考，不能当政策依据。 */
  sourceTier: PolicySourceTier
}

export interface PolicyPrediction {
  id: string
  label: string
  windowStart: string
  windowEnd: string
  certainty: PolicyCertainty
  basisKind: PolicyBasisKind
  basis: string
  signals: string[]
  confidence: PolicyConfidence
  basisEvidenceIds: string[]
}

export interface PolicyChainRequest {
  opportunityId: string
  projectTitle: string
  companyName: string
  address?: string
  industry: string
  /** 本单位已有阶段证据（用于历史采购节奏推算）。 */
  stageDates?: Array<{ stageId: string; occurredAt: string }>
}

export interface PolicyChainResult {
  opportunityId: string
  subjectName: string
  industry: string
  regionPath: PolicyLevelRef[]
  findings: PolicyFinding[]
  predictions: PolicyPrediction[]
  queries: Array<{ levelId: PolicyLevelId; label: string; query: string }>
  requestCount: number
  cacheHit: boolean
  checkedAt: string
  gaps: string[]
  boundary: string
}

export type PolicyChainResponse =
  | { ok: true; value: PolicyChainResult }
  | { ok: false; message: string }

export const POLICY_CHAIN_BOUNDARY = '政策与预算文件只说明资金或任务的传导方向；除正式采购意向/公告外，其余时间一律是预测性建议，不能当作已确定的招标日期，也不能仅凭上级文件推定资金已到某个招标单位。'

// ── 地区解析（直辖市层级必须正确，拿不到就不补造） ──────────────────────
const MUNICIPALITIES = ['北京市', '上海市', '天津市', '重庆市']
const PROVINCES = [
  '河北省', '山西省', '辽宁省', '吉林省', '黑龙江省', '江苏省', '浙江省', '安徽省', '福建省', '江西省',
  '山东省', '河南省', '湖北省', '湖南省', '广东省', '海南省', '四川省', '贵州省', '云南省', '陕西省',
  '甘肃省', '青海省', '台湾省', '内蒙古自治区', '广西壮族自治区', '西藏自治区', '宁夏回族自治区', '新疆维吾尔自治区',
  '香港特别行政区', '澳门特别行政区',
]

// 真实数据里项目地址经常只写到地级市（"成都市武侯区…"），主体名也只带城市。
// 这里用"省 → 地级市"对照表把省补出来，避免因为地址没写"四川省"就整级不检索。
const PROVINCE_CITIES: Record<string, string[]> = {
  河北省: ['石家庄市', '唐山市', '秦皇岛市', '邯郸市', '邢台市', '保定市', '张家口市', '承德市', '沧州市', '廊坊市', '衡水市'],
  山西省: ['太原市', '大同市', '阳泉市', '长治市', '晋城市', '朔州市', '晋中市', '运城市', '忻州市', '临汾市', '吕梁市'],
  内蒙古自治区: ['呼和浩特市', '包头市', '乌海市', '赤峰市', '通辽市', '鄂尔多斯市', '呼伦贝尔市', '巴彦淖尔市', '乌兰察布市', '兴安盟', '锡林郭勒盟', '阿拉善盟'],
  辽宁省: ['沈阳市', '大连市', '鞍山市', '抚顺市', '本溪市', '丹东市', '锦州市', '营口市', '阜新市', '辽阳市', '盘锦市', '铁岭市', '朝阳市', '葫芦岛市'],
  吉林省: ['长春市', '吉林市', '四平市', '辽源市', '通化市', '白山市', '松原市', '白城市', '延边朝鲜族自治州'],
  黑龙江省: ['哈尔滨市', '齐齐哈尔市', '鸡西市', '鹤岗市', '双鸭山市', '大庆市', '伊春市', '佳木斯市', '七台河市', '牡丹江市', '黑河市', '绥化市', '大兴安岭地区'],
  江苏省: ['南京市', '无锡市', '徐州市', '常州市', '苏州市', '南通市', '连云港市', '淮安市', '盐城市', '扬州市', '镇江市', '泰州市', '宿迁市'],
  浙江省: ['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '衢州市', '舟山市', '台州市', '丽水市'],
  安徽省: ['合肥市', '芜湖市', '蚌埠市', '淮南市', '马鞍山市', '淮北市', '铜陵市', '安庆市', '黄山市', '滁州市', '阜阳市', '宿州市', '六安市', '亳州市', '池州市', '宣城市'],
  福建省: ['福州市', '厦门市', '莆田市', '三明市', '泉州市', '漳州市', '南平市', '龙岩市', '宁德市'],
  江西省: ['南昌市', '景德镇市', '萍乡市', '九江市', '新余市', '鹰潭市', '赣州市', '吉安市', '宜春市', '抚州市', '上饶市'],
  山东省: ['济南市', '青岛市', '淄博市', '枣庄市', '东营市', '烟台市', '潍坊市', '济宁市', '泰安市', '威海市', '日照市', '临沂市', '德州市', '聊城市', '滨州市', '菏泽市'],
  河南省: ['郑州市', '开封市', '洛阳市', '平顶山市', '安阳市', '鹤壁市', '新乡市', '焦作市', '濮阳市', '许昌市', '漯河市', '三门峡市', '南阳市', '商丘市', '信阳市', '周口市', '驻马店市', '济源市'],
  湖北省: ['武汉市', '黄石市', '十堰市', '宜昌市', '襄阳市', '鄂州市', '荆门市', '孝感市', '荆州市', '黄冈市', '咸宁市', '随州市', '恩施土家族苗族自治州'],
  湖南省: ['长沙市', '株洲市', '湘潭市', '衡阳市', '邵阳市', '岳阳市', '常德市', '张家界市', '益阳市', '郴州市', '永州市', '怀化市', '娄底市', '湘西土家族苗族自治州'],
  广东省: ['广州市', '韶关市', '深圳市', '珠海市', '汕头市', '佛山市', '江门市', '湛江市', '茂名市', '肇庆市', '惠州市', '梅州市', '汕尾市', '河源市', '阳江市', '清远市', '东莞市', '中山市', '潮州市', '揭阳市', '云浮市'],
  广西壮族自治区: ['南宁市', '柳州市', '桂林市', '梧州市', '北海市', '防城港市', '钦州市', '贵港市', '玉林市', '百色市', '贺州市', '河池市', '来宾市', '崇左市'],
  海南省: ['海口市', '三亚市', '三沙市', '儋州市'],
  四川省: ['成都市', '自贡市', '攀枝花市', '泸州市', '德阳市', '绵阳市', '广元市', '遂宁市', '内江市', '乐山市', '南充市', '眉山市', '宜宾市', '广安市', '达州市', '雅安市', '巴中市', '资阳市', '阿坝藏族羌族自治州', '甘孜藏族自治州', '凉山彝族自治州'],
  贵州省: ['贵阳市', '六盘水市', '遵义市', '安顺市', '毕节市', '铜仁市', '黔西南布依族苗族自治州', '黔东南苗族侗族自治州', '黔南布依族苗族自治州'],
  云南省: ['昆明市', '曲靖市', '玉溪市', '保山市', '昭通市', '丽江市', '普洱市', '临沧市', '楚雄彝族自治州', '红河哈尼族彝族自治州', '文山壮族苗族自治州', '西双版纳傣族自治州', '大理白族自治州', '德宏傣族景颇族自治州', '怒江傈僳族自治州', '迪庆藏族自治州'],
  西藏自治区: ['拉萨市', '日喀则市', '昌都市', '林芝市', '山南市', '那曲市', '阿里地区'],
  陕西省: ['西安市', '铜川市', '宝鸡市', '咸阳市', '渭南市', '延安市', '汉中市', '榆林市', '安康市', '商洛市'],
  甘肃省: ['兰州市', '嘉峪关市', '金昌市', '白银市', '天水市', '武威市', '张掖市', '平凉市', '酒泉市', '庆阳市', '定西市', '陇南市', '临夏回族自治州', '甘南藏族自治州'],
  青海省: ['西宁市', '海东市', '海北藏族自治州', '黄南藏族自治州', '海南藏族自治州', '果洛藏族自治州', '玉树藏族自治州', '海西蒙古族藏族自治州'],
  宁夏回族自治区: ['银川市', '石嘴山市', '吴忠市', '固原市', '中卫市'],
  新疆维吾尔自治区: ['乌鲁木齐市', '克拉玛依市', '吐鲁番市', '哈密市', '昌吉回族自治州', '博尔塔拉蒙古自治州', '巴音郭楞蒙古自治州', '阿克苏地区', '克孜勒苏柯尔克孜自治州', '喀什地区', '和田地区', '伊犁哈萨克自治州', '塔城地区', '阿勒泰地区', '石河子市'],
}

const CITY_PROVINCE_LOOKUP: Array<[string, string]> = Object.entries(PROVINCE_CITIES)
  .flatMap(([province, cities]) => cities.map((city) => [city, province] as [string, string]))
  .sort((left, right) => right[0].length - left[0].length)

const CITY_PATTERN = /([\u4e00-\u9fff]{2,12}?(?:自治州|地区|盟|市))/

export function parsePolicyRegion(address?: string, companyName?: string): PolicyRegion {
  const text = `${address ?? ''} ${companyName ?? ''}`.replace(/\s+/g, ' ').trim()
  const municipality = MUNICIPALITIES.find((name) => text.includes(name))
  if (municipality) {
    const district = matchAfter(text, municipality, /([\u4e00-\u9fff]{2,10}?(?:新区|经济开发区|高新区|开发区|区|县))/)
    const path: PolicyLevelRef[] = [{ id: 'national', label: '国家级' }, { id: 'provincial', label: municipality }]
    if (district) path.push({ id: 'municipal', label: district })
    return {
      province: municipality, city: district, isMunicipality: true, path,
      gaps: district ? [] : [`未从项目地址中解析出${municipality}的区县/功能区，市级只到${municipality}。`],
    }
  }

  const explicitProvince = PROVINCES.find((name) => text.includes(name))
  const inferred = inferCityProvince(text)
  const province = explicitProvince ?? inferred?.province
  if (!province) {
    return { isMunicipality: false, path: [{ id: 'national', label: '国家级' }], gaps: ['未从项目地址或主体名称中解析出省/直辖市，本次不发起省级与市级检索。'] }
  }
  const city = (explicitProvince ? matchAfter(text, explicitProvince, CITY_PATTERN) : undefined)
    ?? (inferred && inferred.province === province ? inferred.city : undefined)
  const path: PolicyLevelRef[] = [{ id: 'national', label: '国家级' }, { id: 'provincial', label: province }]
  if (city) path.push({ id: 'municipal', label: city })
  return {
    province, city, isMunicipality: false, path,
    gaps: city ? [] : [`未从项目地址中解析出${province}的地级市，本次不发起市级检索。`],
  }
}

function inferCityProvince(text: string): { city: string; province: string } | undefined {
  for (const [city, province] of CITY_PROVINCE_LOOKUP) {
    if (text.includes(city)) return { city, province }
  }
  return undefined
}

function matchAfter(text: string, anchor: string, pattern: RegExp): string | undefined {
  const index = text.indexOf(anchor)
  if (index < 0) return undefined
  const rest = text.slice(index + anchor.length, index + anchor.length + 24)
  const match = rest.match(pattern)
  return match ? match[1] : undefined
}

// ── 三级检索计划（一级一次，术语固定，不把自然语言广播出去） ─────────────
const INDUSTRY_FALLBACK = '本行业'
/** 条件栏里的占位值不算行业，避免出现"国家 不限 政策"这种查询。 */
const INDUSTRY_PLACEHOLDERS = new Set(['', '不限', '其他', '未知', '全部'])

/** 每个行业域对应一个"政策热点词"：真实检索里用它比用行业原词更容易命中国家/省/市三级文件。 */
const FAMILY_POLICY_TERM: Record<string, string> = {
  municipal: '城市更新', building: '老旧小区', transport: '轨道交通', water: '水利',
  energy: '能源', environment: '生态环保', digital: '数字化', education: '教育', health: '医疗',
}

export function buildPolicySearchTargets(request: PolicyChainRequest): Array<{ levelId: PolicyLevelId; label: string; query: string }> {
  const region = parsePolicyRegion(request.address, request.companyName)
  const industry = INDUSTRY_PLACEHOLDERS.has(request.industry.trim()) ? INDUSTRY_FALLBACK : request.industry.trim()
  const currentYear = new Date().getFullYear()
  // 除行业词外带上本域的"政策热点词"：真实端到端证明只写行业词 + 发文机关时，
  // 省级/市级会把大量真政策漏掉（例如"四川省/成都市城市更新"这一条线）。
  const families = new Set<string>()
  for (const [family, trigger] of CATEGORY_TRIGGERS) if (trigger.test(request.industry ?? '')) families.add(family)
  if (families.size === 0) for (const [family, trigger] of CATEGORY_TRIGGERS) if (trigger.test(`${request.projectTitle} ${request.address ?? ''}`)) families.add(family)
  const domainTerm = [...families].map((family) => FAMILY_POLICY_TERM[family]).filter(Boolean).slice(0, 2).join(' ')
  return region.path.map((level) => {
    const scope = level.id === 'national'
      ? `财政部 国家发展改革委 ${industry}`
      : level.id === 'provincial'
        ? `${level.label}财政厅 ${level.label}住房和城乡建设厅 ${industry}`
        : `${level.label}财政局 ${level.label}住房和城乡建设局 ${industry}`
    return {
      levelId: level.id,
      label: level.label,
      query: compact([scope, domainTerm, '资金 下达 通知 管理办法 实施细则', level.id === 'national' ? '五年规划 五年计划' : '实施方案 任务分解', `${currentYear} 最新`]),
    }
  })
}

function compact(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')
}

// ── 正文信号抽取（纯确定性；抽不到就不写，绝不补造） ─────────────────────
export interface PolicyDocumentSignals {
  isPolicyDocument: boolean
  kind: PolicyInstrumentKind
  documentNumber?: string
  publisher?: string
  instruments: string[]
  effectiveAt?: string
  budgetYear?: number
  planNames: string[]
  planWindows: string[]
  penetrationQuotes: string[]
}

const INSTRUMENT_PATTERNS: Array<[string, RegExp]> = [
  ['中央预算内投资', /中央预算内投资/],
  ['地方政府专项债券', /(?:地方政府)?专项债券?/],
  ['超长期特别国债', /超长期特别国债|特别国债/],
  ['财政转移支付', /转移支付/],
  ['财政补助/补贴', /(?:财政)?(?:补助|补贴|奖补|以奖代补)/],
  ['专项资金', /专项资金/],
  ['政府采购预算', /政府采购预算|采购预算/],
  ['项目库/任务清单', /(?:项目库|任务清单|项目清单)/],
  ['试点/示范', /(?:试点|示范)(?:城市|项目|工程)?/],
  ['规划编制', /(?:五年规划|五年计划|规划纲要|专项规划)/],
]

const POLICY_DOC_HINT = /(?:管理办法|实施细则|实施方案|实施意见|指导意见|通知|意见|规划|纲要|决定|公告|预算|资金|额度|目录|指南)/
/** 五年规划的周期是公开固定事实（如"十五五"＝2026—2030年），标题命中规划名时可直接采用。 */
const PLAN_PERIODS: Array<[RegExp, string]> = [
  [/十五五/, '2026—2030年'],
  [/十四五/, '2021—2025年'],
  [/十六五/, '2031—2035年'],
]
// 招标/采购类公告**不是**政策文件。真实端到端里"竞争性磋商公告"曾被当成预算文件抽出来，
// 所以这里按标题强排除：宁可这一级显示"未取得"，也不能把招标公告写成政策依据。
const PROCUREMENT_TITLE = /(招标公告|招标信息|采购公告|竞争性磋商|竞争性谈判|询价|比选|遴选|招选|中标(?:结果|公告|候选人)|成交(?:结果|公告)|评标结果|开标记录|资格预审|投标邀请|合同公告|采购意向)/
const POLICY_TITLE_HINT = /(通知|办法|细则|规划|纲要|实施方案|实施意见|指导意见|决定|批复|若干措施|行动计划|行动方案|工作方案|工作要点|预算|资金|额度|目录|指南|政策|投资|补助|债券|项目计划)/
const ISSUER_HINT = /(部|委|厅|局|政府|财政|发展改革|管委会|办公室|人民银行|税务总局)/

export function isPolicyDocumentTitle(title: string): boolean {
  if (PROCUREMENT_TITLE.test(title)) return false
  return POLICY_TITLE_HINT.test(title) && ISSUER_HINT.test(title)
}

// ── 行业域关键词族（放宽门禁的关键） ─────────────────────────────────────
// 原来的相关性判定是"正文里必须出现行业原词"，实测把真政策全拦掉了：
// "财政部关于下达2026年城市管网及污水处理补助资金预算的通知"、"国务院关于印发《城市更新
// “十五五”规划》的通知"这类文件正文根本不会写"市政基础设施"这四个字。
// 现在改成域关键词族命中任一即算相关；招标公告仍由标题级排除挡在外面。
const DOMAIN_LEXICON: Record<string, string[]> = {
  municipal: ['市政', '城市更新', '管网', '地下管网', '综合管廊', '海绵城市', '道路', '桥梁', '隧道', '排水', '供水', '污水', '燃气', '供热', '环卫', '园林', '绿化', '城市管理', '公用事业', '基础设施', '城市建设', '基础设施配套', '社区', '小区'],
  building: ['房屋建筑', '建筑工程', '建筑业', '住宅', '保障性住房', '老旧小区', '棚户区', '公共建筑', '安置房', '房建'],
  transport: ['交通', '公路', '铁路', '机场', '港口', '轨道交通', '城市轨道', '地铁', '停车'],
  water: ['水利', '防洪', '河道', '水资源', '水土保持', '水库'],
  energy: ['能源', '电力', '电网', '光伏', '风电', '充电桩', '储能'],
  environment: ['环保', '生态环境', '环境治理', '垃圾', '固废', '大气', '水污染', '土壤'],
  digital: ['信息化', '智能化', '弱电', '智慧', '数字化', '数据中心', '安防', '通信', '网络', '软件', '智能'],
  education: ['教育', '学校', '幼儿园', '职业院校', '高校'],
  health: ['医院', '医疗', '卫生', '疾控', '养老'],
}
const CATEGORY_TRIGGERS: Array<[string, RegExp]> = [
  ['municipal', /(市政|道路|桥梁|排水|供水|污水|燃气|供热|环卫|园林|绿化|城市更新|基础设施|管网|公用|城建|社区|小区)/],
  ['building', /(房建|房屋建筑|建筑|住宅|住房|棚户|安置)/],
  ['transport', /(交通|公路|铁路|机场|港口|轨道|地铁|停车)/],
  ['water', /(水利|防洪|河道|水资源|水库)/],
  ['energy', /(能源|电力|电网|光伏|风电|充电|储能)/],
  ['environment', /(环保|生态|环境|垃圾|固废|污染)/],
  ['digital', /(信息化|智能化|弱电|智慧|数字化|数据|安防|通信|网络|软件)/],
  ['education', /(教育|学校|幼儿园|院校)/],
  ['health', /(医院|医疗|卫生|养老)/],
]
/** 明显不属于本次范围的领域词：只有同时命中域关键词时才接受（避免把农业/以工代赈资金当市政政策）。 */
const OUT_OF_SCOPE_HINT = /(农业|农村|以工代赈|生态保护修复|林业|畜牧|渔业)/
/** 栏目列表页 / 门户首页 / 办事入口不是政策文件本身，直接排除（真实验证里出现过"列表-成都市人民政府"）。 */
const LISTING_PAGE_HINT = /(列表|搜索结果|信息公开目录|信息公示目录|政务公开目录|办事指南|一站式|门户网站|网站首页|平台首页)/
const LISTING_URL_HINT = /(zcwjk_search|search\.shtml|list\.shtml|openinfo\.html)/

export function isPolicyListingPage(title: string, url: string | undefined): boolean {
  return isPolicyJunkTitle(title) || LISTING_PAGE_HINT.test(title) || LISTING_URL_HINT.test(url ?? '')
}

/** 标题是裸域名/过短（抓取失败或聚合站占位）时不能当政策文件。 */
export function isPolicyJunkTitle(title: string): boolean {
  const trimmed = title.trim()
  if (trimmed.length < 6) return true
  return !/[\u4e00-\u9fff]/.test(trimmed)
}

/** 房地产/公积金/楼市类文件：只有同时命中"建设类强词"才接受（放宽门禁后实测漏进来的噪声）。 */
const NEGATIVE_DOMAIN_HINT = /(公积金|楼市|购房|房票|房地产市场|商品房|二手房|房贷|人才优租)/
const STRONG_BUILD_HINT = /(市政|城市更新|管网|综合管廊|海绵城市|道路|桥梁|隧道|排水|供水|污水|燃气|供热|环卫|园林|绿化|城市管理|公用事业|轨道交通|地铁|建筑工程|房建|老旧小区|基础设施配套)/

/** 由行业的域关键词族 + 项目名里命中的域词组成"相关性词表"。 */
export function policyScopeKeywords(input: { industry?: string; projectTitle?: string; address?: string }): string[] {
  const text = [input.industry ?? '', input.projectTitle ?? '', input.address ?? ''].join(' ')
  const families = new Set<string>()
  for (const [family, trigger] of CATEGORY_TRIGGERS) {
    if (trigger.test(input.industry ?? '')) families.add(family)
  }
  if (families.size === 0) {
    for (const [family, trigger] of CATEGORY_TRIGGERS) {
      if (trigger.test(text)) families.add(family)
    }
  }
  const keywords = new Set<string>()
  for (const family of families) for (const word of DOMAIN_LEXICON[family] ?? []) keywords.add(word)
  // 项目名里出现过的域词也算（例如项目名写了"地铁保护监测"）。
  for (const words of Object.values(DOMAIN_LEXICON)) {
    for (const word of words) if ((input.projectTitle ?? '').includes(word)) keywords.add(word)
  }
  const industry = (input.industry ?? '').trim()
  if (!INDUSTRY_PLACEHOLDERS.has(industry)) keywords.add(industry)
  return [...keywords]
}

/** 相关性判定：标题 + 正文前 1500 字里命中任一域关键词即可；明显跨领域的单据只在命中域词时接受。 */
export function matchesPolicyScope(title: string, text: string, keywords: string[]): boolean {
  if (isPolicyJunkTitle(title)) return false
  if (keywords.length === 0) return true
  const haystack = `${title}\n${text.slice(0, 1500)}`
  const hits = keywords.filter((word) => word.length >= 2 && haystack.includes(word))
  if (hits.length === 0) return false
  if (OUT_OF_SCOPE_HINT.test(haystack) && !hits.some((word) => !OUT_OF_SCOPE_HINT.test(word))) return false
  // 房地产/公积金/楼市类：只要标题与开头 300 字都在讲房子，就不算与本次市政项目相关
  // （放宽门禁后实测漏进来的噪声；正文后段随便提到"城市更新"不能把它救回来）。
  const lead = `${title}\n${text.slice(0, 300)}`
  if (NEGATIVE_DOMAIN_HINT.test(lead) && !STRONG_BUILD_HINT.test(lead)) return false
  return true
}

export function readPolicySignals(text: string, lowerLabels: string[], industry: string, title = ''): PolicyDocumentSignals {
  const body = text.replace(/\r/g, '')
  const lead = body.slice(0, 240)
  const instruments = INSTRUMENT_PATTERNS.filter(([, pattern]) => pattern.test(body)).map(([label]) => label)
  // 中文引号常夹在中间（《四川省“十五五”规划纲要》），这里允许引号与空白。
  const planNames = uniqueStrings([...body.matchAll(/([\u4e00-\u9fff]{1,3}五|十四五|十五五|十六五)[”"'\s]{0,2}(?:规划|计划|时期)/g)].map((match) => match[0]))
  const planWindows = uniqueStrings([...body.matchAll(/(20\d{2})\s*[年\-—~至到]+\s*(20\d{2})\s*年?/g)].map((match) => `${match[1]}—${match[2]}年`))
  // 文号只在开头找，且要有明确边界：媒体转载页会把上一条文号黏在正文里
  // （实测抽出过"息政策有关事项的通知财金〔2026〕1号"这种粘连片段）。
  const documentNumber = body.slice(0, 600).match(/(?:^|[\s：:>《（(])([\u4e00-\u9fff]{2,8}(?:部|委|厅|局|办|署)?\s*〔20\d{2}〕\s*\d+\s*号)/)?.[1]?.trim()
  const publisher = body.slice(0, 600).match(/(?:发布(?:机关|单位|机构)|来源|来源单位|印发单位)\s*[:：]\s*([^\n。；;，,]{2,40})/)?.[1]?.trim()
  const dates = [...body.matchAll(/(?:发布日期|发布时间|印发日期|执行(?:日期|时间)|实施(?:日期|时间)|生效(?:日期|时间)|自)\s*[:：为]?\s*(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})?/g)]
    .map((match) => normalizeDateParts(match[1], match[2], match[3]))
    .filter((value): value is string => Boolean(value))
  // "下发2026年度地方政府专项债券额度" 这类写法中间会夹定语，允许 12 个字的间隔。
  const budgetYear = Number(body.match(/(20\d{2})\s*年(?:度)?[^\n。；]{0,12}?(?:财政预算|预算|专项资金|专项债券|中央预算内投资)/)?.[1] ?? '') || undefined
  const penetrationQuotes = lowerLabels
    .filter((label) => label && label !== '国家级')
    .flatMap((label) => sentencesMentioning(body, label))
    .slice(0, 3)

  // 标题里写明的五年规划名（《…“十五五”规划…》）是最可靠的规划期依据：
  // 正文常常只有解读，拿不到"2026—2030年"这种区间，这里用公开固定的规划周期补上。
  const titlePlan = PLAN_PERIODS.find(([pattern]) => pattern.test(title))
  const planLabel = titlePlan ? (titlePlan[0].source === '十五五' ? '十五五规划' : titlePlan[0].source === '十四五' ? '十四五规划' : '十六五规划') : undefined
  const resolvedPlanNames = uniqueStrings([...planNames, ...(planLabel ? [planLabel] : [])])
  const resolvedPlanWindows = planWindows.length > 0
    ? planWindows
    : (titlePlan && /(规划|计划|纲要)/.test(title) ? [titlePlan[1]] : [])

  const titleIsPolicy = title.length > 0 && isPolicyDocumentTitle(title)
  const bodyLooksPolicy = POLICY_DOC_HINT.test(lead) && ISSUER_HINT.test(lead) && !PROCUREMENT_TITLE.test(lead)

  return {
    isPolicyDocument: titleIsPolicy || bodyLooksPolicy,
    kind: instruments.some((item) => /预算|资金|债券|国债|转移支付|补助|补贴|专项/.test(item)) ? 'budget' : 'policy',
    documentNumber,
    publisher,
    instruments,
    effectiveAt: dates.at(-1),
    budgetYear,
    planNames: resolvedPlanNames,
    planWindows: resolvedPlanWindows,
    penetrationQuotes,
  }
}

function sentencesMentioning(text: string, keyword: string): string[] {
  return text
    .split(/[\n。；;]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 160 && sentence.includes(keyword))
}

function normalizeDateParts(year: string, month: string, day?: string): string | undefined {
  const y = Number(year)
  const m = Number(month)
  const d = day ? Number(day) : 1
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/** 政府/部委官网原文 vs 媒体或聚合站转载：只有官方原文能当政策依据。 */
export function policySourceTier(pageUrl: string | undefined, publisher: string): PolicySourceTier {
  const host = safeHost(pageUrl)
  const mediaPublisher = /(头条|新浪|网易|搜狐|腾讯|百度|微博|知乎|百家号|采招网|建筑网|资讯|快报|财经网|自媒体)/
  if (/(^|\.)gov\.cn$/.test(host)) return mediaPublisher.test(publisher) ? 'media' : 'official'
  if (/(部|委|厅|局|政府|管委会|财政|发展改革|人民银行)/.test(publisher) && !mediaPublisher.test(publisher)) return 'official'
  return 'media'
}

function safeHost(pageUrl: string | undefined): string {
  if (!pageUrl) return ''
  try {
    return new URL(pageUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// ── 预测规则（有依据才出预测；没有依据就不出） ─────────────────────────
export interface PolicyPredictionInput {
  documents: Array<{
    levelId: PolicyLevelId
    levelLabel: string
    evidenceId: string
    title: string
    publisher: string
    signals: PolicyDocumentSignals
  }>
  stageDates: Array<{ stageId: string; occurredAt: string }>
  industry: string
  now?: Date
}

const STAGE_LABELS: Record<string, string> = {
  initiation: '立项/备案', intention: '采购意向/招标计划', tender: '招标公告', evaluation: '开标评标',
  candidate: '中标候选人公示', award: '中标/成交结果', contract: '合同公告',
}

export function buildPolicyPredictions(input: PolicyPredictionInput): PolicyPrediction[] {
  const now = input.now ?? new Date()
  const predictions: PolicyPrediction[] = []
  const planBasis = input.documents.filter((document) => document.signals.planNames.length > 0 || document.signals.planWindows.length > 0)

  // 规则 1：正式采购意向/招标计划里写明的日期 —— 这是"确定节点"（不是预测）。
  for (const document of input.documents) {
    if (!/(?:采购意向|招标计划|采购计划)/.test(document.title + document.title)) continue
    const explicit = document.signals.effectiveAt
    if (!explicit) continue
    predictions.push({
      id: `confirmed-${document.evidenceId}`,
      label: `${document.levelLabel}已公开的采购意向/招标计划`,
      windowStart: explicit.slice(0, 7), windowEnd: explicit.slice(0, 7),
      certainty: 'confirmed', basisKind: 'procurement-intent',
      basis: `正式公开文件《${document.title}》写明的日期（${explicit}）。`,
      signals: ['跟踪该采购意向是否转为正式招标公告'],
      confidence: 'high', basisEvidenceIds: [document.evidenceId],
    })
  }

  // 规则 2：预算年度文件 → 下一年度同一周期的资金窗口。
  const budgetDocuments = input.documents.filter((document) => document.signals.budgetYear !== undefined)
  for (const document of budgetDocuments) {
    const year = document.signals.budgetYear as number
    const month = (document.signals.effectiveAt ?? `${year}-01-01`).slice(5, 7)
    const start = `${year + 1}-${month}`
    predictions.push({
      id: `budget-${document.evidenceId}`,
      label: '下一预算年度的资金下达/申报窗口',
      windowStart: start, windowEnd: start,
      certainty: 'forecast', basisKind: 'budget-document',
      basis: `依据${document.levelLabel}《${document.title}》的${year}年度预算口径，按年度周期顺延一年。`,
      signals: [`观察${year + 1}年度同类资金文件是否在同月下达`],
      confidence: planBasis.length > 0 ? 'medium' : 'low',
      basisEvidenceIds: [document.evidenceId, ...planBasis.map((item) => item.evidenceId)].slice(0, 3),
    })
  }

  // 规则 3：本单位历史采购节奏（同一阶段 ≥2 次有日期的证据）→ 下一同类节点窗口。
  const byStage = new Map<string, string[]>()
  for (const item of input.stageDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt)) continue
    byStage.set(item.stageId, [...(byStage.get(item.stageId) ?? []), item.occurredAt])
  }
  for (const [stageId, dates] of byStage) {
    const sorted = [...dates].sort()
    if (sorted.length < 2) continue
    const months = sorted.slice(1).map((value, index) => monthDiff(sorted[index], value)).filter((value) => value > 0)
    if (months.length === 0) continue
    const cadence = Math.round(months.reduce((sum, value) => sum + value, 0) / months.length)
    if (cadence < 1 || cadence > 60) continue
    const next = addMonths(sorted.at(-1) as string, cadence)
    predictions.push({
      id: `cadence-${stageId}`,
      label: `下一次「${STAGE_LABELS[stageId] ?? stageId}」同类节点`,
      windowStart: next, windowEnd: addMonths(`${next}-01`, 1).slice(0, 7),
      certainty: 'forecast', basisKind: 'historical-cadence',
      basis: `本单位历史记录里「${STAGE_LABELS[stageId] ?? stageId}」出现 ${sorted.length} 次（${sorted.join('、')}），平均间隔约 ${cadence} 个月。`,
      signals: ['该主体是否发布新的采购意向或更正公告'],
      confidence: sorted.length >= 3 ? 'medium' : 'low',
      basisEvidenceIds: [],
    })
  }

  // 规则 4：五年规划/规划期证据 → "规划期内"的窗口。
  // 只要拿到规划期证据就单独给一条（不再只在"没有任何预测"时才给）：用户明确要求
  // 预测要看得见五年计划这类依据。
  if (planBasis.length > 0) {
    const window = planBasis[0].signals.planWindows[0]
    const planName = planBasis[0].signals.planNames[0] ?? '五年规划'
    if (window && /^\d{4}—\d{4}年$/.test(window)) {
      const [startYear, endYear] = window.replace('年', '').split('—').map(Number)
      const anchorYear = Math.min(Math.max(now.getFullYear() + 1, startYear), endYear)
      predictions.push({
        id: `plan-${planBasis[0].evidenceId}`,
        label: `${planName}期内的项目安排窗口`,
        windowStart: `${anchorYear}-01`, windowEnd: `${anchorYear}-12`,
        certainty: 'forecast', basisKind: 'five-year-plan',
        basis: `依据${planBasis[0].levelLabel}《${planBasis[0].title}》的规划期（${window}；五年规划的周期是公开固定事实）；规划期内按年度滚动安排，具体月份仍需预算或采购文件确认。`,
        signals: ['下一份年度预算/专项资金文件', '该主体的采购意向公开'],
        confidence: 'low',
        basisEvidenceIds: planBasis.map((item) => item.evidenceId).slice(0, 3),
      })
    }
  }

  // 同年同窗口的预测合并成一条（真实跑一次会出现多条"下一预算年度…2027-01"，明显重复）。
  const merged = new Map<string, PolicyPrediction>()
  for (const prediction of predictions) {
    const key = `${prediction.basisKind}:${prediction.windowStart}`
    const existing = merged.get(key)
    if (!existing) { merged.set(key, prediction); continue }
    const winner = rank(existing) >= rank(prediction) ? existing : prediction
    const other = winner === existing ? prediction : existing
    merged.set(key, {
      ...winner,
      signals: [...new Set([...winner.signals, ...other.signals])].slice(0, 3),
      basisEvidenceIds: [...new Set([...winner.basisEvidenceIds, ...other.basisEvidenceIds])].slice(0, 4),
      confidence: winner.confidence === 'high' || other.confidence === 'high'
        ? winner.confidence
        : (winner.confidence === 'medium' || other.confidence === 'medium' ? 'medium' : winner.confidence),
    })
  }
  const ordered = [...merged.values()]
    .sort((left, right) => rank(right) - rank(left) || left.windowStart.localeCompare(right.windowStart))
  // 用户明确要求"预测要看得见五年计划这类依据"，所以规划期预测保底占一席，不被资金窗口挤掉。
  const planEntry = ordered.find((prediction) => prediction.basisKind === 'five-year-plan')
  const top = ordered.filter((prediction) => prediction !== planEntry).slice(0, planEntry ? 2 : 3)
  return planEntry ? [...top, planEntry] : top
}

/** 预测排序权重：确定节点 > 资金/预算依据 > 历史节奏 > 规划期。 */
function rank(prediction: PolicyPrediction): number {
  const certaintyScore = prediction.certainty === 'confirmed' ? 100 : 0
  const kindScore = prediction.basisKind === 'procurement-intent' ? 40
    : prediction.basisKind === 'budget-document' ? 30
      : prediction.basisKind === 'historical-cadence' ? 20 : 10
  const evidenceScore = Math.min(prediction.basisEvidenceIds.length, 3) * 2
  return certaintyScore + kindScore + evidenceScore
}

function monthDiff(from: string, to: string): number {
  const left = Date.parse(`${from}T00:00:00Z`)
  const right = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(left) || Number.isNaN(right)) return 0
  return Math.round((right - left) / (30 * 24 * 60 * 60 * 1000))
}

function addMonths(month: string, count: number): string {
  const [year, value] = month.slice(0, 7).split('-').map(Number)
  const total = year * 12 + (value - 1) + count
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

// ── 校验 ────────────────────────────────────────────────────────────────
export function assertPolicyChainRequest(value: unknown): asserts value is PolicyChainRequest {
  if (!isRecord(value)
    || !isText(value.opportunityId, 200)
    || !isText(value.projectTitle, 300)
    || !isText(value.companyName, 160)
    || (value.address !== undefined && !isText(value.address, 200))
    || !isText(value.industry, 80)
    || (value.stageDates !== undefined && (!Array.isArray(value.stageDates)
      || value.stageDates.length > 40
      || !value.stageDates.every((item) => isRecord(item) && isText(item.stageId, 40) && isText(item.occurredAt, 40))))) {
    throw new Error('政策链请求参数不完整或超出当前支持范围。')
  }
}

export function isPolicyChainResult(value: unknown): value is PolicyChainResult {
  if (!isRecord(value)) return false
  return typeof value.opportunityId === 'string'
    && typeof value.subjectName === 'string'
    && Array.isArray(value.findings)
    && Array.isArray(value.predictions)
    && Array.isArray(value.regionPath)
    && (value.requestCount === 0 || value.requestCount === 1 || value.requestCount === 2 || value.requestCount === 3)
    && typeof value.checkedAt === 'string'
}

export function policyEvidenceRef(record: EvidenceRecord): PolicyEvidenceRef {
  return {
    evidenceId: record.id,
    title: record.title,
    publisher: record.provenance.publisher,
    ...(record.provenance.pageUrl ? { pageUrl: record.provenance.pageUrl } : {}),
    ...(record.provenance.publishedAt ? { publishedAt: record.provenance.publishedAt } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}
