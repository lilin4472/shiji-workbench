export type AgentBackendId = 'mock' | 'dsh'

/** Product-owned model pin. Keep vendor model churn out of feature code. */
export const DSH_DEFAULT_MODEL = 'deepseek-v4-flash' as const

export interface AgentBackendOptionStatus {
  id: AgentBackendId
  label: string
  available: boolean
  reason?: string
}

export interface AgentBackendStatus {
  selected: AgentBackendId
  options: AgentBackendOptionStatus[]
}

export interface DshModelSmokeTestResult {
  connected: true
  model: typeof DSH_DEFAULT_MODEL
  maxOutputTokens: number
  checkedAt: string
}

export type DshModelSmokeTestResponse =
  | { ok: true; value: DshModelSmokeTestResult }
  | { ok: false; message: string }

export type AgentBackendResponse =
  | { ok: true; value: AgentBackendStatus }
  | { ok: false; message: string; value: AgentBackendStatus }
