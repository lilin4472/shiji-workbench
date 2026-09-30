import type { EvidenceSourceClass, SearchSource } from '../shared/search-contract.js'

export interface RawSearchSource {
  url?: unknown
  title?: unknown
  publisher?: unknown
  snippet?: unknown
  content?: unknown
  publishedAt?: unknown
  rankScore?: unknown
  authorityLabel?: unknown
  authorityLevel?: unknown
}

const MAX_TITLE_LENGTH = 500
const MAX_SNIPPET_LENGTH = 4_000
const MAX_CONTENT_LENGTH = 100_000

export function normalizeSearchSources(sources: readonly RawSearchSource[], limit: number): SearchSource[] {
  if (!Array.isArray(sources)) throw new Error('invalid search sources')
  const normalized: SearchSource[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (!source || typeof source.url !== 'string' || !isPublicWebUrl(source.url) || seen.has(source.url)) continue
    seen.add(source.url)
    normalized.push({
      url: source.url,
      sourceClass: classifyEvidenceUrl(source.url),
      ...optionalText('title', source.title, MAX_TITLE_LENGTH),
      ...optionalText('publisher', source.publisher, MAX_TITLE_LENGTH),
      ...optionalText('snippet', source.snippet, MAX_SNIPPET_LENGTH),
      ...optionalText('content', source.content, MAX_CONTENT_LENGTH),
      ...optionalText('publishedAt', source.publishedAt, 100),
      ...optionalNumber('rankScore', source.rankScore, 0, 1),
      ...optionalText('authorityLabel', source.authorityLabel, 40),
      ...optionalNumber('authorityLevel', source.authorityLevel, 1, 4),
    })
    if (normalized.length >= limit) break
  }
  return normalized
}

export function classifyEvidenceUrl(value: string): EvidenceSourceClass {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    if (hostname === 'gsxt.gov.cn' || hostname.endsWith('.gsxt.gov.cn')) return 'registry'
    if (hostname === 'creditchina.gov.cn' || hostname.endsWith('.creditchina.gov.cn')) return 'credit-china'
    if (hostname === 'court.gov.cn' || hostname.endsWith('.court.gov.cn')) return 'court'
    if (hostname === 'gov.cn' || hostname.endsWith('.gov.cn')) return 'government'
  } catch {
    return 'other'
  }
  return 'other'
}

function optionalText<K extends 'title' | 'publisher' | 'snippet' | 'content' | 'publishedAt' | 'authorityLabel'>(key: K, value: unknown, maxLength: number): Partial<Record<K, string>> {
  if (typeof value !== 'string') return {}
  const text = value.trim()
  return text ? { [key]: text.slice(0, maxLength) } as Record<K, string> : {}
}

function optionalNumber<K extends 'rankScore' | 'authorityLevel'>(key: K, value: unknown, min: number, max: number): Partial<Record<K, number>> {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? { [key]: value } as Record<K, number>
    : {}
}

function isPublicWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
