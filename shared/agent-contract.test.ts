import { describe, expect, it } from 'vitest'
import { assertAgentTask, type AgentTask } from './agent-contract.js'

const task: AgentTask = {
  id: 'nearby-enterprise-1', kind: 'nearby-enterprise-search', prompt: '找附近企业项目', searchProvider: 'doubao',
  criteria: { address: '成都高新区', radiusKm: 30, specialty: '机电安装', amountMin: 0, amountMax: 9000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'tender', candidateLimit: 10, targetCompanyName: '成都示例建设有限公司', targetProjectName: '示例园区机电工程' },
}

describe('agent task contract', () => {
  it('accepts a dedicated nearby enterprise task', () => {
    expect(() => assertAgentTask(task)).not.toThrow()
  })

  it('does not disguise an unsupported personal nearby task as enterprise discovery', () => {
    expect(() => assertAgentTask({ ...task, kind: 'nearby-personal-search' })).toThrow('任务参数')
  })

  it('rejects unsupported candidate limits and oversized prompts', () => {
    expect(() => assertAgentTask({ ...task, criteria: { ...task.criteria, candidateLimit: 12 } })).toThrow('任务参数')
    expect(() => assertAgentTask({ ...task, prompt: '查'.repeat(301) })).toThrow('任务参数')
  })

  it('rejects oversized visible target conditions', () => {
    expect(() => assertAgentTask({ ...task, criteria: { ...task.criteria, targetCompanyName: '企'.repeat(121) } })).toThrow('任务参数')
    expect(() => assertAgentTask({ ...task, criteria: { ...task.criteria, targetProjectName: '项'.repeat(181) } })).toThrow('任务参数')
  })
})
