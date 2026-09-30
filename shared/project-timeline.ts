export const AWARD_TO_CONTRACT_CALENDAR_DAYS = 30

export const PROJECT_STAGE_DEFINITIONS = [
  { id: 'initiation', label: '立项 / 备案', sourceHint: '发改、投资项目审批、地方政府公开文件' },
  { id: 'intention', label: '采购意向 / 招标计划', sourceHint: '政府采购、公共资源交易平台' },
  { id: 'tender', label: '招标公告', sourceHint: '公共资源交易、政府采购及采购人官网' },
  { id: 'evaluation', label: '开标评标', sourceHint: '开标记录、评审信息及更正公告' },
  { id: 'candidate', label: '中标候选人公示', sourceHint: '公共资源交易平台' },
  { id: 'award', label: '中标 / 成交结果', sourceHint: '公共资源交易、政府采购及采购人官网' },
  { id: 'contract', label: '合同公告 / 已签约', sourceHint: '政府采购合同公告、采购人或业主官网' },
] as const

export type ProjectStageId = typeof PROJECT_STAGE_DEFINITIONS[number]['id']
export type ProjectStageFilter = ProjectStageId | 'all'
export type ProjectStageState = 'verified' | 'expected' | 'unverified' | 'overdue-unverified'

const projectStageIds = new Set<string>(PROJECT_STAGE_DEFINITIONS.map((stage) => stage.id))

export function isProjectStageId(value: unknown): value is ProjectStageId {
  return typeof value === 'string' && projectStageIds.has(value)
}

export function projectStageIndex(stageId: ProjectStageId): number {
  return PROJECT_STAGE_DEFINITIONS.findIndex((stage) => stage.id === stageId)
}

export interface ProjectStageEvidence {
  evidenceId: string
  stageId: ProjectStageId
  occurredAt: string
  title: string
  source: string
}

export interface ProjectTimelineNode {
  stageId: ProjectStageId
  label: string
  sourceHint: string
  state: ProjectStageState
  dateLabel: string
  summary: string
  evidenceIds: string[]
  expectedBy?: string
}

export interface ProjectTimeline {
  currentVerifiedStageId?: ProjectStageId
  nodes: ProjectTimelineNode[]
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(value: string, days: number): string | undefined {
  const date = parseIsoDate(value)
  if (!date) return undefined
  date.setUTCDate(date.getUTCDate() + days)
  return isoDate(date)
}

function utcToday(now: Date): string {
  return isoDate(now)
}

export function buildProjectTimeline(evidence: ProjectStageEvidence[], now = new Date()): ProjectTimeline {
  const acceptedEvidence = evidence
    .filter((item) => parseIsoDate(item.occurredAt))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))

  let currentVerifiedStageId: ProjectStageId | undefined
  for (const definition of PROJECT_STAGE_DEFINITIONS) {
    if (acceptedEvidence.some((item) => item.stageId === definition.id)) currentVerifiedStageId = definition.id
  }

  const award = acceptedEvidence.filter((item) => item.stageId === 'award').at(-1)
  const contractDeadline = award ? addUtcDays(award.occurredAt, AWARD_TO_CONTRACT_CALENDAR_DAYS) : undefined

  const nodes = PROJECT_STAGE_DEFINITIONS.map<ProjectTimelineNode>((definition) => {
    const matches = acceptedEvidence.filter((item) => item.stageId === definition.id)
    const latest = matches.at(-1)
    if (latest) {
      return {
        stageId: definition.id,
        label: definition.label,
        sourceHint: definition.sourceHint,
        state: 'verified',
        dateLabel: latest.occurredAt,
        summary: latest.title,
        evidenceIds: matches.map((item) => item.evidenceId),
      }
    }

    if (definition.id === 'contract' && contractDeadline) {
      const overdue = utcToday(now) > contractDeadline
      return {
        stageId: definition.id,
        label: definition.label,
        sourceHint: definition.sourceHint,
        state: overdue ? 'overdue-unverified' : 'expected',
        dateLabel: overdue ? `截至 ${utcToday(now)}` : `最迟 ${contractDeadline}`,
        summary: overdue
          ? `已超过中标后 ${AWARD_TO_CONTRACT_CALENDAR_DAYS} 个日历日，仍未取得合同证据`
          : `仅按中标后 ${AWARD_TO_CONTRACT_CALENDAR_DAYS} 个日历日规则估算，尚未确认签约`,
        evidenceIds: [],
        expectedBy: contractDeadline,
      }
    }

    return {
      stageId: definition.id,
      label: definition.label,
      sourceHint: definition.sourceHint,
      state: 'unverified',
      dateLabel: '日期待核',
      summary: `未取得可核验的${definition.label}证据`,
      evidenceIds: [],
    }
  })

  return { currentVerifiedStageId, nodes }
}

export function matchesProjectStage(evidence: ProjectStageEvidence[], target: ProjectStageFilter, now = new Date()): boolean {
  if (target === 'all') return true
  return buildProjectTimeline(evidence, now).currentVerifiedStageId === target
}
