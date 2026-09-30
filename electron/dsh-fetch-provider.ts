import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DSH_FETCH_MAX_OUTPUT_CHARS = 20_000
const DSH_FETCH_TIMEOUT_MS = 15_000

interface DshFetchResult {
  url: string
  statusCode: number
  body: { kind: 'html' | 'text'; content: string }
  truncated: boolean
}

interface DshFetchProviderModule {
  HttpFetchProvider: new (limits: {
    maxUrlLength: number
    maxResponseBytes: number
    maxBodyChars: number
    timeoutMs: number
    maxRedirects: number
    userAgent: string
  }) => { fetch(request: { url: string }, signal?: AbortSignal): Promise<DshFetchResult> }
}

export interface DshGovernmentFetchResult {
  url: string
  statusCode: number
  content: string
  truncated: boolean
  sourceClass: 'government'
  checkedAt: string
}

export function createDshGovernmentFetchProbe(loadProvider: () => Promise<DshFetchProviderModule>) {
  return async (urlValue: string): Promise<DshGovernmentFetchResult> => {
    const url = governmentHttpsUrl(urlValue)
    if (!url) throw new Error('当前正文读取探针只允许 HTTPS 政府公开网页（*.gov.cn）。')
    const { HttpFetchProvider } = await loadProvider()
    const provider = new HttpFetchProvider({
      maxUrlLength: 2048,
      maxResponseBytes: 2_000_000,
      maxBodyChars: 50_000,
      timeoutMs: DSH_FETCH_TIMEOUT_MS,
      maxRedirects: 2,
      userAgent: 'Shiji/0.1 (local opportunity research tool)',
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DSH_FETCH_TIMEOUT_MS)
    try {
      const result = await provider.fetch({ url: url.href }, controller.signal)
      return {
        url: result.url,
        statusCode: result.statusCode,
        content: result.body.content.slice(0, DSH_FETCH_MAX_OUTPUT_CHARS),
        truncated: result.truncated || result.body.content.length > DSH_FETCH_MAX_OUTPUT_CHARS,
        sourceClass: 'government',
        checkedAt: new Date().toISOString(),
      }
    } catch {
      if (controller.signal.aborted) throw new Error('政府网页读取超时。')
      throw new Error('政府网页无法通过静态 HTTP 安全读取；可能需要浏览器渲染、附件下载或人工导入。')
    } finally {
      clearTimeout(timeout)
    }
  }
}

export async function loadInstalledDshGovernmentFetchProvider(packageRoot: string): Promise<DshFetchProviderModule> {
  const packageBase = path.join(packageRoot, 'node', 'node_modules', '@deepseek-ai')
  const fetchModule = await import(pathToFileURL(path.join(packageBase, 'dsh-web-fetch-http', 'lib', 'index.js')).href)
  return {
    HttpFetchProvider: fetchModule.HttpFetchProvider,
  } as DshFetchProviderModule
}

function governmentHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    const hostname = url.hostname.toLowerCase()
    if (hostname !== 'gov.cn' && !hostname.endsWith('.gov.cn')) return undefined
    return url
  } catch {
    return undefined
  }
}
