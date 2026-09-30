import { describe, expect, it } from 'vitest'
import type { Opportunity } from './agent-contract.js'
import type { EvidenceRecord } from './evidence-contract.js'
import { emptyBusinessObjectStore, normalizeProjectName, projectBaseTitle, removeOpportunityBusinessObjects, upsertBusinessObjects } from './business-objects.js'

const opportunity: Opportunity = {
  id: 'opportunity-a', title: '示例产业园机电安装工程招标公告', companyId: 'company-a', companyName: '示例建设有限公司',
  amountWan: 2000, locationAddress: '成都市高新区', distanceKm: null, deadline: '2026-10-20', matchScore: 88,
  projectType: '机电安装', reason: '正文命中', evidenceIds: ['web:https://example.gov.cn/tender/1'],
  followUpLevel: '重点跟进', confidence: '高', timelineEvidence: [],
}

function evidence(id: string, identifier: string): EvidenceRecord {
  return {
    id, subject: { kind: 'unknown' }, title: '公告',
    artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
    provenance: {
      pageUrl: id.slice(4), publisher: '示例公共资源交易中心', provenanceType: 'original',
      documentIdentifiers: [{ kind: 'project-number', value: identifier }],
      capturedAt: '2026-09-09T10:00:00.000Z', corroboratingEvidenceIds: [],
    },
    assessment: { status: 'pending', reasons: [], missingChecks: [] },
  }
}

function evidenceWithoutIdentifier(id: string): EvidenceRecord {
  return {
    ...evidence(id, 'placeholder'),
    provenance: { ...evidence(id, 'placeholder').provenance, documentIdentifiers: [] },
  }
}

describe('business object store', () => {
  it('removes a parenthesized stage label without destroying the readable project title', () => {
    expect(projectBaseTitle('临港新片区总部湾变电所工程（中标结果）')).toBe('临港新片区总部湾变电所工程')
    expect(normalizeProjectName('临港新片区总部湾变电所工程（中标结果）')).toBe('临港新片区总部湾变电所工程')
  })

  it('materializes independent company, project and opportunity references', () => {
    const store = upsertBusinessObjects(emptyBusinessObjectStore(), [opportunity], [evidence(opportunity.evidenceIds[0], 'CD-2026-001')], '2026-09-09T10:00:00.000Z')

    expect(Object.values(store.companies)).toEqual([
      expect.objectContaining({ id: 'company-a', name: '示例建设有限公司', evidenceIds: opportunity.evidenceIds }),
    ])
    expect(Object.values(store.projects)).toEqual([
      expect.objectContaining({ companyId: 'company-a', name: opportunity.title, documentIdentifiers: [{ kind: 'project-number', value: 'CD-2026-001' }] }),
    ])
    expect(store.opportunityProjectIds['opportunity-a']).toBe(Object.values(store.projects)[0]?.id)
  })

  it('reuses the same project across a later stage page when the project number matches', () => {
    const first = upsertBusinessObjects(emptyBusinessObjectStore(), [opportunity], [evidence(opportunity.evidenceIds[0], 'CD-2026-001')], '2026-09-09T10:00:00.000Z')
    const laterEvidenceId = 'web:https://example.gov.cn/award/1'
    const later = {
      ...opportunity, id: 'opportunity-b', title: '示例产业园机电安装工程中标结果公告', evidenceIds: [laterEvidenceId],
    }
    const updated = upsertBusinessObjects(first, [later], [evidence(laterEvidenceId, 'CD-2026-001')], '2026-10-20T10:00:00.000Z')

    expect(Object.keys(updated.projects)).toHaveLength(1)
    expect(updated.opportunityProjectIds['opportunity-b']).toBe(updated.opportunityProjectIds['opportunity-a'])
    expect(Object.values(updated.projects)[0].evidenceIds).toEqual(expect.arrayContaining([opportunity.evidenceIds[0], laterEvidenceId]))
  })

  it('reuses the same project across common procurement stage titles when no number is available', () => {
    const firstEvidenceId = 'web:https://example.gov.cn/tender/2'
    const firstOpportunity = {
      ...opportunity, id: 'opportunity-c', title: '临港变电所工程竞争性磋商公告', evidenceIds: [firstEvidenceId],
    }
    const first = upsertBusinessObjects(emptyBusinessObjectStore(), [firstOpportunity], [evidenceWithoutIdentifier(firstEvidenceId)], '2026-01-01T10:00:00.000Z')
    const laterEvidenceId = 'web:https://example.gov.cn/award/2'
    const laterOpportunity = {
      ...opportunity, id: 'opportunity-d', title: '临港变电所工程中标（成交）结果公告', evidenceIds: [laterEvidenceId],
    }
    const updated = upsertBusinessObjects(first, [laterOpportunity], [evidenceWithoutIdentifier(laterEvidenceId)], '2026-02-01T10:00:00.000Z')

    expect(Object.keys(updated.projects)).toHaveLength(1)
    expect(updated.opportunityProjectIds['opportunity-d']).toBe(updated.opportunityProjectIds['opportunity-c'])
  })
})

describe('business object deletion', () => {
  it('removes an orphaned project and company but preserves shared objects', () => {
    const store = {
      version: 1 as const,
      companies: {
        'company-1': { id: 'company-1', name: '主体一', evidenceIds: ['ev-1'], updatedAt: '2026-09-10' },
        'company-2': { id: 'company-2', name: '主体二', evidenceIds: ['ev-2'], updatedAt: '2026-09-10' },
      },
      projects: {
        'project-1': { id: 'project-1', companyId: 'company-1', name: '项目一', normalizedName: '项目一', documentIdentifiers: [], evidenceIds: ['ev-1'], updatedAt: '2026-09-10' },
        'project-2': { id: 'project-2', companyId: 'company-2', name: '项目二', normalizedName: '项目二', documentIdentifiers: [], evidenceIds: ['ev-2'], updatedAt: '2026-09-10' },
      },
      opportunityProjectIds: { 'opp-1': 'project-1', 'opp-2': 'project-2' },
    }

    expect(removeOpportunityBusinessObjects(store, 'opp-1')).toEqual({
      version: 1,
      companies: { 'company-2': store.companies['company-2'] },
      projects: { 'project-2': store.projects['project-2'] },
      opportunityProjectIds: { 'opp-2': 'project-2' },
    })
  })
})
