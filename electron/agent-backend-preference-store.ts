import type { AgentBackendId } from '../shared/agent-backend-contract.js'

export interface AgentBackendPreferenceFileIO {
  read(): Promise<string | undefined>
  write(content: string): Promise<void>
}

export class AgentBackendPreferenceStore {
  constructor(private readonly fileIO: AgentBackendPreferenceFileIO) {}

  async get(): Promise<AgentBackendId> {
    const raw = await this.fileIO.read()
    if (raw === undefined) return 'dsh'
    try {
      const value: unknown = JSON.parse(raw)
      if (!isRecord(value) || value.version !== 1 || (value.selected !== 'mock' && value.selected !== 'dsh')) throw new Error('invalid')
      return value.selected
    } catch {
      throw new Error('本地任务后端偏好文件损坏，请重新选择运行后端。')
    }
  }

  async set(selected: AgentBackendId): Promise<void> {
    if (selected !== 'mock' && selected !== 'dsh') throw new Error('任务运行后端参数无效。')
    await this.fileIO.write(JSON.stringify({ version: 1, selected }, null, 2))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
