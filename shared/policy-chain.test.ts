import { describe, expect, it } from 'vitest'
import {
  buildPolicyPredictions, buildPolicySearchTargets, isPolicyListingPage, matchesPolicyScope, parsePolicyRegion,
  policyScopeKeywords, policySourceTier, readPolicySignals, assertPolicyChainRequest, uniqueStrings,
} from './policy-chain.js'

describe('政策链 · 地区解析（直辖市层级必须正确）', () => {
  it('普通省份给出 国家 → 省 → 地级市', () => {
    const region = parsePolicyRegion('四川省成都市武侯区示例路 1 号', '成都市武侯区智慧宜居建设开发有限公司')
    expect(region.path.map((level) => level.label)).toEqual(['国家级', '四川省', '成都市'])
    expect(region.isMunicipality).toBe(false)
    expect(region.gaps).toEqual([])
  })

  it('直辖市给出 国家 → 直辖市 → 区县，不制造假的省级节点', () => {
    const region = parsePolicyRegion('北京市海淀区中关村大街 1 号', '北京市示例科技有限公司')
    expect(region.path.map((level) => level.label)).toEqual(['国家级', '北京市', '海淀区'])
    expect(region.isMunicipality).toBe(true)
  })

  it('解析不到省份时只保留国家级，并如实记录缺口', () => {
    const region = parsePolicyRegion('', '示例科技有限公司')
    expect(region.path.map((level) => level.label)).toEqual(['国家级'])
    expect(region.gaps[0]).toContain('未从项目地址或主体名称中解析出省/直辖市')
  })

  it('地址只写到地级市时，用主体名/地址里的城市把省补出来（真实数据常见）', () => {
    const region = parsePolicyRegion(undefined, '成都市武侯区智慧宜居建设开发有限公司')
    expect(region.path.map((level) => level.label)).toEqual(['国家级', '四川省', '成都市'])
  })

  it('地址只有区县、主体名带市名时同样补出省与市', () => {
    const region = parsePolicyRegion('武侯区示例路 1 号', '成都市示例建设有限公司')
    expect(region.path.map((level) => level.label)).toEqual(['国家级', '四川省', '成都市'])
  })
})

describe('政策链 · 三级检索计划', () => {
  it('按三级各出一条查询，用"发文机关 + 资金动作 + 文件类型"组织', () => {
    const targets = buildPolicySearchTargets({
      opportunityId: 'o1', projectTitle: '弱电智能化改造', companyName: '成都市武侯区智慧宜居建设开发有限公司',
      address: '四川省成都市武侯区', industry: '弱电智能化',
    })
    expect(targets.map((target) => target.levelId)).toEqual(['national', 'provincial', 'municipal'])
    expect(targets[0].query).toContain('财政部')
    expect(targets[0].query).toContain('五年规划')
    expect(targets[1].query).toContain('四川省财政厅')
    expect(targets[2].query).toContain('成都市财政局')
    // 政策/预算文件的实际标题就是"资金下达 + 通知/办法/细则"；用泛词会把招标公告一起捞上来。
    expect(targets.every((target) => target.query.includes('资金') && target.query.includes('通知'))).toBe(true)
  })

  it('行业是"不限"这类占位值时，查询里用"本行业"而不是把占位词当行业', () => {
    const targets = buildPolicySearchTargets({
      opportunityId: 'o1', projectTitle: '某项目', companyName: '成都市示例建设有限公司', industry: '不限',
    })
    expect(targets).toHaveLength(3)
    expect(targets[0].query).toContain('本行业')
    expect(targets[0].query).not.toContain('不限')
  })
})

describe('政策链 · 正文信号抽取（只抽真的写了的东西）', () => {
  it('抽出预算渠道、文号、预算年度与规划期', () => {
    const text = [
      '四川省财政厅关于下达2026年度地方政府专项债券额度的通知',
      '川财债〔2026〕15号',
      '来源：四川省财政厅',
      '发布日期：2026年3月12日',
      '本次下达资金用于市政基础设施和城市更新项目，纳入中央预算内投资和地方政府专项债券管理。',
      '各市（州）要编制项目清单，成都市应于2026年6月底前完成分解。',
      '本通知依据《四川省“十五五”规划纲要》（2026—2030年）执行。',
    ].join('\n')

    const signals = readPolicySignals(text, ['成都市'], '市政')

    expect(signals.isPolicyDocument).toBe(true)
    expect(signals.kind).toBe('budget')
    expect(signals.documentNumber).toBe('川财债〔2026〕15号')
    expect(signals.publisher).toBe('四川省财政厅')
    expect(signals.budgetYear).toBe(2026)
    expect(signals.instruments).toContain('地方政府专项债券')
    expect(signals.planNames.join('')).toContain('十五五')
    expect(signals.planWindows).toContain('2026—2030年')
    expect(signals.penetrationQuotes.some((quote) => quote.includes('成都市'))).toBe(true)
    expect(signals.effectiveAt).toBe('2026-03-12')
  })

  it('没有政策的正文不会被当成政策文件', () => {
    const signals = readPolicySignals('今天天气不错，我们一起去公园散步。', ['成都市'], '市政')
    expect(signals.isPolicyDocument).toBe(false)
    expect(signals.instruments).toEqual([])
    expect(signals.penetrationQuotes).toEqual([])
  })

  it('招标/采购类公告绝不能被当成政策或预算文件（真实端到端踩过的坑）', () => {
    const tenderTitle = '悦湖片区市政道路基础设施配套工程(四期)地铁保护监测服务竞争性磋商公告'
    const tenderText = [
      tenderTitle,
      '来源：成都市武侯区智慧宜居建设开发有限公司',
      '预算金额：120万元，最高限价：119万元。',
      '投标截止时间：2026年9月20日，开标时间：2026年9月20日 09:30。',
      '财库〔2016〕125号',
    ].join('\n')

    const signals = readPolicySignals(tenderText, ['四川省', '成都市'], '市政', tenderTitle)

    expect(signals.isPolicyDocument).toBe(false)
  })

  it('真正的政策/预算文件标题会被识别（发文机关 + 文件类型）', () => {
    const title = '四川省财政厅关于下达2026年度地方政府专项债券额度的通知'
    const signals = readPolicySignals(`${title}\n来源：四川省财政厅\n发布日期：2026年3月12日\n本次额度用于市政基础设施项目。`, ['成都市'], '市政', title)
    expect(signals.isPolicyDocument).toBe(true)
  })

  it('标题里的五年规划名给出公开固定的规划期（正文没有区间时也能作依据）', () => {
    const title = '四川省人民政府关于印发《四川省城市更新“十五五”规划》的通知'
    const signals = readPolicySignals(`${title}\n川府发〔2026〕13号\n来源：四川省人民政府\n城市更新行动部署如下。`, ['成都市'], '市政', title)

    expect(signals.planNames.join('')).toContain('十五五')
    expect(signals.planWindows).toContain('2026—2030年')
  })

  it('没有点名下級时，穿透证据为空（不靠层级推定）', () => {
    const signals = readPolicySignals('国家发展改革委关于印发管理办法的通知，各地自行组织实施。', ['成都市'], '市政')
    expect(signals.penetrationQuotes).toEqual([])
  })
})

describe('政策链 · 相关性门禁（2026-09-16 放宽：域关键词族）', () => {
  const keywords = policyScopeKeywords({
    industry: '市政基础设施',
    projectTitle: '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
    address: '四川省成都市武侯区',
  })

  it('词表由行业域展开，不要求正文出现行业原词', () => {
    expect(keywords).toContain('市政')
    expect(keywords).toContain('城市更新')
    expect(keywords).toContain('管网')
    expect(keywords.length).toBeGreaterThan(10)
  })

  it('真政策文件即使正文不写"市政基础设施"四个字，也算相关（诊断里被误拦的真实样本）', () => {
    expect(matchesPolicyScope('财政部关于下达2026年城市管网及污水处理补助资金预算的通知', '现下达你省城市管网及污水处理补助资金预算，用于管网改造与污水处理设施建设。', keywords)).toBe(true)
    expect(matchesPolicyScope('国务院关于印发《城市更新“十五五”规划》的通知', '城市更新行动是本五年规划的重点任务。', keywords)).toBe(true)
    expect(matchesPolicyScope(
      '成都市人民政府办公厅关于印发成都市2026年市级政府投资项目计划的通知',
      '2026年市级政府投资项目计划安排城市更新、市政道路、排水管网等项目共120项。',
      keywords,
    )).toBe(true)
  })

  it('跨领域资金文件仍然被排除（农业 / 以工代赈 / 生态保护修复）', () => {
    expect(matchesPolicyScope('四川省财政厅关于下达农业专项2026年第一批中央基建投资预算的通知', '农业专项中央基建投资预算下达如下。', keywords)).toBe(false)
    expect(matchesPolicyScope('四川省财政厅关于下达以工代赈2026年第二批中央基建投资预算的通知', '以工代赈中央基建投资预算下达如下。', keywords)).toBe(false)
    expect(matchesPolicyScope('四川省财政厅关于下达生态保护修复专项2026年第一批中央基建投资预算的通知', '生态保护修复专项下达如下。', keywords)).toBe(false)
  })

  it('栏目列表页 / 门户首页不是政策文件本身', () => {
    expect(isPolicyListingPage('列表-成都市人民政府', 'http://www.chengdu.gov.cn/cdsrmzf/c168509/zcwjk_search.shtml')).toBe(true)
    expect(isPolicyListingPage('信息公开目录 - 成都市住房和城乡建设局', 'https://cdzj.chengdu.gov.cn/gkml/xzgfxwj/1.shtml')).toBe(true)
    expect(isPolicyListingPage('成都市城市更新条例', 'https://cdzj.chengdu.gov.cn/cdzj/c131886/2026-03/05/content_1.shtml')).toBe(false)
  })

  it('经费投向与本行业无关的通用新闻不会被当成政策依据', () => {
    expect(matchesPolicyScope('河南一地拟获中央财政支持！', '本次支持方向为农业农村领域。', keywords)).toBe(false)
  })

  it('房地产 / 公积金 / 楼市类文件不会被当成市政政策', () => {
    expect(matchesPolicyScope('成都楼市新政：加大住房公积金支持力度，探索将房票安置适用范围从住宅拓展至非住宅', '为促进房地产市场平稳健康发展，本市调整公积金贷款政策。', keywords)).toBe(false)
    expect(matchesPolicyScope('成都出台十条新政 公积金贷款贴息20% 多举措促进房产市场健康发展', '公积金贷款贴息、房票安置等十项措施发布。', keywords)).toBe(false)
    // 真正讲城市更新的文件即使顺带提到房票，也仍然保留。
    expect(matchesPolicyScope('成都市城市更新行动计划（2024—2026年）', '推进老旧小区与市政道路排水管网改造，涉及房票安置试点。', keywords)).toBe(true)
  })

  it('裸域名/过短标题不是政策文件', () => {
    expect(matchesPolicyScope('finance.sina.com.cn', '正文内容', keywords)).toBe(false)
    expect(matchesPolicyScope('新浪财经', '正文内容', keywords)).toBe(false)
  })
})

describe('政策链 · 来源性质（官方原文 vs 媒体转载）', () => {
  it('政府域名/机关发布算官方原文，媒体与聚合站算转载', () => {
    expect(policySourceTier('https://www.gov.cn/zhengce/zhengceku/202601/content_1.htm', '中国政府网')).toBe('official')
    expect(policySourceTier('https://www.cdwh.gov.cn/wuhou/x.shtml', '成都市武侯区人民政府')).toBe('official')
    expect(policySourceTier('http://m.toutiao.com/group/1', '今日头条')).toBe('media')
    expect(policySourceTier(undefined, '采招网')).toBe('media')
  })

  it('媒体页里粘连的文号不会被当成本文文号', () => {
    const text = [
      '事关贷款贴息等，五项重要政策发布',
      '关于优化实施设备更新贷款财政贴息政策有关事项的通知财金〔2026〕1号',
      '发布时间：2026年1月20日',
    ].join('\n')

    const signals = readPolicySignals(text, ['四川省'], '市政', '事关贷款贴息等，五项重要政策发布')

    expect(signals.documentNumber).toBeUndefined()
  })
})

describe('政策链 · 预测必须带依据（禁止编造）', () => {
  const document = (overrides: Record<string, unknown> = {}) => ({
    levelId: 'provincial' as const, levelLabel: '四川省', evidenceId: 'ev-1', title: '四川省财政厅关于下达2026年度专项债券额度的通知',
    publisher: '四川省财政厅',
    signals: {
      isPolicyDocument: true, kind: 'budget' as const, instruments: ['地方政府专项债券'],
      planNames: [] as string[], planWindows: [] as string[], penetrationQuotes: [],
      budgetYear: 2026, effectiveAt: '2026-03-12', ...overrides,
    },
  })

  it('预算年度文件 → 顺延一年的资金窗口，依据写明来源文件', () => {
    const predictions = buildPolicyPredictions({ documents: [document()], stageDates: [], industry: '市政' })
    const budget = predictions.find((entry) => entry.basisKind === 'budget-document')
    expect(budget).toMatchObject({ windowStart: '2027-03', windowEnd: '2027-03', certainty: 'forecast' })
    expect(budget?.basis).toContain('2026年度')
    expect(budget?.basisEvidenceIds).toContain('ev-1')
  })

  it('本单位历史采购节奏 → 按平均间隔推算下一节点，依据列出历史日期', () => {
    const predictions = buildPolicyPredictions({
      documents: [],
      stageDates: [
        { stageId: 'tender', occurredAt: '2024-03-01' },
        { stageId: 'tender', occurredAt: '2025-03-01' },
      ],
      industry: '市政',
    })
    const cadence = predictions.find((entry) => entry.basisKind === 'historical-cadence')
    expect(cadence).toMatchObject({ windowStart: '2026-03', certainty: 'forecast' })
    expect(cadence?.basis).toContain('2024-03-01')
    expect(cadence?.basis).toContain('12 个月')
  })

  it('正式采购意向里的日期算"确定节点"，与预测分开标记', () => {
    const predictions = buildPolicyPredictions({
      documents: [{
        levelId: 'municipal', levelLabel: '成都市', evidenceId: 'ev-9', title: '成都市2026年政府采购意向公开',
        publisher: '成都市财政局',
        signals: {
          isPolicyDocument: true, kind: 'policy', instruments: [], planNames: [], planWindows: [],
          penetrationQuotes: [], effectiveAt: '2026-11-01',
        },
      }],
      stageDates: [], industry: '市政',
    })
    expect(predictions[0]).toMatchObject({ certainty: 'confirmed', basisKind: 'procurement-intent', windowStart: '2026-11' })
  })

  it('只有五年规划证据时给出规划期内窗口并标明低置信度', () => {
    const predictions = buildPolicyPredictions({
      documents: [document({ budgetYear: undefined, planNames: ['“十五五”规划'], planWindows: ['2026—2030年'] })],
      stageDates: [], industry: '市政', now: new Date('2026-09-16T00:00:00Z'),
    })
    const plan = predictions.find((entry) => entry.basisKind === 'five-year-plan')
    expect(plan).toMatchObject({ certainty: 'forecast', confidence: 'low', windowStart: '2027-01', windowEnd: '2027-12' })
    expect(plan?.basis).toContain('2026—2030年')
  })

  it('没有任何依据时不出预测（禁止编造时间）', () => {
    expect(buildPolicyPredictions({ documents: [], stageDates: [], industry: '市政' })).toEqual([])
    expect(buildPolicyPredictions({ documents: [document({ budgetYear: undefined, effectiveAt: undefined })], stageDates: [], industry: '市政' })).toEqual([])
  })
})

describe('政策链 · 请求校验', () => {
  it('接受合法请求并拒绝缺字段请求', () => {
    expect(() => assertPolicyChainRequest({
      opportunityId: 'o1', projectTitle: '项目', companyName: '主体', industry: '弱电',
      stageDates: [{ stageId: 'tender', occurredAt: '2026-09-08' }],
    })).not.toThrow()
    expect(() => assertPolicyChainRequest({ opportunityId: 'o1', projectTitle: '项目', industry: '弱电' })).toThrow()
  })

  it('uniqueStrings 去重且去掉空值', () => {
    expect(uniqueStrings(['a', ' a ', '', 'b', 'b'])).toEqual(['a', 'b'])
  })
})
