import { describe, expect, it } from 'vitest'
import { addObjectToBucket, canDropObject, MAX_COMPARE_PROJECTS, removeLegacyMockObjects, removeProjectFromBucket, selectBucketProjects } from './drag'
import type { Opportunity } from './domain'

const opportunity = { kind: 'opportunity', id: 'opp-1', title: '项目一' } as const
const recommendation = { kind: 'recommendation', id: 'rec-1', title: '建设单位' } as const

describe('business object drag rules', () => {
  it('allows opportunities in every management bucket', () => {
    expect((['focus', 'compare', 'action'] as const).every((bucket) => canDropObject(opportunity, bucket))).toBe(true)
  })

  it('only allows recommendations to become actions', () => {
    expect(canDropObject(recommendation, 'focus')).toBe(false)
    expect(canDropObject(recommendation, 'action')).toBe(true)
  })

  it('keeps one reference for the same object', () => {
    expect(addObjectToBucket(addObjectToBucket([], opportunity), opportunity)).toHaveLength(1)
  })

  it('removes old demo opportunities without deleting real managed objects', () => {
    expect(removeLegacyMockObjects([opportunity, { kind: 'opportunity', id: 'opp-lingang-001', title: '旧演示项目' }]))
      .toEqual([opportunity])
  })

  it('selects at most three real projects from a comparison bucket in insertion order', () => {
    const opportunities = Array.from({ length: 4 }, (_, index) => ({ id: `opp-${index + 1}`, title: `项目${index + 1}` })) as Opportunity[]
    const objects = opportunities.map((item) => ({ kind: 'opportunity' as const, id: item.id, title: item.title }))
    expect(MAX_COMPARE_PROJECTS).toBe(3)
    expect(selectBucketProjects(opportunities, objects, MAX_COMPARE_PROJECTS).map((item) => item.id)).toEqual(['opp-1', 'opp-2', 'opp-3'])
  })

  it('removes only the requested project relationship from a bucket', () => {
    const second = { kind: 'opportunity', id: 'opp-2', title: '项目二' } as const
    expect(removeProjectFromBucket([opportunity, second], opportunity.id)).toEqual([second])
  })
})
