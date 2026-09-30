import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAgentTask, type AgentErrorPayload, type AgentRunResponse } from '../shared/agent-contract.js'
import { parseLoopAction } from '../shared/agent-loop.js'
import { DESKTOP_CONTRACT_VERSION } from '../shared/desktop-contract.js'
import { isGeoPoint } from '../shared/geography.js'
import type { AgentBackendId, AgentBackendResponse, AgentBackendStatus } from '../shared/agent-backend-contract.js'
import type { BusinessCreditDiscoveryResponse } from '../shared/business-credit-report.js'
import type { CredentialResponse, DeepSeekConnectionResult, DeepSeekCredentialStatus, DoubaoConnectionResult, DoubaoCredentialStatus, TiandituMapPoint, TiandituPoiSearchValue, TiandituServerConnectionResult, TiandituServerCredentialStatus, TiandituWebConnectionResult, TiandituWebCredentialStatus, TiandituWebKeyResult } from '../shared/credential-contract.js'
import { assertProjectTimelineDiscoveryRequest, type ProjectTimelineDiscoveryResponse } from '../shared/project-timeline-discovery.js'
import { assertPolicyChainRequest, type PolicyChainResponse } from '../shared/policy-chain.js'
import { assertIndustryChainRequest, type IndustryChainResponse } from '../shared/industry-chain.js'
import { assertCreditRiskRequest, type CreditRiskResponse } from '../shared/credit-risk.js'
import { assertLeadRequest, LEAD_KIND_LABELS, LEAD_SUPPLEMENT_ROUNDS, type LeadContactKind, type LeadResponse } from '../shared/lead-contacts.js'
import type { SearchResponse } from '../shared/search-contract.js'
import { assertUserSearchProvider, type SearchPreferenceResponse, type UserSearchProviderId } from '../shared/search-preference.js'
import { AgentRunError, AgentRunner, MockAgentBackend, type AgentRunnerPort } from '../shared/agent-runtime.js'
import { AgentBackendManager } from './agent-backend-manager.js'
import { AgentBackendPreferenceStore } from './agent-backend-preference-store.js'
import { createBusinessCreditDiscoveryService } from './business-credit-service.js'
import { CredentialStore } from './credential-store.js'
import { testDeepSeekConnection } from './deepseek-connection.js'
import { createDoubaoPort, testDoubaoConnection } from './doubao-provider.js'
import { EvidenceVault } from './evidence-vault.js'
import { installedDshPackageRoot, prepareInstalledDshBackend } from './installed-dsh-backend.js'
import { DSH_PACKAGED_RELEASE_LOCK, DSH_RELEASE_LOCK } from './dsh-release-lock.js'
import { createOpportunityDiscoveryService } from './opportunity-discovery-service.js'
import { createProjectTimelineDiscoveryService } from './project-timeline-service.js'
import { createPolicyChainService } from './policy-chain-service.js'
import { createIndustryChainService } from './industry-chain-service.js'
import { createCreditRiskService } from './credit-risk-service.js'
import { createLeadService } from './lead-service.js'
import type { EvidenceSynthesisPayload, LoopStepPayload } from './evidence-synthesis-backend.js'
import type { LeadPlanPayload } from './lead-plan-prompt.js'

/** 归纳通道（DSH 就绪后注入）：公开风险/政策预测共用的模型归纳入口。 */
let evidenceSynthesis: ((payload: EvidenceSynthesisPayload) => Promise<string>) | undefined
let agentLoopStep: ((payload: LoopStepPayload) => Promise<string>) | undefined
let leadPlanStep: ((payload: LeadPlanPayload) => Promise<string>) | undefined
import { SearchManager } from './search-manager.js'
import { SearchPreferenceStore } from './search-preference-store.js'
import { SearchCache, createCachedSearchPort } from './search-cache.js'
import { testTiandituServerConnection, testTiandituWebConnection } from './tianditu-connection.js'
import { createTiandituGeocoder, TiandituGeocodeCache, type TiandituGeocodePort } from './tianditu-geocoder.js'
import { createTiandituPoiSearchPort, type TiandituPoiSearchPort } from './tianditu-poi-service.js'
import { createNearbyOpportunityLocator } from './nearby-opportunity-locator.js'
import { OfflineLicenseStore, getWindowsDeviceCode } from './offline-license.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const activeAgentRuns = new Map<string, AbortController>()
const mockEnabled = process.env.SHIJI_ENABLE_MOCK === '1'
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let windowEntry: 'app' | 'license' = 'app'

function toErrorPayload(error: unknown): AgentErrorPayload {
  if (error instanceof AgentRunError) return { code: error.code, message: error.message }
  return { code: 'RUNTIME_ERROR', message: error instanceof Error ? error.message : '本地运行时发生未知错误。' }
}

function registerAgentIpc(agentRunner: AgentRunnerPort, backendManager: AgentBackendManager) {
  ipcMain.handle('shiji:agent-run', async (event, taskValue: unknown, timeoutMs?: number): Promise<AgentRunResponse> => {
    try {
      assertAgentTask(taskValue)
    } catch (error) {
      return { ok: false, error: { code: 'INVALID_TASK', message: error instanceof Error ? error.message : '任务参数无效。' } }
    }

    if (activeAgentRuns.has(taskValue.id)) {
      return { ok: false, error: { code: 'RUNTIME_ERROR', message: '该任务正在运行，请勿重复提交。' } }
    }

    const controller = new AbortController()
    activeAgentRuns.set(taskValue.id, controller)
    try {
      const result = await agentRunner.run(taskValue, {
        signal: controller.signal,
        timeoutMs,
        onEvent: (agentEvent) => {
          if (!event.sender.isDestroyed()) event.sender.send('shiji:agent-event', agentEvent)
        },
      })
      return { ok: true, result }
    } catch (error) {
      const payload = toErrorPayload(error)
      if (!event.sender.isDestroyed()) {
        event.sender.send('shiji:agent-event', { taskId: taskValue.id, type: 'error', message: payload.message })
      }
      return { ok: false, error: payload }
    } finally {
      activeAgentRuns.delete(taskValue.id)
    }
  })

  ipcMain.handle('shiji:agent-cancel', (_event, taskId: unknown) => {
    if (typeof taskId !== 'string') return false
    const controller = activeAgentRuns.get(taskId)
    if (!controller) return false
    controller.abort()
    return true
  })

  ipcMain.handle('shiji:agent-backend-status', (): Promise<AgentBackendStatus> => backendManager.status())
  ipcMain.handle('shiji:agent-backend-select', (_event, backendId: unknown): Promise<AgentBackendResponse> => {
    if (backendId !== 'mock' && backendId !== 'dsh') {
      return backendManager.status().then(value => ({ ok: false, message: '运行后端参数无效。', value }))
    }
    return backendManager.select(backendId as AgentBackendId)
  })
  ipcMain.handle('shiji:agent-dsh-model-test', () => backendManager.testDshModel())
}

function credentialFailure(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : '本地凭据操作失败。' }
}

function registerCredentialIpc(store: CredentialStore) {
  ipcMain.handle('shiji:credential-status', async (): Promise<CredentialResponse<DeepSeekCredentialStatus>> => {
    try {
      return { ok: true, value: await store.getDeepSeekStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-save-deepseek', async (_event, apiKey: unknown): Promise<CredentialResponse<DeepSeekCredentialStatus>> => {
    if (typeof apiKey !== 'string') return { ok: false, message: 'DeepSeek Key 参数无效。' }
    try {
      await store.saveDeepSeekKey(apiKey)
      return { ok: true, value: await store.getDeepSeekStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-test-deepseek', async (): Promise<CredentialResponse<DeepSeekConnectionResult>> => {
    try {
      const apiKey = await store.readDeepSeekKey()
      if (!apiKey) return { ok: false, message: '请先保存 DeepSeek API Key。' }
      return { ok: true, value: await testDeepSeekConnection(apiKey) }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-delete-deepseek', async (): Promise<CredentialResponse<DeepSeekCredentialStatus>> => {
    try {
      await store.deleteDeepSeekKey()
      return { ok: true, value: await store.getDeepSeekStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-status-doubao', async (): Promise<CredentialResponse<DoubaoCredentialStatus>> => {
    try {
      return { ok: true, value: await store.getDoubaoStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-save-doubao', async (_event, apiKey: unknown): Promise<CredentialResponse<DoubaoCredentialStatus>> => {
    if (typeof apiKey !== 'string') return { ok: false, message: '豆包搜索 API Key 参数无效。' }
    try {
      await store.saveDoubaoKey(apiKey)
      return { ok: true, value: await store.getDoubaoStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-test-doubao', async (): Promise<CredentialResponse<DoubaoConnectionResult>> => {
    try {
      const apiKey = await store.readDoubaoKey()
      if (!apiKey) return { ok: false, message: '请先保存豆包搜索 API Key。' }
      return { ok: true, value: await testDoubaoConnection(apiKey) }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-delete-doubao', async (): Promise<CredentialResponse<DoubaoCredentialStatus>> => {
    try {
      await store.deleteDoubaoKey()
      return { ok: true, value: await store.getDoubaoStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-status-tianditu-server', async (): Promise<CredentialResponse<TiandituServerCredentialStatus>> => {
    try {
      return { ok: true, value: await store.getTiandituServerStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-save-tianditu-server', async (_event, apiKey: unknown): Promise<CredentialResponse<TiandituServerCredentialStatus>> => {
    if (typeof apiKey !== 'string') return { ok: false, message: '天地图服务端 Key 参数无效。' }
    try {
      await store.saveTiandituServerKey(apiKey)
      return { ok: true, value: await store.getTiandituServerStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-test-tianditu-server', async (): Promise<CredentialResponse<TiandituServerConnectionResult>> => {
    try {
      const apiKey = await store.readTiandituServerKey()
      if (!apiKey) return { ok: false, message: '请先保存天地图服务端 Key。' }
      return { ok: true, value: await testTiandituServerConnection(apiKey) }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-delete-tianditu-server', async (): Promise<CredentialResponse<TiandituServerCredentialStatus>> => {
    try {
      await store.deleteTiandituServerKey()
      return { ok: true, value: await store.getTiandituServerStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-status-tianditu-web', async (): Promise<CredentialResponse<TiandituWebCredentialStatus>> => {
    try {
      return { ok: true, value: await store.getTiandituWebStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-save-tianditu-web', async (_event, apiKey: unknown): Promise<CredentialResponse<TiandituWebCredentialStatus>> => {
    if (typeof apiKey !== 'string') return { ok: false, message: '天地图网页端 Key 参数无效。' }
    try {
      await store.saveTiandituWebKey(apiKey)
      return { ok: true, value: await store.getTiandituWebStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-read-tianditu-web', async (): Promise<CredentialResponse<TiandituWebKeyResult>> => {
    try {
      const apiKey = await store.readTiandituWebKey()
      return apiKey ? { ok: true, value: { apiKey } } : { ok: false, message: '请先保存天地图网页端 Key。' }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-test-tianditu-web', async (): Promise<CredentialResponse<TiandituWebConnectionResult>> => {
    try {
      const apiKey = await store.readTiandituWebKey()
      if (!apiKey) return { ok: false, message: '请先保存天地图网页端 Key。' }
      return { ok: true, value: await testTiandituWebConnection(apiKey) }
    } catch (error) {
      return credentialFailure(error)
    }
  })

  ipcMain.handle('shiji:credential-delete-tianditu-web', async (): Promise<CredentialResponse<TiandituWebCredentialStatus>> => {
    try {
      await store.deleteTiandituWebKey()
      return { ok: true, value: await store.getTiandituWebStatus() }
    } catch (error) {
      return credentialFailure(error)
    }
  })
}

function registerTiandituMapIpc(geocode: TiandituGeocodePort, poiSearch: TiandituPoiSearchPort) {
  ipcMain.handle('shiji:tianditu-geocode', async (_event, address: unknown): Promise<CredentialResponse<TiandituMapPoint>> => {
    if (typeof address !== 'string' || !address.trim()) return { ok: false, message: '地图中心地址为空。' }
    try {
      const point = await geocode(address)
      return { ok: true, value: { longitude: point.longitude, latitude: point.latitude } }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:tianditu-poi-search', async (_event, query: unknown): Promise<CredentialResponse<TiandituPoiSearchValue>> => {
    if (typeof query !== 'object' || query === null) return { ok: false, message: 'POI 查询参数无效。' }
    const { longitude, latitude, keyword, radiusMeters } = query as Record<string, unknown>
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || !isGeoPoint({ longitude, latitude })) {
      return { ok: false, message: 'POI 查询中心坐标无效，请先成功定位经营地址。' }
    }
    if (typeof keyword !== 'string' || !keyword.trim()) return { ok: false, message: 'POI 关键词为空。' }
    if (typeof radiusMeters !== 'number' || !Number.isFinite(radiusMeters) || radiusMeters < 100) {
      return { ok: false, message: 'POI 查询半径无效（至少 100 米）。' }
    }
    try {
      const result = await poiSearch({
        center: { longitude, latitude },
        keyword,
        radiusMeters: Math.min(5000, radiusMeters),
      })
      return {
        ok: true,
        value: {
          pois: result.pois.map((item) => ({ name: item.name, address: item.address, longitude: item.point.longitude, latitude: item.point.latitude, distanceKm: item.distanceKm })),
          totalCount: result.totalCount,
          requestCount: result.requestCount,
          checkedAt: result.checkedAt,
        },
      }
    } catch (error) {
      return credentialFailure(error)
    }
  })
}

function createSearchCache(cacheFilePath: string) {
  return new SearchCache({
    read: async () => {
      try {
        return await readFile(cacheFilePath, 'utf8')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    },
    write: async (content) => {
      await mkdir(path.dirname(cacheFilePath), { recursive: true })
      await writeFile(cacheFilePath, content, { encoding: 'utf8', mode: 0o600 })
    },
  })
}

function createTiandituGeocodeCache(cacheFilePath: string) {
  return new TiandituGeocodeCache({
    read: async () => {
      try {
        return await readFile(cacheFilePath, 'utf8')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    },
    write: async (content) => {
      await mkdir(path.dirname(cacheFilePath), { recursive: true })
      await writeFile(cacheFilePath, content, { encoding: 'utf8', mode: 0o600 })
    },
  })
}

function registerSearchIpc(store: CredentialStore, preferenceStore: SearchPreferenceStore, doubaoCacheFilePath: string, manager: SearchManager, creditRiskLogFilePath: string) {
  manager.register('doubao', createCachedSearchPort(
    createDoubaoPort(() => store.readDoubaoKey()),
    createSearchCache(doubaoCacheFilePath),
    { provider: 'doubao', ttlMs: 6 * 60 * 60 * 1_000 },
  ))
  const discoverBusinessCredit = createBusinessCreditDiscoveryService((request) => manager.search(request))
  const discoverProjectTimeline = createProjectTimelineDiscoveryService(
    (request) => manager.search(request),
    async () => (await preferenceStore.get()).defaultProvider,
  )
  const runPolicyChain = createPolicyChainService((request) => manager.search(request))
  const runIndustryChain = createIndustryChainService((request) => manager.search(request))
  const leadLogFilePath = path.join(path.dirname(creditRiskLogFilePath), 'lead.log')
  const writeLeadLog = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message.replace(/\s+/g, ' ').slice(0, 4000)}` + '\n'
    void mkdir(path.dirname(leadLogFilePath), { recursive: true })
      .then(() => appendFile(leadLogFilePath, line, 'utf8'))
      .catch(() => {})
  }
  // 获客（2026-09-18 用户口径）：只消费产业链已发现的同一批节点；每家串行铺底 + 模型循环，
  // 模型判断"搜不到了"就 submit 收口（程序只留保险丝），值必须能逐字回到证据正文。
  const runLeads = createLeadService((request) => manager.search(request), async () => 'doubao', undefined, async (input) => {
    if (!leadPlanStep) throw new Error('DSH 检索循环尚未就绪（请确认 DeepSeek Key 已配置）。')
    return leadPlanStep(input)
  }, writeLeadLog)
  // 公开风险可读诊断日志：每条检索、每条来源归类、每轮模型原始返回都落盘，便于定位"为什么没搜到内容"。
  const writeCreditRiskLog = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message.replace(/\s+/g, ' ').slice(0, 4000)}` + '\n'
    void mkdir(path.dirname(creditRiskLogFilePath), { recursive: true })
      .then(() => appendFile(creditRiskLogFilePath, line, 'utf8'))
      .catch(() => {})
  }
  const runCreditRisk = createCreditRiskService((request) => manager.search(request), async () => 'doubao', undefined, async (payload) => {
    if (!evidenceSynthesis) throw new Error('DSH 归纳通道尚未就绪（请确认 DeepSeek Key 已配置）。')
    return evidenceSynthesis(payload)
  }, async (payload) => {
    if (!agentLoopStep) throw new Error('DSH 检索循环尚未就绪（请确认 DeepSeek Key 已配置）。')
    return agentLoopStep(payload)
  }, writeCreditRiskLog)
  ipcMain.handle('shiji:search-preference-get', async (): Promise<SearchPreferenceResponse> => {
    try {
      return { ok: true, value: await preferenceStore.get() }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:search-preference-set', async (_event, provider: unknown): Promise<SearchPreferenceResponse> => {
    try {
      assertUserSearchProvider(provider)
      return { ok: true, value: await preferenceStore.set(provider) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:search-run', async (_event, request: unknown): Promise<SearchResponse> => {
    try {
      return { ok: true, value: await manager.search(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:business-credit-discover', async (_event, subjectName: unknown, providerOverride: unknown, focus: unknown): Promise<BusinessCreditDiscoveryResponse> => {
    if (typeof subjectName !== 'string') return { ok: false, message: '企业名称参数无效。' }
    if (focus !== undefined && typeof focus !== 'string') return { ok: false, message: '关注事项参数无效。' }
    try {
      let provider: UserSearchProviderId
      if (providerOverride === undefined) provider = (await preferenceStore.get()).defaultProvider
      else {
        assertUserSearchProvider(providerOverride)
        provider = providerOverride
      }
      return { ok: true, value: await discoverBusinessCredit(subjectName, provider, focus) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:project-timeline-discover', async (_event, request: unknown): Promise<ProjectTimelineDiscoveryResponse> => {
    try {
      assertProjectTimelineDiscoveryRequest(request)
      return { ok: true, value: await discoverProjectTimeline(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:credit-risk-run', async (_event, request: unknown): Promise<CreditRiskResponse> => {
    try {
      assertCreditRiskRequest(request)
      return { ok: true, value: await runCreditRisk(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:industry-chain-run', async (_event, request: unknown): Promise<IndustryChainResponse> => {
    try {
      assertIndustryChainRequest(request)
      return { ok: true, value: await runIndustryChain(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:lead-run', async (_event, request: unknown): Promise<LeadResponse> => {
    try {
      assertLeadRequest(request)
      return { ok: true, value: await runLeads(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
  ipcMain.handle('shiji:policy-chain-run', async (_event, request: unknown): Promise<PolicyChainResponse> => {
    try {
      assertPolicyChainRequest(request)
      return { ok: true, value: await runPolicyChain(request) }
    } catch (error) {
      return credentialFailure(error)
    }
  })
}

function registerEvidenceIpc(vault: EvidenceVault) {
  ipcMain.handle('shiji:evidence-import', async (event, subjectName: unknown) => {
    if (typeof subjectName !== 'string') return { ok: false, message: '企业名称参数无效。' }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '选择要保存到本机的参考或核验材料',
      properties: ['openFile'],
      filters: [{ name: '参考或核验材料', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'html', 'htm'] }],
    }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || selection.filePaths.length === 0) return { ok: true, cancelled: true }
    try {
      return { ok: true, value: await vault.importFile(subjectName, selection.filePaths[0]) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '本地材料导入失败。' }
    }
  })
  ipcMain.handle('shiji:evidence-list', async (_event, subjectName: unknown) => {
    if (subjectName !== undefined && typeof subjectName !== 'string') return { ok: false, message: '企业名称参数无效。' }
    try {
      return { ok: true, value: await vault.list(subjectName as string | undefined) }
    } catch {
      return { ok: false, message: '无法读取本地材料索引。' }
    }
  })
  ipcMain.handle('shiji:evidence-read-text', async (_event, recordId: unknown) => {
    if (typeof recordId !== 'string') return { ok: false, message: '材料编号无效。' }
    try {
      const text = await vault.readExtractedText(recordId)
      return text === undefined
        ? { ok: false, message: '该材料没有可用的本机正文。' }
        : { ok: true, value: { recordId, text } }
    } catch {
      return { ok: false, message: '无法读取本机材料正文。' }
    }
  })
}

function createWindow(entry: 'app' | 'license' = 'app') {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f5f7f2',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--shiji-version=${app.getVersion()}`,
        `--shiji-contract-version=${DESKTOP_CONTRACT_VERSION}`,
        `--shiji-mock-enabled=${mockEnabled ? '1' : '0'}`,
      ],
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    void window.loadURL('http://localhost:5173')
  } else {
    void window.loadFile(path.join(currentDirectory, `../../dist/${entry === 'license' ? 'license' : 'index'}.html`))
  }
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0]
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
})

app.whenReady().then(async () => {
  const userDataRoot = app.getPath('userData')
  const licenseFilePath = path.join(userDataRoot, 'license.v1.json')
  const publicKeyPath = app.isPackaged
    ? path.join(process.resourcesPath, 'licenses', 'shiji-license-public.pem')
    : path.join(currentDirectory, '../../licenses/shiji-license-public.pem')
  let licenseStore: OfflineLicenseStore | undefined
  let licenseSetupError: string | undefined
  try {
    const publicKey = await readFile(publicKeyPath, 'utf8')
    licenseStore = new OfflineLicenseStore({
      read: async () => {
        try { return await readFile(licenseFilePath, 'utf8') }
        catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
          throw error
        }
      },
      write: async (value) => {
        await mkdir(path.dirname(licenseFilePath), { recursive: true })
        await writeFile(licenseFilePath, value, { encoding: 'utf8', mode: 0o600 })
      },
    }, { deviceCode: getWindowsDeviceCode }, publicKey)
  } catch (error) {
    licenseSetupError = error instanceof Error ? error.message : '离线授权组件初始化失败。'
  }
  ipcMain.handle('shiji:license-status', async () => {
    if (!licenseStore) return { ok: false, message: licenseSetupError ?? '离线授权组件不可用。' }
    try { return { ok: true, value: await licenseStore.status() } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '无法读取本机设备码。' } }
  })
  ipcMain.handle('shiji:license-activate', async (_event, code: unknown) => {
    if (!licenseStore) return { ok: false, message: licenseSetupError ?? '离线授权组件不可用。' }
    if (typeof code !== 'string') return { ok: false, message: '授权码格式无效。' }
    try {
      const value = await licenseStore.activate(code)
      setTimeout(() => { app.relaunch(); app.exit(0) }, 600)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '授权失败，请核对设备码和授权码。' }
    }
  })
  const licenseStatus = licenseStore && await licenseStore.status().catch(() => undefined)
  if (app.isPackaged && !licenseStatus?.activated) {
    windowEntry = 'license'
    createWindow(windowEntry)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(windowEntry)
    })
    return
  }
  const rendererLogFilePath = path.join(userDataRoot, 'logs', 'renderer.log')
    ipcMain.on('shiji:renderer-log', (_event, message: unknown) => {
      if (typeof message !== 'string' || !message.trim()) return
      const line = `[${new Date().toISOString()}] ${message.replace(/\s+/g, ' ').slice(0, 4000)}\n`
      void mkdir(path.dirname(rendererLogFilePath), { recursive: true })
        .then(() => appendFile(rendererLogFilePath, line, 'utf8'))
        .catch(() => {})
    })
  const credentialFilePath = path.join(userDataRoot, 'secure', 'credentials.v1.json')
  const doubaoCacheFilePath = path.join(userDataRoot, 'cache', 'doubao.v1.json')
  const tiandituGeocodeCacheFilePath = path.join(userDataRoot, 'cache', 'tianditu-geocode.v1.json')
  const searchPreferenceFilePath = path.join(userDataRoot, 'settings', 'search-preference.v1.json')
  const agentBackendPreferenceFilePath = path.join(userDataRoot, 'settings', 'agent-backend.v1.json')
  const credentialStore = new CredentialStore(
    {
      read: async () => {
        try {
          return await readFile(credentialFilePath, 'utf8')
        } catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
          throw error
        }
      },
      write: async (content) => {
        await mkdir(path.dirname(credentialFilePath), { recursive: true })
        await writeFile(credentialFilePath, content, { encoding: 'utf8', mode: 0o600 })
      },
    },
    {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptString(plainText).toString('base64'),
      decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
    },
  )
  const agentBackendPreferenceStore = new AgentBackendPreferenceStore({
    read: async () => {
      try {
        return await readFile(agentBackendPreferenceFilePath, 'utf8')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    },
    write: async (content) => {
      await mkdir(path.dirname(agentBackendPreferenceFilePath), { recursive: true })
      await writeFile(agentBackendPreferenceFilePath, content, { encoding: 'utf8', mode: 0o600 })
    },
  })
  const storedBackend = await agentBackendPreferenceStore.get().catch(() => 'dsh' as const)
  const initialBackend = mockEnabled ? storedBackend : 'dsh'
  const backendManager = new AgentBackendManager(
    new AgentRunner(new MockAgentBackend()),
    async () => (await credentialStore.getDeepSeekStatus()).configured,
    { initialSelected: initialBackend, mockEnabled, saveSelected: (id) => agentBackendPreferenceStore.set(id) },
  )
  const searchManager = new SearchManager()
  const searchPreferenceStore = new SearchPreferenceStore({
    read: async () => {
      try {
        return await readFile(searchPreferenceFilePath, 'utf8')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
    },
    write: async (content) => {
      await mkdir(path.dirname(searchPreferenceFilePath), { recursive: true })
      await writeFile(searchPreferenceFilePath, content, { encoding: 'utf8', mode: 0o600 })
    },
  })
  const discoverOpportunity = createOpportunityDiscoveryService(
    (request) => searchManager.search(request),
    async () => (await searchPreferenceStore.get()).defaultProvider,
  )
  const locateNearbyOpportunity = createNearbyOpportunityLocator(createTiandituGeocoder(
    () => credentialStore.readTiandituServerKey(),
    createTiandituGeocodeCache(tiandituGeocodeCacheFilePath),
  ))
  registerTiandituMapIpc(createTiandituGeocoder(
    () => credentialStore.readTiandituServerKey(),
    createTiandituGeocodeCache(tiandituGeocodeCacheFilePath),
  ), createTiandituPoiSearchPort(async () => (await credentialStore.readTiandituServerKey()) ?? ''))
  registerAgentIpc(backendManager, backendManager)
  registerCredentialIpc(credentialStore)
  registerSearchIpc(credentialStore, searchPreferenceStore, doubaoCacheFilePath, searchManager, path.join(userDataRoot, 'logs', 'credit-risk.log'))
  registerEvidenceIpc(new EvidenceVault(path.join(userDataRoot, 'evidence')))
  createWindow()
  void (async () => {
    const workspaceRoot = path.join(userDataRoot, 'workspace')
    const sessionRoot = path.join(userDataRoot, 'sessions', 'dsh')
    await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(sessionRoot, { recursive: true })])
    const prepared = await prepareInstalledDshBackend({
      packageRoot: app.isPackaged
        ? path.join(process.resourcesPath, 'capabilities', 'dsh', '0.1.1-rc.2')
        : installedDshPackageRoot(userDataRoot),
      releaseLock: app.isPackaged ? DSH_PACKAGED_RELEASE_LOCK : DSH_RELEASE_LOCK,
      electronExecutable: process.execPath,
      workspaceRoot,
      sessionRoot,
      readDeepSeekKey: () => credentialStore.readDeepSeekKey(),
      discoverOpportunity,
      locateNearbyOpportunity,
    })
    if (prepared.available) {
      backendManager.setDshRunner(prepared.runner, prepared.testModel)
      evidenceSynthesis = prepared.synthesize
      agentLoopStep = prepared.runLoopStep
      leadPlanStep = prepared.planLeadSearch
      searchManager.register('deepseek-official', prepared.searchPort)
    } else {
      backendManager.setDshUnavailable(prepared.reason)
      searchManager.remove('deepseek-official')
    }
  })().catch(() => {
    backendManager.setDshUnavailable('DSH 能力包初始化失败。')
    searchManager.remove('deepseek-official')
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(windowEntry)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
}
