import { describe, expect, it, vi } from 'vitest'
import { searchSourceToEvidenceRecord } from '../shared/evidence-contract.js'
import type { SearchResult, SearchSource } from '../shared/search-contract.js'
import type { SearchDocumentReadResult } from './search-document-reader.js'
import { extractAddressCandidates, extractSubjectCandidates, prepareOpportunitySources } from './opportunity-source-preparer.js'

function resultFor(sources: SearchSource[]): SearchResult {
  const checkedAt = '2026-09-07T02:00:00.000Z'
  const query = '成都 机电安装 招标公告 官方'
  return {
    provider: 'doubao', purpose: 'opportunity-discovery', query, sources,
    evidenceRecords: sources.map((source) => searchSourceToEvidenceRecord(source, { provider: 'doubao', query, capturedAt: checkedAt })),
    truncated: false, requestCount: 1, cacheHit: false, checkedAt,
  }
}

function readResult(source: SearchSource, text: string, overrides: Partial<SearchDocumentReadResult> = {}): SearchDocumentReadResult {
  return {
    sourceUrl: source.url,
    finalUrl: source.url,
    httpRequestCount: source.content ? 0 : 1,
    mediaKind: 'html',
    sizeBytes: text.length,
    extraction: {
      processingStatus: 'content-ready', text,
      provenanceTypeCandidate: 'unknown', documentIdentifiers: [], truncated: false, warnings: [],
    },
    ...overrides,
  }
}

describe('opportunity source preparer', () => {
  it('does not attach a different project reached through a detail-page hop; uses the matching provider body', async () => {
    const source: SearchSource = {
      url: 'https://example.com/bidding_v_rain.html', sourceClass: 'other',
      title: '青城园区雨水回收系统工程采购公告',
      content: '青城园区雨水回收系统工程采购公告\n本项目进行询价。\n建设地点：都江堰市青城山镇青城社区。' + '项目施工内容。'.repeat(45),
    }
    const reader = vi.fn(async (input: SearchSource) => input.content
      ? readResult(input, input.content)
      : readResult(input, '旺苍县景区观光车采购磋商公告\n采购人：旺苍县旅游公司\n采购公告', {
        finalUrl: 'https://example.com/bidding_v_bus.html',
        extraction: {
          processingStatus: 'content-ready', text: '旺苍县景区观光车采购磋商公告\n采购人：旺苍县旅游公司\n采购公告',
          title: '旺苍县景区观光车采购磋商公告', provenanceTypeCandidate: 'unknown',
          documentIdentifiers: [], truncated: false, warnings: [],
        },
      }))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks?.addressCandidates).toContain('都江堰市青城山镇青城社区')
    expect(prepared.evidenceRecords[0]?.provenance.pageUrl).toBe(source.url)
    expect(prepared.evidenceRecords[0]?.title).not.toContain('旺苍县')
  })

  it('does not confuse two different projects merely because both titles end in a construction tender notice', async () => {
    const source: SearchSource = { url: 'https://example.com/east', sourceClass: 'other', title: '东山道路改造项目施工标段招标公告' }
    const reader = vi.fn(async () => readResult(source, '西河桥梁提升项目施工标段招标公告\n招标人：西河建设公司', {
      finalUrl: 'https://example.com/west',
      extraction: {
        processingStatus: 'content-ready', text: '西河桥梁提升项目施工标段招标公告\n招标人：西河建设公司',
        title: '西河桥梁提升项目施工标段招标公告', provenanceTypeCandidate: 'unknown',
        documentIdentifiers: [], truncated: false, warnings: [],
      },
    }))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks?.eligibleForModel).toBe(false)
    expect(prepared.evidenceRecords[0]?.provenance.pageUrl).toBe(source.url)
  })

  it('extracts a qualification-application submission deadline without turning bidder qualification amounts into project budget', async () => {
    const source: SearchSource = { url: 'https://example.com/qualification', sourceClass: 'other', title: '成都锦樾序供电工程资审公告' }
    const reader = vi.fn(async () => readResult(source, [
      '成都锦樾序供电工程资审公告', '招标人：华润置地成都有限公司',
      '项目地址：四川省成都市', '资格预审申请文件的递交',
      '递交截止时间：2026-08-31 12:00',
      '投标人类似工程业绩单合同额不低于3000万元。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks?.deadlineCandidates).toEqual(['2026-08-31'])
    expect(prepared.sources[0]?.opportunityChecks?.amountWanCandidates).toEqual([])
  })

  it('cuts concatenated procurement fields after a project address', () => {
    const body = '项目建设地点：南京市高淳区经济开发区招标范围：35KV及10KV线路迁改、通信工程、顶管工程计划工期：60日历天合同估算价：24000000元'
    expect(extractAddressCandidates(body)).toEqual(['南京市高淳区经济开发区'])
  })


  it('recognizes subject labels in parenthesized, table and title formats', () => {
    const subjects = extractSubjectCandidates([
      '采购人（招标人）：成都示例建设有限公司',
      '招标人 上海示例机电安装工程有限公司',
      '| 招标人 | 广州示例产业发展有限公司 |',
      '招标人名称：深圳示例科技有限公司',
    ].join('\n'))

    expect(subjects).toEqual([
      '成都示例建设有限公司',
      '深圳示例科技有限公司',
      '上海示例机电安装工程有限公司',
      '广州示例产业发展有限公司',
    ])
    expect(extractSubjectCandidates('成都示例建设有限公司关于总部湾项目招标公告')).toEqual(['成都示例建设有限公司'])
  })

  it('does not trust a provider summary as the announcement body', async () => {
    const source: SearchSource = {
      url: 'https://industry.example.com/list/1', sourceClass: 'other', title: '高新区机电安装招标公告',
      content: '搜索摘要：高新区机电安装招标公告，点击查看详情。',
    }
    const reader = vi.fn(async (readSource: SearchSource) => {
      expect(readSource.content).toBeUndefined()
      return readResult(readSource, '招标人：成都示例建设有限公司\n工程招标公告\n项目编号：CD-2026-101')
    })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(reader).toHaveBeenCalledOnce()
    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: true, stageIds: ['tender'] })
  })

  it('reads content, extracts deterministic checks and keeps a commercial repost eligible', async () => {
    const source: SearchSource = {
      url: 'https://industry.example.com/repost/1', sourceClass: 'other', title: '园区改造招标公告',
    }
    const reader = vi.fn(async () => readResult(source, [
      '转载自：成都市公共资源交易服务中心',
      '发布日期：2026年9月7日',
      '项目编号：CD-2026-101',
      '招标人：成都示例建设有限公司',
      '联系人：张三，联系电话：13800138000',
      '建设地点：成都市高新区天府大道北段',
      '本项目发布招标公告，投标截止日期为2026年10月8日。',
    ].join('\n'), {
      extraction: {
        processingStatus: 'content-ready',
        text: '转载自：成都市公共资源交易服务中心\n发布日期：2026年9月7日\n项目编号：CD-2026-101\n招标人：成都示例建设有限公司\n联系人：张三，联系电话：13800138000\n建设地点：成都市高新区天府大道北段\n本项目发布招标公告，投标截止日期为2026年10月8日。',
        publisherCandidate: '示例行业媒体', originalPublisherCandidate: '成都市公共资源交易服务中心',
        provenanceTypeCandidate: 'explicit-repost', documentIdentifiers: [{ kind: 'project-number', value: 'CD-2026-101' }],
        publishedAtCandidate: '2026-09-07', truncated: false, warnings: [],
      },
    }))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      readStatus: 'body-ready', eligibleForModel: true,
      subjectCandidates: ['成都示例建设有限公司'], stageIds: ['tender'],
      stageDateCandidates: ['2026-09-07'], deadlineCandidates: ['2026-10-08'],
      amountWanCandidates: [],
      addressCandidates: ['成都市高新区天府大道北段'],
    })
    expect(prepared.evidenceRecords[0]).toMatchObject({
      artifact: { processingStatus: 'content-ready' },
      provenance: {
        publisher: '示例行业媒体', originalPublisher: '成都市公共资源交易服务中心',
        provenanceType: 'explicit-repost', documentIdentifiers: [{ kind: 'project-number', value: 'CD-2026-101' }],
      },
      assessment: { status: 'pending' },
      opportunityDetails: {
        companyCandidates: ['成都示例建设有限公司'],
        stageIds: ['tender'],
        contactCandidates: expect.arrayContaining(['张三，联系电话：13800138000', '13800138000']),
      },
    })
  })

  it('normalizes labeled amounts and bid deadlines without mistaking unrelated money for project value', async () => {
    const source: SearchSource = { url: 'https://example.com/tender/amount', sourceClass: 'other', title: '设备采购招标公告' }
    const reader = vi.fn(async () => readResult(source, [
      '采购人：广州示例产业发展有限公司',
      '预算金额：1.26亿元',
      '投标保证金：20万元',
      '提交投标文件截止时间：2026年11月18日09时30分',
      '发布日期：2026年9月8日',
      '现发布招标公告。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      amountWanCandidates: [12600], deadlineCandidates: ['2026-11-18'], stageDateCandidates: ['2026-09-08'],
    })
    expect(prepared.sources[0]?.opportunityChecks?.amountWanCandidates).not.toContain(20)
  })

  it('recognizes a government-procurement response deadline written before the action phrase', async () => {
    const source: SearchSource = { url: 'https://www.ccgp.gov.cn/tender/deadline', sourceClass: 'government', title: '配电工程竞争性磋商公告' }
    const reader = vi.fn(async () => readResult(source, [
      '采购人：上海示例建设中心',
      '本项目竞争性磋商。',
      '并于2026年01月12日 09:30（北京时间）前提交响应文件。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks?.deadlineCandidates).toEqual(['2026-01-12'])
  })

  it('builds a source-grounded tender detail instead of asking the model to invent bidding fields', async () => {
    const source: SearchSource = { url: 'https://example.gov.cn/tender/detail', sourceClass: 'government', title: '园区机电工程招标公告' }
    const text = [
      '招标人：上海示例建设有限公司',
      '招标代理机构：上海示例招标代理有限公司',
      '标段名称：机电安装一标段',
      '招标范围：暖通、电气及给排水系统安装和调试。',
      '投标人资格要求：建筑机电安装工程专业承包一级资质。',
      '联合体要求：本项目不接受联合体投标。',
      '招标文件获取方式：登录交易平台下载，获取截止时间为2026年10月10日。',
      '投标保证金：人民币20万元。',
      '提交投标文件截止时间：2026年10月20日09时30分。',
      '开标时间：2026年10月20日09时30分。',
      '评标办法：综合评估法。',
      '项目地址：上海市浦东新区示例路88号。',
      '联系电话：021-12345678。',
      '本项目发布招标公告。',
    ].join('\n')
    const reader = vi.fn(async () => readResult(source, text, {
      extraction: {
        processingStatus: 'content-ready', text, provenanceTypeCandidate: 'unknown',
        documentIdentifiers: [{ kind: 'project-number', value: 'SH-2026-001' }],
        attachmentCandidates: [{ label: '招标文件.zip', url: 'https://example.gov.cn/files/bid.zip' }],
        truncated: false, warnings: [],
      },
    }))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.evidenceRecords[0]?.opportunityDetails).toMatchObject({
      agencyCandidates: ['上海示例招标代理有限公司'],
      lotCandidates: ['机电安装一标段'],
      scopeCandidates: ['暖通、电气及给排水系统安装和调试'],
      qualificationCandidates: ['建筑机电安装工程专业承包一级资质'],
      consortiumCandidates: ['本项目不接受联合体投标'],
      documentAccessCandidates: ['登录交易平台下载，获取截止时间为2026年10月10日'],
      depositCandidates: ['人民币20万元'],
      openingTimeCandidates: ['2026年10月20日09时30分'],
      evaluationMethodCandidates: ['综合评估法'],
      attachmentCandidates: [{ label: '招标文件.zip', url: 'https://example.gov.cn/files/bid.zip' }],
    })
  })

  it('extracts government-procurement Markdown tables into a clean award detail', async () => {
    const source: SearchSource = {
      url: 'https://www.ccgp.gov.cn/award/markdown', sourceClass: 'government',
      title: '临港变电所工程的中标（成交）结果公告',
    }
    const text = [
      '| 采购单位 | 上海市临港新片区生态环境绿化市容事务中心 | | |',
      '| 总中标金额 | ￥102.670000 万元（人民币） | | |',
      '| 项目联系人 | 谢燕飞 | | |',
      '| 项目联系电话 | 021-55887786\\*8876 | | |',
      '| 采购单位联系方式 | 021-38072172 | | |',
      '| 代理机构名称 | 上海子亚工程造价咨询有限公司 | | |',
      '| 序号 | 标项名称 | 中标供应商名称 |',
      '| 1 | 临港变电所工程 | 上海育兰电气安装有限公司 |',
      '| 序号 | 包名称 | 标的名称 | 施工范围 |',
      '| 1 | 临港变电所工程 | 临港变电所工程 | 10kv变电所设备安装及调试 |',
      '三、中标（成交）信息',
    ].join('\n')
    const reader = vi.fn(async () => readResult(source, text))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: true,
      stageIds: ['award'],
      amountWanCandidates: [102.67],
    })
    expect(prepared.evidenceRecords[0]?.opportunityDetails).toMatchObject({
      agencyCandidates: ['上海子亚工程造价咨询有限公司'],
      contactCandidates: expect.arrayContaining(['谢燕飞', '021-55887786*8876', '021-38072172']),
    })
  })

  it.each([
    {
      region: '上海政府采购版式',
      url: 'https://www.ggzy.gov.cn/html/b/310000/0201/sample.shtml',
      text: '发布时间：2025-07-14 17:30\n公开招标公告\n预算金额（元）：1300000元\n提交投标文件截止时间：2025年08月04日 10:00\n1.采购人信息\n名 称：上海市黄浦区灯光景观管理所',
      subject: '上海市黄浦区灯光景观管理所', amount: 130, deadline: '2025-08-04', stageDate: '2025-07-14',
    },
    {
      region: '四川工程招标版式',
      url: 'https://ggzyjy.sc.gov.cn/jyxx/002001/002001001/sample.html',
      text: '发布时间：2026-02-13 09:00\n招标公告\n招标人：仁寿县示例建设单位\n本次招标最高限价1229.07万元。\n投标文件递交的截止时间（投标截止时间，下同）为2026-03-09 09:30。',
      subject: '仁寿县示例建设单位', amount: 1229.07, deadline: '2026-03-09', stageDate: '2026-02-13',
    },
    {
      region: '广东建设工程版式',
      url: 'https://www.ggzy.gov.cn/html/b/440000/0101/sample.shtml',
      text: '公告日期：2025年08月11日\n招标公告\n招标人：广州示例投资发展有限公司\n本次招标最高投标限价为968,036,439.82元。\n投标截止时间：2025年08月22日。',
      subject: '广州示例投资发展有限公司', amount: 96803.644, deadline: '2025-08-22', stageDate: '2025-08-11',
    },
  ])('accepts the $region public-page field layout', async ({ url, text, subject, amount, deadline, stageDate }) => {
    const source: SearchSource = { url, sourceClass: 'government', title: '公开招标公告' }
    const reader = vi.fn(async () => readResult(source, text))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: true,
      subjectCandidates: [subject],
      amountWanCandidates: expect.arrayContaining([amount]),
      deadlineCandidates: [deadline],
      stageDateCandidates: [stageDate],
    })
  })

  it('keeps an explicitly different stage out when the user selected a concrete stage', async () => {
    const source: SearchSource = { url: 'https://example.com/award/1', sourceClass: 'other', title: '项目中标结果' }
    const reader = vi.fn(async () => {
      const result = readResult(source, '招标人：成都示例建设有限公司\n本项目发布中标结果公告。')
      result.extraction.title = '招标公告'
      return result
    })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      readStatus: 'body-ready', eligibleForModel: false, stageIds: ['award'],
    })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('明确属于其他阶段')
  })

  it('keeps an unknown-stage specific source available for model review', async () => {
    const source: SearchSource = { url: 'https://example.com/project/1', sourceClass: 'other', title: '成都产业园机电工程项目详情' }
    const reader = vi.fn(async () => readResult(source, '招标人：成都示例建设有限公司\n项目编号：CD-2026-101\n本页面介绍项目实施范围。'))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      readStatus: 'body-ready', eligibleForModel: true, stageIds: [],
    })
  })

  it('keeps an abnormal or terminated notice out even when its body mentions tender words', async () => {
    const source: SearchSource = { url: 'https://example.com/change/1', sourceClass: 'other', title: '南京港弱电安装专业分包项目异常公告' }
    const reader = vi.fn(async () => {
      const result = readResult(source, '招标人：南京港港务工程有限公司\n原招标公告及采购信息现发生异常，本项目停止采购。')
      result.extraction.title = '招标公告'
      return result
    })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('异常、终止、废标或流标公告')
  })

  it('retains a confirmed business stage when the user selected all stages', async () => {
    const source: SearchSource = { url: 'https://example.com/award/2', sourceClass: 'other', title: '项目中标结果' }
    const reader = vi.fn(async () => readResult(source, '招标人：成都示例建设有限公司\n本项目发布中标结果公告。'))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: true, stageIds: ['award'] })
  })

  it('recognizes a real 成交候选供应商公示 as candidate instead of tender', async () => {
    const source: SearchSource = {
      url: 'https://www.tower.com.cn/notice/1', sourceClass: 'other',
      title: '中国铁塔南京市分公司弱电迁改工程采购项目成交候选供应商结果公示',
    }
    const reader = vi.fn(async () => readResult(source, '采购人：中国铁塔股份有限公司江苏省分公司\n本项目进行公开询比。成交候选供应商结果如下。'))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false, stageIds: ['candidate'] })
  })

  it('keeps a source visible but out of model input when it misses a locked company or project', async () => {
    const source: SearchSource = { url: 'https://example.com/tender/locked-target', sourceClass: 'other', title: '其他园区机电工程招标公告' }
    const reader = vi.fn(async () => readResult(source, '招标人：成都其他建设有限公司\n其他园区机电工程发布招标公告。'))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader, {
      targetCompanyName: '成都目标建设有限公司', targetProjectName: '目标产业园机电工程',
    })

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('目标单位')
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('目标项目')
  })

  it('allows a document that matches both visible locked targets', async () => {
    const source: SearchSource = { url: 'https://example.com/tender/locked-target-ok', sourceClass: 'government', title: '目标产业园（K11-02地块）机电工程招标公告' }
    const reader = vi.fn(async () => readResult(source, '招标人：成都目标建设有限公司\n目标产业园（K11-02地块）机电工程发布招标公告。'))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader, {
      targetCompanyName: '成都目标建设有限公司', targetProjectName: '目标产业园机电工程',
    })

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: true })
  })

  it.each([
    '立即查看',
    '****** [查看]招标',
    '上海 (略) 技术中心',
    '某单位',
  ])('2026-09-15 放宽后：掩码主体不再拦截整页，交由模型判断（%s）', async (subject) => {
    const source: SearchSource = { url: 'https://example.com/award/masked', sourceClass: 'other', title: '机电安装中标结果公告' }
    const reader = vi.fn(async () => readResult(source, `招标人：${subject}\n本项目发布中标结果公告。`))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'award', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: true,
      subjectCandidates: [],
      stageIds: ['award'],
    })
  })

  it('2026-09-15 新增：招采平台门户首页绝不进入模型（实测成都市政府招采平台案例）', async () => {
    const source: SearchSource = {
      url: 'https://www.scggzy.gov.cn/', sourceClass: 'other', title: '成都市公共资源交易服务中心',
    }
    // 门户首页特征：正文只有平台介绍与栏目词，没有编号、截止时间、附件。
    const reader = vi.fn(async () => readResult(source, [
      '成都市公共资源交易服务中心门户网站',
      '采购单位：成都市市级单位',
      '招标信息 采购信息 交易公告 政策法规',
      '欢迎访问本平台，本平台为全市统一的招标投标和政府采购公共服务平台。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('平台或门户首页')
  })

  it('2026-09-15 新增：门户域名下的具体公告页（有编号+截止时间）正常放行', async () => {
    const source: SearchSource = {
      url: 'https://www.scggzy.gov.cn/notice/2026/001.html', sourceClass: 'government',
      title: '某医院迁建项目机电安装招标公告',
    }
    const reader = vi.fn(async () => readResult(source, [
      '项目编号：SCGGZY-2026-001',
      '招标人：成都示例建设有限公司',
      '投标文件提交截止时间：2026年10月20日',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: true })
  })

  it('keeps a multi-project portal page visible but out of the model input', async () => {
    const source: SearchSource = {
      url: 'https://sh.example.com/zhaobiao/zbkeyw-9183-310113-4-100.html',
      sourceClass: 'other', title: '宝山区机电安装招标采购信息',
    }
    const reader = vi.fn(async () => readResult(source, [
      'A项目中标候选人公示',
      '2026-08-22丨招标公告丨上海',
      '招标人：上海示例建设有限公司',
      'B项目中标结果公告',
      '2026-08-20丨招标公告丨上海',
      'C项目招标公告',
      '2026-08-18丨招标公告丨上海',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: false,
      subjectCandidates: ['上海示例建设有限公司'],
    })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('多项目聚合列表')
  })

  it('keeps an enterprise bidding-history profile out of project candidates', async () => {
    const source: SearchSource = {
      url: 'https://m.qixin.com/bidding/ab65a000-c3aa-11e8-855c-00163e0ca5c5',
      sourceClass: 'other',
      title: '南京市栖霞区市政设施综合养护管理所招标中标信息-启信宝',
    }
    const reader = vi.fn(async () => readResult(source, [
      '南京市栖霞区市政设施综合养护管理所招标中标信息',
      '采购单位：南京市栖霞区市政设施综合养护管理所',
      '2026年招标公告、中标结果与采购信息汇总。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('多项目聚合列表')
  })

  it.each([
    '江苏南京建设工程项目2026年实操指南:招投标、资质、进度管控全拆解-中项网',
    '南京工程项目信息哪里查?2026年本地人实测有效的5种落地渠道-中项网',
    '南京市市政工程招标信息2026年实战指南：3类企业靠它提前3个月锁定中标机会',
  ])('keeps an editorial guide returned by real search out of project candidates: %s', async (title) => {
    const source: SearchSource = {
      url: 'https://m2.ccpc360.com/fabu/zsku105563.html', sourceClass: 'other', title,
      content: `${title}\n采购单位：南京市相关单位\n招标项目与采购信息分析。${'行业趋势与查询建议。'.repeat(40)}`,
    }
    const reader = vi.fn(async () => readResult(source, source.content ?? ''))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ eligibleForModel: false })
    expect(prepared.sources[0]?.opportunityChecks?.reasons.join('')).toContain('行业指南或查询攻略')
  })

  it('extracts common award amounts and an ISO provider publish time', async () => {
    const source: SearchSource = {
      url: 'https://example.gov.cn/award/amount', sourceClass: 'government',
      title: '安装工程中标结果公告', publishedAt: '2025-07-08T16:42:00+08:00',
    }
    const reader = vi.fn(async () => readResult(source, [
      '采购人：中国科学院示例研究院',
      '总中标金额 ￥295.800000 万元（人民币）',
      '中标（成交）金额：40753.7752（万元）',
      '本项目发布中标结果公告。',
    ].join('\n')))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'award', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      stageDateCandidates: ['2025-07-08'],
      amountWanCandidates: [295.8, 40753.7752],
    })
  })

  it.each([
    ['中标（成交）结果公告', 'award'],
    ['竞争性磋商公告', 'tender'],
    ['竞争性谈判公告', 'tender'],
    ['询价公告', 'tender'],
  ] as const)('recognizes common government-procurement title stage: %s', async (title, expectedStage) => {
    const source: SearchSource = {
      url: `https://www.ccgp.gov.cn/detail/${expectedStage}`,
      sourceClass: 'government',
      title: `临港机电工程的${title}`,
    }
    const reader = vi.fn(async () => readResult(source, `采购人：上海市临港示例单位\n${title}`))

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({
      eligibleForModel: true,
      subjectCandidates: ['上海市临港示例单位'],
      stageIds: [expectedStage],
    })
  })

  it('uses the document title as stage identity instead of sidebar and boilerplate stage words', async () => {
    const source: SearchSource = {
      url: 'https://example.com/tender/navigation', sourceClass: 'government',
      title: '农产品批发市场建设项目EPC招标公告',
    }
    const reader = vi.fn(async () => readResult(source, [
      '首页 > 交易信息 > 招标公告',
      '招标人：四川示例农业有限公司',
      '本项目已经完成立项备案。评标后将发布中标候选人公示和中标结果。',
      '网站导航：招标计划 招标公告 开标记录 中标结果公示 合同公告',
    ].join('\n')))

    const tender = await prepareOpportunitySources(resultFor([source]), 'tender', reader)
    const award = await prepareOpportunitySources(resultFor([source]), 'award', reader)

    expect(tender.sources[0]?.opportunityChecks).toMatchObject({ stageIds: ['tender'], eligibleForModel: true })
    expect(award.sources[0]?.opportunityChecks).toMatchObject({ stageIds: ['tender'], eligibleForModel: false })
  })

  it('limits extra page requests while still processing every provider-supplied body at zero fetch cost', async () => {
    const sources: SearchSource[] = [
      ...Array.from({ length: 5 }, (_, index) => ({ url: `https://example.com/link/${index}`, sourceClass: 'other' as const })),
      { url: 'https://example.com/inline/1', sourceClass: 'other', content: '招标人：甲公司\n招标公告' },
      { url: 'https://example.com/inline/2', sourceClass: 'other', content: '招标人：乙公司\n招标公告' },
    ]
    const reader = vi.fn(async (source: SearchSource) => readResult(source, source.content ?? '招标人：示例建设有限公司\n招标公告'))

    const prepared = await prepareOpportunitySources(resultFor(sources), 'tender', reader, { maxExternalReads: 3 })

    expect(reader).toHaveBeenCalledTimes(5)
    expect(prepared.sources.filter((source) => source.opportunityChecks?.readStatus === 'summary-only')).toHaveLength(2)
    expect(prepared.sources.filter((source) => source.opportunityChecks?.eligibleForModel)).toHaveLength(5)
  })

  it('preserves a failed page as a visible discovery clue and does not make it model-eligible', async () => {
    const source: SearchSource = { url: 'https://example.com/blocked', sourceClass: 'other', title: '招标公告' }
    const reader = vi.fn(async () => { throw new Error('网页读取失败（HTTP 403）。') })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ readStatus: 'read-failed', eligibleForModel: false })
    expect(prepared.evidenceRecords).toHaveLength(1)
    expect(prepared.evidenceRecords[0]).toMatchObject({ artifact: { processingStatus: 'failed' } })
  })

  // 2026-09-16 真实端到端发现的缺口（成都市武侯区政府公告页 HTTP 412 案例）：
  // 网页直读被 WAF 挡住时，搜索服务返回的正文仍应救回这条真实来源，
  // 否则项目检索到了原始公告却会显示"未取得阶段证据"。
  it('回退：网页直读被挡时，用搜索服务返回的正文继续识别阶段', async () => {
    const body = [
      '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务竞争性磋商公告',
      '来源：成都市武侯区智慧宜居建设开发有限公司',
      '发布时间：2026-09-08',
      '华夏城投项目管理有限公司受成都市武侯区智慧宜居建设开发有限公司委托，拟对本项目采用竞争性磋商方式进行采购。',
      ''.padEnd(260, '本公告正文由搜索服务返回。'),
    ].join('\n')
    const source: SearchSource = { url: 'https://www.cdwh.gov.cn/wuhou/content_1.shtml', sourceClass: 'government', title: '悦湖片区市政道路基础设施配套工程(四期)地铁保护监测服务竞争性磋商公告', content: body }
    const reader = vi.fn(async (input: SearchSource) => {
      if (input.content) return readResult(input, input.content)
      throw new Error('网页读取失败（HTTP 412）。')
    })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'all', reader)

    expect(reader).toHaveBeenCalledTimes(2)
    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ readStatus: 'body-ready', stageIds: ['tender'] })
    expect(prepared.sources[0]?.opportunityChecks?.reasons[0]).toContain('正文回退')
    expect(prepared.evidenceRecords[0]?.opportunityDetails).toMatchObject({ stageIds: ['tender'] })
  })

  it('回退有底线：供应商正文过短（像摘要）时仍然按读取失败处理', async () => {
    const source: SearchSource = { url: 'https://example.com/blocked', sourceClass: 'other', title: '招标公告', content: '招标公告（摘要）' }
    const reader = vi.fn(async () => { throw new Error('网页读取失败（HTTP 412）。') })

    const prepared = await prepareOpportunitySources(resultFor([source]), 'tender', reader)

    expect(prepared.sources[0]?.opportunityChecks).toMatchObject({ readStatus: 'read-failed', eligibleForModel: false })
  })
})
