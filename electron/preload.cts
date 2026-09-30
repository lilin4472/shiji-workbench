import { contextBridge, ipcRenderer } from 'electron'
import type { AgentRunEvent, AgentRunResponse, AgentTask } from '../shared/agent-contract.js'
import type { AgentBackendId, AgentBackendResponse, AgentBackendStatus, DshModelSmokeTestResponse } from '../shared/agent-backend-contract.js'
import type { BusinessCreditDiscoveryResponse } from '../shared/business-credit-report.js'
import type { CredentialResponse, DeepSeekConnectionResult, DeepSeekCredentialStatus, DoubaoConnectionResult, DoubaoCredentialStatus, TiandituMapPoint, TiandituPoiQuery, TiandituPoiSearchValue, TiandituServerConnectionResult, TiandituServerCredentialStatus, TiandituWebConnectionResult, TiandituWebCredentialStatus, TiandituWebKeyResult } from '../shared/credential-contract.js'
import type { LocalEvidenceImportResponse, LocalEvidenceListResponse, LocalEvidenceTextResponse } from '../shared/evidence-contract.js'
import type { ProjectTimelineDiscoveryRequest, ProjectTimelineDiscoveryResponse } from '../shared/project-timeline-discovery.js'
import type { PolicyChainRequest, PolicyChainResponse } from '../shared/policy-chain.js'
import type { IndustryChainRequest, IndustryChainResponse } from '../shared/industry-chain.js'
import type { CreditRiskRequest, CreditRiskResponse } from '../shared/credit-risk.js'
import type { LeadRequest, LeadResponse } from '../shared/lead-contacts.js'
import type { SearchRequest, SearchResponse } from '../shared/search-contract.js'
import type { SearchPreferenceResponse, UserSearchProviderId } from '../shared/search-preference.js'
import type { OfflineLicenseStatus } from '../shared/license-contract.js'

function argumentValue(name: string, fallback: string): string {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback
}

contextBridge.exposeInMainWorld('shijiDesktop', {
  platform: process.platform,
  version: argumentValue('shiji-version', 'unknown'),
  contractVersion: Number(argumentValue('shiji-contract-version', '0')),
  mockEnabled: argumentValue('shiji-mock-enabled', '0') === '1',
  license: {
    status: (): Promise<{ ok: true; value: OfflineLicenseStatus } | { ok: false; message: string }> => ipcRenderer.invoke('shiji:license-status'),
    activate: (code: string): Promise<{ ok: true; value: OfflineLicenseStatus } | { ok: false; message: string }> => ipcRenderer.invoke('shiji:license-activate', code),
  },
    debug: {
      log: (message: string): void => ipcRenderer.send('shiji:renderer-log', message),
    },
  agent: {
    run: (task: AgentTask, timeoutMs?: number): Promise<AgentRunResponse> => ipcRenderer.invoke('shiji:agent-run', task, timeoutMs),
    cancel: (taskId: string): Promise<boolean> => ipcRenderer.invoke('shiji:agent-cancel', taskId),
    backendStatus: (): Promise<AgentBackendStatus> => ipcRenderer.invoke('shiji:agent-backend-status'),
    selectBackend: (backendId: AgentBackendId): Promise<AgentBackendResponse> => ipcRenderer.invoke('shiji:agent-backend-select', backendId),
    testDshModel: (): Promise<DshModelSmokeTestResponse> => ipcRenderer.invoke('shiji:agent-dsh-model-test'),
    onEvent: (listener: (event: AgentRunEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agentEvent: AgentRunEvent) => listener(agentEvent)
      ipcRenderer.on('shiji:agent-event', handler)
      return () => ipcRenderer.removeListener('shiji:agent-event', handler)
    },
  },
  credentials: {
    status: (): Promise<CredentialResponse<DeepSeekCredentialStatus>> => ipcRenderer.invoke('shiji:credential-status'),
    saveDeepSeek: (apiKey: string): Promise<CredentialResponse<DeepSeekCredentialStatus>> => ipcRenderer.invoke('shiji:credential-save-deepseek', apiKey),
    testDeepSeek: (): Promise<CredentialResponse<DeepSeekConnectionResult>> => ipcRenderer.invoke('shiji:credential-test-deepseek'),
    deleteDeepSeek: (): Promise<CredentialResponse<DeepSeekCredentialStatus>> => ipcRenderer.invoke('shiji:credential-delete-deepseek'),
    doubaoStatus: (): Promise<CredentialResponse<DoubaoCredentialStatus>> => ipcRenderer.invoke('shiji:credential-status-doubao'),
    saveDoubao: (apiKey: string): Promise<CredentialResponse<DoubaoCredentialStatus>> => ipcRenderer.invoke('shiji:credential-save-doubao', apiKey),
    testDoubao: (): Promise<CredentialResponse<DoubaoConnectionResult>> => ipcRenderer.invoke('shiji:credential-test-doubao'),
    deleteDoubao: (): Promise<CredentialResponse<DoubaoCredentialStatus>> => ipcRenderer.invoke('shiji:credential-delete-doubao'),
    tiandituServerStatus: (): Promise<CredentialResponse<TiandituServerCredentialStatus>> => ipcRenderer.invoke('shiji:credential-status-tianditu-server'),
    saveTiandituServer: (apiKey: string): Promise<CredentialResponse<TiandituServerCredentialStatus>> => ipcRenderer.invoke('shiji:credential-save-tianditu-server', apiKey),
    testTiandituServer: (): Promise<CredentialResponse<TiandituServerConnectionResult>> => ipcRenderer.invoke('shiji:credential-test-tianditu-server'),
    deleteTiandituServer: (): Promise<CredentialResponse<TiandituServerCredentialStatus>> => ipcRenderer.invoke('shiji:credential-delete-tianditu-server'),
    tiandituWebStatus: (): Promise<CredentialResponse<TiandituWebCredentialStatus>> => ipcRenderer.invoke('shiji:credential-status-tianditu-web'),
    saveTiandituWeb: (apiKey: string): Promise<CredentialResponse<TiandituWebCredentialStatus>> => ipcRenderer.invoke('shiji:credential-save-tianditu-web', apiKey),
    readTiandituWeb: (): Promise<CredentialResponse<TiandituWebKeyResult>> => ipcRenderer.invoke('shiji:credential-read-tianditu-web'),
    testTiandituWeb: (): Promise<CredentialResponse<TiandituWebConnectionResult>> => ipcRenderer.invoke('shiji:credential-test-tianditu-web'),
    deleteTiandituWeb: (): Promise<CredentialResponse<TiandituWebCredentialStatus>> => ipcRenderer.invoke('shiji:credential-delete-tianditu-web'),
    geocodeTianditu: (address: string): Promise<CredentialResponse<TiandituMapPoint>> => ipcRenderer.invoke('shiji:tianditu-geocode', address),
    searchTiandituPoi: (query: TiandituPoiQuery): Promise<CredentialResponse<TiandituPoiSearchValue>> => ipcRenderer.invoke('shiji:tianditu-poi-search', query),
  },
  search: {
    run: (request: SearchRequest): Promise<SearchResponse> => ipcRenderer.invoke('shiji:search-run', request),
    getPreference: (): Promise<SearchPreferenceResponse> => ipcRenderer.invoke('shiji:search-preference-get'),
    setDefaultProvider: (provider: UserSearchProviderId): Promise<SearchPreferenceResponse> => ipcRenderer.invoke('shiji:search-preference-set', provider),
    discoverBusinessCredit: (subjectName: string, provider?: UserSearchProviderId, focus?: string): Promise<BusinessCreditDiscoveryResponse> => ipcRenderer.invoke('shiji:business-credit-discover', subjectName, provider, focus),
    discoverProjectTimeline: (request: ProjectTimelineDiscoveryRequest): Promise<ProjectTimelineDiscoveryResponse> => ipcRenderer.invoke('shiji:project-timeline-discover', request),
    runPolicyChain: (request: PolicyChainRequest): Promise<PolicyChainResponse> => ipcRenderer.invoke('shiji:policy-chain-run', request),
    runIndustryChain: (request: IndustryChainRequest): Promise<IndustryChainResponse> => ipcRenderer.invoke('shiji:industry-chain-run', request),
    runCreditRisk: (request: CreditRiskRequest): Promise<CreditRiskResponse> => ipcRenderer.invoke('shiji:credit-risk-run', request),
    runLeads: (request: LeadRequest): Promise<LeadResponse> => ipcRenderer.invoke('shiji:lead-run', request),
  },
  evidence: {
    import: (subjectName: string): Promise<LocalEvidenceImportResponse> => ipcRenderer.invoke('shiji:evidence-import', subjectName),
    list: (subjectName?: string): Promise<LocalEvidenceListResponse> => ipcRenderer.invoke('shiji:evidence-list', subjectName),
    readText: (recordId: string): Promise<LocalEvidenceTextResponse> => ipcRenderer.invoke('shiji:evidence-read-text', recordId),
  },
})
