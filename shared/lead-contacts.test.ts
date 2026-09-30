import { describe, expect, it } from 'vitest'
import { canonicalizeLeadValue, classifyLeadValue, collectLeadContacts, extractLeadContacts } from './lead-contacts.js'

const SOURCE = { title: '供应商公开信息', publisher: '企业官网', pageUrl: 'https://example.com/1', tier: 'official' as const, observedAt: '2026-09-17T10:00:00.000Z' }

describe('获客联系方式：确定性抽取（不得编造）', () => {
  it('从正文里逐字抽出邮箱 / 电话 / 地址，并绑定来源', () => {
    const text = '成都智联机电设备有限公司 联系邮箱：sales@zhilian.example.com 联系电话：028-86112233 地址：成都市武侯区人民南路四段11号'
    const points = extractLeadContacts({ text, companyName: '成都智联机电设备有限公司', source: SOURCE })
    expect(points.find((p) => p.kind === 'email')?.normalized).toBe('sales@zhilian.example.com')
    expect(points.find((p) => p.kind === 'phone')?.normalized).toBe('028-86112233')
    expect(points.find((p) => p.kind === 'address')?.normalized).toContain('成都市武侯区人民南路四段11号')
    expect(points.every((p) => p.sources[0].pageUrl === 'https://example.com/1')).toBe(true)
  })
  it('正文没有联系方式就一个都不产出', () => {
    const text = '成都智联机电设备有限公司成立于2019年，主营机电设备销售与安装。'
    expect(extractLeadContacts({ text, companyName: '成都智联机电设备有限公司', source: SOURCE })).toEqual([])
  })
  it('过滤统一客服号与占位值', () => {
    const text = '邮箱 test@example.com，客服电话 400-800-1234'
    const points = extractLeadContacts({ text, companyName: '某公司', source: SOURCE })
    expect(points.find((p) => p.kind === 'email')).toBeUndefined()
    expect(points.find((p) => p.normalized.includes('400'))).toBeUndefined()
  })

  it('第三方招标站的会员客服不得冒充目标公司联系人', () => {
    const text = [
      '成都市金牛国投城市运营管理有限公司资产出租公告。',
      '本招标项目仅供正式会员查看，您的权限不能浏览详细信息，联系工作人员办理入网升级。',
      '联系人：刘欣 电话：010-68809590 手机：13522553206（欢迎拨打手机/微信同号） 邮箱：kefu@bidnews.cn',
    ].join('\n')
    const points = extractLeadContacts({ text, companyName: '成都市金牛国投城市运营管理有限公司', source: SOURCE })
    expect(points).toEqual([])
  })

  it('第三方招标站的微信同号销售联系方式全部剔除', () => {
    const text = [
      '成都市金牛国投城市运营管理有限公司资产出租公告。',
      '联系人：宋扬 电话：010-88938205 手机：13522553979（欢迎拨打手机/微信同号） 邮箱：songyang@zbytb.com',
    ].join('\n')
    const points = extractLeadContacts({ text, companyName: '成都市金牛国投城市运营管理有限公司', source: SOURCE })
    expect(points).toEqual([])
  })

  it('已确认注入客服的聚合站不提供企业联系方式证据', () => {
    const text = '成都市金牛国投城市运营管理有限公司 联系人：宋扬 电话：010-88938205 邮箱：chengjiao@zbytb.com 地址：成都市金牛区成华西街299号'
    const source = { ...SOURCE, pageUrl: 'https://m.zbytb.com/25-0-53888624-1.html', publisher: '中国招标与采购网', tier: 'media' as const }
    expect(extractLeadContacts({ text, companyName: '成都市金牛国投城市运营管理有限公司', source })).toEqual([])
  })
  it('同一值跨来源去重，但保留全部来源绑定', () => {
    const a = { text: '成都甲公司 电话 028-85123456', title: '公告A', publisher: '官网', pageUrl: 'https://a.example.com', tier: 'official' as const, observedAt: SOURCE.observedAt }
    const b = { text: '成都甲公司 电话 028-85123456 邮箱 a@jia.example.com', title: '公告B', publisher: '官网', pageUrl: 'https://b.example.com', tier: 'official' as const, observedAt: SOURCE.observedAt }
    const grouped = collectLeadContacts({ companyName: '成都甲公司', sources: [a, b] })
    expect(grouped.phone).toHaveLength(1)
    expect(grouped.phone[0].sources.map((s) => s.title).sort()).toEqual(['公告A', '公告B'])
    expect(grouped.email).toHaveLength(1)
  })
  it('长数字串不会把中间一段当手机号截出来', () => {
    const text = '合同编号 12345138000111112222 标的'
    const points = extractLeadContacts({ text, companyName: '某公司', source: SOURCE })
    expect(points.find((p) => p.kind === 'phone')).toBeUndefined()
  })
  it('联系人只取公开字段里的姓名，法人不算联系人', () => {
    const text = '成都甲公司 法定代表人：郭磊  项目联系人：张伟  联系电话：028-86112233'
    const points = extractLeadContacts({ text, companyName: '成都甲公司', source: SOURCE })
    expect(points.filter((p) => p.kind === 'contact').map((p) => p.normalized)).toEqual(['张伟'])
  })
  it('只有法人时联系人保持缺失（不得拿法人顶替）', () => {
    const text = '法定代表人：郭磊 注册资本 1000 万元'
    expect(extractLeadContacts({ text, companyName: '成都甲公司', source: SOURCE }).some((p) => p.kind === 'contact')).toBe(false)
  })
  it('联系人字段后面接长中文串时不截取', () => {
    const text = '联系人：成都市武侯区人民南路四段'
    expect(extractLeadContacts({ text, companyName: '成都甲公司', source: SOURCE }).some((p) => p.kind === 'contact')).toBe(false)
  })
  it('公开来源写明手机号就保留（有就要、没有就算了）', () => {
    const text = '成都甲公司 业务联系人：李静 手机：13800001111 邮箱 abc@jia.example.com'
    const points = extractLeadContacts({ text, companyName: '成都甲公司', source: SOURCE })
    expect(points.find((p) => p.kind === 'phone')?.normalized).toBe('13800001111')
    expect(points.find((p) => p.kind === 'contact')?.normalized).toBe('李静')
  })
  it('联系人电话这种标签不会把电话当人名', () => {
    const text = '成都甲公司 联系人电话：028-86112233'
    const points = extractLeadContacts({ text, companyName: '成都甲公司', source: SOURCE })
    expect(points.some((p) => p.kind === 'contact')).toBe(false)
    expect(points.find((p) => p.kind === 'phone')?.normalized).toBe('028-86112233')
  })

  it('联系人字段支持多人、换行及页面插空格，但每个姓名仍绑定同一证据段', () => {
    const text = [
      '中铁八局集团有限公司人力资源部',
      '联 系 人：廖老师、夏老师',
      '联系 电话：028-87517072、028-87517135',
      '邮箱：hr@cr8gc.com',
    ].join('\n')
    const points = extractLeadContacts({ text, companyName: '中铁八局集团有限公司', source: SOURCE })
    expect(points.filter((point) => point.kind === 'contact').map((point) => point.normalized)).toEqual(['廖老师', '夏老师'])
    expect(points.filter((point) => point.kind === 'contact').every((point) => point.evidenceQuote.includes('联系 电话：028-87517072'))).toBe(true)
  })

  it('公司地址不含路街道时也能识别产业园和楼栋地址', () => {
    const text = '成都智联机电设备有限公司 公司地址：成都市高新区天府软件园B区5栋3层'
    const points = extractLeadContacts({ text, companyName: '成都智联机电设备有限公司', source: SOURCE })
    expect(points.find((p) => p.kind === 'address')?.normalized).toContain('成都市高新区天府软件园B区5栋3层')
  })

  it('项目标题、荣誉描述与机构名称不能误判为公司地址', () => {
    expect(classifyLeadValue('中铁八局集团有限公司城市轨道交通公司是专业施工单位')).toBeUndefined()
    expect(classifyLeadValue('四川省实施用户满意工程先进单位等荣誉称号')).toBeUndefined()
    expect(classifyLeadValue('成都市公共资源交易服务中心')).toBeUndefined()
    expect(classifyLeadValue('成都市新都区斑竹园街道居民委员会')).toBeUndefined()
    expect(classifyLeadValue('成都市金牛国投建设有限公司公众号上发布')).toBeUndefined()
    expect(classifyLeadValue('同意你单位住所由南宁市金良路8号变更')).toBeUndefined()
  })

  it('真实门牌地址仍能通过本地语义复核', () => {
    expect(classifyLeadValue('四川省成都市金牛区金科东路68号')).toBe('address')
    expect(classifyLeadValue('成都市金牛区北站西支巷66')).toBe('address')
    expect(classifyLeadValue('天府软件园B区5栋3层', '公司地址：天府软件园B区5栋3层')).toBe('address')
  })

  it('地址入表前去掉叙述前后缀并归并为净地址', () => {
    expect(canonicalizeLeadValue('address', '位于成都市金牛区金科东路68号')).toBe('成都市金牛区金科东路68号')
    expect(canonicalizeLeadValue('address', '可到成都市金牛区金科东路68号来访')).toBe('成都市金牛区金科东路68号')
    expect(canonicalizeLeadValue('address', '企业注册地址位于四川省成都市新都区滨江东路215号')).toBe('四川省成都市新都区滨江东路215号')
    expect(canonicalizeLeadValue('address', '成都市金牛区金科东路68号电话')).toBe('成都市金牛区金科东路68号')
    expect(canonicalizeLeadValue('address', '| 深圳市福田区红荔西路7022号鲁班大厦9楼 |')).toBe('深圳市福田区红荔西路7022号鲁班大厦9楼')
    expect(canonicalizeLeadValue('address', '成都市金牛区金周路595号2栋B座9层901 乘车路线:地铁2号线D口出')).toBe('成都市金牛区金周路595号2栋B座9层901')
    expect(canonicalizeLeadValue('address', '成都市金牛区蜀西路52号2栋901 联 系 人: 闵先生')).toBe('成都市金牛区蜀西路52号2栋901')
  })

  it('不把同页项目建设地点当作目标公司地址', () => {
    const text = [
      '四川千云建筑有限公司 统一社会信用代码 91510114MA626HYD19',
      '建设地点：成都市新都区军屯镇郭家村9组',
      '项目名称：农毛渠建设及维护项目',
    ].join('\n')
    expect(extractLeadContacts({ text, companyName: '四川千云建筑有限公司', source: { ...SOURCE, title: '农毛渠建设项目公告' } })
      .some((point) => point.kind === 'address')).toBe(false)
  })

  it('即使来源标题是公司名，也不把工程建设地址当公司地址', () => {
    const text = '工程名称：中国建设银行支行装修工程；建设地址：双流区西航港锦华路二段138号；施工单位：中铁二局集团装饰装修工程有限公司'
    const source = { ...SOURCE, title: '中铁二局集团装饰装修工程有限公司经营信息' }
    expect(extractLeadContacts({ text, companyName: '中铁二局集团装饰装修工程有限公司', source })
      .some((point) => point.kind === 'address')).toBe(false)
  })

  it('只在能证明属于当前公司的来源中接受公司地址', () => {
    const text = '四川千云建筑有限公司 企业地址位于四川省成都市新都区新繁镇滨江东路215号'
    const points = extractLeadContacts({ text, companyName: '四川千云建筑有限公司', source: { ...SOURCE, title: '四川千云建筑有限公司企业档案' } })
    expect(points.find((point) => point.kind === 'address')?.value).toBe('四川省成都市新都区新繁镇滨江东路215号')
  })

  it('不把提及企业的新闻页脚邮箱当成企业邮箱', () => {
    const text = '广西产学研科学研究院参加人工智能会议，推动产业合作。\n版权联系邮箱：cnrbanquan@cnr.cn'
    const points = extractLeadContacts({ text, companyName: '广西产学研科学研究院', source: { ...SOURCE, title: 'AI产业会议新闻', publisher: '新闻媒体' } })
    expect(points.some((point) => point.kind === 'email')).toBe(false)
  })
})
