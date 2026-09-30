// 获客模型循环的提示词入口（2026-09-18 v3）：只负责把 DSH 传回来的 payload 转成获客循环提示词。
// 提示词本体在 shared/agent-loop.ts 的 buildLeadLoopPrompt（与公开风险共用"模型主导 + 逐字校验"的框架）。
import type { AgentTask } from '../shared/agent-contract.js'
import { buildLeadLoopPrompt, type LoopEvidenceItem } from '../shared/agent-loop.js'

export interface LeadPlanPayload {
  companyName: string
  ownerName: string
  projectTitle: string
  step: number
  maxSteps: number
  missing: string[]
  known: string[]
  evidence: LoopEvidenceItem[]
  history: string[]
  final: boolean
}

export function buildLeadPlanPrompt(task: AgentTask): string {
  const fallback = '请仅回复：{"tool":"submit"}'
  const raw = (task as { searchQuery?: unknown }).searchQuery
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return fallback
  let payload: LeadPlanPayload
  try {
    payload = JSON.parse(raw) as LeadPlanPayload
  } catch {
    return fallback
  }
  return buildLeadLoopPrompt({
    companyName: String(payload.companyName ?? ''),
    ownerName: String(payload.ownerName ?? ''),
    projectTitle: String(payload.projectTitle ?? ''),
    step: Number(payload.step) || 1,
    maxSteps: Number(payload.maxSteps) || 2,
    missing: Array.isArray(payload.missing) ? payload.missing.map(String) : [],
    known: Array.isArray(payload.known) ? payload.known.map(String) : [],
    evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
    history: Array.isArray(payload.history) ? payload.history.map(String) : [],
    final: payload.final === true,
  })
}
