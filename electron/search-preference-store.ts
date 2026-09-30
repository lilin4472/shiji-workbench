import { assertUserSearchProvider, type SearchPreference, type UserSearchProviderId } from '../shared/search-preference.js'

export interface SearchPreferenceFileIO {
  read(): Promise<string | undefined>
  write(content: string): Promise<void>
}

interface StoredSearchPreference {
  version: 2
  defaultProvider: UserSearchProviderId
}

export class SearchPreferenceStore {
  constructor(private readonly fileIO: SearchPreferenceFileIO) {}

  async get(): Promise<SearchPreference> {
    const raw = await this.fileIO.read()
    if (raw === undefined) return { defaultProvider: 'doubao' }
    try {
      const value = JSON.parse(raw) as { version?: unknown; defaultProvider?: unknown }
      if (value.version === 1 && (value.defaultProvider === 'anysearch' || value.defaultProvider === 'tavily')) {
        return { defaultProvider: 'doubao' }
      }
      if (value.version !== 2) throw new Error('version')
      assertUserSearchProvider(value.defaultProvider)
      return { defaultProvider: value.defaultProvider }
    } catch {
      throw new Error('本地搜索偏好文件损坏，请重新选择默认搜索服务。')
    }
  }

  async set(defaultProvider: UserSearchProviderId): Promise<SearchPreference> {
    assertUserSearchProvider(defaultProvider)
    const stored: StoredSearchPreference = { version: 2, defaultProvider }
    await this.fileIO.write(JSON.stringify(stored, null, 2))
    return { defaultProvider }
  }
}
