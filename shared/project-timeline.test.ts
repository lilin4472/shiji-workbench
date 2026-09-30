import { describe, expect, it } from 'vitest'
import {
  AWARD_TO_CONTRACT_CALENDAR_DAYS,
  PROJECT_STAGE_DEFINITIONS,
  buildProjectTimeline,
  matchesProjectStage,
  type ProjectStageEvidence,
} from './project-timeline.js'

const awardEvidence: ProjectStageEvidence = {
  evidenceId: 'award-001',
  stageId: 'award',
  occurredAt: '2026-09-01',
  title: '中标结果公告',
  source: '公共资源交易平台',
}

describe('project timeline', () => {
  it('keeps the fixed seven-stage business sequence', () => {
    expect(PROJECT_STAGE_DEFINITIONS.map((stage) => stage.id)).toEqual([
      'initiation',
      'intention',
      'tender',
      'evaluation',
      'candidate',
      'award',
      'contract',
    ])
  })

  it('does not invent a current stage when there is no accepted evidence', () => {
    const timeline = buildProjectTimeline([], new Date('2026-09-06T00:00:00Z'))

    expect(timeline.currentVerifiedStageId).toBeUndefined()
    expect(timeline.nodes.every((node) => node.state === 'unverified')).toBe(true)
  })

  it('marks accepted evidence as verified but leaves later stages unverified', () => {
    const evidence: ProjectStageEvidence[] = [{
      evidenceId: 'tender-001',
      stageId: 'tender',
      occurredAt: '2026-09-03',
      title: '招标公告',
      source: '公共资源交易平台',
    }]
    const timeline = buildProjectTimeline(evidence, new Date('2026-09-06T00:00:00Z'))

    expect(timeline.currentVerifiedStageId).toBe('tender')
    expect(timeline.nodes.find((node) => node.stageId === 'tender')?.state).toBe('verified')
    expect(timeline.nodes.find((node) => node.stageId === 'award')?.state).toBe('unverified')
    expect(timeline.nodes.find((node) => node.stageId === 'contract')?.state).toBe('unverified')
  })

  it('uses the award date only to estimate the contract deadline', () => {
    const timeline = buildProjectTimeline([awardEvidence], new Date('2026-09-15T00:00:00Z'))
    const contract = timeline.nodes.find((node) => node.stageId === 'contract')

    expect(AWARD_TO_CONTRACT_CALENDAR_DAYS).toBe(30)
    expect(contract?.state).toBe('expected')
    expect(contract?.expectedBy).toBe('2026-10-01')
    expect(timeline.currentVerifiedStageId).toBe('award')
  })

  it('reports overdue-unverified instead of pretending the contract exists', () => {
    const timeline = buildProjectTimeline([awardEvidence], new Date('2026-10-02T00:00:00Z'))
    const contract = timeline.nodes.find((node) => node.stageId === 'contract')

    expect(contract?.state).toBe('overdue-unverified')
    expect(timeline.currentVerifiedStageId).toBe('award')
  })

  it('lets contract evidence override an earlier estimate', () => {
    const timeline = buildProjectTimeline([
      awardEvidence,
      {
        evidenceId: 'contract-001',
        stageId: 'contract',
        occurredAt: '2026-09-20',
        title: '合同公告',
        source: '政府采购网',
      },
    ], new Date('2026-10-02T00:00:00Z'))

    expect(timeline.nodes.find((node) => node.stageId === 'contract')?.state).toBe('verified')
    expect(timeline.currentVerifiedStageId).toBe('contract')
  })

  it('never advances from tender to award merely because time passed', () => {
    const timeline = buildProjectTimeline([{
      evidenceId: 'tender-001',
      stageId: 'tender',
      occurredAt: '2026-01-01',
      title: '招标公告',
      source: '公共资源交易平台',
    }], new Date('2026-09-06T00:00:00Z'))

    expect(timeline.nodes.find((node) => node.stageId === 'award')?.state).toBe('unverified')
    expect(timeline.nodes.find((node) => node.stageId === 'contract')?.state).toBe('unverified')
  })

  it('matches a search stage only against the latest verified stage', () => {
    expect(matchesProjectStage([awardEvidence], 'award', new Date('2026-09-15T00:00:00Z'))).toBe(true)
    expect(matchesProjectStage([awardEvidence], 'contract', new Date('2026-09-15T00:00:00Z'))).toBe(false)
    expect(matchesProjectStage([awardEvidence], 'all', new Date('2026-09-15T00:00:00Z'))).toBe(true)
  })
})
