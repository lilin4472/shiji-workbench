import type { DropBucket, ManagedObject, Opportunity } from './domain'

export const MAX_COMPARE_PROJECTS = 3

const LEGACY_MOCK_OPPORTUNITY_IDS = new Set(['opp-lingang-001', 'opp-hospital-002', 'opp-logistics-003'])

export function canDropObject(object: ManagedObject, bucket: DropBucket) {
  if (object.kind === 'opportunity') return true
  return bucket === 'action'
}

export function addObjectToBucket(items: ManagedObject[], object: ManagedObject) {
  return items.some((item) => item.kind === object.kind && item.id === object.id) ? items : [...items, object]
}

/** 按桶内放入顺序解析真实项目；失效引用、重复引用不会进入页面。 */
export function selectBucketProjects(opportunities: Opportunity[], objects: ManagedObject[], limit = Number.POSITIVE_INFINITY): Opportunity[] {
  const byId = new Map(opportunities.map((item) => [item.id, item]))
  const selectedIds: string[] = []
  for (const object of objects) {
    const opportunityId = object.opportunityId ?? (object.kind === 'opportunity' ? object.id : undefined)
    if (!opportunityId || selectedIds.includes(opportunityId) || !byId.has(opportunityId)) continue
    selectedIds.push(opportunityId)
    if (selectedIds.length >= limit) break
  }
  return selectedIds.map((id) => byId.get(id)!)
}

/** 只移除桶内指向该项目的关系；项目、证据与分析结果不受影响。 */
export function removeProjectFromBucket(objects: ManagedObject[], opportunityId: string): ManagedObject[] {
  return objects.filter((object) => {
    const linkedId = object.opportunityId ?? (object.kind === 'opportunity' ? object.id : undefined)
    return linkedId !== opportunityId
  })
}

export function removeLegacyMockObjects(items: ManagedObject[]): ManagedObject[] {
  return items.filter((item) => item.kind !== 'opportunity' || !LEGACY_MOCK_OPPORTUNITY_IDS.has(item.id))
}
