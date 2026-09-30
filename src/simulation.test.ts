import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIMULATION_DRAFT,
  isFounderStepComplete,
  isLocationStepComplete,
  isSimulationEngineAvailable,
  loadSimulationDraft,
  saveSimulationDraft,
  stepStatus,
  type SimulationDraft,
} from './simulation'

function stubLocalStorage(): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  return values
}

describe('simulation draft domain', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('第 1 步在地点与业态都填写后才完成', () => {
    stubLocalStorage()
    const draft: SimulationDraft = { ...DEFAULT_SIMULATION_DRAFT, location: { address: '  ', radiusKm: 3 }, venture: { brief: '社区轻餐饮' } }
    expect(isLocationStepComplete(draft)).toBe(false)
    draft.location.address = '上海市临港新片区'
    expect(isLocationStepComplete(draft)).toBe(true)
  })

  it('第 2 步对 0–10 范围内的四通道自评判定完成，越界判定未完成', () => {
    stubLocalStorage()
    expect(isFounderStepComplete(DEFAULT_SIMULATION_DRAFT)).toBe(true)
    const broken: SimulationDraft = { ...DEFAULT_SIMULATION_DRAFT, founder: { ...DEFAULT_SIMULATION_DRAFT.founder, reach: 11 } }
    expect(isFounderStepComplete(broken)).toBe(false)
  })

  it('引擎与报告步骤在引擎接入前恒为 engine-pending，绝不显示完成', () => {
    stubLocalStorage()
    expect(stepStatus(DEFAULT_SIMULATION_DRAFT, 'engine')).toBe('engine-pending')
    expect(stepStatus(DEFAULT_SIMULATION_DRAFT, 'report')).toBe('engine-pending')
    expect(isSimulationEngineAvailable()).toBe(false)
  })

  it('草稿持久化到本机并可恢复默认值合并', () => {
    stubLocalStorage()
    saveSimulationDraft({ ...DEFAULT_SIMULATION_DRAFT, location: { address: '成都市高新区', radiusKm: 5 } })
    const restored = loadSimulationDraft()
    expect(restored?.location.address).toBe('成都市高新区')
    expect(restored?.founder.reach).toBe(DEFAULT_SIMULATION_DRAFT.founder.reach)
  })

  it('损坏的本地草稿返回 undefined 而不是抛错', () => {
    const values = stubLocalStorage()
    values.set('shiji.simulation-draft.v1', '{not-json')
    expect(loadSimulationDraft()).toBeUndefined()
  })

  it('保存不产生任何网络或模型调用（纯本地）', () => {
    stubLocalStorage()
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    saveSimulationDraft(DEFAULT_SIMULATION_DRAFT)
    expect(spy).not.toHaveBeenCalled()
  })
})
