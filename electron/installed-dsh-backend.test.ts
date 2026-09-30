import { describe, expect, it } from 'vitest'
import { DSH_MODEL_ONLY_CORDIS_CONFIG } from './installed-dsh-backend'

describe('DSH model-only product configuration', () => {
  it('disables command, skill and workspace tools before real API testing', () => {
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('workspaceContext: false')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('enabled: false')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('toolBash: false')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('toolJobs: false')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('thinking: disabled')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).toContain('reasoningEffort: off')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).not.toContain('dsh-bash-local')
    expect(DSH_MODEL_ONLY_CORDIS_CONFIG).not.toContain('dsh-subprocess-local')
  })
})
