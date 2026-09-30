import { describe, expect, it } from 'vitest'
import {
  applyProjectTimelineCheck, createProjectWatch, projectWatchIsDue, selectDueLaunchProjectWatches,
} from './project-watch.js'
import type { ProjectStageEvidence } from './project-timeline.js'

const intention: ProjectStageEvidence = {
  evidenceId: 'intent-1', stageId: 'intention', occurredAt: '2026-08-01', title: '采购意向', source: '政府采购网',
}
const tender: ProjectStageEvidence = {
  evidenceId: 'tender-1', stageId: 'tender', occurredAt: '2026-09-01', title: '招标公告', source: '公共资源交易平台',
}

describe('project watch', () => {
  it('records the verified stage at subscription time', () => {
    const watch = createProjectWatch({ opportunityId: 'opp-1', title: '示例项目', evidence: [intention] }, '2026-09-02T00:00:00.000Z')
    expect(watch.lastKnownStageId).toBe('intention')
    expect(watch.status).toBe('active')
    expect(watch.checkCadence).toBe('on-launch')
  })

  it('detects a later verified stage and updates the local checkpoint', () => {
    const watch = createProjectWatch({ opportunityId: 'opp-1', title: '示例项目', evidence: [intention] }, '2026-08-02T00:00:00.000Z')
    const result = applyProjectTimelineCheck(watch, [intention, tender], '2026-09-02T00:00:00.000Z')
    expect(result.advanced).toBe(true)
    expect(result.fromStageId).toBe('intention')
    expect(result.toStageId).toBe('tender')
    expect(result.watch.lastKnownStageId).toBe('tender')
    expect(result.watch.lastCheck).toEqual({
      checkedAt: '2026-09-02T00:00:00.000Z',
      outcome: 'advanced',
      fromStageId: 'intention',
      toStageId: 'tender',
      evidence: tender,
    })
  })

  it('does not regress when a later check temporarily misses old evidence', () => {
    const watch = createProjectWatch({ opportunityId: 'opp-1', title: '示例项目', evidence: [intention, tender] }, '2026-09-02T00:00:00.000Z')
    const result = applyProjectTimelineCheck(watch, [intention], '2026-09-03T00:00:00.000Z')
    expect(result.advanced).toBe(false)
    expect(result.watch.lastKnownStageId).toBe('tender')
    expect(result.watch.lastCheck).toEqual({
      checkedAt: '2026-09-03T00:00:00.000Z',
      outcome: 'unchanged',
    })
  })

  it('does not spend a launch check while the six-hour freshness window is still valid', () => {
    const watch = createProjectWatch({ opportunityId: 'opp-1', title: '示例项目', evidence: [intention] }, '2026-09-02T00:00:00.000Z')
    watch.lastCheckedAt = '2026-09-11T02:00:00.000Z'

    expect(projectWatchIsDue(watch, new Date('2026-09-11T07:59:59.000Z'))).toBe(false)
    expect(projectWatchIsDue(watch, new Date('2026-09-11T08:00:00.000Z'))).toBe(true)
  })

  it('checks at most one oldest due active subscription per launch', () => {
    const fresh = createProjectWatch({ opportunityId: 'fresh', title: '新检查', evidence: [intention] }, '2026-09-01T00:00:00.000Z')
    fresh.lastCheckedAt = '2026-09-11T07:00:00.000Z'
    const paused = createProjectWatch({ opportunityId: 'paused', title: '已暂停', evidence: [intention] }, '2026-08-01T00:00:00.000Z')
    paused.status = 'paused'
    const oldest = createProjectWatch({ opportunityId: 'oldest', title: '最早待查', evidence: [intention] }, '2026-07-01T00:00:00.000Z')
    const later = createProjectWatch({ opportunityId: 'later', title: '稍后待查', evidence: [intention] }, '2026-08-01T00:00:00.000Z')

    expect(selectDueLaunchProjectWatches([fresh, paused, later, oldest], new Date('2026-09-11T08:00:00.000Z'))
      .map((watch) => watch.opportunityId)).toEqual(['oldest'])
  })
})
