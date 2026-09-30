import {
  assertAgentRunResult,
  assertAgentTask,
  type AgentErrorCode,
  type AgentRunEvent,
  type AgentRunResult,
  type AgentTask,
  type Opportunity,
} from './agent-contract.js'
import { matchesProjectStage } from './project-timeline.js'

export const DEFAULT_AGENT_TIMEOUT_MS = 30_000

export interface AgentRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onEvent?: (event: AgentRunEvent) => void
}

interface AgentExecutionContext {
  signal: AbortSignal
  onEvent?: (event: AgentRunEvent) => void
}

export interface AgentBackend {
  readonly name: string
  execute(task: AgentTask, context: AgentExecutionContext): Promise<unknown>
}

export interface AgentRunnerPort {
  readonly name: string
  run(task: AgentTask, options?: AgentRunOptions): Promise<AgentRunResult>
}

export class AgentRunError extends Error {
  constructor(readonly code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentRunError'
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AgentRunError('CANCELLED', '任务已取消。'))
      return
    }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new AgentRunError('CANCELLED', '任务已取消。'))
    }, { once: true })
  })
}

export class AgentRunner implements AgentRunnerPort {
  readonly name: string

  constructor(private readonly backend: AgentBackend) {
    this.name = backend.name
  }

  async run(taskValue: AgentTask, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    try {
      assertAgentTask(taskValue)
    } catch (error) {
      throw new AgentRunError('INVALID_TASK', error instanceof Error ? error.message : '任务参数无效。')
    }

    const controller = new AbortController()
    let timedOut = false
    const cancel = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS)

    try {
      const result = await this.backend.execute(taskValue, { signal: controller.signal, onEvent: options.onEvent })
      if (controller.signal.aborted) {
        throw new AgentRunError(timedOut ? 'TIMEOUT' : 'CANCELLED', timedOut ? '任务运行超时。' : '任务已取消。')
      }
      try {
        assertAgentRunResult(result)
      } catch (error) {
        throw new AgentRunError('INVALID_RESULT', error instanceof Error ? error.message : '运行结果格式无效。')
      }
      if (result.taskId !== taskValue.id) {
        throw new AgentRunError('INVALID_RESULT', '运行结果与当前任务不匹配。')
      }
      return result
    } catch (error) {
      if (timedOut) throw new AgentRunError('TIMEOUT', '任务运行超时。')
      if (options.signal?.aborted) throw new AgentRunError('CANCELLED', '任务已取消。')
      if (error instanceof AgentRunError) throw error
      throw new AgentRunError('RUNTIME_ERROR', error instanceof Error ? error.message : '本地运行时发生未知错误。')
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', cancel)
    }
  }
}

export const MOCK_OPPORTUNITIES: Opportunity[] = [
  {
    id: 'opp-lingang-001', title: '临港科创园二期机电安装工程', companyId: 'company-lingang-001', companyName: '东部临港建设发展有限公司',
    amountWan: 3200, locationAddress: '上海市浦东新区临港新片区', distanceKm: 8.6, deadline: '2026-10-18', matchScore: 92, projectType: '产业园区',
    reason: '立项、用地手续与同类项目采购周期形成交叉信号，专业方向与企业画像高度匹配。',
    evidenceIds: ['ev-001', 'ev-002'], followUpLevel: '重点跟进', confidence: '高',
    timelineEvidence: [
      { evidenceId: 'timeline-lingang-01', stageId: 'initiation', occurredAt: '2026-06-18', title: '项目立项批复已公开', source: '发展改革部门（演示）' },
      { evidenceId: 'timeline-lingang-02', stageId: 'intention', occurredAt: '2026-08-21', title: '年度采购意向已公开', source: '地方政府采购网（演示）' },
    ],
  },
  {
    id: 'opp-hospital-002', title: '区人民医院综合楼改扩建项目', companyId: 'company-hospital-002', companyName: '江宁区卫生健康建设中心',
    amountWan: 8600, locationAddress: '南京市江宁区', distanceKm: 19.3, deadline: '2026-11-06', matchScore: 84, projectType: '医疗建筑',
    reason: '专项债与医疗补短板政策形成中期支持，施工窗口和分标方式仍需核验。',
    evidenceIds: ['ev-003', 'ev-004'], followUpLevel: '值得验证', confidence: '中',
    timelineEvidence: [
      { evidenceId: 'timeline-hospital-01', stageId: 'initiation', occurredAt: '2026-05-12', title: '改扩建项目建议书已批复', source: '发展改革部门（演示）' },
      { evidenceId: 'timeline-hospital-02', stageId: 'intention', occurredAt: '2026-07-03', title: '医疗专项采购意向已公开', source: '政府采购网（演示）' },
      { evidenceId: 'timeline-hospital-03', stageId: 'tender', occurredAt: '2026-08-02', title: '综合楼施工招标公告已公开', source: '公共资源交易平台（演示）' },
      { evidenceId: 'timeline-hospital-04', stageId: 'award', occurredAt: '2026-09-01', title: '中标结果公告已公开', source: '公共资源交易平台（演示）' },
    ],
  },
  {
    id: 'opp-logistics-003', title: '物流园消防系统年度改造线索', companyId: 'company-logistics-003', companyName: '高新区产业投资集团',
    amountWan: 1900, locationAddress: '嘉兴市高新区', distanceKm: 27.4, deadline: '2026-11-28', matchScore: 76, projectType: '工程改造',
    reason: '历史合同到期与公开采购计划一致，但正式采购节点尚未出现，适合低成本观察。',
    evidenceIds: ['ev-005'], followUpLevel: '持续观察', confidence: '中低', timelineEvidence: [],
  },
]

export class MockAgentBackend implements AgentBackend {
  readonly name = '本地演示引擎'

  constructor(private readonly delayMs = 520) {}

  async execute(task: AgentTask, context: AgentExecutionContext): Promise<AgentRunResult> {
    context.onEvent?.({ taskId: task.id, type: 'status', message: '正在结构化条件，并组合本地演示证据…' })
    await abortableDelay(this.delayMs, context.signal)
    const { criteria } = task

    const opportunities = MOCK_OPPORTUNITIES.filter((item) =>
      item.amountWan !== null && item.amountWan >= criteria.amountMin
      && item.amountWan <= criteria.amountMax
      && item.distanceKm !== null && item.distanceKm <= criteria.radiusKm
      && (criteria.projectType === '不限' || item.projectType === criteria.projectType)
      && matchesProjectStage(item.timelineEvidence, criteria.targetStageId)).slice(0, criteria.candidateLimit)
    context.onEvent?.({ taskId: task.id, type: 'result', message: `条件已锁定。找到 ${opportunities.length} 个有证据的演示候选。` })
    return { taskId: task.id, backend: this.name, completedAt: new Date().toISOString(), opportunities }
  }
}
