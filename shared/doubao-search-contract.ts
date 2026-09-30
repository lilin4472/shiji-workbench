export interface DoubaoSearchTestCase {
  id: string
  label: string
  query: string
}

/** Fixed, low-cost probes. Queries stay below the Custom API 100-character limit. */
export const DOUBAO_SEARCH_TEST_CASES: readonly DoubaoSearchTestCase[] = [
  { id: 'company-base', label: '工商基础', query: '深圳市腾讯计算机系统有限公司 统一社会信用代码 登记状态' },
  { id: 'company-risk', label: '工商信用', query: '深圳市腾讯计算机系统有限公司 经营异常 行政处罚 失信被执行人' },
  { id: 'company-same-name', label: '同名区分', query: '腾讯科技深圳有限公司 深圳市腾讯计算机系统有限公司 统一社会信用代码' },
  { id: 'tender-current', label: '在招公告', query: '成都 施工 招标公告 项目编号 招标人 金额 投标截止时间 2026' },
  { id: 'tender-pdf', label: '招标附件', query: '四川 成都 施工 招标公告 PDF 附件' },
] as const
