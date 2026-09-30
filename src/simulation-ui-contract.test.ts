import { describe, expect, it } from 'vitest'
import panelSource from './components/SimulationPanel.tsx?raw'
import viewSource from './components/SimulationView.tsx?raw'

describe('simulation placeholder contract', () => {
  it('shows only the deferred-product message instead of the local simulation form', () => {
    expect(panelSource).toContain('功能开发中，敬请期待')
    expect(viewSource).toContain('功能开发中，敬请期待')
    expect(viewSource).not.toContain('<input')
    expect(viewSource).not.toContain('<textarea')
    expect(viewSource).not.toContain('开始仿真')
  })
})
