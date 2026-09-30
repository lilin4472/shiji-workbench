import {
  assertAgentRunResult,
  type AgentRunEvent,
  type AgentRunResponse,
  type AgentTask,
} from '../shared/agent-contract'
import {
  AgentRunError,
  type AgentRunnerPort,
  type AgentRunOptions,
} from '../shared/agent-runtime'

export { AgentRunError, AgentRunner, MOCK_OPPORTUNITIES, MockAgentBackend } from '../shared/agent-runtime'
export type { AgentRunnerPort, AgentRunOptions } from '../shared/agent-runtime'

class DesktopAgentRunner implements AgentRunnerPort {
  readonly name = '识机本地运行时'

  async run(task: AgentTask, options: AgentRunOptions = {}) {
    const desktop = window.shijiDesktop
    if (!desktop) throw new AgentRunError('RUNTIME_ERROR', '桌面运行时不可用。')

    const removeListener = desktop.agent.onEvent((event: AgentRunEvent) => {
      if (event.taskId === task.id) options.onEvent?.(event)
    })
    const cancel = () => { void desktop.agent.cancel(task.id) }
    options.signal?.addEventListener('abort', cancel, { once: true })

    try {
      const response: AgentRunResponse = await desktop.agent.run(task, options.timeoutMs)
      if (!response.ok) throw new AgentRunError(response.error.code, response.error.message)
      assertAgentRunResult(response.result)
      return response.result
    } catch (error) {
      if (error instanceof AgentRunError) throw error
      throw new AgentRunError('RUNTIME_ERROR', error instanceof Error ? error.message : '桌面运行时调用失败。')
    } finally {
      removeListener()
      options.signal?.removeEventListener('abort', cancel)
    }
  }
}

export function createAgentRunner(): AgentRunnerPort {
  if (window.shijiDesktop) return new DesktopAgentRunner()
  return {
    name: '桌面运行时不可用',
    async run() {
      throw new AgentRunError('RUNTIME_ERROR', '当前只是浏览器界面预览，不能运行真实任务。请从桌面启动识机。')
    },
  }
}
