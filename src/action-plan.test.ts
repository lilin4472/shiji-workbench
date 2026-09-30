import { describe, expect, it } from 'vitest'
import { buildActionPlan, removeActionProject, selectActionProjects } from './action-plan'
import type { Opportunity } from './domain'

const opportunity: Opportunity = {
  id: 'opp-real-1', title: '某园区弱电工程招标公告', companyId: 'company-1', companyName: '某园区建设有限公司',
  amountWan: 380, locationAddress: '成都市武侯区', distanceKm: null, deadline: '2026-09-30', matchScore: 82,
  projectType: '弱电工程', reason: '专业匹配', evidenceIds: ['ev-1'], followUpLevel: '重点跟进', confidence: '高',
  timelineEvidence: [{ stageId: 'tender', occurredAt: '2026-09-18', title: '招标公告', evidenceId: 'ev-1', source: '政府采购网' }],
}

describe('行动计划：只消费已有真实模块结果', () => {
  it('历史体验只生成复盘动作，不把旧公告当成今天可投标的项目', () => {
    const items = buildActionPlan({ opportunity, availableModules: { timeline: true }, historicalReplay: true })
    expect(items.every((item) => item.timing === '体验复盘')).toBe(true)
    expect(items.some((item) => item.title.includes('复盘历史公告'))).toBe(true)
    expect(items.every((item) => !item.title.includes('倒排投标准备'))).toBe(true)
  })
  it('行动页按行动清单桶保留多个项目并去重，而不是读取总览分析选择', () => {
    const second = { ...opportunity, id: 'opp-real-2', title: '第二个真实项目' }
    const scope = selectActionProjects([opportunity, second], [
      { kind: 'opportunity', id: opportunity.id, title: opportunity.title },
      { kind: 'recommendation', id: 'lead-1', title: '联系人线索', opportunityId: opportunity.id },
      { kind: 'opportunity', id: second.id, title: second.title },
    ])
    expect(scope.map((item) => item.id)).toEqual([opportunity.id, second.id])
  })

  it('移出一个行动项目时同时移除它关联的行动对象，但不影响其他项目', () => {
    const objects = [
      { kind: 'opportunity', id: opportunity.id, title: opportunity.title },
      { kind: 'recommendation', id: 'lead-1', title: '联系人线索', opportunityId: opportunity.id },
      { kind: 'opportunity', id: 'opp-real-2', title: '第二个真实项目' },
    ] satisfies import('./domain').ManagedObject[]
    expect(removeActionProject(objects, opportunity.id)).toEqual([objects[2]])
  })

  it('未运行扩展模块时只形成项目详情的基础投标准备', () => {
    const items = buildActionPlan({ opportunity, now: new Date('2026-09-21T00:00:00Z') })
    expect(items.some((item) => item.category === '投标准备' && item.title.includes('09-30'))).toBe(true)
    expect(items.some((item) => item.category === '业务跟踪')).toBe(false)
    expect(items.some((item) => item.category === '商务对接')).toBe(false)
    expect(items.every((item) => item.opportunityId === opportunity.id && item.done === false)).toBe(true)
  })

  it('只在时间链已真实运行时生成阶段跟踪', () => {
    const items = buildActionPlan({
      opportunity,
      availableModules: { timeline: true },
      now: new Date('2026-09-21T00:00:00Z'),
    })
    expect(items.some((item) => item.category === '业务跟踪' && item.sourceModules.includes('时间链'))).toBe(true)
    expect(items.find((item) => item.category === '业务跟踪')?.detail).toContain('开标评标')
  })

  it('只用获客原文中已经取得的联系人与电话生成商务对接动作', () => {
    const items = buildActionPlan({
      opportunity,
      availableModules: { industry: true, leads: true },
      now: new Date('2026-09-21T00:00:00Z'),
      leadResult: {
        schemaVersion: 10, inputFingerprint: 'fp', opportunityId: opportunity.id, projectTitle: opportunity.title,
        ownerName: opportunity.companyName, queries: [], requestCount: 0, modelCalls: 0, cacheHit: true,
        checkedAt: '2026-09-21T00:00:00Z', gaps: [], boundary: '只用公开信息',
        rows: [{
          id: 'lead-1', name: '某工程咨询有限公司', ownerName: opportunity.companyName, relation: 'tender-agent',
          relationLabel: '招标/采购代理', relationQuote: '代理机构：某工程咨询有限公司', confidence: 'confirmed',
          industry: '工程咨询', requestCount: 0, supplementRounds: 0, missing: ['email', 'address'], sources: [],
          contact: [{ companyName: '某工程咨询有限公司', kind: 'contact', value: '李老师', normalized: '李老师', evidenceQuote: '某工程咨询有限公司 联系人：李老师 电话：028-88886666', sources: [{ title: '招标公告', publisher: '政府网站', tier: 'official', observedAt: '2026-09-21T00:00:00Z' }] }],
          phone: [{ companyName: '某工程咨询有限公司', kind: 'phone', value: '028-88886666', normalized: '028-88886666', evidenceQuote: '某工程咨询有限公司 联系人：李老师 电话：028-88886666', sources: [{ title: '招标公告', publisher: '政府网站', tier: 'official', observedAt: '2026-09-21T00:00:00Z' }] }],
          email: [], address: [],
        }],
      },
    })
    const contact = items.find((item) => item.category === '商务对接')
    expect(contact?.title).toContain('某工程咨询有限公司')
    expect(contact?.detail).toContain('李老师')
    expect(contact?.detail).toContain('028-88886666')
    expect(contact?.sourceModules).toEqual(['产业链', '获客'])
  })

  it('风险与政策只形成带来源模块标记的复核和观察动作', () => {
    const items = buildActionPlan({
      opportunity,
      availableModules: { policy: true, risk: true },
      now: new Date('2026-09-21T00:00:00Z'),
      riskResult: { opportunityId: opportunity.id, projectTitle: opportunity.title, subjectName: opportunity.companyName, profile: { name: opportunity.companyName, subjectType: 'enterprise', subjectTypeBasis: '名称判断', codeLabel: '统一社会信用代码', sourceTitle: '工商页' }, facts: [{ id: 'risk-1', subjectName: opportunity.companyName, category: 'administrative-litigation', categoryLabel: '裁判文书', reason: '建设工程合同纠纷', sourceTitle: '裁判文书', publisher: '法院', tier: 'official', sourceWalled: false }], queries: [], requestCount: 0, cacheHit: true, checkedAt: '2026-09-21T00:00:00Z', gaps: [], verifications: [], boundary: '仅供参考' },
      policyResult: { opportunityId: opportunity.id, subjectName: opportunity.companyName, industry: '弱电', regionPath: [], findings: [], queries: [], requestCount: 0, cacheHit: true, checkedAt: '2026-09-21T00:00:00Z', gaps: [], boundary: '预测不是事实', predictions: [{ id: 'prediction-1', label: '下一采购窗口', windowStart: '2026-10-01', windowEnd: '2026-12-31', certainty: 'forecast', basisKind: 'historical-cadence', basis: '历史采购节奏', signals: ['采购意向公告'], confidence: 'medium', basisEvidenceIds: ['ev-1'] }] },
    })
    expect(items.some((item) => item.title.includes('风险事实') && item.sourceModules.includes('公开风险'))).toBe(true)
    expect(items.some((item) => item.title.includes('下一采购窗口') && item.sourceModules.includes('政策链'))).toBe(true)
  })
})
