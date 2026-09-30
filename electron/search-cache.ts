import { searchSourceToEvidenceRecord } from '../shared/evidence-contract.js'
import type { SearchPort, SearchProviderId, SearchPurpose, SearchResult } from '../shared/search-contract.js'

interface CacheStorage {
  read(): Promise<string | undefined>
  write(content: string): Promise<void>
}

interface CacheEntry {
  expiresAt: string
  result: SearchResult
}

interface CacheFile {
  version: 1
  entries: Record<string, CacheEntry>
}

interface CachedSearchOptions {
  provider: SearchProviderId
  ttlMs: number
  now?: () => Date
}

function normalizedQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function cacheKey(query: string, maxResults?: number): string {
  const normalized = normalizedQuery(query)
  return maxResults === undefined ? normalized : `${normalized}\u0000limit=${maxResults}`
}

function emptyCache(): CacheFile {
  return { version: 1, entries: {} }
}

export class SearchCache {
  constructor(private readonly storage: CacheStorage) {}

  async get(query: string, purpose: SearchPurpose, now: Date, maxResults?: number): Promise<SearchResult | undefined> {
    const file = await this.readFile()
    const entry = file.entries[cacheKey(query, maxResults)]
    if (!entry || Date.parse(entry.expiresAt) <= now.getTime()) return undefined
    if (!Array.isArray(entry.result.sources)) return undefined
    if (Array.isArray(entry.result.evidenceRecords)) return { ...entry.result, purpose }
    return {
      ...entry.result,
      purpose,
      evidenceRecords: entry.result.sources.map((source) => searchSourceToEvidenceRecord(source, {
        provider: entry.result.provider,
        query: entry.result.query,
        capturedAt: entry.result.checkedAt,
      })),
    }
  }

  async set(query: string, result: SearchResult, expiresAt: string, now: Date, maxResults?: number): Promise<void> {
    const file = await this.readFile()
    for (const [key, entry] of Object.entries(file.entries)) {
      if (Date.parse(entry.expiresAt) <= now.getTime()) delete file.entries[key]
    }
    file.entries[cacheKey(query, maxResults)] = { expiresAt, result }
    await this.storage.write(JSON.stringify(file))
  }

  private async readFile(): Promise<CacheFile> {
    try {
      const content = await this.storage.read()
      if (!content) return emptyCache()
      const value = JSON.parse(content) as Partial<CacheFile>
      return value.version === 1 && value.entries && typeof value.entries === 'object'
        ? value as CacheFile
        : emptyCache()
    } catch {
      return emptyCache()
    }
  }
}

export function createCachedSearchPort(
  port: SearchPort,
  cache: SearchCache,
  options: CachedSearchOptions,
): SearchPort {
  const now = options.now ?? (() => new Date())
  return async (request) => {
    if (request.provider !== options.provider) throw new Error('搜索缓存收到了不匹配的供应商参数。')
    const query = normalizedQuery(request.query)
    const checkedAt = now()
    const cached = await cache.get(query, request.purpose, checkedAt, request.maxResults)
    if (cached) return { ...cached, query, purpose: request.purpose, requestCount: 0, cacheHit: true }

    const result = await port({ ...request, query })
    const expiresAt = new Date(checkedAt.getTime() + options.ttlMs).toISOString()
    const liveResult = { ...result, query, requestCount: 1 as const, cacheHit: false, expiresAt }
    await cache.set(query, liveResult, expiresAt, checkedAt, request.maxResults)
    return liveResult
  }
}
