import { isOpportunity, type Opportunity } from './agent-contract.js'
import type { EvidenceRecord } from './evidence-contract.js'

export const OPPORTUNITY_LIFECYCLE_STATUSES = ['active', 'archived', 'ignored'] as const
export type OpportunityLifecycleStatus = typeof OPPORTUNITY_LIFECYCLE_STATUSES[number]

export interface OpportunityLifecycleState {
  status: OpportunityLifecycleStatus
  updatedAt: string
}

export interface OpportunityCatalog {
  version: 1
  records: Record<string, Opportunity>
  currentResultIds: string[]
  currentEvidenceIds: string[]
  /** Search hits are not overview selections. Optional only for older saved catalogs. */
  nearbyResultIds?: string[]
  nearbyEvidenceIds?: string[]
  lifecycle: Record<string, OpportunityLifecycleState>
}

export function createOpportunityCatalog(opportunities: Opportunity[] = [], evidenceIds: string[] = []): OpportunityCatalog {
  return {
    version: 1,
    records: Object.fromEntries(opportunities.map((item) => [item.id, item])),
    currentResultIds: opportunities.map((item) => item.id),
    currentEvidenceIds: unique(evidenceIds),
    nearbyResultIds: [],
    nearbyEvidenceIds: [],
    lifecycle: {},
  }
}

export function isOpportunityCatalog(value: unknown): value is OpportunityCatalog {
  if (!value || typeof value !== 'object') return false
  const catalog = value as Partial<OpportunityCatalog>
  if (catalog.version !== 1 || !catalog.records || !catalog.lifecycle
    || !Array.isArray(catalog.currentResultIds) || !Array.isArray(catalog.currentEvidenceIds)) return false
  return Object.values(catalog.records).every(isOpportunity)
    && catalog.currentResultIds.every((id) => typeof id === 'string' && Boolean(catalog.records?.[id]))
    && catalog.currentEvidenceIds.every((id) => typeof id === 'string')
    && (catalog.nearbyResultIds === undefined || Array.isArray(catalog.nearbyResultIds) && catalog.nearbyResultIds.every((id) => typeof id === 'string' && Boolean(catalog.records?.[id])))
    && (catalog.nearbyEvidenceIds === undefined || Array.isArray(catalog.nearbyEvidenceIds) && catalog.nearbyEvidenceIds.every((id) => typeof id === 'string'))
    && Object.entries(catalog.lifecycle).every(([id, state]) => Boolean(catalog.records?.[id]) && isLifecycleState(state))
}

/** Replace only the nearby discovery list. Existing overview choices and managed records survive. */
export function replaceNearbyResults(catalog: OpportunityCatalog, opportunities: Opportunity[], evidenceIds: string[], preserveRecordIds: string[] = []): OpportunityCatalog {
  const preservedIds = new Set([...catalog.currentResultIds, ...preserveRecordIds])
  const records = Object.fromEntries(Object.entries(catalog.records).filter(([id]) => {
    const status = catalog.lifecycle[id]?.status ?? 'active'
    return status !== 'active' || preservedIds.has(id)
  }))
  for (const item of opportunities) records[item.id] = item
  return {
    ...catalog,
    records,
    lifecycle: Object.fromEntries(Object.entries(catalog.lifecycle).filter(([id]) => Boolean(records[id]))),
    nearbyResultIds: unique(opportunities.map((item) => item.id)),
    nearbyEvidenceIds: unique(evidenceIds),
  }
}

export function catalogNearbyOpportunities(catalog: OpportunityCatalog): Opportunity[] {
  return (catalog.nearbyResultIds ?? []).flatMap((id) => {
    const item = catalog.records[id]
    return item && (catalog.lifecycle[id]?.status ?? 'active') === 'active' ? [item] : []
  })
}

export function catalogOpportunitiesByStatus(catalog: OpportunityCatalog, status: OpportunityLifecycleStatus): Opportunity[] {
  const ids = status === 'active' ? catalog.currentResultIds : Object.keys(catalog.records)
  return ids.flatMap((id) => {
    const item = catalog.records[id]
    const itemStatus = catalog.lifecycle[id]?.status ?? 'active'
    return item && itemStatus === status ? [item] : []
  })
}

/**
 * 追加进当前结果集（**不替换**）：发现类模块（商机雷达）把对象并入总览时用。
 * - 原有当前结果全部保留；同一 id 重复加入不会产生重复行；
 * - 重新加入 = 回到 active（清掉该 id 的归档/忽略状态）；
 * - 同时把对象的证据 id 并入 currentEvidenceIds，保证详情/模块分析能取到证据。
 */
export function appendToCurrentResults(catalog: OpportunityCatalog, opportunities: Opportunity[], evidenceIds: string[] = []): OpportunityCatalog {
  if (opportunities.length === 0) return catalog
  const records = { ...catalog.records }
  const lifecycle = { ...catalog.lifecycle }
  for (const item of opportunities) {
    records[item.id] = item
    delete lifecycle[item.id]
  }
  return {
    version: 1,
    records,
    currentResultIds: unique([...catalog.currentResultIds, ...opportunities.map((item) => item.id)]),
    currentEvidenceIds: unique([...catalog.currentEvidenceIds, ...evidenceIds]),
    nearbyResultIds: catalog.nearbyResultIds ?? [],
    nearbyEvidenceIds: catalog.nearbyEvidenceIds ?? [],
    lifecycle,
  }
}
/** 从当前结果集移出（保留 records 与证据）：取消勾选"加入总览"时用，只影响总览列表。 */
export function removeFromCurrentResults(catalog: OpportunityCatalog, id: string): OpportunityCatalog {
  if (!catalog.currentResultIds.includes(id)) return catalog
  return { ...catalog, currentResultIds: catalog.currentResultIds.filter((entry) => entry !== id) }
}
/** Remove a nearby source card without deleting stored evidence or project references. */
export function removeEvidenceFromNearbyResults(catalog: OpportunityCatalog, evidenceId: string): OpportunityCatalog {
  if (!catalog.nearbyEvidenceIds?.includes(evidenceId)) return catalog
  return { ...catalog, nearbyEvidenceIds: catalog.nearbyEvidenceIds.filter((entry) => entry !== evidenceId) }
}
export function archiveOpportunity(catalog: OpportunityCatalog, id: string, updatedAt = new Date().toISOString()): OpportunityCatalog {
  return setLifecycle(catalog, id, 'archived', updatedAt)
}

export function ignoreOpportunity(catalog: OpportunityCatalog, id: string, updatedAt = new Date().toISOString()): OpportunityCatalog {
  return setLifecycle(catalog, id, 'ignored', updatedAt)
}

export function restoreOpportunity(catalog: OpportunityCatalog, id: string): OpportunityCatalog {
  if (!catalog.records[id]) return catalog
  const lifecycle = { ...catalog.lifecycle }
  delete lifecycle[id]
  return { ...catalog, lifecycle, currentResultIds: unique([...catalog.currentResultIds, id]) }
}

export function updateCatalogOpportunity(catalog: OpportunityCatalog, opportunity: Opportunity): OpportunityCatalog {
  if (!catalog.records[opportunity.id]) return catalog
  return { ...catalog, records: { ...catalog.records, [opportunity.id]: opportunity } }
}

/**
 * Version migration for cards created before SearchHit/Opportunity separation:
 * a record supported only by portal or multi-project listing evidence is not a
 * business project. Keep its evidence visible, but remove the draggable project.
 */
export function removeStructuralSourceOpportunities(catalog: OpportunityCatalog, evidenceRecords: EvidenceRecord[]): OpportunityCatalog {
  const structuralEvidenceIds = new Set(evidenceRecords.filter((record) => record.assessment.missingChecks
    .some((reason) => /(?:多项目聚合列表|平台或门户首页)/.test(reason))).map((record) => record.id))
  const rejectedIds = Object.values(catalog.records).filter((opportunity) => opportunity.evidenceIds.length > 0
    && opportunity.evidenceIds.every((id) => structuralEvidenceIds.has(id))).map((opportunity) => opportunity.id)
  if (rejectedIds.length === 0) return catalog
  const rejected = new Set(rejectedIds)
  const records = Object.fromEntries(Object.entries(catalog.records).filter(([id]) => !rejected.has(id)))
  const lifecycle = Object.fromEntries(Object.entries(catalog.lifecycle).filter(([id]) => !rejected.has(id)))
  return {
    ...catalog,
    records,
    lifecycle,
    currentResultIds: catalog.currentResultIds.filter((id) => !rejected.has(id)),
    nearbyResultIds: (catalog.nearbyResultIds ?? []).filter((id) => !rejected.has(id)),
    // Discovery evidence remains visible and can still be opened by the user.
    currentEvidenceIds: unique([...catalog.currentEvidenceIds, ...structuralEvidenceIds]),
    nearbyEvidenceIds: unique([...(catalog.nearbyEvidenceIds ?? []), ...structuralEvidenceIds]),
  }
}

export function deleteOpportunity(catalog: OpportunityCatalog, id: string): { catalog: OpportunityCatalog; orphanedEvidenceIds: string[] } {
  const target = catalog.records[id]
  if (!target) return { catalog, orphanedEvidenceIds: [] }
  const records = { ...catalog.records }
  delete records[id]
  const lifecycle = { ...catalog.lifecycle }
  delete lifecycle[id]
  const referencedEvidence = new Set(Object.values(records).flatMap((item) => item.evidenceIds))
  const orphanedEvidenceIds = target.evidenceIds.filter((evidenceId) => !referencedEvidence.has(evidenceId))
  const orphaned = new Set(orphanedEvidenceIds)
  return {
    catalog: {
      ...catalog,
      records,
      lifecycle,
      currentResultIds: catalog.currentResultIds.filter((itemId) => itemId !== id),
      nearbyResultIds: (catalog.nearbyResultIds ?? []).filter((itemId) => itemId !== id),
      currentEvidenceIds: catalog.currentEvidenceIds.filter((eId) => !orphaned.has(eId)),
      nearbyEvidenceIds: (catalog.nearbyEvidenceIds ?? []).filter((eId) => !orphaned.has(eId)),
    },
    orphanedEvidenceIds,
  }
}

function setLifecycle(catalog: OpportunityCatalog, id: string, status: OpportunityLifecycleStatus, updatedAt: string): OpportunityCatalog {
  if (!catalog.records[id]) return catalog
  return { ...catalog, lifecycle: { ...catalog.lifecycle, [id]: { status, updatedAt } } }
}

function isLifecycleState(value: unknown): value is OpportunityLifecycleState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<OpportunityLifecycleState>
  return OPPORTUNITY_LIFECYCLE_STATUSES.includes(state.status as OpportunityLifecycleStatus)
    && typeof state.updatedAt === 'string' && !Number.isNaN(Date.parse(state.updatedAt))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
