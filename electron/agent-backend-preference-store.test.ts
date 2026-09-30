import { describe, expect, it } from 'vitest'
import { AgentBackendPreferenceStore } from './agent-backend-preference-store.js'

describe('agent backend preference store', () => {
  it('defaults to DSH and persists an explicit selection', async () => {
    let raw: string | undefined
    const store = new AgentBackendPreferenceStore({ read: async () => raw, write: async (value) => { raw = value } })

    await expect(store.get()).resolves.toBe('dsh')
    await store.set('dsh')
    await expect(store.get()).resolves.toBe('dsh')
  })
})
