import type { AgentTask } from '../shared/agent-contract.js'
import type { SearchPort, SearchResult } from '../shared/search-contract.js'
import type { UserSearchProviderId } from '../shared/search-preference.js'
import { buildDiscoveryStageSearchPlan, buildNearbyEnterpriseSearchPlan } from '../shared/stage-search-plan.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import { prepareOpportunitySources, type OpportunityDocumentReader } from './opportunity-source-preparer.js'
import { opportunityRetrievalLimit } from '../shared/opportunity-request.js'

export type OpportunityDiscoveryService = (task: AgentTask) => Promise<SearchResult>

export function createOpportunityDiscoveryService(
  search: SearchPort,
  getDefaultProvider: () => Promise<UserSearchProviderId>,
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
): OpportunityDiscoveryService {
  return async (task) => {
    const provider = task.searchProvider ?? await getDefaultProvider()
    const plan = task.kind === 'nearby-enterprise-search'
      ? buildNearbyEnterpriseSearchPlan(task.criteria)
      : buildDiscoveryStageSearchPlan(task.criteria)
    const purpose = task.kind === 'nearby-enterprise-search' ? 'nearby-enterprise'
      : task.kind === 'deep-radar-search' ? 'deep-radar'
        : 'opportunity-discovery'
    const retrievalLimit = opportunityRetrievalLimit(task.prompt, task.criteria.candidateLimit, task.requestedCount)
    const result = await search({ provider, purpose, query: task.searchQuery || plan.query, maxResults: retrievalLimit })
    return prepareOpportunitySources(result, plan.targetStageId, readDocument, {
      targetCompanyName: task.criteria.targetCompanyName,
      targetProjectName: task.criteria.targetProjectName,
      // Nearby enterprise discovery represents actual projects on the map.
      // An identifiable company or institution alone must not become a project card.
      requireConcreteOpportunityEvidence: task.kind === 'nearby-enterprise-search',
      // An explicit “N projects” request widens the evidence pool (one search
      // call, no extra model call) so invalid snippets do not consume the whole
      // requested result set. The body reader still has a bounded per-task cap.
      maxExternalReads: retrievalLimit,
    })
  }
}
