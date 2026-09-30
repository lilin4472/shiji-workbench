// E2E 验证专用 preload（记录被调用的能力，便于断言"是否真的执行了"）
// 政策链桩会按请求里的三级查询返回一份"真实形状"的政策链结果，
// 让界面自测能验证：三级梯、穿透原句、带依据的预测、无依据时不出预测。
const ok = async (value) => ({ ok: true, value })
const fail = async (message = 'verify-stub') => ({ ok: false, message })
const calls = []
window.__verifyCalls = calls
const levelOf = (query) => (query.includes('国家') ? { id: 'national', label: '国家级' } : query.includes('四川省') ? { id: 'provincial', label: '四川省' } : { id: 'municipal', label: '成都市' })
const policyResult = (input) => {
  const targets = [
    { levelId: 'national', label: '国家级', query: `国家 ${input.industry} 政策 预算` },
    { levelId: 'provincial', label: '四川省', query: `四川省 ${input.industry} 政策 预算` },
    { levelId: 'municipal', label: '成都市', query: `成都市 ${input.industry} 政策 预算` },
  ]
  const finding = (levelId, label, kind, title, publisher, documentNumber, effectiveAt, penetrationQuote) => ({
    id: `policy-${levelId}-1`, levelId, levelLabel: label, kind, title, publisher, documentNumber,
    industries: [input.industry], instruments: kind === 'budget' ? ['地方政府专项债券'] : ['项目库/任务清单'],
    effectiveAt, transmission: `${label}通过资金渠道向下传导；是否已到具体招标单位仍需下一级文件确认。`,
    penetration: penetrationQuote ? [{ targetLevelId: 'municipal', targetLabel: '成都市', quote: penetrationQuote }] : [],
    relatedSubjects: [input.companyName],
    sources: [{ evidenceId: `ev-${levelId}`, title, publisher, pageUrl: `https://example.gov.cn/${levelId}` }],
    sourceTier: levelId === 'municipal' ? 'media' : 'official',
    confidence: levelId === 'municipal' ? 'low' : 'high',
  })
  return {
    opportunityId: input.opportunityId, subjectName: input.companyName, industry: input.industry,
    regionPath: [{ id: 'national', label: '国家级' }, { id: 'provincial', label: '四川省' }, { id: 'municipal', label: '成都市' }],
    findings: [
      finding('national', '国家级', 'budget', '财政部关于下达2026年度中央预算内投资计划的通知', '财政部', '财建〔2026〕30号', '2026-04-02', '四川省、成都市应按项目清单于2026年内完成分解落实。'),
      finding('provincial', '四川省', 'budget', '四川省财政厅关于下达2026年度地方政府专项债券额度的通知', '四川省财政厅', '川财债〔2026〕15号', '2026-03-12', '成都市应于2026年6月底前完成项目分解。'),
      finding('municipal', '成都市', 'policy', '成都市市政基础设施提升实施细则', '成都市住房和城乡建设局', undefined, '2026-05-20', undefined),
    ],
    predictions: [
      {
        id: 'budget-ev-provincial', label: '下一预算年度的资金下达/申报窗口', windowStart: '2027-03', windowEnd: '2027-03',
        certainty: 'forecast', basisKind: 'budget-document', basis: '依据四川省《四川省财政厅关于下达2026年度地方政府专项债券额度的通知》的2026年度预算口径，按年度周期顺延一年。',
        signals: ['观察2027年度同类资金文件是否在同月下达'], confidence: 'medium', basisEvidenceIds: ['ev-provincial'],
      },
    ],
    queries: targets,
    // policy-1 = 本次真实联网；policy-2 = 命中本机缓存（用于验证'检索成功  命中缓存  暂无更新'口径）
    requestCount: input.opportunityId === 'policy-2' ? 0 : 3,
    cacheHit: input.opportunityId === 'policy-2',
    checkedAt: input.opportunityId === 'policy-2' ? '2026-09-17T09:39:00.000Z' : new Date().toISOString(),
    gaps: [], boundary: '政策与预算文件只说明资金或任务的传导方向；除正式采购意向/公告外，其余时间一律是预测性建议。',
  }
}
const industryResult = (input) => ({
  opportunityId: input.opportunityId,
  projectTitle: input.projectTitle,
  owner: {
    name: input.companyName,
    legalPerson: '张伟',
    industryField: '市政基础设施（本次项目范围）',
    phone: '028-85123456',
    sources: [{ evidenceId: 'ev-owner', title: '中标结果公告', publisher: '成都市武侯区人民政府', pageUrl: 'https://example.gov.cn/owner', tier: 'official' }],
  },
  winners: [{
    id: 'company:winner-1', name: '四川中测检测技术有限公司', relation: 'historical-winner',
    relationQuote: '中标人：四川中测检测技术有限公司  中标金额：118.6 万元',
    legalPerson: '李明', industryField: '地铁保护监测（本次项目范围）', phone: '028-86112233',
    sources: [{ evidenceId: 'ev-win', title: '中标结果公告', publisher: '成都市武侯区人民政府', pageUrl: 'https://example.gov.cn/win', tier: 'official' }],
    confidence: 'confirmed',
  }],
  suppliers: [
    {
      id: 'company:supplier-1', name: '成都智联机电设备有限公司', relation: 'supplier',
      relationQuote: '供应商：成都智联机电设备有限公司',
      industryField: '机电设备（本次项目范围）', phone: '13800001111',
      sources: [{ evidenceId: 'ev-sup', title: '采购意向公开', publisher: '成都市武侯区人民政府', pageUrl: 'https://example.gov.cn/sup', tier: 'official' }],
      confidence: 'confirmed',
    },
    {
      id: 'company:supplier-2', name: '成都恒信劳务有限公司', relation: 'subcontractor',
      relationQuote: '分包单位：成都恒信劳务有限公司',
      sources: [{ evidenceId: 'ev-sub', title: '行业媒体转载', publisher: '某行业媒体', pageUrl: 'https://media.example.com/sub', tier: 'media' }],
      confidence: 'candidate',
    },
  ],
  queries: [`"${input.companyName}" 中标 成交 结果 公告`, `"${input.projectTitle}" 中标 成交 联合体 分包 供应商`, `"${input.companyName}" 供应商 采购 合同 招标代理`],
  requestCount: 3, cacheHit: false, checkedAt: new Date().toISOString(),
  gaps: ['本次未检索到甲方以外企业的法人字段（公开来源未写明）。'],
  boundary: '产业链只记录公告与公开页面里写明的企业与关系原句：中标/成交关系来自对应公告正文，上下游多为线索级；四维度字段抽不到就显示"未取得"。',
})
const creditRiskResult = (input) => {
  const isGovernment = /(局|委员会|人民政府|管委会)/.test(input.companyName)
  return {
    opportunityId: input.opportunityId,
    projectTitle: input.projectTitle,
    subjectName: input.companyName,
    profile: isGovernment
      ? { name: input.companyName, subjectType: 'government', subjectTypeBasis: '名称含政府/行政机关后缀', legalPerson: '李静', industry: '住房和城乡建设', address: '成都市武侯区示例街 2 号', code: '1151010XXXXXXXXXXX', codeLabel: '机构登记代码', phone: '028-85550000', registrationStatus: '正常', sourceTitle: '机构登记信息', sourceUrl: 'https://example.gov.cn/org' }
      : { name: input.companyName, subjectType: 'enterprise', subjectTypeBasis: '名称含企业组织形式后缀', legalPerson: '王强', industry: '检验检测服务', address: '成都市武侯区示例路 1 号', code: '91510100MA6XXXXX1A', codeLabel: '统一社会信用代码', phone: '028-86001234', registrationStatus: '存续', sourceTitle: '工商登记信息', sourceUrl: 'https://www.qcc.com/firm/abc.html' },
    facts: isGovernment ? [] : [
      { id: 'fact:penalty', subjectName: input.companyName, category: 'administrative-penalty', categoryLabel: '行政处罚', reason: '未按规定对检测设备进行检定即出具报告', occurredAt: '2026-05-18', amount: '3 万元', authority: '成都市市场监督管理局', location: '成都市武侯区示例路 1 号', documentNumber: '成武市监罚〔2026〕5号', sourceTitle: '行政处罚决定书', publisher: '成都市市场监督管理局', sourceUrl: 'https://sc.gsxt.gov.cn/penalty', tier: 'registry', sourceWalled: false },
      { id: 'fact:litigation', subjectName: input.companyName, category: 'administrative-litigation', categoryLabel: '行政诉讼/裁判文书', reason: '对行政处罚决定不服提起行政诉讼', occurredAt: '2026-08-02', authority: '成都市中级人民法院', sourceTitle: '开庭公告', publisher: '成都市中级人民法院', sourceUrl: 'https://court.example.gov.cn/a', tier: 'official', sourceWalled: false },
      { id: 'fact:walled', subjectName: input.companyName, category: 'business-abnormal', categoryLabel: '经营异常', reason: '经营异常（来源未写明具体事由）', occurredAt: '2026-09-04', sourceTitle: '企业风险信息 - 企查查', publisher: '企查查', sourceUrl: 'https://www.qcc.com/firm/abc.html', tier: 'registry', sourceWalled: true },
    ],
    queries: [`"${input.companyName}" 统一社会信用代码 法定代表人`, `"${input.companyName}" 行政处罚 违法事实`, `"${input.companyName}" 失信被执行人 裁判文书`, `"${input.projectTitle}" 串通投标 处罚`],
    requestCount: 4, cacheHit: false, checkedAt: new Date().toISOString(),
    gaps: isGovernment ? ['本次没有取得可核验的公开风险事实（搜不到不等于没有风险）。'] : ['主体「' + input.companyName + '」的统一社会信用代码 / 法人 / 地址本次未取得（工商公示页未命中或需登录）。'],
    boundary: '公开风险只记录公开来源里写明的主体与事项：搜不到一律标"未核验"，不等于该主体没有风险；商业与媒体转载只作相关参考。',
  }
}
const base = {
  contractVersion: 21,
  version: '0.0.0-verify',
  mockEnabled: false,
  debug: { log: () => {} },
  search: {
    getPreference: async () => ok({ defaultProvider: 'doubao' }),
    discoverProjectTimeline: async (input) => { calls.push({ api: 'discoverProjectTimeline', input }); return fail('verify-stub: 时间链执行器在自测中被替换') },
    runPolicyChain: async (input) => { calls.push({ api: 'runPolicyChain', input }); return ok(policyResult(input)) },
    runIndustryChain: async (input) => { calls.push({ api: 'runIndustryChain', input }); return ok(industryResult(input)) },
    runCreditRisk: async (input) => { calls.push({ api: 'runCreditRisk', input }); return ok(creditRiskResult(input)) },
  },
  agent: { onEvent: () => () => {}, cancel: async () => ok(true) },
  evidence: { list: async () => ok([]) },
}
window.shijiDesktop = new Proxy(base, { get: (target, key) => (key in target ? target[key] : new Proxy({}, { get: () => fail })) })
