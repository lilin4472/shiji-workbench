import { describe, expect, it } from 'vitest'
import { buildLoopPrompt, parseLoopAction, validateLeadReport, validateLoopReport, type LoopEvidenceItem } from './agent-loop.js'

const evidence: LoopEvidenceItem[] = [
  {
    id: 'E1',
    title: '开庭公告',
    publisher: '成都市武侯区人民法院',
    date: '2025-01-21',
    tier: 'official',
    text: '原告上海天华建筑设计有限公司与被告四川府河华益置业有限公司、成都市金牛国有资产投资经营集团有限公司建设工程设计合同纠纷一案，案号（2024）川0107民初29841号，于2025-01-21 10:30开庭。',
  },
]

describe('Agent Loop · 提示词', () => {
  it('给的是检索目标与策略，而不是"总结材料"', () => {
    const prompt = buildLoopPrompt({
      goal: '查清该案的原告、被告、案由、金额与结果',
      subject: '成都市金牛国有资产投资经营集团有限公司',
      subjectType: '企业',
      step: 2,
      evidence,
      history: ['"..." 开庭公告 裁判文书'],
    })
    expect(prompt).toContain('原告')
    expect(prompt).toContain('案号直达')
    expect(prompt).toContain('openQuestions')
    expect(prompt).toContain('E1')
  })
})

describe('Agent Loop · 动作解析', () => {
  it('解析 search 动作（容忍代码块）', () => {
    const action = parseLoopAction('```json\n{"tool":"search","query":"（2024）川0107民初29841号 判决","purpose":"找判决"}\n```')
    expect(action?.tool).toBe('search')
    expect(action && action.tool === 'search' ? action.query : '').toContain('29841')
  })

  it('解析 submit 动作并归一字段', () => {
    const action = parseLoopAction('{"tool":"submit","report":{"events":[],"openQuestions":["判决未公开"]}}')
    expect(action?.tool).toBe('submit')
    expect(action && action.tool === 'submit' ? action.report.openQuestions : []).toEqual(['判决未公开'])
  })

  it('非法/超长查询被拒绝（防乱发请求）', () => {
    expect(parseLoopAction('{"tool":"search","query":""}')).toBeUndefined()
    expect(parseLoopAction('{"tool":"search","query":"' + 'x'.repeat(200) + '"}')).toBeUndefined()
    expect(parseLoopAction('不是 JSON')).toBeUndefined()
  })
})

describe('Agent Loop · 最终护栏（引文逐字校验 + 推断层必须有依据）', () => {
  it('引文命中才保留；编造引文与虚构材料编号被丢弃', () => {
    const result = validateLoopReport({
      events: [
        { subject: '成都市金牛国有资产投资经营集团有限公司', scope: 'company', time: '2025-01-21 10:30', place: '成都市武侯区人民法院', plaintiff: '上海天华建筑设计有限公司', defendant: '成都市金牛国有资产投资经营集团有限公司', cause: '建设工程设计合同纠纷', amount: '', process: '一审开庭', conclusion: '材料未载明判决结果', evidenceIds: ['E1'], quotes: ['（2024）川0107民初29841号'] },
        { subject: '成都市金牛国有资产投资经营集团有限公司', scope: 'company', time: '2025-03-01', place: '某法院', plaintiff: '', defendant: '', cause: '编造的判决', amount: '100 万元', process: '', conclusion: '败诉', evidenceIds: ['E1'], quotes: ['判决被告赔偿一百万元'] },
        { subject: '成都市金牛国有资产投资经营集团有限公司', scope: 'company', time: '', place: '', plaintiff: '', defendant: '', cause: '引用不存在的材料', amount: '', process: '', conclusion: '', evidenceIds: ['E99'], quotes: ['任意'] },
      ],
      verifications: [],
      inferences: [
        { claim: '大概率调解结案', basis: '开庭后 20 个月无判决、无二审、无执行记录', confidence: 'medium' },
        { claim: '缺依据的推断', basis: '', confidence: 'high' },
      ],
      openQuestions: ['判决结果未公开'],
      assessment: '待核。',
    }, evidence)

    expect(result.report.events).toHaveLength(1)
    expect(result.report.events[0].plaintiff).toContain('上海天华')
    expect(result.rejectedReasons.length).toBe(2)
    // 没有 basis 的"推断"不算推断
    expect(result.report.inferences).toHaveLength(1)
    expect(result.report.openQuestions).toEqual(['判决结果未公开'])
  })
})

describe('Agent Loop · 获客字段语义护栏', () => {
  it('不信任模型给的 kind：邮箱、电话和联系人按原文语义重新归类', () => {
    const leadEvidence: LoopEvidenceItem[] = [{
      id: 'L1', title: '企业联系方式', publisher: '企业官网', date: '2026-09-20', tier: 'official',
      text: '成都智联机电设备有限公司 联系人：杨毅 邮箱：sales@zhilian.example.com 电话：028-86112233',
    }]
    const result = validateLeadReport({
      contacts: [
        { kind: 'phone', value: 'sales@zhilian.example.com', evidenceId: 'L1', quote: '联系人：杨毅 邮箱：sales@zhilian.example.com' },
        { kind: 'address', value: '028-86112233', evidenceId: 'L1', quote: '电话：028-86112233' },
        { kind: 'email', value: '杨毅', evidenceId: 'L1', quote: '联系人：杨毅' },
      ],
      openQuestions: [], assessment: '',
    }, leadEvidence)

    expect(result.contacts.map((item) => [item.kind, item.value])).toEqual([
      ['email', 'sales@zhilian.example.com'],
      ['phone', '028-86112233'],
      ['contact', '杨毅'],
    ])
  })

  it('虽能逐字命中，但不是任何获客字段的文本仍被拒绝', () => {
    const leadEvidence: LoopEvidenceItem[] = [{ id: 'L1', title: '简介', publisher: '官网', date: '2026-09-20', tier: 'official', text: '主营机电安装工程。' }]
    const result = validateLeadReport({
      contacts: [{ kind: 'contact', value: '机电安装', evidenceId: 'L1', quote: '主营机电安装工程' }],
      openQuestions: [], assessment: '',
    }, leadEvidence)
    expect(result.contacts).toEqual([])
    expect(result.rejected[0]).toContain('字段类型')
  })
})
