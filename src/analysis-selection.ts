// 模块分析范围（2026-09-16 第 3 步）：总览复选框写入，供时间链/产业链/获客等模块的"启动分析"取对象。
// 契约：只保存 opportunityId 列表，不复制项目数据；项目被删除/归档时由 App 侧自动剔除。
const KEY = 'shiji.analysis-selection.v1'

export function loadAnalysisSelection(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function saveAnalysisSelection(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]))
  } catch {
    // 本机存储不可用时只影响"记住勾选"，不影响本次运行
  }
}
