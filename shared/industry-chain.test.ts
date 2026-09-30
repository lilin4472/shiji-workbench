import { describe, expect, it } from 'vitest'
import {
  assertIndustryChainRequest, buildIndustrySearchTargets, extractCompanyNames, extractIndustryField,
  extractIndustryMentions, extractLegalPerson, extractOwnerFacts, extractPhone, documentSupportsIndustryTarget, isWinnerSentence,
  normalizeCompanyName, RELATION_LABELS, uniqueStrings,
} from './industry-chain.js'

const TENDER_TEXT = [
  '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务竞争性磋商公告',
  '采购人：成都市武侯区智慧宜居建设开发有限公司',
  '采购人地址：成都市武侯区示例路 1 号  联系电话：028-85123456',
  '采购代理机构：华夏城投项目管理有限公司',
  '中标人：四川中测检测技术有限公司',
  '中标金额：118.6 万元  中标日期：2026年9月8日',
  '联合体成员：成都建工第八建筑工程有限公司、四川路桥勘察设计研究院',
  '分包单位：成都恒信劳务有限公司',
  '供应商：成都智联机电设备有限公司',
  '母公司：成都产业投资集团有限公司',
  '子公司：成都智联工程服务有限公司',
  '施工单位：成都建设工程有限公司',
  '招标范围：地铁保护监测与配套服务',
  '法定代表人：张伟',
].join('\n')

describe('产业链 · 公司名识别（只认完整主体名）', () => {
  it('识别有限公司 / 设计院 / 集团等主体名，并排除政府机关', () => {
    const names = extractCompanyNames('成都市武侯区人民政府办公室、四川中测检测技术有限公司、四川路桥勘察设计研究院、某某集团有限公司、成都市武侯区住房和城乡建设局')
    expect(names).toContain('四川中测检测技术有限公司')
    expect(names).toContain('四川路桥勘察设计研究院')
    expect(names).toContain('某某集团有限公司')
    expect(names.some((name) => name.includes('人民政府'))).toBe(false)
    expect(names.some((name) => name.includes('住房和城乡建设局'))).toBe(false)
  })

  it('公司名归一化去掉标签残留与空白', () => {
    expect(normalizeCompanyName(': 四川中测检测技术有限公司、')).toBe('四川中测检测技术有限公司')
  })

  it('不把集团型全称截断，也不把工商站导航词串当公司', () => {
    expect(extractCompanyNames('中标单位：中铁二局集团装饰装修工程有限公司')).toEqual(['中铁二局集团装饰装修工程有限公司'])
    expect(extractCompanyNames('分支机构 财务数据企业年报13最终受益人实际控制人协同股东疑似关系3同业分析关联方认定集团/族群')).toEqual([])
  })
})

describe('产业链 · 关系抽取（标签 + 原句）', () => {
  const mentions = extractIndustryMentions(TENDER_TEXT)

  it('中标人 → 以往中标企业，且带原句', () => {
    const winner = mentions.find((mention) => mention.relation === 'historical-winner' && mention.name.includes('四川中测'))
    expect(winner).toBeTruthy()
    expect(winner?.quote).toContain('中标人')
  })

  it('代理 / 联合体 / 分包 / 供应商 分别归类', () => {
    // 同一句里可能有多家公司（"联合体成员：A、B"），按关系收集全部名字再断言。
    const namesOf = (relation: string) => mentions.filter((mention) => mention.relation === relation).map((mention) => mention.name)
    expect(namesOf('tender-agent').join('|')).toContain('华夏城投')
    expect(namesOf('consortium-member').join('|')).toContain('成都建工第八')
    expect(namesOf('consortium-member').join('|')).toContain('四川路桥勘察设计研究院')
    expect(namesOf('subcontractor').join('|')).toContain('成都恒信')
    expect(namesOf('supplier').join('|')).toContain('成都智联')
    expect(namesOf('parent-company').join('|')).toContain('成都产业投资集团有限公司')
    expect(namesOf('subsidiary').join('|')).toContain('成都智联工程服务有限公司')
    expect(namesOf('contractor').join('|')).toContain('成都建设工程有限公司')
  })

  it('招标公告本身不算中标（防止把投标人要求当中标结果）', () => {
    expect(isWinnerSentence('中标人：四川中测检测技术有限公司')).toBe(true)
    expect(isWinnerSentence('投标人资格要求：具有独立法人资格，招标公告发布之日起报名')).toBe(false)
  })

  it('“供应商选择/评估”方法文章不建立供应商关系', () => {
    const noise = '为建立供应商选择与评估管理体系，广西产学研科学研究院制定本标准。'
    expect(extractIndustryMentions(noise).some((mention) => mention.relation === 'supplier')).toBe(false)
  })

  it('工商站“分支机构”后的菜单导航不建立产业关系', () => {
    const noise = '分支机构\n财务数据企业年报13最终受益人实际控制人协同股东疑似关系3同业分析关联方认定集团/族群'
    expect(extractIndustryMentions(noise)).toEqual([])
  })

  it('关系正文必须出现当前甲方或当前项目', () => {
    const request = { companyName: '成都市金牛国投建设有限公司', projectTitle: '通锦路市政道路建设工程' }
    expect(documentSupportsIndustryTarget('广西产学研科学研究院发布供应商管理标准。', request)).toBe(false)
    expect(documentSupportsIndustryTarget('招标人：成都市金牛国投建设有限公司；供应商：四川千云建筑有限公司。', request)).toBe(true)
    expect(documentSupportsIndustryTarget('通锦路市政道路建设工程成交供应商：四川千云建筑有限公司。', request)).toBe(true)
  })
})

describe('产业链 · 四个维度抽取（抽不到就留空）', () => {
  it('法人 / 电话 / 行业领域都能抽到', () => {
    expect(extractLegalPerson('法定代表人：张伟  联系电话：028-85123456')).toBe('张伟')
    expect(extractLegalPerson('法定代表人为钟海波')).toBe('钟海波')
    expect(extractPhone('联系电话：028-85123456')).toBe('028-85123456')
    expect(extractPhone('联系人：李工  手机：13812345678')).toBe('13812345678')
    expect(extractIndustryField('招标范围：地铁保护监测与配套服务')).toContain('地铁保护监测')
  })

  it('抽不到时返回 undefined（界面显示"未取得"），不编造', () => {
    expect(extractLegalPerson('本项目由采购人自行组织')).toBeUndefined()
    expect(extractPhone('详见公告附件')).toBeUndefined()
    expect(extractIndustryField('详见公告附件')).toBeUndefined()
  })

  it('真实数据里的噪声不会被当成行业领域（工期 / markdown 加粗 / 金额）', () => {
    expect(extractIndustryField('招标范围：**')).toBeUndefined()
    expect(extractIndustryField('招标范围：全部完成之日止')).toBeUndefined()
    expect(extractIndustryField('采购内容：预算 120 万元')).toBeUndefined()
    expect(extractIndustryField('招标范围：**弱电智能化改造**，含设备安装')).toBe('弱电智能化改造（本次项目范围）')
  })

  it('甲方四维度只在提到甲方的窗口里抽', () => {
    const facts = extractOwnerFacts(TENDER_TEXT, '成都市武侯区智慧宜居建设开发有限公司')
    expect(facts.phone).toBe('028-85123456')
    const missing = extractOwnerFacts('本次公告未包含任何联系方式。', '成都市武侯区智慧宜居建设开发有限公司')
    expect(missing.phone).toBeUndefined()
    expect(missing.legalPerson).toBeUndefined()
  })
})

describe('产业链 · 检索计划与请求校验', () => {
  it('固定 3 组查询：历史中标 / 本项目履约 / 供应商与代理', () => {
    const queries = buildIndustrySearchTargets({
      opportunityId: 'o1', projectTitle: '悦湖片区地铁保护监测服务', companyName: '成都市武侯区智慧宜居建设开发有限公司',
      address: '四川省成都市武侯区', industry: '市政基础设施',
    })
    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('中标')
    expect(queries[1]).toContain('悦湖片区地铁保护监测服务')
    expect(queries[2]).toContain('供应商')
    expect(queries.every((query) => query.includes('成都市武侯区智慧宜居建设开发有限公司') || query.includes('悦湖片区'))).toBe(true)
  })

  it('请求校验：缺主体或项目直接拒绝', () => {
    expect(() => assertIndustryChainRequest({ opportunityId: 'o1', projectTitle: '项目', companyName: '主体', industry: '弱电' })).not.toThrow()
    expect(() => assertIndustryChainRequest({ opportunityId: 'o1', projectTitle: '项目', industry: '弱电' })).toThrow()
  })

  it('关系标签齐全且唯一字符串去重', () => {
    expect(Object.keys(RELATION_LABELS)).toEqual(expect.arrayContaining(['historical-winner', 'supplier', 'contractor', 'subcontractor', 'tender-agent', 'consortium-member', 'parent-company', 'subsidiary', 'branch-company']))
    expect(uniqueStrings(['a', ' a ', '', 'b'])).toEqual(['a', 'b'])
  })
})
