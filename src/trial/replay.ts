/** Historical, source-bound replay for the offline trial. Never a live search result. */
import { POLICY_CHAIN_BOUNDARY, type PolicyChainResult } from '../../shared/policy-chain'
import { INDUSTRY_CHAIN_BOUNDARY, INDUSTRY_CHAIN_SCHEMA_VERSION, type IndustryChainResult, type IndustrySourceRef } from '../../shared/industry-chain'
import { CREDIT_RISK_BOUNDARY, type CreditRiskResult } from '../../shared/credit-risk'
import { LEAD_BOUNDARY, LEAD_SCHEMA_VERSION, buildLeadInputFingerprint, buildLeadNodes, missingLeadKinds, type LeadContactPoint, type LeadResult, type LeadRow } from '../../shared/lead-contacts'
import { TRIAL_CASES } from './cases'

const YUEHU = 'trial-yuehu-monitoring'
const JINLING = 'trial-jinling-installation'
const CAPTURED = '2026-09-17T09:40:45.252Z'
const REPLAYED = '2026-09-24T00:00:00.000Z'
const owner = '成都市武侯区智慧宜居建设开发有限公司'
const yuehuNotice = 'https://www.cdwh.gov.cn/wuhou/c180402/2026-09/08/content_8dac2c338bd44c37939b89ccbc7ffd6c.shtml'
const jinlingReport = 'https://finance.sina.com.cn/stock/aigc/zab/2026-01-28/doc-inhivfch5100133.shtml'
const caseFor = (id: string) => TRIAL_CASES.find((item) => `trial-${item.id}` === id)
const industrySource = (id: string, title: string, pageUrl: string, tier: IndustrySourceRef['tier'], publisher: string): IndustrySourceRef => ({ evidenceId: id, title, pageUrl, tier, publisher })

export function trialPolicyResult(opportunityId: string): PolicyChainResult | undefined {
  const item = caseFor(opportunityId)
  if (!item) return undefined
  const isYuehu = opportunityId === YUEHU
  return {
    opportunityId, subjectName: item.subject, industry: item.title,
    regionPath: [{ id: 'national', label: '国家级' }, { id: 'provincial', label: isYuehu ? '四川省' : '江苏省' }, { id: 'municipal', label: isYuehu ? '成都市' : '南京市' }],
    findings: isYuehu ? [
      { id: 'trial-policy-national', levelId: 'national', levelLabel: '国家级', kind: 'policy', title: '积极发挥财政职能作用 推动城市更新工作', publisher: '中国政府网', industries: ['城市更新'], instruments: ['中央预算内投资等支持方向'], transmission: '说明城市更新的财政支持方向，未点名本项目或甲方。', penetration: [], relatedSubjects: [], sources: [{ evidenceId: 'trial-policy-national', title: '积极发挥财政职能作用 推动城市更新工作', publisher: '中国政府网', pageUrl: 'https://www.gov.cn/zccfh/2026nzccfh/20260608/jdzc/202606/content_7071441.htm' }], confidence: 'medium', sourceTier: 'official' },
      { id: 'trial-policy-sichuan', levelId: 'provincial', levelLabel: '四川省', kind: 'policy', title: '聚焦四个方面 四川财政持续支持城市更新', publisher: '四川省财政厅', industries: ['城市更新'], instruments: ['城市更新支持'], transmission: '文件提到四川省城市更新支持及成都申报情况，未证明资金拨付给本甲方。', penetration: [{ targetLevelId: 'municipal', targetLabel: '成都市', quote: '2024年、2025年，分别指导成都市、宜宾市成功申报全国城市更新行动城市' }], relatedSubjects: [], sources: [{ evidenceId: 'trial-policy-sichuan', title: '聚焦四个方面 四川财政持续支持城市更新', publisher: '四川省财政厅', pageUrl: 'https://czt.sc.gov.cn/scczt/c102358/2026/1/15/47f0a5487c24442b9ccf00da5303a569.shtml' }], confidence: 'medium', sourceTier: 'official' },
      { id: 'trial-policy-chengdu', levelId: 'municipal', levelLabel: '成都市', kind: 'policy', title: '成都：构建四级规划实施体系，一体化推进城市更新', publisher: '成都市规划和自然资源局', industries: ['城市更新'], instruments: ['规划实施'], transmission: '市级规划背景；不能据此推出本项目下一次采购时间。', penetration: [], relatedSubjects: [], sources: [{ evidenceId: 'trial-policy-chengdu', title: '成都：构建四级规划实施体系，一体化推进城市更新', publisher: '成都市规划和自然资源局', pageUrl: 'https://mpnr.chengdu.gov.cn/ghhzrzyj/xhyd/2026-01/30/content_a591587a279049a39cf7cad6f693c644.shtml' }], confidence: 'medium', sourceTier: 'official' },
    ] : [],
    predictions: [], queries: [], requestCount: 0, cacheHit: true, checkedAt: isYuehu ? CAPTURED : REPLAYED,
    gaps: isYuehu ? ['未取得点名本甲方的资金拨付或下一采购意向，不能给出下一招标日期。'] : ['本历史案例没有完成专项政策与预算检索，不能补造政策影响或预测。'],
    boundary: `离线历史回放（资料采集于${isYuehu ? '2026-09-17' : '2026-09-23'}），本次未联网。${POLICY_CHAIN_BOUNDARY}`,
  }
}

export function trialIndustryResult(opportunityId: string): IndustryChainResult | undefined {
  const item = caseFor(opportunityId)
  if (!item) return undefined
  const isYuehu = opportunityId === YUEHU
  const primary = industrySource('trial-yuehu-notice', item.title, yuehuNotice, 'official', '成都市武侯区人民政府')
  const media = industrySource('trial-jinling-report', item.title, jinlingReport, 'media', '新浪财经转载')
  return {
    schemaVersion: INDUSTRY_CHAIN_SCHEMA_VERSION, opportunityId, projectTitle: item.title,
    owner: { name: item.subject, sources: [isYuehu ? primary : media] },
    winners: isYuehu ? [
      { id: 'trial-winner-zhengze', name: '四川正则工程咨询股份有限公司', relation: 'historical-winner', relationQuote: '成交供应商：四川正则工程咨询股份有限公司', sources: [industrySource('trial-zhengze', '悦湖片区相关采购成交公告', 'https://www.cdwh.gov.cn/wuhou/c180402/2026-07/20/content_775939eaa04640cea229f71c914c7f10.shtml', 'official', '成都市武侯区人民政府')], confidence: 'confirmed' },
      { id: 'trial-winner-tieer', name: '中铁二院工程集团有限责任公司', relation: 'historical-winner', relationQuote: '成交供应商：中铁二院工程集团有限责任公司', sources: [industrySource('trial-tieer', '悦湖片区相关采购成交公告', 'https://www.cdwh.gov.cn/wuhou/c180402/2026-08/11/content_ccdb29cc8d3541a3adc4c37b6e8c1580.shtml', 'official', '成都市武侯区人民政府')], confidence: 'confirmed' },
    ] : [{ id: 'trial-jinling-winner', name: '江苏省工业设备安装集团有限公司', relation: 'historical-winner', relationQuote: '中标人：江苏省工业设备安装集团有限公司（公开转载，待原公告核验）', sources: [media], confidence: 'candidate' }],
    suppliers: isYuehu ? [{ id: 'trial-yuehu-agent', name: '华夏城投项目管理有限公司', relation: 'tender-agent', relationQuote: '采购代理机构：华夏城投项目管理有限公司', sources: [primary], confidence: 'confirmed' }] : [{ id: 'trial-jinling-agent', name: '江苏省设备成套股份有限公司', relation: 'tender-agent', relationQuote: '招标代理机构：江苏省设备成套股份有限公司（公开转载，待原公告核验）', sources: [media], confidence: 'candidate' }],
    queries: [], requestCount: 0, cacheHit: true, checkedAt: isYuehu ? CAPTURED : REPLAYED,
    gaps: ['只展示已存档公告/转载明确点名的企业；母子公司、完整上下游关系未取得。'],
    boundary: `离线历史回放，非最新关系。${INDUSTRY_CHAIN_BOUNDARY}`,
  }
}

export function trialRiskResult(opportunityId: string): CreditRiskResult | undefined {
  const item = caseFor(opportunityId)
  if (!item) return undefined
  const isYuehu = opportunityId === YUEHU
  return {
    opportunityId, projectTitle: item.title, subjectName: item.subject,
    profile: isYuehu ? { name: owner, subjectType: 'enterprise', subjectTypeBasis: '名称含有限公司；2026-09-17 历史检索', codeLabel: '统一社会信用代码', code: '91510107MAD40BA59T', legalPerson: '郭薇', address: '成都市武侯区金花桥街道簇马路三段6号', registrationStatus: '存续（历史页面显示，非实时状态）', sourceTitle: '成都市武侯区智慧宜居建设开发有限公司', sourceUrl: 'https://www.fy35.com/company/18985453.html' } : { name: item.subject, subjectType: 'enterprise', subjectTypeBasis: '仅按公司名称后缀判断，未做工商登记核验', codeLabel: '统一社会信用代码' },
    facts: [], queries: [], requestCount: 0, modelCalls: 0, cacheHit: true, checkedAt: isYuehu ? CAPTURED : REPLAYED, verifications: [],
    gaps: isYuehu ? ['历史检索未取得可核对的具体行政处罚、失信或诉讼事由。登记字段来自商业页面，需到官方公示系统复核。'] : ['该案例未做专项工商与风险查询；不输出信用结论。'],
    boundary: `离线历史回放。${CREDIT_RISK_BOUNDARY} 搜不到不等于没有风险。`,
  }
}

const contactSource = (name: string, title: string, publisher: string, pageUrl: string, tier: 'official' | 'media') => ({ title: `${name}｜${title}`, publisher, pageUrl, tier, observedAt: '2026-09-24' })
function point(companyName: string, kind: 'phone' | 'address', value: string, evidenceQuote: string, source: ReturnType<typeof contactSource>): LeadContactPoint {
  return { companyName, kind, value, normalized: value, evidenceQuote, sources: [source] }
}

export function trialLeadResult(opportunityId: string, industry: IndustryChainResult): LeadResult | undefined {
  const item = caseFor(opportunityId)
  if (!item || industry.opportunityId !== opportunityId) return undefined
  const nodes = buildLeadNodes(industry)
  const isYuehu = opportunityId === YUEHU
  const agent = isYuehu ? '华夏城投项目管理有限公司' : '江苏省设备成套股份有限公司'
  const quote = isYuehu
    ? '名称：华夏城投项目管理有限公司\n地址：成都市武侯区吉泰五路118号天合凯旋广场3栋3204号\n联系方式：028-83235896'
    : '招标代理机构：江苏省设备成套股份有限公司\n招标代理机构地址：南京市鼓楼区清江南路18号鼓楼创新广场D栋10楼1003室\n招标代理机构联系方式：025 - 86632151'
  const source = isYuehu
    ? contactSource(agent, '另一项目政府采购公告（公司级公开联系方式，非本项目专属）', '中国政府采购网', 'https://www.ccgp.gov.cn/cggg/dfgg/zbgg/202512/t20251211_25907721.htm', 'official')
    : contactSource(agent, '金陵药业项目公开转载（待原公告核验）', '新浪财经', jinlingReport, 'media')
  const rows: LeadRow[] = nodes.map((node) => {
    const hasContact = node.name === agent
    const phone = hasContact ? [point(agent, 'phone', isYuehu ? '028-83235896' : '025-86632151', quote, source)] : []
    const address = hasContact ? [point(agent, 'address', isYuehu ? '成都市武侯区吉泰五路118号天合凯旋广场3栋3204号' : '南京市鼓楼区清江南路18号鼓楼创新广场D栋10楼1003室', quote, source)] : []
    const fields = { contact: [], email: [], phone, address }
    return { id: node.id, name: node.name, ownerName: item.subject, industry: node.industry, relation: node.relation, relationLabel: node.relationLabel, relationQuote: node.relationQuote, confidence: node.confidence, ...fields, sources: node.sources, requestCount: 0, supplementRounds: 0, missing: missingLeadKinds(fields) }
  })
  return {
    schemaVersion: LEAD_SCHEMA_VERSION, inputFingerprint: buildLeadInputFingerprint({ ownerName: item.subject, nodes }), opportunityId, projectTitle: item.title, ownerName: item.subject,
    rows, queries: [], requestCount: 0, modelCalls: 0, cacheHit: true, checkedAt: REPLAYED,
    gaps: ['离线历史回放：仅代理机构取得公开公司级电话及地址；不代表可联系到本项目负责人。其他企业未取得可核对联系方式。'],
    boundary: `${LEAD_BOUNDARY} 本结果非实时检索；来源和采集日期以每个字段为准。`,
  }
}
