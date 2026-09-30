import { describe, expect, it } from 'vitest'
import type { AgentTask } from '../shared/agent-contract'
import { AgentRunError, AgentRunner, MockAgentBackend, type AgentBackend } from '../shared/agent-runtime'

const baseTask: AgentTask = {
  id: 'task-test',
  kind: 'opportunity-search',
  prompt: '查找机会',
  criteria: {
    address: '上海', radiusKm: 10, specialty: '机电安装', amountMin: 1000,
    amountMax: 4000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 10,
  },
}

describe('AgentRunner', () => {
  it('filters opportunities with the one-time search criteria boundaries', async () => {
    const runner = new AgentRunner(new MockAgentBackend(0))
    const result = await runner.run(baseTask)
    expect(result.opportunities.map((item) => item.id)).toEqual(['opp-lingang-001'])
  })

  it('applies the selected project type', async () => {
    const runner = new AgentRunner(new MockAgentBackend(0))
    const result = await runner.run({
      ...baseTask,
      criteria: { ...baseTask.criteria, radiusKm: 30, amountMin: 0, amountMax: 9000, projectType: '医疗建筑' },
    })
    expect(result.opportunities.map((item) => item.id)).toEqual(['opp-hospital-002'])
  })

  it('filters results by the latest evidence-confirmed project stage', async () => {
    const runner = new AgentRunner(new MockAgentBackend(0))
    const result = await runner.run({
      ...baseTask,
      criteria: { ...baseTask.criteria, radiusKm: 30, amountMin: 0, amountMax: 9000, targetStageId: 'award' },
    })
    expect(result.opportunities.map((item) => item.id)).toEqual(['opp-hospital-002'])
  })

  it('cancels an active task', async () => {
    const runner = new AgentRunner(new MockAgentBackend(100))
    const controller = new AbortController()
    const pending = runner.run(baseTask, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject<Partial<AgentRunError>>({ code: 'CANCELLED' })
  })

  it('does not start a task when it was already cancelled', async () => {
    const runner = new AgentRunner(new MockAgentBackend(0))
    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(baseTask, { signal: controller.signal })).rejects.toMatchObject<Partial<AgentRunError>>({ code: 'CANCELLED' })
  })

  it('stops a task that exceeds its timeout', async () => {
    const runner = new AgentRunner(new MockAgentBackend(100))
    await expect(runner.run(baseTask, { timeoutMs: 5 })).rejects.toMatchObject<Partial<AgentRunError>>({ code: 'TIMEOUT' })
  })

  it('rejects backend data that does not match the business result contract', async () => {
    const invalidBackend: AgentBackend = {
      name: '无效测试后端',
      execute: async () => ({ taskId: baseTask.id, backend: '无效测试后端', completedAt: new Date().toISOString(), opportunities: [{ id: 'broken' }] }),
    }
    const runner = new AgentRunner(invalidBackend)
    await expect(runner.run(baseTask)).rejects.toMatchObject<Partial<AgentRunError>>({ code: 'INVALID_RESULT' })
  })
})
