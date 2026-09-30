import { describe, expect, it } from 'vitest'
import type { Opportunity } from './agent-contract.js'
import type { EvidenceRecord } from './evidence-contract.js'
import {
  appendToCurrentResults, archiveOpportunity, catalogOpportunitiesByStatus, createOpportunityCatalog, deleteOpportunity,
  ignoreOpportunity, removeEvidenceFromNearbyResults, removeFromCurrentResults, removeStructuralSourceOpportunities, restoreOpportunity, updateCatalogOpportunity,
  catalogNearbyOpportunities, replaceNearbyResults,
} from './opportunity-catalog.js'

const first: Opportunity = {
  id: 'opp-1', title: '项目一', companyId: 'company-1', companyName: '主体一', amountWan: 100,
  locationAddress: null, distanceKm: null, deadline: null, matchScore: 70, projectType: '工程建设', reason: '真实候选',
  evidenceIds: ['ev-1'], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
}
const second: Opportunity = { ...first, id: 'opp-2', title: '项目二', evidenceIds: ['ev-2'] }

describe('opportunity catalog', () => {
  it('keeps nearby search results separate from user-selected overview projects', () => {
    const searched = replaceNearbyResults(createOpportunityCatalog(), [first, second], ['ev-1', 'ev-2'])
    expect(catalogNearbyOpportunities(searched)).toEqual([first, second])
    expect(catalogOpportunitiesByStatus(searched, 'active')).toEqual([])
    const selected = appendToCurrentResults(searched, [first], first.evidenceIds)
    expect(catalogOpportunitiesByStatus(selected, 'active')).toEqual([first])
    const deselected = removeFromCurrentResults(selected, first.id)
    expect(catalogNearbyOpportunities(deselected)).toEqual([first, second])
    const nextSearch = replaceNearbyResults(selected, [second], ['ev-2'])
    expect(catalogNearbyOpportunities(nextSearch)).toEqual([second])
    expect(catalogOpportunitiesByStatus(nextSearch, 'active')).toEqual([first])
    expect(nextSearch.records[first.id]).toEqual(first)
  })
  it('removes only a raw source from the current list while preserving stored evidence references', () => {
    const catalog = replaceNearbyResults(createOpportunityCatalog(), [first], ['ev-1', 'ev-source-only'])
    const next = removeEvidenceFromNearbyResults(catalog, 'ev-source-only')

    expect(next.nearbyEvidenceIds).toEqual(['ev-1'])
    expect(next.records[first.id]?.evidenceIds).toContain('ev-1')
    expect(next.records[first.id]?.evidenceIds).not.toContain('ev-source-only')
    expect(catalog.nearbyEvidenceIds).toEqual(['ev-1', 'ev-source-only'])
  })

  it('keeps archived records when a later search replaces current results', () => {
    const archived = archiveOpportunity(createOpportunityCatalog([first], ['ev-1']), first.id, '2026-09-10T10:00:00.000Z')
    const next = replaceNearbyResults(archived, [second], ['ev-2'])

    expect(catalogNearbyOpportunities(next)).toEqual([second])
    expect(catalogOpportunitiesByStatus(next, 'archived')).toEqual([first])
  })

  it('keeps records referenced by a managed workspace when current search results change', () => {
    const catalog = createOpportunityCatalog([first], ['ev-1'])
    const next = replaceNearbyResults(catalog, [second], ['ev-2'], [first.id])

    expect(next.records[first.id]).toEqual(first)
    expect(next.records[second.id]).toEqual(second)
    expect(catalogOpportunitiesByStatus(next, 'active')).toEqual([first])
    expect(catalogNearbyOpportunities(next)).toEqual([second])
  })

  it('does not resurface an ignored result until the user restores it', () => {
    const ignored = ignoreOpportunity(createOpportunityCatalog([first], ['ev-1']), first.id, '2026-09-10T10:00:00.000Z')
    const searchedAgain = replaceNearbyResults(ignored, [first], ['ev-1'])

    expect(catalogOpportunitiesByStatus(searchedAgain, 'active')).toEqual([])
    expect(catalogOpportunitiesByStatus(searchedAgain, 'ignored')).toEqual([first])
    expect(catalogOpportunitiesByStatus(restoreOpportunity(searchedAgain, first.id), 'active')).toEqual([first])
  })

  it('deletes the local record and reports evidence that became unreferenced', () => {
    const catalog = replaceNearbyResults(createOpportunityCatalog([first], ['ev-1']), [first, second], ['ev-1', 'ev-2'])
    const result = deleteOpportunity(catalog, first.id)

    expect(result.catalog.records[first.id]).toBeUndefined()
    expect(result.catalog.currentResultIds).toEqual([])
    expect(result.catalog.nearbyResultIds).toEqual([second.id])
    expect(result.orphanedEvidenceIds).toEqual(['ev-1'])
  })

  it('updates a stored opportunity without changing its lifecycle state', () => {
    const catalog = archiveOpportunity(createOpportunityCatalog([first]), first.id, '2026-09-10T00:00:00.000Z')
    const updated = updateCatalogOpportunity(catalog, { ...first, evidenceIds: ['ev-1', 'ev-2'] })

    expect(updated.records[first.id]?.evidenceIds).toEqual(['ev-1', 'ev-2'])
    expect(updated.lifecycle[first.id]?.status).toBe('archived')
  })

  it('migrates an old portal/listing card back to evidence instead of keeping it as a project', () => {
    const portal = { ...first, id: 'portal-1', title: '招采信息发布_成都市人民政府', evidenceIds: ['portal-ev'] }
    const evidence: EvidenceRecord = {
      id: 'portal-ev', subject: { kind: 'unknown' }, title: portal.title,
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: { publisher: '成都市人民政府', provenanceType: 'unknown', documentIdentifiers: [], capturedAt: '2026-09-21T00:00:00.000Z', corroboratingEvidenceIds: [] },
      assessment: { status: 'pending', reasons: [], missingChecks: ['当前页面是多项目聚合列表，仅保留为发现线索。'] },
    }

    const migrated = removeStructuralSourceOpportunities(createOpportunityCatalog([portal, second]), [evidence])

    expect(migrated.records['portal-1']).toBeUndefined()
    expect(migrated.records[second.id]).toEqual(second)
    expect(migrated.currentEvidenceIds).toContain('portal-ev')
  })
})

describe('appendToCurrentResults（发现类模块追加进总览，不替换）', () => {
  const make = (id: string) => ({
    id, title: `项目 ${id}`, companyId: `c-${id}`, companyName: `主体 ${id}`, amountWan: null, locationAddress: null,
    distanceKm: null, deadline: null, matchScore: 60, projectType: '工程', reason: 'r', evidenceIds: [`ev-${id}`],
    followUpLevel: '值得验证' as const, confidence: '中' as const, timelineEvidence: [],
  })
  it('追加不会丢掉已有当前结果，并带去重', () => {
    const base = createOpportunityCatalog([make('nearby-1'), make('nearby-2')], ['ev-nearby-1', 'ev-nearby-2'])
    const next = appendToCurrentResults(base, [make('radar-1')], ['ev-radar-1'])
    expect(next.currentResultIds).toEqual(['nearby-1', 'nearby-2', 'radar-1'])
    expect(next.currentEvidenceIds).toEqual(expect.arrayContaining(['ev-nearby-1', 'ev-nearby-2', 'ev-radar-1']))
    // 重复加入同一 id 不产生重复行
    const again = appendToCurrentResults(next, [make('radar-1')], ['ev-radar-1'])
    expect(again.currentResultIds).toEqual(['nearby-1', 'nearby-2', 'radar-1'])
  })
  it('重新加入会把归档/忽略状态清回 active', () => {
    let catalog = createOpportunityCatalog([make('a')], ['ev-a'])
    catalog = archiveOpportunity(catalog, 'a')
    expect(catalogOpportunitiesByStatus(catalog, 'archived').map((item) => item.id)).toEqual(['a'])
    const next = appendToCurrentResults(catalog, [make('a')], ['ev-a'])
    expect(catalogOpportunitiesByStatus(next, 'active').map((item) => item.id)).toEqual(['a'])
    expect(catalogOpportunitiesByStatus(next, 'archived')).toEqual([])
  })
})
