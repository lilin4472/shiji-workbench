/// <reference types="vite/client" />

import type { AgentRunEvent, AgentRunResponse, AgentTask } from '../shared/agent-contract'
import type { AgentBackendId, AgentBackendResponse, AgentBackendStatus, DshModelSmokeTestResponse } from '../shared/agent-backend-contract'
import type { BusinessCreditDiscoveryResponse } from '../shared/business-credit-report'
import type { CredentialResponse, DeepSeekConnectionResult, DeepSeekCredentialStatus, DoubaoConnectionResult, DoubaoCredentialStatus, TiandituMapPoint, TiandituPoiQuery, TiandituPoiSearchValue, TiandituServerConnectionResult, TiandituServerCredentialStatus, TiandituWebConnectionResult, TiandituWebCredentialStatus, TiandituWebKeyResult } from '../shared/credential-contract'
import type { LocalEvidenceImportResponse, LocalEvidenceListResponse, LocalEvidenceTextResponse } from '../shared/evidence-contract'
import type { ProjectTimelineDiscoveryRequest, ProjectTimelineDiscoveryResponse } from '../shared/project-timeline-discovery'
import type { PolicyChainRequest, PolicyChainResponse } from '../shared/policy-chain'
import type { IndustryChainRequest, IndustryChainResponse } from '../shared/industry-chain'
import type { CreditRiskRequest, CreditRiskResponse } from '../shared/credit-risk'
import type { LeadRequest, LeadResponse } from '../shared/lead-contacts'
import type { SearchRequest, SearchResponse } from '../shared/search-contract'
import type { SearchPreferenceResponse, UserSearchProviderId } from '../shared/search-preference'
import type { OfflineLicenseStatus } from '../shared/license-contract'

declare global {
  interface Window {
    shijiDesktop?: {
      platform: string
      version: string
      contractVersion: number
      mockEnabled: boolean
      license: {
        status(): Promise<{ ok: true; value: OfflineLicenseStatus } | { ok: false; message: string }>
        activate(code: string): Promise<{ ok: true; value: OfflineLicenseStatus } | { ok: false; message: string }>
      }
      debug: {
        log(message: string): void
      }
      agent: {
        run(task: AgentTask, timeoutMs?: number): Promise<AgentRunResponse>
        cancel(taskId: string): Promise<boolean>
        backendStatus(): Promise<AgentBackendStatus>
        selectBackend(backendId: AgentBackendId): Promise<AgentBackendResponse>
        testDshModel(): Promise<DshModelSmokeTestResponse>
        onEvent(listener: (event: AgentRunEvent) => void): () => void
      }
      credentials: {
        status(): Promise<CredentialResponse<DeepSeekCredentialStatus>>
        saveDeepSeek(apiKey: string): Promise<CredentialResponse<DeepSeekCredentialStatus>>
        testDeepSeek(): Promise<CredentialResponse<DeepSeekConnectionResult>>
        deleteDeepSeek(): Promise<CredentialResponse<DeepSeekCredentialStatus>>
        doubaoStatus(): Promise<CredentialResponse<DoubaoCredentialStatus>>
        saveDoubao(apiKey: string): Promise<CredentialResponse<DoubaoCredentialStatus>>
        testDoubao(): Promise<CredentialResponse<DoubaoConnectionResult>>
        deleteDoubao(): Promise<CredentialResponse<DoubaoCredentialStatus>>
        tiandituServerStatus(): Promise<CredentialResponse<TiandituServerCredentialStatus>>
        saveTiandituServer(apiKey: string): Promise<CredentialResponse<TiandituServerCredentialStatus>>
        testTiandituServer(): Promise<CredentialResponse<TiandituServerConnectionResult>>
        deleteTiandituServer(): Promise<CredentialResponse<TiandituServerCredentialStatus>>
        tiandituWebStatus(): Promise<CredentialResponse<TiandituWebCredentialStatus>>
        saveTiandituWeb(apiKey: string): Promise<CredentialResponse<TiandituWebCredentialStatus>>
        readTiandituWeb(): Promise<CredentialResponse<TiandituWebKeyResult>>
        testTiandituWeb(): Promise<CredentialResponse<TiandituWebConnectionResult>>
        deleteTiandituWeb(): Promise<CredentialResponse<TiandituWebCredentialStatus>>
        geocodeTianditu(address: string): Promise<CredentialResponse<TiandituMapPoint>>
        searchTiandituPoi(query: TiandituPoiQuery): Promise<CredentialResponse<TiandituPoiSearchValue>>
      }
      search: {
        run(request: SearchRequest): Promise<SearchResponse>
        getPreference(): Promise<SearchPreferenceResponse>
        setDefaultProvider(provider: UserSearchProviderId): Promise<SearchPreferenceResponse>
        discoverBusinessCredit(subjectName: string, provider?: UserSearchProviderId, focus?: string): Promise<BusinessCreditDiscoveryResponse>
        discoverProjectTimeline(request: ProjectTimelineDiscoveryRequest): Promise<ProjectTimelineDiscoveryResponse>
        runPolicyChain(request: PolicyChainRequest): Promise<PolicyChainResponse>
        runIndustryChain(request: IndustryChainRequest): Promise<IndustryChainResponse>
        runCreditRisk(request: CreditRiskRequest): Promise<CreditRiskResponse>
  runLeads(request: LeadRequest): Promise<LeadResponse>
      }
      evidence: {
        import(subjectName: string): Promise<LocalEvidenceImportResponse>
        list(subjectName?: string): Promise<LocalEvidenceListResponse>
        readText(recordId: string): Promise<LocalEvidenceTextResponse>
      }
    }
  }
}

export {}
