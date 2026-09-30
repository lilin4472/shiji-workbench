import type { AgentBackendId, AgentBackendResponse, AgentBackendStatus, DshModelSmokeTestResponse, DshModelSmokeTestResult } from '../shared/agent-backend-contract.js'
import type { AgentRunResult, AgentTask } from '../shared/agent-contract.js'
import { AgentRunError, type AgentRunnerPort, type AgentRunOptions } from '../shared/agent-runtime.js'

export interface DshBackendReadiness {
  available: boolean
  reason?: string
}

export interface AgentBackendManagerOptions {
  initialSelected?: AgentBackendId
  saveSelected?: (id: AgentBackendId) => Promise<void>
  mockEnabled?: boolean
}

export class AgentBackendManager implements AgentRunnerPort {
  private selected: AgentBackendId
  private dshRunner: AgentRunnerPort | undefined
  private dshModelTest: (() => Promise<DshModelSmokeTestResult>) | undefined
  private dshModelTestRunning = false
  private dshState: DshBackendReadiness = { available: false, reason: '正在检查 DSH 能力包…' }
  private resolveDshCheck!: () => void
  private readonly dshChecked = new Promise<void>((resolve) => { this.resolveDshCheck = resolve })

  constructor(
    private readonly mockRunner: AgentRunnerPort,
    private readonly checkDshCredential: () => Promise<boolean>,
    private readonly options: AgentBackendManagerOptions = {},
  ) {
    this.selected = options.mockEnabled && options.initialSelected === 'mock' ? 'mock' : 'dsh'
  }

  get name(): string {
    return this.selected === 'mock' ? this.mockRunner.name : this.dshRunner?.name ?? 'DeepSeek Harness'
  }

  setDshRunner(
    runner: AgentRunnerPort,
    testModel?: () => Promise<DshModelSmokeTestResult>,
  ): void {
    this.dshRunner = runner
    this.dshModelTest = testModel
    this.dshState = { available: true }
    this.resolveDshCheck()
  }

  setDshUnavailable(reason: string): void {
    this.dshRunner = undefined
    this.dshModelTest = undefined
    this.dshState = { available: false, reason }
    this.resolveDshCheck()
  }

  async status(): Promise<AgentBackendStatus> {
    await this.dshChecked
    const dsh = await this.dshReadiness()
    return {
      selected: this.selected,
      options: [
        ...(this.options.mockEnabled ? [{ id: 'mock' as const, label: '本地演示引擎', available: true }] : []),
        { id: 'dsh' as const, label: 'DeepSeek Harness', available: dsh.available, ...(dsh.reason ? { reason: dsh.reason } : {}) },
      ],
    }
  }

  async select(id: AgentBackendId): Promise<AgentBackendResponse> {
    if (id === 'mock') {
      if (!this.options.mockEnabled) {
        return { ok: false, message: '本地演示仅在显式开发预览模式中开放。', value: await this.status() }
      }
      await this.options.saveSelected?.(id)
      this.selected = 'mock'
      return { ok: true, value: await this.status() }
    }
    const readiness = await this.dshReadiness()
    if (!readiness.available) {
      const value = await this.status()
      return { ok: false, message: readiness.reason ?? 'DSH 后端不可用。', value }
    }
    await this.options.saveSelected?.(id)
    this.selected = 'dsh'
    return { ok: true, value: await this.status() }
  }

  async run(task: AgentTask, options?: AgentRunOptions): Promise<AgentRunResult> {
    if (this.selected === 'mock') return this.mockRunner.run(task, options)
    const readiness = await this.dshReadiness()
    if (!readiness.available || !this.dshRunner) {
      throw new AgentRunError('RUNTIME_ERROR', readiness.reason ?? 'DSH 后端不可用，请检查能力包和 DeepSeek Key。')
    }
    return this.dshRunner.run(task, options)
  }

  async testDshModel(): Promise<DshModelSmokeTestResponse> {
    const readiness = await this.dshReadiness()
    if (!readiness.available || !this.dshModelTest) {
      return { ok: false, message: readiness.reason ?? 'DSH 模型自检尚不可用。' }
    }
    if (this.dshModelTestRunning) return { ok: false, message: 'DSH 模型自检正在运行，请稍候。' }
    this.dshModelTestRunning = true
    try {
      return { ok: true, value: await this.dshModelTest() }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof AgentRunError
          ? error.message
          : 'DSH 真实模型链路未通过，请先确认 Key、网络和账户余额。',
      }
    } finally {
      this.dshModelTestRunning = false
    }
  }

  private async dshReadiness(): Promise<DshBackendReadiness> {
    if (!this.dshState.available || !this.dshRunner) return this.dshState
    try {
      if (!await this.checkDshCredential()) return { available: false, reason: '请先在设置中保存 DeepSeek API Key。' }
      return { available: true }
    } catch {
      return { available: false, reason: '无法读取本地 DeepSeek Key 状态。' }
    }
  }
}
