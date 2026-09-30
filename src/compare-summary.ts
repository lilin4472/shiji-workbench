import type { CreditRiskResult } from '../shared/credit-risk'
import type { EvidenceRecord } from '../shared/evidence-contract'
import { buildProjectTimeline, PROJECT_STAGE_DEFINITIONS } from '../shared/project-timeline'
import type { Opportunity } from '../shared/agent-contract'

export interface CompareCell {
  value: string
  note?: string
}

export interface CompareRow {
  label: string
  cells: CompareCell[]
}

const SUBJECT_PLACEHOLDERS = new Set(['主体待核验', '主体待从正文确认', '正文未识别', '待核验'])

function uniqueValues(values: Array<string | number | null | undefined>): string[] {
  return [...new Set(values
    .filter((value): value is string | number => value !== null && value !== undefined && String(value).trim() !== '')
    .map(String))]
}

function projectEvidence(item: Opportunity, records: EvidenceRecord[]): EvidenceRecord[] {
  const ids = new Set(item.evidenceIds)
  return records.filter((record) => ids.has(record.id))
}

function candidateCell(value: string | null | undefined, candidates: string[], emptyLabel: string): CompareCell {
  if (value?.trim()) return { value: value.trim(), note: '项目记录字段；可在招标详情核对来源' }
  if (candidates.length > 0) return { value: candidates.slice(0, 3).join(' / '), note: '来源正文提取候选，尚未确认' }
  return { value: emptyLabel }
}

function amountCell(item: Opportunity, records: EvidenceRecord[]): CompareCell {
  if (item.amountWan !== null) return { value: `${item.amountWan.toLocaleString()} 万`, note: '项目记录字段；可在招标详情核对来源' }
  const candidates = uniqueValues(records.flatMap((record) => record.opportunityDetails?.amountWanCandidates ?? []))
  return candidates.length > 0
    ? { value: candidates.slice(0, 3).map((value) => `${Number(value).toLocaleString()} 万`).join(' / '), note: '来源正文提取候选，尚未确认' }
    : { value: '正文未提取' }
}

function deadlineCell(item: Opportunity, records: EvidenceRecord[]): CompareCell {
  const cell = candidateCell(item.deadline, uniqueValues(records.flatMap((record) => record.opportunityDetails?.deadlineCandidates ?? [])), '正文未提取')
  if (cell.value === '正文未提取') return cell
  return /资审|资格预审/.test(item.title)
    ? { ...cell, note: '资审公告：可能是申请文件递交截止；须回原公告核对，不能当作投标截止' }
    : cell
}

function stageCell(item: Opportunity, records: EvidenceRecord[]): CompareCell {
  const verifiedStage = buildProjectTimeline(item.timelineEvidence ?? []).currentVerifiedStageId
  if (verifiedStage) {
    const label = PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === verifiedStage)?.label ?? verifiedStage
    return { value: label, note: '已有阶段证据确认' }
  }
  const candidateIds = uniqueValues(records.flatMap((record) => record.opportunityDetails?.stageIds ?? []))
  const labels = candidateIds.map((id) => PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === id)?.label ?? id)
  return labels.length > 0
    ? { value: labels.slice(0, 3).join(' / '), note: '公告阶段候选；尚未进入时间链确认' }
    : { value: '未取得阶段证据' }
}

function subjectCell(item: Opportunity, records: EvidenceRecord[]): CompareCell {
  const name = item.companyName?.trim()
  if (name && !SUBJECT_PLACEHOLDERS.has(name)) return { value: name, note: '项目记录主体；可在招标详情核对来源' }
  const candidates = uniqueValues(records.flatMap((record) => record.opportunityDetails?.companyCandidates ?? []))
    .filter((value) => !SUBJECT_PLACEHOLDERS.has(value.trim()))
  return candidates.length > 0
    ? { value: candidates.slice(0, 3).join(' / '), note: '来源正文提取候选，尚未确认' }
    : { value: '正文未提取' }
}

function riskCell(item: Opportunity, results: CreditRiskResult[]): CompareCell {
  const result = results.find((entry) => entry.opportunityId === item.id)
  if (!result) return { value: '尚未启动查询', note: '可在公开风险模块单独分析' }
  return {
    value: `已查询 · 命中 ${result.facts.length} 条风险事实`,
    note: result.facts.length === 0 ? '未命中不代表没有风险；详情见公开风险模块' : '事实与来源见公开风险模块',
  }
}

export function buildCompareRows(
  opportunities: Opportunity[],
  records: EvidenceRecord[],
  riskResults: CreditRiskResult[],
): CompareRow[] {
  const perProjectEvidence = opportunities.map((item) => projectEvidence(item, records))
  const row = (label: string, cells: CompareCell[]) => ({ label, cells })
  return [
    row('招标主体', opportunities.map((item, index) => subjectCell(item, perProjectEvidence[index]))),
    row('项目匹配分', opportunities.map((item) => ({ value: `${item.matchScore}%`, note: '系统匹配参考分，不代表事实核验结论' }))),
    row('预计金额', opportunities.map((item, index) => amountCell(item, perProjectEvidence[index]))),
    row('项目地址', opportunities.map((item, index) => candidateCell(item.locationAddress, uniqueValues(perProjectEvidence[index].flatMap((record) => record.opportunityDetails?.addressCandidates ?? [])), '正文未提取'))),
    row('文件递交截止', opportunities.map((item, index) => deadlineCell(item, perProjectEvidence[index]))),
    row('项目阶段', opportunities.map((item, index) => stageCell(item, perProjectEvidence[index]))),
    row('来源证据', opportunities.map((item, index) => ({ value: `${perProjectEvidence[index].length} 条`, note: perProjectEvidence[index].length > 0 ? '打开招标详情查看原文与出处' : '本机未找到关联来源记录' }))),
    row('跟进建议级别', opportunities.map((item) => ({ value: item.followUpLevel }))),
    row('公开风险分析', opportunities.map((item) => riskCell(item, riskResults))),
  ]
}
