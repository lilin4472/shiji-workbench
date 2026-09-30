import { lookup } from 'node:dns/promises'
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'
import type { EvidenceDocumentExtraction, LocalEvidenceMediaKind } from '../shared/evidence-contract.js'
import type { SearchSource } from '../shared/search-contract.js'
import { extractDocument } from './evidence-document-extractor.js'

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
// Search providers often land on a commercial repost or an index page. Follow
// only explicit “原文” links, and cap the chain at three pages total; arbitrary
// page-link crawling would be both slow and unsafe for a local tool.
const MAX_EXPLICIT_ORIGINAL_HOPS = 2
const DEFAULT_TIMEOUT_MS = 15_000

export interface ResolvedAddress {
  address: string
  family: number
}

export type PinnedRequestImplementation = (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<Response>

export interface SearchDocumentReadResult {
  sourceUrl: string
  finalUrl: string
  httpRequestCount: number
  mediaKind: Extract<LocalEvidenceMediaKind, 'html' | 'text' | 'pdf'>
  sizeBytes: number
  extraction: EvidenceDocumentExtraction
}

export interface SearchDocumentReaderOptions {
  fetchImplementation?: typeof fetch
  requestImplementation?: PinnedRequestImplementation
  resolveHost?: (hostname: string) => Promise<readonly ResolvedAddress[]>
  maxResponseBytes?: number
  maxRedirects?: number
  timeoutMs?: number
}

export function createSearchDocumentReader(options: SearchDocumentReaderOptions = {}) {
  const resolveHost = options.resolveHost ?? resolvePublicHost
  const requestImplementation = options.requestImplementation
    ?? (options.fetchImplementation ? fetchRequest(options.fetchImplementation) : requestPinned)
  const maxResponseBytes = positiveLimit(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
  const maxRedirects = nonNegativeLimit(options.maxRedirects, DEFAULT_MAX_REDIRECTS)
  const timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS)

  return async (source: SearchSource, signal?: AbortSignal): Promise<SearchDocumentReadResult> => {
    const sourceUrl = parseWebUrl(source.url).href
    if (source.content?.trim()) {
      const bytes = new TextEncoder().encode(source.content)
      return {
        sourceUrl,
        finalUrl: sourceUrl,
        httpRequestCount: 0,
        mediaKind: 'text',
        sizeBytes: bytes.byteLength,
        extraction: await extractDocument({ mediaKind: 'text', bytes, sourceUrl }),
      }
    }

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(signal?.reason)
    if (signal?.aborted) abortFromCaller()
    else signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)

    try {
      let current = await readPage(new URL(sourceUrl))
      for (let hop = 0; hop < MAX_EXPLICIT_ORIGINAL_HOPS; hop += 1) {
        const nextUrl = current.extraction.originalUrlCandidate ?? current.extraction.detailUrlCandidates?.[0]
        if (!nextUrl || sameUrl(nextUrl, current.finalUrl)) break
        const next = await readPage(new URL(nextUrl))
        current = {
          ...next,
          sourceUrl,
          httpRequestCount: current.httpRequestCount + next.httpRequestCount,
          extraction: mergeOriginalProvenance(current.extraction, next.extraction),
        }
      }
      return current
    } catch (error) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw new Error('网页读取已取消。')
        throw new Error('网页读取超时。')
      }
      if (error instanceof Error) throw error
      throw new Error('网页读取失败。')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    }

    async function readPage(start: URL): Promise<SearchDocumentReadResult> {
      let current = start
      for (let requestIndex = 0; requestIndex <= maxRedirects; requestIndex += 1) {
        const addresses = await assertPublicWebUrl(current, resolveHost)
        const response = await requestImplementation(current, addresses[0], controller.signal)
        const redirectUrl = redirectedTo(response, current)
        if (redirectUrl) {
          if (requestIndex === maxRedirects) throw new Error('网页跳转次数超过安全上限。')
          current = redirectUrl
          continue
        }
        if (!response.ok) throw new Error(`网页读取失败（HTTP ${response.status}）。`)

        const mediaKind = responseMediaKind(response.headers.get('content-type'), current)
        const declaredLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          throw new Error('网页或附件过大，已停止读取。')
        }
        const bytes = await readBoundedBody(response, maxResponseBytes)
        return {
          sourceUrl,
          finalUrl: current.href,
          httpRequestCount: requestIndex + 1,
          mediaKind,
          sizeBytes: bytes.byteLength,
          extraction: await extractDocument({
            mediaKind,
            bytes,
            sourceUrl: current.href,
            linkHints: [source.title ?? '', source.snippet ?? ''],
          }),
        }
      }
      throw new Error('网页跳转次数超过安全上限。')
    }
  }
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return left === right
  }
}

function mergeOriginalProvenance(
  previous: EvidenceDocumentExtraction,
  current: EvidenceDocumentExtraction,
): EvidenceDocumentExtraction {
  return {
    ...current,
    ...(current.originalPublisherCandidate || !previous.originalPublisherCandidate ? {} : { originalPublisherCandidate: previous.originalPublisherCandidate }),
    ...(current.originalUrlCandidate || !previous.originalUrlCandidate ? {} : { originalUrlCandidate: previous.originalUrlCandidate }),
    provenanceTypeCandidate: previous.provenanceTypeCandidate === 'explicit-repost' || current.provenanceTypeCandidate === 'explicit-repost'
      ? 'explicit-repost'
      : current.provenanceTypeCandidate,
  }
}

function parseWebUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('网页地址无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许读取公开 HTTP/HTTPS 网页。')
  if (url.username || url.password) throw new Error('网页地址不能包含账号或密码。')
  return url
}

async function assertPublicWebUrl(url: URL, resolveHost: (hostname: string) => Promise<readonly ResolvedAddress[]>): Promise<readonly ResolvedAddress[]> {
  parseWebUrl(url.href)
  const hostname = unbracket(url.hostname).toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('禁止读取本机或内网地址。')
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('禁止读取本机或内网地址。')
    return [{ address: hostname, family: isIP(hostname) }]
  }

  let addresses: readonly ResolvedAddress[]
  try {
    addresses = await resolveHost(hostname)
  } catch {
    throw new Error('网页域名无法解析。')
  }
  if (addresses.length === 0) throw new Error('网页域名没有可用地址。')
  if (addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('禁止读取本机或内网地址。')
  return addresses
}

async function resolvePublicHost(hostname: string): Promise<readonly ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true })
}

function fetchRequest(fetchImplementation: typeof fetch): PinnedRequestImplementation {
  return (url, _address, signal) => fetchImplementation(url, {
    redirect: 'manual',
    signal,
    headers: requestHeaders(),
  })
}

function requestPinned(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? requestHttps : requestHttp)({
      protocol: url.protocol,
      hostname: address.address,
      port: url.port || undefined,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { ...requestHeaders(), host: url.host },
      ...(url.protocol === 'https:' && !isIP(unbracket(url.hostname)) ? { servername: unbracket(url.hostname) } : {}),
    }, (incoming) => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
        else if (value !== undefined) headers.set(name, value)
      }
      const status = incoming.statusCode ?? 500
      const hasNoBody = status === 204 || status === 205 || status === 304
      const body = hasNoBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      resolve(new Response(body, { status, statusText: incoming.statusMessage, headers }))
    })
    const abort = () => request.destroy(new Error('aborted'))
    const cleanup = () => signal.removeEventListener('abort', abort)
    request.once('error', (error) => {
      cleanup()
      reject(error)
    })
    request.once('close', cleanup)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    request.end()
  })
}

function requestHeaders(): Record<string, string> {
  // 2026-09-16 真实端到端发现：政府/交易平台站点会对"非浏览器"UA 直接回 412
  // （实测成都市武侯区政府公告页在 Shiji/0.1 下返回 HTTP 412），导致最关键的原始公告读不到。
  // 这里改用常规桌面浏览器 UA + 中文 Accept-Language；仍然只做单页只读抓取，
  // 不携带 Cookie、不执行脚本、不跟随站内任意链接。
  return {
    accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1',
    'accept-encoding': 'identity',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  }
}

function redirectedTo(response: Response, current: URL): URL | undefined {
  if (![301, 302, 303, 307, 308].includes(response.status)) return undefined
  const location = response.headers.get('location')
  if (!location) throw new Error('网页返回了缺少目标地址的跳转。')
  return parseWebUrl(new URL(location, current).href)
}

function responseMediaKind(contentTypeValue: string | null, url: URL): Extract<LocalEvidenceMediaKind, 'html' | 'text' | 'pdf'> {
  const contentType = contentTypeValue?.split(';', 1)[0].trim().toLowerCase()
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return 'html'
  if (contentType?.startsWith('text/')) return 'text'
  if (contentType === 'application/pdf') return 'pdf'
  if ((!contentType || contentType === 'application/octet-stream') && url.pathname.toLowerCase().endsWith('.pdf')) return 'pdf'
  throw new Error('网页内容格式暂不支持；当前只读取 HTML、文本和 PDF。')
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('网页或附件过大，已停止读取。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const blockedAddresses = new BlockList()
for (const [network, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
] as const) blockedAddresses.addSubnet(network, prefix, family)

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return false
  return !blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

function unbracket(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback
}

function nonNegativeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : fallback
}
