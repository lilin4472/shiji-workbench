#!/usr/bin/env node
// 识机 · 离线自检（零依赖）
// 用途：在没有 shell / 没有 computer-use 的协作方式下，用"源码级接线核查"替代人工点击，
//      把"改完到底有没有接上"这件事变成一条命令的输出。
// 运行：node scripts/selfcheck.mjs
//
// 重要边界：本脚本做的是**静态接线核查**（字符串/结构断言），不启动应用、不点界面。
//          它能证明"线接上了"，不能证明"运行时行为正确"；运行时仍须实机复验。

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => {
  const path = join(root, relative)
  if (!existsSync(path)) throw new Error(`缺少文件：${relative}`)
  return readFileSync(path, 'utf8')
}

const app = read('src/App.tsx')
const conversation = read('src/components/ConversationPanel.tsx')
const workspace = read('src/components/Workspace.tsx')
const styles = read('src/styles.css')
const lifecycle = read('src/project-lifecycle.css')
const deepRadar = read('shared/deep-radar-task.ts')
const watchShared = read('shared/project-watch.ts')
const backend = read('electron/dsh-agent-backend.ts')
const policyShared = read('shared/policy-chain.ts')
const policyService = read('electron/policy-chain-service.ts')
const mainProcess = read('electron/main.ts')
const preload = read('electron/preload.cts')
const desktopContract = read('shared/desktop-contract.ts')
const repository = read('src/repository.ts')
const actionPlan = read('src/action-plan.ts')

let failed = 0
const check = (title, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}${ok || !detail ? '' : `\n        ↳ ${detail}`}`)
  if (!ok) failed += 1
}

const has = (source, needle) => source.includes(needle)

// ── 1. 追踪模块：取消跟踪（整行移除）接线链 ─────────────────────────────
check('跟踪行存在「取消跟踪」按钮', has(workspace, 'className="remove-watch"') && has(workspace, '取消跟踪'))
check('Watch 组件接收 onUnsubscribe', has(workspace, 'function Watch({') && has(workspace, 'onUnsubscribe: (id: string) => void'))
check('Workspace 把 onUnsubscribeProject 传给 Watch', has(workspace, 'onUnsubscribe={onUnsubscribeProject}'))
check('Workspace Props 声明 onUnsubscribeProject', has(workspace, 'onUnsubscribeProject: (id: string) => void'))
check('Workspace 解构 onUnsubscribeProject', has(workspace, 'onSubscribeProject, onToggleProjectWatch, onUnsubscribeProject,'))
check('App 定义 unsubscribeProject（filter 删除订阅）', has(app, 'function unsubscribeProject(id: string)') && has(app, 'watch.id !== id'))
check('App 把 unsubscribeProject 传给 Workspace', has(app, 'onUnsubscribeProject={unsubscribeProject}'))
check('.remove-watch 样式存在（冷/暖一致）', has(styles, '.watch-list article .remove-watch {') && has(styles, '[data-theme="warm"] .watch-list article .remove-watch'))

// ── 2. 模块页结构 v3（2026-09-16 用户口径）：对象 → 启动分析 → 本模块结果卡片 ──
check('模块页对象只带引用，不铺项目字段（无 .scope-fields 复杂载荷）', !has(workspace, 'scope-fields') && !has(lifecycle, '.scope-fields'))
check('启动分析后对象默认收起（结果视图 objectsOpen=false）', has(workspace, 'const [objectsOpen, setObjectsOpen] = useState(false)') && has(workspace, 'className="result-object-bar"'))
check('时间链结果＝每个项目一张卡（timeline-result-card）', has(workspace, 'className={`timeline-result-card') && has(lifecycle, '.timeline-result-card {'))
check('时间链对缺失 timelineEvidence 有兜底（逐项目）', has(workspace, 'buildProjectTimeline(item.timelineEvidence ?? [])'))
check('结果卡按项目订阅（onSubscribeProject 可带 opportunityId）', has(workspace, 'onSubscribe: (opportunityId?: string) => void') && has(app, 'function subscribeCurrentProject(opportunityId?: string)'))

// ── 2b. 政策链（2026-09-16）：三级穿透 + 带依据预测 ────────────────────
check('政策链接线：主进程 IPC + preload + 当前契约版本', has(mainProcess, "ipcMain.handle('shiji:policy-chain-run'") && has(preload, "ipcRenderer.invoke('shiji:policy-chain-run', request)") && has(desktopContract, 'DESKTOP_CONTRACT_VERSION = 21'))
check('政策链三级固定为国家/省/市（直辖市单独处理）', has(policyShared, "POLICY_LEVEL_IDS = ['national', 'provincial', 'municipal']") && has(policyShared, 'MUNICIPALITIES'))
check('政策链按三级各一条查询（含规划与预算术语）', has(policyShared, 'buildPolicySearchTargets') && has(policyShared, '五年规划') && has(policyService, "purpose: 'policy-chain'"))
check('穿透性只用正文点名下级的原句', has(policyShared, 'penetrationQuotes') && has(policyService, 'penetration'))
check('预测必须带依据，且没有依据就不输出', has(policyShared, 'buildPolicyPredictions') && has(policyShared, "basisKind: 'budget-document'") && has(policyShared, "basisKind: 'historical-cadence'") && has(policyService, '未取得可支撑预测的依据'))
check('预测与正式采购节点分开标记（confirmed / forecast）', has(policyShared, "certainty: 'confirmed'") && has(policyShared, "certainty: 'forecast'"))
check('政策链网页直读失败也回退搜索服务正文', has(policyService, 'readPolicyBody') && has(policyService, '回退'))
check('政策链结果卡＝每个项目一张（policy-result-card）', has(workspace, 'className={`policy-result-card') && has(lifecycle, '.policy-result-card {'))
check('政策链界面有三级梯与预测区', has(workspace, 'PolicyLadder') && has(workspace, 'PolicyPredictionCard') && has(lifecycle, '.policy-level {'))
check('政策链启动后对象卡片同样收起', has(workspace, 'const policyStarted ='))
check('政策链结果按项目保存在本机', has(app, 'savePolicyChainResults') && has(app, 'loadPolicyChainResults'))

// ── 2c. 产业链（2026-09-16）：甲方为核心 + 四维度 + 不做图 ──────────────
const industryShared = read('shared/industry-chain.ts')
const industryService = read('electron/industry-chain-service.ts')
check('产业链接线：主进程 IPC + preload + 当前契约版本', has(mainProcess, "ipcMain.handle('shiji:industry-chain-run'") && has(preload, "ipcRenderer.invoke('shiji:industry-chain-run', request)") && has(desktopContract, 'DESKTOP_CONTRACT_VERSION = 21'))
check('产业链：甲方为核心，区分历史中标、业务供应与集团组织关系', has(industryShared, 'RELATION_LABELS') && has(industryShared, "'historical-winner'") && has(industryService, "'supplier', 'contractor', 'subcontractor'") && has(industryService, "'parent-company', 'subsidiary', 'branch-company'"))
check('产业链：3 组定向检索（历史中标 / 履约 / 供应商代理）', has(industryShared, 'buildIndustrySearchTargets') && has(industryService, 'maxResults: 10'))
check('产业链公司卡片清晰展示名称/联系电话/法定代表人/行业领域/证据来源', has(workspace, 'function IndustryCompanyRow') && has(workspace, '<dt>联系电话</dt>') && has(workspace, '<dt>法定代表人</dt>') && has(workspace, '<dt>行业领域</dt>') && has(workspace, '<dt>证据来源</dt>'))
check('产业链：两阶段检索（定向 + 工商信息核对）', has(industryShared, 'buildCompanyEnrichmentQuery') && has(industryShared, 'INDUSTRY_ENRICHMENT_LIMIT') && has(industryShared, 'resolveIndustrySourceTier'))
check('产业链：中标关系只来自结果类公告（纯招标公告不算中标）', has(industryShared, 'documentSupportsWinner') && has(industryService, 'documentSupportsWinner(title, text)'))
check('产业链：抽不到就留空（就近取电话、噪声值不当行业）', has(industryShared, 'export function extractPhoneNear') && has(industryShared, 'NOT_INDUSTRY_HINT'))
check('产业链：中标企业优先，不同时出现在两块', has(industryService, 'winnerKeys'))
check('产业链：网页直读失败回退搜索服务正文（摘要为主文本）', has(industryService, 'readIndustryBody') && has(industryService, 'providerBody'))
check('产业链结果卡按项目渲染（industry-result-card）', has(workspace, 'industry-result-card') && has(lifecycle, '.industry-result-card {'))
check('产业链生产视图不做图（走 IndustryChainView，不渲染图形组件）', has(workspace, 'IndustryChainView') && has(workspace, "industryStarted"))
check('产业链结果按项目保存在本机', has(app, 'saveIndustryChainResults') && has(repository, 'INDUSTRY_CHAIN_KEY'))
// ── 2d. 公开风险（2026-09-16）：招标单位 + 放宽门禁 + 主体/风险事实卡 ─────
const creditShared = read('shared/credit-risk.ts')
const creditService = read('electron/credit-risk-service.ts')
check('公开风险接线：主进程 IPC + preload + 当前契约版本', has(mainProcess, "ipcMain.handle('shiji:credit-risk-run'") && has(preload, "ipcRenderer.invoke('shiji:credit-risk-run', request)") && has(desktopContract, 'DESKTOP_CONTRACT_VERSION = 21'))
check('公开风险：对象是发布招标的招标单位（按项目勾选范围执行）', has(app, 'runCreditRiskFor') && has(app, 'companyName: item.companyName') && has(workspace, '招标单位：'))
check('公开风险：政府机关 / 事业单位同样受理（门禁放宽）', has(creditShared, 'detectSubjectType') && has(creditShared, "'public-institution'") && has(creditShared, '事业单位法人证书'))
check('公开风险：含行政诉讼 / 裁判文书维度', has(creditShared, "'administrative-litigation'") && has(creditShared, '行政诉讼'))
check('公开风险：4 组全网检索 + 正文读取回退', has(creditShared, 'buildCreditRiskQueries') && has(creditService, 'readCreditBody') && has(creditService, 'providerBody'))
check('公开风险：事实必须有事由且简洁（≤60 字）', has(creditShared, 'extractFactReason') && has(creditShared, 'slice(0, 60)'))
check('公开风险：否定句与非不利角色守卫保留', has(creditShared, 'isNegated') && has(creditShared, 'hasNonAdverseRole'))
check('公开风险：主体信息卡与逐条风险事实卡', has(workspace, 'risk-subject-card') && has(workspace, 'risk-fact-card'))
check('公开风险结果按项目保存在本机', has(repository, 'CREDIT_RISK_KEY') && has(app, 'saveCreditRiskResults'))

// ── 3. 拖放：拖拽源与落点必须同 effect ─────────────────────────────────
check("拖拽源 effectAllowed = 'copy'", has(workspace, "event.dataTransfer.effectAllowed = 'copy'"))
check("落点 dropEffect = 'copy'（按钮级）", has(app, "event.dataTransfer.dropEffect = 'copy'; setActiveDrop(bucket)"))
check("落点 dropEffect = 'copy'（容器兜底）", has(app, "onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}"))
check('管理栏落点带 data-bucket（空隙也能命中）', has(app, 'data-bucket={bucket}') && has(app, "closest('[data-bucket]')"))
check('附近招标列表不再是拖拽源', !has(workspace, 'tender-nearby-list panel-surface"><header><div><span>地点范围招标结果</span><small>所有搜索结果保留在列表，点击查看证据</small></div><b>{displayOpportunities.length}</b></header>{displayOpportunities.length === 0 ? <DiscoveryEvidencePanel records={evidenceRecords} compact /> : displayOpportunities.map((item) => { const company = companyForOpportunity(item); return <article key={item.id} className={item.id === selected?.id ? \'active\' : \'\'} draggable'))

// ── 4. 雷达：阶段筛选 + criteria 基线 + 失败诊断 ──────────────────────
check('雷达 criteria 接收阶段参数', has(deepRadar, 'targetStageId: ProjectStageFilter = DEEP_RADAR_DEFAULT_STAGE'))
check('雷达意图不得改写阶段（程序侧剥离）', has(backend, 'delete rest.targetStageId') && has(backend, 'radarIntentOverrides(intent.criteria, task.criteria.targetStageId)'))
check('意图失败落盘明文诊断', has(backend, 'agent-intent.log') && has(backend, 'describeCriteriaGaps'))
check('澄清不再阻断雷达（按画像继续）', has(backend, 'isRadarProfileSearchable') && has(backend, 'radarCanProceed'))
check('雷达/附近的条件入口与自由入口明确分路', has(conversation, "onRun(conditionPrompt, 'conditions')") && has(conversation, "onRun(prompt, 'free')") && has(app, 'inputMode: SearchInputMode'))
check('条件入口把 inputMode 传到雷达与附近任务，不调用意图改写', has(app, 'createDeepRadarTask(taskId, prompt, businessProfile, searchProvider, radarStageFilter, inputMode)') && has(app, 'inputMode,') && has(backend, "if (task.inputMode === 'free')"))
check('新搜索先清除上一轮地区结果与选中项', has(app, 'setRadarOpportunities([])') && has(app, 'replaceNearbyResults(current, [], [], preservedProjectIds)') && has(app, 'selectedRadarOpportunityId: undefined') && has(app, 'selectedOpportunityId: undefined'))
check('雷达明确硬冲突在结果入卡前剔除', has(app, 'eligibleDeepRadarOpportunities(businessProfile, result.opportunities)') && has(app, '已剔除 ${removedMismatchCount} 个存在明确地域或专业冲突的项目'))

// ── 5. 关注周期：7 天 ─────────────────────────────────────────────────
check('订阅周期常量 = 7 天', has(watchShared, 'PROJECT_WATCH_WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000'))
check('启动复查使用 7 天周期', has(app, 'PROJECT_WATCH_WEEKLY_INTERVAL_MS)'))

//  6. 模块页「移出」接线链（2026-09-18：点了"没反应"的根因就在这条链上） 
check('Workspace Props 声明 onRemoveFromScope', has(workspace, 'onRemoveFromScope: (id: string) => void'))
check('Workspace 解构 onRemoveFromScope', has(workspace, 'onToggleAnalysisSelection, onRemoveFromScope,'))
check('模块页「移出」不得再接总览复选框的 toggleAnalysisSelection', !has(workspace, 'onRemoveFromScope={onToggleAnalysisSelection}'))
check('5 个模块视图的「移出」统一接 onRemoveFromScope（10 处）', (workspace.match(/onRemoveFromScope=\{onRemoveFromScope\}/g) ?? []).length === 10)
check('「移出」是删除语义（removeFromAnalysisScope），不是勾选语义', has(app, 'function removeFromAnalysisScope') && has(app, 'onRemoveFromScope={removeFromAnalysisScope}'))
check('移空后记住「明确移空」，模块页不再退回当前选中项目', has(app, 'if (next.length === 0) setScopeCleared(true)') && has(workspace, 'scopeCleared ? [] :'))
check('五个分析模块按总览完整勾选范围执行和展示', !app.includes('new Set(opportunityIds)].slice(0, 3)') && !workspace.includes('scope.slice(0, 3)') && !workspace.includes('(scopeItems ?? []).slice(0, 3)'))
check('总览「清空」同样置 scopeCleared', has(app, '// 「清空」是用户明确清空分析范围') && has(app, 'setScopeCleared(true)'))
check('多项目未启动时标题显示数量，不误导为第一个项目', has(workspace, 'count > 1 ? `${count} 个项目待分析`'))
check('分析与附近模块不再显示单项目顶部上下文卡', has(workspace, "(view === 'library' || view === 'radar') && <div className=\"workspace-context\">"))

//  7. 获客链路（2026-09-18 用户逐条确认：只消费产业链节点 + 硬门禁 + 多维表） 
const leadShared = read('shared/lead-contacts.ts')
const leadService = read('electron/lead-service.ts')
check('获客接线：主进程 IPC + preload + 渲染层契约 + 当前契约版本', has(mainProcess, "ipcMain.handle('shiji:lead-run'") && has(preload, "ipcRenderer.invoke('shiji:lead-run', request)") && has(desktopContract, 'DESKTOP_CONTRACT_VERSION = 21'))
check('获客只消费产业链节点（不含甲方）且上限 7 家', has(leadShared, 'LEAD_COMPANY_LIMIT = 7') && has(leadShared, '...result.winners, ...result.suppliers'))
const agentLoop = read('shared/agent-loop.ts')
check('获客 = 串行渠道铺底 + 模型循环（模型判断收口，6 轮保险丝）', has(leadService, 'buildLeadBootstrapQueries') && has(leadService, 'AGENT_LOOP_MAX_STEPS') && has(agentLoop, 'parseLeadLoopAction') && has(agentLoop, 'buildLeadLoopPrompt'))
check('获客值必须逐字回到证据正文（模型提交也要过校验）', has(agentLoop, 'validateLeadReport') && has(agentLoop, 'entry.text.includes(quote) && quote.includes(value)') && has(leadService, '模型提交的值**逐字校验**'))
check('获客抽值按段落定位（不按固定字数截窗，避免跨公司串号）', has(leadService, 'line.includes(name)') && !has(leadService, 'at - LEAD_EXTRACT_WINDOW'))
check('获客硬门禁：没有产业链节点就不给跑', has(leadService, '请先在产业链跑一次') && has(workspace, "gateNote={leadReady ? undefined : '先去跑产业链'}"))
check('获客七列表头与固定数据单元一一对应', has(workspace, 'const LEAD_COLUMNS = ["name", "industry", "owner", "contact", "email", "phone", "address"]') && has(workspace, 'LEAD_COLUMNS.map((column)') && has(workspace, 'className="lead-name"') && has(workspace, 'className="lead-industry"') && has(workspace, 'className="lead-owner"') && has(workspace, "values(row.contact") && has(workspace, "values(row.email") && has(workspace, "values(row.phone") && has(workspace, "values(row.address"))
check('获客抽值通过地址形态、主体归属与跨公司排他门禁', has(leadShared, 'isLeadAddressForCompany') && has(leadShared, 'hasCompanyAssociation') && has(leadShared, 'POINT_CONTEXT_NOISE') && has(leadService, 'OTHER_COMPANY') && has(leadService, 'break'))
check('获客结果按项目保存在本机（shiji.lead-contacts.v1）', has(repository, 'LEAD_RESULTS_KEY') && has(app, 'saveLeadResults') && has(app, 'loadLeadResults'))
check('获客结果同样支持「移出 / 清除结果」', has(app, "clearModuleResult(id, 'leads')") && has(app, "if (moduleId === 'leads') setLeadResults"))

// ── 8. 搜索真实性与行动消费边界（2026-09-21） ─────────────────────────
check('平台首页/聚合列表只保留为证据，不生成项目卡', has(backend, 'if (checks?.eligibleForModel === false) return []'))
check('旧结构性来源项目在本地目录加载时自动迁出', has(repository, 'removeStructuralSourceOpportunities(removeLegacyMockCatalogRecords(migrateLegacyNearbyCatalog(value)), loadSearchEvidence())'))
check('行动清单按真实完成模块开关生成，不把项目基础字段冒充分析结果', has(actionPlan, 'availableModules.timeline') && has(actionPlan, 'availableModules.policy') && has(actionPlan, 'availableModules.industry && availableModules.leads') && has(actionPlan, 'availableModules.risk'))
check('行动模块缺口统一由顶部状态区发起，获客缺产业链时先补产业链', has(workspace, '`去补充${module.label}`') && has(workspace, 'onOpenAnalysisForProject(module.blocked') && has(workspace, "blocked: !availableModules.industry"))
check('行动补充按钮先把当前项目设为唯一分析对象，再进入模块且不自动调用', has(app, 'function openAnalysisForActionProject') && has(app, 'setAnalysisSelection([opportunityId])') && has(app, '当前没有产生调用') && has(workspace, 'onOpenAnalysisForProject(module.blocked'))
check('行动页永远只读取行动清单，不在移空后回退分析范围', has(app, 'actionProjects={actionProjects}') && has(workspace, 'const actionScopeProjects = actionProjects'))
check('每个行动项目都可单独移出，且不删除项目与分析结果', has(workspace, 'className="action-project-remove"') && has(workspace, 'onRemoveProject(item.id)') && has(actionPlan, 'export function removeActionProject'))
check('三条工作流空态不再放重复补充按钮', !has(workspace, "category.id === '商务对接' && <button"))

console.log('')
if (failed === 0) {
  console.log('全部通过：源码接线完整。若界面仍无变化，问题在"未加载新代码"（需停掉 npm run dev 后重启）。')
} else {
  console.log(`有 ${failed} 项未通过：请把以上 FAIL 行贴回给我，我按行修。`)
}
process.exit(failed === 0 ? 0 : 1)
