import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Activity, Archive, Boxes, BriefcaseBusiness, CircleDot, Crosshair,
  FileDown, GitCompareArrows, GripVertical, Handshake, LayoutDashboard, Map,
  Palette, Radar, Settings2, Sparkles,
  type LucideIcon,
} from 'lucide-react'
import ConversationPanel from './components/ConversationPanel'
import { IS_TRIAL_EDITION } from './edition'
import { trialIndustryResult, trialLeadResult, trialPolicyResult, trialRiskResult } from './trial/replay'
import SimulationPanel from './components/SimulationPanel'
import Workspace from './components/Workspace'
import type { AgentTask, SearchInputMode } from '../shared/agent-contract'
import { createDeepRadarTask } from '../shared/deep-radar-task'
import { eligibleDeepRadarOpportunities } from '../shared/deep-radar'
import type { UserSearchProviderId } from '../shared/search-preference'
import type { EvidenceDocumentIdentifier, EvidenceRecord } from '../shared/evidence-contract'
import { formatCachedResultLabel, isAnalysisResultFresh, markOpportunityAnalysesStale, runCallOutcome, upsertAnalysisRun, type AnalysisRunState, type ExtensionAnalysisModuleId } from '../shared/analysis-run'
import type { PolicyChainResult } from '../shared/policy-chain'
import type { IndustryChainResult } from '../shared/industry-chain'
import { buildLeadInputFingerprint, buildLeadNodes, type LeadResult } from '../shared/lead-contacts'
import type { CreditRiskResult } from '../shared/credit-risk'
import {
  appendToCurrentResults, archiveOpportunity, catalogNearbyOpportunities, catalogOpportunitiesByStatus, deleteOpportunity, ignoreOpportunity, removeEvidenceFromNearbyResults, removeFromCurrentResults,
  replaceNearbyResults, restoreOpportunity, updateCatalogOpportunity,
} from '../shared/opportunity-catalog'
import { DESKTOP_CONTRACT_VERSION } from '../shared/desktop-contract'
import {
  applyProjectTimelineCheck, createProjectWatch, PROJECT_WATCH_WEEKLY_INTERVAL_MS, selectDueLaunchProjectWatches, type ProjectWatch,
} from '../shared/project-watch'
import { PROJECT_STAGE_DEFINITIONS, type ProjectStageEvidence, type ProjectStageId } from '../shared/project-timeline'
import type { Opportunity, OpportunitySearchCriteria, ColorTheme, DropBucket, ManagedBuckets, ManagedObject, TaskMode, WorkspaceState, WorkspaceView } from './domain'
import { addObjectToBucket, canDropObject, MAX_COMPARE_PROJECTS, removeProjectFromBucket, selectBucketProjects } from './drag'
import { removeActionProject, selectActionProjects } from './action-plan'
import { AgentRunError, createAgentRunner } from './harness'
import { DEFAULT_SIMULATION_DRAFT, loadSimulationDraft, saveSimulationDraft, type SimulationDraft } from './simulation'
import { loadRadarStageFilter, saveRadarStageFilter } from './radar-preference'
import { loadAnalysisSelection, saveAnalysisSelection } from './analysis-selection'
import {
  byId, deleteBusinessObjectsForOpportunity, loadActionScopeMigrated, loadAnalysisRuns, loadBusinessProfile, loadColorTheme, loadDeepRadarResults, loadLayoutPreferences, loadManagedBuckets, loadOpportunityCatalog, loadCreditRiskResults, loadLeadResults, loadIndustryChainResults, loadOpportunitySearchCriteria, loadPolicyChainResults, loadProjectWatches, loadSearchEvidence, loadWorkspace,
  saveActionScopeMigrated, saveAnalysisRuns, saveBusinessObjects, saveBusinessProfile, saveColorTheme, saveDeepRadarResults, saveLayoutPreferences, saveManagedBuckets, saveOpportunityCatalog, saveCreditRiskResults, saveIndustryChainResults, saveLeadResults, saveOpportunitySearchCriteria, savePolicyChainResults, saveProjectWatches, saveSearchEvidence, saveWorkspace,
} from './repository'

const agentRunner = createAgentRunner()
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const defaultProfile: OpportunitySearchCriteria = {
  targetCompanyName: '', targetProjectName: '',
  address: '上海市临港新片区', radiusKm: 50, specialty: '机电安装', amountMin: 1000,
  amountMax: 9000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 10,
}

function runStageForMessage(message: string): string {
  if (/搜索|联网|来源/.test(message)) return '搜索公开来源'
  if (/正文|读取|页面|附件/.test(message)) return '读取正文'
  if (/核验|校验|门禁|证据/.test(message)) return '核对主体与事项'
  if (/结构化|整理|完成|结果/.test(message)) return '整理结果卡片'
  return '执行任务'
}

type NavItem = { id: WorkspaceView; label: string; icon: LucideIcon }
// 2026-09-14 导航收敛为两个支柱组：
// 「商机推演」= 个人创业推演（创业沙盘前端入口，引擎未接入）；
// 「商机情报」= 企业招投标工作流（发现 → 选中项目 → 扩展分析 → 执行）。
// 分析类视图（时间链/政策链/产业链/公开风险/获客/行动）保留为选中项目后的工作区页签，
// 不再占用左侧一级导航。GEO、自动识别、个人附近 Mock 与工具栏「计量」入口已删除。
const navGroups: { label: string; items: NavItem[] }[] = [
  { label: '商机推演', items: [
    { id: 'simulation', label: '商机推演', icon: Sparkles },
  ] },
  { label: '商机情报', items: [
    { id: 'overview', label: '总览', icon: LayoutDashboard }, { id: 'radar', label: '商机雷达', icon: Radar },
    { id: 'nearby', label: '附近招标', icon: Map }, { id: 'watch', label: '关注', icon: Activity },
    { id: 'library', label: '项目库', icon: Archive },
  ] },
]

const toolItems: NavItem[] = [
  { id: 'capabilities', label: '能力', icon: Boxes }, { id: 'agent', label: '代理', icon: Handshake },
  { id: 'settings', label: '设置', icon: Settings2 },
]

const bucketMeta: Record<DropBucket, { label: string; icon: LucideIcon; hint: string }> = {
  // 2026-09-15（清单 3.6）：focus 不再是"桶数据源"，而是 ProjectWatch 订阅入口——
  // 拖入即创建/激活关注并打开关注列表页（旧行为是误落到总览）。
  focus: { label: '追踪', icon: Crosshair, hint: '拖入即订阅' },
  compare: { label: '对比篮', icon: GitCompareArrows, hint: '最多 3 个项目' },
  action: { label: '行动清单', icon: BriefcaseBusiness, hint: '拖入生成行动' },
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadWorkspace)
  const [profile, setProfile] = useState(() => loadOpportunitySearchCriteria(defaultProfile))
  const [mapProfile, setMapProfile] = useState<OpportunitySearchCriteria | undefined>(undefined)
  const [businessProfile, setBusinessProfile] = useState(loadBusinessProfile)
  const [colorTheme, setColorTheme] = useState<ColorTheme>(loadColorTheme)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [mode, setMode] = useState<TaskMode>('radar')
  const [simulationDraft, setSimulationDraft] = useState<SimulationDraft>(() => loadSimulationDraft() ?? DEFAULT_SIMULATION_DRAFT)
  const [searchProvider, setSearchProvider] = useState<UserSearchProviderId>('doubao')
  const [opportunityCatalog, setOpportunityCatalog] = useState(loadOpportunityCatalog)
  const [radarOpportunities, setRadarOpportunities] = useState(() => eligibleDeepRadarOpportunities(businessProfile, loadDeepRadarResults()))
  // 雷达「本次项目阶段」筛选：与长期画像分开保存，不读自动识别条件栏。
  const [radarStageFilter, setRadarStageFilter] = useState(loadRadarStageFilter)
  // 第 3 步：总览复选框写入的"模块分析对象集合"
  const [analysisSelection, setAnalysisSelection] = useState<string[]>(loadAnalysisSelection)
  // 用户是否"明确清空了分析范围"：清空后模块页不得再靠"退回当前选中"把项目带回来（否则「移出」看起来没用）。
  const [scopeCleared, setScopeCleared] = useState(false)
  // 雷达失败必须在模块页内可见：这里保存本次运行失败原因，供 DeepRadar 渲染失败态。
  const [radarFailure, setRadarFailure] = useState<string>()
  const [searchEvidence, setSearchEvidence] = useState<EvidenceRecord[]>(loadSearchEvidence)
  const [message, setMessage] = useState(IS_TRIAL_EDITION
    ? '体验版沿用识机正式界面。请从总览选择历史案例，再到时间链、政策链、产业链、公开风险和获客回放当时留存的证据，最后查看行动建议；搜索新项目需正式版。'
    : '我会先锁定地址、范围、专业、金额、类型和时间，再组合搜索与证据核验。')
  const [running, setRunning] = useState(false)
  const [runningInputMode, setRunningInputMode] = useState<SearchInputMode>()
  const [runStage, setRunStage] = useState<string>()
  const [globalActivities, setGlobalActivities] = useState<{ id: number; label: string }[]>([])
  const globalActivityId = useRef(0)
  const onActivityStart = useCallback((label: string) => {
    const id = ++globalActivityId.current
    let finished = false
    setGlobalActivities((current) => [...current, { id, label }])
    return () => {
      if (finished) return
      finished = true
      setGlobalActivities((current) => current.filter((activity) => activity.id !== id))
    }
  }, [])
  const [draggedObject, setDraggedObject] = useState<ManagedObject>()
  const [activeDrop, setActiveDrop] = useState<DropBucket>()
  const [buckets, setBuckets] = useState<ManagedBuckets>(loadManagedBuckets)
  const [actionScopeMigrated, setActionScopeMigrated] = useState(loadActionScopeMigrated)
  const [projectWatches, setProjectWatches] = useState<ProjectWatch[]>(loadProjectWatches)
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRunState[]>(loadAnalysisRuns)
  const [policyResults, setPolicyResults] = useState<PolicyChainResult[]>(loadPolicyChainResults)
  const [industryResults, setIndustryResults] = useState<IndustryChainResult[]>(loadIndustryChainResults)
  const [leadResults, setLeadResults] = useState<LeadResult[]>(loadLeadResults)
  const [creditRiskResults, setCreditRiskResults] = useState<CreditRiskResult[]>(loadCreditRiskResults)
  const [checkingWatchId, setCheckingWatchId] = useState<string>()
  const [businessCreditRequest, setBusinessCreditRequest] = useState<{ subjectName: string; focus: string; nonce: number }>()
  const activeRun = useRef<{ taskId: string; controller: AbortController } | undefined>(undefined)
  const launchWatchCheckStarted = useRef(false)
  const [layout, setLayout] = useState(() => {
    const saved = loadLayoutPreferences()
    const railWidth = clamp(saved.railWidth, 94, 168)
    return { railWidth, conversationWidth: clamp(saved.conversationWidth, 340, Math.max(340, Math.min(620, window.innerWidth - railWidth - 520))) }
  })

  useEffect(() => saveWorkspace(workspace), [workspace])
  useEffect(() => saveOpportunitySearchCriteria(profile), [profile])
  useEffect(() => saveBusinessProfile(businessProfile), [businessProfile])
  useEffect(() => saveManagedBuckets(buckets), [buckets])
  useEffect(() => saveLayoutPreferences(layout), [layout])
  useEffect(() => saveColorTheme(colorTheme), [colorTheme])
  useEffect(() => saveSimulationDraft(simulationDraft), [simulationDraft])
  useEffect(() => saveRadarStageFilter(radarStageFilter), [radarStageFilter])
  useEffect(() => saveAnalysisSelection(analysisSelection), [analysisSelection])
  useEffect(() => {
    if (actionScopeMigrated) return
    setBuckets((current) => {
      let action = current.action
      for (const id of analysisSelection) {
        const item = opportunityCatalog.records[id]
        if (item) action = addObjectToBucket(action, { kind: 'opportunity', id: item.id, opportunityId: item.id, title: item.title })
      }
      return action === current.action ? current : { ...current, action }
    })
    saveActionScopeMigrated()
    setActionScopeMigrated(true)
  }, [actionScopeMigrated, analysisSelection, opportunityCatalog.records])
  useEffect(() => {
    setAnalysisSelection((current) => {
      const alive = new Set(catalogOpportunitiesByStatus(opportunityCatalog, 'active').map((item) => item.id))
      const next = current.filter((id) => alive.has(id))
      return next.length === current.length ? current : next
    })
  }, [opportunityCatalog])
  useEffect(() => {
    // Version migration: a portal/listing card removed from the project catalog
    // must not leave paid-module results or drag-bucket references behind.
    const alive = new Set(Object.keys(opportunityCatalog.records))
    const keepAlive = <T extends { opportunityId: string }>(items: T[]) => {
      const next = items.filter((item) => alive.has(item.opportunityId))
      return next.length === items.length ? items : next
    }
    setAnalysisRuns(keepAlive)
    setPolicyResults(keepAlive)
    setIndustryResults(keepAlive)
    setLeadResults(keepAlive)
    setCreditRiskResults(keepAlive)
    setProjectWatches(keepAlive)
    setBuckets((current) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(current).map(([bucket, objects]) => {
        const retained = objects.filter((object) => {
          const opportunityId = object.opportunityId ?? (object.kind === 'opportunity' ? object.id : undefined)
          return !opportunityId || alive.has(opportunityId)
        })
        if (retained.length !== objects.length) changed = true
        return [bucket, retained]
      })) as ManagedBuckets
      return changed ? next : current
    })
  }, [opportunityCatalog.records])
  useEffect(() => saveProjectWatches(projectWatches), [projectWatches])
  useEffect(() => saveAnalysisRuns(analysisRuns), [analysisRuns])
  useEffect(() => savePolicyChainResults(policyResults), [policyResults])
  useEffect(() => saveIndustryChainResults(industryResults), [industryResults])
  useEffect(() => saveLeadResults(leadResults), [leadResults])
  useEffect(() => saveCreditRiskResults(creditRiskResults), [creditRiskResults])
  useEffect(() => saveOpportunityCatalog(opportunityCatalog), [opportunityCatalog])
  useEffect(() => saveDeepRadarResults(radarOpportunities), [radarOpportunities])
  useEffect(() => {
    setRadarOpportunities((current) => {
      const eligible = eligibleDeepRadarOpportunities(businessProfile, current)
      return eligible.length === current.length ? current : eligible
    })
  }, [businessProfile])
  useEffect(() => {
    let active = true
    void window.shijiDesktop?.search.getPreference().then((response) => {
      if (active && response.ok) setSearchProvider(response.value.defaultProvider)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!draggedObject) return
    const cancelPointerDrag = (event: PointerEvent) => { const target = event.target as HTMLElement | null; if (target?.closest('.drop-dock')) return
      setDraggedObject(undefined)
      setActiveDrop(undefined)
    }
    window.addEventListener('pointerup', cancelPointerDrag)
    return () => window.removeEventListener('pointerup', cancelPointerDrag)
  }, [draggedObject])
  const opportunities = useMemo(() => catalogOpportunitiesByStatus(opportunityCatalog, 'active'), [opportunityCatalog])
  const nearbyOpportunities = useMemo(() => catalogNearbyOpportunities(opportunityCatalog), [opportunityCatalog])
  const archivedOpportunities = useMemo(() => catalogOpportunitiesByStatus(opportunityCatalog, 'archived'), [opportunityCatalog])
  const ignoredOpportunities = useMemo(() => catalogOpportunitiesByStatus(opportunityCatalog, 'ignored'), [opportunityCatalog])
  const actionProjects = useMemo(() => selectActionProjects(Object.values(opportunityCatalog.records), buckets.action), [opportunityCatalog, buckets.action])
  const compareProjects = useMemo(() => selectBucketProjects(Object.values(opportunityCatalog.records), buckets.compare, MAX_COMPARE_PROJECTS), [opportunityCatalog, buckets.compare])
  const selected = useMemo(() => {
    if (workspace.activeView === 'actions' && workspace.selectedOpportunityId) {
      return opportunityCatalog.records[workspace.selectedOpportunityId] ?? byId(opportunities, workspace.selectedOpportunityId) ?? opportunities[0]
    }
    return byId(opportunities, workspace.selectedOpportunityId) ?? opportunities[0]
  }, [opportunities, opportunityCatalog.records, workspace.activeView, workspace.selectedOpportunityId])
  const radarSelected = useMemo(() => byId(radarOpportunities, workspace.selectedRadarOpportunityId) ?? radarOpportunities[0], [radarOpportunities, workspace.selectedRadarOpportunityId])
  const nearbySelected = useMemo(() => byId(nearbyOpportunities, workspace.selectedOpportunityId) ?? nearbyOpportunities[0], [nearbyOpportunities, workspace.selectedOpportunityId])

  useEffect(() => {
    if (launchWatchCheckStarted.current) return
    launchWatchCheckStarted.current = true
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) return
    const dueWatches = selectDueLaunchProjectWatches(projectWatches, new Date(), projectWatches.length, PROJECT_WATCH_WEEKLY_INTERVAL_MS)
    const watch = dueWatches[0]
    const item = watch ? opportunityCatalog.records[watch.opportunityId] : undefined
    if (!watch || !item || !window.shijiDesktop?.search.discoverProjectTimeline) return
    const remainingDueCount = Math.max(0, dueWatches.length - 1)
    void executeProjectWatchCheck(watch, item, 'launch', remainingDueCount)
  }, [])

  const shellStyle = {
    '--rail-width': `${layout.railWidth}px`,
    '--conversation-width': `${layout.conversationWidth}px`,
  } as CSSProperties

  /**
   * 发现结果 ↔ 总览：勾选即追加、取消即移出。附近结果有独立可见列表；
   * 深度雷达结果则在首次勾选时并入。移出只影响当前结果列表，不删除项目或证据。
   */
  function toggleOpportunityInOverview(id: string, next: boolean) {
    const item = opportunityCatalog.records[id] ?? radarOpportunities.find((entry) => entry.id === id)
    if (!item) return
    if (next) {
      setOpportunityCatalog((current) => appendToCurrentResults(current, [item], item.evidenceIds))
      setMessage(`已把「${item.title}」加入「总览」当前结果（原有项目保留）。切到总览再勾选它，就能进入时间链 / 政策链 / 产业链 / 公开风险 / 获客模块分析。`)
      return
    }
    setOpportunityCatalog((current) => removeFromCurrentResults(current, id))
    setMessage(`已把「${item.title}」从「总览」当前结果移出（搜索结果仍在，随时可以再勾选）。`)
  }
  /** 原始发现线索不是项目卡；移出本次列表但保留本机缓存和已建立的项目引用。 */
  function removeEvidenceFromCurrent(evidenceId: string) {
    const record = searchEvidence.find((entry) => entry.id === evidenceId)
    setOpportunityCatalog((current) => removeEvidenceFromNearbyResults(current, evidenceId))
    setMessage(`已将「${record?.title ?? '来源线索'}」移出本次结果列表；原始证据仍保留在本机。`)
  }
  /** 把项目移出分析范围（模块页「移出」用它；不会又被"退回当前选中"带回来）。 */
  function removeFromAnalysisScope(id: string) {
    const next = analysisSelection.filter((entry) => entry !== id)
    setAnalysisSelection(next)
    if (next.length === 0) setScopeCleared(true)
    setMessage(next.length === 0 ? '已移出分析范围；当前没有勾选任何项目，去「总览」勾选要分析的项目即可。' : `已移出分析范围；剩余 ${next.length} 个项目仍在范围内。`)
  }
  function openView(activeView: WorkspaceView) {
    if (IS_TRIAL_EDITION && activeView === 'settings') {
      setMessage('体验版不设置 Key。正式版由用户自行填写豆包与 DeepSeek Key 后搜索。')
      return
    }
    if (activeView === 'radar' || activeView === 'nearby') setMode(activeView)
    if (activeView === 'risk') setBusinessCreditRequest(undefined)
    setWorkspace((current) => ({ ...current, activeView }))
  }

  /** 从行动页补充专项分析：只装载当前行动项目并进入模块，不触发搜索或模型调用。 */
  function openAnalysisForActionProject(activeView: WorkspaceView, opportunityId: string) {
    if (!['timeline', 'policy', 'industry', 'risk', 'leads'].includes(activeView)) return
    const item = opportunityCatalog.records[opportunityId]
    if (!item) {
      setMessage('该行动项目已不在本机项目库，无法装载到分析模块。')
      return
    }
    setAnalysisSelection([opportunityId])
    setScopeCleared(false)
    setWorkspace((current) => ({ ...current, activeView, selectedOpportunityId: opportunityId }))
    setMessage(`已把“${item.title}”装载到${activeView === 'timeline' ? '时间链' : activeView === 'policy' ? '政策链' : activeView === 'industry' ? '产业链' : activeView === 'risk' ? '公开风险' : '获客'}；请确认预计调用量后再点击“启动分析”，当前没有产生调用。`)
  }

  function removeFromActionScope(opportunityId: string) {
    const item = opportunityCatalog.records[opportunityId]
    setBuckets((current) => ({ ...current, action: removeActionProject(current.action, opportunityId) }))
    setMessage(`已把${item ? `“${item.title}”` : '该项目'}从行动清单移出；项目、证据和已有分析结果仍保留在本机。`)
  }

  function removeFromCompareScope(opportunityId: string) {
    const item = opportunityCatalog.records[opportunityId]
    setBuckets((current) => ({ ...current, compare: removeProjectFromBucket(current.compare, opportunityId) }))
    setMessage(`已把${item ? `“${item.title}”` : '该项目'}移出对比篮；项目、证据和分析结果仍保留在本机。`)
  }

  function openCompareRisk(opportunityId: string) {
    const item = opportunityCatalog.records[opportunityId]
    if (!item) {
      setMessage('该对比项目已不在本机项目库，无法打开公开风险。')
      return
    }
    if (!opportunities.some((entry) => entry.id === opportunityId)) {
      setOpportunityCatalog((current) => appendToCurrentResults(current, [item], item.evidenceIds))
      setAnalysisSelection((current) => current.filter((entry) => entry !== opportunityId))
      setScopeCleared(true)
      setWorkspace((current) => ({ ...current, activeView: 'overview', selectedOpportunityId: opportunityId }))
      setMessage(`已将“${item.title}”加入总览；请在项目列表勾选它，再进入公开风险。当前没有发起查询。`)
      return
    }
    if (!analysisSelection.includes(opportunityId) && !creditRiskResults.some((entry) => entry.opportunityId === opportunityId)) {
      setWorkspace((current) => ({ ...current, activeView: 'overview', selectedOpportunityId: opportunityId }))
      setMessage(`请在总览勾选“${item.title}”，再进入公开风险点击“启动分析”；当前没有发起查询。`)
      return
    }
    setAnalysisSelection((current) => current.includes(opportunityId) ? current : [...current, opportunityId])
    setScopeCleared(false)
    setWorkspace((current) => ({ ...current, activeView: 'risk', selectedOpportunityId: opportunityId }))
    setMessage(`已打开“${item.title}”的公开风险；其他已勾选项目仍保留在分析范围，当前没有发起查询。`)
  }

  function openBusinessCredit(subjectName: string, focus = '') {
    setBusinessCreditRequest({ subjectName: subjectName.trim(), focus: focus.trim(), nonce: Date.now() })
    setWorkspace((current) => ({ ...current, activeView: 'risk' }))
    setMessage(`已进入工商档案；请确认主体和关注事项后再运行，本次尚未产生 API 调用。`)
  }

  async function runTask(prompt: string, inputMode: SearchInputMode = 'free') {
    if (IS_TRIAL_EDITION) {
      setMessage('体验版只展示带来源的离线历史案例；实时搜索在正式版由用户填写自己的 Key 后运行。')
      return
    }
    // Search uses one shared DSH runner; keep the UI routes visually independent,
    // but never let a fast double-click start a second task and replace its abort handle.
    if (activeRun.current) return
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('桌面程序与当前界面版本不一致，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const finishActivity = onActivityStart(mode === 'radar'
      ? `商机雷达 · ${inputMode === 'conditions' ? '按条件搜索' : '自由搜索'}`
      : `附近招标 · ${inputMode === 'conditions' ? '按条件搜索' : '自由搜索'}`)
    const taskProfile = profile
    const preservedProjectIds = [
      ...analysisSelection,
      ...projectWatches.map((watch) => watch.opportunityId),
      ...Object.values(buckets).flatMap((items) => items.flatMap((object) => object.opportunityId ?? (object.kind === 'opportunity' ? object.id : []))),
    ]
    if (mode === 'nearby') setMapProfile(taskProfile)
    setRunStage('解析条件')
    setRunningInputMode(inputMode)
    setRunning(true)
    if (mode === 'radar') {
      setRadarFailure(undefined)
      // 新一轮雷达必须先清空上一轮可见结果；否则本次失败时旧的北京项目会被误认成南京搜索结果。
      setRadarOpportunities([])
    } else {
      // 附近招标同样不能在新任务失败时继续展示上一轮地点的卡片。
      setOpportunityCatalog((current) => replaceNearbyResults(current, [], [], preservedProjectIds))
    }
    const taskId = `task-${Date.now()}`
    const activeView: WorkspaceView = mode
    setWorkspace((current) => ({ ...current, activeView,
      ...(mode === 'radar' ? { selectedRadarOpportunityId: undefined } : {}),
      ...(mode === 'nearby' ? { selectedOpportunityId: undefined } : {}),
      currentTask: {
      id: taskId, title: prompt || `${profile.address} · ${profile.specialty}`,
      createdAt: new Date().toISOString(), status: 'running', mode,
      nearbyAudience: mode === 'nearby' ? 'enterprise' : undefined,
      request: mode === 'radar' ? businessProfile : taskProfile, opportunityIds: [],
    } }))
    const controller = new AbortController()
    activeRun.current = { taskId, controller }
    const agentTask: AgentTask = mode === 'radar'
      ? createDeepRadarTask(taskId, prompt, businessProfile, searchProvider, radarStageFilter, inputMode)
      : {
          id: taskId,
          kind: 'nearby-enterprise-search',
          prompt,
          criteria: taskProfile,
          inputMode,
          searchProvider,
        }
    try {
      setRunStage('搜索公开来源')
      const result = await agentRunner.run(agentTask, { signal: controller.signal, timeoutMs: 180000, onEvent: (event) => { setMessage(event.message); setRunStage(runStageForMessage(event.message)) } })
      if (result.handoff) {
        if (result.handoff.route === 'risk') openBusinessCredit(result.handoff.subject, prompt)
          if (mode === 'radar') setRadarFailure(result.handoff.message)
        setMessage(`${result.handoff.message}${result.handoff.route === 'risk' ? ' 已打开工商档案，确认后运行专项搜索。' : ''}`)
        setWorkspace((current) => ({ ...current, currentTask: current.currentTask ? { ...current.currentTask, status: 'draft' } : undefined }))
        return
      }
      setRunStage('整理结果卡片')
      if (mode === 'radar') {
        const eligibleRadarResults = eligibleDeepRadarOpportunities(businessProfile, result.opportunities)
        const removedMismatchCount = result.opportunities.length - eligibleRadarResults.length
        setRadarOpportunities(eligibleRadarResults)
        setRadarFailure(undefined)
        const radarEvidenceIds = new Set(eligibleRadarResults.flatMap((item) => item.evidenceIds))
        const retainedEvidenceIds = new Set([...opportunityCatalog.currentEvidenceIds, ...(opportunityCatalog.nearbyEvidenceIds ?? []), ...Object.values(opportunityCatalog.records).flatMap((item) => item.evidenceIds), ...radarEvidenceIds])
        const mergedEvidence = mergeEvidenceRecords(searchEvidence, result.evidenceRecords ?? []).filter((record) => retainedEvidenceIds.has(record.id))
        setSearchEvidence(mergedEvidence)
        saveSearchEvidence(mergedEvidence)
        setWorkspace((current) => ({ ...current, selectedRadarOpportunityId: eligibleRadarResults[0]?.id,
          currentTask: current.currentTask ? { ...current.currentTask, request: businessProfile, status: 'done', opportunityIds: eligibleRadarResults.map((item) => item.id) } : undefined,
        }))
        if (removedMismatchCount > 0) {
          setMessage(`雷达完成：保留 ${eligibleRadarResults.length} 个可继续核验项目；已剔除 ${removedMismatchCount} 个存在明确地域或专业冲突的项目。`)
        }
        return
      }
      saveBusinessObjects(result.opportunities, result.evidenceRecords ?? [])
      if (result.interpretedCriteria) setMapProfile(result.interpretedCriteria)
      const nextCatalog = replaceNearbyResults(opportunityCatalog, result.opportunities, result.evidenceRecords?.map((record) => record.id) ?? [], preservedProjectIds)
      const activeResults = catalogNearbyOpportunities(nextCatalog)
      setOpportunityCatalog(nextCatalog)
      if (result.evidenceRecords) {
        const retainedEvidenceIds = new Set([
          ...nextCatalog.currentEvidenceIds,
          ...(nextCatalog.nearbyEvidenceIds ?? []),
          ...Object.values(nextCatalog.records).flatMap((item) => item.evidenceIds),
          ...radarOpportunities.flatMap((item) => item.evidenceIds),
        ])
        const mergedEvidence = mergeEvidenceRecords(searchEvidence, result.evidenceRecords).filter((record) => retainedEvidenceIds.has(record.id))
        setSearchEvidence(mergedEvidence)
        saveSearchEvidence(mergedEvidence)
      }
      setWorkspace((current) => ({ ...current, selectedOpportunityId: activeResults[0]?.id,
        currentTask: current.currentTask ? { ...current.currentTask, request: result.interpretedCriteria ?? taskProfile, status: 'done', opportunityIds: activeResults.map((item) => item.id) } : undefined,
      }))
      if (activeResults.length < result.opportunities.length) setMessage(`搜索完成；${result.opportunities.length - activeResults.length} 个已归档或不感兴趣项目未重新加入结果列表。`)
    } catch (error) {
      const cancelled = error instanceof AgentRunError && error.code === 'CANCELLED'
      const failureText = cancelled ? '任务已停止；本次没有生成新结果，已归档项目和管理对象不受影响。' : `任务未完成：${error instanceof Error ? error.message : '本地运行时发生未知错误。'}`
      if (mode === 'radar' && !cancelled) setRadarFailure(failureText)
      setMessage(failureText)
      setWorkspace((current) => ({ ...current, currentTask: current.currentTask
        ? { ...current.currentTask, status: cancelled ? 'cancelled' : 'failed' }
        : undefined }))
    } finally {
      if (activeRun.current?.taskId === taskId) activeRun.current = undefined
      setRunning(false)
      setRunningInputMode(undefined)
      setRunStage(undefined)
      finishActivity()
    }
  }

  function cancelTask() {
    activeRun.current?.controller.abort()
    setMessage('正在停止当前任务…')
  }

  function subscribeCurrentProject(opportunityId?: string) {
    // 时间链结果卡片按项目订阅：显式传入项目 id 时就订阅那一个，否则退回当前选中项目。
    const target = (opportunityId ? opportunityCatalog.records[opportunityId] : undefined) ?? selected
    if (!target) return
    setProjectWatches((current) => {
      const existing = current.find((watch) => watch.opportunityId === target.id)
      if (existing) return current.map((watch) => watch.id === existing.id ? { ...watch, status: 'active' } : watch)
      return [createProjectWatch({ opportunityId: target.id, title: target.title, evidence: target.timelineEvidence }), ...current]
    })
    setMessage(`已在本机订阅“${target.title}”的阶段变化。距上次检查满 7 天后，应用下次启动会自动核验 1 个到期项目；其余项目可在关注页手动检查。`)
    openView('watch')
  }

  function toggleProjectWatch(id: string) {
    setProjectWatches((current) => current.map((watch) => watch.id === id
      ? { ...watch, status: watch.status === 'active' ? 'paused' : 'active' }
      : watch))
  }

  /** 取消跟踪：删除该项目的订阅（时间链页 / 关注页 / 管理栏「追踪」是同一条 ProjectWatch）。 */
  /** 勾选/取消勾选：把项目加入或移出模块分析范围。 */
  function toggleAnalysisSelection(id: string) {
    setAnalysisSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  /** 全选当前结果集（只写 id，不复制项目）。 */
  function selectAllAnalysis(ids: string[]) {
    setAnalysisSelection([...new Set(ids)])
  }

  /** 清空分析范围。 */
  function clearAnalysisSelection() {
    setAnalysisSelection([])
    // 「清空」是用户明确清空分析范围：模块页不得再退回当前选中项目。
    setScopeCleared(true)
  }

function unsubscribeProject(id: string) {
    const target = projectWatches.find((watch) => watch.id === id)
    setProjectWatches((current) => current.filter((watch) => watch.id !== id))
    setMessage(`已取消跟踪${target ? `“${target.title}”` : ''}；该项目不再参与阶段复查，已取得的证据与时间链保持不变。`)
  }


  function updateAnalysisRun(next: AnalysisRunState) {
    setAnalysisRuns((current) => upsertAnalysisRun(current, next))
  }

  /** 按总览勾选范围逐个执行时间链；处理数量与用户选择一致。 */
  async function runTimelineAnalysisScope(opportunityIds: string[]) {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) { setMessage('请先在总览勾选至少一个项目，或选中一个项目后再启动分析。'); return }
    if (ids.length > 1) setMessage(`开始批量补全 ${ids.length} 个项目的时间链；每个项目最多 1 次豆包搜索，不调用 DSH。`)
    for (const id of ids) await runTimelineAnalysis(id)
  }
  async function runTimelineAnalysis(opportunityId: string) {
    if (IS_TRIAL_EDITION) {
      const item = opportunityCatalog.records[opportunityId]
      if (!item) return
      const found = (item.timelineEvidence ?? []).length
      updateAnalysisRun({ opportunityId, moduleId: 'timeline', targetSubjectName: item.companyName, status: 'partial', updatedAt: new Date().toISOString(),
        message: `离线历史回放：已存档 ${found} 条阶段证据；其他阶段未取得，不代表当前状态。`, actualSearchCalls: 0, actualModelCalls: 0 })
      setMessage(`时间链历史回放：${found} 条存档阶段证据；本次没有联网或调用模型。`)
      return
    }
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('时间链执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const item = opportunityCatalog.records[opportunityId]
    const timelineApi = window.shijiDesktop?.search.discoverProjectTimeline
    if (!item || !timelineApi) {
      setMessage('项目时间链执行器不可用，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    updateAnalysisRun({
      opportunityId, moduleId: 'timeline', targetSubjectName: item.companyName,
      status: 'running', updatedAt: new Date().toISOString(), message: '正在补搜项目全阶段证据。',
      actualSearchCalls: 0, actualModelCalls: 0,
    })
    const finishActivity = onActivityStart(`时间链 · ${item.title}`)
    try {
      const response = await timelineApi({
        opportunityId, projectTitle: item.title, companyName: item.companyName,
        knownIdentifiers: identifiersForOpportunity(item.evidenceIds, searchEvidence), mode: 'full',
      })
      if (!response.ok) throw new Error(response.message)
      const mergedEvidence = mergeEvidenceRecords(searchEvidence, response.value.evidenceRecords)
      const updatedOpportunity = {
        ...item,
        evidenceIds: uniqueStrings([...item.evidenceIds, ...response.value.evidenceRecords.map((record) => record.id)]),
        timelineEvidence: mergeTimelineEvidence(item.timelineEvidence, response.value.confirmedStageEvidence),
      }
      setSearchEvidence(mergedEvidence)
      saveSearchEvidence(mergedEvidence)
      setOpportunityCatalog((current) => updateCatalogOpportunity(current, updatedOpportunity))
      saveBusinessObjects([updatedOpportunity], response.value.evidenceRecords)
      const confirmed = response.value.confirmedStageEvidence.length
      const candidates = response.value.candidateEvidenceIds.length
      updateAnalysisRun({
        opportunityId, moduleId: 'timeline', targetSubjectName: item.companyName,
        status: candidates > 0 ? 'partial' : 'completed', updatedAt: response.value.checkedAt,
        message: `补全执行完成：新增 ${confirmed} 条阶段证据，保留 ${candidates} 条待核候选。`,
        actualSearchCalls: response.value.requestCount, actualModelCalls: 0,
      })
      setMessage(`时间链补全完成：${confirmed} 条达到阶段门槛，${candidates} 条作为候选保留；${response.value.cacheHit ? '命中缓存，未新增搜索调用' : `实际搜索 ${response.value.requestCount} 次`}，未调用 DSH。`)
    } catch (error) {
      const failure = error instanceof Error ? error.message : '项目时间链补全失败。'
      updateAnalysisRun({
        opportunityId, moduleId: 'timeline', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(), message: failure,
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`时间链补全未完成：${failure}`)
    } finally {
      finishActivity()
    }
  }

  async function runPolicyChainFor(opportunityId: string) {
    if (IS_TRIAL_EDITION) {
      const result = trialPolicyResult(opportunityId)
      if (!result) return
      setPolicyResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({ opportunityId, moduleId: 'policy', targetSubjectName: result.subjectName, status: result.findings.length ? 'completed' : 'partial', updatedAt: new Date().toISOString(),
        message: `离线历史回放：${result.findings.length} 条存档政策背景；未证明资金拨付给该甲方。`, actualSearchCalls: 0, actualModelCalls: 0 })
      setMessage('政策链历史回放完成；非实时搜索，文件发布日期和来源请见卡片。')
      return
    }
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('政策链执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const item = opportunityCatalog.records[opportunityId]
    const api = window.shijiDesktop?.search.runPolicyChain
    if (!item || !api) {
      setMessage('政策链执行器不可用，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    // 同上：政策链查询固定，6 小时内直接复用本机结果。
    const reusedPolicy = policyResults.find((entry) => entry.opportunityId === opportunityId)
    if (reusedPolicy && isAnalysisResultFresh(reusedPolicy.checkedAt)) {
      const served = { ...reusedPolicy, requestCount: 0, cacheHit: true }
      setPolicyResults((current) => [served, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({
        opportunityId, moduleId: 'policy', targetSubjectName: item.companyName,
        status: served.findings.length > 0 ? 'completed' : 'partial', updatedAt: served.checkedAt,
        message: formatCachedResultLabel(served.checkedAt), actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`政策链：${formatCachedResultLabel(served.checkedAt)}`)
      return
    }
    updateAnalysisRun({
      opportunityId, moduleId: 'policy', targetSubjectName: item.companyName,
      status: 'running', updatedAt: new Date().toISOString(), message: '正在按国家 / 省 / 市三级检索政策与预算文件。',
      actualSearchCalls: 0, actualModelCalls: 0,
    })
    const finishActivity = onActivityStart(`政策链 · ${item.title}`)
    try {
      const response = await api({
        opportunityId,
        projectTitle: item.title,
        companyName: item.companyName,
        ...(item.locationAddress ? { address: item.locationAddress } : {}),
        industry: item.projectType,
        stageDates: (item.timelineEvidence ?? []).map((entry) => ({ stageId: entry.stageId, occurredAt: entry.occurredAt })),
      })
      if (!response.ok) throw new Error(response.message)
      const result = response.value
      setPolicyResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      if (runCallOutcome(result) === 'no-search') throw new Error('本次没有发起任何检索，也没有可用的本机缓存，请重新运行或检查搜索 Key。')
      const coverage = result.regionPath.map((level) => {
        const count = result.findings.filter((finding) => finding.levelId === level.id).length
        return `${level.label} ${count} 条`
      }).join(' / ')
      updateAnalysisRun({
        opportunityId, moduleId: 'policy', targetSubjectName: item.companyName,
        status: result.findings.length > 0 ? 'completed' : 'partial', updatedAt: result.checkedAt,
        message: `三级政策与预算：${coverage}；预测 ${result.predictions.length} 条（${result.predictions.every((entry) => entry.certainty === 'forecast') ? '均为预测性建议' : '含正式公开节点'}）。`,
        actualSearchCalls: result.requestCount, actualModelCalls: 0,
      })
      setMessage(`政策链完成：${coverage}；预测 ${result.predictions.length} 条；${result.cacheHit ? '命中缓存，未新增搜索调用' : `实际搜索 ${result.requestCount} 次`}，未调用 DSH。`)
    } catch (error) {
      const failure = error instanceof Error ? error.message : '政策链检索失败。'
      updateAnalysisRun({
        opportunityId, moduleId: 'policy', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(), message: failure,
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`政策链未完成：${failure}`)
    } finally {
      finishActivity()
    }
  }

  async function runIndustryChainFor(opportunityId: string) {
    if (IS_TRIAL_EDITION) {
      const result = trialIndustryResult(opportunityId)
      if (!result) return
      setIndustryResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({ opportunityId, moduleId: 'industry', targetSubjectName: result.owner.name, status: 'completed', updatedAt: new Date().toISOString(),
        message: `离线历史回放：${result.winners.length} 家中标/成交主体线索、${result.suppliers.length} 家代理等关系；逐条保留来源。`, actualSearchCalls: 0, actualModelCalls: 0 })
      setMessage('产业链历史回放完成；这些关系来自历史公告或转载，不代表现在仍合作。')
      return
    }
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('产业链执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const item = opportunityCatalog.records[opportunityId]
    const api = window.shijiDesktop?.search.runIndustryChain
    if (!item || !api) {
      setMessage('产业链执行器不可用，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    // 同上：产业链 6 小时内直接复用本机结果。
    const reusedIndustry = industryResults.find((entry) => entry.opportunityId === opportunityId)
    if (reusedIndustry && isAnalysisResultFresh(reusedIndustry.checkedAt)) {
      const served = { ...reusedIndustry, requestCount: 0, cacheHit: true }
      setIndustryResults((current) => [served, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({
        opportunityId, moduleId: 'industry', targetSubjectName: item.companyName,
        status: served.winners.length + served.suppliers.length > 0 ? 'completed' : 'partial', updatedAt: served.checkedAt,
        message: formatCachedResultLabel(served.checkedAt), actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`产业链：${formatCachedResultLabel(served.checkedAt)}`)
      return
    }
    updateAnalysisRun({
      opportunityId, moduleId: 'industry', targetSubjectName: item.companyName,
      status: 'running', updatedAt: new Date().toISOString(), message: '正在检索该甲方的历史中标企业与上下游供应链。',
      actualSearchCalls: 0, actualModelCalls: 0,
    })
    const finishActivity = onActivityStart(`产业链 · ${item.title}`)
    try {
      const response = await api({
        opportunityId,
        projectTitle: item.title,
        companyName: item.companyName,
        ...(item.locationAddress ? { address: item.locationAddress } : {}),
        industry: item.projectType,
      })
      if (!response.ok) throw new Error(response.message)
      const result = response.value
      setIndustryResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      if (runCallOutcome(result) === 'no-search') throw new Error('本次没有发起任何检索，也没有可用的本机缓存，请重新运行或检查搜索 Key。')
      const summary = `甲方 ${result.owner.name || '待核验'}；以往中标 ${result.winners.length} 家 / 上下游 ${result.suppliers.length} 家`
      updateAnalysisRun({
        opportunityId, moduleId: 'industry', targetSubjectName: item.companyName,
        status: result.winners.length + result.suppliers.length > 0 ? 'completed' : 'partial', updatedAt: result.checkedAt,
        message: `${summary}。`,
        actualSearchCalls: result.requestCount, actualModelCalls: 0,
      })
      setMessage(`产业链完成：${summary}；${result.cacheHit ? '命中缓存，未新增搜索调用' : `实际搜索 ${result.requestCount} 次`}，未调用 DSH。`)
    } catch (error) {
      const failure = error instanceof Error ? error.message : '产业链检索失败。'
      updateAnalysisRun({
        opportunityId, moduleId: 'industry', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(), message: failure,
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`产业链未完成：${failure}`)
    } finally {
      finishActivity()
    }
  }

  async function runCreditRiskFor(opportunityId: string) {
    if (IS_TRIAL_EDITION) {
      const result = trialRiskResult(opportunityId)
      if (!result) return
      setCreditRiskResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({ opportunityId, moduleId: 'risk', targetSubjectName: result.subjectName, status: 'partial', updatedAt: new Date().toISOString(),
        message: '离线历史回放：展示存档主体资料及核查缺口；未取得具体风险事实不等于无风险。', actualSearchCalls: 0, actualModelCalls: 0 })
      setMessage('公开风险历史回放完成；本次没有联网，登记和信用状态需重新核验。')
      return
    }
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('公开风险执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const item = opportunityCatalog.records[opportunityId]
    const api = window.shijiDesktop?.search.runCreditRisk
    if (!item || !api) {
      setMessage('公开风险执行器不可用，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    // 6 小时窗口内已经算过同一项目  直接复用本机结果，不做任何新调用（用户 2026-09-17 口径）。
    const reusedRisk = creditRiskResults.find((entry) => entry.opportunityId === opportunityId)
    if (reusedRisk && isAnalysisResultFresh(reusedRisk.checkedAt)) {
      const served = { ...reusedRisk, requestCount: 0, cacheHit: true }
      setCreditRiskResults((current) => [served, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({
        opportunityId, moduleId: 'risk', targetSubjectName: item.companyName,
        status: served.facts.length > 0 ? 'completed' : 'partial', updatedAt: served.checkedAt,
        message: formatCachedResultLabel(served.checkedAt), actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`公开风险：${formatCachedResultLabel(served.checkedAt)}`)
      return
    }
    updateAnalysisRun({
      opportunityId, moduleId: 'risk', targetSubjectName: item.companyName,
      status: 'running', updatedAt: new Date().toISOString(), message: '正在检索该招标单位的基础登记信息与公开风险记录。',
      actualSearchCalls: 0, actualModelCalls: 0,
    })
    const finishActivity = onActivityStart(`公开风险 · ${item.title}`)
    try {
      const response = await api({
        opportunityId,
        projectTitle: item.title,
        companyName: item.companyName,
        ...(item.locationAddress ? { address: item.locationAddress } : {}),
        industry: item.projectType,
      })
      if (!response.ok) throw new Error(response.message)
      const result = response.value
      setCreditRiskResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      if (runCallOutcome(result) === 'no-search') throw new Error('本次没有发起任何检索，也没有可用的本机缓存，请重新运行或检查搜索 Key。')
      const summary = `主体 ${result.subjectName}（${result.profile.subjectType === 'enterprise' ? '企业' : result.profile.subjectType === 'government' ? '政府机关' : result.profile.subjectType === 'public-institution' ? '事业单位' : '类型待核验'}）；风险事实 ${result.facts.length} 条`
      updateAnalysisRun({
        opportunityId, moduleId: 'risk', targetSubjectName: item.companyName,
        status: result.facts.length > 0 ? 'completed' : 'partial', updatedAt: result.checkedAt,
        message: `${summary}。`,
        actualSearchCalls: result.requestCount, actualModelCalls: result.modelCalls ?? 0,
      })
      setMessage(`公开风险完成：${summary}；${result.cacheHit ? '命中缓存，未新增调用' : `实际搜索 ${result.requestCount} 次、DSH ${result.modelCalls ?? 0} 次`}。`)
    } catch (error) {
      const failure = error instanceof Error ? error.message : '公开风险检索失败。'
      updateAnalysisRun({
        opportunityId, moduleId: 'risk', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(), message: failure,
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`公开风险未完成：${failure}`)
    } finally {
      finishActivity()
    }
  }

  /** 按总览勾选范围逐个执行公开风险；处理数量与用户选择一致。 */
  async function runCreditRiskScope(opportunityIds: string[]) {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) { setMessage('请先在总览勾选至少一个项目，或选中一个项目后再启动分析。'); return }
    if (ids.length > 1) setMessage(`开始批量分析 ${ids.length} 个项目的公开风险；先跑 4 组基础检索，再按证据缺口补查并由 DSH 做证据约束归纳，最终显示实际调用数。`)
    for (const id of ids) await runCreditRiskFor(id)
  }
  /** 按总览勾选范围逐个执行产业链；处理数量与用户选择一致。 */
  async function runIndustryChainScope(opportunityIds: string[]) {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) { setMessage('请先在总览勾选至少一个项目，或选中一个项目后再启动分析。'); return }
    if (ids.length > 1) setMessage(`开始批量分析 ${ids.length} 个项目的产业链；每项目 3 次关系检索 + 最多 4 家工商补全，搜索上限 7 次，不调用 DSH。`)
    for (const id of ids) await runIndustryChainFor(id)
  }

  /**
   * 获客（用户 2026-09-18 确认）：对象取自**产业链已发现的同一批节点**（不含甲方），
   * 每家最多 4 个公开渠道铺底 + 最多 2 轮模型补充（只缺邮箱 1 轮）；没有产业链节点时不给跑（硬门禁）。
   */
  async function runLeadsFor(opportunityId: string) {
    if (IS_TRIAL_EDITION) {
      const industry = industryResults.find((entry) => entry.opportunityId === opportunityId)
      const item = opportunityCatalog.records[opportunityId]
      if (!item) return
      if (!industry) { setMessage('请先回放这个项目的产业链，再查看同一批企业的公开联系方式。'); return }
      const result = trialLeadResult(opportunityId, industry)
      if (!result) return
      setLeadResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({ opportunityId, moduleId: 'leads', targetSubjectName: item.companyName, status: 'partial', updatedAt: new Date().toISOString(),
        message: `离线历史回放：${result.rows.length} 家产业链主体；仅展示已留存来源的联系方式，缺失项不编造。`, actualSearchCalls: 0, actualModelCalls: 0 })
      setMessage('获客历史回放完成；公开电话/地址不保证目前有效，也不代表本项目专属联系人。')
      return
    }
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('获客执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const item = opportunityCatalog.records[opportunityId]
    const api = window.shijiDesktop?.search.runLeads
    if (!item || !api) {
      setMessage('获客执行器不可用，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const industry = industryResults.find((entry) => entry.opportunityId === opportunityId)
    const nodes = industry ? buildLeadNodes(industry) : []
    if (nodes.length === 0) {
      updateAnalysisRun({
        opportunityId, moduleId: 'leads', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(),
        message: '该项目还没有产业链节点：获客只消费同一批节点，请先在产业链跑一次。',
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage('获客只消费产业链已经发现的节点：请先在这个项目上跑一次产业链，再回来跑获客。')
      return
    }
    const inputFingerprint = buildLeadInputFingerprint({ ownerName: item.companyName, nodes })
    const reusedLead = leadResults.find((entry) => entry.opportunityId === opportunityId && entry.inputFingerprint === inputFingerprint)
    if (reusedLead && isAnalysisResultFresh(reusedLead.checkedAt)) {
      const served = { ...reusedLead, requestCount: 0, cacheHit: true }
      setLeadResults((current) => [served, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      updateAnalysisRun({
        opportunityId, moduleId: 'leads', targetSubjectName: item.companyName,
        status: served.rows.length > 0 ? 'completed' : 'partial', updatedAt: served.checkedAt,
        message: formatCachedResultLabel(served.checkedAt), actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`获客：${formatCachedResultLabel(served.checkedAt)}`)
      return
    }
    updateAnalysisRun({
      opportunityId, moduleId: 'leads', targetSubjectName: item.companyName,
      status: 'running', updatedAt: new Date().toISOString(),
      message: `正在按产业链的 ${nodes.length} 家节点补联系人 / 邮箱 / 电话 / 公司地址（每家最多 4 个渠道，字段齐全即停；缺项最多补查 2 轮，本项目搜索上限 ${nodes.length * 6} 次）。`,
      actualSearchCalls: 0, actualModelCalls: 0,
    })
    const finishActivity = onActivityStart(`获客 · ${item.title}`)
    try {
      const response = await api({
        opportunityId,
        projectTitle: item.title,
        ownerName: item.companyName,
        industry: item.projectType,
        nodes,
      })
      if (!response.ok) throw new Error(response.message)
      const result = response.value
      setLeadResults((current) => [result, ...current.filter((entry) => entry.opportunityId !== opportunityId)])
      if (runCallOutcome(result) === 'no-search') throw new Error('本次没有发起任何检索，也没有可用的本机缓存，请重新运行或检查搜索 Key。')
      const withContacts = result.rows.filter((row) => row.missing.length < 4).length
      const summary = `本次对象 ${result.rows.length} 家，其中 ${withContacts} 家取得至少一项公开联系方式`
      updateAnalysisRun({
        opportunityId, moduleId: 'leads', targetSubjectName: item.companyName,
        status: withContacts > 0 ? 'completed' : 'partial', updatedAt: result.checkedAt,
        message: `${summary}。`,
        actualSearchCalls: result.requestCount, actualModelCalls: result.modelCalls,
      })
      setMessage(`获客完成：${summary}；${result.cacheHit ? '命中缓存，未新增搜索调用' : `实际搜索 ${result.requestCount} 次`}。`)
    } catch (error) {
      const failure = error instanceof Error ? error.message : '获客检索失败。'
      updateAnalysisRun({
        opportunityId, moduleId: 'leads', targetSubjectName: item.companyName,
        status: 'failed', updatedAt: new Date().toISOString(), message: failure,
        actualSearchCalls: 0, actualModelCalls: 0,
      })
      setMessage(`获客未完成：${failure}`)
    } finally {
      finishActivity()
    }
  }
  /** 按总览勾选范围逐个执行获客；处理数量与用户选择一致。 */
  async function runLeadsScope(opportunityIds: string[]) {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) { setMessage('请先在总览勾选至少一个项目，或选中一个项目后再启动分析。'); return }
    if (ids.length > 1) setMessage(`开始批量分析 ${ids.length} 个项目的获客；按实际产业链节点计费，每家公司搜索上限 6 次、DSH 上限 2 次，字段齐全会提前停止。`)
    for (const id of ids) await runLeadsFor(id)
  }
  /** 按总览勾选范围逐个执行政策链；处理数量与用户选择一致。 */
  async function runPolicyChainScope(opportunityIds: string[]) {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) { setMessage('请先在总览勾选至少一个项目，或选中一个项目后再启动分析。'); return }
    if (ids.length > 1) setMessage(`开始批量分析 ${ids.length} 个项目的政策链；每个项目最多 3 次豆包搜索，不调用 DSH。`)
    for (const id of ids) await runPolicyChainFor(id)
  }

  async function executeProjectWatchCheck(
    watch: ProjectWatch,
    item: Opportunity,
    trigger: 'manual' | 'launch',
    remainingDueCount = 0,
  ) {
    if (window.shijiDesktop && window.shijiDesktop.contractVersion !== DESKTOP_CONTRACT_VERSION) {
      setMessage('项目检查执行器已经更新，请关闭识机后从桌面快捷方式重新打开。')
      return
    }
    const timelineApi = window.shijiDesktop?.search.discoverProjectTimeline
    if (!timelineApi) return
    setCheckingWatchId(watch.id)
    const finishActivity = onActivityStart(`项目追踪 · 检查“${watch.title}”`)
    setMessage(`${trigger === 'launch' ? '启动检查：' : ''}正在检查“${watch.title}”的下一阶段和更正/终止信号…`)
    try {
      const response = await timelineApi({
        opportunityId: item.id, projectTitle: item.title, companyName: item.companyName,
        knownIdentifiers: identifiersForOpportunity(item.evidenceIds, searchEvidence),
        mode: 'watch-next', lastKnownStageId: watch.lastKnownStageId,
      })
      if (!response.ok) throw new Error(response.message)
      const mergedEvidence = mergeEvidenceRecords(searchEvidence, response.value.evidenceRecords)
      const mergedTimeline = mergeTimelineEvidence(item.timelineEvidence, response.value.confirmedStageEvidence)
      const updatedOpportunity = {
        ...item,
        evidenceIds: uniqueStrings([...item.evidenceIds, ...response.value.evidenceRecords.map((record) => record.id)]),
        timelineEvidence: mergedTimeline,
      }
      const check = applyProjectTimelineCheck(watch, mergedTimeline, response.value.checkedAt)
      setSearchEvidence(mergedEvidence)
      saveSearchEvidence(mergedEvidence)
      setOpportunityCatalog((current) => updateCatalogOpportunity(current, updatedOpportunity))
      saveBusinessObjects([updatedOpportunity], response.value.evidenceRecords)
      setProjectWatches((current) => current.map((candidate) => candidate.id === watch.id ? check.watch : candidate))
      if (check.advanced) setAnalysisRuns((current) => markOpportunityAnalysesStale(current, item.id, response.value.checkedAt))
      const budgetNote = trigger === 'launch' && remainingDueCount > 0 ? ` 本次启动最多自动检查 1 个，其余 ${remainingDueCount} 个请在关注页手动检查。` : ''
      setMessage(check.advanced
        ? `${trigger === 'launch' ? '启动检查完成：' : ''}项目阶段已从“${stageLabel(check.fromStageId)}”推进到“${stageLabel(check.toStageId)}”；证据已合并回同一项目。${budgetNote}`
        : `${trigger === 'launch' ? '启动检查完成：' : ''}没有取得可推进阶段的新证据；${response.value.cacheHit ? '命中缓存，未新增搜索调用' : `实际搜索 ${response.value.requestCount} 次`}。${budgetNote}`)
    } catch (error) {
      setMessage(`${trigger === 'launch' ? '启动' : '项目'}检查失败：${error instanceof Error ? error.message : '本地时间链执行器发生未知错误。'}`)
    } finally {
      setCheckingWatchId(undefined)
      finishActivity()
    }
  }

  async function checkProjectWatch(watchId: string) {
    if (checkingWatchId) return
    const watch = projectWatches.find((candidate) => candidate.id === watchId)
    const item = watch ? opportunityCatalog.records[watch.opportunityId] : undefined
    if (!watch || !item) return
    await executeProjectWatchCheck(watch, item, 'manual')
  }

  function updateSelectionAfterRemoval(id: string, nextCatalog: typeof opportunityCatalog) {
    const nextActive = catalogOpportunitiesByStatus(nextCatalog, 'active')
    setWorkspace((current) => ({
      ...current,
      selectedOpportunityId: current.selectedOpportunityId === id ? nextActive[0]?.id : current.selectedOpportunityId,
      currentTask: current.currentTask ? { ...current.currentTask, opportunityIds: current.currentTask.opportunityIds.filter((itemId) => itemId !== id) } : undefined,
    }))
  }

  function archiveProject(id: string) {
    const item = opportunityCatalog.records[id]
    if (!item) return
    const next = archiveOpportunity(opportunityCatalog, id)
    setOpportunityCatalog(next)
    updateSelectionAfterRemoval(id, next)
    setMessage(`已将“${item.title}”归档到本机项目库；证据继续保留，恢复后可继续报告和时间链。`)
  }

  function ignoreProject(id: string) {
    const item = opportunityCatalog.records[id]
    if (!item) return
    const next = ignoreOpportunity(opportunityCatalog, id)
    setOpportunityCatalog(next)
    updateSelectionAfterRemoval(id, next)
    setMessage(`已将“${item.title}”标记为不感兴趣；相同项目再次搜索时不会自动回到结果。`)
  }

  function restoreProject(id: string) {
    const item = opportunityCatalog.records[id]
    if (!item) return
    setOpportunityCatalog(restoreOpportunity(opportunityCatalog, id))
    setWorkspace((current) => ({ ...current, activeView: 'overview', selectedOpportunityId: id }))
    setMessage(`已将“${item.title}”恢复到当前结果。`)
  }

  function deleteProject(id: string) {
    const item = opportunityCatalog.records[id]
    if (!item) return
    const outcome = deleteOpportunity(opportunityCatalog, id)
    setOpportunityCatalog(outcome.catalog)
    updateSelectionAfterRemoval(id, outcome.catalog)
    const orphanedEvidence = new Set(outcome.orphanedEvidenceIds)
    const nextEvidence = searchEvidence.filter((record) => !orphanedEvidence.has(record.id))
    setSearchEvidence(nextEvidence)
    saveSearchEvidence(nextEvidence)
    setAnalysisRuns((current) => current.filter((state) => state.opportunityId !== id))
    setProjectWatches((current) => current.filter((watch) => watch.opportunityId !== id))
    setBuckets((current) => Object.fromEntries(Object.entries(current).map(([bucket, objects]) => [bucket, objects.filter((object) => object.id !== id && object.opportunityId !== id)])) as ManagedBuckets)
    deleteBusinessObjectsForOpportunity(id)
    setMessage(`已从本机删除“${item.title}”及其无引用证据；以后重新搜索仍可能再次发现该公开项目。`)
  }

  // 雷达结果集与本机项目库分开保存：归档/忽略并入项目库对应状态，删除只清理无引用证据。
  function detachRadarResult(id: string) {
    const next = radarOpportunities.filter((entry) => entry.id !== id)
    setRadarOpportunities(next)
    setWorkspace((current) => ({
      ...current,
      selectedRadarOpportunityId: current.selectedRadarOpportunityId === id ? next[0]?.id : current.selectedRadarOpportunityId,
    }))
  }

  function archiveRadarResult(id: string) {
    const item = radarOpportunities.find((entry) => entry.id === id)
    if (!item) return
    setOpportunityCatalog((current) => archiveOpportunity({ ...current, records: { ...current.records, [id]: item } }, id))
    detachRadarResult(id)
    setMessage(`已将“${item.title}”归档到本机项目库；雷达结果不再显示，证据继续保留，可从本机项目库恢复。`)
  }

  function ignoreRadarResult(id: string) {
    const item = radarOpportunities.find((entry) => entry.id === id)
    if (!item) return
    setOpportunityCatalog((current) => ignoreOpportunity({ ...current, records: { ...current.records, [id]: item } }, id))
    detachRadarResult(id)
    setMessage(`已将“${item.title}”标记为不感兴趣；雷达结果不再显示，相同项目再次搜索也不会自动回到结果。`)
  }

  function deleteRadarResult(id: string) {
    const item = radarOpportunities.find((entry) => entry.id === id)
    if (!item) return
    // 雷达对象先并入一份临时目录再按删除口径计算无引用证据，不写回本机项目库。
    const outcome = deleteOpportunity({ ...opportunityCatalog, records: { ...opportunityCatalog.records, [id]: item } }, id)
    const orphanedEvidence = new Set(outcome.orphanedEvidenceIds)
    const nextEvidence = searchEvidence.filter((record) => !orphanedEvidence.has(record.id))
    setSearchEvidence(nextEvidence)
    saveSearchEvidence(nextEvidence)
    setAnalysisRuns((current) => current.filter((state) => state.opportunityId !== id))
    setProjectWatches((current) => current.filter((watch) => watch.opportunityId !== id))
    setBuckets((current) => Object.fromEntries(Object.entries(current).map(([bucket, objects]) => [bucket, objects.filter((object) => object.id !== id && object.opportunityId !== id)])) as ManagedBuckets)
    deleteBusinessObjectsForOpportunity(id)
    detachRadarResult(id)
    setMessage(`已从本机删除“${item.title}”及其无引用证据；以后重新搜索仍可能再次发现该公开项目。`)
  }
  /**
   * 清除某项目在本模块的分析结果（用户口径 2026-09-17：加载进去的项目与结果都要能取消/清掉）。
   * 只删本模块结果 + 该模块运行状态；项目本身、证据与其它模块结果都不动。
   */
  function clearModuleResult(opportunityId: string, moduleId: ExtensionAnalysisModuleId) {
    if (moduleId === 'policy') setPolicyResults((current) => current.filter((entry) => entry.opportunityId !== opportunityId))
    if (moduleId === 'industry') setIndustryResults((current) => current.filter((entry) => entry.opportunityId !== opportunityId))
    if (moduleId === 'risk') setCreditRiskResults((current) => current.filter((entry) => entry.opportunityId !== opportunityId))
    if (moduleId === 'leads') setLeadResults((current) => current.filter((entry) => entry.opportunityId !== opportunityId))
    setAnalysisRuns((current) => current.filter((state) => !(state.opportunityId === opportunityId && state.moduleId === moduleId)))
    setMessage(`已清除该项目在本模块的分析结果（项目与证据仍在本机；需要时重新点「启动分析」即可）。`)
  }
  const clearTimelineResult = (id: string) => clearModuleResult(id, 'timeline')
  const clearPolicyResult = (id: string) => clearModuleResult(id, 'policy')
  const clearIndustryResult = (id: string) => clearModuleResult(id, 'industry')
  const clearRiskResult = (id: string) => clearModuleResult(id, 'risk')
  const clearLeadResult = (id: string) => clearModuleResult(id, 'leads')
  function dropInto(bucket: DropBucket, event: DragEvent) {
    event.preventDefault()
    commitDrop(bucket)
  }

  function commitDrop(bucket: DropBucket, explicit?: ManagedObject) {
    const object = explicit ?? draggedObject
    if (!object) return
    if (!canDropObject(object, bucket)) {
      setMessage(`“${object.title}”不能放入${bucketMeta[bucket].label}，获客建议只能转成行动。`)
      setActiveDrop(undefined)
      setDraggedObject(undefined)
      return
    }
    if (bucket === 'focus') {
      // 清单 3.6：拖入「追踪」= 为该项目建设/激活 ProjectWatch，并打开关注列表页。
      const target = (object.opportunityId ? opportunityCatalog.records[object.opportunityId] : undefined) ?? selected
      if (!target) {
        setMessage(`“${object.title}”还没有对应的本机项目，无法订阅；请先把它加入结果列表。`)
        setActiveDrop(undefined)
        setDraggedObject(undefined)
        return
      }
      setProjectWatches((current) => {
        const existing = current.find((watch) => watch.opportunityId === target.id)
        if (existing) return current.map((watch) => watch.id === existing.id ? { ...watch, status: 'active' } : watch)
        return [createProjectWatch({ opportunityId: target.id, title: target.title, evidence: target.timelineEvidence }), ...current]
      })
      setMessage(`已把“${target.title}”加入关注：每 7 天复查一次下一阶段与更正/终止信号，可在关注页暂停；复查结果回写该项目时间链。`)
      // 不在拖入后强制跳转：用户要能连续把多个项目拖进「追踪」，
      // 关注列表页改由点击底部「追踪」进入（见 dock 的 onClick）。
      setActiveDrop(undefined)
      setDraggedObject(undefined)
      return
    }
    if (bucket === 'compare') {
      const opportunityId = object.opportunityId ?? (object.kind === 'opportunity' ? object.id : undefined)
      const alreadyIncluded = opportunityId ? buckets.compare.some((item) => (item.opportunityId ?? (item.kind === 'opportunity' ? item.id : undefined)) === opportunityId) : false
      if (!alreadyIncluded && compareProjects.length >= MAX_COMPARE_PROJECTS) {
        setMessage(`对比篮最多放 ${MAX_COMPARE_PROJECTS} 个项目；请先在对比页移出一个，再加入“${object.title}”。`)
        setActiveDrop(undefined)
        setDraggedObject(undefined)
        openView('compare')
        return
      }
    }
    setBuckets((current) => ({ ...current, [bucket]: addObjectToBucket(current[bucket], object) }))
    if (bucket === 'compare') openView('compare')
    if (bucket === 'action') {
      const opportunityId = object.opportunityId ?? (object.kind === 'opportunity' ? object.id : undefined)
      if (opportunityId) setWorkspace((current) => ({ ...current, selectedOpportunityId: opportunityId, activeView: 'actions' }))
      else openView('actions')
    }
    setMessage(`已把“${object.title}”加入${bucketMeta[bucket].label}，关系已保存在本机，原始数据没有复制。`)
    setActiveDrop(undefined)
    setDraggedObject(undefined)
  }

  function beginResize(target: 'rail' | 'conversation', event: ReactPointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = target === 'rail' ? layout.railWidth : layout.conversationWidth
    document.body.classList.add('is-resizing')
    const move = (moveEvent: PointerEvent) => {
      const next = startWidth + moveEvent.clientX - startX
      setLayout((current) => target === 'rail'
        ? { ...current, railWidth: clamp(next, 94, Math.max(94, Math.min(168, window.innerWidth - current.conversationWidth - 520))) }
        : { ...current, conversationWidth: clamp(next, 340, Math.max(340, Math.min(620, window.innerWidth - current.railWidth - 520))) })
    }
    const finish = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  return (
    <div className={`app-shell ${draggedObject ? 'dragging-object' : ''}`} data-theme={colorTheme} style={shellStyle}>
      <aside className="nav-rail">
        <div className="brand-mark">
          <div className="theme-picker"><button className="theme-toggle" onClick={() => setThemeMenuOpen((open) => !open)} aria-expanded={themeMenuOpen} aria-haspopup="menu" title="切换界面风格"><Palette size={14} /><small>{colorTheme === 'current' ? '冷' : colorTheme === 'warm' ? '彩' : '白'}</small></button>{themeMenuOpen && <div className="theme-menu" role="menu" aria-label="界面风格">{([['current', '冷色'], ['warm', '暖色'], ['porcelain', '曜白']] as const).map(([theme, label]) => <button key={theme} role="menuitemradio" aria-checked={colorTheme === theme ? true : false} className={colorTheme === theme ? 'selected' : ''} onClick={() => { setColorTheme(theme); setThemeMenuOpen(false) }}><i data-swatch={theme} />{label}</button>)}</div>}</div>
          <span className="brand-monogram" role="img" aria-label="创码 CM 商标" />
          <div className="brand-product-line"><strong>识机</strong><small className={`runtime-badge ${IS_TRIAL_EDITION || window.shijiDesktop?.mockEnabled ? 'preview' : ''}`} title={IS_TRIAL_EDITION ? '离线历史案例体验版' : window.shijiDesktop?.mockEnabled ? '开发预览' : `v${window.shijiDesktop?.version ?? '网页'}`}>{IS_TRIAL_EDITION ? '体验版' : window.shijiDesktop?.mockEnabled ? '开发预览' : `v${window.shijiDesktop?.version ?? '网页'}`}</small></div>
          <small className="brand-copyright">创码无限版权所有</small>
          <small className="brand-version">版本 0.2.27</small>
        </div>
        <div className="nav-scroll">{navGroups.map((group) => <NavGroup key={group.label} label={group.label} items={group.items} active={workspace.activeView} onOpen={openView} />)}</div>
        <div className="nav-tools">{toolItems.filter((item) => !IS_TRIAL_EDITION || item.id !== 'settings').map((item) => <NavButton key={item.id} item={item} active={workspace.activeView === item.id} onOpen={openView} />)}</div>
      </aside>

      <button className="column-resizer rail-resizer" onPointerDown={(event) => beginResize('rail', event)} onDoubleClick={() => setLayout((current) => ({ ...current, railWidth: 112 }))} title="拖动调整导航栏宽度，双击复位"><GripVertical size={13} /></button>

      {workspace.activeView === 'simulation'
        ? <SimulationPanel draft={simulationDraft} onDraft={setSimulationDraft} />
        : <ConversationPanel profile={profile} businessProfile={businessProfile} mode={mode} message={message} running={running} runningInputMode={runningInputMode} runStage={runStage}
            task={workspace.currentTask} selected={mode === 'radar' ? radarSelected : selected} onProfile={setProfile}
            onBusinessProfile={setBusinessProfile}
            onMode={(nextMode) => { setMode(nextMode); openView(nextMode) }} onRun={runTask} onCancel={cancelTask}
            radarStageFilter={radarStageFilter} onRadarStageFilter={setRadarStageFilter} />}

      <Workspace view={workspace.activeView} colorTheme={colorTheme} profile={profile} mapProfile={mapProfile ?? profile} businessProfile={businessProfile} simulationDraft={simulationDraft} onSimulationDraft={setSimulationDraft} opportunities={opportunities} nearbyOpportunities={nearbyOpportunities} nearbySelected={nearbySelected} nearbyEvidenceIds={opportunityCatalog.nearbyEvidenceIds ?? []} radarOpportunities={radarOpportunities} radarSelected={radarSelected} radarFailure={radarFailure} archivedOpportunities={archivedOpportunities} ignoredOpportunities={ignoredOpportunities} selected={selected} evidenceRecords={searchEvidence} currentEvidenceIds={opportunityCatalog.currentEvidenceIds} globalActivities={globalActivities} onActivityStart={onActivityStart}
        actionProjects={actionProjects} compareProjects={compareProjects}
        onSelect={(id) => setWorkspace((current) => ({ ...current, selectedOpportunityId: id }))}
        onSelectRadar={(id) => setWorkspace((current) => ({ ...current, selectedRadarOpportunityId: id }))} onToggleOpportunityOverview={toggleOpportunityInOverview} overviewResultIds={opportunities.map((item) => item.id)} onClearTimelineResult={clearTimelineResult} onClearPolicyResult={clearPolicyResult} onClearIndustryResult={clearIndustryResult} onClearRiskResult={clearRiskResult}
        onOpenView={openView} onOpenAnalysisForProject={openAnalysisForActionProject} onOpenCompareRisk={openCompareRisk} onRemoveActionProject={removeFromActionScope} onRemoveCompareProject={removeFromCompareScope} onDragObject={setDraggedObject} projectWatches={projectWatches}
        onSubscribeProject={subscribeCurrentProject} onToggleProjectWatch={toggleProjectWatch} onUnsubscribeProject={unsubscribeProject}
          analysisSelection={analysisSelection} scopeCleared={scopeCleared} onToggleAnalysisSelection={toggleAnalysisSelection} onRemoveFromScope={removeFromAnalysisScope} onSelectAllAnalysis={selectAllAnalysis} onClearAnalysisSelection={clearAnalysisSelection}
        onRunTimelineAnalysis={runTimelineAnalysis} onRunTimelineAnalysisScope={runTimelineAnalysisScope} onCheckProjectWatch={checkProjectWatch} checkingWatchId={checkingWatchId}
        analysisRuns={analysisRuns} onAnalysisRun={updateAnalysisRun}
        policyResults={policyResults} onRunPolicyChainScope={runPolicyChainScope} onRunPolicyChain={runPolicyChainFor}
        industryResults={industryResults} onRunIndustryChainScope={runIndustryChainScope} onRunIndustryChain={runIndustryChainFor}
        creditRiskResults={creditRiskResults} onRunCreditRiskScope={runCreditRiskScope} onRunCreditRisk={runCreditRiskFor}
        leadResults={leadResults} onRunLeadsScope={runLeadsScope} onRunLeads={runLeadsFor} onClearLeadResult={clearLeadResult}
        businessCreditRequest={businessCreditRequest} onOpenBusinessCredit={openBusinessCredit} onRemoveEvidenceFromCurrent={removeEvidenceFromCurrent}
        onArchiveOpportunity={archiveProject} onIgnoreOpportunity={ignoreProject} onRestoreOpportunity={restoreProject} onDeleteOpportunity={deleteProject}
        onArchiveRadar={archiveRadarResult} onIgnoreRadar={ignoreRadarResult} onDeleteRadar={deleteRadarResult} />

      <button className="column-resizer conversation-resizer" onPointerDown={(event) => beginResize('conversation', event)} onDoubleClick={() => setLayout((current) => ({ ...current, conversationWidth: 420 }))} title="拖动调整对话栏宽度，双击复位"><GripVertical size={13} /></button>

      {draggedObject && <div className="drag-floating-label"><GripVertical size={15} /><div><span>正在移动{draggedObject.kind === 'opportunity' ? '商机' : '获客建议'}</span><strong>{draggedObject.title}</strong></div><em>拖到底部高亮区域</em></div>}

      <section className="drop-dock" aria-label="业务对象管理区"
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDrop={(event) => {
          // 容器兜底：落点在按钮之间的空隙/标签上也能命中，避免出现"禁止光标"。
          event.preventDefault()
          const target = (event.target as HTMLElement | null)?.closest('[data-bucket]')
          const bucket = target?.getAttribute('data-bucket') as DropBucket | undefined
          if (bucket) dropInto(bucket, event)
        }}>
        <div className="dock-label"><CircleDot size={11} />对象管理</div>
        {(Object.keys(bucketMeta) as DropBucket[]).map((bucket) => {
          const meta = bucketMeta[bucket]
          const Icon = meta.icon
          const isAllowed = !draggedObject || canDropObject(draggedObject, bucket)
          const trackedActiveCount = projectWatches.filter((watch) => watch.status === 'active').length
            const preview = bucket === 'focus' ? projectWatches[0] : bucket === 'action' ? actionProjects.at(-1) : compareProjects.at(-1)
            const badgeCount = bucket === 'focus' ? trackedActiveCount : bucket === 'action' ? actionProjects.length : compareProjects.length
          return <button key={bucket} data-bucket={bucket} className={`drop-target ${activeDrop === bucket ? 'drag-over' : ''} ${isAllowed ? '' : 'drop-blocked'}`}
            onClick={() => openView(bucket === 'action' ? 'actions' : bucket === 'compare' ? 'compare' : 'watch')}
            onPointerEnter={() => { if (draggedObject) setActiveDrop(bucket) }} onPointerLeave={() => setActiveDrop((current) => current === bucket ? undefined : current)}
            onPointerUp={() => commitDrop(bucket)}
            onDragEnter={() => setActiveDrop(bucket)} onDragLeave={() => setActiveDrop((current) => current === bucket ? undefined : current)}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setActiveDrop(bucket) }} onDrop={(event) => dropInto(bucket, event)}>
            <Icon size={17} /><span>{meta.label}</span><small>{preview ? preview.title : meta.hint}</small><b>{badgeCount}</b>
          </button>
        })}
        <div className="dock-boundary"><FileDown size={14} />数据导出本期暂缓</div>
      </section>
    </div>
  )
}

function mergeEvidenceRecords(current: EvidenceRecord[], incoming: EvidenceRecord[]): EvidenceRecord[] {
  const recordsById = new globalThis.Map(current.map((record) => [record.id, record]))
  for (const record of incoming) recordsById.set(record.id, record)
  return [...recordsById.values()]
}

function identifiersForOpportunity(evidenceIds: string[], records: EvidenceRecord[]): EvidenceDocumentIdentifier[] {
  const keys = new Set<string>()
  const identifiers: EvidenceDocumentIdentifier[] = []
  for (const record of records) {
    if (!evidenceIds.includes(record.id)) continue
    for (const identifier of record.provenance.documentIdentifiers) {
      const key = `${identifier.kind}:${identifier.value.replace(/\s+/g, '').toLowerCase()}`
      if (keys.has(key)) continue
      keys.add(key)
      identifiers.push(identifier)
    }
  }
  return identifiers
}

function mergeTimelineEvidence(current: ProjectStageEvidence[], incoming: ProjectStageEvidence[]): ProjectStageEvidence[] {
  const byKey = new globalThis.Map(current.map((item) => [`${item.evidenceId}:${item.stageId}`, item]))
  for (const item of incoming) byKey.set(`${item.evidenceId}:${item.stageId}`, item)
  return [...byKey.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

function stageLabel(stageId?: ProjectStageId): string {
  if (!stageId) return '尚无确认阶段'
  return PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === stageId)?.label ?? stageId
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function NavGroup({ label, items, active, onOpen }: { label: string; items: NavItem[]; active: WorkspaceView; onOpen: (view: WorkspaceView) => void }) {
  return <section className="nav-group"><span>{label}</span>{items.map((item) => <NavButton key={item.id} item={item} active={active === item.id} onOpen={onOpen} />)}</section>
}

function NavButton({ item, active, onOpen }: { item: NavItem; active: boolean; onOpen: (view: WorkspaceView) => void }) {
  const Icon = item.icon
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={() => onOpen(item.id)} title={item.label}><Icon size={17} /><span>{item.label}</span></button>
}
