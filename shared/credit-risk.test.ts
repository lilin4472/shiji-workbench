import { describe, expect, it } from 'vitest'
import {
  assertCreditRiskRequest, buildCreditRiskQueries, codeLabelFor, detectSubjectType,
  extractCreditFacts, extractFactReason, extractRegistrationProfile, hasNonAdverseRole, isNegated,
} from './credit-risk.js'

const ENTERPRISE = '四川中测检测技术有限公司'
const INSTITUTION = '成都市武侯区智慧宜居建设开发有限公司'
const GOVERNMENT = '成都市武侯区住房和城乡建设局'
const PUBLIC_UNIT = '成都市城市管理科学研究院'

describe('公开风险 · 主体类型（按名称判断，不做静默断言）', () => {
  it('企业 / 政府机关 / 事业单位分别识别', () => {
    expect(detectSubjectType(ENTERPRISE).type).toBe('enterprise')
    expect(detectSubjectType(GOVERNMENT).type).toBe('government')
    expect(detectSubjectType(PUBLIC_UNIT).type).toBe('public-institution')
    expect(detectSubjectType('某某').type).toBe('unknown')
  })

  it('政府/事业单位的代码列标题不是"统一社会信用代码"', () => {
    expect(codeLabelFor('enterprise')).toBe('统一社会信用代码')
    expect(codeLabelFor('government')).toBe('机构登记代码')
    expect(codeLabelFor('public-institution')).toBe('机构登记代码')
  })
})

describe('公开风险 · 检索计划（4 组全网检索）', () => {
  it('企业走工商登记 + 处罚 + 裁判 + 招标违规', () => {
    const queries = buildCreditRiskQueries({
      opportunityId: 'o1', projectTitle: '某市政工程', companyName: INSTITUTION, industry: '市政',
    }, 'enterprise')
    expect(queries).toHaveLength(9)
    expect(queries[0]).toContain('统一社会信用代码')
    expect(queries[0]).toContain('组织机构代码')
    expect(queries[2]).toContain('行政处罚')
    expect(queries[3]).toContain('原告')
    expect(queries[4]).toContain('某市政工程')
    expect(queries[5]).toContain('工商变更')
    expect(queries[6]).toContain('副总经理')
  })

  it('政府/事业单位改看机构登记与行政诉讼（门禁放宽）', () => {
    const queries = buildCreditRiskQueries({
      opportunityId: 'o1', projectTitle: '某市政工程', companyName: GOVERNMENT, industry: '市政',
    }, 'government')
    expect(queries[0]).toContain('事业单位法人证书')
    expect(queries[0]).toContain('负责人')
    expect(queries[3]).toContain('行政诉讼')
  })
})

describe('公开风险 · 事实抽取（只抽真的写了的事由）', () => {
  it('行政处罚：事由 / 日期 / 金额 / 机关都抽出来', () => {
    const text = [
      `${ENTERPRISE} 行政处罚决定书`,
      '主要违法事实：未按规定对检测设备进行检定即出具报告',
      '处罚决定日期：2026-05-18',
      '罚款 3 万元',
      '处罚机关：成都市市场监督管理局',
    ].join('\n')

    const facts = extractCreditFacts({ subjectName: ENTERPRISE, title: '行政处罚决定书', publisher: '成都市市场监督管理局', pageUrl: 'https://sc.gsxt.gov.cn/x', text, tier: 'registry' })

    const penalty = facts.find((fact) => fact.category === 'administrative-penalty')
    expect(penalty).toBeTruthy()
    expect(penalty?.reason).toContain('未按规定对检测设备进行检定')
    expect(penalty?.occurredAt).toBe('2026-05-18')
    expect(penalty?.amount).toBe('3 万元')
    expect(penalty?.authority).toBe('成都市市场监督管理局')
  })

  it('事业单位被行政诉讼也能抽出来（用户明确要求）', () => {
    const text = `${PUBLIC_UNIT} 行政诉讼开庭公告\n案由：对行政处罚决定不服提起行政诉讼\n裁判日期：2026-08-02`
    const facts = extractCreditFacts({ subjectName: PUBLIC_UNIT, title: '开庭公告', publisher: '成都市中级人民法院', pageUrl: 'https://court.example.gov.cn/a', text, tier: 'official' })
    expect(facts.some((fact) => fact.category === 'administrative-litigation')).toBe(true)
  })

  it('否定句与非不利角色不算风险（守卫仍生效）', () => {
    const negated = `${ENTERPRISE} 投标人资格声明：未被列入经营异常名录，无行政处罚记录。`
    expect(isNegated(negated, negated.indexOf('经营异常'))).toBe(true)
    expect(extractCreditFacts({ subjectName: ENTERPRISE, title: '资格声明', publisher: '某采购网', pageUrl: 'https://x.gov.cn/1', text: negated, tier: 'official' })).toEqual([])

    const plaintiff = `裁判文书：原告${ENTERPRISE}与被告某公司合同纠纷一案，被告被列为失信被执行人。`
    expect(hasNonAdverseRole(plaintiff, ENTERPRISE, plaintiff.indexOf('失信被执行人'))).toBe(true)
  })

  it('页面上没有这个主体时，不产生任何事实', () => {
    const facts = extractCreditFacts({ subjectName: ENTERPRISE, title: '某公司处罚公告', publisher: '某局', pageUrl: 'https://x.gov.cn/2', text: '某某有限公司因违规被罚款 5 万元。', tier: 'official' })
    expect(facts).toEqual([])
  })

  it('事由抽不到时用类别名兜底，而不是编造细节', () => {
    const text = `${ENTERPRISE} 被列入经营异常名录。`
    const facts = extractCreditFacts({ subjectName: ENTERPRISE, title: '经营异常公告', publisher: '某市场监督管理局', pageUrl: 'https://x.gov.cn/3', text, tier: 'official' })
    expect(facts).toHaveLength(1)
    expect(facts[0].reason.length).toBeGreaterThan(0)
    expect(facts[0].reason.length).toBeLessThanOrEqual(80)
    expect(extractFactReason('没有任何字段的一句话')).toBeUndefined()
  })

  it('聚合站（企查查一类）仍是来源：只去掉备注里的"需登录"文案，不屏蔽信息', () => {
    const facts = extractCreditFacts({
      subjectName: ENTERPRISE, title: '企业风险信息 - 企查查', publisher: '企查查',
      pageUrl: 'https://www.qcc.com/firm/abc.html', text: `${ENTERPRISE} 经营异常 行政处罚 被执行人`, tier: 'registry',
    })
    expect(facts.length).toBeGreaterThan(0)
  })
})

describe('公开风险 · 基础登记信息（企业 / 机构两种口径）', () => {
  it('企业抽统一社会信用代码、法人、地址、电话、登记状态', () => {
    const text = [
      `${ENTERPRISE} 工商登记信息`,
      '统一社会信用代码：91510100MA6XXXXX1A',
      '法定代表人：王强',
      '所属行业：检验检测服务',
      '注册地址：成都市武侯区示例路 1 号',
      '联系电话：028-86001234',
      '登记状态：存续',
    ].join('\n')

    const profile = extractRegistrationProfile(text, ENTERPRISE, 'enterprise')
    expect(profile.code).toBe('91510100MA6XXXXX1A')
    expect(profile.legalPerson).toBe('王强')
    expect(profile.address).toContain('武侯区')
    expect(profile.phone).toBe('028-86001234')
    expect(profile.registrationStatus).toBe('存续')
  })

  it('政府/事业单位抽机构登记代码与单位地址', () => {
    const text = [
      `${PUBLIC_UNIT} 事业单位法人登记信息`,
      '事业单位法人证书号：1510101XXXXXX',
      '负责人：李静',
      '单位地址：成都市高新区示例街 2 号',
    ].join('\n')

    const profile = extractRegistrationProfile(text, PUBLIC_UNIT, 'public-institution')
    expect(profile.code).toBe('1510101XXXXXX')
    expect(profile.legalPerson).toBe('李静')
    expect(profile.address).toContain('高新区')
  })
})

describe('公开风险 · 请求校验', () => {
  it('缺主体直接拒绝', () => {
    expect(() => assertCreditRiskRequest({ opportunityId: 'o1', projectTitle: '项目', companyName: '主体', industry: '市政' })).not.toThrow()
    expect(() => assertCreditRiskRequest({ opportunityId: 'o1', projectTitle: '项目', industry: '市政' })).toThrow()
  })
})
