import { describe, expect, it, vi } from 'vitest'
import type { AgentTask } from '../shared/agent-contract'
import { AgentRunError, type AgentRunnerPort } from '../shared/agent-runtime'
import { AgentBackendManager } from './agent-backend-manager'

const task: AgentTask = {
  id: 'task-1', kind: 'opportunity-search', prompt: 'test',
  criteria: { address: '上海', radiusKm: 10, specialty: '机电', amountMin: 0, amountMax: 100, projectType: '不限', timeWindow: '30天', targetStageId: 'all', candidateLimit: 10 },
}

function runner(name: string): AgentRunnerPort {
  return { name, run: vi.fn(async () => ({ taskId: task.id, backend: name, completedAt: new Date().toISOString(), opportunities: [] })) }
}

describe('AgentBackendManager', () => {
  it('defaults to DSH and never exposes Mock in product mode', async () => {
    const manager = new AgentBackendManager(runner('mock'), async () => true)
    manager.setDshRunner(runner('dsh'))
    expect(await manager.status()).toMatchObject({ selected: 'dsh', options: [{ id: 'dsh' }] })
    await expect(manager.select('mock')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('开发预览') })
    await expect(manager.run(task)).resolves.toMatchObject({ backend: 'dsh' })
  })

  it('exposes Mock only when explicit development preview is enabled', async () => {
    const manager = new AgentBackendManager(runner('mock'), async () => true, { mockEnabled: true, initialSelected: 'mock' })
    manager.setDshRunner(runner('dsh'))
    expect(await manager.status()).toMatchObject({ selected: 'mock', options: [{ id: 'mock' }, { id: 'dsh' }] })
    await expect(manager.run(task)).resolves.toMatchObject({ backend: 'mock' })
  })

  it('requires both a valid capability and a configured Key before selection', async () => {
    const manager = new AgentBackendManager(runner('mock'), async () => false)
    manager.setDshRunner(runner('dsh'))
    await expect(manager.select('dsh')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('API Key') })
    manager.setDshUnavailable('能力包损坏')
    await expect(manager.select('dsh')).resolves.toMatchObject({ ok: false, message: '能力包损坏' })
  })

  it('uses DSH only after explicit selection', async () => {
    const saveSelected = vi.fn(async () => undefined)
    const manager = new AgentBackendManager(runner('mock'), async () => true, { mockEnabled: true, saveSelected })
    manager.setDshRunner(runner('dsh'))
    await expect(manager.select('dsh')).resolves.toMatchObject({ ok: true, value: { selected: 'dsh' } })
    await expect(manager.run(task)).resolves.toMatchObject({ backend: 'dsh' })
    expect(saveSelected).toHaveBeenCalledWith('dsh')
  })

  it('restores a previously selected DSH backend after restart', async () => {
    const manager = new AgentBackendManager(runner('mock'), async () => true, { initialSelected: 'dsh' })
    manager.setDshRunner(runner('dsh'))

    expect((await manager.status()).selected).toBe('dsh')
    await expect(manager.run(task)).resolves.toMatchObject({ backend: 'dsh' })
  })

  it('does not fall back to Mock when the Key disappears after DSH selection', async () => {
    let hasKey = true
    const manager = new AgentBackendManager(runner('mock'), async () => hasKey, { mockEnabled: true })
    manager.setDshRunner(runner('dsh'))
    await manager.select('dsh')
    hasKey = false
    await expect(manager.run(task)).rejects.toMatchObject<Partial<AgentRunError>>({ code: 'RUNTIME_ERROR' })
  })

  it('runs the bounded DSH model smoke test without changing the selected backend', async () => {
    const smokeTest = vi.fn(async () => ({
      connected: true as const,
      model: 'deepseek-v4-flash',
      maxOutputTokens: 64,
      checkedAt: new Date().toISOString(),
    }))
    const manager = new AgentBackendManager(runner('mock'), async () => true)
    manager.setDshRunner(runner('dsh'), smokeTest)

    await expect(manager.testDshModel()).resolves.toMatchObject({ ok: true, value: { maxOutputTokens: 64 } })
    expect(smokeTest).toHaveBeenCalledOnce()
    expect((await manager.status()).selected).toBe('dsh')
  })

  it('preserves controlled DSH failure guidance without exposing arbitrary errors', async () => {
    const manager = new AgentBackendManager(runner('mock'), async () => true)
    manager.setDshRunner(runner('dsh'), async () => {
      throw new AgentRunError('RUNTIME_ERROR', 'DeepSeek 账户余额不足，请充值后再运行模型自检。')
    })

    await expect(manager.testDshModel()).resolves.toEqual({
      ok: false,
      message: 'DeepSeek 账户余额不足，请充值后再运行模型自检。',
    })
  })

})
