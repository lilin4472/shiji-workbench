// 模块分析载荷（2026-09-16 用户口径）：
// 勾选项目后带进模块的**不是名字**，而是可离线分析的完整引用：
//   完整 Opportunity（含金额/阶段/截止/地址/evidenceIds）
//   + 关联的本机证据（原文链接、发布者、时间）
//   + 证据里已确定性提取的详情字段（代理机构/标段/范围/资格/保证金/开标时间）
// 模块据此优先用本机数据，避免"拿名字重新搜索"造成的词元浪费与不准。
import type { Opportunity } from '../shared/agent-contract'
import type { EvidenceRecord } from '../shared/evidence-contract'
import { PROJECT_STAGE_DEFINITIONS, buildProjectTimeline } from '../shared/project-timeline'

export interface ProjectScopeField { label: string; value: string }

export interface ProjectScopeItem {
  opportunity: Opportunity
  id: string
  title: string
  subjectName: string
  stageLabel: string
  amountLabel: string
  deadline: string | null
  evidenceCount: number
  sourceUrls: string[]
  detailFields: ProjectScopeField[]
  hasDetail: boolean
  loadSummary: string
}

function stageLabelOf(id?: string): string {
  if (!id) return '未取得阶段证据'
  return PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === id)?.label ?? '未取得阶段证据'
}

export function buildProjectScopeItems(opportunities: Opportunity[], records: EvidenceRecord[]): ProjectScopeItem[] {
  return opportunities.map((opportunity) => {
    const evidence = records.filter((record) => opportunity.evidenceIds.includes(record.id))
    const urls = [...new Set(evidence.map((record) => record.provenance.pageUrl).filter((url): url is string => Boolean(url)))]
    const details = evidence.map((record) => record.opportunityDetails).filter((value): value is NonNullable<typeof value> => Boolean(value))
    const fields: ProjectScopeField[] = []
    const push = (label: string, values: Array<string | number | null | undefined>) => {
      const list = values.filter((value): value is string | number => value !== null && value !== undefined && String(value).trim().length > 0)
      if (list.length > 0) fields.push({ label, value: list.slice(0, 3).map((value) => String(value)).join(' / ') })
    }
    push('代理机构', details.flatMap((detail) => detail.agencyCandidates ?? []))
    push('标段 / 标包', details.flatMap((detail) => detail.lotCandidates ?? []))
    push('招标范围', details.flatMap((detail) => detail.scopeCandidates ?? []))
    push('投标资格', details.flatMap((detail) => detail.qualificationCandidates ?? []))
    push('文件获取', details.flatMap((detail) => detail.documentAccessCandidates ?? []))
    push('保证金', details.flatMap((detail) => detail.depositCandidates ?? []))
    push('开标时间', details.flatMap((detail) => detail.openingTimeCandidates ?? []))
    push('评审方式', details.flatMap((detail) => detail.evaluationMethodCandidates ?? []))
    push('项目地址', [opportunity.locationAddress])

    const stageId = buildProjectTimeline(opportunity.timelineEvidence ?? []).currentVerifiedStageId
    return {
      opportunity,
      id: opportunity.id,
      title: opportunity.title,
      subjectName: opportunity.companyName?.trim() || '主体待核验',
      stageLabel: stageLabelOf(stageId),
      amountLabel: opportunity.amountWan === null ? '待核验' : `${opportunity.amountWan.toLocaleString()} 万`,
      deadline: opportunity.deadline,
      evidenceCount: evidence.length,
      sourceUrls: urls,
      detailFields: fields,
      hasDetail: fields.length > 0,
      loadSummary: `已加载项目对象 + ${evidence.length} 条本机证据${urls.length > 0 ? `（${urls.length} 条可打开原文）` : ''}`,
    }
  })
}