import type { SearchProviderId } from './search-contract.js'

export type UserSearchProviderId = Extract<SearchProviderId, 'doubao'>

export interface SearchPreference {
  defaultProvider: UserSearchProviderId
}

export type SearchPreferenceResponse =
  | { ok: true; value: SearchPreference }
  | { ok: false; message: string }

export function assertUserSearchProvider(value: unknown): asserts value is UserSearchProviderId {
  if (value !== 'doubao') {
    throw new Error('当前业务搜索服务仅支持豆包搜索 Custom 版。')
  }
}
