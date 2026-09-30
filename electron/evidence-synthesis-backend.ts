// 归纳通道的提示词构造器：把"证据表 + 任务说明"变成 DSH 会话的提示词。
//
// 为什么要这么绕：DSH 执行器（createControllerDshTaskExecutor）要求一个
// `(task: AgentTask) => string` 的提示词构造器，而 AgentTask 是三种搜索任务的封闭联合。
// 所以我们把归纳输入序列化进 `searchQuery`（string 字段）里传递，构造器再解回来——
// 这样**完全不改 AgentTask 联合类型、不动现有三种搜索任务**。
import type { AgentTask } from '../shared/agent-contract.js'
import type { EvidenceItem } from '../shared/evidence-synthesis.js'
import { buildCreditRiskSynthesisPrompt } from '../shared/evidence-synthesis.js'
import type { LoopEvidenceItem } from '../shared/agent-loop.js'
import { buildLoopPrompt } from '../shared/agent-loop.js'

export interface EvidenceSynthesisPayload {
  scope: 'credit-risk'
  subject: string
  subjectType?: string
  evidence: EvidenceItem[]
}

export function serializeSynthesisPayload(payload: EvidenceSynthesisPayload): string {
  return JSON.stringify(payload)
}

export function parseSynthesisPayload(task: AgentTask): EvidenceSynthesisPayload | undefined {
  const raw = (task as { searchQuery?: unknown }).searchQuery
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return undefined
  try {
    const value = JSON.parse(raw) as Partial<EvidenceSynthesisPayload>
    if (typeof value.subject !== 'string' || !Array.isArray(value.evidence)) return undefined
    return {
      scope: 'credit-risk',
      subject: value.subject,
      ...(typeof value.subjectType === 'string' ? { subjectType: value.subjectType } : {}),
      evidence: value.evidence as EvidenceItem[],
    }
  } catch {
    return undefined
  }
}

/** 传给 createControllerDshTaskExecutor 的构造器：只输出归纳提示词，不掺任何知识。 */
export function buildEvidenceSynthesisPrompt(task: AgentTask): string {
  const payload = parseSynthesisPayload(task)
  if (!payload) return '请仅回复：{"events":[],"verifications":[],"assessment":""}'
  return buildCreditRiskSynthesisPrompt(payload.subject, payload.subjectType ?? '未知', payload.evidence)
}

// ── Agent Loop 节点（2026-09-16）：一次调用跑"一轮"，返回模型的动作 JSON ──────────
export interface LoopStepPayload {
  goal: string
  subject: string
  subjectType: string
  step: number
  evidence: LoopEvidenceItem[]
  history: string[]
  /** 最后一轮：模型必须用 submit 收口，拿不到的原被告/判项/金额写进 openQuestions。 */
  final?: boolean
}

export function buildAgentLoopStepPrompt(task: AgentTask): string {
  const raw = (task as { searchQuery?: unknown }).searchQuery
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) {
    return '请仅回复：{"tool":"submit","report":{"events":[],"inferences":[],"openQuestions":["缺少输入"],"assessment":""}}'
  }
  try {
    const payload = JSON.parse(raw) as LoopStepPayload
    return buildLoopPrompt({
      goal: payload.goal,
      subject: payload.subject,
      subjectType: payload.subjectType ?? '未知',
      step: Number(payload.step) || 1,
      evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
      history: Array.isArray(payload.history) ? payload.history : [],
      final: payload.final === true,
    })
  } catch {
    return '请仅回复：{"tool":"submit","report":{"events":[],"inferences":[],"openQuestions":["输入解析失败"],"assessment":""}}'
  }
}