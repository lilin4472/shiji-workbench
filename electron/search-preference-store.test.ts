import { describe, expect, it } from 'vitest'
import { SearchPreferenceStore } from './search-preference-store.js'

describe('search preference store', () => {
  it('defaults to and persists Doubao Custom', async () => {
    let raw: string | undefined
    const store = new SearchPreferenceStore({
      read: async () => raw,
      write: async (content) => { raw = content },
    })

    await expect(store.get()).resolves.toEqual({ defaultProvider: 'doubao' })
    await expect(store.set('doubao')).resolves.toEqual({ defaultProvider: 'doubao' })
    await expect(store.get()).resolves.toEqual({ defaultProvider: 'doubao' })
  })

  it('migrates a legacy paid-search choice without calling the retired provider', async () => {
    const store = new SearchPreferenceStore({
      read: async () => JSON.stringify({ version: 1, defaultProvider: 'tavily' }),
      write: async () => undefined,
    })
    await expect(store.get()).resolves.toEqual({ defaultProvider: 'doubao' })
  })

  it('rejects providers that are not user-selectable business search services', async () => {
    const store = new SearchPreferenceStore({ read: async () => undefined, write: async () => undefined })

    await expect(store.set('deepseek-official' as never)).rejects.toThrow('搜索服务')
  })

  it('fails visibly when the local preference file is corrupted', async () => {
    const store = new SearchPreferenceStore({ read: async () => '{bad json', write: async () => undefined })

    await expect(store.get()).rejects.toThrow('搜索偏好')
  })
})
