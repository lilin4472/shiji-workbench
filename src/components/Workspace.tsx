import {
  Activity, AlertTriangle, Archive, ArrowLeft, ArrowRight, BadgeCheck, Boxes,
  BriefcaseBusiness, Building2, CalendarClock, Check, ChevronRight, CircleDollarSign, Download, ExternalLink,
  Eye, FileSearch, FileText, EyeOff, GitCompareArrows, Globe2, GripVertical, HardDrive,
  KeyRound, Link2, MapPin, Play, Radar, SearchCheck, ShieldAlert,
  RotateCcw, Trash2, UsersRound, Waypoints, X
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
const LEAD_COLUMNS = ["name", "industry", "owner", "contact", "email", "phone", "address"] as const
const LEAD_COLUMN_LABELS: Record<(typeof LEAD_COLUMNS)[number], string> = { name: '公司名称', industry: '行业', owner: '甲方名称', contact: '联系人', email: '邮箱', phone: '电话', address: '公开地址' }
import { createPortal } from 'react-dom'
import { formatCachedResultLabel, runCallOutcome, type AnalysisRunState, type AnalysisRunStatus, type ExtensionAnalysisModuleId } from '../../shared/analysis-run'
import { evaluateDeepRadarMatch, type RadarMatchStatus } from '../../shared/deep-radar'
import { buildCreditDiscoveryReport, canBusinessCreditEvidenceSupportReview, type BusinessCreditDiscoveryResult, type BusinessCreditReviewDecision, type CreditCheckDimension, type CreditCheckStatus, type LocalCreditEvidence } from '../../shared/business-credit-report'
import type { CredentialStatus, DeepSeekCredentialStatus, TiandituServerCredentialStatus, TiandituWebCredentialStatus } from '../../shared/credential-contract'
import type { EvidenceRecord, LocalEvidenceRecord } from '../../shared/evidence-contract'
import { buildProjectTimeline, PROJECT_STAGE_DEFINITIONS, type ProjectStageState } from '../../shared/project-timeline'
import type { PolicyChainResult, PolicyFinding, PolicyPrediction } from '../../shared/policy-chain'
import type { IndustryChainResult, IndustryCompany } from '../../shared/industry-chain'
import type { CreditRiskResult, CreditRiskFact } from '../../shared/credit-risk'
import { CREDIT_RISK_CATEGORY_LABELS } from '../../shared/credit-risk'
import { RELATION_LABELS as INDUSTRY_RELATION_LABELS, SOURCE_TIER_LABELS as INDUSTRY_SOURCE_LABELS } from '../../shared/industry-chain'
import { buildLeadNodes, canonicalizeLeadValue, type LeadContactPoint, type LeadResult, type LeadRow } from '../../shared/lead-contacts'
import type { ProjectWatch } from '../../shared/project-watch'
import type { EvidenceSourceClass, SearchProviderId } from '../../shared/search-contract'
import type { UserSearchProviderId } from '../../shared/search-preference'
import type { BusinessProfile, ColorTheme, OpportunitySearchCriteria, ManagedObject, Opportunity, WorkspaceView } from '../domain'
import type { ActionItem } from '../domain'
import { buildActionPlan } from '../action-plan'
import type { SimulationDraft } from '../simulation'
import { IS_TRIAL_EDITION } from '../edition'
import {
  actionItems, businessGraphForOpportunity, companyForOpportunity, evidence, leadCandidatesForOpportunity, loadActionProgress, saveActionProgress,
  loadBusinessCreditDiscovery, loadBusinessCreditReviews, saveBusinessCreditDiscovery, saveBusinessCreditReview,
} from '../repository'
import SimulationView from './SimulationView'
import { buildProjectScopeItems, type ProjectScopeItem } from '../project-scope'
import { buildCompareRows } from '../compare-summary'
import TiandituMap from './TiandituMap'

const IndustryGraph = lazy(() => import('./IndustryGraph'))

interface Props {
  view: WorkspaceView
  colorTheme: ColorTheme
  profile: OpportunitySearchCriteria
  mapProfile: OpportunitySearchCriteria
  businessProfile: BusinessProfile
  simulationDraft: SimulationDraft
  onSimulationDraft: (draft: SimulationDraft) => void
  opportunities: Opportunity[]
  nearbyOpportunities: Opportunity[]
  nearbySelected?: Opportunity
  nearbyEvidenceIds: string[]
  radarOpportunities: Opportunity[]
  archivedOpportunities: Opportunity[]
  ignoredOpportunities: Opportunity[]
  evidenceRecords: EvidenceRecord[]
  currentEvidenceIds: string[]
  globalActivities: { id: number; label: string }[]
  onActivityStart: (label: string) => () => void
  actionProjects: Opportunity[]
  compareProjects: Opportunity[]
  selected?: Opportunity
  radarSelected?: Opportunity
  radarFailure?: string
  onSelect: (id: string) => void
  onSelectRadar: (id: string) => void
  onArchiveRadar: (id: string) => void
  onIgnoreRadar: (id: string) => void
  onDeleteRadar: (id: string) => void
  /** 清除某项目在本模块的分析结果（只删本模块结果与运行状态）。 */
  onClearTimelineResult: (id: string) => void
  onClearPolicyResult: (id: string) => void
  onClearIndustryResult: (id: string) => void
  onClearRiskResult: (id: string) => void
  /** 发现结果与总览双向同步：勾选追加，取消只移出当前结果列表。 */
  onToggleOpportunityOverview: (id: string, next: boolean) => void
  /** 总览当前结果 id：用于渲染发现结果是否已加入总览。 */
  overviewResultIds: string[]
  onOpenView: (view: WorkspaceView) => void
  /** 行动页进入专项模块：先把当前行动项目设为唯一分析对象，再导航；不启动分析。 */
  onOpenAnalysisForProject: (view: WorkspaceView, opportunityId: string) => void
  onOpenCompareRisk: (opportunityId: string) => void
  onRemoveActionProject: (opportunityId: string) => void
  onRemoveCompareProject: (opportunityId: string) => void
  onDragObject: (object?: ManagedObject) => void
  projectWatches: ProjectWatch[]
  onSubscribeProject: (opportunityId?: string) => void
  onToggleProjectWatch: (id: string) => void
  onUnsubscribeProject: (id: string) => void
  analysisSelection: string[]
  scopeCleared: boolean
  onToggleAnalysisSelection: (id: string) => void
  /** 模块页「移出」：把项目移出模块分析范围（与总览复选框是同一个集合）。
   *  移空后必须记住用户明确移空了，否则模块页会退回当前选中项目，点「移出」看起来就像没反应。 */
  onRemoveFromScope: (id: string) => void
  onSelectAllAnalysis: (ids: string[]) => void
  onClearAnalysisSelection: () => void
  onRunTimelineAnalysis: (opportunityId: string) => void
  onRunTimelineAnalysisScope: (opportunityIds: string[]) => void
  onCheckProjectWatch: (watchId: string) => void
  checkingWatchId?: string
  analysisRuns: AnalysisRunState[]
  onAnalysisRun: (state: AnalysisRunState) => void
  policyResults: PolicyChainResult[]
  onRunPolicyChainScope: (opportunityIds: string[]) => void
  onRunPolicyChain: (opportunityId: string) => void
  industryResults: IndustryChainResult[]
  onRunIndustryChainScope: (opportunityIds: string[]) => void
  onRunIndustryChain: (opportunityId: string) => void
  creditRiskResults: CreditRiskResult[]
  onRunCreditRiskScope: (opportunityIds: string[]) => void
  onRunCreditRisk: (opportunityId: string) => void
  leadResults: LeadResult[]
  onRunLeadsScope: (opportunityIds: string[]) => void
  onRunLeads: (opportunityId: string) => void
  onClearLeadResult: (id: string) => void
  businessCreditRequest?: { subjectName: string; focus: string; nonce: number }
  onOpenBusinessCredit: (subjectName: string, focus?: string) => void
  onArchiveOpportunity: (id: string) => void
  onIgnoreOpportunity: (id: string) => void
  onRestoreOpportunity: (id: string) => void
  onDeleteOpportunity: (id: string) => void
  onRemoveEvidenceFromCurrent: (evidenceId: string) => void
}

const viewTitles: Record<WorkspaceView, [string, string]> = {
  simulation: ['商机推演', ''],
  overview: ['机会总览', '从发现到行动的统一业务上下文'],
  radar: ['深度雷达', '搜索、证据核验与匹配解释'],
  nearby: ['附近招标', '以地点和半径发现附近招标主体与工程机会'],
  timeline: ['时间链', '判断项目现在走到哪里、下一节点何时出现'],
  policy: ['政策链', '沿国家、省、市各级政策追踪资金与项目线索，预测下一项目或跨区域商机可能发生的事件和地点，帮助提前锁定机会。'],
  industry: ['产业链', '穿透企业内外部的集团组织、供应与合作关系，沿链条发现更多上游供方和下游客户。'],
  risk: ['企业公开风险', '多维查询招标主体的工商登记、行政处罚、经营异常和公开信用线索，辅助识别工程骗局与商务纠纷；每条信息保留来源。'],
  leads: ['获客建议', '从产业链挖掘客户与供应商，依法依规梳理公开的主体、联系人及联系方式，一键发现可跟进的商机对象。'],
  actions: ['行动指南', '基于前序模块沉淀的证据与分析，形成业务跟踪、商务对接和投标策划的落地行动。'],
  compare: ['机会对比', '对比收益、时机、证据与风险'],
  watch: ['关注任务', '在本机按规则持续检查关键信号'],
  library: ['本机项目库', '管理已归档和不感兴趣的真实项目'],
  capabilities: ['能力中心', '内置和可下载能力，不是插件市场'],
  agent: ['推广合作', '简化的线下一级代理合作流程'],
  settings: ['本地设置', '模型、搜索和本地数据边界'],
}

export default function Workspace({ view, colorTheme, profile, mapProfile, businessProfile, simulationDraft, onSimulationDraft, opportunities, nearbyOpportunities, nearbySelected, nearbyEvidenceIds, radarOpportunities, archivedOpportunities, ignoredOpportunities, evidenceRecords, currentEvidenceIds, globalActivities, onActivityStart, actionProjects, compareProjects, selected, radarSelected, radarFailure, onSelect, onSelectRadar, onArchiveRadar, onIgnoreRadar, onDeleteRadar, onToggleOpportunityOverview, overviewResultIds, onClearTimelineResult, onClearPolicyResult, onClearIndustryResult, onClearRiskResult, onOpenView, onOpenAnalysisForProject, onOpenCompareRisk, onRemoveActionProject, onRemoveCompareProject, onDragObject, projectWatches, onSubscribeProject, onToggleProjectWatch, onUnsubscribeProject, analysisSelection, scopeCleared, onToggleAnalysisSelection, onRemoveFromScope, onSelectAllAnalysis, onClearAnalysisSelection, onRunTimelineAnalysis, onRunTimelineAnalysisScope, onCheckProjectWatch, checkingWatchId, analysisRuns, onAnalysisRun, policyResults, onRunPolicyChainScope, onRunPolicyChain, industryResults, onRunIndustryChainScope, onRunIndustryChain, creditRiskResults, onRunCreditRiskScope, onRunCreditRisk, leadResults, onRunLeadsScope, onRunLeads, onClearLeadResult, businessCreditRequest, onOpenBusinessCredit, onArchiveOpportunity, onIgnoreOpportunity, onRestoreOpportunity, onDeleteOpportunity, onRemoveEvidenceFromCurrent }: Props) {
  const [title, subtitle] = viewTitles[view]
  const developmentPreview = window.shijiDesktop?.mockEnabled === true
  // 第 4 步：模块分析对象 = 总览勾选  当前结果；未勾选时退回当前选中项目。
  const scopeProjects = (analysisSelection.length > 0
    ? opportunities.filter((item) => analysisSelection.includes(item.id))
    : (scopeCleared ? [] : (selected ? [selected] : [])))
  // 行动清单是行动页唯一的显式项目范围；不能再误读总览分析复选框。
  const actionScopeProjects = actionProjects
  const timelineRun = analysisStateFor(analysisRuns, scopeProjects[0] ?? selected, 'timeline')
  // 「启动分析」后进入结果视图：只要范围内有任一项目跑过本模块，就收起对象卡片显示结果卡片。
  const timelineStarted = scopeProjects.some((item) => Boolean(analysisStateFor(analysisRuns, item, 'timeline')))
  // 政策链同一口径：范围内任一项目跑过本模块，就收起对象卡片显示结果卡片。
  const policyStarted = scopeProjects.some((item) => Boolean(analysisStateFor(analysisRuns, item, 'policy')))
  const industryStarted = scopeProjects.some((item) => Boolean(analysisStateFor(analysisRuns, item, 'industry')))
  const creditRiskStarted = scopeProjects.some((item) => Boolean(analysisStateFor(analysisRuns, item, 'risk')))
  const leadStarted = scopeProjects.some((item) => Boolean(analysisStateFor(analysisRuns, item, 'leads')))
  // 硬门禁（用户 2026-09-18）：获客只消费产业链已发现的节点；范围内一家都没有就不给跑，先去跑产业链。
  const leadNodeCounts = scopeProjects.map((item) => {
    const industry = industryResults.find((entry) => entry.opportunityId === item.id)
    return industry ? buildLeadNodes(industry).length : 0
  })
  const leadReady = leadNodeCounts.some((count) => count > 0)
  const leadCompanyTotal = leadNodeCounts.reduce((sum, count) => sum + count, 0)
  const leadMaxCalls = leadCompanyTotal * (4 + 2)
  // 载荷：项目对象 + 关联证据 + 已确定性提取字段（模块据此离线分析，不重复搜索）
  const scopeItems = buildProjectScopeItems(scopeProjects, evidenceRecords)
  const [scopeDetail, setScopeDetail] = useState<Opportunity>()
  // 雷达结果项详情：与项目库同口径——只有在同一份 evidenceRecords 里能找到该项目的证据时才可打开。
  const [radarDetail, setRadarDetail] = useState<EvidenceRecord>()
  const radarEvidenceReady = (id: string): boolean => {
    const item = radarOpportunities.find((entry) => entry.id === id)
    return Boolean(item && evidenceRecords.some((record) => item.evidenceIds.includes(record.id)))
  }
  const openRadarDetails = (item: Opportunity) => {
    const record = evidenceRecords.find((candidate) => item.evidenceIds.includes(candidate.id))
    if (record) setRadarDetail(record)
  }
  const libraryCount = archivedOpportunities.length + ignoredOpportunities.length
  return (
    <main className="workspace">
      <header className="workspace-head" data-view={view}>
        <div><span className="micro-label">CURRENT WORKSPACE</span><h2>{title}</h2><p>{subtitle}</p></div>
        {(view === 'library' || view === 'radar') && <div className="workspace-context">
          <span>{view === 'library' ? '本机项目记录' : view === 'radar' ? '雷达匹配结果' : '当前机会'}</span><strong>{view === 'library' ? `${libraryCount} 个归档或忽略项目` : view === 'radar' ? radarSelected?.title ?? '尚未运行雷达' : selected?.title ?? '尚未选择'}</strong>
          {view === 'library' ? <b>{libraryCount}</b> : view === 'radar' ? radarSelected && <b>{evaluateDeepRadarMatch(businessProfile, radarSelected).score ?? '—'}</b> : selected && <b>{selected.matchScore}%</b>}
        </div>}
      </header>
      {IS_TRIAL_EDITION && <div className="trial-workspace-note">体验版 · 两份真实历史案例｜可按原流程回放时间链、政策链、产业链、公开风险、获客和行动；回放不联网，资料日期与缺口见结果卡片。搜索新项目需正式版并填写自己的 Key。</div>}
      {globalActivities.length > 0 && <GlobalActivityIndicator activities={globalActivities} />}
      {view !== 'simulation' && view !== 'library' && view !== 'radar' && <nav className="analysis-tabs">
        {([['overview', '总览'], ['timeline', '时间链'], ['policy', '政策链'], ['industry', '产业链'], ['risk', '公开风险'], ['leads', '获客'], ['actions', '行动']] as [WorkspaceView, string][]).map(([id, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => onOpenView(id)}>{label}</button>
        ))}
      </nav>}
      <div className="view-stage" key={view}>
        {view === 'simulation' && <SimulationView draft={simulationDraft} onDraft={onSimulationDraft} />}
        {view === 'overview' && <Overview scopeCleared={scopeCleared} analysisSelection={analysisSelection} onToggleAnalysisSelection={onToggleAnalysisSelection} onSelectAllAnalysis={onSelectAllAnalysis} onClearAnalysisSelection={onClearAnalysisSelection} opportunities={opportunities} evidenceRecords={evidenceRecords} archivedOpportunities={archivedOpportunities} ignoredOpportunities={ignoredOpportunities} selected={selected} onSelect={onSelect} onOpenView={onOpenView} onDragObject={onDragObject} onArchiveOpportunity={onArchiveOpportunity} onIgnoreOpportunity={onIgnoreOpportunity} onDeleteOpportunity={onDeleteOpportunity} />}
        {view === 'radar' && <DeepRadar profile={businessProfile} opportunities={radarOpportunities} selected={radarSelected} failure={radarFailure} onSelect={onSelectRadar} onDragObject={onDragObject} onOpenDetails={openRadarDetails} onArchive={onArchiveRadar} onIgnore={onIgnoreRadar} onDelete={onDeleteRadar} onToggleOverview={onToggleOpportunityOverview} overviewIds={overviewResultIds} evidenceReady={radarEvidenceReady} />}
        {view === 'nearby' && <Nearby colorTheme={colorTheme} profile={profile} mapProfile={mapProfile} opportunities={nearbyOpportunities} evidenceRecords={evidenceRecords} currentEvidenceIds={nearbyEvidenceIds} onRemoveEvidenceFromCurrent={onRemoveEvidenceFromCurrent} selected={nearbySelected} onSelect={onSelect} onDragObject={onDragObject} onToggleOpportunityOverview={onToggleOpportunityOverview} overviewResultIds={overviewResultIds} onArchiveOpportunity={onArchiveOpportunity} onIgnoreOpportunity={onIgnoreOpportunity} onDeleteOpportunity={onDeleteOpportunity} onActivityStart={onActivityStart} />}
        {view === 'timeline' && (timelineStarted
          ? <Timeline scope={scopeProjects} analysisRuns={analysisRuns} watches={projectWatches} selected={selected} onSelect={onSelect} onStart={onRunTimelineAnalysis} onRemoveFromScope={onRemoveFromScope} onClearResult={onClearTimelineResult} onSubscribe={onSubscribeProject} onUnsubscribe={onUnsubscribeProject} />
          : <AnalysisNotStarted moduleId="timeline" module="时间链" selected={selected} state={timelineRun} scope={scopeProjects} scopeItems={scopeItems} onOpenScopeDetail={setScopeDetail} onRemoveFromScope={onRemoveFromScope} calls={`每项目 1 次豆包搜索 / DSH 0 次${scopeProjects.length > 1 ? `  本次最多 ${scopeProjects.length} 次` : ''}`} copy="按选中项目逐个补搜全部七阶段证据，判断每个项目现在走到哪里、下一节点何时出现；只有达到阶段门槛的证据才能推进时间链。" onStart={onRunTimelineAnalysisScope} />)}
        {view === 'policy' && (developmentPreview ? <Policy /> : (policyStarted
          ? <PolicyChainView scope={scopeProjects} analysisRuns={analysisRuns} results={policyResults} selected={selected} onSelect={onSelect} onStart={onRunPolicyChain} onRemoveFromScope={onRemoveFromScope} onClearResult={onClearPolicyResult} />
          : <AnalysisNotStarted moduleId="policy" scopeItems={scopeItems} onOpenScopeDetail={setScopeDetail} onRemoveFromScope={onRemoveFromScope} module="政策链" selected={selected} scope={scopeProjects} state={analysisStateFor(analysisRuns, scopeProjects[0] ?? selected, 'policy')} calls={`按项目做 国家 / 省 / 市（区县）各 1 次检索，最多 3 次豆包搜索 / DSH 0 次${scopeProjects.length > 1 ? `  本次最多 ${scopeProjects.length * 3} 次` : ''}`} copy="先看政策与预算从国家到地方的穿透方向（只认正文点名下级的原句），再给带依据的下一可能节点预测：没有预算年度、历史节奏或正式采购意向作依据时，不输出预测。" onStart={onRunPolicyChainScope} />))}
        {view === 'industry' && (developmentPreview ? <Industry selected={selected} /> : (industryStarted
          ? <IndustryChainView scope={scopeProjects} analysisRuns={analysisRuns} results={industryResults} selected={selected} onSelect={onSelect} onStart={onRunIndustryChain} onRemoveFromScope={onRemoveFromScope} onClearResult={onClearIndustryResult} />
          : <AnalysisNotStarted moduleId="industry" scopeItems={scopeItems} onOpenScopeDetail={setScopeDetail} onRemoveFromScope={onRemoveFromScope} module="产业链" selected={selected} scope={scopeProjects} state={analysisStateFor(analysisRuns, scopeProjects[0] ?? selected, 'industry')} calls={`每项目 3 次关系检索 + 最多 4 家工商补全，最多 7 次豆包搜索 / DSH 0 次${scopeProjects.length > 1 ? `  本次最多 ${scopeProjects.length * 7} 次` : ''}`} copy="以甲方为核心，检索历史中标、供应商、承包/分包、联合体、代理，以及母公司、子公司和分公司；每条关系必须保留原文，字段抽不到就写未取得。" onStart={onRunIndustryChainScope} />))}
        {view === 'risk' && (developmentPreview
          ? <Risk selected={selected} request={businessCreditRequest} analysisRun={analysisStateFor(analysisRuns, selected, 'risk')} onAnalysisRun={onAnalysisRun} onActivityStart={onActivityStart} />
          : (creditRiskStarted
            ? <CreditRiskView scope={scopeProjects} analysisRuns={analysisRuns} results={creditRiskResults} selected={selected} onSelect={onSelect} onStart={onRunCreditRisk} onRemoveFromScope={onRemoveFromScope} onClearResult={onClearRiskResult} />
            : <AnalysisNotStarted moduleId="risk" scopeItems={scopeItems} onOpenScopeDetail={setScopeDetail} onRemoveFromScope={onRemoveFromScope} module="公开风险" selected={selected} scope={scopeProjects} state={analysisStateFor(analysisRuns, scopeProjects[0] ?? selected, 'risk')} calls="每项目先跑 4 组基础检索，再按证据缺口补查；DSH 负责检索决策与证据约束归纳，完成后显示实际调用数" copy="对发布招标的招标单位做工商与公开风险检索：政府机关与事业单位同样受理（改看机构登记与行政诉讼），风险事实只写来源里写明的事由；搜不到不等于没有风险。" onStart={onRunCreditRiskScope} />))}
        {view === 'leads' && (developmentPreview ? <Leads selected={selected} onDragObject={onDragObject} /> : leadStarted
          ? <LeadContactsView scope={scopeProjects} analysisRuns={analysisRuns} results={leadResults} selected={selected} onSelect={onSelect} onStart={onRunLeads} onRemoveFromScope={onRemoveFromScope} onClearResult={onClearLeadResult} />
          : <AnalysisNotStarted moduleId="leads" scopeItems={scopeItems} onOpenScopeDetail={setScopeDetail} onRemoveFromScope={onRemoveFromScope} module="获客" selected={selected} scope={scopeProjects} state={analysisStateFor(analysisRuns, selected, 'leads')}
              calls={leadReady
                ? `按产业链的 ${leadCompanyTotal} 家节点依次查官网 / 工商 / 公告 / 邮箱（字段齐全即停），再按缺口最多补查 2 轮：搜索上限 ${leadMaxCalls} 次，DSH 每家最多 2 次`
                : '当前范围还没有产业链节点：需先跑产业链（每项目最多 7 次），再由获客补联系方式'}
              copy={leadReady
                ? '消费产业链已发现的同一批节点（不含甲方），逐家补联系人 / 邮箱 / 电话 / 地址：每个值都绑定来源与观察时间，抽不到留「」。'
                : '获客不独立重搜潜在客户，它只消费产业链发现的节点。请先在这个项目上跑一次产业链，再回来跑获客。'}
              dependency={leadReady ? '已具备产业链节点' : '需先完成产业链'}
              gateNote={leadReady ? undefined : '先去跑产业链'} onGateGo={() => onOpenView('industry')}
              onStart={leadReady ? onRunLeadsScope : undefined} />)}
        {view === 'actions' && (developmentPreview
          ? <MockActions />
          : <ActionPlanView scope={actionScopeProjects} selected={selected} analysisRuns={analysisRuns} policyResults={policyResults} industryResults={industryResults} riskResults={creditRiskResults} leadResults={leadResults} watches={projectWatches} onSelect={onSelect} onOpenView={onOpenView} onOpenAnalysisForProject={onOpenAnalysisForProject} onRemoveProject={onRemoveActionProject} />)}
        {view === 'compare' && <Compare opportunities={compareProjects} evidenceRecords={evidenceRecords} riskResults={creditRiskResults} overviewResultIds={overviewResultIds} analysisSelection={analysisSelection} onOpenRisk={onOpenCompareRisk} onRemove={onRemoveCompareProject} />}
        {view === 'watch' && <Watch selected={selected} watches={projectWatches} onSubscribe={onSubscribeProject} onToggle={onToggleProjectWatch} onCheck={onCheckProjectWatch} onUnsubscribe={onUnsubscribeProject} onOpenAnalysis={onOpenAnalysisForProject} checkingWatchId={checkingWatchId} />}
        {view === 'library' && <ProjectLibrary archived={archivedOpportunities} ignored={ignoredOpportunities} evidenceRecords={evidenceRecords} onRestore={onRestoreOpportunity} onDelete={onDeleteOpportunity} />}
        {view === 'capabilities' && <Capabilities />}
        {view === 'agent' && <Agent />}
        {view === 'settings' && <Settings onActivityStart={onActivityStart} />}
      </div>
    {scopeDetail && <NearbyDetailReport item={scopeDetail} evidenceRecords={evidenceRecords} onBack={() => setScopeDetail(undefined)} />}
    {radarDetail && <EvidenceDetailOverlay record={radarDetail} onClose={() => setRadarDetail(undefined)} />}
    </main>
  )
}

function startObjectDrag(event: DragEvent, object: ManagedObject, onDragObject: (object?: ManagedObject) => void) {
  // effectAllowed 必须与放置区的 dropEffect 取同一个值（都是 copy），
  // 否则浏览器按"不兼容"处理：光标显示禁止、drop 事件不触发。
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-shiji-object', JSON.stringify(object))
  onDragObject(object)
}

function startPointerDrag(event: ReactPointerEvent, object: ManagedObject, onDragObject: (object?: ManagedObject) => void) {
  event.preventDefault()
  event.stopPropagation()
  onDragObject(object)
}

function currentProjectStageLabel(opportunity: Opportunity): string {
  const stageId = buildProjectTimeline(opportunity.timelineEvidence).currentVerifiedStageId
  return projectStageLabel(stageId)
}

const SUBJECT_NAME_PLACEHOLDERS = new Set(['主体待核验', '主体待从正文确认', '正文未识别', '待核验'])

/**
 * Old catalog records can still carry a placeholder companyName. Before the
 * map/list render, fill the recognized subject from the same evidence record
 * the backend already produced; never invent a new subject in the frontend.
 */
function resolveOpportunityCompanyName(opportunity: Opportunity, evidenceRecords: EvidenceRecord[]): string {
  const direct = opportunity.companyName?.trim()
  if (direct && !SUBJECT_NAME_PLACEHOLDERS.has(direct)) return direct
  for (const evidenceId of opportunity.evidenceIds) {
    const candidate = evidenceRecords
      .find((record) => record.id === evidenceId)
      ?.opportunityDetails?.companyCandidates
      ?.find((value) => value.trim() && !SUBJECT_NAME_PLACEHOLDERS.has(value.trim()))
      ?.trim()
    if (candidate) return candidate
  }
  return direct || '主体待核验'
}


function formatOpportunityAmount(value: number | null, withUnit = false): string {
  return value === null ? '待核验' : `${value.toLocaleString()}${withUnit ? '万' : ''}`
}

function formatOpportunityDistance(value: number | null, withUnit = false): string {
  return value === null ? '待核验' : `${value}${withUnit ? 'km' : ''}`
}

interface OpportunityEvidenceView {
  id: string
  title: string
  source: string
  capturedAt: string
  reliability: 'official' | 'secondary' | 'manual'
  label: string
  url?: string
}

function resolveOpportunityEvidence(ids: string[], records: EvidenceRecord[]): OpportunityEvidenceView[] {
  const realById = new Map(records.map((record) => [record.id, record]))
  return ids.map((id) => {
    const real = realById.get(id)
    if (real) {
      const grade = real.assessment.status === 'assessed' ? real.assessment.grade : undefined
      return {
        id,
        title: real.title,
        source: real.provenance.publisher,
        capturedAt: (real.provenance.publishedAt ?? real.provenance.capturedAt).slice(0, 10),
        reliability: grade === 'A' ? 'official' : 'secondary',
        label: grade ? `${grade}级·待复核` : '搜索线索',
        ...(real.provenance.pageUrl ? { url: real.provenance.pageUrl } : {}),
      }
    }
    const legacy = evidence[id]
    if (legacy) return { ...legacy, label: legacy.reliability === 'official' ? '官方源' : legacy.reliability === 'secondary' ? '交叉源' : '人工导入' }
    return { id, title: '来源记录待恢复', source: '本机索引缺少对应记录', capturedAt: '—', reliability: 'secondary', label: '待核验' }
  })
}

function projectStageLabel(stageId?: string): string {
  return PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === stageId)?.label ?? '阶段待核验'
}

function analysisStateFor(states: AnalysisRunState[], selected: Opportunity | undefined, moduleId: ExtensionAnalysisModuleId): AnalysisRunState | undefined {
  if (!selected) return undefined
  const normalizeSubject = (value: string) => value.replace(/[\s()（）:：,，。;；\-—_]/g, '').toLocaleLowerCase('zh-CN')
  return states.find((state) => state.opportunityId === selected.id
    && state.moduleId === moduleId
    && normalizeSubject(state.targetSubjectName) === normalizeSubject(selected.companyName))
}

const analysisStatusLabel: Record<AnalysisRunStatus, string> = {
  'not-started': '未启动', running: '运行中', partial: '部分完成', completed: '已完成', failed: '失败', stale: '结果已过期',
}

function Overview({ analysisSelection, onToggleAnalysisSelection, onSelectAllAnalysis, onClearAnalysisSelection, opportunities, archivedOpportunities, ignoredOpportunities, evidenceRecords, selected, onSelect, onOpenView, onDragObject, onArchiveOpportunity, onIgnoreOpportunity, onDeleteOpportunity }: Pick<Props, 'opportunities' | 'archivedOpportunities' | 'ignoredOpportunities' | 'evidenceRecords' | 'selected' | 'onSelect' | 'onOpenView' | 'onDragObject' | 'onArchiveOpportunity' | 'onIgnoreOpportunity' | 'onDeleteOpportunity' | 'analysisSelection' | 'scopeCleared' | 'onToggleAnalysisSelection' | 'onSelectAllAnalysis' | 'onClearAnalysisSelection'>) {
  const [activeRecord, setActiveRecord] = useState<EvidenceRecord>()
  const [pendingDelete, setPendingDelete] = useState<Opportunity>()
  if (!selected) return archivedOpportunities.length + ignoredOpportunities.length > 0
    ? <CandidateCollectionEmpty archivedCount={archivedOpportunities.length} ignoredCount={ignoredOpportunities.length} onOpenLibrary={() => onOpenView('library')} />
    : <Empty />
  function openTenderDetail(item: Opportunity) {
    onSelect(item.id)
    const record = evidenceRecords.find((candidate) => item.evidenceIds.includes(candidate.id))
    if (record) setActiveRecord(record)
  }
  return (<>
    <div className="overview-layout">
      <section className="result-stack overview-result-stack panel-surface">
        <div className="section-heading"><div><span>搜索结果</span><small>点击项目查看招标详情；勾选后可进入扩展分析，拖动可加入底部管理区</small></div><b>{opportunities.length}</b></div>
        <div className="selection-bar"><span>已选 <b>{analysisSelection.filter((id) => opportunities.some((item) => item.id === id)).length}</b> / {opportunities.length} 个项目进入模块分析范围</span><button onClick={() => onSelectAllAnalysis(opportunities.map((item) => item.id))}>全选</button><button onClick={onClearAnalysisSelection} disabled={analysisSelection.length === 0}>清空</button>
          <small className="selection-hint">勾选后进入上方模块页签（<b>时间链 / 政策链 / 产业链 / 公开风险 / 获客</b>）点「启动分析」，就<b>按勾选数量逐个分析</b>；预计调用量随项目数增加。也可以把卡片拖到底部管理区（追踪 / 对比篮 / 行动清单）。</small></div>
        <div className="result-card-grid">
          {opportunities.map((item, index) => (
            <article
              draggable
              onDragStart={(event) => startObjectDrag(event, { kind: 'opportunity', id: item.id, opportunityId: item.id, title: item.title }, onDragObject)}
              onDragEnd={() => onDragObject(undefined)}
              key={item.id}
              className={`result-row ${item.id === selected.id ? 'selected' : ''}`}
            >
              <button className="result-row-main" onClick={() => openTenderDetail(item)}>
                <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="result-row-copy"><span><b>{currentProjectStageLabel(item)}</b><em>{item.followUpLevel}</em></span><strong title={item.title}>{item.title}</strong><small><Building2 size={11} />{resolveOpportunityCompanyName(item, evidenceRecords)}</small><div><span>{formatOpportunityAmount(item.amountWan, true)}</span><span>{item.deadline ? `${item.deadline.slice(5)} 截止` : '截止待核验'}</span><span>{item.evidenceIds.length} 条证据</span></div></div>
                <b className="result-score">{IS_TRIAL_EDITION ? '—' : item.matchScore}<small>{IS_TRIAL_EDITION ? '未评分' : '匹配'}</small></b>
              </button>
              <div className="result-row-actions"><label className="result-select" title="勾选后进入时间链 / 产业链 / 获客等模块的分析范围"><input type="checkbox" checked={analysisSelection.includes(item.id)} onChange={() => onToggleAnalysisSelection(item.id)} /></label>
                <button className="row-drag-hint" onPointerDown={(event) => startPointerDrag(event, { kind: 'opportunity', id: item.id, opportunityId: item.id, title: item.title }, onDragObject)} title="拖动项目"><GripVertical size={14} /></button>
                <button onClick={() => onArchiveOpportunity(item.id)} title="归档到本机项目库"><Archive size={14} /></button>
                <button onClick={() => onIgnoreOpportunity(item.id)} title="标记为不感兴趣"><EyeOff size={14} /></button>
                <button className="danger" onClick={() => setPendingDelete(item)} title="删除本地记录"><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
    {activeRecord && <EvidenceDetailOverlay record={activeRecord} onClose={() => setActiveRecord(undefined)} />}
    {pendingDelete && <DeleteOpportunityDialog opportunity={pendingDelete} onCancel={() => setPendingDelete(undefined)} onConfirm={() => { onDeleteOpportunity(pendingDelete.id); setPendingDelete(undefined) }} />}
  </>)
}

function CandidateCollectionEmpty({ archivedCount, ignoredCount, onOpenLibrary }: { archivedCount: number; ignoredCount: number; onOpenLibrary: () => void }) {
  return <div className="candidate-collection-empty"><Archive size={34} /><strong>当前结果已清空</strong><span>{archivedCount} 个已归档，{ignoredCount} 个已标记为不感兴趣；数据仍保存在本机项目库。</span><button onClick={onOpenLibrary}>打开本机项目库<ArrowRight size={14} /></button></div>
}

function ProjectLibrary({ archived, ignored, evidenceRecords, onRestore, onDelete }: { archived: Opportunity[]; ignored: Opportunity[]; evidenceRecords: EvidenceRecord[]; onRestore: (id: string) => void; onDelete: (id: string) => void }) {
  const [tab, setTab] = useState<'archived' | 'ignored'>('archived')
  const [activeRecord, setActiveRecord] = useState<EvidenceRecord>()
  const [pendingDelete, setPendingDelete] = useState<Opportunity>()
  const items = tab === 'archived' ? archived : ignored
  function openDetails(item: Opportunity) {
    const record = evidenceRecords.find((candidate) => item.evidenceIds.includes(candidate.id))
    if (record) setActiveRecord(record)
  }
  return <>
    <div className="project-library">
      <header><div><Archive size={20} /><span><strong>所有内容保存在当前电脑</strong><small>归档项目保留证据，恢复后可继续报告和时间链；不感兴趣项目不会自动回到结果。</small></span></div><b>{archived.length + ignored.length}</b></header>
      <nav><button className={tab === 'archived' ? 'active' : ''} onClick={() => setTab('archived')}>已归档 <b>{archived.length}</b></button><button className={tab === 'ignored' ? 'active' : ''} onClick={() => setTab('ignored')}>不感兴趣 <b>{ignored.length}</b></button></nav>
      <section className="project-library-list">{items.length > 0 ? items.map((item) => <article key={item.id}>
        <div className="library-stage"><span>{currentProjectStageLabel(item)}</span><b>{IS_TRIAL_EDITION ? '—' : item.matchScore}</b></div>
        <div className="library-copy"><strong>{item.title}</strong><span><Building2 size={12} />{resolveOpportunityCompanyName(item, evidenceRecords)}</span><small>{formatOpportunityAmount(item.amountWan, true)} · {item.deadline ? `${item.deadline.slice(0, 10)} 截止` : '截止待核验'} · {item.evidenceIds.length} 条证据</small></div>
        <div className="library-actions"><button onClick={() => openDetails(item)} disabled={!evidenceRecords.some((record) => item.evidenceIds.includes(record.id))}><FileSearch size={14} />查看详情</button><button onClick={() => onRestore(item.id)}><RotateCcw size={14} />恢复到结果</button><button className="danger" onClick={() => setPendingDelete(item)}><Trash2 size={14} />删除</button></div>
      </article>) : <div className="library-empty"><Archive size={27} /><strong>{tab === 'archived' ? '还没有归档项目' : '还没有不感兴趣项目'}</strong><span>在机会总览的结果卡片上可以进行管理。</span></div>}</section>
    </div>
    {activeRecord && <EvidenceDetailOverlay record={activeRecord} onClose={() => setActiveRecord(undefined)} />}
    {pendingDelete && <DeleteOpportunityDialog opportunity={pendingDelete} onCancel={() => setPendingDelete(undefined)} onConfirm={() => { onDelete(pendingDelete.id); setPendingDelete(undefined) }} />}
  </>
}

function DeleteOpportunityDialog({ opportunity, onCancel, onConfirm }: { opportunity: Opportunity; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])
  return createPortal(<div className="delete-opportunity-overlay" role="dialog" aria-modal="true" aria-label="删除本地项目" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section><button className="delete-dialog-close" onClick={onCancel} aria-label="关闭"><X size={17} /></button><Trash2 size={28} /><span>删除本地记录</span><strong>{opportunity.title}</strong><p>将删除这条结果、无其他项目引用的证据、扩展分析状态、关注和管理区关系。以后重新搜索公开网络时仍可能再次发现。</p><div><button onClick={onCancel}>取消</button><button className="danger" onClick={onConfirm}>确认删除</button></div></section>
  </div>, document.body)
}

const radarStatusLabel: Record<RadarMatchStatus, string> = {
  match: '匹配', partial: '部分匹配', 'hard-mismatch': '硬性不匹配', unknown: '待核验',
}

function DeepRadar({ profile, opportunities, selected, failure, onSelect, onDragObject, onOpenDetails, onArchive, onIgnore, onDelete, onToggleOverview, overviewIds, evidenceReady }: {
  profile: BusinessProfile
  opportunities: Opportunity[]
  selected?: Opportunity
  failure?: string
  onSelect: (id: string) => void
  onDragObject: (object?: ManagedObject) => void
  onOpenDetails: (item: Opportunity) => void
  onArchive: (id: string) => void
  onIgnore: (id: string) => void
  onDelete: (id: string) => void
  /** 勾选即追加进总览、取消即移出（不替换原有项目）。 */
  onToggleOverview: (id: string, next: boolean) => void
  /** 当前已在总览里的结果 id。 */
  overviewIds: string[]
  evidenceReady: (id: string) => boolean
}) {
  const matches = opportunities.map((item) => ({ item, match: evaluateDeepRadarMatch(profile, item) }))
  const eligibleCount = matches.filter(({ match }) => match.eligible).length
  const hardMismatchCount = matches.length - eligibleCount
  const completedFields = [profile.name, profile.businessRegions.length, profile.companyNature, profile.scale, profile.industries.length, profile.specialties.length, profile.qualifications.length, profile.assetsAndEquipment, profile.personnelAndExperience, profile.deliveryBoundary].filter(Boolean).length
  return <div className="deep-radar-view">
    <section className="deep-radar-summary">
      <div className="radar-orbit"><Radar size={34} /><i /><i /><i /></div>
      <div><span>长期能力画像 · 本机匹配</span><strong>{profile.name || '请先在左侧填写主体画像'}</strong><p>已填写 {completedFields}/10 项；未知字段保持待核验，硬性不匹配直接淘汰，不会被综合分掩盖。</p></div>
      <div className="radar-summary-counts"><b>{eligibleCount}<small>可继续核验</small></b><b>{hardMismatchCount}<small>硬性不匹配</small></b></div>
    </section>
    {failure && <section className="analysis-launch-bar status-failed">
      <div>
        <span>本次未发起搜索</span>
        <strong>{failure}</strong>
        <small>为避免把上一轮地区结果误认成本轮结果，本轮启动时已清空未归档雷达列表；已归档项目不受影响。诊断明细见 %APPDATA%\shiji-workbench\logs\agent-intent.log。</small>
      </div>
    </section>}
    {opportunities.length === 0 ? <CapabilityNotStarted title="还没有可匹配的真实商机" copy="先填写左侧长期能力画像，再运行一次真实搜索；雷达不会使用演示机会补位。" /> : <section className="deep-radar-results panel-surface">
      <header><div><span>逐项匹配结果</span><small>模型原始匹配分仅作参考；本机硬门槛优先</small></div><b>{matches.length}</b></header>
      <div className="radar-pick-bar">
        <span>已在「总览」<b>{overviewIds.filter((id) => opportunities.some((item) => item.id === id)).length}</b> 个雷达结果</span>
        <small>在下面勾选「加入总览」＝<b>立刻追加</b>到「总览」当前结果（<b>原有项目不会被替换</b>）；取消勾选即从总览移出。到「总览」里再勾选这些项目，就能进入时间链 / 政策链 / 产业链 / 公开风险 / 获客模块做分析。</small>
      </div>
      {matches.map(({ item, match }) => {
        const ready = evidenceReady(item.id)
        return <div key={item.id}
          className={`radar-result-item ${item.id === selected?.id ? 'active' : ''} ${match.eligible ? '' : 'blocked'}`}
          draggable
          onDragStart={(event) => startObjectDrag(event, { kind: 'opportunity', id: item.id, opportunityId: item.id, title: item.title }, onDragObject)}
          onDragEnd={() => onDragObject(undefined)}
          onClick={() => onSelect(item.id)}>
          <div className="radar-result-rank"><strong>{match.score ?? '—'}</strong><span>{match.eligible ? '进入核验' : '不进入排序'}</span></div>
          <div className="radar-result-copy"><span>{currentProjectStageLabel(item)} · 模型参考 {item.matchScore}</span><strong>{item.title}</strong><p>{match.hardMismatches.length > 0 ? match.hardMismatches.join('；') : '当前没有已确认的硬性冲突；待核字段仍需查看招标详情。'}</p><div>{match.dimensions.map((dimension) => <em className={dimension.status} title={dimension.reason} key={dimension.id}>{dimension.label} · {radarStatusLabel[dimension.status]}</em>)}</div><div className="radar-result-actions">
            <label className={`radar-pick-item ${overviewIds.includes(item.id) ? 'on' : ''}`} title="勾选＝立刻加入「总览」（追加，不替换原有项目）；取消勾选＝从总览移出" onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={overviewIds.includes(item.id)} onChange={() => onToggleOverview(item.id, !overviewIds.includes(item.id))} />
              {overviewIds.includes(item.id) ? '已在总览' : '加入总览'}
            </label>
            <button data-action="open-details" title="查看详情" disabled={!ready} onClick={(event) => { event.stopPropagation(); onOpenDetails(item) }}>查看详情</button>
            <button data-action="archive" title="归档到本机项目库" onClick={(event) => { event.stopPropagation(); onArchive(item.id) }}>归档</button>
            <button data-action="ignore" title="标记为不感兴趣" onClick={(event) => { event.stopPropagation(); onIgnore(item.id) }}>忽略</button>
            <button data-action="delete" className="danger" title="删除本地雷达结果" onClick={(event) => { event.stopPropagation(); onDelete(item.id) }}>删除</button>
          </div></div>
          <button className="radar-result-open" title="查看详情" disabled={!ready} onClick={(event) => { event.stopPropagation(); onOpenDetails(item) }}><ChevronRight size={17} /></button>
        </div>
      })}
    </section>}
  </div>
}

const timelineStateLabel: Record<ProjectStageState, string> = {
  verified: '证据确认',
  expected: '预计窗口',
  unverified: '待核验',
  'overdue-unverified': '逾期未核验',
}

function Timeline({ scope, analysisRuns, watches, selected, onSelect, onStart, onSubscribe, onUnsubscribe, onRemoveFromScope, onClearResult }: { scope: Opportunity[]; analysisRuns: AnalysisRunState[]; watches: ProjectWatch[]; selected?: Opportunity; onSelect: (id: string) => void; onStart: (opportunityId: string) => void; onSubscribe: (opportunityId?: string) => void; onUnsubscribe: (id: string) => void; onRemoveFromScope: (id: string) => void; onClearResult: (id: string) => void }) {
  // 2026-09-16 用户口径（修正）：点「启动分析」后项目对象卡片收起，改为逐个项目展示本模块的
  // 分析结果卡片——时间链＝每个项目一条七阶段节点链（不是"清单 + 只画当前项目"）。
  const [objectsOpen, setObjectsOpen] = useState(false)
  const rows = scope.map((item) => ({ item, timeline: buildProjectTimeline(item.timelineEvidence ?? []), run: analysisStateFor(analysisRuns, item, 'timeline') }))
  if (rows.length === 0) return <section className="timeline-view"><Empty /></section>
  return <section className="timeline-view">
    <div className="result-object-bar">
      <span>本次分析对象</span>
      <strong>{rows.length} 个项目</strong>
      <small>{rows.map(({ item }) => item.title).join(' · ')}</small>
      <button type="button" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起项目' : '展开项目（可移出 / 清除结果）'}</button>
    </div>
    {objectsOpen && <ul className="scope-object-list result">
      {rows.map(({ item, run }) => <li key={item.id}>
        <button type="button" className="scope-title" onClick={() => onSelect(item.id)} title="切换当前项目"><strong>{item.title}</strong></button>
        <span>{item.companyName?.trim() || '主体待核验'}</span>
        <em>{currentProjectStageLabel(item)}</em>
        <small>{run ? analysisStatusLabel[run.status] : '未分析'}</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（已有结果仍保存在本机）">移出</button><button type="button" className="scope-clear" disabled={!run} onClick={() => onClearResult(item.id)} title="删除该项目的本模块分析结果（项目本身仍保留在总览与其它模块）">清除结果</button>
      </li>)}
    </ul>}
    <div className="timeline-legend">
      {(Object.entries(timelineStateLabel) as [ProjectStageState, string][]).map(([state, label]) => <span className={state} key={state}><i />{label}</span>)}
    </div>
    {rows.map(({ item, timeline: projectTimeline, run }) => {
      const currentIndex = projectTimeline.nodes.findIndex((node) => node.stageId === projectTimeline.currentVerifiedStageId)
      const current = currentIndex >= 0 ? projectTimeline.nodes[currentIndex] : undefined
      const next = (currentIndex >= 0
        ? projectTimeline.nodes.slice(currentIndex + 1)
        : projectTimeline.nodes).find((node) => node.state !== 'verified')
      const subscribed = watches.some((watch) => watch.opportunityId === item.id && watch.status === 'active')
      const running = run?.status === 'running'
      return <article className={`timeline-result-card ${item.id === selected?.id ? 'active' : ''}`} key={item.id}>
        <header>
          <div>
            <span>{run ? `${analysisStatusLabel[run.status]} · ${IS_TRIAL_EDITION ? '离线历史回放 · 无实时调用' : `实际调用 ${run.actualSearchCalls} 次搜索 / ${run.actualModelCalls} 次模型`}` : '尚未分析 · 该卡片只展示基础搜索已带回的阶段证据'}</span>
            <strong>{item.title}</strong>
            <small>{item.companyName?.trim() || '主体待核验'} · {current ? `当前证据确认到「${current.label}」` : '尚未取得可确认项目阶段的证据'}</small>
          </div>
          <em className={current ? 'verified' : ''}>{current ? current.label : '未取得阶段证据'}</em>
          <button type="button" className="card-run" disabled={running} onClick={() => onStart(item.id)}><Play size={12} />{IS_TRIAL_EDITION ? '回放历史分析' : running ? '正在检索…' : run ? '重新分析' : '启动分析'}</button>
        </header>
        {run && <p className={`analysis-state-message status-${run.status}`}>{run.message}</p>}
        <div className="timeline-scroll">
          <div className="timeline-track">
            {projectTimeline.nodes.map((node, index) => <article className={`time-node ${node.state} ${node.stageId === projectTimeline.currentVerifiedStageId ? 'current' : ''}`} key={node.stageId}>
              <span className="time-index">{String(index + 1).padStart(2, '0')}</span><i />
              <small>{node.dateLabel}</small>
              <strong>{node.label}</strong>
              <em>{timelineStateLabel[node.state]}</em>
              <p>{node.summary}</p>
              <span className="time-source">优先来源：{node.sourceHint}</span>
            </article>)}
          </div>
        </div>
        <footer>
          <span>下一步核验：{next ? next.label : '全阶段已有证据'}</span>
          <button className={subscribed ? 'subscribed' : ''} onClick={() => onSubscribe(item.id)}>{subscribed ? '已加入追踪' : '加入追踪'}</button>
          {subscribed && <button className="timeline-cancel-watch" onClick={() => onUnsubscribe(item.id)}>取消跟踪</button>}
        </footer>
      </article>
    })}
    <div className="evidence-boundary"><AlertTriangle size={14} /> 时间链只承认本地保存且达到对应阶段门槛的来源；预计时间不会自动变成已发生事实。</div>
  </section>
}

// ── 政策链结果视图（真实执行器；格式与时间链一致：每个项目一张结果卡） ──────
// 侧重点 1：政策/预算的"国家 → 省/直辖市 → 市/区县"穿透——每级显示文件、发布机关、
//            传导渠道，以及正文**点名下級**的原句（没有点名就显示"未点名下級"）。
// 侧重点 2：预测必须带依据（五年规划 / 预算年度 / 历史节奏 / 正式采购意向）；
//            没有依据时这里不会出现任何时间，只显示缺口说明。
function PolicyChainView({ scope, analysisRuns, results, selected, onSelect, onStart, onRemoveFromScope, onClearResult }: {
  scope: Opportunity[]; analysisRuns: AnalysisRunState[]; results: PolicyChainResult[]
  selected?: Opportunity; onSelect: (id: string) => void; onStart: (opportunityId: string) => void; onRemoveFromScope: (id: string) => void; onClearResult: (id: string) => void
}) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const rows = scope.map((item) => ({ item, run: analysisStateFor(analysisRuns, item, 'policy'), result: results.find((entry) => entry.opportunityId === item.id) }))
  if (rows.length === 0) return <section className="timeline-view"><Empty /></section>
  return <section className="timeline-view policy-chain-view">
    <div className="result-object-bar">
      <span>本次分析对象</span>
      <strong>{rows.length} 个项目</strong>
      <small>{rows.map(({ item }) => item.title).join(' · ')}</small>
      <button type="button" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起项目' : '展开项目（可移出 / 清除结果）'}</button>
    </div>
    {objectsOpen && <ul className="scope-object-list result">
      {rows.map(({ item, run, result }) => <li key={item.id}>
        <button type="button" className="scope-title" onClick={() => onSelect(item.id)} title="切换当前项目"><strong>{item.title}</strong></button>
        <span>{item.companyName?.trim() || '主体待核验'}</span>
        <em>{result ? `${result.findings.length} 份文件 / ${result.predictions.length} 条预测` : '未分析'}</em>
        <small>{run ? analysisStatusLabel[run.status] : '未分析'}</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（已有结果仍保存在本机）">移出</button><button type="button" className="scope-clear" disabled={!run} onClick={() => onClearResult(item.id)} title="删除该项目的本模块分析结果（项目本身仍保留在总览与其它模块）">清除结果</button>
      </li>)}
    </ul>}
            {rows.map(({ item, run, result }) => <PolicyResultCard key={item.id} item={item} run={run} result={result} active={item.id === selected?.id} onStart={onStart} />)}
    <div className="evidence-boundary"><AlertTriangle size={14} /> 政策链只做两件事：把"钱与任务从国家到地方怎么走"用原句摊开，把"下一次可能什么时候发生"连依据一起给出；两者都不改变项目阶段。</div>
  </section>
}

/** 政策链结果卡：三级政策 / 政策预测 两个横向 tab。
 *  用户口径（2026-09-17）：政策条目多、列表长，预测被埋在下面用户看不到；
 *  因此把预测提到与三级政策并列的 tab（带计数与提示点），并给三级政策底部加一行跳转引导。
 *  启动分析按钮仍在卡头右侧（与其它模块一致）；跑完默认停在「三级政策」，不自动跳转打断阅读。 */
function PolicyResultCard({ item, run, result, active, onStart }: {
  item: Opportunity; run?: AnalysisRunState; result?: PolicyChainResult; active: boolean; onStart: (opportunityId: string) => void
}) {
  const [tab, setTab] = useState<'levels' | 'predictions'>('levels')
  return   <article className={`policy-result-card ${active ? 'active' : ''}`}>
        <header>
          <div>
            <span>{run ? `${analysisStatusLabel[run.status]} · ${runCallSummary(run, result)}` : '尚未分析'}</span>
            <strong>{item.title}</strong>
            <small>{item.companyName?.trim() || '主体待核验'} · {result ? `行业：${result.industry}` : '等待启动政策链检索'}</small>
          </div>
          <em className={result && result.findings.length > 0 ? 'verified' : ''}>{result ? `${result.findings.length} 份政策/预算文件` : '未取得'}</em>
          <button type="button" className="card-run" disabled={run?.status === 'running'} onClick={() => onStart(item.id)}><Play size={12} />{IS_TRIAL_EDITION ? '再次回放' : run?.status === 'running' ? '正在检索…' : run ? '重新分析' : '启动分析'}</button>
        </header>
        {run && <p className={`analysis-state-message status-${run.status}`}>{run.message}</p>}
        {result
          ? <>
            <nav className="policy-tabs">
          <button type="button" className={tab === 'levels' ? 'active' : ''} onClick={() => setTab('levels')}>三级政策<b>{result.findings.length}</b></button>
          <button type="button" className={tab === 'predictions' ? 'active' : ''} onClick={() => setTab('predictions')}>政策预测<b>{result.predictions.length}</b>{result.predictions.length > 0 && <i className="policy-tab-dot" />}</button>
        </nav>
        {tab === 'levels'
          ? <>
            <PolicyLadder result={result} />
            {result.predictions.length > 0 && <button type="button" className="policy-tab-hint" onClick={() => setTab('predictions')}>还有 {result.predictions.length} 条「下一可能节点」预测（含依据与观察信号），点这里查看</button>}
          </>
          : <section className="policy-predictions">
            <header><span>下一可能节点（预测）</span><small>{result.predictions.length > 0 ? `${result.predictions.filter((entry) => entry.certainty === 'forecast').length} 条预测性建议 / ${result.predictions.filter((entry) => entry.certainty === 'confirmed').length} 条正式公开节点` : '本次没有可支撑预测的依据，未输出任何预测时间'}</small></header>
            {result.predictions.map((prediction) => <PolicyPredictionCard prediction={prediction} key={prediction.id} />)}
            {result.predictions.length === 0 && <p className="policy-boundary">没有预算年度文件、历史采购节奏或正式采购意向作依据时，不输出预测时间。</p>}
          </section>}
            {visibleGaps(result.gaps).length > 0 && <ul className="policy-gaps">{visibleGaps(result.gaps).map((gap) => <li key={gap}><AlertTriangle size={12} />{gap}</li>)}</ul>}
            <p className="policy-boundary"><ShieldAlert size={13} />{result.boundary}</p>
          </>
          : <p className="policy-boundary"><AlertTriangle size={13} />本项目还没有政策链结果；点右上「启动分析」按国家 / 省 / 市三级检索政策与预算文件。</p>}
    </article>
  }

function PolicyLadder({ result }: { result: PolicyChainResult }) {
  return <div className="policy-ladder">
    {result.regionPath.map((level) => {
      const findings = result.findings.filter((finding) => finding.levelId === level.id)
      const penetrated = findings.flatMap((finding) => finding.penetration)
      return <section className={`policy-level ${findings.length > 0 ? 'filled' : 'empty'}`} key={level.id}>
        <header>
          <span>{level.label}</span>
          <b>{findings.length} 份</b>
          <small>{penetrated.length > 0 ? `点名下級 ${new Set(penetrated.map((link) => link.targetLabel)).size} 处` : '未点名下級'}</small>
        </header>
        {findings.length === 0
          ? <p>本次未检索到可核验的政策/预算文件。</p>
          : findings.map((finding) => <PolicyFindingCard finding={finding} key={finding.id} />)}
      </section>
    })}
  </div>
}

function PolicyFindingCard({ finding }: { finding: PolicyFinding }) {
  const source = finding.sources[0]
  return <article className={`policy-finding ${finding.kind}`}>
    <div className="policy-finding-head">
      <em>{finding.kind === 'budget' ? '预算/资金' : '政策文件'}</em>
      <strong>{source?.pageUrl ? <a href={source.pageUrl} target="_blank" rel="noreferrer">{finding.title}</a> : finding.title}</strong>
      <i className={finding.sourceTier}>{finding.sourceTier === 'official' ? '官方原文' : '媒体转载·仅参考'}</i>
      <b className={`confidence-${finding.confidence}`}>{finding.confidence === 'high' ? '依据完整' : finding.confidence === 'medium' ? '部分字段' : '线索'}</b>
    </div>
    <div className="policy-finding-meta">
      <span><small>发布机关</small>{finding.publisher || '未取得'}</span>
      <span><small>文号</small>{finding.documentNumber ?? '未取得'}</span>
      <span><small>生效/执行</small>{finding.effectiveAt ?? '未取得'}</span>
      <span><small>渠道</small>{finding.instruments.length > 0 ? finding.instruments.join('、') : '未识别具体资金渠道'}</span>
    </div>
    <p className="policy-transmission">{finding.transmission}</p>
    {finding.penetration.map((link) => <blockquote className="policy-penetration" key={`${finding.id}-${link.targetLabel}`}><span>穿透到「{link.targetLabel}」的原文</span>{link.quote}</blockquote>)}
  </article>
}

function PolicyPredictionCard({ prediction }: { prediction: PolicyPrediction }) {
  return <article className={`policy-prediction ${prediction.certainty}`}>
    <div className="policy-prediction-head">
      <strong>{prediction.label}</strong>
      <b className={prediction.certainty}>{prediction.certainty === 'confirmed' ? '正式公开节点' : '预测性建议'}</b>
      <em>{prediction.windowStart === prediction.windowEnd ? prediction.windowStart : `${prediction.windowStart} ~ ${prediction.windowEnd}`}</em>
    </div>
    <p><small>依据（{prediction.basisKind === 'five-year-plan' ? '五年规划' : prediction.basisKind === 'budget-document' ? '预算年度文件' : prediction.basisKind === 'historical-cadence' ? '历史采购节奏' : prediction.basisKind === 'implementation-plan' ? '地方实施计划' : '正式采购意向'}）</small>{prediction.basis}</p>
    {prediction.signals.length > 0 && <p className="policy-signals"><small>继续观察</small>{prediction.signals.join('；')}</p>}
  </article>
}

// ── 产业链结果视图（真实执行器；格式与时间链/政策链一致：每个项目一张结果卡） ──
// 用户口径：核心节点＝发布招标的甲方公司；只做"以往中标企业"和"上下游供应链"两块；
// 每家公司只给四个维度（公司名称 / 法人 / 行业领域 / 联系方式），抽不到显示"未取得"。
// 本模块不画图、不碰地图。
function IndustryChainView({ scope, analysisRuns, results, selected, onSelect, onStart, onRemoveFromScope, onClearResult }: {
  scope: Opportunity[]; analysisRuns: AnalysisRunState[]; results: IndustryChainResult[]
  selected?: Opportunity; onSelect: (id: string) => void; onStart: (opportunityId: string) => void; onRemoveFromScope: (id: string) => void; onClearResult: (id: string) => void
}) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const rows = scope.map((item) => ({ item, run: analysisStateFor(analysisRuns, item, 'industry'), result: results.find((entry) => entry.opportunityId === item.id) }))
  if (rows.length === 0) return <section className="timeline-view"><Empty /></section>
  return <section className="timeline-view industry-chain-view">
    <div className="result-object-bar">
      <span>本次分析对象</span>
      <strong>{rows.length} 个项目</strong>
      <small>{rows.map(({ item }) => item.title).join(' · ')}</small>
      <button type="button" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起项目' : '展开项目（可移出 / 清除结果）'}</button>
    </div>
    {objectsOpen && <ul className="scope-object-list result">
      {rows.map(({ item, run, result }) => <li key={item.id}>
        <button type="button" className="scope-title" onClick={() => onSelect(item.id)} title="切换当前项目"><strong>{item.title}</strong></button>
        <span>{item.companyName?.trim() || '主体待核验'}</span>
        <em>{result ? `中标 ${result.winners.length} / 供应链 ${result.suppliers.length}` : '未分析'}</em>
        <small>{run ? analysisStatusLabel[run.status] : '未分析'}</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（已有结果仍保存在本机）">移出</button><button type="button" className="scope-clear" disabled={!run} onClick={() => onClearResult(item.id)} title="删除该项目的本模块分析结果（项目本身仍保留在总览与其它模块）">清除结果</button>
      </li>)}
    </ul>}
    {rows.map(({ item, run, result }) => <article className={`industry-result-card ${item.id === selected?.id ? 'active' : ''}`} key={item.id}>
      <header>
        <div>
          <span>{run ? `${analysisStatusLabel[run.status]} · ${runCallSummary(run, result)}` : '尚未分析'}</span>
          <strong>{item.title}</strong>
          <small>甲方：{result?.owner.name || item.companyName?.trim() || '主体待核验'}</small>
        </div>
        {result && <em className={result.winners.length + result.suppliers.length > 0 ? 'verified' : ''}>中标 {result.winners.length} / 供应链 {result.suppliers.length}</em>}
        <button type="button" className="card-run" disabled={run?.status === 'running'} onClick={() => onStart(item.id)}><Play size={12} />{IS_TRIAL_EDITION ? '再次回放' : run?.status === 'running' ? '正在检索…' : run ? '重新分析' : '启动分析'}</button>
      </header>
      {run && <p className={`analysis-state-message status-${run.status}`}>{run.message}</p>}
      {result
        ? <>
          <section className="industry-block">
            <header><span>甲方（招标/建设主体）</span></header>
            <IndustryTable companies={[{ id: `owner:${result.opportunityId}`, name: result.owner.name, legalPerson: result.owner.legalPerson, industryField: result.owner.industryField, phone: result.owner.phone, sources: result.owner.sources, primary: true }]} />
          </section>
          <section className="industry-block">
            <header><span>以往中标企业</span><b>{result.winners.length}</b><small>来自中标/成交公告正文</small></header>
            {result.winners.length === 0
              ? <p className="industry-empty">本次未取得可核验的中标企业。</p>
              : <IndustryTable companies={result.winners.map((company) => ({ ...company, quote: company.relationQuote, relationLabel: INDUSTRY_RELATION_LABELS[company.relation] }))} />}
          </section>
          <section className="industry-block">
            <header><span>上下游供应链</span><b>{result.suppliers.length}</b><small>供应商 / 分包 / 联合体 / 代理（多为线索级）</small></header>
            {result.suppliers.length === 0
              ? <p className="industry-empty">本次未取得可核验的上下游企业。</p>
              : <IndustryTable companies={result.suppliers.map((company) => ({ ...company, quote: company.relationQuote, relationLabel: INDUSTRY_RELATION_LABELS[company.relation] }))} />}
          </section>
          {visibleGaps(result.gaps).length > 0 && <ul className="policy-gaps">{visibleGaps(result.gaps).map((gap) => <li key={gap}><AlertTriangle size={12} />{gap}</li>)}</ul>}
          <p className="policy-boundary"><ShieldAlert size={13} />{result.boundary}　"—"＝公开来源未写明，不推测；鼠标悬停某一行可看关系原句。</p>
        </>
        : <p className="policy-boundary"><AlertTriangle size={13} />本项目还没有产业链结果；点右上「启动分析」按甲方检索历史中标与上下游企业。</p>}
    </article>)}
    <div className="evidence-boundary"><AlertTriangle size={14} /> 产业链只展示公开来源里写明的企业；四维度抽不到就留"—"，联系方式本模块只要求电话，多渠道穿透留给获客模块。</div>
  </section>
}

/** 产业链在 2.5D 图接入前使用结构化企业卡：名称与关系在头部，四类事实各自带标签。 */
function IndustryTable({ companies }: { companies: IndustryRowData[] }) {
  return <div className={`industry-card-grid ${companies.length === 1 ? 'single' : ''}`}>
    {companies.map((company) => <IndustryCompanyRow key={company.id} company={company} />)}
  </div>
}

function GlobalActivityIndicator({ activities }: { activities: { id: number; label: string }[] }) {
  const latest = activities.at(-1)
  if (!latest) return null
  return <div className="global-activity" role="status" aria-live="polite" aria-label={`${latest.label}，正在运行`}>
    <span className="global-activity-spinner" aria-hidden="true" />
    <span className="global-activity-copy"><strong>{latest.label}</strong><small>{activities.length > 1 ? `另有 ${activities.length - 1} 项任务同时运行` : '正在运行 · 完成后自动收起'}</small></span>
    <span className="global-activity-track" role="progressbar" aria-label="任务进度" aria-valuetext="处理中"><i /></span>
  </div>
}

function runTrackedAction(onActivityStart: Props['onActivityStart'], label: string, action: () => void | Promise<void>) {
  return async () => {
    const finish = onActivityStart(label)
    try { await action() } finally { finish() }
  }
}

interface IndustryRowData {
  id: string
  name: string
  legalPerson?: string
  industryField?: string
  phone?: string
  sources: Array<{ title: string; pageUrl?: string; tier: 'official' | 'registry' | 'media' }>
  quote?: string
  relationLabel?: string
  confidence?: 'confirmed' | 'candidate'
  primary?: boolean
}

function IndustryCompanyRow({ company }: { company: IndustryRowData }) {
  const main = company.sources[0]
  const tip = [company.relationLabel, company.quote, main ? `来源：${main.title}` : undefined].filter(Boolean).join('｜')
  return <article className={`industry-company-card ${company.primary ? 'primary' : ''}`} title={tip || undefined}>
    <header>
      <div><span>{company.primary ? '核心主体' : company.relationLabel ?? '关联企业'}</span><strong>{main?.pageUrl ? <a href={main.pageUrl} target="_blank" rel="noreferrer">{company.name}<ExternalLink size={11} /></a> : company.name}</strong></div>
      <div className="industry-card-badges">{company.primary && <em>甲方</em>}{company.confidence && <b className={company.confidence}>{company.confidence === 'confirmed' ? '公告确认' : '关系线索'}</b>}</div>
    </header>
    <dl>
      <div><dt>联系电话</dt><dd>{company.phone ?? '未取得'}</dd></div>
      <div><dt>法定代表人</dt><dd>{company.legalPerson ?? '未取得'}</dd></div>
      <div className="wide"><dt>行业领域</dt><dd>{company.industryField ?? '未取得'}</dd></div>
      <div className="wide"><dt>证据来源</dt><dd>{main?.pageUrl ? <a href={main.pageUrl} target="_blank" rel="noreferrer">{INDUSTRY_SOURCE_LABELS[main.tier]} · {main.title}<ExternalLink size={10} /></a> : main ? `${INDUSTRY_SOURCE_LABELS[main.tier]} · ${main.title}` : '未取得'}</dd></div>
    </dl>
    {company.quote && <details className="industry-relation-evidence"><summary>查看关系原文</summary><p>{company.quote}</p></details>}
  </article>
}

// ── 公开风险结果视图（真实执行器；格式与产业链一致：每个项目一张结果卡） ──────
// 用户口径：对象＝发布招标的招标单位；政府机关/事业单位同样受理（没有工商注册信息时改看
// 机构登记与行政诉讼）；主体资料与风险事实分层成卡片，避免表格重复主体字段，
// 每条事实必须把“发生了什么”、时间和来源一起展示清楚。
function CreditRiskView({ scope, analysisRuns, results, selected, onSelect, onStart, onRemoveFromScope, onClearResult }: {
  scope: Opportunity[]; analysisRuns: AnalysisRunState[]; results: CreditRiskResult[]
  selected?: Opportunity; onSelect: (id: string) => void; onStart: (opportunityId: string) => void; onRemoveFromScope: (id: string) => void; onClearResult: (id: string) => void
}) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const rows = scope.map((item) => ({ item, run: analysisStateFor(analysisRuns, item, 'risk'), result: results.find((entry) => entry.opportunityId === item.id) }))
  if (rows.length === 0) return <section className="timeline-view"><Empty /></section>
  return <section className="timeline-view credit-risk-view">
    <div className="result-object-bar">
      <span>本次分析对象</span>
      <strong>{rows.length} 个项目</strong>
      <small>{rows.map(({ item }) => item.companyName?.trim() || item.title).join(' · ')}</small>
      <button type="button" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起项目' : '展开项目（可移出 / 清除结果）'}</button>
    </div>
    {objectsOpen && <ul className="scope-object-list result">
      {rows.map(({ item, run, result }) => <li key={item.id}>
        <button type="button" className="scope-title" onClick={() => onSelect(item.id)} title="切换当前项目"><strong>{item.title}</strong></button>
        <span>{item.companyName?.trim() || '主体待核验'}</span>
        <em>{result ? `${result.facts.length} 条风险事实` : '未分析'}</em>
        <small>{run ? analysisStatusLabel[run.status] : '未分析'}</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（已有结果仍保存在本机）">移出</button><button type="button" className="scope-clear" disabled={!run} onClick={() => onClearResult(item.id)} title="删除该项目的本模块分析结果（项目本身仍保留在总览与其它模块）">清除结果</button>
      </li>)}
    </ul>}
    {rows.map(({ item, run, result }) => <article className={`credit-risk-card ${item.id === selected?.id ? 'active' : ''}`} key={item.id}>
      <header>
        <div>
          <span>{run ? `${analysisStatusLabel[run.status]} · ${runCallSummary(run, result)}` : '尚未分析'}</span>
          <strong>{item.title}</strong>
          <small>招标单位：{result?.subjectName || item.companyName?.trim() || '主体待核验'}</small>
        </div>
        {result && <em className={result.facts.length > 0 ? 'attention' : ''}>{result.facts.length > 0 ? `${result.facts.length} 条风险事实` : IS_TRIAL_EDITION ? '未取得可核风险事实' : '未发现公开记录'}</em>}
        <button type="button" className="card-run" disabled={run?.status === 'running'} onClick={() => onStart(item.id)}><Play size={12} />{IS_TRIAL_EDITION ? '再次回放' : run?.status === 'running' ? '正在检索…' : run ? '重新分析' : '启动分析'}</button>
      </header>
      {run && <p className={`analysis-state-message status-${run.status}`}>{run.message}</p>}
      {result
        ? <>
          <section className="industry-block">
            <header><span>主体基础信息</span><small>来自公开登记页；"—"＝公开来源未写明</small></header>
            <div className="risk-subject-card">
              <div className="risk-subject-name">
                <strong>{result.profile.sourceUrl ? <a href={result.profile.sourceUrl} target="_blank" rel="noreferrer">{result.profile.name}</a> : result.profile.name}</strong>
                <em>{SUBJECT_TYPE_LABELS[result.profile.subjectType] ?? '待核验'}</em>
                {result.profile.industry ? <small>{result.profile.industry}</small> : null}
                {result.profile.registrationStatus ? <small>登记状态 {result.profile.registrationStatus}</small> : null}
              </div>
              <dl>
                <div><dt>{result.profile.codeLabel}</dt><dd>{result.profile.code ?? '—'}</dd></div>
                <div><dt>法人</dt><dd>{result.profile.legalPerson ?? '—'}</dd></div>
                <div className="wide"><dt>地址</dt><dd>{result.profile.address ?? '—'}</dd></div>
                <div><dt>联系方式</dt><dd>{result.profile.phone ?? '—'}</dd></div>
              </dl>
            </div>
          </section>
          <section className="industry-block">
            <header><span>公开风险事实</span><b>{result.facts.length}</b><small>只写来源里写明的事由，不作结论</small></header>
            {result.facts.length === 0
              ? <p className="industry-empty">本次未取得可核验的公开风险记录（搜不到不等于没有风险）。</p>
              : <div className="risk-fact-list">
                {result.facts.filter((fact) => !fact.leadOnly && !fact.reason.includes('来源未写明具体事由')).map((fact) => <CreditRiskFactRow fact={fact} key={fact.id} />)}
              </div>}
          </section>
          {result.facts.some((fact) => fact.leadOnly || fact.reason.includes('来源未写明具体事由')) && <p className="risk-lead-only">聚合站栏目级记录 {result.facts.filter((fact) => fact.leadOnly || fact.reason.includes('来源未写明具体事由')).length} 项（只有栏目名、无正文，故不列事由）：{[...new Set(result.facts.filter((fact) => fact.leadOnly || fact.reason.includes('来源未写明具体事由')).map((fact) => fact.categoryLabel))].join('、')}</p>}
          {result.inferences && result.inferences.length > 0 && <section className="industry-block">
            <header><span>模型推断</span><b>{result.inferences.length}</b><small>不是证据：每条都写了依据与置信度</small></header>
            <div className="risk-inferences">
              {result.inferences.map((item) => <div key={item.claim}>
                <em className={item.confidence}>{item.confidence === 'high' ? '高' : item.confidence === 'medium' ? '中' : '低'}</em>
                <span>{item.claim}</span>
                <small>依据：{item.basis}</small>
              </div>)}
            </div>
          </section>}
          {result.openQuestions && result.openQuestions.length > 0 && <section className="industry-block">
            <header><span>待查事项</span><b>{result.openQuestions.length}</b><small>公开渠道没查到的部分，如实列出</small></header>
            <ul className="risk-open-questions">{result.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>}          {result.verifications && result.verifications.length > 0 && <section className="industry-block">
            <header><span>核查结论</span><b>{result.verifications.length}</b><small>查无记录的类别也明确写出，避免误解成"没查"</small></header>
            <div className="risk-verifications">
            {result.assessment && <p className="risk-assessment"><b>模型判断</b><span>{result.assessment}</span></p>}
              {result.verifications.map((item) => <div key={item.category}>
                <b>{item.label}</b>
                <span>{item.conclusion}</span>
                <small>{item.basis}</small>
              </div>)}
            </div>
          </section>}          {visibleGaps(result.gaps).length > 0 && <ul className="policy-gaps">{visibleGaps(result.gaps).map((gap) => <li key={gap}><AlertTriangle size={12} />{gap}</li>)}</ul>}
          <p className="policy-boundary"><ShieldAlert size={13} />{result.boundary}　机构类型：{result.profile.subjectTypeBasis}。</p>
        </>
        : <p className="policy-boundary"><AlertTriangle size={13} />本项目还没有公开风险结果；点右上「启动分析」对招标单位做工商与公开风险检索。</p>}
    </article>)}
    <div className="evidence-boundary"><AlertTriangle size={14} /> 公开风险只展示公开来源里写明的主体与事项；政府机关、事业单位无工商注册信息属正常，改看机构登记与行政诉讼。</div>
  </section>
}

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  enterprise: '企业',
  government: '政府机关',
  'public-institution': '事业单位',
  unknown: '待核验',
}

function CreditRiskFactRow({ fact }: { fact: CreditRiskFact }) {
  // 用户口径：事由列要么给出"案情＋时间地点＋结果"的简述，要么必须给可公开访问的原文链接；
  // 来源列直接给出原文链接；聚合站已在上游被排除。
  const summary = composeCreditFactSummary(fact) ?? fact.reason
  const amount = fact.amount ? `，罚没 ${fact.amount}` : ''
  const authority = fact.authority ? `｜${fact.authority}` : ''
  const docNo = fact.documentNumber ? `｜${fact.documentNumber}` : ''
  const tierLabel = fact.tier === 'official' ? '官方' : fact.tier === 'registry' ? '工商' : '媒体'
  const locationText = fact.location && !summary.includes(fact.location) ? `，地点 ${fact.location}` : ''
  const caseParts = [fact.caseInfo?.caseNumber ? `案号 ${fact.caseInfo.caseNumber}` : '', fact.caseInfo?.court ?? fact.caseInfo?.stage ?? ''].filter(Boolean)
  const caseText = caseParts.length > 0 ? `，${caseParts.join('，')}` : ''
  const resultParts = [fact.authority ? `由${fact.authority}作出` : '', fact.documentNumber ?? ''].filter(Boolean)
  const resultText = resultParts.length > 0 ? `，结果：${resultParts.join('，')}` : ''
  return <article className="risk-fact-card" title={`${fact.sourceTitle}${authority}${docNo}`}>
    <header>
      <div><b className={`risk-category ${fact.category}`}>{CREDIT_RISK_CATEGORY_LABELS[fact.category] ?? fact.categoryLabel}</b>{fact.subjectScope === 'individual' && <b className="risk-individual">高管个人·不罚公司</b>}</div>
      <time>{fact.occurredAt ?? '时间未取得'}</time>
    </header>
    <strong>{fact.subjectName}</strong>
    <p>{fact.reason.length >= 30 && fact.reason.includes('，') ? fact.reason : `${summary}${locationText}${amount}${caseText}${resultText}`}</p>
    <footer>
      <span>{fact.authority ? `发布/处理机关：${fact.authority}` : '发布/处理机关未取得'}{fact.documentNumber ? ` · ${fact.documentNumber}` : ''}</span>
      {fact.sourceUrl
        ? <a href={fact.sourceUrl} target="_blank" rel="noreferrer" title={`${fact.sourceTitle}｜${fact.publisher}`}>{tierLabel}来源 · 查看原文<ExternalLink size={10} /></a>
        : <em>{tierLabel}来源</em>}
    </footer>
  </article>
}

/** 内部检索过程文案不上屏：逐组检索失败、模型校验计数这类只留给自己看。 */
// 调用口径（用户 2026-09-17）：真的检索过（含走本机缓存）才算成功；一次都没搜必须显示失败。
// 命中缓存时统一用 formatCachedResultLabel，避免和"失败 · 0 次调用"混淆。
function runCallSummary(run: AnalysisRunState, result?: { requestCount: number; cacheHit: boolean; checkedAt: string }): string {
  if (IS_TRIAL_EDITION) return '离线历史回放 · 无实时调用'
  if (result) {
    const outcome = runCallOutcome(result)
    if (outcome === 'cached') return formatCachedResultLabel(result.checkedAt)
    if (outcome === 'no-search') return '本次没有发起检索'
  }
  return `实际调用 ${run.actualSearchCalls} 次搜索 / ${run.actualModelCalls} 次模型`
}

function visibleGaps(gaps: string[]): string[] {
  // 只保留对用户有意义的缺口：检索组、模型轮次与判断、线索统计、工商核对过程一律不上卡片，
  // 它们的完整留痕在 %APPDATA%\shiji-workbench\logs\credit-risk.log（旧结果里已存的过程行也在这里被挡掉）。
  return gaps.filter((gap) => !/^(第 \d+ 组检索|模型|已提取 |已对 |「.+」(已改用公开来源|的工商信息本次未取得))/.test(gap))
}

/** 与 shared/credit-risk.ts 的 composeFactSummary 同口径的前端内联版。 */
function composeCreditFactSummary(fact: CreditRiskFact): string | undefined {
  const reason = fact.reason.replace('（来源未写明具体事由）', '').trim()
  if (reason.length < 4 || reason === fact.categoryLabel) return undefined
  const head = fact.occurredAt ? `${fact.occurredAt}，` : ''
  const where = fact.location ? `（${fact.location}）` : ''
  return `${head}${reason}${where}`
}

function Policy() {
  const policies = [
    ['国家层', '城市更新与新型基础设施', 84, '方向支持', '官方政策'],
    ['上海市', '重点产业园区提质增效', 91, '强关联', '年度计划'],
    ['临港片区', '科创载体建设实施细则', 76, '待核细节', '实施文件'],
  ]
  return <div className="policy-layout"><section className="policy-radar panel-surface"><div className="radar-rings"><span>政策<br />共振</span><i /><i /><i /></div><div><span>综合支持强度</span><strong>86</strong><p>三层政策方向一致，但具体资金来源仍需以正式文件为准。</p></div></section><section className="policy-list panel-surface">{policies.map(([level, title, score, state, source]) => <div className="policy-row" key={String(level)}><span>{String(level)}</span><div><strong>{String(title)}</strong><small>{String(source)}</small><i><b style={{ width: `${score}%` }} /></i></div><em>{String(state)}</em><b>{String(score)}</b></div>)}</section></div>
}

function Industry({ selected }: { selected?: Opportunity }) {
  if (!selected) return <Empty />
  const graph = businessGraphForOpportunity(selected)
  return <section className="industry-view"><div className="graph-toolbar"><div><span>集团组织 + 产业关系 · 2.5D 工作视图</span><strong>{graph.project.name}</strong></div><div><i className="legend core" />项目<i className="legend primary" />已确认<i className="legend secondary" />关系线索</div></div><Suspense fallback={<div className="graph-loading">正在加载关系画布…</div>}><IndustryGraph key={graph.project.id} graph={graph} /></Suspense><div className="graph-side-note"><Waypoints size={17} /><div><strong>图谱与获客共用关系</strong><span>节点可拖动；联系方式只显示公开来源提取值，缺失时明确标记待提取。</span></div></div></section>
}

function Risk({ selected, request, analysisRun, onAnalysisRun, onActivityStart }: { selected?: Opportunity; request?: { subjectName: string; focus: string; nonce: number }; analysisRun?: AnalysisRunState; onAnalysisRun: (state: AnalysisRunState) => void; onActivityStart: Props['onActivityStart'] }) {
  const company = selected ? companyForOpportunity(selected) : undefined
  const [subjectName, setSubjectName] = useState(request?.subjectName || company?.name || '')
  const [focus, setFocus] = useState(request?.focus ?? '查询工商基础信息，以及近一年发生的行政处罚、经营异常、严重违法失信和失信被执行记录')
  const [discovery, setDiscovery] = useState<BusinessCreditDiscoveryResult>()
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [importing, setImporting] = useState(false)
  const [localEvidence, setLocalEvidence] = useState<LocalEvidenceRecord[]>([])
  const [localEvidenceTexts, setLocalEvidenceTexts] = useState<Record<string, string>>({})
  const [reviews, setReviews] = useState<BusinessCreditReviewDecision[]>([])
  const [reviewingDimension, setReviewingDimension] = useState<CreditCheckDimension>()
  const [reviewEvidenceKey, setReviewEvidenceKey] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [defaultProvider, setDefaultProvider] = useState<UserSearchProviderId>('doubao')
  const [notice, setNotice] = useState(analysisRun?.message ?? '尚未执行真实工商信用发现。')
  useEffect(() => {
    let active = true
    void window.shijiDesktop?.search.getPreference().then((response) => {
      if (active && response.ok) setDefaultProvider(response.value.defaultProvider)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const defaultSubjectName = request?.subjectName || company?.name || ''
    const contextId = selected?.id ?? 'standalone-business-credit'
    const savedDiscovery = loadBusinessCreditDiscovery(contextId, defaultSubjectName)
    setSubjectName(defaultSubjectName)
    if (request?.focus) setFocus(request.focus)
    setDiscovery(savedDiscovery)
    setReviews(loadBusinessCreditReviews(contextId, defaultSubjectName))
    setReviewingDimension(undefined)
    setConfirming(false)
    setNotice(savedDiscovery ? `已恢复 ${savedDiscovery.report.candidateSources.length} 条本机保存的公开参考，可重新运行刷新。` : '尚未执行真实工商信用发现。')
    let active = true
    if (company?.name && window.shijiDesktop?.evidence) {
      void window.shijiDesktop.evidence.list(company.name).then(async (response) => {
        if (!active || !response.ok) return
        setLocalEvidence(response.value)
        const textEntries = await Promise.all(response.value.filter((item) => item.processingStatus === 'content-ready').map(async (item) => {
          const textResponse = await window.shijiDesktop!.evidence.readText(item.id)
          return textResponse.ok ? [item.id, textResponse.value.text] as const : undefined
        }))
        if (active) setLocalEvidenceTexts(Object.fromEntries(textEntries.filter((item): item is readonly [string, string] => Boolean(item))))
      })
    } else {
      setLocalEvidence([])
      setLocalEvidenceTexts({})
    }
    return () => { active = false }
  }, [company?.id, company?.name, request?.nonce])
  useEffect(() => {
    if (analysisRun) setNotice(analysisRun.message)
  }, [analysisRun?.updatedAt, analysisRun?.message])
  const contextId = selected?.id ?? 'standalone-business-credit'
  const localCreditEvidence = localEvidence.flatMap<LocalCreditEvidence>((item) => localEvidenceTexts[item.id]
    ? [{ id: item.id, subjectName: item.subjectName, title: item.extraction?.title ?? item.fileName, text: localEvidenceTexts[item.id] }]
    : [])
  const activeDiscovery = discovery?.report.subjectName === subjectName.trim() ? discovery : undefined
  function reviewEvidenceOptions(dimension: CreditCheckDimension) {
    const sources = activeDiscovery?.report.candidateSources ?? []
    return [
      ...sources.map((source) => ({
        key: `web:${source.url}`, label: source.title?.trim() || creditSourceHost(source.url),
        ref: { kind: 'web' as const, url: source.url },
        canRecordFound: canBusinessCreditEvidenceSupportReview(subjectName, dimension, 'record-found', { kind: 'web', url: source.url }, sources, localCreditEvidence),
        canVerifyClear: canBusinessCreditEvidenceSupportReview(subjectName, dimension, 'verified-clear', { kind: 'web', url: source.url }, sources, localCreditEvidence),
      })),
      ...localEvidence.filter((item) => item.processingStatus === 'content-ready').map((item) => ({
        key: `local:${item.id}`, label: item.extraction?.title ?? item.fileName,
        ref: { kind: 'local' as const, id: item.id },
        canRecordFound: canBusinessCreditEvidenceSupportReview(subjectName, dimension, 'record-found', { kind: 'local', id: item.id }, sources, localCreditEvidence),
        canVerifyClear: canBusinessCreditEvidenceSupportReview(subjectName, dimension, 'verified-clear', { kind: 'local', id: item.id }, sources, localCreditEvidence),
      })),
    ].filter((item) => item.canRecordFound || item.canVerifyClear)
  }
  const report = buildCreditDiscoveryReport(
    subjectName || company?.name || '',
    activeDiscovery?.report.candidateSources ?? [],
    activeDiscovery?.report.generatedAt ?? localEvidence[0]?.importedAt,
    localCreditEvidence,
    reviews,
  )
  const statusCopy: Record<CreditCheckStatus, string> = {
    'record-found': '有公开记录',
    'verified-clear': '已核验未发现',
    unverified: '本次未取得',
  }
  async function discoverCredit() {
    const search = window.shijiDesktop?.search
    if (!search) return setNotice('浏览器预览不能运行真实工商信用发现。')
    const targetSubjectName = subjectName.trim()
    setConfirming(false)
    setRunning(true)
    setDiscovery(undefined)
    setNotice('正在执行 1 次受限搜索；结果只作为待核验证据…')
    if (selected) onAnalysisRun({ opportunityId: selected.id, moduleId: 'risk', targetSubjectName, status: 'running', updatedAt: new Date().toISOString(), message: '正在执行 1 次豆包工商档案发现。', actualSearchCalls: 0, actualModelCalls: 0 })
    try {
      const response = await search.discoverBusinessCredit(targetSubjectName, undefined, focus.trim())
      if (!response.ok) {
        setNotice(response.message)
        if (selected) onAnalysisRun({ opportunityId: selected.id, moduleId: 'risk', targetSubjectName, status: 'failed', updatedAt: new Date().toISOString(), message: response.message, actualSearchCalls: 0, actualModelCalls: 0 })
        return
      }
      setDiscovery(response.value)
      saveBusinessCreditDiscovery(contextId, response.value)
      const found = response.value.report.checks.filter((check) => check.status === 'record-found').length
      const references = response.value.report.candidateSources.length
      const resultNotice = found > 0
        ? `发现 ${found} 项机构候选记录，并保留全部 ${references} 条公开参考；仍需打开原文核验。`
        : references > 0
          ? `找到 ${references} 条公开知识参考；尚未达到事实核验门槛，但不会丢弃。`
          : '没有找到公开参考；所有事项保持“未核验”，不代表无风险。'
      setNotice(resultNotice)
      if (selected) onAnalysisRun({ opportunityId: selected.id, moduleId: 'risk', targetSubjectName, status: 'partial', updatedAt: response.value.checkedAt, message: resultNotice, actualSearchCalls: response.value.requestCount, actualModelCalls: 0 })
    } catch {
      const failure = '工商信用发现通道异常，未生成结论。'
      setNotice(failure)
      if (selected) onAnalysisRun({ opportunityId: selected.id, moduleId: 'risk', targetSubjectName, status: 'failed', updatedAt: new Date().toISOString(), message: failure, actualSearchCalls: 0, actualModelCalls: 0 })
    } finally {
      setRunning(false)
    }
  }
  async function importEvidence() {
    const evidenceApi = window.shijiDesktop?.evidence
    if (!evidenceApi) return setNotice('浏览器预览不能导入本地材料。')
    setImporting(true)
    try {
      const response = await evidenceApi.import(subjectName)
      if (!response.ok) return setNotice(response.message)
      if (response.cancelled) return setNotice('已取消导入，没有修改本地材料。')
      setLocalEvidence((current) => [response.value, ...current.filter((item) => item.id !== response.value.id)])
      if (response.value.processingStatus === 'content-ready') {
        const textResponse = await evidenceApi.readText(response.value.id)
        if (textResponse.ok) setLocalEvidenceTexts((current) => ({ ...current, [response.value.id]: textResponse.value.text }))
      }
      setNotice(response.value.processingStatus === 'content-ready'
        ? '材料已在本机提取正文和出处候选；仍需核验，不会自动改变工商结论。'
        : response.value.processingStatus === 'needs-ocr'
          ? '材料已保存，但没有可用文字层；需要 OCR 后才能核验。'
          : '材料已保存到本地证据仓；解析未完成，不会自动改变核验状态。')
    } catch {
      setNotice('本地材料导入通道异常。')
    } finally {
      setImporting(false)
    }
  }
  function beginReview(dimension: CreditCheckDimension) {
    const options = reviewEvidenceOptions(dimension)
    const existing = reviews.find((item) => item.dimension === dimension)
    const existingKey = existing?.evidence.kind === 'web' ? `web:${existing.evidence.url}` : existing ? `local:${existing.evidence.id}` : ''
    setReviewingDimension(dimension)
    setReviewEvidenceKey(options.some((item) => item.key === existingKey) ? existingKey : (options[0]?.key ?? ''))
    setReviewNote(existing?.note ?? '')
  }
  function saveReview(outcome: BusinessCreditReviewDecision['outcome']) {
    const option = reviewingDimension ? reviewEvidenceOptions(reviewingDimension).find((item) => item.key === reviewEvidenceKey) : undefined
    if (!reviewingDimension || !option) return setNotice('请先选择一条当前仍存在的网页来源或本地材料。')
    if (outcome === 'record-found' && !option.canRecordFound) return setNotice('所选依据没有覆盖当前事项，不能记录为“发现记录”。')
    if (outcome === 'verified-clear' && !option.canVerifyClear) return setNotice('知识参考不能单独证明“已核验未发现”；请选择机构来源或本地核验材料。')
    const review: BusinessCreditReviewDecision = {
      dimension: reviewingDimension, outcome, evidence: option.ref,
      reviewedAt: new Date().toISOString(), note: reviewNote.trim(),
    }
    saveBusinessCreditReview(contextId, subjectName, review)
    setReviews((current) => [review, ...current.filter((item) => item.dimension !== review.dimension)])
    setReviewingDimension(undefined)
    setNotice(`${outcome === 'verified-clear' ? '“已核验未发现”' : '“发现记录”'}已绑定到所选依据并保存在本机。`)
  }
  const riskChecks = report.checks.filter((check) => check.dimension !== 'registration')
  const foundRiskCount = riskChecks.filter((check) => check.status === 'record-found').length
  const registration = report.registrationSummary
  const dynamicSources = report.candidateSources.slice(0, 5)
  return <div className="risk-layout">
    <section className="risk-score">
      <span>本次公开资料发现</span><strong>{foundRiskCount}<small> 类事项</small></strong>
      <b>{foundRiskCount > 0 ? '已有可查看记录' : '暂未取得风险记录'}</b>
      <p>这不是信用分，也不替用户判断企业好坏；只整理公开事实、来源与可能过期的边界。</p>
      <div className="risk-legend"><span><i className="found" />有公开记录</span><span><i />暂未取得</span></div>
      <button className="risk-import-action" onClick={() => void runTrackedAction(onActivityStart, '公开风险 · 导入本地材料', importEvidence)()} disabled={importing || !subjectName.trim()}><Download size={14} />{importing ? '正在导入…' : '导入本地材料'}</button>
      <small className="risk-import-note">PDF / 图片 / TXT / HTML · 仅保存本机</small>
    </section>
    <section className="risk-ledger panel-surface">
      <div className="risk-discovery-control">
        <div className="risk-search-labels"><label htmlFor="credit-subject">查询主体</label><label>本次搜索源</label></div>
        <div><input id="credit-subject" value={subjectName} onChange={(event) => { setSubjectName(event.target.value); setReviews(loadBusinessCreditReviews(contextId, event.target.value)); setReviewingDimension(undefined) }} maxLength={120} placeholder="输入企业完整名称" /><div className="fixed-provider"><SearchCheck size={13} />{providerName(defaultProvider)}</div><button onClick={() => setConfirming(true)} disabled={running || !subjectName.trim()}><SearchCheck size={14} />{running ? '正在搜索…' : '准备查询'}</button></div>
        <label className="risk-focus-label" htmlFor="credit-focus">本次想了解什么</label>
        <textarea id="credit-focus" value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={300} rows={2} placeholder="例如：查近一年行政处罚、股权和法定代表人变更；也可输入其他公开工商事项" />
        <small>豆包搜索 1 次 · 条件随本次输入变化 · 不自动连带其他扩展模块</small>
        {confirming && <div className="analysis-confirm"><div><strong>确认本次付费调用</strong><span>对象：{subjectName.trim()} · 豆包搜索 1 次 · 当前不调用 DSH</span></div><button onClick={() => setConfirming(false)}>取消</button><button className="confirm" onClick={() => void runTrackedAction(onActivityStart, `公开风险 · ${subjectName.trim()}`, discoverCredit)()}>确认运行 1 次</button></div>}
      </div>
      <header className="risk-ledger-head"><div><span>工商档案主体</span><strong>{report.subjectName || '等待填写企业名称'}</strong></div><em>{activeDiscovery ? `${providerName(activeDiscovery.provider as UserSearchProviderId)} · ${report.candidateSources.length} 条后台资料` : '等待真实查询'}</em></header>

      <section className="risk-profile-card">
        <header><div><span>{registration?.unifiedSocialCreditCode && /^1[23]/.test(registration.unifiedSocialCreditCode) ? '机构法人登记信息' : '工商基础信息'}</span><strong>主体登记快照</strong></div><Building2 size={20} /></header>
        {registration ? <><div className="risk-profile-grid">
          <span><small>统一社会信用代码</small><b>{registration.unifiedSocialCreditCode ?? '本次未提取'}</b></span>
          <span><small>法定代表人</small><b>{registration.legalRepresentative ?? '本次未提取'}</b></span>
          <span><small>注册资本</small><b>{registration.registeredCapital ?? '本次未提取'}</b></span>
          <span><small>成立日期</small><b>{registration.establishedAt ?? '本次未提取'}</b></span>
          <span><small>登记状态</small><b>{registration.operatingStatus ?? '本次未提取'}</b></span>
          <span><small>注册地址</small><b>{registration.address ?? '本次未提取'}</b></span>
        </div><a href={registration.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />查看登记信息来源 · {registration.sourceTitle}</a>{registration.unifiedSocialCreditCode && /^1[23]/.test(registration.unifiedSocialCreditCode) && <div className="risk-profile-disclaimer">该主体看起来属于机关/事业单位法人登记，不套用企业工商信用评价；下方只展示公开处罚、异常或司法事项。</div>}</> : <div className="risk-card-empty"><Eye size={16} /><span><strong>尚未形成登记快照</strong><small>运行查询后由公开来源提取；缺失字段保持空白，不让模型补写。</small></span></div>}
      </section>

      {activeDiscovery?.focus && <section className="risk-dynamic-section"><header><div><span>本次关注事项</span><strong>{activeDiscovery.focus}</strong></div><b>{dynamicSources.length}</b></header>{dynamicSources.length > 0 ? dynamicSources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}><Link2 size={14} /><span><strong>{source.title?.trim() || creditSourceHost(source.url)}</strong><small>{source.snippet?.trim() || '请打开原文查看完整内容'}</small></span><em>{creditSourceLabel(source.sourceClass)}</em></a>) : <div className="risk-card-empty"><Eye size={16} /><span><strong>本次没有取得相关公开资料</strong><small>不等于事项不存在，可以调整时间范围或关键词再次查询。</small></span></div>}</section>}

      <section className="risk-event-section"><header><span>近期公开风险事项</span><small>基础工商信息与处罚、异常、失信记录分开呈现</small></header>{riskChecks.map((check) => {
        const Icon = check.status === 'record-found' ? AlertTriangle : check.status === 'verified-clear' ? BadgeCheck : Eye
        const source = check.sources[0]
        const references = check.referenceSources.slice(0, 3)
        return <div className="risk-review-block" key={check.dimension}><div className={`risk-row ${check.status}`}><Icon /><div className="risk-row-copy"><strong>{check.label}</strong><span>{check.status === 'record-found' ? '发现与当前主体和事项直接关联的公开记录，请以原文时间和状态为准。' : check.status === 'verified-clear' ? check.note : references.length > 0 ? '以下为相关公开参考，尚不足以直接归属于当前主体。' : '本次没有取得可直接归属于该主体的记录；不代表不存在。'}</span>{source && <a href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />{source.title?.trim() || creditSourceHost(source.url)}</a>}</div><div className="risk-row-actions"><em>{statusCopy[check.status]}</em></div></div>{references.length > 0 && <div className="risk-fact-references"><header><span>{check.status === 'record-found' ? '具体内容 / 事实摘要' : '相关参考（不作为推荐或判断）'}</span><b>{references.length}</b></header>{references.map((reference) => <article key={reference.url}><div><strong>{reference.title?.trim() || creditSourceHost(reference.url)}</strong><p>{creditSourceExcerpt(reference, check.dimension)}</p></div><a href={reference.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />打开来源</a><em>{creditSourceLabel(reference.sourceClass)}</em></article>)}</div>}</div>
      })}</section>

      {localEvidence.length > 0 && <div className="risk-local-evidence"><header><span>本地材料</span><b>{localEvidence.length}</b></header>{localEvidence.map((item) => <div key={item.id}><FileText size={13} /><span><strong>{item.extraction?.title ?? item.fileName}</strong><small>{formatEvidenceSize(item.sizeBytes)} · {evidenceStatusLabel(item.processingStatus)}</small></span><em>本机</em></div>)}</div>}
      <p className="risk-discovery-notice">{notice}</p><div className="risk-boundary"><ShieldAlert size={16} /><p><strong>判断边界：</strong>{report.boundary}</p></div>
    </section>
  </div>
}

function creditSourceLabel(sourceClass: EvidenceSourceClass): string {
  return sourceClass === 'other' ? '公开商业/媒体来源' : '机构公开来源'
}

function creditSourceHost(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return '公开网页'
  }
}

function creditSourceExcerpt(source: { content?: string; snippet?: string; title?: string }, dimension: CreditCheckDimension): string {
  const value = (source.content?.trim() || source.snippet?.trim() || source.title?.trim() || '原文未返回可见摘要').replace(/\s+/g, ' ')
  const pattern: Record<CreditCheckDimension, RegExp> = {
    registration: /统一社会信用代码|法定代表人|注册资本|成立日期|经营状态|登记状态|注册地址|工商登记|企业登记/,
    'business-abnormal': /经营异常|异常名录/,
    'serious-violation': /严重违法|严重失信/,
    'administrative-penalty': /行政处罚|处罚决定|处以[^。；]{0,30}罚款|罚没(?:款|合计)?/,
    'dishonest-enforcement': /失信被执行人|被执行人信息|执行信息/,
  }
  const match = value.match(pattern[dimension])
  if (match?.index !== undefined && value.length > 260) {
    const start = Math.max(0, match.index - 110)
    const end = Math.min(value.length, match.index + 190)
    return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`
  }
  return value.length > 260 ? `${value.slice(0, 260)}…` : value
}

function formatEvidenceSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function evidenceStatusLabel(status: LocalEvidenceRecord['processingStatus']): string {
  if (status === 'content-ready') return '正文已提取·待核验'
  if (status === 'needs-ocr') return '需要 OCR'
  if (status === 'failed') return '解析失败'
  return '待解析'
}

function Leads({ selected, onDragObject }: { selected?: Opportunity; onDragObject: (object?: ManagedObject) => void }) {
  const items = selected ? leadCandidatesForOpportunity(selected) : []
  return <div className="leads-layout"><section className="lead-principle"><UsersRound size={24} /><span>不是一张电话名单</span><strong>每个对象都说明“为什么找、从哪里找、下一步做什么”</strong><p>联系方式仅使用公开商务渠道；不采集私人号码。</p></section><section className="lead-table panel-surface">{items.map((item) => <article key={item.id} draggable onDragStart={(event) => startObjectDrag(event, { kind: 'recommendation', id: item.id, title: item.company, opportunityId: item.opportunityId }, onDragObject)} onDragEnd={() => onDragObject(undefined)}><b>{item.priority}</b><div><span>{item.role}</span><strong>{item.company}</strong><p>{item.reason}</p></div><div><span>公开触达渠道</span><strong>{item.channel}</strong></div><div><span>建议下一步</span><strong>{item.nextMove}</strong></div><span className="lead-drag" onPointerDown={(event) => startPointerDrag(event, { kind: 'recommendation', id: item.id, title: item.company, opportunityId: item.opportunityId }, onDragObject)}><GripVertical size={13} />转行动</span><button><ArrowRight size={15} /></button></article>)}</section></div>
}

function MockActions() {
  const groups = ['今天', '本周', '持续观察'] as const
  return <div className="action-board">{groups.map((group) => <section key={group}><header><span>{group}</span><b>{actionItems.filter((item) => item.timing === group).length}</b></header>{actionItems.filter((item) => item.timing === group).map((item) => <article key={item.id}><button className="check-circle"><Check size={13} /></button><div><strong>{item.title}</strong><span>负责人：{item.owner}</span></div><GripDots /></article>)}<button className="add-action">+ 添加本地行动</button></section>)}</div>
}

function GripDots() { return <span className="grip-dots">⠿</span> }

// 2026-09-14：「附近·个人机会」Mock 卡片与 POI 演示数据已删除。
// 个人创业路线由一级导航「商机推演」（创业沙盘入口）承接：引擎接入前只收草稿，不展示任何建议或数字。
// 个人路线的产品输入边界见 docs/PRODUCT_LOGIC_DATAFLOW_V1.md §11。

function Nearby({ colorTheme, profile, mapProfile, opportunities, evidenceRecords, currentEvidenceIds, onRemoveEvidenceFromCurrent, selected, onSelect, onDragObject, onToggleOpportunityOverview, overviewResultIds, onArchiveOpportunity, onIgnoreOpportunity, onDeleteOpportunity, onActivityStart }: Pick<Props, 'colorTheme' | 'profile' | 'mapProfile' | 'opportunities' | 'evidenceRecords' | 'currentEvidenceIds' | 'onRemoveEvidenceFromCurrent' | 'onSelect' | 'onDragObject' | 'onToggleOpportunityOverview' | 'overviewResultIds' | 'onArchiveOpportunity' | 'onIgnoreOpportunity' | 'onDeleteOpportunity' | 'onActivityStart'> & Pick<Props, 'selected'>) {
  const [detail, setDetail] = useState<Opportunity>()

  return <div className="nearby-view">
    {detail
      ? <NearbyDetailReport item={detail} evidenceRecords={evidenceRecords} onBack={() => setDetail(undefined)} />
      : <EnterpriseNearby colorTheme={colorTheme} profile={profile} mapProfile={mapProfile} opportunities={opportunities} evidenceRecords={evidenceRecords} currentEvidenceIds={currentEvidenceIds} onRemoveEvidenceFromCurrent={onRemoveEvidenceFromCurrent} selected={selected} onSelect={onSelect} onDragObject={onDragObject} onOpenReport={setDetail} onToggleOpportunityOverview={onToggleOpportunityOverview} overviewResultIds={overviewResultIds} onArchiveOpportunity={onArchiveOpportunity} onIgnoreOpportunity={onIgnoreOpportunity} onDeleteOpportunity={onDeleteOpportunity} onActivityStart={onActivityStart} />}
  </div>
}

function EnterpriseNearby({ colorTheme, profile, mapProfile, opportunities, evidenceRecords, currentEvidenceIds, onRemoveEvidenceFromCurrent, selected, onSelect, onDragObject, onOpenReport, onToggleOpportunityOverview, overviewResultIds, onArchiveOpportunity, onIgnoreOpportunity, onDeleteOpportunity, onActivityStart }: Pick<Props, 'colorTheme' | 'profile' | 'mapProfile' | 'opportunities' | 'evidenceRecords' | 'currentEvidenceIds' | 'onRemoveEvidenceFromCurrent' | 'selected' | 'onSelect' | 'onDragObject'> & Pick<Props, 'onToggleOpportunityOverview' | 'overviewResultIds' | 'onArchiveOpportunity' | 'onIgnoreOpportunity' | 'onDeleteOpportunity' | 'onActivityStart'> & { onOpenReport: (item: Opportunity) => void }) {
  // Fill subject names from the evidence extraction before anything is drawn:
  // the map labels, list cards and detail reports must all show the same name.
  const displayOpportunities = opportunities.map((item) => ({ ...item, companyName: resolveOpportunityCompanyName(item, evidenceRecords) }))
  const [pendingDelete, setPendingDelete] = useState<Opportunity>()
  function open(item: Opportunity) {
    onSelect(item.id)
    onOpenReport(item)
  }
  return <div className="nearby-layout enterprise-nearby"><EnterpriseDistanceMap profile={mapProfile} opportunities={displayOpportunities} theme={colorTheme} onActivityStart={onActivityStart} />
    <section className="tender-nearby-list panel-surface"><header><div><span>地点范围招标结果</span><small>结果保存在本机；未定位项目保留作候选，但不计入半径</small></div><b>{displayOpportunities.length}</b></header>{displayOpportunities.length === 0 ? <DiscoveryEvidencePanel records={evidenceRecords.filter((record) => currentEvidenceIds.includes(record.id))} compact onRemoveFromCurrent={onRemoveEvidenceFromCurrent} /> : displayOpportunities.map((item) => { const company = companyForOpportunity(item); const inOverview = overviewResultIds.includes(item.id); const distanceLabel = item.locationPoint && item.distanceKm !== null ? `${item.distanceKm}km` : '位置待定位 · 不计入半径'; return <article key={item.id} className={item.id === selected?.id ? 'active' : ''}  onClick={() => open(item)}><div className="tender-title"><span>{distanceLabel} · {currentProjectStageLabel(item)}</span><span className="tender-drag" title="拖动入口只在总览页开放"><GripVertical size={14} />仅总览可拖</span></div><strong>{company.name}</strong><p>{item.title}</p><div className="tender-meta"><span><b>{formatOpportunityAmount(item.amountWan, true)}</b>预计金额</span><span><b>{item.projectType}</b>专业类型</span></div><small className="tender-address"><MapPin size={10} />{item.locationAddress ?? '项目地址待从公告正文确认'}</small><small>{item.reason}</small><div className="nearby-result-actions" onClick={(event) => event.stopPropagation()}>
      <label data-action="toggle-overview" title={inOverview ? '取消勾选只会从总览当前结果移出，不删除本机项目' : '追加到总览当前结果；原有项目保留'}><input type="checkbox" checked={inOverview} onChange={() => onToggleOpportunityOverview(item.id, !inOverview)} />{inOverview ? '已在总览' : '加入总览'}</label>
      <button data-action="open-details" onClick={() => open(item)} title="查看招标详情"><FileSearch size={13} />详情</button>
      <button data-action="archive" onClick={() => onArchiveOpportunity(item.id)} title="归档到本机项目库"><Archive size={13} />归档</button>
      <button data-action="ignore" onClick={() => onIgnoreOpportunity(item.id)} title="标记为不感兴趣"><EyeOff size={13} />忽略</button>
      <button data-action="delete" className="danger" onClick={() => setPendingDelete(item)} title="删除本机项目记录"><Trash2 size={13} />删除</button>
    </div></article>})}</section>
    {pendingDelete && <DeleteOpportunityDialog opportunity={pendingDelete} onCancel={() => setPendingDelete(undefined)} onConfirm={() => { onDeleteOpportunity(pendingDelete.id); setPendingDelete(undefined) }} />}
  </div>
}

function EnterpriseDistanceMap({ profile, opportunities, theme, onActivityStart }: { profile: OpportunitySearchCriteria; opportunities: Opportunity[]; theme: ColorTheme; onActivityStart: Props['onActivityStart'] }) {
  return <TiandituMap profile={profile} opportunities={opportunities} theme={theme} onActivityStart={onActivityStart} />
}

function NearbyDetailReport({ item, evidenceRecords, onBack }: { item: Opportunity; evidenceRecords: EvidenceRecord[]; onBack: () => void }) {
  return createPortal(<div className="nearby-detail-report">
    <button className="nearby-detail-back" onClick={onBack}><ArrowLeft size={15} />返回附近招标</button>
    <EnterpriseOpportunityReport item={item} evidenceRecords={evidenceRecords} />
  </div>, document.querySelector('.app-shell') ?? document.body)
}

function EnterpriseOpportunityReport({ item, evidenceRecords }: { item: Opportunity; evidenceRecords: EvidenceRecord[] }) {
  const company = companyForOpportunity({ ...item, companyName: resolveOpportunityCompanyName(item, evidenceRecords) })
  const itemEvidence = resolveOpportunityEvidence(item.evidenceIds, evidenceRecords)
  const sourceRecord = evidenceRecords.find((record) => item.evidenceIds.includes(record.id))
  const details = sourceRecord?.opportunityDetails
  const hasRealEvidence = itemEvidence.some((record) => Boolean(record.url))
  return <div className="nearby-report-content">
    <section className="nearby-report-hero enterprise-report-hero"><div className="nearby-report-badge"><Building2 size={15} />企业机会 · 招标通用报告 · {hasRealEvidence ? '真实搜索结果' : 'Mock'}</div><h3>{item.title}</h3><p>{company.name} · {company.region} · {item.reason}</p><div className="nearby-report-score"><strong>{item.matchScore}</strong><span>条件匹配度<br />{item.confidence}可信度</span></div></section>
    <section className="nearby-report-metrics">{[[CircleDollarSign, '预计金额', formatOpportunityAmount(item.amountWan, true)], [MapPin, '服务距离', formatOpportunityDistance(item.distanceKm, true)], [CalendarClock, '当前截止', item.deadline ?? '待核验'], [FileSearch, '证据数量', `${itemEvidence.length}条`]].map(([MetricIcon, label, value]) => <article key={String(label)}><MetricIcon size={16} /><span><small>{String(label)}</small><strong>{String(value)}</strong></span></article>)}</section>
    <div className="nearby-report-grid"><div className="nearby-report-main">
      <section className="nearby-report-section panel-surface"><header><FileText size={17} /><div><strong>招标与投标详情</strong><small>所有字段来自公告正文；缺失不补造</small></div></header><div className="nearby-fact-grid"><span><b>招标/建设主体</b>{company.name}</span><span><b>代理机构</b>{detailValues(details?.agencyCandidates)}</span><span><b>标段 / 标包</b>{detailValues(details?.lotCandidates)}</span><span><b>项目地址</b>{item.locationAddress ?? '正文未识别'}</span><span><b>招标范围</b>{detailValues(details?.scopeCandidates)}</span><span><b>投标资格</b>{detailValues(details?.qualificationCandidates)}</span><span><b>联合体要求</b>{detailValues(details?.consortiumCandidates)}</span><span><b>文件获取 / 报名</b>{detailValues(details?.documentAccessCandidates)}</span><span><b>保证金</b>{detailValues(details?.depositCandidates)}</span><span><b>开标时间</b>{detailValues(details?.openingTimeCandidates)}</span><span><b>评审方式</b>{detailValues(details?.evaluationMethodCandidates)}</span><span><b>证据确认阶段</b>{currentProjectStageLabel(item)}</span></div><p>{details?.overview ?? item.reason}</p></section>
      <section className="nearby-report-section panel-surface"><header><SearchCheck size={17} /><div><strong>证据链</strong><small>点击进入公告原文；搜索命中不等于事实成立</small></div></header><div className="nearby-evidence-list">{itemEvidence.map((record) => record.url ? <a key={record.id} href={record.url} target="_blank" rel="noreferrer"><i className={`source-dot ${record.reliability}`} /><span><strong>{record.title}</strong><small>{record.source} · {record.capturedAt}</small></span><em>{record.label}</em><ArrowRight size={13} /></a> : <button key={record.id}><i className={`source-dot ${record.reliability}`} /><span><strong>{record.title}</strong><small>{record.source} · {record.capturedAt}</small></span><em>{record.label}</em><ArrowRight size={13} /></button>)}</div></section>
    </div><aside className="nearby-report-side">
      <section className="nearby-side-card risk"><header><ShieldAlert size={17} /><strong>必须继续核验</strong></header><p><i />公告全文、资格条件与分包边界</p><p><i />建设主体是否等于最终付款主体</p><p><i />金额、截止时间和联系方式是否仍有效</p></section>
      <section className="nearby-side-card action"><header><BriefcaseBusiness size={17} /><strong>投标操作清单</strong></header>{['打开原公告与附件', '逐条核对资格与联合体要求', '确认文件获取、保证金、截止与开标时间', '按公告联系方式向招标人或代理机构咨询缺失项'].map((action, index) => <div key={action}><b>{index + 1}</b><span>{action}</span></div>)}</section>
    </aside></div>
    <div className="nearby-report-boundary"><AlertTriangle size={15} /><span><strong>报告边界：</strong>{hasRealEvidence ? '本页来自真实搜索结果，但不是正式招标结论。' : '本页当前为详情结构模拟。'}任何金额、资格、截止日期和联系方式都必须回到原公告核验。</span></div>
  </div>
}

// GEO 诊断视图已于 2026-09-14 删除（品牌 AI 可见度与商机主线无关，且真实执行器从未接入）。

function Compare({ opportunities, evidenceRecords, riskResults, overviewResultIds, analysisSelection, onOpenRisk, onRemove }: {
  opportunities: Opportunity[]; evidenceRecords: EvidenceRecord[]; riskResults: CreditRiskResult[]
  overviewResultIds: string[]; analysisSelection: string[]; onOpenRisk: (opportunityId: string) => void; onRemove: (opportunityId: string) => void
}) {
  if (opportunities.length === 0) return <div className="candidate-collection-empty"><GitCompareArrows size={34} /><strong>对比篮还是空的</strong><span>从总览拖入项目后再比较，最多同时放 3 个项目。</span></div>
  const columns = `140px repeat(${opportunities.length}, minmax(230px, 1fr))`
  const rows = buildCompareRows(opportunities, evidenceRecords, riskResults)
  return <div className="compare-view">
    <div className="compare-capacity"><GitCompareArrows size={17} /><span><strong>项目对比</strong><small>已放入 {opportunities.length} / 3 个项目；加入对比表示选作比较对象，不代表项目事实已核验。</small></span></div>
    <section className="compare-table panel-surface">
      <div className="compare-head" style={{ gridTemplateColumns: columns }}><span>指标</span>{opportunities.map((item) => <div className="compare-project-head" key={item.id}><strong>{item.title}</strong><button onClick={() => onRemove(item.id)} title="移出对比篮" aria-label={`移出${item.title}`}><X size={13} />移出</button></div>)}</div>
      {rows.map((row) => <div className="compare-row" style={{ gridTemplateColumns: columns }} key={row.label}><span>{row.label}</span>{row.cells.map((cell, index) => {
        const project = opportunities[index]
        const riskAction = !overviewResultIds.includes(project.id) ? '加入总览后选择项目'
          : riskResults.some((result) => result.opportunityId === project.id) ? '查看该项目风险结果'
            : analysisSelection.includes(project.id) ? '进入该项目风险分析' : '去总览勾选该项目'
        return <div className="compare-cell" key={`${row.label}-${project.id}`}>{row.label === '公开风险分析'
          ? <button type="button" className="compare-risk-action" onClick={() => onOpenRisk(project.id)} aria-label={`${riskAction}：${project.title}`}><strong>{cell.value}</strong><small>{cell.note}</small><em>{riskAction}<ArrowRight size={13} /></em></button>
          : <><strong>{IS_TRIAL_EDITION && row.label === '项目匹配分' ? '未评分' : cell.value}</strong>{cell.note && <small>{IS_TRIAL_EDITION && row.label === '项目匹配分' ? '体验版没有用户画像，不计算适配评分。' : cell.note}</small>}</>}</div>
      })}</div>)}
    </section>
  </div>
}

function Watch({ selected, watches, onSubscribe, onToggle, onCheck, onUnsubscribe, onOpenAnalysis, checkingWatchId }: { selected?: Opportunity; watches: ProjectWatch[]; onSubscribe: () => void; onToggle: (id: string) => void; onCheck: (id: string) => void; onUnsubscribe: (id: string) => void; onOpenAnalysis: (view: WorkspaceView, opportunityId: string) => void; checkingWatchId?: string }) {
  // 取消跟踪是"整行移除"的不可逆操作：第一次点击进入确认态，第二次才真正删除订阅。
  const [confirmingWatchId, setConfirmingWatchId] = useState<string>()
  const [refreshingWatchId, setRefreshingWatchId] = useState<string>()
  const activeCount = watches.filter((watch) => watch.status === 'active').length
  const selectedWatch = selected ? watches.find((watch) => watch.opportunityId === selected.id) : undefined
  return <div className="watch-layout"><section className="watch-hero"><Activity /><span>本地阶段订阅</span><strong>{activeCount} 个项目等待下次阶段核验</strong><p>订阅和上次确认节点保存在本机；“立即检查”只补搜下一阶段及更正、终止信号，不依赖识机服务器常驻。</p></section><section className="watch-list panel-surface">{watches.map((watch) => {
    const checking = checkingWatchId === watch.id
    const change = watch.lastCheck?.outcome === 'advanced' ? watch.lastCheck : undefined
    const refreshOpen = refreshingWatchId === watch.id
    return <article key={watch.id} className={change ? 'has-stage-change' : ''}><i className={`watch-status ${watch.status === 'active' ? 'active' : ''}`} /><div className="watch-main"><span>{watch.status === 'active' ? '阶段跟踪中' : '已暂停'}</span><strong>{watch.title}</strong><small>上次确认：{projectStageLabel(watch.lastKnownStageId)} · {watch.lastCheckedAt ? `上次检查：${formatCheckedAt(watch.lastCheckedAt)}` : '尚未检查'}</small>{change && <div className="watch-change-card"><b>发现阶段变化</b><strong>{projectStageLabel(change.fromStageId)} → {projectStageLabel(change.toStageId)}</strong>{change.evidence && <p>{change.evidence.title}<small>{change.evidence.source} · {change.evidence.occurredAt}</small></p>}<span>时间链已更新；已有专项分析已标记为可能过期，但不会自动重新检索。</span><div><button onClick={() => onOpenAnalysis('timeline', watch.opportunityId)}>查看更新时间链</button><button onClick={() => setRefreshingWatchId((current) => current === watch.id ? undefined : watch.id)}>{refreshOpen ? '收起更新选项' : '更新相关分析'}</button></div>{refreshOpen && <div className="watch-refresh-options">{([['policy', '政策链'], ['industry', '产业链'], ['risk', '公开风险'], ['leads', '获客']] as const).map(([view, label]) => <button key={view} onClick={() => onOpenAnalysis(view, watch.opportunityId)}>{label}</button>)}</div>}</div>}</div><div className="watch-actions"><button className="check-watch" disabled={IS_TRIAL_EDITION || watch.status !== 'active' || Boolean(checkingWatchId)} onClick={() => onCheck(watch.id)}>{IS_TRIAL_EDITION ? '正式版开放检查' : checking ? '检查中…' : '立即检查'}</button><button onClick={() => onToggle(watch.id)}>{watch.status === 'active' ? '暂停' : '恢复'}</button><button type="button" className="remove-watch" onClick={() => { if (confirmingWatchId === watch.id) { onUnsubscribe(watch.id); setConfirmingWatchId(undefined) } else setConfirmingWatchId(watch.id) }}>{confirmingWatchId === watch.id ? '确认取消？' : '取消跟踪'}</button></div></article>
  })}{watches.length === 0 && <div className="watch-empty"><CalendarClock size={22} /><strong>还没有追踪项目</strong><span>从机会时间链点击“加入追踪”后，这里保存检查点与阶段变化。</span></div>}<button className="create-watch" onClick={onSubscribe} disabled={!selected || selectedWatch?.status === 'active'}>{selectedWatch?.status === 'active' ? '当前项目已加入追踪' : '+ 将当前项目加入追踪'}</button></section></div>
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Capabilities() {
  return <CapabilityNotStarted title="能力中心安排在核心模块之后" copy="只有通过真实任务验收、输入输出和依赖已经稳定的能力，才会打包放入这里供用户安装或管理。当前不提前展示虚假的“已内置”状态。" />
}

/** 获客结果视图：一家公司固定一行，表头＝公司名称 | 行业 | 甲方名称 | 联系人 | 邮箱 | 电话 | 公开地址。
 *  四类公开值在各自列内纵向展示，不按数组序号伪装成同一个人；来源放在悬停提示里、值可点开原文。 */
function LeadContactsView({ scope, analysisRuns, results, selected, onSelect, onStart, onRemoveFromScope, onClearResult }: {
  scope: Opportunity[]; analysisRuns: AnalysisRunState[]; results: LeadResult[]
  selected?: Opportunity; onSelect: (id: string) => void; onStart: (opportunityId: string) => void
  onRemoveFromScope: (id: string) => void; onClearResult: (id: string) => void
}) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const rows = scope.map((item) => ({ item, run: analysisStateFor(analysisRuns, item, 'leads'), result: results.find((entry) => entry.opportunityId === item.id) }))
  const countOf = (result?: LeadResult) => (result ? result.rows.reduce((sum, row) => sum + uniqueLeadPoints([...row.contact, ...row.email, ...row.phone, ...row.address]).length, 0) : 0)
  if (rows.length === 0) return <section className="timeline-view"><Empty /></section>
  return <section className="timeline-view lead-contacts-view">
    <div className="result-object-bar">
      <span>本次分析对象</span>
      <strong>{rows.length} 个项目</strong>
      <small>{rows.map(({ item }) => item.title).join('  ')}</small>
      <button type="button" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起项目' : '展开项目（可移出 / 清除结果）'}</button>
    </div>
    {objectsOpen && <ul className="scope-object-list result">
      {rows.map(({ item, run, result }) => <li key={item.id}>
        <button type="button" className="scope-title" onClick={() => onSelect(item.id)} title="切换当前项目"><strong>{item.title}</strong></button>
        <span>{item.companyName?.trim() || '主体待核验'}</span>
        <em>{result ? `${result.rows.length} 家 / ${countOf(result)} 条` : '未分析'}</em>
        <small>{run ? analysisStatusLabel[run.status] : '未分析'}</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（已有结果仍保存在本机）">移出</button><button type="button" className="scope-clear" disabled={!run} onClick={() => onClearResult(item.id)} title="删除该项目的本模块分析结果（项目本身仍保留在总览与其它模块）">清除结果</button>
      </li>)}
    </ul>}
    {rows.map(({ item, run, result }) => <article className={`industry-result-card lead-result-card ${item.id === selected?.id ? 'active' : ''}`} key={item.id}>
      <header>
        <div>
          <span>{run ? `${analysisStatusLabel[run.status]}  ${runCallSummary(run, result)}` : '尚未分析'}</span>
          <strong>{item.title}</strong>
          <small>甲方：{result?.ownerName || item.companyName?.trim() || '主体待核验'}</small>
        </div>
        {result && <em className={result.rows.some((row) => row.missing.length < 4) ? 'verified' : ''}>{result.rows.length} 家 / {result.rows.filter((row) => row.missing.length < 4).length} 家已有公开联系方式</em>}
        <button type="button" className="card-run" disabled={run?.status === 'running'} onClick={() => onStart(item.id)}><Play size={12} />{IS_TRIAL_EDITION ? '再次回放' : run?.status === 'running' ? '正在检索' : run ? '重新分析' : '启动分析'}</button>
      </header>
      {run && <p className={`analysis-state-message status-${run.status}`}>{run.message}</p>}
      {result
        ? <>
          {result.rows.length === 0
            ? <p className="industry-empty">本次没有取得可核验的联系对象。</p>
            : <section className="industry-block">
              <header><span>联系对象（与产业链同一批节点）</span><b>{result.rows.length} 家 / {countOf(result)} 个公开值</b><small>一家公司一行；各列独立，不把不同来源的姓名与联系方式强行配对</small></header>
              <p className="lead-scroll-hint">表格可左右滑动查看全部七列；公司名称列会固定，便于核对邮箱、电话和公开地址的归属。</p>
              <div className="industry-table lead-table">
                <div className="industry-table-head lead-table-head">{LEAD_COLUMNS.map((column) => <span key={column}>{LEAD_COLUMN_LABELS[column]}</span>)}</div>
                {result.rows.map((row) => <LeadContactRows key={row.id} row={row} />)}
              </div>
            </section>}
          {result.gaps.length > 0 && <ul className="policy-gaps">{result.gaps.map((gap) => <li key={gap}><AlertTriangle size={12} />{gap}</li>)}</ul>}
          <p className="policy-boundary"><ShieldAlert size={13} />{result.boundary}</p>
        </>
        : <p className="policy-boundary"><AlertTriangle size={13} />本项目还没有获客结果；点右上「启动分析」按产业链节点逐家补公开联系方式。</p>}
    </article>)}
    <div className="evidence-boundary"><AlertTriangle size={14} />获客只消费产业链已发现的节点；联系人、邮箱、电话和公开地址分别独立取证，逐值绑定原文与来源，{IS_TRIAL_EDITION ? '历史资料未取得的字段明确留空' : '未发现就明确标注'}，不跨字段拼接，也不由模型生成或推测。</div>
  </section>
}

/** 一家公司固定一行；四类公开值各自在本列纵向展示，不按数组序号伪装成同一联系人。 */
function LeadContactRows({ row }: { row: LeadRow }) {
  const DASH = '—'
  const tip = [row.relationLabel, row.relationQuote, row.confidence === 'confirmed' ? '公告确认' : '线索·待核验'].filter(Boolean).join('｜')
  const values = (points: LeadContactPoint[], emptyLabel: string) => uniqueLeadPoints(points).length > 0
    ? <span className="lead-values">{uniqueLeadPoints(points).map((point) => {
      const source = point.sources[0]
      const displayValue = canonicalizeLeadValue(point.kind, point.value)
      const hint = `${point.evidenceQuote}\n来源：${source?.title ?? '未取得'}（${source?.publisher ?? '未取得'}）·观察时间 ${source?.observedAt ?? '未取得'}`
      return source?.pageUrl
        ? <a href={source.pageUrl} target="_blank" rel="noreferrer" title={hint} key={`${point.kind}-${point.normalized}`}>{displayValue}<ExternalLink size={10} /></a>
        : <span title={hint} key={`${point.kind}-${point.normalized}`}>{displayValue}</span>
    })}</span>
    : <span className="lead-none">{emptyLabel}</span>
  const allPoints = uniqueLeadPoints([...row.contact, ...row.email, ...row.phone, ...row.address])
  return <article className="lead-company-card">
    <div className="industry-company lead-row lead-first" title={tip || undefined}>
      <span className="lead-name"><b>{row.name}</b><small>{row.relationLabel}</small>{row.confidence === 'candidate' && <i className="lead-candidate">线索</i>}</span>
      <span className="lead-industry">{row.industry || DASH}</span>
      <span className="lead-owner">{row.ownerName || DASH}</span>
      <span className="lead-cell">{values(row.contact, IS_TRIAL_EDITION ? '未取得' : '未发现公开联系人')}</span>
      <span className="lead-cell">{values(row.email, IS_TRIAL_EDITION ? '未取得' : '未发现')}</span>
      <span className="lead-cell">{values(row.phone, IS_TRIAL_EDITION ? '未取得' : '未发现')}</span>
      <span className="lead-cell">{values(row.address, IS_TRIAL_EDITION ? '未取得' : '未发现公开地址')}</span>
    </div>
    <details className="lead-company-evidence">
      <summary><SearchCheck size={12} />查看关系与字段原文 <b>{allPoints.length}</b></summary>
      <div><p><strong>与甲方关系</strong>{row.relationQuote || '未取得关系原文'}</p>{allPoints.map((point) => <p key={`quote-${point.kind}-${point.normalized}`}><strong>{LEAD_COLUMN_LABELS[point.kind]}</strong>{point.evidenceQuote}</p>)}</div>
    </details>
  </article>
}

const ACTION_CATEGORIES: Array<{
  id: ActionItem['category']; eyebrow: string; copy: string; icon: typeof Activity
}> = [
  { id: '业务跟踪', eyebrow: 'TRACK', copy: '盯阶段与下一次可验证信号', icon: Activity },
  { id: '商务对接', eyebrow: 'CONNECT', copy: '只使用已取得的公开联系方式', icon: UsersRound },
  { id: '投标准备', eyebrow: 'BID PLAN', copy: '按截止时间倒排材料与风险复核', icon: FileText },
]

function ActionPlanView({ scope, selected, analysisRuns, policyResults, industryResults, riskResults, leadResults, watches, onSelect, onOpenView, onOpenAnalysisForProject, onRemoveProject }: {
  scope: Opportunity[]
  selected?: Opportunity
  analysisRuns: AnalysisRunState[]
  policyResults: PolicyChainResult[]
  industryResults: IndustryChainResult[]
  riskResults: CreditRiskResult[]
  leadResults: LeadResult[]
  watches: ProjectWatch[]
  onSelect: (id: string) => void
  onOpenView: (view: WorkspaceView) => void
  onOpenAnalysisForProject: (view: WorkspaceView, opportunityId: string) => void
  onRemoveProject: (opportunityId: string) => void
}) {
  const lanesRef = useRef<HTMLDivElement>(null)
  const [lanePosition, setLanePosition] = useState(0)
  const [activeId, setActiveId] = useState(() => selected?.id ?? scope[0]?.id)
  const [completedIds, setCompletedIds] = useState<string[]>(loadActionProgress)
  useEffect(() => {
    if (scope.length === 0) return
    if (!activeId || !scope.some((item) => item.id === activeId)) {
      const nextId = selected && scope.some((item) => item.id === selected.id) ? selected.id : scope[0].id
      setActiveId(nextId)
      onSelect(nextId)
    }
  }, [activeId, scope, selected?.id])

  if (scope.length === 0) {
    return <section className="action-empty panel-surface"><BriefcaseBusiness size={30} /><strong>行动清单还是空的</strong><p>行动指南不会预填演示任务。请从总览把真实项目拖入底部“行动清单”；这里只读取该项目已经取得的模块结果。</p><button onClick={() => onOpenView('overview')}>返回机会总览</button></section>
  }

  const active = scope.find((item) => item.id === activeId) ?? scope[0]
  const usableRun = (moduleId: ExtensionAnalysisModuleId) => {
    const run = analysisStateFor(analysisRuns, active, moduleId)
    return run && (run.status === 'completed' || run.status === 'partial') ? run : undefined
  }
  const timelineRun = usableRun('timeline')
  const policyRun = usableRun('policy')
  const industryRun = usableRun('industry')
  const riskRun = usableRun('risk')
  const leadRun = usableRun('leads')
  const policy = policyRun ? policyResults.find((item) => item.opportunityId === active.id && item.subjectName === active.companyName) : undefined
  const industry = industryRun ? industryResults.find((item) => item.opportunityId === active.id && item.owner.name === active.companyName) : undefined
  const risk = riskRun ? riskResults.find((item) => item.opportunityId === active.id && item.subjectName === active.companyName) : undefined
  const leads = leadRun ? leadResults.find((item) => item.opportunityId === active.id && item.ownerName === active.companyName) : undefined
  const watch = watches.find((item) => item.opportunityId === active.id)
  const availableModules = {
    timeline: Boolean(timelineRun), policy: Boolean(policyRun && policy), industry: Boolean(industryRun && industry),
    risk: Boolean(riskRun && risk), leads: Boolean(leadRun && leads),
  }
  const generated = buildActionPlan({ opportunity: active, availableModules, policyResult: policy, riskResult: risk, leadResult: leads, watch, historicalReplay: IS_TRIAL_EDITION })
  const items = generated.map((item) => ({ ...item, done: completedIds.includes(item.id) }))
  const completedCount = items.filter((item) => item.done).length
  const moduleStates = [
    { label: '时间链', ready: availableModules.timeline, view: 'timeline' as WorkspaceView, blocked: false },
    { label: '政策链', ready: availableModules.policy, view: 'policy' as WorkspaceView, blocked: false },
    { label: '产业链', ready: availableModules.industry, view: 'industry' as WorkspaceView, blocked: false },
    { label: '公开风险', ready: availableModules.risk, view: 'risk' as WorkspaceView, blocked: false },
    { label: '获客', ready: availableModules.leads, view: 'leads' as WorkspaceView, blocked: !availableModules.industry },
  ]

  function toggleDone(id: string) {
    const next = completedIds.includes(id) ? completedIds.filter((item) => item !== id) : [...completedIds, id]
    setCompletedIds(next)
    saveActionProgress(next)
  }

  function activateProject(id: string) {
    setActiveId(id)
    onSelect(id)
  }

  function moveLanes(position: number) {
    const lanes = lanesRef.current
    if (!lanes) return
    const maximum = Math.max(0, lanes.scrollWidth - lanes.clientWidth)
    lanes.scrollTo({ left: maximum * (position / 100), behavior: 'smooth' })
    setLanePosition(position)
  }

  return <div className="action-plan-view">
    <section className="action-plan-hero">
      <div><span className="micro-label">LOCAL ACTION PLAN</span><h3>{IS_TRIAL_EDITION ? '复盘证据如何形成行动' : '把已有判断变成下一步'}</h3><p>{IS_TRIAL_EDITION ? '历史案例练习，不代表当前可投标或应立即联系；这里只读取已回放的证据，不重新搜索。' : '只读取本机已取得的项目与模块结果，不重新搜索、不调用模型、不补造联系人。'}</p></div>
      <div className="action-plan-score"><strong>{completedCount}<small> / {items.length}</small></strong><span>已完成行动</span></div>
    </section>

    <nav className="action-project-switcher" aria-label="行动项目选择">
      {scope.map((item, index) => <div key={item.id} className={item.id === active.id ? 'active' : ''}>
        <button className="action-project-select" onClick={() => activateProject(item.id)}><small>{String(index + 1).padStart(2, '0')}</small><span>{item.title}</span></button>
        <button className="action-project-remove" onClick={() => onRemoveProject(item.id)} title="从行动清单移出；不删除项目和分析结果" aria-label={`从行动清单移出${item.title}`}><X size={13} /></button>
      </div>)}
    </nav>

    <section className="action-plan-context panel-surface">
      <div><span>当前项目</span><strong>{active.title}</strong><small>{active.companyName} · {active.projectType} · {active.amountWan === null ? '金额待核' : `${active.amountWan} 万元`}</small></div>
      <div className="action-module-status">{moduleStates.map((module) => <button key={module.label} className={module.ready ? 'ready' : ''} onClick={() => onOpenAnalysisForProject(module.blocked ? 'industry' : module.view, active.id)}><i />{module.label}<small>{module.ready ? '查看结果' : module.blocked ? '先补充产业链' : `去补充${module.label}`}</small></button>)}</div>
    </section>

    <div className="action-lanes-toolbar"><div><span>三条行动工作流</span><small>拖动横向滑块，或使用右侧按钮查看完整卡片</small><label className="action-lanes-range"><input type="range" min="0" max="100" value={lanePosition} onChange={(event) => moveLanes(Number(event.target.value))} aria-label="横向拖动行动工作流" /></label></div><div><button onClick={() => moveLanes(Math.max(0, lanePosition - 50))} aria-label="向左查看行动"><ArrowLeft size={15} /></button><button onClick={() => moveLanes(Math.min(100, lanePosition + 50))} aria-label="向右查看行动"><ArrowRight size={15} /></button></div></div>
    <div className="action-lanes-scroll" ref={lanesRef} onScroll={(event) => { const node = event.currentTarget; const maximum = node.scrollWidth - node.clientWidth; setLanePosition(maximum > 0 ? Math.round((node.scrollLeft / maximum) * 100) : 0) }}>
    <div className="action-workstreams">
      {ACTION_CATEGORIES.map((category) => {
        const CategoryIcon = category.icon
        const categoryItems = items.filter((item) => item.category === category.id)
        return <section key={category.id} className={`action-workstream action-${category.id}`}>
          <header><div className="action-workstream-icon"><CategoryIcon size={18} /></div><div><span>{category.eyebrow}</span><strong>{category.id}</strong><p>{category.copy}</p></div><b>{categoryItems.length}</b></header>
          <div className="action-workstream-list">
            {categoryItems.length === 0
              ? <div className="action-source-empty"><Link2 size={16} /><strong>暂无可执行内容</strong><p>{category.id === '商务对接' ? '产业链与获客尚未取得可核对的公开联系人，因此不生成虚假对接任务。请统一使用上方模块状态区补充。' : '对应模块尚无真实结果；请统一使用上方模块状态区补充。'}</p></div>
              : categoryItems.map((item) => <article key={item.id} className={item.done ? 'done' : ''}>
                  <button className="action-complete" onClick={() => toggleDone(item.id)} aria-label={item.done ? '恢复行动' : '标记完成'}><Check size={14} /></button>
                  <div className="action-card-body"><div className="action-card-top"><span>{item.timing}</span>{item.target && <small>{item.target}</small>}</div><strong>{item.title}</strong><p>{item.detail}</p><details><summary>查看依据</summary><div>{item.basis}</div></details><footer><span>负责人建议：{item.owner}</span><div>{item.sourceModules.map((source) => <em key={source}>{source}</em>)}</div></footer></div>
                </article>)}
          </div>
        </section>
      })}
    </div>
    </div>
  </div>
}

function uniqueLeadPoints(points: LeadContactPoint[]): LeadContactPoint[] {
  const seen = new Set<string>()
  return points.filter((point) => {
    const display = canonicalizeLeadValue(point.kind, point.value)
    const key = `${point.kind}:${display.replace(/\s+/g, '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function AnalysisNotStarted({ moduleId, module, selected, state, calls, copy, dependency, scope, scopeItems, onOpenScopeDetail, onStart, onRemoveFromScope, gateNote, onGateGo }: { moduleId: ExtensionAnalysisModuleId; module: string; selected?: Opportunity; state?: AnalysisRunState; calls: string; copy: string; dependency?: string; scope?: Opportunity[]; scopeItems?: ProjectScopeItem[]; onRemoveFromScope: (id: string) => void
  onOpenScopeDetail?: (opportunity: Opportunity) => void; onStart?: (ids: string[]) => void; gateNote?: string; onGateGo?: () => void }) {
  // 用户口径（2026-09-16 修正）：项目进入模块只需要"够用的引用"——
  // 名字 / 主体 / 已知阶段 / 本机证据条数 + 一个详情入口。
  // 本模块到底要哪些信息，由点「启动分析」后的真实检索与归纳去拿；
  // 不在这里把项目的全部字段铺开，更不把同一份字段塞进每个模块。
  const [objectsOpen, setObjectsOpen] = useState(true)
  const items = scopeItems ?? []
  const fallback = scope ?? (selected ? [selected] : [])
  const count = items.length > 0 ? items.length : fallback.length
  const first = items[0]?.opportunity ?? fallback[0] ?? selected
  const launched = onStart
  return <div className="analysis-not-started">
    <section>
      <span>{module}  {state ? analysisStatusLabel[state.status] : '未启动'}</span>
      {/* 多项目范围不突出第一个项目，避免被误认为本页只分析这一项。 */}<strong>{count > 1 ? `${count} 个项目待分析` : count === 1 && first ? first.title : '尚未选择项目'}</strong>
      <p>{copy}</p>
      {state && <small className={`analysis-state-message status-${state.status}`}>{state.message}</small>}
    </section>
    <section className="analysis-scope">
      <div><small>本次对象</small><strong>{count} 个项目 / 主体</strong></div>
      <div><small>{IS_TRIAL_EDITION ? '回放方式' : '预计调用'}</small><strong>{IS_TRIAL_EDITION ? '本机历史资料 · 0 次搜索 / 0 次模型' : calls}</strong></div>
      {dependency && <div><small>依赖</small><strong>{dependency}</strong></div>}
    </section>
    {count > 0 && <div className="scope-objects">
      <header>
        <span>本次分析对象</span>
        <small>勾选来自总览，按所选项目逐个分析</small>
        <b>{count}</b>
        <button type="button" className="scope-objects-toggle" onClick={() => setObjectsOpen((value) => !value)}>{objectsOpen ? '收起' : '展开'}</button>
      </header>
      {objectsOpen && <ul className="scope-object-list">
        {items.map((item) => <li key={item.id}>
          {onOpenScopeDetail
            ? <button type="button" className="scope-title" onClick={() => onOpenScopeDetail(item.opportunity)} title="打开该项目的完整招标报告"><strong>{item.title}</strong></button>
            : <strong>{item.title}</strong>}
          <span>{item.subjectName}</span>
          <em>{item.stageLabel}</em>
          <small>{item.evidenceCount} 条本机证据</small><button type="button" className="scope-remove" onClick={() => onRemoveFromScope(item.id)} title="把这个项目移出本模块的分析范围（项目仍留在总览）">移出</button>
        </li>)}
        {items.length === 0 && fallback.map((item) => <li key={item.id}>
          <button type="button" className="scope-title" onClick={() => onOpenScopeDetail?.(item)} title="打开该项目的完整招标报告"><strong>{item.title}</strong></button>
          <span>{item.companyName?.trim() || '主体待核验'}</span>
          <em>{currentProjectStageLabel(item)}</em>
          <small>{item.evidenceIds.length} 条证据</small>
        </li>)}
      </ul>}
    </div>}
    {gateNote
      ? <button data-module={moduleId} onClick={onGateGo}><Play size={16} />{gateNote}</button>
      : launched
        ? <button data-module={moduleId} onClick={() => onStart(items.length > 0 ? items.map((item) => item.id) : fallback.map((item) => item.id))}><Play size={16} />{IS_TRIAL_EDITION ? `回放历史分析 ${count} 个项目` : `启动分析 ${count} 个项目`}</button>
        : <button disabled data-module={moduleId}><Play size={16} />启动分析  真实执行器待接入</button>}
    <small>{IS_TRIAL_EDITION ? '点击后逐个展示历史采集结果与来源；没有资料的维度明确标为未取得，不会伪装成实时搜索。' : launched ? '点「启动分析」后逐个项目检索本模块需要的证据；项目卡片自动收起，结果以本模块的分析卡片呈现。' : '按钮会在该模块的真实执行器接入后开放；当前不产生搜索或模型费用。'}</small>
  </div>
}

function CapabilityNotStarted({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-workspace"><Boxes size={38} /><strong>{title}</strong><span>{copy}</span></div>
}

// 工具栏「计量」入口已于 2026-09-14 删除（V1 不做工程计量，见 PRODUCT_LOGIC_DATAFLOW_V1 §10 第 12 项）。

function Agent() {
  return <div className="agent-view"><section className="agent-intro"><UsersRound /><span>一级推广合作 · 简化版</span><strong>线下签约、线下确认，不建设代理后台</strong><p>保留合作入口与规则说明，但不承担线上客户台账、自动归因和自动结算的服务器成本。</p><div><b>合作结算</b><strong>线下商定</strong><span>以双方最终协议为准</span></div></section><section className="offline-flow panel-surface">{[['01', '申请合作', '留下公开联系方式，获取推广材料'], ['02', '线下确认', '双方签署简版推广合作协议'], ['03', '推荐成交', '用户通过易支付或约定方式完成购买'], ['04', '人工登记', '双方凭订单与推荐记录确认'], ['05', '线下结算', '按协议周期完成支付']].map(([num, title, copy]) => <div key={num}><b>{num}</b><span><strong>{title}</strong><small>{copy}</small></span><ChevronRight /></div>)}<button>查看合作说明<ExternalLink size={14} /></button></section></div>
}

function KeyApplicationGuide({ steps, href, linkLabel, note }: { steps: string[]; href: string; linkLabel: string; note?: string }) {
  return <details className="key-application-guide">
    <summary><span><KeyRound size={13} />在哪里申请 Key</span><ChevronRight size={14} /></summary>
    <div>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      {note && <p>{note}</p>}
      <a href={href} target="_blank" rel="noreferrer">打开{linkLabel}<ExternalLink size={12} /></a>
    </div>
  </details>
}

function Settings({ onActivityStart }: { onActivityStart: Props['onActivityStart'] }) {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<DeepSeekCredentialStatus>({ configured: false, encryptionAvailable: false })
  const [busy, setBusy] = useState<'save' | 'test' | 'delete'>()
  const [notice, setNotice] = useState('Key 不会写入浏览器存储、任务记录或日志。')

  useEffect(() => {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) {
      setNotice('请在识机桌面端中配置 Key；浏览器预览不会保存凭据。')
      return
    }
    void credentials.status()
      .then((response) => {
        if (response.ok) setStatus(response.value)
        else setNotice(response.message)
      })
      .catch(() => setNotice('无法读取本地凭据状态，请重新打开识机。'))
  }, [])

  async function saveKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('save')
    try {
      const response = await credentials.saveDeepSeek(apiKey)
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('DeepSeek Key 已由 Windows 加密并保存在本机。')
      } else setNotice(response.message)
    } catch {
      setNotice('保存通道发生异常，Key 未写入浏览器存储。')
    } finally {
      setBusy(undefined)
    }
  }

  async function testConnection() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('test')
    try {
      const response = await credentials.testDeepSeek()
      setNotice(response.ok ? `连接成功，官方接口返回 ${response.value.modelCount} 个可用模型。` : response.message)
    } catch {
      setNotice('连接检测通道发生异常，请重新打开识机后重试。')
    } finally {
      setBusy(undefined)
    }
  }

  async function deleteKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('delete')
    try {
      const response = await credentials.deleteDeepSeek()
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('已删除本机保存的 DeepSeek Key。')
      } else setNotice(response.message)
    } catch {
      setNotice('删除通道发生异常，请重新打开识机后重试。')
    } finally {
      setBusy(undefined)
    }
  }

  const disabled = Boolean(busy) || !status.encryptionAvailable

  return <div className="settings-layout">
    <section className="setting-block panel-surface credential-block">
      <header><div><KeyRound /><span><strong>DeepSeek 模型 Key</strong><small>由 Windows 加密，仅主进程可读取</small></span></div><b className={status.configured ? 'safe' : ''}>{status.configured ? '已配置' : '未配置'}</b></header>
      <div className="credential-editor">
        <label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '已保存；输入新 Key 可替换' : '在此粘贴 DeepSeek API Key'} autoComplete="off" spellCheck={false} /></label>
        <div className="credential-actions"><button onClick={() => void runTrackedAction(onActivityStart, '设置 · DeepSeek Key 保存', saveKey)()} disabled={disabled || !apiKey.trim()}>{busy === 'save' ? '保存中…' : status.configured ? '替换 Key' : '加密保存'}</button><button className="secondary" onClick={() => void runTrackedAction(onActivityStart, '设置 · DeepSeek 连接测试', testConnection)()} disabled={disabled || !status.configured}>{busy === 'test' ? '检测中…' : '测试连接'}</button><button className="danger" onClick={() => void runTrackedAction(onActivityStart, '设置 · DeepSeek Key 删除', deleteKey)()} disabled={Boolean(busy) || !status.configured}>{busy === 'delete' ? '删除中…' : '删除 Key'}</button></div>
        <KeyApplicationGuide
          steps={['注册并登录 DeepSeek 开放平台。', '进入 API Keys 页面，选择创建新的 API Key。', '复制新 Key 并立即粘贴到上方；不要公开或转发。']}
          href="https://platform.deepseek.com/api_keys"
          linkLabel="DeepSeek API Keys"
        />
        <p className="credential-notice"><ShieldAlert size={13} />{notice}</p>
        {status.savedAt && <small className="credential-saved-at">最近保存：{new Date(status.savedAt).toLocaleString('zh-CN')}</small>}
        {!status.encryptionAvailable && <p className="credential-warning">系统加密能力不可用，识机已禁止保存明文 Key。</p>}
      </div>
    </section>
    <DoubaoSearchSettings onActivityStart={onActivityStart} />
    <TiandituSettings onActivityStart={onActivityStart} />
    <TiandituWebSettings onActivityStart={onActivityStart} />
    <section className="setting-block panel-surface local-data-block"><header><div><HardDrive /><span><strong>本地数据</strong><small>不上传识机服务器</small></span></div><b className="safe">安全边界</b></header><div className="storage-stat"><span>工作区位置</span><strong>用户文档 / 识机工作区</strong></div><p className="setting-note">Key 仅在输入和保存操作时短暂经过隔离渲染进程；磁盘只保存 Windows 加密密文，搜索结果、企业资料、报告和附件仍归用户本机所有。</p></section>
  </div>
}

function TiandituSettings({ onActivityStart }: { onActivityStart: Props['onActivityStart'] }) {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<TiandituServerCredentialStatus>({ configured: false, encryptionAvailable: false })
  const [busy, setBusy] = useState<'save' | 'test' | 'delete'>()
  const [notice, setNotice] = useState('用于地点解析和附近项目定位；Key 只加密保存在本机。')

  useEffect(() => {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('请在识机桌面端配置；浏览器预览不会保存地理 Key。')
    void credentials.tiandituServerStatus()
      .then((response) => response.ok ? setStatus(response.value) : setNotice(response.message))
      .catch(() => setNotice('无法读取天地图服务端 Key 状态。'))
  }, [])

  async function saveKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('save')
    try {
      const response = await credentials.saveTiandituServer(apiKey)
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('天地图服务端 Key 已由 Windows 加密并保存在本机。')
      } else setNotice(response.message)
    } catch {
      setNotice('保存通道发生异常，Key 未写入浏览器存储。')
    } finally {
      setBusy(undefined)
    }
  }

  async function testConnection() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('test')
    try {
      const response = await credentials.testTiandituServer()
      setNotice(response.ok
        ? `地理编码连接成功：${response.value.longitude.toFixed(4)}, ${response.value.latitude.toFixed(4)}；本次使用 1 次固定地址测试。`
        : response.message)
    } catch {
      setNotice('天地图连接检测发生异常，请检查网络和应用权限。')
    } finally {
      setBusy(undefined)
    }
  }

  async function deleteKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('delete')
    try {
      const response = await credentials.deleteTiandituServer()
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('已删除本机保存的天地图服务端 Key。')
      } else setNotice(response.message)
    } catch {
      setNotice('删除通道发生异常，请重新打开识机后重试。')
    } finally {
      setBusy(undefined)
    }
  }

  const disabled = Boolean(busy) || !status.encryptionAvailable
  return <section className="setting-block panel-surface credential-block">
    <header><div><MapPin /><span><strong>天地图服务端 Key</strong><small>地址解析、半径计算与 POI；仅主进程可读取</small></span></div><b className={status.configured ? 'safe' : ''}>{status.configured ? '已配置' : '未配置'}</b></header>
    <div className="credential-editor">
      <label><span>服务端 Key（tk）</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '已保存；输入新 Key 可替换' : '在此粘贴天地图服务端 Key'} autoComplete="off" spellCheck={false} /></label>
      <div className="credential-actions"><button onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图服务端 Key 保存', saveKey)()} disabled={disabled || !apiKey.trim()}>{busy === 'save' ? '保存中…' : status.configured ? '替换 Key' : '加密保存'}</button><button className="secondary" onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图服务端连接测试', testConnection)()} disabled={disabled || !status.configured}>{busy === 'test' ? '检测中…' : '测试地理编码（1次）'}</button><button className="danger" onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图服务端 Key 删除', deleteKey)()} disabled={Boolean(busy) || !status.configured}>{busy === 'delete' ? '删除中…' : '删除 Key'}</button></div>
      <KeyApplicationGuide
        steps={['注册天地图账号并完成开发者认证。', '进入控制台“应用管理 / 我的应用”，创建应用。', '应用类型选择“服务端”，创建后复制 tk。']}
        href="https://console.tianditu.gov.cn/api/key"
        linkLabel="天地图控制台"
        note="识机可提供公共地图额度时无需填写；如公共额度用尽、审核或维护暂停，可在此配置自己的 Key。保存后优先使用本机 Key。"
      />
      {status.savedAt && <small className="credential-saved-at">最近保存：{new Date(status.savedAt).toLocaleString('zh-CN')}</small>}
    </div>
    <p className="backend-notice"><ShieldAlert size={15} /><span>{notice}</span></p>
  </section>
}

function TiandituWebSettings({ onActivityStart }: { onActivityStart: Props['onActivityStart'] }) {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<TiandituWebCredentialStatus>({ configured: false, encryptionAvailable: false })
  const [busy, setBusy] = useState<'save' | 'test' | 'delete'>()
  const [notice, setNotice] = useState('用于加载附近招标地图；Key 只在本机地图请求中使用。')

  useEffect(() => {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('请在识机桌面端配置；浏览器预览不会保存地图 Key。')
    void credentials.tiandituWebStatus()
      .then((response) => response.ok ? setStatus(response.value) : setNotice(response.message))
      .catch(() => setNotice('无法读取天地图网页端 Key 状态。'))
  }, [])

  async function saveKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('save')
    try {
      const response = await credentials.saveTiandituWeb(apiKey)
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('天地图网页端 Key 已由 Windows 加密并保存在本机。')
      } else setNotice(response.message)
    } catch { setNotice('保存通道发生异常，Key 未写入浏览器存储。') }
    finally { setBusy(undefined) }
  }

  async function deleteKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('delete')
    try {
      const response = await credentials.deleteTiandituWeb()
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice('已删除本机保存的天地图网页端 Key。')
      } else setNotice(response.message)
    } catch { setNotice('删除通道发生异常，请重新打开识机后重试。') }
    finally { setBusy(undefined) }
  }

  async function testConnection() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('test')
    try {
      const response = await credentials.testTiandituWeb()
      setNotice(response.ok
        ? '网页端 Key 可用，地图脚本已成功加载。'
        : response.message)
    } catch { setNotice('天地图网页端脚本检测发生异常，请检查网络和 Key 权限。') }
    finally { setBusy(undefined) }
  }

  const disabled = Boolean(busy) || !status.encryptionAvailable
  return <section className="setting-block panel-surface credential-block">
    <header><div><Globe2 /><span><strong>天地图网页端 Key</strong><small>用于真实底图；仅在本机地图页面短暂读取</small></span></div><b className={status.configured ? 'safe' : ''}>{status.configured ? '已配置' : '未配置'}</b></header>
    <div className="credential-editor">
      <label><span>网页端 Key（tk）</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '已保存；输入新 Key 可替换' : '在此粘贴天地图网页端 Key'} autoComplete="off" spellCheck={false} /></label>
      <div className="credential-actions"><button onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图网页端 Key 保存', saveKey)()} disabled={disabled || !apiKey.trim()}>{busy === 'save' ? '保存中…' : status.configured ? '替换 Key' : '加密保存'}</button><button className="secondary" onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图网页端连接测试', testConnection)()} disabled={disabled || !status.configured}>{busy === 'test' ? '检测中…' : '测试网页脚本'}</button><button className="danger" onClick={() => void runTrackedAction(onActivityStart, '设置 · 天地图网页端 Key 删除', deleteKey)()} disabled={Boolean(busy) || !status.configured}>{busy === 'delete' ? '删除中…' : '删除 Key'}</button></div>
      <KeyApplicationGuide
        steps={['注册天地图账号并完成开发者认证。', '进入控制台“应用管理 / 我的应用”，创建应用。', '应用类型选择“浏览器端”，按控制台要求填写应用来源后复制 tk。']}
        href="https://console.tianditu.gov.cn/api/key"
        linkLabel="天地图控制台"
        note="识机可提供公共地图额度时无需填写；如公共额度用尽、审核或维护暂停，可在此配置自己的 Key。保存后优先使用本机 Key。"
      />
      {status.savedAt && <small className="credential-saved-at">最近保存：{new Date(status.savedAt).toLocaleString('zh-CN')}</small>}
    </div>
    <p className="backend-notice"><ShieldAlert size={15} /><span>{notice}</span></p>
  </section>
}

function providerName(_provider: UserSearchProviderId): string {
  return '豆包搜索 Custom'
}

function DoubaoSearchSettings({ onActivityStart }: { onActivityStart: Props['onActivityStart'] }) {
  const providerLabel = '豆包搜索 Custom'
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<CredentialStatus>({ configured: false, encryptionAvailable: false })
  const [busy, setBusy] = useState<'save' | 'test' | 'delete'>()
  const [notice, setNotice] = useState('连接检测或案例搜索各只调用 1 次；Key 仅加密保存在本机。')

  useEffect(() => {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) {
      setNotice(`请在识机桌面端中配置 ${providerLabel}；浏览器预览不会保存凭据。`)
      return
    }
    void credentials.doubaoStatus()
      .then((response) => response.ok ? setStatus(response.value) : setNotice(response.message))
      .catch(() => setNotice(`无法读取 ${providerLabel} 凭据状态，请重新打开识机。`))
   }, [])

  async function saveKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('save')
    try {
      const response = await credentials.saveDoubao(apiKey)
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice(`${providerLabel} Key 已由 Windows 加密并保存在本机。`)
      } else setNotice(response.message)
    } catch {
      setNotice('保存通道发生异常，Key 未写入浏览器存储。')
    } finally {
      setBusy(undefined)
    }
  }

  async function testConnection() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('test')
    try {
      const response = await credentials.testDoubao()
      setNotice(response.ok ? `${providerLabel} 连接成功，返回 ${response.value.resultCount} 条；本次检测消耗 1 次调用。` : response.message)
    } catch {
      setNotice('连接检测通道发生异常，请重新打开识机后重试。')
    } finally {
      setBusy(undefined)
    }
  }

  async function deleteKey() {
    const credentials = window.shijiDesktop?.credentials
    if (!credentials) return setNotice('桌面安全存储不可用。')
    setBusy('delete')
    try {
      const response = await credentials.deleteDoubao()
      if (response.ok) {
        setStatus(response.value)
        setApiKey('')
        setNotice(`已删除本机保存的 ${providerLabel} Key。`)
      } else setNotice(response.message)
    } catch {
      setNotice('删除通道发生异常，请重新打开识机后重试。')
    } finally {
      setBusy(undefined)
    }
  }

  const disabled = Boolean(busy) || !status.encryptionAvailable
  return <section className="setting-block panel-surface credential-block doubao-search-block">
    <header><div><SearchCheck /><span><strong>{providerLabel} 搜索 Key</strong><small>唯一业务搜索入口；负责找正文，DeepSeek 负责受限结构化</small></span></div><b className={status.configured ? 'safe' : ''}>{status.configured ? '已配置' : '未配置'}</b></header>
    <div className="credential-editor">
      <label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '已保存；输入新 Key 可替换' : `在此粘贴 ${providerLabel} API Key`} autoComplete="off" spellCheck={false} /></label>
      <div className="credential-actions"><button onClick={() => void runTrackedAction(onActivityStart, '设置 · 豆包搜索 Key 保存', saveKey)()} disabled={disabled || !apiKey.trim()}>{busy === 'save' ? '保存中…' : status.configured ? '替换 Key' : '加密保存'}</button><button className="secondary" onClick={() => void runTrackedAction(onActivityStart, '设置 · 豆包搜索连接测试', testConnection)()} disabled={disabled || !status.configured}>{busy === 'test' ? '检测中…' : '测试连接（1次）'}</button><button className="danger" onClick={() => void runTrackedAction(onActivityStart, '设置 · 豆包搜索 Key 删除', deleteKey)()} disabled={Boolean(busy) || !status.configured}>{busy === 'delete' ? '删除中…' : '删除 Key'}</button></div>
      <KeyApplicationGuide
        steps={['注册火山引擎账号并按控制台要求完成认证。', '在豆包搜索控制台开通 Custom 版 web 搜索。', '进入“API Key 管理 / 按量后付费”，创建并复制 API Key。']}
        href="https://console.volcengine.com/search-infinity/api-key?tab=post_paid"
        linkLabel="豆包搜索 API Key 管理"
        note="订阅套餐 Key 与按量后付费 Key 相互独立；识机当前使用 Custom 版 web 搜索。"
      />
      {status.savedAt && <small className="credential-saved-at">最近保存：{new Date(status.savedAt).toLocaleString('zh-CN')}</small>}
    </div>
    <p className="backend-notice"><ShieldAlert size={15} /><span>{notice}</span></p>
  </section>
}

function Empty() {
  return <div className="empty-workspace"><Radar size={38} /><strong>左侧设置条件并开始任务</strong><span>识机会先锁定条件，再运行本地搜索与分析能力。</span></div>
}

function DiscoveryEvidencePanel({ records, compact = false, onRemoveFromCurrent }: { records: EvidenceRecord[]; compact?: boolean; onRemoveFromCurrent?: (evidenceId: string) => void }) {
  const [activeRecord, setActiveRecord] = useState<EvidenceRecord>()
  const rejectedNonProjects = records.filter(isRejectedNonProjectEvidence)
  const visibleRecords = records.filter((record) => !isRejectedNonProjectEvidence(record))
  useEffect(() => {
    if (!activeRecord) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveRecord(undefined) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [activeRecord])
  if (visibleRecords.length === 0) return <div className="discovery-empty"><SearchCheck size={18} /><span>{rejectedNonProjects.length > 0 ? `本次来源均为平台列表、门户或行业指南，已排除 ${rejectedNonProjects.length} 条，没有把它们当作项目展示。` : '本次没有拿到可展示的具体项目来源。'}</span></div>
  return <div className={`discovery-evidence-panel ${compact ? 'compact' : ''}`}>
    {!compact && <header><div><span>本次具体项目来源</span><small>{rejectedNonProjects.length > 0 ? `已另行排除 ${rejectedNonProjects.length} 条平台列表、门户或指南` : '可靠参考已保留；当前筛选条件另行判断'}</small></div><b>{visibleRecords.length}</b></header>}
    {compact && <header className="discovery-evidence-compact-heading"><div><span>本次来源线索 · 尚未整理为项目卡</span><small>可查看原文；归档、忽略和删除仅适用于已形成的项目卡</small></div><b>{visibleRecords.length}</b></header>}
    {visibleRecords.map((record) => {
      const details = record.opportunityDetails
      const reputable = isReputableOpportunityPublisher(record)
      const source = record.provenance.pageUrl
        ? <a href={record.provenance.pageUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{record.title}</a>
        : <strong>{record.title}</strong>
      const company = details?.companyCandidates?.length ? details.companyCandidates.join(' / ') : '正文未识别'
      const amount = details?.amountWanCandidates?.length ? details.amountWanCandidates.map((value) => `${value.toLocaleString()}万`).join(' / ') : '正文未识别'
      const stage = details?.stageIds?.length ? details.stageIds.map(stageLabelFromId).join(' / ') : '正文未识别'
      const overview = details?.overview || record.title || '正文未提取'
      const deadline = details?.deadlineCandidates?.length ? details.deadlineCandidates.join(' / ') : '正文未识别'
      return <article key={record.id} data-evidence-id={record.id} className="discovery-evidence-card" role="button" tabIndex={0} onClick={() => setActiveRecord(record)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setActiveRecord(record) }}><i className={`source-dot ${reputable ? 'official' : 'secondary'}`} /><div className="discovery-evidence-copy"><span>豆包搜索来源</span>{source}<small>{record.provenance.publisher} · {record.provenance.publishedAt ?? record.provenance.capturedAt.slice(0, 10)}</small><div className="discovery-quick-facts"><span><b>主体</b>{company}</span><span><b>金额</b>{amount}</span><span><b>阶段</b>{stage}</span><span><b>截止</b>{deadline}</span></div><p className="discovery-overview">{overview}</p><footer><em>{reputable ? '可靠参考 · 事实待核验' : '来源待评估'}</em><b>查看完整招标详情<ArrowRight size={13} /></b></footer>{onRemoveFromCurrent && <div className="discovery-evidence-actions"><button data-action="remove-evidence" title="仅从本次结果列表移除，保留本机原始来源" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemoveFromCurrent(record.id) }}><X size={12} />移出本次</button></div>}</div></article>
    })}
    <p className="discovery-boundary">政府网站、招采交易平台和有明确主体及原文链路的知名商业网站均保留为可靠参考；“本次条件不匹配”只表示金额、截止时间或阶段不符合当前筛选，不等于来源不可靠。事实字段仍以正文和原文核对为准。</p>
    {activeRecord && <EvidenceDetailOverlay record={activeRecord} onClose={() => setActiveRecord(undefined)} />}
  </div>
}

function isRejectedNonProjectEvidence(record: EvidenceRecord): boolean {
  return record.assessment.missingChecks.some((reason) => /(?:多项目聚合列表|平台或门户首页|行业指南或查询攻略)/.test(reason))
}

function EvidenceDetailOverlay({ record, onClose }: { record: EvidenceRecord; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const details = record.opportunityDetails
  const reputable = isReputableOpportunityPublisher(record)
  const reasons = uniqueStrings([...record.assessment.reasons, ...record.assessment.missingChecks])
  const facts = [
    ['招标 / 建设主体', details?.companyCandidates?.join(' / ') || '正文未识别'],
    ['代理机构', detailValues(details?.agencyCandidates)],
    ['标段 / 标包', detailValues(details?.lotCandidates)],
    ['招标范围', detailValues(details?.scopeCandidates)],
    ['金额', details?.amountWanCandidates?.length ? details.amountWanCandidates.map((value) => `${value.toLocaleString()}万`).join(' / ') : '正文未识别'],
    ['阶段', details?.stageIds?.length ? details.stageIds.map(stageLabelFromId).join(' / ') : '正文未识别'],
    ['截止时间', details?.deadlineCandidates?.join(' / ') || '正文未识别'],
    ['项目地址', details?.addressCandidates?.join(' / ') || '正文未识别'],
    ['发布时间', record.provenance.publishedAt || '正文未识别'],
  ]
  return createPortal(<div className="evidence-detail-overlay" role="dialog" aria-modal="true" aria-label="招标详情" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="evidence-detail-sheet">
      <header><button onClick={onClose}><ArrowLeft size={16} />返回结果列表</button><span>{reputable ? '可靠参考 · 关键事实待核验' : '来源待评估'}</span></header>
      <div className="evidence-detail-hero"><small>{IS_TRIAL_EDITION ? '历史案例快照' : '豆包搜索 Custom'} · {record.provenance.publisher}</small><h3>{record.title}</h3><p>{details?.overview || '当前来源尚未提取到可用正文概述。'}</p>{record.provenance.pageUrl && <a href={record.provenance.pageUrl} target="_blank" rel="noreferrer">打开公告原文<ExternalLink size={14} /></a>}</div>
      <div className="evidence-detail-facts">{facts.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      <div className="evidence-detail-columns"><section><h4>投标资格与参与规则</h4><p>资格要求：{detailValues(details?.qualificationCandidates)}</p><p>联合体：{detailValues(details?.consortiumCandidates)}</p><p>文件获取 / 报名：{detailValues(details?.documentAccessCandidates)}</p><p>保证金：{detailValues(details?.depositCandidates)}</p><p>开标时间：{detailValues(details?.openingTimeCandidates)}</p><p>评审方式：{detailValues(details?.evaluationMethodCandidates)}</p><h4>公开联系方式</h4>{details?.contactCandidates?.length ? details.contactCandidates.map((item) => <p key={item}>{item}</p>) : <p>未发现公开联系方式，禁止模型补写。</p>}</section><section><h4>附件与下载</h4>{details?.attachmentCandidates?.length ? details.attachmentCandidates.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}>{item.label}<Download size={13} /></a>) : <p>暂未识别可下载附件。</p>}<h4>来源与凭据</h4><p>来源：{record.provenance.publisher}</p><p>权威说明：{record.discovery?.providerAuthorityLabel || (reputable ? '知名机构或招采来源' : '待人工判断')}</p><p>相关度：{record.discovery?.rankScore === undefined ? '供应商未返回' : record.discovery.rankScore.toFixed(3)}</p><p>采集时间：{new Date(record.provenance.capturedAt).toLocaleString('zh-CN')}</p>{record.provenance.documentIdentifiers.map((item) => <p key={`${item.kind}-${item.value}`}>{item.kind}：{item.value}</p>)}</section></div>
      <section className="evidence-detail-checks"><h4>投标操作清单</h4>{['打开公告原文与附件', '核对资格、联合体与标段范围', '确认文件获取、保证金、截止及开标时间', '对缺失字段联系招标人或代理机构'].map((item) => <p key={item}><Check size={13} />{item}</p>)}</section>
      {reasons.length > 0 && <section className="evidence-detail-checks"><h4>仍需核对</h4>{reasons.map((reason) => <p key={reason}><AlertTriangle size={13} />{reason}</p>)}</section>}
      <footer><ShieldAlert size={15} /><span>本页完整保留搜索和确定性提取结果。没有正文依据的字段保持空缺，DeepSeek 不得编造金额、主体、联系方式或附件。</span></footer>
    </section>
  </div>, document.querySelector('.app-shell') ?? document.body)
}

function detailValues(values?: string[]): string {
  return values?.length ? values.join(' / ') : '正文未识别'
}

function stageLabelFromId(stageId: string): string {
  return PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === stageId)?.label ?? stageId
}

function isReputableOpportunityPublisher(record: EvidenceRecord): boolean {
  const publisher = record.provenance.publisher.toLowerCase()
  let host = publisher.replace(/^www\./, '')
  try {
    if (record.provenance.pageUrl) host = new URL(record.provenance.pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch { /* Invalid source URL leaves the publisher label as the fallback. */ }
  if (host.endsWith('.gov.cn') || host === 'gov.cn') return true
  if (/中国招采资源网|中国采招网|招采网|中国招标投标公共服务平台|全国公共资源交易平台|中国政府采购网|新华社|人民网|新浪|腾讯新闻|澎湃|财新|第一财经/i.test(publisher)) return true
  return [
    'bidcenter.com.cn', 'chinabidding.cn', 'zcwzc.com', 'zct.org.cn', '365trade.com.cn',
    'ccgp.gov.cn', 'ggzy.gov.cn', 'cebpubservice.cn', 'bidnews.cn', 'bidchance.com',
    'cecbid.org.cn', 'china-tender.com.cn', 'xinhuanet.com', 'people.com.cn',
    'sina.com.cn', 'news.qq.com', '163.com', 'thepaper.cn', 'caixin.com', 'yicai.com',
  ].some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
