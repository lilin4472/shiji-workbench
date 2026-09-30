import { describe, expect, it } from 'vitest'
import {
  buildCreditRiskSynthesisPrompt, buildEvidenceTable, parseSynthesisResponse, quoteHitsMaterial, validateSynthesis,
} from './evidence-synthesis.js'

const evidence = buildEvidenceTable([
  { id: 'E1', title: '开庭公告', publisher: '成都市武侯区人民法院', date: '2025-01-10', url: 'https://court.example.gov.cn/a', tier: 'official', walled: false, text: '原告山东建筑大学设计集团有限公司与被告成都武侯太平园城市更新建设有限公司建设工程设计合同纠纷一案，本院于2025年1月10日立案，案号（2024）川0107民初1234号。' },
  { id: 'E2', title: '干部审查通报', publisher: '成都市武侯区纪委监委', date: '2026-07-14', url: 'https://gov.example.cn/b', tier: 'official', walled: false, text: '成都武侯太平园城市更新建设有限公司副总经理庞志迅涉嫌严重违纪违法，目前正接受纪律审查和监察调查。' },
])

describe('证据约束归纳 · 证据表与提示词', () => {
  it('材料编号化，过短材料被丢弃', () => {
    const table = buildEvidenceTable([
      { id: 'E1', title: 'x', publisher: 'p', date: 'd', tier: 'official', walled: false, text: '太短' },
      { id: 'E2', title: 'y', publisher: 'p', date: 'd', tier: 'official', walled: false, text: '这是一段足够长的材料内容，用于通过长度校验。'.repeat(3) },
    ])
    expect(table.map((item) => item.id)).toEqual(['E2'])
  })

  it('提示词包含防幻觉硬性要求与 E 编号', () => {
    const prompt = buildCreditRiskSynthesisPrompt('成都武侯太平园城市更新建设有限公司', '企业', evidence)
    expect(prompt).toContain('E1')
    expect(prompt).toContain('不得写入材料里没有的事实')
    expect(prompt).toContain('individual')
  })
})

describe('证据约束归纳 · 解析与校验（算法拦住大模型幻觉）', () => {
  it('能容忍代码块与前后解释文字', () => {
    const draft = parseSynthesisResponse('好的，结果如下：\n```json\n{"events":[],"verifications":[],"assessment":"ok"}\n```')
    expect(draft?.assessment).toBe('ok')
  })

  it('引文逐字命中才保留，编造的引文被丢弃', () => {
    const draft = {
      events: [
        { subject: '成都武侯太平园城市更新建设有限公司', time: '2025-01-10', place: '成都市武侯区人民法院', cause: '建设工程设计合同纠纷', amount: '', process: '一审立案', conclusion: '进入一审程序', scope: 'company' as const, category: 'administrative-litigation' as const, evidenceIds: ['E1'], quotes: ['（2024）川0107民初1234号'] },
        { subject: '成都武侯太平园城市更新建设有限公司', time: '2024-06-01', place: '某局', cause: '编造的处罚', amount: '5 万元', process: '已结案', conclusion: '被罚款', scope: 'company' as const, category: 'administrative-penalty' as const, evidenceIds: ['E1'], quotes: ['罚款五万元'] },
      ],
      verifications: [{ item: '行政处罚', conclusion: '未发现行政处罚记录', evidenceIds: ['E1'], quotes: [] }],
      assessment: '仅一起民事合同纠纷，不属于行政执法。',
    }
    const result = validateSynthesis(draft, evidence)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].cause).toContain('建设工程设计合同纠纷')
    expect(result.accepted).toBe(2)
    expect(result.rejected).toBe(1)
    expect(result.rejectedReasons[0]).toContain('引文未在材料中命中')
  })

  it('引用不存在的材料编号直接丢弃', () => {
    const result = validateSynthesis({
      events: [{ subject: 'X', time: '', place: '', cause: 'c', amount: '', process: '', conclusion: 'k', scope: 'company', category: 'administrative-penalty', evidenceIds: ['E99'], quotes: ['随便一句'] }],
      verifications: [], assessment: '',
    }, evidence)
    expect(result.events).toHaveLength(0)
    expect(result.rejectedReasons[0]).toContain('不存在的材料编号')
  })

  it('引文比对忽略空白差异，短引文不算命中', () => {
    expect(quoteHitsMaterial('（2024）川0107民初1234号', evidence[0].text)).toBe(true)
    expect(quoteHitsMaterial('案号', evidence[0].text)).toBe(false)
  })

  it('高管个人事项保留 individual 归属', () => {
    const result = validateSynthesis({
      events: [{ subject: '庞志迅', time: '2026-07-14', place: '成都市武侯区纪委监委', cause: '涉嫌严重违纪违法', amount: '', process: '接受纪律审查和监察调查', conclusion: '对个人立案，不罚公司', scope: 'individual', category: 'administrative-penalty', evidenceIds: ['E2'], quotes: ['庞志迅涉嫌严重违纪违法'] }],
      verifications: [], assessment: '',
    }, evidence)
    expect(result.events[0].scope).toBe('individual')
  })
})
