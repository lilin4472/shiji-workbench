// 商机推演（创业沙盘前端入口）——草稿域模型。
//
// 纪律（对应 docs/PRODUCT_LOGIC_DATAFLOW_V1.md §11 与 2026-09-14 导航收敛决定）：
// 1. 本文件只保存用户主动填写的输入（选址、创业者参数、财务参数）。
// 2. 仿真引擎未接入前，任何界面不得展示推演结果、分数或数字；这里不存在 Mock 结果。
// 3. 字段设计保持与引擎入参对齐的可能（四通道 R/T/C/P + 财务可行性），
//    但在引擎契约冻结前不做更多预建，避免约束后端算法选型。

export interface SimulationLocation {
  /** 观察地点（文字地址；天地图选点在服务端 Key 审核通过后接入） */
  address: string
  /** 观察半径（公里） */
  radiusKm: number
}

export interface SimulationVenture {
  /** 业态/项目简述，例如“社区轻餐饮外卖档口” */
  brief: string
}

/** 创业者参数：四通道自评（0–10）。将来由引擎映射为 R/T/C/P 系数。 */
export interface SimulationFounderInput {
  /** 触达：营销、渠道、线上运营能力 */
  reach: number
  /** 信任：行业经验、口碑、服务意识 */
  trust: number
  /** 便利：可投入时间、经营弹性 */
  convenience: number
  /** 促销弹性：可动用预算与让利空间 */
  promotion: number
  /** 每天可投入小时数（0–16） */
  hoursPerDay: number
  /** 性格与资源自述（自由文本，将来由模型折算为通道修正量） */
  notes: string
}

/** 财务参数：真实引擎的财务可行性层入参。均可留空 = 待填写。 */
export interface SimulationFinanceInput {
  /** 可投入总预算（万元） */
  budgetWan?: number
  /** 每月固定成本（万元，房租/人工/水电） */
  monthlyFixedCostWan?: number
  /** 预估客单价（元） */
  averageTicketYuan?: number
}

export interface SimulationDraft {
  location: SimulationLocation
  venture: SimulationVenture
  founder: SimulationFounderInput
  finance: SimulationFinanceInput
}

export const DEFAULT_SIMULATION_DRAFT: SimulationDraft = {
  location: { address: '', radiusKm: 3 },
  venture: { brief: '' },
  founder: { reach: 5, trust: 5, convenience: 5, promotion: 5, hoursPerDay: 8, notes: '' },
  finance: {},
}

const DRAFT_KEY = 'shiji.simulation-draft.v1'

export function loadSimulationDraft(): SimulationDraft | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return undefined
    const stored = JSON.parse(raw) as Partial<SimulationDraft>
    return {
      location: { ...DEFAULT_SIMULATION_DRAFT.location, ...stored.location },
      venture: { ...DEFAULT_SIMULATION_DRAFT.venture, ...stored.venture },
      founder: { ...DEFAULT_SIMULATION_DRAFT.founder, ...stored.founder },
      finance: { ...DEFAULT_SIMULATION_DRAFT.finance, ...stored.finance },
    }
  } catch {
    return undefined
  }
}

export function saveSimulationDraft(draft: SimulationDraft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

export type SimulationStepId = 'location' | 'founder' | 'engine' | 'report'

/** 前两步收集真实输入；后两步依赖仿真引擎，当前固定为“未接入”。 */
export const SIMULATION_STEPS: { id: SimulationStepId; title: string; enginePending: boolean }[] = [
  { id: 'location', title: '选址与商圈', enginePending: false },
  { id: 'founder', title: '创业者与方案', enginePending: false },
  { id: 'engine', title: '仿真推演', enginePending: true },
  { id: 'report', title: '推演报告', enginePending: true },
]

/** 第 1 步完成门槛：地点与业态都明确。半径始终有默认值。 */
export function isLocationStepComplete(draft: SimulationDraft): boolean {
  return draft.location.address.trim().length > 0 && draft.venture.brief.trim().length > 0
}

/** 第 2 步完成门槛：四通道自评完成（保持默认值也算完成——用户看过即确认）。 */
export function isFounderStepComplete(draft: SimulationDraft): boolean {
  return [draft.founder.reach, draft.founder.trust, draft.founder.convenience, draft.founder.promotion]
    .every((value) => Number.isFinite(value) && value >= 0 && value <= 10)
}

/** 仿真引擎是否已接入。当前恒为 false；接入真实引擎后改为按能力探测。 */
export function isSimulationEngineAvailable(): boolean {
  return false
}

export function stepStatus(draft: SimulationDraft, step: SimulationStepId): 'complete' | 'incomplete' | 'engine-pending' {
  if (step === 'engine' || step === 'report') return 'engine-pending'
  if (step === 'location') return isLocationStepComplete(draft) ? 'complete' : 'incomplete'
  return isFounderStepComplete(draft) ? 'complete' : 'incomplete'
}
