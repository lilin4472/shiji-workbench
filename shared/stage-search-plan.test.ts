import { describe, expect, it } from 'vitest'
import { buildDiscoveryStageSearchPlan, buildNearbyEnterpriseSearchPlan, buildTimelineStageSearchPlan, buildWatchStageSearchPlan } from './stage-search-plan.js'

describe('stage search plan', () => {
  it('searches all stages with the base project title instead of a current-stage suffix', () => {
    const plan = buildTimelineStageSearchPlan('临港变电所工程（中标结果）', '临港建设有限公司')

    expect(plan.query).toContain('"临港变电所工程"')
    expect(plan.query).not.toContain('"临港变电所工程（中标结果）"')
  })

  it('builds one cost-bounded query for the selected discovery stage', () => {
    const plan = buildDiscoveryStageSearchPlan({
      address: '成都', specialty: '机电安装', projectType: '不限', targetStageId: 'tender',
    })

    expect(plan.targetStageId).toBe('tender')
    expect(plan.maxCalls).toBe(1)
    expect(plan.query).toContain('招标公告')
    expect(plan.query).toContain('成都')
    expect(plan.acceptedSourceTiers).toEqual(['primary', 'owner'])
  })

  it('keeps all-stage discovery to one broad query instead of seven calls', () => {
    const plan = buildDiscoveryStageSearchPlan({
      address: '上海', specialty: '消防改造', projectType: '工程改造', targetStageId: 'all',
    })

    expect(plan.maxCalls).toBe(1)
    expect(plan.query).toContain('采购意向')
    expect(plan.query).toContain('招标公告')
    expect(plan.query).toContain('中标结果')
  })

  it('quotes visible company and project targets in the paid search query', () => {
    const plan = buildDiscoveryStageSearchPlan({
      address: '上海', specialty: '机电安装', projectType: '不限', targetStageId: 'all',
      targetCompanyName: '上海临港建设有限公司', targetProjectName: '总部湾区域公园变电所工程',
    })

    expect(plan.query).toContain('"上海临港建设有限公司"')
    expect(plan.query).toContain('"总部湾区域公园变电所工程"')
  })

  it('uses a broad current-year hint and applies the exact window locally', () => {
    const plan = buildDiscoveryStageSearchPlan({
      address: '成都', specialty: '机电安装', projectType: '不限', timeWindow: '近10天', targetStageId: 'tender',
    })

    expect(plan.query).toContain('2026')
    expect(plan.query).toContain('最新')
    expect(plan.query).not.toContain('近10天')
  })

  it('builds a separate nearby enterprise query without pretending the search engine can enforce a radius', () => {
    const plan = buildNearbyEnterpriseSearchPlan({
      address: '成都高新区天府三街', radiusKm: 30, specialty: '机电安装', projectType: '不限', targetStageId: 'tender',
    }, 2026)

    expect(plan.purpose).toBe('nearby-enterprise')
    expect(plan.centerAddress).toBe('成都高新区天府三街')
    expect(plan.radiusKm).toBe(30)
    expect(plan.requiresLocalDistance).toBe(true)
    expect(plan.maxCalls).toBe(1)
    expect(plan.query).toContain('成都高新区天府三街')
    expect(plan.query).toContain('2026')
    expect(plan.query).toContain('最新')
    expect(plan.query).not.toContain('30公里')
  })

  it('checks only the next stage when a subscribed project is revalidated', () => {
    const plan = buildWatchStageSearchPlan('临港科创园二期机电安装工程', 'intention')

    expect(plan.targetStageId).toBe('tender')
    expect(plan.query).toContain('临港科创园二期机电安装工程')
    expect(plan.query).toContain('招标公告')
    expect(plan.query).toContain('采购意向')
    expect(plan.query).toContain('更正')
    expect(plan.maxCalls).toBe(1)
  })

  it('builds one broad but project-bound query for manual timeline completion', () => {
    const plan = buildTimelineStageSearchPlan('临港科创园二期机电安装工程', '临港建设有限公司')

    expect(plan.purpose).toBe('timeline')
    expect(plan.targetStageId).toBe('all')
    expect(plan.maxCalls).toBe(1)
    expect(plan.query).toContain('"临港科创园二期机电安装工程"')
    expect(plan.query).toContain('采购意向')
    expect(plan.query).toContain('合同公告')
  })

  it('checks contract evidence after an award without claiming the contract exists', () => {
    const plan = buildWatchStageSearchPlan('医院改扩建项目', 'award')
    expect(plan.targetStageId).toBe('contract')
    expect(plan.query).toContain('合同公告')
  })
})
