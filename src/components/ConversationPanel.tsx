import { useEffect, useState, type FormEvent } from 'react'
import { Bot, Building2, ChevronDown, CircleDot, LockKeyhole, MapPin, Play, SearchCheck, Send, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react'
import type { BusinessProfile, OpportunitySearchCriteria, Opportunity, Task, TaskMode } from '../domain'
import type { CandidateLimit, SearchInputMode } from '../../shared/agent-contract'
import { PROJECT_STAGE_DEFINITIONS, type ProjectStageFilter } from '../../shared/project-timeline'
import { IS_TRIAL_EDITION } from '../edition'

// 2026-09-14 起任务模式只保留两条企业路线：深度雷达与附近招标（企业）。
// 「自动识别」并入商机雷达（自由输入框承担相同职责）；GEO 诊断与个人附近路线已移除。
const modes: { id: TaskMode; label: string }[] = [
  { id: 'radar', label: '商机雷达' },
  { id: 'nearby', label: '附近招标' },
]

interface Props {
  profile: OpportunitySearchCriteria
  businessProfile: BusinessProfile
  mode: TaskMode
  message: string
  running: boolean
  runningInputMode?: SearchInputMode
  runStage?: string
  task?: Task
  selected?: Opportunity
  onProfile: (profile: OpportunitySearchCriteria) => void
  onBusinessProfile: (profile: BusinessProfile) => void
  onMode: (mode: TaskMode) => void
  onRun: (prompt: string, inputMode: SearchInputMode) => void
  onCancel: () => void
  radarStageFilter: ProjectStageFilter
  onRadarStageFilter: (value: ProjectStageFilter) => void
}

export default function ConversationPanel({ profile, businessProfile, mode, message, running, runningInputMode, runStage, task, selected, onProfile, onBusinessProfile, onMode, onRun, onCancel, radarStageFilter, onRadarStageFilter }: Props) {
  const [prompt, setPrompt] = useState('帮我找未来60天内，适合机电安装企业跟进的项目机会')
  const [conditionsOpen, setConditionsOpen] = useState(true)
  const freeRunning = running && runningInputMode === 'free'
  const conditionRunning = running && runningInputMode === 'conditions'
  const otherRouteRunning = running && !conditionRunning

  useEffect(() => {
    setPrompt(mode === 'radar'
      ? `按“${businessProfile.name || '未命名主体'}”的服务地域、专业、资质和履约边界深度匹配商机`
      : `查找“${profile.address}”附近适合${profile.specialty}企业跟进的招投标项目`)
  }, [mode, businessProfile.name, profile.address, profile.specialty])

  function submit(event: FormEvent) {
    event.preventDefault()
    // 原始 prompt 先交给 DSH 意图层理解，本地不做关键词解析。
    onRun(prompt, 'free')
  }

  const conditionPrompt = mode === 'radar'
    ? `按“${businessProfile.name || '未命名主体'}”当前保存的能力画像匹配商机`
    : `按当前条件查找“${profile.address || '未填写地点'}”附近的招投标项目`

  const inputRule = IS_TRIAL_EDITION ? '体验版展示历史项目快照，输入条件不会发起实时搜索。'
    : mode === 'radar'
    ? '长期能力画像作为背景，原始输入先由模型理解，再生成本次匹配意图。'
    : '地点与半径作为背景，原始输入先由模型理解，再生成附近招标查询。'
  const inputBudget = IS_TRIAL_EDITION ? '正式版由用户填写自己的 Key 后搜索新项目；下方分析模块可回放本机历史案例，不调用 Key。'
    : mode === 'radar'
    ? '预计 1 次搜索；本机先做硬性匹配，不自动启动扩展分析。'
    : '附近招标预计 1 次搜索；地点解析依赖天地图服务端 Key。'

  return (
    <aside className="conversation-panel">
      <header className="conversation-head">
        <div>
          <span className="micro-label">SHIJI LOCAL AGENT</span>
          <h1>今天想找到什么？</h1>
        </div>
        <span className="local-pill"><CircleDot size={11} /> {IS_TRIAL_EDITION ? '离线体验' : '本机运行'}</span>
      </header>

      <div className="mode-switch" aria-label="任务模式">
        {modes.map((item) => (
          <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => onMode(item.id)}>{item.label}</button>
        ))}
      </div>

      <div className="conversation-stream">
        {IS_TRIAL_EDITION && <div className="trial-edition-note"><strong>离线案例体验</strong><span>已装入 2 份注明采集日期的历史项目。到总览选择案例，再逐个进入时间链、政策链、产业链、公开风险和获客，点击「回放历史分析」查看有来源的成果；没有证据的字段会如实留空。</span></div>}
        <div className="chat-turn user-turn">
          <span className="avatar"><UserRound size={14} /></span>
          <p>{prompt}</p>
        </div>
        <div className="chat-turn assistant-turn">
          <span className="avatar"><Bot size={15} /></span>
          <div><span className="thinking-label"><Sparkles size={12} /> 识机已结构化</span><p>{message}</p></div>
        </div>

        <section className="input-contract-card">
          <header><span><Sparkles size={12} />本次输入如何生效</span><b>{IS_TRIAL_EDITION ? '实时入口暂不可用' : '两个入口互不混用'}</b></header>
          <p>{inputRule}</p>
          <small>{inputBudget} 结果只进入当前模块对应卡片；时间链、政策链、产业链和获客不会被自由输入自动启动。</small>
        </section>

        <section className={`condition-box ${conditionsOpen ? 'open' : ''}`}>
          <button className="condition-title" onClick={() => setConditionsOpen((value) => !value)}>
            <span><SlidersHorizontal size={14} /> {mode === 'radar' ? '长期商业能力画像' : '已锁定的判断条件'}</span>
            <span className="locked-count"><LockKeyhole size={11} /> {mode === 'radar' ? '12 项画像 + 本次阶段' : '11 项条件'}</span>
            <ChevronDown size={15} />
          </button>
          {conditionsOpen && (
            mode === 'radar' ? <BusinessProfileConditions profile={businessProfile} onProfile={onBusinessProfile} stageFilter={radarStageFilter} onStageFilter={onRadarStageFilter} /> : <div className="condition-grid">
              <label className="wide"><span>目标单位（可选，锁定后只保留匹配结果）</span><div className="input-shell"><Building2 size={13} /><input maxLength={120} value={profile.targetCompanyName ?? ''} placeholder="例如：上海某某建设有限公司" onChange={(event) => onProfile({ ...profile, targetCompanyName: event.target.value })} /></div></label>
              <label className="wide"><span>目标项目（可选，锁定后只保留匹配结果）</span><input maxLength={180} value={profile.targetProjectName ?? ''} placeholder="例如：总部湾区域公园变电所工程" onChange={(event) => onProfile({ ...profile, targetProjectName: event.target.value })} /></label>
              <label className="wide"><span>经营地址</span><div className="input-shell"><MapPin size={13} /><input value={profile.address} onChange={(event) => onProfile({ ...profile, address: event.target.value })} /></div></label>
              <label><span>服务半径</span><select value={profile.radiusKm} onChange={(event) => onProfile({ ...profile, radiusKm: Number(event.target.value) })}><option value={10}>10 公里</option><option value={30}>30 公里</option><option value={50}>50 公里</option><option value={100}>100 公里</option></select></label>
              <label><span>时间范围</span><select value={profile.timeWindow} onChange={(event) => onProfile({ ...profile, timeWindow: event.target.value })}><option>未来30天</option><option>未来60天</option><option>未来90天</option></select></label>
              <label className="wide"><span>专业能力</span><input value={profile.specialty} onChange={(event) => onProfile({ ...profile, specialty: event.target.value })} /></label>
              <label><span>最低金额 / 万</span><input type="number" value={profile.amountMin} onChange={(event) => onProfile({ ...profile, amountMin: Number(event.target.value) })} /></label>
              <label><span>最高金额 / 万</span><input type="number" value={profile.amountMax} onChange={(event) => onProfile({ ...profile, amountMax: Number(event.target.value) })} /></label>
              <label className="wide"><span>项目类型</span><select value={profile.projectType} onChange={(event) => onProfile({ ...profile, projectType: event.target.value })}><option>不限</option><option>产业园区</option><option>医疗建筑</option><option>工程改造</option></select></label>
              <label className="wide"><span>目标项目阶段</span><select value={profile.targetStageId} onChange={(event) => onProfile({ ...profile, targetStageId: event.target.value as ProjectStageFilter })}><option value="all">不限阶段</option>{PROJECT_STAGE_DEFINITIONS.map((stage) => <option value={stage.id} key={stage.id}>{stage.label}</option>)}</select></label>
              <label className="wide"><span>期望结果数</span><select value={profile.candidateLimit} onChange={(event) => onProfile({ ...profile, candidateLimit: Number(event.target.value) as CandidateLimit })}><option value={5}>5 条 · 快速</option><option value={10}>10 条 · 标准</option><option value={20}>20 条 · 扩展</option></select></label>
              <label className="wide"><span>本次搜索能力</span><div className="fixed-provider"><SearchCheck size={13} />豆包搜索 Custom · 用户 Key 本机直连</div></label>
              <div className="guardrail-note"><LockKeyhole size={12} />本次输入明确的要求优先，未提及的沿用条件；存在歧义时会说明。保存的条件不会被本次理解覆盖。</div>
            </div>
          )}
          <div className="condition-run-row">
            <button className={`condition-run ${conditionRunning ? 'is-running' : ''} ${otherRouteRunning ? 'blocked-by-other-route' : ''}`} disabled={IS_TRIAL_EDITION || running && !conditionRunning} aria-busy={conditionRunning} onClick={conditionRunning ? onCancel : () => onRun(conditionPrompt, 'conditions')} title={IS_TRIAL_EDITION ? '正式版开放实时条件搜索' : conditionRunning ? '停止当前条件搜索' : '只按上方已保存条件运行，不读取下方自由输入'}>
              <Play size={14} />{IS_TRIAL_EDITION ? '正式版开放搜索' : conditionRunning ? '停止条件搜索' : '按以上条件运行'}
            </button>
            <small>{IS_TRIAL_EDITION ? '当前仅浏览离线历史案例，不联网、不消耗额度。' : conditionRunning ? '条件搜索正在运行；可在此停止。自由输入入口暂不可启动。' : otherRouteRunning ? '自由搜索正在运行；条件入口暂不可启动，当前任务不会被此入口接管。' : '只锁定并采用上方条件；不读取下方自由输入，也不让模型改写地区、阶段等确定项。'}</small>
          </div>
        </section>

        {selected && (
          <div className="active-context">
            <span>当前处理对象</span>
            <strong>{selected.title}</strong>
            <div><b>{IS_TRIAL_EDITION ? '历史案例 · 未评分' : `${selected.matchScore}% 匹配`}</b><i>{selected.evidenceIds.length} 条证据</i><i>{selected.confidence}可信度</i></div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea value={prompt} maxLength={300} onChange={(event) => setPrompt(event.target.value)} rows={3} readOnly={IS_TRIAL_EDITION} placeholder="描述你想找的机会，也可以要求核验、对比或制定行动…" />
        {running && <div className="run-progress" aria-live="polite"><i /><span>{runStage ?? '执行任务'}</span><small>正在处理，不会伪造倒计时</small></div>}
        <div className="composer-foot">
          <span>{IS_TRIAL_EDITION ? '离线历史案例 · 正式版才可搜索新项目' : mode === 'radar' ? '单次搜索 + 本机硬性门槛 · 不自动启动扩展分析' : task?.status === 'done' ? `${task.opportunityIds.length} 个结果已保存本机` : '输入内容与结果仅保存在本机'}</span>
          <button className={running && !freeRunning ? 'blocked-by-other-route' : ''} type={freeRunning ? 'button' : 'submit'} disabled={IS_TRIAL_EDITION || running && !freeRunning} onClick={freeRunning ? onCancel : undefined} aria-label={IS_TRIAL_EDITION ? '正式版开放搜索' : freeRunning ? '停止自由搜索' : '发送并运行'}><Send size={16} />{IS_TRIAL_EDITION ? '正式版' : freeRunning ? '停止' : '运行'}</button>
        </div>
      </form>
    </aside>
  )
}

function BusinessProfileConditions({ profile, onProfile, stageFilter, onStageFilter }: { profile: BusinessProfile; onProfile: (profile: BusinessProfile) => void; stageFilter: ProjectStageFilter; onStageFilter: (value: ProjectStageFilter) => void }) {
  const list = (value: string) => value.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean)
  return <div className="condition-grid business-profile-grid">
    <label><span>主体类型</span><select value={profile.subjectType} onChange={(event) => onProfile({ ...profile, subjectType: event.target.value as BusinessProfile['subjectType'] })}><option value="enterprise">企业</option><option value="team">团队</option><option value="individual">个人</option></select></label>
    <label><span>主体名称</span><input value={profile.name} onChange={(event) => onProfile({ ...profile, name: event.target.value })} /></label>
    <label className="wide"><span>业务地域（多个用顿号分隔）</span><input value={profile.businessRegions.join('、')} onChange={(event) => onProfile({ ...profile, businessRegions: list(event.target.value) })} /></label>
    <label><span>公司性质</span><input value={profile.companyNature} onChange={(event) => onProfile({ ...profile, companyNature: event.target.value })} /></label>
    <label><span>规模</span><input value={profile.scale} onChange={(event) => onProfile({ ...profile, scale: event.target.value })} /></label>
    <label className="wide"><span>行业</span><input value={profile.industries.join('、')} onChange={(event) => onProfile({ ...profile, industries: list(event.target.value) })} /></label>
    <label className="wide"><span>专业能力</span><input value={profile.specialties.join('、')} onChange={(event) => onProfile({ ...profile, specialties: list(event.target.value) })} /></label>
    <label className="wide"><span>资质 / 证书</span><textarea rows={2} value={profile.qualifications.join('\n')} onChange={(event) => onProfile({ ...profile, qualifications: list(event.target.value) })} /></label>
    <label className="wide"><span>资产与设备</span><textarea rows={2} value={profile.assetsAndEquipment} onChange={(event) => onProfile({ ...profile, assetsAndEquipment: event.target.value })} /></label>
    <label className="wide"><span>人员与经验</span><textarea rows={2} value={profile.personnelAndExperience} onChange={(event) => onProfile({ ...profile, personnelAndExperience: event.target.value })} /></label>
    <label className="wide"><span>履约边界</span><textarea rows={2} value={profile.deliveryBoundary} onChange={(event) => onProfile({ ...profile, deliveryBoundary: event.target.value })} /></label>
      <label className="wide"><span>风险偏好</span><select value={profile.riskPreference} onChange={(event) => onProfile({ ...profile, riskPreference: event.target.value as BusinessProfile['riskPreference'] })}><option value="conservative">保守</option><option value="balanced">平衡</option><option value="growth">成长</option></select></label>
      {/* 本次阶段独立于长期画像；deepRadarSearchCriteria 与相关测试负责锁定该数据边界，
          不再把内部门禁实现写成面向用户的说明。 */}
      <label className="wide"><span>本次项目阶段（雷达筛选：立项 / 招标 / 中标 / 签约…）</span><select value={stageFilter} onChange={(event) => onStageFilter(event.target.value as ProjectStageFilter)}><option value="all">不限阶段</option>{PROJECT_STAGE_DEFINITIONS.map((stage) => <option value={stage.id} key={stage.id}>{stage.label}</option>)}</select></label>
  </div>
}
