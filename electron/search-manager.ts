import { assertSearchRequest, type SearchPort, type SearchProviderId, type SearchRequest, type SearchResult } from '../shared/search-contract.js'

export class SearchManager {
  private readonly ports = new Map<SearchProviderId, SearchPort>()
  private readonly runningProviders = new Set<SearchProviderId>()

  register(provider: SearchProviderId, port: SearchPort): void {
    this.ports.set(provider, port)
  }

  remove(provider: SearchProviderId): void {
    this.ports.delete(provider)
  }

  async search(requestValue: unknown): Promise<SearchResult> {
    assertSearchRequest(requestValue)
    const request = { ...requestValue, query: requestValue.query.trim() }
    const port = this.ports.get(request.provider)
    if (!port) throw new Error(`${providerLabel(request.provider)}搜索能力当前不可用。`)
    if (this.runningProviders.has(request.provider)) throw new Error(`${providerLabel(request.provider)}搜索正在运行，请稍候。`)

    this.runningProviders.add(request.provider)
    try {
      return await port(request)
    } finally {
      this.runningProviders.delete(request.provider)
    }
  }
}

function providerLabel(provider: SearchProviderId): string {
  if (provider === 'doubao') return '豆包搜索 Custom'
  return 'DeepSeek'
}
