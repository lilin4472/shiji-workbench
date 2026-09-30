import { buildCreditDiscoveryReport, type BusinessCreditDiscoveryResult } from '../shared/business-credit-report.js'
import type { SearchPort } from '../shared/search-contract.js'
import type { UserSearchProviderId } from '../shared/search-preference.js'

export type BusinessCreditDiscoveryService = (subjectName: string, provider: UserSearchProviderId, focus?: string) => Promise<BusinessCreditDiscoveryResult>

export function createBusinessCreditDiscoveryService(search: SearchPort): BusinessCreditDiscoveryService {
  return async (subjectNameValue, provider, focusValue = '') => {
    const subjectName = subjectNameValue.trim()
    if (!subjectName || subjectName.length > 120) throw new Error('企业名称为空或长度异常。')
    const focus = focusValue.trim()
    if (focus.length > 300) throw new Error('本次关注事项不能超过 300 个字符。')

    const query = focus
      ? `${subjectName} ${focus} 工商信息 违法事实 处罚决定书 处罚日期 处罚金额 履行情况 处理结果 列入原因 移出原因 详情 公开来源`
      : `${subjectName} 工商登记 经营异常列入原因 移出原因 严重违法失信 行政处罚 违法事实 处罚决定书 处罚日期 处罚金额 履行情况 处理结果 失信被执行人 详情 官方`
    const result = await search({ provider, purpose: 'business-credit', query })
    return {
      provider: result.provider,
      query: result.query,
      focus,
      checkedAt: result.checkedAt,
      requestCount: result.requestCount,
      cacheHit: result.cacheHit,
      report: buildCreditDiscoveryReport(subjectName, result.sources, result.checkedAt),
    }
  }
}
