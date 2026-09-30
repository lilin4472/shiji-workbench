import { describe, expect, it } from 'vitest'
import { assertAgentTask, type BusinessProfile } from './agent-contract.js'
import { createDeepRadarTask } from './deep-radar-task.js'
import { buildDiscoveryStageSearchPlan } from './stage-search-plan.js'

const profile: BusinessProfile = {
  subjectType: 'enterprise', name: '成都某安装企业', businessRegions: ['成都市武侯区'], companyNature: '民营', scale: '50人',
  industries: ['建筑安装'], specialties: ['机电安装'], qualifications: ['机电一级'], assetsAndEquipment: '',
  personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
}

describe('deep radar task route', () => {
  it('derives its search only from the user capability profile', () => {
    const task = createDeepRadarTask('radar-1', '按我的能力匹配项目', profile, 'doubao')
    expect(() => assertAgentTask(task)).not.toThrow()
    expect(task).toMatchObject({ kind: 'deep-radar-search', profile, criteria: {
      address: '成都市武侯区', specialty: '机电安装', targetCompanyName: '', targetProjectName: '', targetStageId: 'tender',
    } })
  })

  it('keeps a condition-button run on the deterministic profile route', () => {
    const task = createDeepRadarTask('radar-conditions', '按当前画像匹配商机', profile, 'doubao', 'tender', 'conditions')
    expect(() => assertAgentTask(task)).not.toThrow()
    expect(task).toMatchObject({
      inputMode: 'conditions',
      criteria: { address: '成都市武侯区', specialty: '机电安装', targetStageId: 'tender' },
    })
    expect(buildDiscoveryStageSearchPlan(task.criteria).query).toContain('成都市武侯区 机电安装')
  })

  it('rejects a radar route without its own business profile', () => {
    const task = createDeepRadarTask('radar-1', '按我的能力匹配项目', profile, 'doubao')
    expect(() => assertAgentTask({ ...task, profile: undefined })).toThrow('任务参数')
  })
})
