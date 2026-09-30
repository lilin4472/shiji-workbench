import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_DEFAULT_MODEL } from '../shared/agent-backend-contract.js'
import { searchSourceToEvidenceRecord } from '../shared/evidence-contract.js'
import type { SearchPort, SearchSource } from '../shared/search-contract.js'
import { normalizeSearchSources } from './search-source.js'

export const DSH_SEARCH_MAX_RESULTS = 5
export const DSH_SEARCH_MAX_TOKENS = 512
export const DSH_SEARCH_MAX_USES = 1
const DSH_SEARCH_TIMEOUT_MS = 30_000

type DshProviderSearchSource = Omit<SearchSource, 'sourceClass'>

interface DshSearchProviderResult {
  sources: readonly DshProviderSearchSource[]
  truncated: boolean
}

interface DshSearchProviderOptions {
  apiKey: string
  baseURL: string
  model: string
  apiVersion: string
  maxTokens: number
  maxUses: number
}

interface DshSearchProviderInstance {
  search(request: { query: string; maxResults: number }, signal?: AbortSignal): Promise<DshSearchProviderResult>
}

interface DshSearchProviderModule {
  DeepSeekSearchProvider: new (resolveOptions: () => DshSearchProviderOptions) => DshSearchProviderInstance
}

export function createDshDeepSeekSearchPort(
  loadProvider: () => Promise<DshSearchProviderModule>,
  readDeepSeekKey: () => Promise<string | undefined>,
): SearchPort {
  return async (request) => {
    if (request.provider !== 'deepseek-official') throw new Error('DeepSeek 收到了不匹配的搜索供应商参数。')
    const query = request.query.trim()
    if (!query || query.length > 500) throw new Error('搜索词为空或长度异常。')

    const apiKey = await readDeepSeekKey()
    if (!apiKey) throw new Error('请先在设置中保存 DeepSeek API Key。')
    const { DeepSeekSearchProvider } = await loadProvider()
    const provider = new DeepSeekSearchProvider(() => ({
      apiKey,
      baseURL: 'https://api.deepseek.com/anthropic/v1',
      model: DSH_DEFAULT_MODEL,
      apiVersion: '2023-06-01',
      maxTokens: DSH_SEARCH_MAX_TOKENS,
      maxUses: DSH_SEARCH_MAX_USES,
    }))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DSH_SEARCH_TIMEOUT_MS)
    try {
      const result = await provider.search({ query, maxResults: DSH_SEARCH_MAX_RESULTS }, controller.signal)
      const sources = normalizeSearchSources(result.sources, DSH_SEARCH_MAX_RESULTS)
      const checkedAt = new Date().toISOString()
      return {
        provider: 'deepseek-official',
        purpose: request.purpose,
        query,
        sources,
        evidenceRecords: sources.map((source) => searchSourceToEvidenceRecord(source, { provider: 'deepseek-official', query, capturedAt: checkedAt })),
        truncated: result.truncated || result.sources.length > sources.length,
        requestCount: 1,
        cacheHit: false,
        checkedAt,
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error('DeepSeek 搜索超时，请稍后重试。')
      const code = errorCode(error)
      if (code === 'QUOTA') throw new Error('DeepSeek 账户余额不足，搜索未执行完成。')
      if (code === 'AUTH') throw new Error('DeepSeek Key 无效或没有联网搜索权限。')
      if (code === 'RATE_LIMIT') throw new Error('DeepSeek 搜索请求频率受限，请稍后再试。')
      throw new Error('DeepSeek 搜索插件调用失败；详细供应商响应未向前端暴露。')
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function loadInstalledDshDeepSeekSearchProvider(packageRoot: string): Promise<DshSearchProviderModule> {
  const entry = path.join(packageRoot, 'node', 'node_modules', '@deepseek-ai', 'dsh-web-search-deepseek', 'lib', 'index.js')
  return import(pathToFileURL(entry).href) as Promise<DshSearchProviderModule>
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error) return error.code
  if ('cause' in error) return errorCode(error.cause)
  return undefined
}
