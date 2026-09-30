import type { CreditRiskResult } from '../shared/credit-risk'
import type { LeadResult } from '../shared/lead-contacts'
import type { PolicyChainResult } from '../shared/policy-chain'
import { buildProjectTimeline, PROJECT_STAGE_DEFINITIONS, projectStageIndex } from '../shared/project-timeline'
import type { ProjectWatch } from '../shared/project-watch'
import type { ActionItem, ManagedObject, Opportunity } from './domain'
import { removeProjectFromBucket, selectBucketProjects } from './drag'

export interface BuildActionPlanInput {
  opportunity: Opportunity
  /** Only modules with a matching, completed/partial AnalysisRunState may contribute actions. */
  availableModules?: Partial<Record<'timeline' | 'policy' | 'industry' | 'risk' | 'leads', boolean>>
  policyResult?: PolicyChainResult
  riskResult?: CreditRiskResult
  leadResult?: LeadResult
  watch?: ProjectWatch
  now?: Date
  /** Offline trial replays past evidence; never word actions as a current tender. */
  historicalReplay?: boolean
}

/** 行动页的项目范围只认“行动清单”桶，并按用户放入顺序去重。 */
export function selectActionProjects(opportunities: Opportunity[], objects: ManagedObject[]): Opportunity[] {
  return selectBucketProjects(opportunities, objects)
}

/** 只把项目从行动清单移出；项目、证据和已经取得的模块结果继续留在本机。 */
export function removeActionProject(objects: ManagedObject[], opportunityId: string): ManagedObject[] {
  return removeProjectFromBucket(objects, opportunityId)
}

function stableId(opportunityId: string, category: ActionItem['category'], key: string): string {
  const raw = `${opportunityId}:${category}:${key}`
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `action-${(hash >>> 0).toString(36)}`
}

function createAction(
  opportunityId: string,
  category: ActionItem['category'],
  key: string,
  item: Omit<ActionItem, 'id' | 'opportunityId' | 'category' | 'done'>,
): ActionItem {
  return { id: stableId(opportunityId, category, key), opportunityId, category, done: false, ...item }
}

function compactDate(value: string | null | undefined): string {
  if (!value) return '日期待从公告确认'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[2]}-${match[3]}` : value
}

function daysUntil(value: string | null, now: Date): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const end = Date.parse(`${value}T23:59:59Z`)
  if (!Number.isFinite(end)) return undefined
  const difference = (end - now.getTime()) / 86_400_000
  return difference < 0 ? Math.floor(difference) : Math.ceil(difference)
}

function firstValue(values: Array<{ value: string }>): string | undefined {
  return values.find((value) => value.value.trim())?.value.trim()
}

function summarize(value: string, maxLength = 90): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact
}

/**
 * 行动模块只把已取得的真实结果整理成执行清单，不发起搜索、模型调用或关系推断。
 * 没有获客结果时不会凭产业链公司名编造联系人；没有风险事实时也不会声称“无风险”。
 */
export function buildActionPlan(input: BuildActionPlanInput): ActionItem[] {
  const { opportunity, availableModules = {}, policyResult, riskResult, leadResult, watch, historicalReplay = false } = input
  const now = input.now ?? new Date()
  const items: ActionItem[] = []
  const timeline = buildProjectTimeline(opportunity.timelineEvidence, now)
  const currentStage = PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === timeline.currentVerifiedStageId)?.label ?? '阶段待核验'
  const currentStageIndex = timeline.currentVerifiedStageId === undefined ? -1 : projectStageIndex(timeline.currentVerifiedStageId)
  const nextNode = timeline.nodes.find((node) => projectStageIndex(node.stageId) > currentStageIndex && node.state !== 'verified')

  if (availableModules.timeline) {
    items.push(createAction(opportunity.id, '业务跟踪', 'stage', {
      title: historicalReplay ? `复盘${currentStage}后的证据缺口` : `跟踪${currentStage}后的下一节点`,
      detail: historicalReplay ? `这是历史案例；当时证据确认到“${currentStage}”，可观察系统如何提示后续证据缺口，不代表项目当前阶段。` : nextNode
        ? `当前证据确认到“${currentStage}”；下一步关注“${nextNode.label}”的正式公告或原文证据。`
        : `当前证据确认到“${currentStage}”；继续关注后续正式公告，不按日期自动推进阶段。`,
      basis: opportunity.timelineEvidence.length > 0
        ? `${opportunity.timelineEvidence.length} 条时间链阶段证据`
        : '时间链已运行，但尚未取得可确认阶段的原文证据',
      sourceModules: ['时间链'],
      timing: historicalReplay ? '体验复盘' : watch?.status === 'active' ? '持续观察' : '本周',
      owner: '业务跟踪',
      target: opportunity.companyName,
    }))
  }

  const prediction = availableModules.policy ? policyResult?.predictions[0] : undefined
  if (prediction) {
    items.push(createAction(opportunity.id, '业务跟踪', `policy:${prediction.id}`, {
      title: `观察${prediction.label}`,
      detail: `预测窗口 ${prediction.windowStart} 至 ${prediction.windowEnd}；窗口仅用于安排跟踪，不代表项目已确定。`,
      basis: prediction.basis,
      sourceModules: ['政策链'],
      timing: '持续观察',
      owner: '市场跟踪',
      target: policyResult?.subjectName,
    }))
  }

  for (const row of availableModules.industry && availableModules.leads ? leadResult?.rows.slice(0, 3) ?? [] : []) {
    const contact = firstValue(row.contact)
    const phone = firstValue(row.phone)
    const email = firstValue(row.email)
    if (!contact && !phone && !email) continue
    const reach = [contact && `联系人 ${contact}`, phone && `电话 ${phone}`, email && `邮箱 ${email}`].filter(Boolean).join(' · ')
    items.push(createAction(opportunity.id, '商务对接', `lead:${row.id}`, {
      title: historicalReplay ? `核对${row.name}的历史公开联系方式` : `联系${row.name}`,
      detail: historicalReplay ? `${reach}。这仅用于演示证据到行动的链路；联系方式可能过时，且不代表本项目专属联系人。` : `${reach}。先核对其与本项目的“${row.relationLabel}”关系，再围绕项目范围与合作方式沟通。`,
      basis: row.relationQuote || '获客模块公开来源',
      sourceModules: ['产业链', '获客'],
      timing: historicalReplay ? '体验复盘' : '本周',
      owner: '商务对接',
      target: row.name,
    }))
  }

  const remainingDays = daysUntil(opportunity.deadline, now)
  const deadlineText = compactDate(opportunity.deadline)
  items.push(createAction(opportunity.id, '投标准备', 'deadline', {
    title: historicalReplay ? '复盘历史公告的投标条件与附件' : `按 ${deadlineText} 倒排投标准备`,
    detail: historicalReplay ? '打开历史项目详情，练习核对资格条件、采购范围、截止日期及附件；该案例不构成当前可投标机会。' : remainingDays === undefined
      ? '先打开项目详情核对投标截止时间、资格条件、采购范围与附件，再建立内部倒排节点。'
      : remainingDays < 0
        ? `公告截止时间已过去 ${Math.abs(remainingDays)} 天；先确认是否延期、重新招标或已进入结果阶段。`
        : `距公告截止约 ${remainingDays} 天；优先核对资格条件、保证金、技术范围、报价文件与附件完整性。`,
    basis: opportunity.deadline ? `项目详情记录的截止时间：${opportunity.deadline}` : '项目详情尚未取得明确截止时间',
    sourceModules: ['项目详情'],
    timing: historicalReplay ? '体验复盘' : '今天',
    owner: '投标负责人',
    target: opportunity.title,
  }))

  const riskFacts = availableModules.risk ? riskResult?.facts.filter((fact) => !fact.leadOnly) ?? [] : []
  if (riskFacts.length > 0) {
    const recent = riskFacts[0]
    items.push(createAction(opportunity.id, '投标准备', 'risk-review', {
      title: `复核 ${riskFacts.length} 条公开风险事实`,
      detail: `优先核对“${recent.categoryLabel}：${summarize(recent.reason)}”，评估其对回款、履约或合作边界的影响；本模块不替用户作失信结论。`,
      basis: `${recent.publisher || recent.sourceTitle} · ${recent.sourceTitle}`,
      sourceModules: ['公开风险'],
      timing: '本周',
      owner: '商务 / 风控',
      target: riskResult?.subjectName,
    }))
  }

  return items
}
