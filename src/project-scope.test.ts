import { describe, expect, it } from 'vitest'
import type { Opportunity } from '../shared/agent-contract.js'
import type { EvidenceRecord } from '../shared/evidence-contract.js'
import { buildProjectScopeItems } from './project-scope.js'

// 2026-09-16 用户口径：勾选后带进模块的不能只是"名字"。
// 这组用例锁定载荷的最小内容：项目对象 + 本机证据 + 证据里已确定性提取的字段。
const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'opp-1', title: '弱电智能化改造项目', companyId: 'company-1', companyName: '示例业主单位',
  amountWan: 1280, locationAddress: '成都市高新区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '工程改造', reason: '正文命中招标阶段。', evidenceIds: ['ev-1'],
  followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [{ evidenceId: 'ev-1', stageId: 'tender', occurredAt: '2026-09-16', title: '招标公告', source: '示例公共资源交易中心' }],
  ...overrides,
})

const evidence = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: 'ev-1',
  subject: { kind: 'opportunity', id: 'subject-1', name: '示例业主单位' },
  title: '公告正文',
  artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
  provenance: {
    pageUrl: 'https://example.gov.cn/ev-1', publisher: '示例公共资源交易中心', provenanceType: 'original',
    documentIdentifiers: [], capturedAt: '2026-09-16T08:00:00.000Z', corroboratingEvidenceIds: [],
  },
  assessment: {
    status: 'assessed', claimType: 'project-stage', grade: 'A',
    permittedUses: ['discovery', 'stage-confirmation'], reasons: [], missingChecks: [], assessedAt: '2026-09-16T08:05:00.000Z',
  },
  opportunityDetails: {
    companyCandidates: ['示例业主单位'], amountWanCandidates: [1280], stageIds: ['tender'],
    deadlineCandidates: ['2026-10-15'], addressCandidates: ['成都市高新区示例路 1 号'],
    agencyCandidates: ['示例招标代理有限公司'], lotCandidates: ['一标段'], scopeCandidates: ['弱电智能化改造'],
    qualificationCandidates: ['电子与智能化工程专业承包二级'], depositCandidates: ['2 万元'],
    openingTimeCandidates: ['2026-10-15 09:30'], contactCandidates: [], attachmentCandidates: [],
  },
  ...overrides,
})

describe('模块分析载荷 buildProjectScopeItems', () => {
  it('把项目对象与证据一起带进模块，而不是只带名字', () => {
    const [item] = buildProjectScopeItems([opportunity()], [evidence()])

    expect(item.opportunity.id).toBe('opp-1')
    expect(item.subjectName).toBe('示例业主单位')
    expect(item.amountLabel).toBe('1,280 万')
    expect(item.deadline).toBe('2026-10-15')
    expect(item.evidenceCount).toBe(1)
    expect(item.loadSummary).toContain('1 条本机证据')
  })

  it('把证据里已确定性提取的字段摊平成可读字段，供模块离线分析', () => {
    const [item] = buildProjectScopeItems([opportunity()], [evidence()])
    const labels = item.detailFields.map((field) => field.label)

    expect(labels).toEqual(expect.arrayContaining(['代理机构', '标段 / 标包', '招标范围', '投标资格', '保证金', '开标时间', '项目地址']))
    expect(item.detailFields.find((field) => field.label === '代理机构')?.value).toBe('示例招标代理有限公司')
    expect(item.hasDetail).toBe(true)
  })

  it('阶段标签取自证据确认阶段，没有阶段证据时明确写待核验', () => {
    const [withStage] = buildProjectScopeItems([opportunity()], [evidence()])
    const [withoutStage] = buildProjectScopeItems([opportunity({ timelineEvidence: [] })], [])

    expect(withStage.stageLabel).toBe('招标公告')
    expect(withoutStage.stageLabel).toBe('未取得阶段证据')
  })

  it('只认 evidenceIds 命中的本机证据，原文链接去重且忽略缺失 pageUrl', () => {
    const other = evidence({ id: 'ev-other' })
    const noUrl = evidence({
      id: 'ev-1',
      provenance: {
        publisher: '示例公共资源交易中心', provenanceType: 'original', documentIdentifiers: [],
        capturedAt: '2026-09-16T08:00:00.000Z', corroboratingEvidenceIds: [],
      },
    })

    const [item] = buildProjectScopeItems([opportunity()], [other, noUrl])

    expect(item.evidenceCount).toBe(1)
    expect(item.sourceUrls).toEqual([])
    expect(item.loadSummary).not.toContain('可打开原文')
  })

  it('金额未确认时不编造数字，明确待核验', () => {
    const [item] = buildProjectScopeItems([opportunity({ amountWan: null })], [])

    expect(item.amountLabel).toBe('待核验')
    expect(item.hasDetail).toBe(true) // 项目地址仍来自对象本身
    expect(item.evidenceCount).toBe(0)
    expect(item.detailFields.map((field) => field.label)).toEqual(['项目地址'])
  })

  it('一个字段最多展示 3 个候选值，避免卡片被长列表撑爆', () => {
    const many = evidence({
      opportunityDetails: {
        companyCandidates: [], amountWanCandidates: [], stageIds: [], deadlineCandidates: [], addressCandidates: [],
        agencyCandidates: ['代理甲', '代理乙', '代理丙', '代理丁'], contactCandidates: [], attachmentCandidates: [],
      },
    })

    const [item] = buildProjectScopeItems([opportunity()], [many])

    expect(item.detailFields.find((field) => field.label === '代理机构')?.value).toBe('代理甲 / 代理乙 / 代理丙')
  })
})
