import { describe, expect, it } from 'vitest'
import { assertBusinessGraph, deriveLeadCandidates, type BusinessGraph } from './business-graph.js'

const graph: BusinessGraph = {
  project: { id: 'project-1', kind: 'project', name: '园区机电项目', region: '成都' },
  companies: [
    { id: 'company-owner', kind: 'company', name: '示例产业集团', region: '成都' },
    { id: 'company-supplier', kind: 'company', name: '示例设备公司', region: '成都' },
  ],
  relationships: [
    {
      id: 'rel-owner', sourceEntityId: 'company-owner', targetEntityId: 'project-1',
      type: 'project-owner', confidence: 'confirmed', evidenceIds: ['ev-owner'], summary: '公告列明招标人。',
    },
    {
      id: 'rel-supplier', sourceEntityId: 'company-supplier', targetEntityId: 'company-owner',
      type: 'supplies-to', confidence: 'discovery-clue', evidenceIds: ['ev-supply'], summary: '历史项目出现的供应关系线索。',
    },
  ],
  contacts: [{
    id: 'contact-owner-phone', entityId: 'company-owner', kind: 'phone', value: '028-12345678',
    label: '项目公开联系电话', personName: '张老师', role: '项目联系人',
    context: 'public-professional', status: 'source-observed', evidenceId: 'ev-owner',
  }],
}

describe('business graph contract', () => {
  it('keeps group or industry clues usable while requiring every relationship and contact to cite evidence', () => {
    expect(() => assertBusinessGraph(graph, new Set(['ev-owner', 'ev-supply']))).not.toThrow()
    expect(() => assertBusinessGraph({
      ...graph,
      contacts: [{ ...graph.contacts[0], evidenceId: 'invented-evidence' }],
    }, new Set(['ev-owner', 'ev-supply']))).toThrow('证据')
  })

  it('derives lead cards from graph relationships and copies only source-observed contact values', () => {
    const leads = deriveLeadCandidates(graph, 'opp-1')

    expect(leads.find((lead) => lead.entityId === 'company-owner')).toMatchObject({
      opportunityId: 'opp-1', company: '示例产业集团', relationshipIds: expect.arrayContaining(['rel-owner']),
      channel: '张老师 · 028-12345678', contactPointIds: ['contact-owner-phone'],
    })
    expect(leads.find((lead) => lead.entityId === 'company-supplier')).toMatchObject({
      priority: 'C', channel: '公开联系方式待提取', relationshipIds: ['rel-supplier'],
    })
  })

  it('rejects dangling graph nodes instead of letting the UI invent missing companies', () => {
    expect(() => assertBusinessGraph({
      ...graph,
      relationships: [{ ...graph.relationships[0], sourceEntityId: 'missing-company' }],
    })).toThrow('主体')
  })
})
