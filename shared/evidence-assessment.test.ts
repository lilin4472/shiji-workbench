import { describe, expect, it } from 'vitest'
import { assessmentPermits, type EvidenceRecord } from './evidence-contract.js'
import { assessEvidenceRecord, type EvidenceAssessmentFacts, type PublisherProfile } from './evidence-assessment.js'

const highAuthority: PublisherProfile = { role: 'transaction-platform', reputation: 'high' }
const reputableCommercial: PublisherProfile = { role: 'commercial-media', reputation: 'high' }

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 'web-001',
    subject: { kind: 'project', id: 'project-001', name: '园区改造项目' },
    title: '园区改造项目中标结果',
    artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
    provenance: {
      pageUrl: 'https://source.example/item/1',
      publisher: '示例发布者',
      provenanceType: 'unknown',
      documentIdentifiers: [],
      publishedAt: '2026-09-05',
      capturedAt: '2026-09-06T08:00:00.000Z',
      corroboratingEvidenceIds: [],
    },
    assessment: { status: 'pending', reasons: [], missingChecks: [] },
    ...overrides,
  }
}

function completeFacts(overrides: Partial<EvidenceAssessmentFacts> = {}): EvidenceAssessmentFacts {
  return {
    claimType: 'project-stage',
    publisher: highAuthority,
    originalSourceConfirmed: true,
    subjectIdentityConfirmed: true,
    recordIdentityConfirmed: true,
    eventDateConfirmed: true,
    keyContentConsistent: true,
    currentStatusConfirmed: false,
    ...overrides,
  }
}

describe('evidence assessment policy', () => {
  it('grades a confirmed original transaction-platform notice as A and permits stage confirmation', () => {
    const assessed = assessEvidenceRecord(record({
      provenance: { ...record().provenance, provenanceType: 'original' },
    }), completeFacts(), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', claimType: 'project-stage', grade: 'A' })
    expect(assessmentPermits(assessed.assessment, 'stage-confirmation')).toBe(true)
  })

  it('grades a fully traceable reputable commercial repost as B and permits stage confirmation', () => {
    const assessed = assessEvidenceRecord(record({
      provenance: {
        ...record().provenance,
        publisher: '示例高信誉商业媒体',
        originalPublisher: '示例公共资源交易中心',
        originalUrl: 'https://trade.example/original',
        provenanceType: 'explicit-repost',
        documentIdentifiers: [{ kind: 'project-number', value: 'XM-2026-001' }],
      },
    }), completeFacts({ publisher: reputableCommercial }), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', grade: 'B' })
    expect(assessmentPermits(assessed.assessment, 'stage-confirmation')).toBe(true)
  })

  it('keeps reputable reporting without a complete original chain at C candidate level', () => {
    const assessed = assessEvidenceRecord(record({
      provenance: { ...record().provenance, provenanceType: 'reported-summary' },
    }), completeFacts({ publisher: reputableCommercial, originalSourceConfirmed: false }), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', grade: 'C' })
    expect(assessmentPermits(assessed.assessment, 'report-candidate')).toBe(true)
    expect(assessmentPermits(assessed.assessment, 'stage-confirmation')).toBe(false)
  })

  it('keeps an untraceable aggregator hit at D discovery level even when the provider called its domain governmental', () => {
    const assessed = assessEvidenceRecord(record({
      provenance: { ...record().provenance, provenanceType: 'aggregator' },
      discovery: { provider: 'doubao', query: '园区改造 中标', providerSourceClass: 'government' },
    }), completeFacts({ publisher: { role: 'aggregator', reputation: 'unknown' }, originalSourceConfirmed: false }), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', grade: 'D', permittedUses: ['discovery'] })
  })

  it('permits credit confirmation only for an A-level original record with current status confirmed', () => {
    const assessed = assessEvidenceRecord(record({
      subject: { kind: 'company', id: 'company-001', name: '示例建设发展有限公司' },
      provenance: { ...record().provenance, provenanceType: 'original' },
    }), completeFacts({ claimType: 'business-credit', currentStatusConfirmed: true }), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', grade: 'A' })
    expect(assessmentPermits(assessed.assessment, 'credit-confirmation')).toBe(true)
  })

  it('keeps a traceable B-level credit repost as a candidate, never a confirmed credit fact', () => {
    const assessed = assessEvidenceRecord(record({
      subject: { kind: 'company', id: 'company-001', name: '示例建设发展有限公司' },
      provenance: {
        ...record().provenance,
        originalPublisher: '示例市场监管部门',
        originalUrl: 'https://regulator.example/original',
        provenanceType: 'explicit-repost',
        documentIdentifiers: [{ kind: 'document-number', value: '处罚字〔2026〕1号' }],
      },
    }), completeFacts({ claimType: 'business-credit', publisher: reputableCommercial, currentStatusConfirmed: true }), '2026-09-06T09:00:00.000Z')

    expect(assessed.assessment).toMatchObject({ status: 'assessed', grade: 'B' })
    expect(assessmentPermits(assessed.assessment, 'credit-candidate')).toBe(true)
    expect(assessmentPermits(assessed.assessment, 'credit-confirmation')).toBe(false)
  })
})
