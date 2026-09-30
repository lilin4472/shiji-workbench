// 商机雷达「本次项目阶段」筛选的本机偏好（2026-09-15）。
//
// 契约（见 docs/PRODUCT_LOGIC_DATAFLOW_V1.md §5.9）：雷达只读取长期能力画像
// 与本次输入，不得复用自动识别条件栏。因此阶段筛选单独保存在本机偏好里：
// 既不污染长期画像（画像描述"这家企业能承接什么"），也不与条件栏互相覆盖。
//
// 取值只能是 7 个既有阶段之一或 all（不限阶段）。"进场施工"目前不是模型内的
// 阶段（最近的是 contract＝合同公告/已签约），若要新增需先改需求再扩展词表。
import { isProjectStageId, type ProjectStageFilter } from '../shared/project-timeline'

const STORAGE_KEY = 'shiji.radar-stage-filter.v1'

/** 默认只找"在招、可投标"的项目。 */
export const RADAR_STAGE_DEFAULT: ProjectStageFilter = 'tender'

export function isRadarStageFilter(value: unknown): value is ProjectStageFilter {
  return value === 'all' || isProjectStageId(value)
}

export function loadRadarStageFilter(): ProjectStageFilter {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return RADAR_STAGE_DEFAULT
    const parsed: unknown = JSON.parse(raw)
    const value = typeof parsed === 'object' && parsed !== null && 'targetStageId' in parsed
      ? (parsed as { targetStageId?: unknown }).targetStageId
      : parsed
    return isRadarStageFilter(value) ? value : RADAR_STAGE_DEFAULT
  } catch {
    return RADAR_STAGE_DEFAULT
  }
}

export function saveRadarStageFilter(value: ProjectStageFilter): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ targetStageId: value, savedAt: new Date().toISOString() }))
  } catch {
    // 本机存储不可用时只影响"记住上次选择"，不影响本次运行
  }
}
