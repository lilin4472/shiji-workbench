import { describe, expect, it } from 'vitest'
import { extractCourtParties, extractCourtResult, extractHearingAt, isCourtAnnouncementSource, parseCourtAnnouncement } from './court-announcement.js'

const ANNOUNCEMENT = [
  '成都市武侯区人民法院 公告',
  '原告上海天华建筑设计有限公司与被告四川府河华益置业有限公司、成都武侯太平园城市更新建设有限公司建设工程设计合同纠纷一案，',
  '案号（2024）川0107民初29841号，本院定于2025-01-21 10:30开庭审理。',
].join('\n')

describe('法院公告解析', () => {
  it('识别法院平台来源', () => {
    expect(isCourtAnnouncementSource('https://rmfygg.court.gov.cn/x', '人民法院公告网')).toBe(true)
    expect(isCourtAnnouncementSource('https://www.qcc.com/x', '企查查')).toBe(false)
  })

  it('抽出原告与被告（各带原句）', () => {
    const parties = extractCourtParties(ANNOUNCEMENT)
    expect(parties.some((p) => p.role === '原告' && p.name.includes('上海天华'))).toBe(true)
    expect(parties.some((p) => p.role === '被告')).toBe(true)
    expect(parties[0].quote.length).toBeGreaterThan(10)
  })

  it('被上诉人不会被当成上诉人', () => {
    const parties = extractCourtParties('被上诉人成都市金牛国有资产投资经营集团有限公司、原审被告四川府河华益置业有限公司')
    expect(parties.some((p) => p.role === '上诉人')).toBe(false)
    expect(parties.some((p) => p.role === '被上诉人')).toBe(true)
  })

  it('结果只认写明判项', () => {
    expect(extractCourtResult('判决如下：被告于本判决生效之日起十日内支付设计费 120 万元。')).toContain('判决如下')
    expect(extractCourtResult('本院定于2025-01-21开庭审理')).toBeUndefined()
  })

  it('开庭时间两种写法都认', () => {
    expect(extractHearingAt('本院定于2025-01-21 10:30开庭审理')).toContain('2025-01-21')
    expect(extractHearingAt('开庭时间：2026-03-02 09:00')).toContain('2026-03-02')
  })

  it('整体解析：案号/法院/阶段/开庭时间；没写的字段不出现', () => {
    const facts = parseCourtAnnouncement(ANNOUNCEMENT, 'https://rmfygg.court.gov.cn/a', '人民法院公告网')
    expect(facts.isCourtSource).toBe(true)
    expect(facts.court).toContain('武侯区人民法院')
    expect(facts.caseNumber).toBe('（2024）川0107民初29841号')
    expect(facts.stage).toBe('一审')
    expect(facts.hearingAt).toContain('2025-01-21')
    expect(facts.result).toBeUndefined()
  })

  it('执行类文本识别为执行阶段并带执行标的', () => {
    const facts = parseCourtAnnouncement('被执行人成都武侯太平园城市更新建设有限公司，执行标的 125000 元。', 'https://zxgk.court.gov.cn/b', '中国执行信息公开网')
    expect(facts.stage).toBe('执行')
    expect(facts.result).toContain('执行标的')
  })
})