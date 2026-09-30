import { buildProjectTimeline, projectStageIndex, type ProjectStageEvidence, type ProjectStageId } from './project-timeline.js'

export interface ProjectWatch {
  id: string
  opportunityId: string
  title: string
  status: 'active' | 'paused'
  checkCadence: 'on-launch'
  createdAt: string
  lastCheckedAt?: string
  lastKnownStageId?: ProjectStageId
  lastCheck?: ProjectWatchCheckSummary
}

export interface ProjectWatchCheckSummary {
  checkedAt: string
  outcome: 'advanced' | 'unchanged'
  fromStageId?: ProjectStageId
  toStageId?: ProjectStageId
  evidence?: ProjectStageEvidence
}

export const PROJECT_WATCH_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000
/** 关注页对外的复查周期（2026-09-15 用户口径：每周更新一次项目动态）。 */
export const PROJECT_WATCH_WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000
export const PROJECT_WATCH_LAUNCH_CALL_LIMIT = 1

interface CreateProjectWatchInput {
  opportunityId: string
  title: string
  evidence: ProjectStageEvidence[]
}

export interface ProjectTimelineCheckResult {
  watch: ProjectWatch
  advanced: boolean
  fromStageId?: ProjectStageId
  toStageId?: ProjectStageId
}

export function createProjectWatch(input: CreateProjectWatchInput, createdAt = new Date().toISOString()): ProjectWatch {
  return {
    id: `watch-${input.opportunityId}`,
    opportunityId: input.opportunityId,
    title: input.title,
    status: 'active',
    checkCadence: 'on-launch',
    createdAt,
    lastKnownStageId: buildProjectTimeline(input.evidence, new Date(createdAt)).currentVerifiedStageId,
  }
}

export function applyProjectTimelineCheck(
  watch: ProjectWatch,
  evidence: ProjectStageEvidence[],
  checkedAt = new Date().toISOString(),
): ProjectTimelineCheckResult {
  const detectedStageId = buildProjectTimeline(evidence, new Date(checkedAt)).currentVerifiedStageId
  const advanced = detectedStageId !== undefined
    && (watch.lastKnownStageId === undefined || projectStageIndex(detectedStageId) > projectStageIndex(watch.lastKnownStageId))
  const stageEvidence = advanced && detectedStageId
    ? [...evidence]
      .filter((item) => item.stageId === detectedStageId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]
    : undefined
  const lastCheck: ProjectWatchCheckSummary = advanced
    ? {
      checkedAt,
      outcome: 'advanced',
      fromStageId: watch.lastKnownStageId,
      toStageId: detectedStageId,
      evidence: stageEvidence,
    }
    : { checkedAt, outcome: 'unchanged' }

  return {
    watch: {
      ...watch,
      lastCheckedAt: checkedAt,
      lastKnownStageId: advanced ? detectedStageId : watch.lastKnownStageId,
      lastCheck,
    },
    advanced,
    fromStageId: advanced ? watch.lastKnownStageId : undefined,
    toStageId: advanced ? detectedStageId : undefined,
  }
}

export function projectWatchIsDue(
  watch: ProjectWatch,
  now = new Date(),
  refreshIntervalMs = PROJECT_WATCH_REFRESH_INTERVAL_MS,
): boolean {
  if (watch.status !== 'active') return false
  const lastCheckedAt = watch.lastCheckedAt ? Date.parse(watch.lastCheckedAt) : Number.NaN
  return !Number.isFinite(lastCheckedAt) || now.getTime() - lastCheckedAt >= refreshIntervalMs
}

export function selectDueLaunchProjectWatches(
  watches: ProjectWatch[],
  now = new Date(),
  limit = PROJECT_WATCH_LAUNCH_CALL_LIMIT,
  refreshIntervalMs = PROJECT_WATCH_REFRESH_INTERVAL_MS,
): ProjectWatch[] {
  if (!Number.isInteger(limit) || limit <= 0) return []
  return watches
    .filter((watch) => watch.checkCadence === 'on-launch' && projectWatchIsDue(watch, now, refreshIntervalMs))
    .sort((left, right) => {
      const leftTime = left.lastCheckedAt ? Date.parse(left.lastCheckedAt) : Number.NEGATIVE_INFINITY
      const rightTime = right.lastCheckedAt ? Date.parse(right.lastCheckedAt) : Number.NEGATIVE_INFINITY
      return leftTime - rightTime || left.createdAt.localeCompare(right.createdAt)
    })
    .slice(0, limit)
}
