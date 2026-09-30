import { describe, expect, it } from 'vitest'
import {
  assessmentPermits,
  isEvidenceRecord,
  searchSourceToEvidenceRecord,
  toEvidenceRecord,
  type EvidenceRecord,
  type LocalEvidenceRecord,
} from './evidence-contract.js'

describe('unified evidence contract', () => {
  it('converts an imported local file without pretending that its content or provenance is verified', () => {
    const local: LocalEvidenceRecord = {
      id: 'local-001',
      subjectName: '示例建设发展有限公司',
      fileName: '行政处罚决定书.pdf',
      extension: '.pdf',
      mediaKind: 'pdf',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
      importedAt: '2026-09-06T08:00:00.000Z',
      processingStatus: 'stored-unparsed',
    }

    const unified = toEvidenceRecord(local)

    expect(unified).toMatchObject({
      id: 'local-001',
      title: '行政处罚决定书.pdf',
      subject: { kind: 'company', name: '示例建设发展有限公司' },
      artifact: {
        origin: 'local-file',
        mediaKind: 'pdf',
        processingStatus: 'stored-unparsed',
      },
      provenance: {
        publisher: '用户本地导入',
        provenanceType: 'unknown',
        contentHash: `sha256:${'a'.repeat(64)}`,
      },
      assessment: { status: 'pending' },
    })
    expect(isEvidenceRecord(unified)).toBe(true)
    expect(assessmentPermits(unified.assessment, 'credit-confirmation')).toBe(false)
  })

  it('keeps evidence grade separate from the business use it may support', () => {
    const repost: EvidenceRecord = {
      id: 'web-001',
      subject: { kind: 'project', id: 'project-001', name: '园区改造项目' },
      title: '园区改造项目中标结果转载',
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: {
        pageUrl: 'https://media.example/repost',
        publisher: '示例权威行业媒体',
        originalPublisher: '示例公共资源交易中心',
        originalUrl: 'https://trade.example/original',
        provenanceType: 'explicit-repost',
        documentIdentifiers: [{ kind: 'project-number', value: 'XM-2026-001' }],
        capturedAt: '2026-09-06T08:00:00.000Z',
        corroboratingEvidenceIds: [],
      },
      assessment: {
        status: 'assessed',
        claimType: 'project-stage',
        grade: 'B',
        permittedUses: ['discovery', 'report-candidate', 'stage-confirmation', 'credit-candidate'],
        reasons: ['原发布单位、项目编号和原文链接完整。'],
        missingChecks: [],
        assessedAt: '2026-09-06T08:05:00.000Z',
      },
    }

    expect(isEvidenceRecord(repost)).toBe(true)
    expect(assessmentPermits(repost.assessment, 'stage-confirmation')).toBe(true)
    expect(assessmentPermits(repost.assessment, 'credit-confirmation')).toBe(false)
  })

  it('rejects an assessed record that has no grade or explicit permitted uses', () => {
    const invalid = {
      id: 'bad-001',
      subject: { kind: 'company', name: '示例公司' },
      title: '不完整记录',
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: {
        pageUrl: 'https://example.com',
        publisher: '示例来源',
        provenanceType: 'unknown',
        documentIdentifiers: [],
        capturedAt: '2026-09-06T08:00:00.000Z',
        corroboratingEvidenceIds: [],
      },
      assessment: { status: 'assessed', reasons: [], missingChecks: [] },
    }

    expect(isEvidenceRecord(invalid)).toBe(false)
  })

  it('turns a provider search hit into pending evidence without inferring authority from its domain class', () => {
    const record = searchSourceToEvidenceRecord({
      url: 'https://ggzyjy.sc.gov.cn/item/1',
      sourceClass: 'government',
      title: '建设项目招标公告',
      content: '公告正文',
      publishedAt: '2026-09-05',
    }, {
      provider: 'doubao',
      query: '成都 施工 招标公告',
      capturedAt: '2026-09-06T09:00:00.000Z',
    })

    expect(record).toMatchObject({
      subject: { kind: 'unknown' },
      artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
      provenance: {
        pageUrl: 'https://ggzyjy.sc.gov.cn/item/1',
        publisher: 'ggzyjy.sc.gov.cn',
        provenanceType: 'unknown',
        publishedAt: '2026-09-05',
      },
      discovery: {
        provider: 'doubao',
        query: '成都 施工 招标公告',
        providerSourceClass: 'government',
      },
      assessment: { status: 'pending' },
    })
    expect(assessmentPermits(record.assessment, 'stage-confirmation')).toBe(false)
    expect(isEvidenceRecord(record)).toBe(true)
  })

  it('carries parsed local provenance candidates into pending unified evidence', () => {
    const local: LocalEvidenceRecord = {
      id: 'local-002',
      subjectName: '示例建设发展有限公司',
      fileName: '转载公告.html',
      extension: '.html',
      mediaKind: 'html',
      sizeBytes: 4096,
      sha256: 'b'.repeat(64),
      importedAt: '2026-09-06T08:00:00.000Z',
      processingStatus: 'content-ready',
      extraction: {
        textCharacters: 1200,
        title: '园区改造项目招标公告',
        publisherCandidate: '示例行业媒体',
        originalPublisherCandidate: '示例公共资源交易中心',
        originalUrlCandidate: 'https://trade.example.gov.cn/original',
        provenanceTypeCandidate: 'explicit-repost',
        documentIdentifiers: [{ kind: 'project-number', value: 'XM-2026-001' }],
        publishedAtCandidate: '2026-09-05',
        truncated: false,
        warnings: [],
      },
    }

    const unified = toEvidenceRecord(local)

    expect(unified).toMatchObject({
      title: '园区改造项目招标公告',
      artifact: { processingStatus: 'content-ready' },
      provenance: {
        publisher: '示例行业媒体',
        originalPublisher: '示例公共资源交易中心',
        originalUrl: 'https://trade.example.gov.cn/original',
        provenanceType: 'explicit-repost',
        documentIdentifiers: [{ kind: 'project-number', value: 'XM-2026-001' }],
        publishedAt: '2026-09-05',
      },
      assessment: { status: 'pending' },
    })
    expect(assessmentPermits(unified.assessment, 'stage-confirmation')).toBe(false)
    expect(isEvidenceRecord(unified)).toBe(true)
  })
})
