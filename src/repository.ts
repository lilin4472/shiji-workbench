import type { ActionItem, ColorTheme, Company, Evidence, ManagedBuckets, Opportunity, WorkspaceState } from './domain'
import { isPolicyChainResult, type PolicyChainResult } from '../shared/policy-chain.js'
import { isIndustryChainResult, type IndustryChainResult } from '../shared/industry-chain.js'
import { isLeadResult, type LeadResult } from '../shared/lead-contacts.js'
import { CREDIT_RISK_CATEGORY_LABELS, isCreditRiskResult, type CreditRiskResult } from '../shared/credit-risk.js'
import type { ProjectWatch } from '../shared/project-watch'
import { isEvidenceRecord, type EvidenceRecord } from '../shared/evidence-contract'
import { deriveLeadCandidates, type BusinessGraph, type LeadCandidate } from '../shared/business-graph'
import { removeLegacyMockObjects } from './drag'
import { emptyBusinessObjectStore, removeOpportunityBusinessObjects, upsertBusinessObjects, type BusinessObjectStore } from '../shared/business-objects'
import { isBusinessProfile, isOpportunity, isOpportunitySearchCriteria, type BusinessProfile, type OpportunitySearchCriteria } from '../shared/agent-contract'
import { isAnalysisRunState, type AnalysisRunState } from '../shared/analysis-run'
import { createOpportunityCatalog, isOpportunityCatalog, removeStructuralSourceOpportunities, type OpportunityCatalog } from '../shared/opportunity-catalog'
import { isBusinessCreditDiscoveryResult, isBusinessCreditReviewDecision, type BusinessCreditDiscoveryResult, type BusinessCreditReviewDecision } from '../shared/business-credit-report'
import { loadAnalysisSelection } from './analysis-selection'

export const companies: Record<string, Company> = {
  'company-lingang-001': { id: 'company-lingang-001', name: '东部临港建设发展有限公司', region: '上海 · 浦东', creditStatus: '待核验', tags: ['项目投资', '建设单位'] },
  'company-hospital-002': { id: 'company-hospital-002', name: '江宁区卫生健康建设中心', region: '江苏 · 南京', creditStatus: '待核验', tags: ['公共事业', '建设主体'] },
  'company-logistics-003': { id: 'company-logistics-003', name: '高新区产业投资集团', region: '浙江 · 嘉兴', creditStatus: '待核验', tags: ['园区运营', '付款主体待核'] },
}

export function companyForOpportunity(opportunity: Opportunity): Company {
  return companies[opportunity.companyId] ?? {
    id: opportunity.companyId,
    name: opportunity.companyName,
    region: '地区待核验',
    creditStatus: '待核验',
    tags: ['真实搜索结果', '主体待核验'],
  }
}

export const evidence: Record<string, Evidence> = {
  'ev-001': { id: 'ev-001', title: '科创园二期项目立项批复', source: '发展改革部门（演示）', capturedAt: '2026-09-04', reliability: 'official' },
  'ev-002': { id: 'ev-002', title: '用地手续与年度建设计划', source: '规划资源部门（演示）', capturedAt: '2026-09-03', reliability: 'official' },
  'ev-003': { id: 'ev-003', title: '医疗补短板专项资金计划', source: '政府公开信息（演示）', capturedAt: '2026-09-02', reliability: 'official' },
  'ev-004': { id: 'ev-004', title: '同类医院采购周期样本', source: '公共资源交易平台（演示）', capturedAt: '2026-08-29', reliability: 'secondary' },
  'ev-005': { id: 'ev-005', title: '园区消防维保合同到期线索', source: '人工导入（演示）', capturedAt: '2026-09-01', reliability: 'manual' },
}

const mockBusinessGraphs: Record<string, BusinessGraph> = {
  'opp-lingang-001': {
    project: { id: 'project-lingang-001', kind: 'project', name: '临港科创园二期机电安装工程', region: '上海 · 浦东' },
    companies: [
      { id: 'company-lingang-001', kind: 'company', name: '东部临港建设发展有限公司', region: '上海 · 浦东' },
      { id: 'company-lingang-parent', kind: 'company', name: '临港产业发展集团', region: '上海' },
      { id: 'company-lingang-operator', kind: 'company', name: '上海科创园区运营公司', region: '上海 · 浦东' },
      { id: 'company-lingang-agency', kind: 'company', name: '历史招标代理机构' },
      { id: 'company-lingang-contractor', kind: 'company', name: '历史总承包单位' },
      { id: 'company-lingang-supplier', kind: 'company', name: '机电设备供应商' },
    ],
    relationships: [
      { id: 'rel-lingang-owner', sourceEntityId: 'company-lingang-001', targetEntityId: 'project-lingang-001', type: 'project-owner', confidence: 'confirmed', evidenceIds: ['ev-001'], summary: '演示立项材料列明项目建设主体。' },
      { id: 'rel-lingang-parent', sourceEntityId: 'company-lingang-parent', targetEntityId: 'company-lingang-001', type: 'parent-company-of', confidence: 'supported-candidate', evidenceIds: ['ev-002'], summary: '集团隶属关系仍需打开原材料核验。' },
      { id: 'rel-lingang-operator', sourceEntityId: 'company-lingang-operator', targetEntityId: 'project-lingang-001', type: 'operates-project', confidence: 'supported-candidate', evidenceIds: ['ev-002'], summary: '运营主体来自演示建设计划线索。' },
      { id: 'rel-lingang-agency', sourceEntityId: 'company-lingang-agency', targetEntityId: 'project-lingang-001', type: 'tender-agent', confidence: 'discovery-clue', evidenceIds: ['ev-004'], summary: '同类项目中出现的历史代理线索。' },
      { id: 'rel-lingang-contractor', sourceEntityId: 'company-lingang-contractor', targetEntityId: 'project-lingang-001', type: 'historical-winner', confidence: 'discovery-clue', evidenceIds: ['ev-004'], summary: '历史中标关系为演示线索，尚未核验。' },
      { id: 'rel-lingang-supplier', sourceEntityId: 'company-lingang-supplier', targetEntityId: 'company-lingang-contractor', type: 'supplies-to', confidence: 'discovery-clue', evidenceIds: ['ev-005'], summary: '上下游协作关系为演示线索，尚未核验。' },
    ],
    contacts: [],
  },
}

export function businessGraphForOpportunity(opportunity: Opportunity): BusinessGraph {
  const mocked = mockBusinessGraphs[opportunity.id]
  if (mocked) return mocked
  const company = companyForOpportunity(opportunity)
  const projectId = `project:${opportunity.id}`
  return {
    project: { id: projectId, kind: 'project', name: opportunity.title, region: company.region },
    companies: [{ id: company.id, kind: 'company', name: company.name, region: company.region }],
    relationships: opportunity.evidenceIds.length > 0 ? [{
      id: `relationship:${opportunity.id}:owner`, sourceEntityId: company.id, targetEntityId: projectId,
      type: 'project-owner', confidence: 'supported-candidate', evidenceIds: opportunity.evidenceIds,
      summary: '正文已识别招标或建设主体，关系仍待证据等级确认。',
    }] : [],
    contacts: [],
  }
}

export function leadCandidatesForOpportunity(opportunity: Opportunity): LeadCandidate[] {
  return deriveLeadCandidates(businessGraphForOpportunity(opportunity), opportunity.id)
}

export const actionItems: ActionItem[] = [
  { id: 'act-001', opportunityId: 'opp-lingang-001', category: '业务跟踪', title: '核对立项原文与建设范围', detail: '演示行动', basis: '演示证据', sourceModules: ['时间链'], timing: '今天', owner: '我', done: false },
  { id: 'act-002', opportunityId: 'opp-lingang-001', category: '投标准备', title: '准备同类业绩和资质差距清单', detail: '演示行动', basis: '演示证据', sourceModules: ['项目详情'], timing: '今天', owner: '商务', done: false },
  { id: 'act-003', opportunityId: 'opp-lingang-001', category: '商务对接', title: '梳理潜在联合体伙伴', detail: '演示行动', basis: '演示证据', sourceModules: ['产业链'], timing: '本周', owner: '市场', done: false },
  { id: 'act-004', opportunityId: 'opp-lingang-001', category: '业务跟踪', title: '建立代理机构与采购意向提醒', detail: '演示行动', basis: '演示证据', sourceModules: ['政策链'], timing: '持续观察', owner: '识机', done: false },
]

const STATE_KEY = 'shiji.workspace.v3'
const OPPORTUNITIES_KEY = 'shiji.opportunities.v3'
const MANAGED_BUCKETS_KEY = 'shiji.managed-buckets.v1'
const LAYOUT_KEY = 'shiji.layout.v1'
const THEME_KEY = 'shiji.color-theme.v1'
// GEO 诊断已移除；保留常量只为说明旧数据位置，不再读写。
const GEO_SUBJECT_KEY = 'shiji.geo-subject.v1'
const PROJECT_WATCHES_KEY = 'shiji.project-watches.v1'
// Version 2 intentionally ignores legacy AnySearch/Tavily evidence without deleting user data.
const SEARCH_EVIDENCE_KEY = 'shiji.search-evidence.v2'
const BUSINESS_OBJECTS_KEY = 'shiji.business-objects.v1'
const OPPORTUNITY_SEARCH_CRITERIA_KEY = 'shiji.opportunity-search-criteria.v1'
const BUSINESS_PROFILE_KEY = 'shiji.business-profile.v1'
const DEEP_RADAR_RESULTS_KEY = 'shiji.deep-radar-results.v1'
const ANALYSIS_RUNS_KEY = 'shiji.analysis-runs.v1'
const POLICY_CHAIN_KEY = 'shiji.policy-chain.v1'
// v2 要求关系正文命中当前甲方或项目，并排除“供应商选择/评估”等方法文章。
const INDUSTRY_CHAIN_KEY = 'shiji.industry-chain.v3'
// v7 将主体归属校验扩展到联系人、邮箱、电话和地址；新闻页脚与同页其他主体不得串入。
const LEAD_RESULTS_KEY = 'shiji.lead-contacts.v10'
const CREDIT_RISK_KEY = 'shiji.credit-risk.v1'
const OPPORTUNITY_CATALOG_KEY = 'shiji.opportunity-catalog.v1'
const BUSINESS_CREDIT_DISCOVERIES_KEY = 'shiji.business-credit-discoveries.v1'
const BUSINESS_CREDIT_REVIEWS_KEY = 'shiji.business-credit-reviews.v1'
const ACTION_PROGRESS_KEY = 'shiji.action-progress.v1'
const ACTION_SCOPE_MIGRATION_KEY = 'shiji.action-scope-migrated.v1'
const LEGACY_MOCK_OPPORTUNITY_IDS = new Set(['opp-lingang-001', 'opp-hospital-002', 'opp-logistics-003'])
const LEGACY_MOCK_EVIDENCE_IDS = new Set(['ev-001', 'ev-002', 'ev-003', 'ev-004', 'ev-005'])

/** 行动完成状态只存稳定 action id；行动正文始终由当前真实模块结果重新生成。 */
export function loadActionProgress(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACTION_PROGRESS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveActionProgress(ids: string[]) {
  localStorage.setItem(ACTION_PROGRESS_KEY, JSON.stringify([...new Set(ids)]))
}

/** 旧版行动页曾读取总览分析选择；迁移一次后，行动桶成为唯一范围来源。 */
export function loadActionScopeMigrated(): boolean {
  return localStorage.getItem(ACTION_SCOPE_MIGRATION_KEY) === '1'
}

export function saveActionScopeMigrated() {
  localStorage.setItem(ACTION_SCOPE_MIGRATION_KEY, '1')
}

interface SavedBusinessCreditDiscovery {
  opportunityId: string
  subjectName: string
  result: BusinessCreditDiscoveryResult
}

interface SavedBusinessCreditReviews {
  opportunityId: string
  subjectName: string
  reviews: BusinessCreditReviewDecision[]
}

export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  subjectType: 'enterprise', name: '', businessRegions: [], companyNature: '', scale: '', industries: [], specialties: [], qualifications: [],
  assetsAndEquipment: '', personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
}

export interface LayoutPreferences {
  railWidth: number
  conversationWidth: number
}

export function loadWorkspace(): WorkspaceState {
  // 已移除视图的迁移兜底：旧版本保存的 geo / metering / report 视图回到机会总览。
  const retiredViews = new Set(['report', 'geo', 'metering'])
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return { activeView: 'simulation' }
    const stored = JSON.parse(raw) as Omit<WorkspaceState, 'activeView'> & { activeView?: string }
    const activeView = !stored.activeView || retiredViews.has(stored.activeView)
      ? 'overview'
      : stored.activeView as WorkspaceState['activeView']
    const migrated: WorkspaceState = { ...stored, activeView }
    return migrated.selectedOpportunityId?.startsWith('opp-lingang-') || migrated.selectedOpportunityId?.startsWith('opp-hospital-') || migrated.selectedOpportunityId?.startsWith('opp-logistics-')
      ? { ...migrated, selectedOpportunityId: undefined }
      : migrated
  } catch {
    return { activeView: 'simulation' }
  }
}

export function saveWorkspace(state: WorkspaceState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

export function loadOpportunities(): Opportunity[] {
  try {
    const raw = localStorage.getItem(OPPORTUNITIES_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Opportunity[]).filter((item) => !LEGACY_MOCK_OPPORTUNITY_IDS.has(item.id)).map((item) => ({
      ...item,
      companyName: item.companyName || companies[item.companyId]?.name || '主体待核验',
      locationAddress: item.locationAddress ?? null,
    }))
  } catch {
    return []
  }
}

export function saveOpportunities(items: Opportunity[]) {
  localStorage.setItem(OPPORTUNITIES_KEY, JSON.stringify(items))
}

export function loadOpportunityCatalog(): OpportunityCatalog {
  try {
    const raw = localStorage.getItem(OPPORTUNITY_CATALOG_KEY)
    if (raw !== null) {
      const value: unknown = JSON.parse(raw)
      return isOpportunityCatalog(value)
        ? removeStructuralSourceOpportunities(removeLegacyMockCatalogRecords(migrateLegacyNearbyCatalog(value)), loadSearchEvidence())
        : createOpportunityCatalog()
    }
    const migratedOpportunities = loadOpportunities()
    const migratedEvidenceIds = loadSearchEvidence().map((record) => record.id)
    return createOpportunityCatalog(migratedOpportunities, migratedEvidenceIds)
  } catch {
    return createOpportunityCatalog()
  }
}

/**
 * The first prototype wrote three fixed demo opportunities into the same
 * catalog used by real search results. A user deleting the visible card must
 * not see it return after restart, so strip those IDs whenever the catalog is
 * read. The check is ID-based and never affects a real project.
 */
export function removeLegacyMockCatalogRecords(catalog: OpportunityCatalog): OpportunityCatalog {
  const hasLegacyRecord = Object.keys(catalog.records).some((id) => LEGACY_MOCK_OPPORTUNITY_IDS.has(id))
  const hasLegacyResult = catalog.currentResultIds.some((id) => LEGACY_MOCK_OPPORTUNITY_IDS.has(id))
  const hasLegacyNearbyResult = (catalog.nearbyResultIds ?? []).some((id) => LEGACY_MOCK_OPPORTUNITY_IDS.has(id))
  const hasLegacyEvidence = catalog.currentEvidenceIds.some((id) => LEGACY_MOCK_EVIDENCE_IDS.has(id))
  if (!hasLegacyRecord && !hasLegacyResult && !hasLegacyNearbyResult && !hasLegacyEvidence) return catalog
  const records = { ...catalog.records }
  const lifecycle = { ...catalog.lifecycle }
  for (const id of LEGACY_MOCK_OPPORTUNITY_IDS) {
    delete records[id]
    delete lifecycle[id]
  }
  const referencedEvidence = new Set(Object.values(records).flatMap((item) => item.evidenceIds))
  return {
    ...catalog,
    records,
    lifecycle,
    currentResultIds: catalog.currentResultIds.filter((id) => !LEGACY_MOCK_OPPORTUNITY_IDS.has(id)),
    nearbyResultIds: (catalog.nearbyResultIds ?? []).filter((id) => !LEGACY_MOCK_OPPORTUNITY_IDS.has(id)),
    currentEvidenceIds: catalog.currentEvidenceIds.filter((id) => !LEGACY_MOCK_EVIDENCE_IDS.has(id) || referencedEvidence.has(id)),
    nearbyEvidenceIds: (catalog.nearbyEvidenceIds ?? []).filter((id) => !LEGACY_MOCK_EVIDENCE_IDS.has(id) || referencedEvidence.has(id)),
  }
}

export function saveOpportunityCatalog(catalog: OpportunityCatalog) {
  localStorage.setItem(OPPORTUNITY_CATALOG_KEY, JSON.stringify(catalog))
}

export function loadOpportunitySearchCriteria(fallback: OpportunitySearchCriteria): OpportunitySearchCriteria {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OPPORTUNITY_SEARCH_CRITERIA_KEY) ?? 'null')
    return isOpportunitySearchCriteria(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function saveOpportunitySearchCriteria(criteria: OpportunitySearchCriteria) {
  localStorage.setItem(OPPORTUNITY_SEARCH_CRITERIA_KEY, JSON.stringify(criteria))
}

export function loadBusinessProfile(): BusinessProfile {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BUSINESS_PROFILE_KEY) ?? 'null')
    return isBusinessProfile(value) ? value : DEFAULT_BUSINESS_PROFILE
  } catch {
    return DEFAULT_BUSINESS_PROFILE
  }
}

export function saveBusinessProfile(profile: BusinessProfile) {
  localStorage.setItem(BUSINESS_PROFILE_KEY, JSON.stringify(profile))
}

export function loadDeepRadarResults(): Opportunity[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEEP_RADAR_RESULTS_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter(isOpportunity).filter((item) => !LEGACY_MOCK_OPPORTUNITY_IDS.has(item.id))
      : []
  } catch {
    return []
  }
}

export function saveDeepRadarResults(items: Opportunity[]) {
  localStorage.setItem(DEEP_RADAR_RESULTS_KEY, JSON.stringify(items.filter(isOpportunity).filter((item) => !LEGACY_MOCK_OPPORTUNITY_IDS.has(item.id))))
}

export function loadAnalysisRuns(): AnalysisRunState[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ANALYSIS_RUNS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isAnalysisRunState) : []
  } catch {
    return []
  }
}

export function saveAnalysisRuns(states: AnalysisRunState[]) {
  localStorage.setItem(ANALYSIS_RUNS_KEY, JSON.stringify(states))
}

/** 政策链结果按"项目"保存在本机（与时间链同一套"项目 + 模块"口径）。 */
export function loadPolicyChainResults(): PolicyChainResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(POLICY_CHAIN_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isPolicyChainResult) : []
  } catch {
    return []
  }
}

export function savePolicyChainResults(results: PolicyChainResult[]) {
  localStorage.setItem(POLICY_CHAIN_KEY, JSON.stringify(results))
}

/** 产业链结果按"项目"保存在本机（与时间链/政策链同一套"项目 + 模块"口径）。 */
export function loadIndustryChainResults(): IndustryChainResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INDUSTRY_CHAIN_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isIndustryChainResult) : []
  } catch {
    return []
  }
}

export function saveIndustryChainResults(results: IndustryChainResult[]) {
  localStorage.setItem(INDUSTRY_CHAIN_KEY, JSON.stringify(results))
}

export function loadLeadResults(): LeadResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEAD_RESULTS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isLeadResult) : []
  } catch {
    return []
  }
}

export function saveLeadResults(results: LeadResult[]) {
  // 开发热更新也不能把内存里的旧 schema 迁入新 key。
  localStorage.setItem(LEAD_RESULTS_KEY, JSON.stringify(results.filter(isLeadResult)))
}

/** Before nearby/overview separation, a nearby search automatically inserted all hits into overview. */
function migrateLegacyNearbyCatalog(catalog: OpportunityCatalog): OpportunityCatalog {
  if (catalog.nearbyResultIds !== undefined) return catalog
  const task = loadWorkspace().currentTask
  if (task?.mode !== 'nearby') return catalog
  const nearbyIds = task.opportunityIds?.filter((id) => Boolean(catalog.records[id])) ?? []
  const autoSelected = new Set(nearbyIds)
  const explicitlyUsed = new Set<string>([
    ...loadAnalysisSelection(),
    ...Object.values(loadManagedBuckets()).flatMap((objects) => objects.flatMap((object) => object.opportunityId ?? (object.kind === 'opportunity' ? object.id : []))),
    ...loadProjectWatches().map((watch) => watch.opportunityId),
  ])
  const currentResultIds = catalog.currentResultIds.filter((id) => !autoSelected.has(id) || explicitlyUsed.has(id))
  return {
    ...catalog,
    currentResultIds,
    nearbyResultIds: nearbyIds,
    nearbyEvidenceIds: catalog.currentEvidenceIds,
    currentEvidenceIds: [...new Set(currentResultIds.flatMap((id) => catalog.records[id]?.evidenceIds ?? []))],
  }
}

/** 公开风险结果按"项目"保存在本机（与时间链/政策链/产业链同一套"项目 + 模块"口径）。 */
export function loadCreditRiskResults(): CreditRiskResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CREDIT_RISK_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    // 旧缓存里的类别标签可能是英文枚举 → 按类别重新映射中文
    return value.filter(isCreditRiskResult).map((result) => ({
      ...result,
      facts: result.facts.map((fact) => ({ ...fact, categoryLabel: CREDIT_RISK_CATEGORY_LABELS[fact.category] ?? fact.categoryLabel })),
    }))
  } catch {
    return []
  }
}

export function saveCreditRiskResults(results: CreditRiskResult[]) {
  localStorage.setItem(CREDIT_RISK_KEY, JSON.stringify(results))
}

export function loadBusinessCreditDiscovery(opportunityId: string, subjectName: string): BusinessCreditDiscoveryResult | undefined {
  return loadBusinessCreditDiscoveries().find((item) => item.opportunityId === opportunityId && item.subjectName === subjectName.trim())?.result
}

export function saveBusinessCreditDiscovery(opportunityId: string, result: BusinessCreditDiscoveryResult) {
  const subjectName = result.report.subjectName.trim()
  const current = loadBusinessCreditDiscoveries().filter((item) => !(item.opportunityId === opportunityId && item.subjectName === subjectName))
  localStorage.setItem(BUSINESS_CREDIT_DISCOVERIES_KEY, JSON.stringify([{ opportunityId, subjectName, result }, ...current]))
}

export function loadBusinessCreditReviews(opportunityId: string, subjectName: string): BusinessCreditReviewDecision[] {
  return loadSavedBusinessCreditReviews().find((item) => item.opportunityId === opportunityId && item.subjectName === subjectName.trim())?.reviews ?? []
}

export function saveBusinessCreditReview(opportunityId: string, subjectNameValue: string, review: BusinessCreditReviewDecision) {
  const subjectName = subjectNameValue.trim()
  const saved = loadSavedBusinessCreditReviews()
  const existing = saved.find((item) => item.opportunityId === opportunityId && item.subjectName === subjectName)
  const reviews = [review, ...(existing?.reviews ?? []).filter((item) => item.dimension !== review.dimension)]
  const remaining = saved.filter((item) => !(item.opportunityId === opportunityId && item.subjectName === subjectName))
  localStorage.setItem(BUSINESS_CREDIT_REVIEWS_KEY, JSON.stringify([{ opportunityId, subjectName, reviews }, ...remaining]))
}

function loadSavedBusinessCreditReviews(): SavedBusinessCreditReviews[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BUSINESS_CREDIT_REVIEWS_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedBusinessCreditReviews => Boolean(item)
      && typeof item === 'object'
      && typeof (item as SavedBusinessCreditReviews).opportunityId === 'string'
      && typeof (item as SavedBusinessCreditReviews).subjectName === 'string'
      && Array.isArray((item as SavedBusinessCreditReviews).reviews))
      .map((item) => ({ ...item, reviews: item.reviews.filter(isBusinessCreditReviewDecision) }))
  } catch {
    return []
  }
}

function loadBusinessCreditDiscoveries(): SavedBusinessCreditDiscovery[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BUSINESS_CREDIT_DISCOVERIES_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedBusinessCreditDiscovery => Boolean(item)
      && typeof item === 'object'
      && typeof (item as SavedBusinessCreditDiscovery).opportunityId === 'string'
      && typeof (item as SavedBusinessCreditDiscovery).subjectName === 'string'
      && isBusinessCreditDiscoveryResult((item as SavedBusinessCreditDiscovery).result))
  } catch {
    return []
  }
}

export function loadSearchEvidence(): EvidenceRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEARCH_EVIDENCE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(isEvidenceRecord) : []
  } catch {
    return []
  }
}

export function saveSearchEvidence(items: EvidenceRecord[]) {
  localStorage.setItem(SEARCH_EVIDENCE_KEY, JSON.stringify(items))
}

export function loadBusinessObjects(): BusinessObjectStore {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BUSINESS_OBJECTS_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return emptyBusinessObjectStore()
    const store = value as Partial<BusinessObjectStore>
    if (store.version !== 1 || !store.companies || !store.projects || !store.opportunityProjectIds) return emptyBusinessObjectStore()
    return store as BusinessObjectStore
  } catch {
    return emptyBusinessObjectStore()
  }
}

export function saveBusinessObjects(opportunities: Opportunity[], evidenceRecords: EvidenceRecord[]): BusinessObjectStore {
  const next = upsertBusinessObjects(loadBusinessObjects(), opportunities, evidenceRecords)
  localStorage.setItem(BUSINESS_OBJECTS_KEY, JSON.stringify(next))
  return next
}

export function deleteBusinessObjectsForOpportunity(opportunityId: string): BusinessObjectStore {
  const next = removeOpportunityBusinessObjects(loadBusinessObjects(), opportunityId)
  localStorage.setItem(BUSINESS_OBJECTS_KEY, JSON.stringify(next))
  return next
}

export function loadManagedBuckets(): ManagedBuckets {
  try {
    const raw = localStorage.getItem(MANAGED_BUCKETS_KEY)
    if (!raw) return { focus: [], compare: [], action: [] }
    const parsed = JSON.parse(raw) as ManagedBuckets
    return {
      focus: removeLegacyMockObjects(parsed.focus ?? []),
      compare: removeLegacyMockObjects(parsed.compare ?? []),
      action: removeLegacyMockObjects(parsed.action ?? []),
    }
  } catch {
    return { focus: [], compare: [], action: [] }
  }
}

export function saveManagedBuckets(buckets: ManagedBuckets) {
  localStorage.setItem(MANAGED_BUCKETS_KEY, JSON.stringify(buckets))
}

export function loadLayoutPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as LayoutPreferences) : { railWidth: 112, conversationWidth: 420 }
  } catch {
    return { railWidth: 112, conversationWidth: 420 }
  }
}

export function saveLayoutPreferences(layout: LayoutPreferences) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
}

export function loadColorTheme(): ColorTheme {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'warm' || value === 'porcelain' ? value : 'current'
}

export function saveColorTheme(theme: ColorTheme) {
  localStorage.setItem(THEME_KEY, theme)
}

// GEO 诊断已于 2026-09-14 从产品中移除；旧 GEO_SUBJECT_KEY 本机数据不迁移也不删除。
// 商机推演草稿的持久化由 src/simulation.ts 负责。

export function loadProjectWatches(): ProjectWatch[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROJECT_WATCHES_KEY) ?? '[]')
    return Array.isArray(value) ? value as ProjectWatch[] : []
  } catch {
    return []
  }
}

export function saveProjectWatches(watches: ProjectWatch[]) {
  localStorage.setItem(PROJECT_WATCHES_KEY, JSON.stringify(watches))
}

export function byId(items: Opportunity[], id?: string) {
  return id ? items.find((item) => item.id === id) : undefined
}
