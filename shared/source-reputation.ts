const REPUTABLE_PUBLISHER_PATTERN = /中国招采资源网|中国采招网|招采网|中国招标投标公共服务平台|全国公共资源交易平台|中国政府采购网|企查查|爱企查|启信宝|天眼查|新华社|人民网|新浪|腾讯新闻|澎湃|财新|第一财经/i

const REPUTABLE_DOMAINS = [
  'bidcenter.com.cn', 'chinabidding.cn', 'zcwzc.com', 'zct.org.cn', '365trade.com.cn',
  'ccgp.gov.cn', 'ggzy.gov.cn', 'cebpubservice.cn', 'bidnews.cn', 'bidchance.com',
  'cecbid.org.cn', 'china-tender.com.cn', 'xinhuanet.com', 'people.com.cn',
  'sina.com.cn', 'news.qq.com', '163.com', 'thepaper.cn', 'caixin.com', 'yicai.com',
  'qcc.com', 'aiqicha.baidu.com', 'qixin.com', 'tianyancha.com',
] as const

export function isReputablePublisher(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (REPUTABLE_PUBLISHER_PATTERN.test(normalized)) return true
  const host = hostnameFrom(normalized)
  if (host === 'gov.cn' || host.endsWith('.gov.cn')) return true
  return REPUTABLE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

function hostnameFrom(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return value.replace(/^www\./, '')
  }
}
