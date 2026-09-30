import type { DoubaoConnectionResult } from '../shared/credential-contract.js'
import { searchSourceToEvidenceRecord } from '../shared/evidence-contract.js'
import type { SearchPort, SearchPurpose } from '../shared/search-contract.js'
import { normalizeSearchSources, type RawSearchSource } from './search-source.js'

const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/web_search'
const DOUBAO_TIMEOUT_MS = 30_000
export const DOUBAO_DIAGNOSTIC_RESULTS = 10
export const DOUBAO_BUSINESS_RESULTS = 20

interface DoubaoError {
  CodeN?: unknown
  Code?: unknown
  Message?: unknown
}

interface DoubaoWebResult {
  Title?: unknown
  SiteName?: unknown
  Url?: unknown
  Snippet?: unknown
  Summary?: unknown
  Content?: unknown
  PublishTime?: unknown
  RankScore?: unknown
  AuthInfoDes?: unknown
  AuthInfoLevel?: unknown
}

interface DoubaoPayload {
  ResponseMetadata?: { Error?: DoubaoError }
  Result?: {
    ResultCount?: unknown
    WebResults?: unknown
    TimeCost?: unknown
  } | null
}

export function createDoubaoPort(
  readDoubaoKey: () => Promise<string | undefined>,
  fetchImplementation: typeof fetch = fetch,
): SearchPort {
  return async (request) => {
    if (request.provider !== 'doubao') throw new Error('豆包搜索收到了不匹配的搜索供应商参数。')
    const query = validateQuery(request.query)
    const apiKey = await readDoubaoKey()
    if (!apiKey) throw new Error('请先在设置中保存豆包搜索 Custom 版 API Key。')
    const count = request.maxResults
      ?? (request.purpose === 'diagnostic' ? DOUBAO_DIAGNOSTIC_RESULTS : DOUBAO_BUSINESS_RESULTS)
    const payload = await requestDoubao(apiKey, query, count, request.purpose, fetchImplementation)
    const rawResults = payload.Result?.WebResults
    if (!Array.isArray(rawResults)) throw new Error('豆包搜索返回了无法识别的网页结果。')
    const sources = normalizeSearchSources(rawResults.map(toRawSearchSource), count)
    const checkedAt = new Date().toISOString()
    const totalResults = finiteNonNegative(payload.Result?.ResultCount) ?? rawResults.length
    const searchTimeMs = finiteNonNegative(payload.Result?.TimeCost)
    return {
      provider: 'doubao',
      purpose: request.purpose,
      query,
      sources,
      evidenceRecords: sources.map((source) => searchSourceToEvidenceRecord(source, { provider: 'doubao', query, capturedAt: checkedAt })),
      truncated: totalResults > sources.length || rawResults.length >= count,
      totalResults,
      ...(searchTimeMs === undefined ? {} : { searchTimeMs }),
      requestCount: 1,
      cacheHit: false,
      checkedAt,
    }
  }
}

export async function testDoubaoConnection(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<DoubaoConnectionResult> {
  const payload = await requestDoubao(apiKey, '中华人民共和国政府网', 1, 'diagnostic', fetchImplementation)
  return {
    connected: true,
    resultCount: finiteNonNegative(payload.Result?.ResultCount) ?? 0,
    checkedAt: new Date().toISOString(),
  }
}

async function requestDoubao(
  apiKey: string,
  query: string,
  count: number,
  purpose: SearchPurpose,
  fetchImplementation: typeof fetch,
): Promise<DoubaoPayload> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOUBAO_TIMEOUT_MS)
  try {
    const response = await fetchImplementation(DOUBAO_SEARCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Query: query,
        SearchType: 'web',
        Count: count,
        EnableWaiting: true,
        MaxWaitTime: 10_000,
        Filter: {
          NeedContent: purpose !== 'diagnostic',
          NeedUrl: true,
          AuthInfoLevel: 0,
        },
        QueryControl: { QueryRewrite: purpose !== 'diagnostic' },
        ContentFormats: 'markdown',
      }),
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) throw new Error('豆包搜索 Key 无效、已停用或没有 Custom 版权限。')
    if (response.status === 429) throw new Error('豆包搜索请求频率受限，请稍后重试。')
    if (!response.ok) throw new Error(`豆包搜索连接失败（HTTP ${response.status}）。`)
    const payload = await response.json() as DoubaoPayload
    const providerError = payload.ResponseMetadata?.Error
    if (providerError) throw doubaoProviderError(providerError)
    if (!payload.Result || !Array.isArray(payload.Result.WebResults)) {
      throw new Error('豆包搜索返回了无法识别的网页结果。')
    }
    return payload
  } catch (error) {
    if (controller.signal.aborted) throw new Error('豆包搜索连接超时，请检查网络后重试。')
    if (error instanceof Error && error.message.startsWith('豆包搜索')) throw error
    throw new Error('无法连接豆包搜索 Custom 版 API，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

function doubaoProviderError(error: DoubaoError): Error {
  const code = String(error.CodeN ?? error.Code ?? '')
  if (code === '10401' || code === '10403') return new Error('豆包搜索 Key 无效或没有 Custom 版搜索权限。')
  if (code === '10406' || code === '10408' || code === '10410' || code === '10412') return new Error('豆包搜索免费额度、套餐或账户余额不可用，请到控制台检查。')
  if (code === '10409') return new Error('当前豆包搜索 Key 类型与 Custom 版接口不匹配。')
  if (code === '700429') return new Error('豆包搜索请求频率受限，请稍后重试。')
  if (code === '10400' || code === '10402') return new Error('豆包搜索请求参数或搜索类型不受支持。')
  return new Error(`豆包搜索服务返回错误${code ? `（${code}）` : ''}。`)
}

function toRawSearchSource(value: unknown): RawSearchSource {
  if (!value || typeof value !== 'object') return {}
  const item = value as DoubaoWebResult
  return {
    url: item.Url,
    title: item.Title,
    publisher: item.SiteName,
    snippet: item.Summary ?? item.Snippet,
    content: item.Content ?? item.Summary,
    publishedAt: item.PublishTime,
    rankScore: item.RankScore,
    authorityLabel: item.AuthInfoDes,
    authorityLevel: item.AuthInfoLevel,
  }
}

function validateQuery(value: string): string {
  const query = value.trim().replace(/\s+/g, ' ')
  if (!query) throw new Error('搜索词为空。')
  return query.slice(0, 100)
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
