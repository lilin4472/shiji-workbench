import { describe, expect, it } from 'vitest'
import type { Opportunity } from '../shared/agent-contract.js'
import type { CreditRiskResult } from '../shared/credit-risk.js'
import type { EvidenceRecord } from '../shared/evidence-contract.js'
import { buildCompareRows } from './compare-summary.js'

const project = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'project-1', title: '设备采购项目', companyId: 'company-1', companyName: '主体待核验', amountWan: null,
  locationAddress: null, distanceKm: null, deadline: null, matchScore: 72, projectType: '采购', reason: '命中项目来源',
  evidenceIds: ['evidence-1'], followUpLevel: '值得验证', confidence: '中低', timelineEvidence: [], ...overrides,
})

const source = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: 'evidence-1', subject: { kind: 'opportunity', id: 'project-1' }, title: '设备采购公告',
  artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
  provenance: { pageUrl: 'https://example.gov.cn/notice', publisher: '公共资源交易中心', provenanceType: 'original', documentIdentifiers: [], capturedAt: '2026-09-23T00:00:00.000Z', corroboratingEvidenceIds: [] },
  assessment: { status: 'pending', reasons: [], missingChecks: ['关键字段待核对'] },
  opportunityDetails: { companyCandidates: ['某市建设中心'], amountWanCandidates: [120], stageIds: ['tender'], deadlineCandidates: ['2026-10-15'], addressCandidates: ['成都市高新区'], contactCandidates: [], attachmentCandidates: [] },
  ...overrides,
})

describe('comparison summary preserves available data without treating inclusion as verification', () => {
  it('explains missing fields instead of turning every unknown into a verification gate', () => {
    const rows = buildCompareRows([project()], [], [])
    const cell = (label: string) => rows.find((row) => row.label === label)?.cells[0]

    expect(cell('预计金额')?.value).toBe('正文未提取')
    expect(rows.some((row) => row.label === '距离')).toBe(false)
    expect(cell('文件递交截止')?.value).toBe('正文未提取')
    expect(cell('项目阶段')?.value).toBe('未取得阶段证据')
    expect(cell('公开风险分析')?.value).toBe('尚未启动查询')
  })

  it('shows project/source candidates separately and marks source-extracted candidates as unconfirmed', () => {
    const rows = buildCompareRows([project()], [source()], [])
    const cell = (label: string) => rows.find((row) => row.label === label)?.cells[0]

    expect(cell('招标主体')).toMatchObject({ value: '某市建设中心', note: '来源正文提取候选，尚未确认' })
    expect(cell('预计金额')).toMatchObject({ value: '120 万', note: '来源正文提取候选，尚未确认' })
    expect(cell('项目阶段')).toMatchObject({ value: '招标公告', note: '公告阶段候选；尚未进入时间链确认' })
  })

  it('shows available project fields and does not describe an unknown match score as verification', () => {
    const rows = buildCompareRows([project({ companyName: '某市建设中心', amountWan: 120, locationAddress: '成都市高新区', distanceKm: 4.2, deadline: '2026-10-15' })], [], [])
    const cell = (label: string) => rows.find((row) => row.label === label)?.cells[0]

    expect(cell('招标主体')?.value).toBe('某市建设中心')
    expect(cell('预计金额')?.value).toBe('120 万')
    expect(cell('项目地址')?.value).toBe('成都市高新区')
    expect(rows.some((row) => row.label === '距离')).toBe(false)
    expect(cell('文件递交截止')?.value).toBe('2026-10-15')
    expect(cell('项目匹配分')?.note).toContain('不代表事实核验结论')
  })

  it('labels a qualification deadline as application-stage evidence, not a bid deadline', () => {
    const rows = buildCompareRows([project({ title: '成都锦樾序供电工程资审公告' })], [source({ opportunityDetails: {
      companyCandidates: [], amountWanCandidates: [], stageIds: ['tender'], deadlineCandidates: ['2026-08-31'], addressCandidates: ['四川省成都市'], contactCandidates: [], attachmentCandidates: [],
    } })], [])
    const cell = rows.find((row) => row.label === '文件递交截止')?.cells[0]

    expect(cell?.value).toBe('2026-08-31')
    expect(cell?.note).toContain('不能当作投标截止')
  })

  it('does not interpret a zero-hit risk search as confirmation that risk is absent', () => {
    const noHit = { opportunityId: 'project-1', facts: [] } as unknown as CreditRiskResult
    const row = buildCompareRows([project()], [], [noHit]).find((entry) => entry.label === '公开风险分析')

    expect(row?.cells[0].value).toBe('已查询 · 命中 0 条风险事实')
    expect(row?.cells[0].note).toContain('未命中不代表没有风险')
  })
})
