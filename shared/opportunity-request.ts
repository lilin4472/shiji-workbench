import type { CandidateLimit } from './agent-contract.js'
import type { SearchResultLimit } from './search-contract.js'

/**
 * A free-text request may ask for fewer than the three UI batch presets.
 * Keep the persisted candidateLimit as the safety ceiling, but honor an
 * explicit count for this run so “找 2 个项目” does not become “最多 5 个”.
 */
export function requestedOpportunityCount(_prompt: string, fallback: CandidateLimit, interpretedCount?: number): number {
  if (interpretedCount === undefined || !Number.isInteger(interpretedCount)) return fallback
  return Math.min(20, Math.max(1, interpretedCount))
}

/**
 * Retrieve a wider evidence pool when the user explicitly asks for a count.
 * One Doubao call still serves the task; the wider pool only lets deterministic
 * body/amount/stage gates find enough real projects instead of stopping at the
 * first five snippets. The API contract remains 5/10/20.
 */
export function opportunityRetrievalLimit(prompt: string, candidateLimit: CandidateLimit, interpretedCount?: number): SearchResultLimit {
  const requested = requestedOpportunityCount(prompt, candidateLimit, interpretedCount)
  const explicit = interpretedCount !== undefined
  if (!explicit) return candidateLimit
  const wanted = Math.max(candidateLimit, requested * 4)
  if (wanted <= 5) return 5
  if (wanted <= 10) return 10
  return 20
}
