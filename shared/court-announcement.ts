// 法院公开平台文本解析（免登录：人民法院公告网 rmfygg、执行信息公开网 zxgk）。
// 目标：把"案号 → 当事人 / 审理阶段 / 开庭时间 / 结果"从公告正文里确定性地抠出来。
// 纪律：只认正文里写明的字段，每项带原句；认不出就留空，绝不编造。

export interface CourtParty {
  role: '原告' | '被告' | '上诉人' | '被上诉人' | '申请人' | '被申请人' | '申请执行人' | '被执行人'
  name: string
  quote: string
}

export interface CourtAnnouncementFacts {
  isCourtSource: boolean
  court?: string
  stage?: '一审' | '二审' | '再审' | '执行'
  caseNumber?: string
  hearingAt?: string
  parties: CourtParty[]
  result?: string
  quotes: string[]
}

const COURT_HOSTS = ['rmfygg.court.gov.cn', 'zxgk.court.gov.cn', 'wenshu.court.gov.cn', 'court.gov.cn']
const COURT_PUBLISHER = /(人民法院|中级人民法院|高级人民法院|人民法院公告网|中国执行信息公开网)/

export function isCourtAnnouncementSource(pageUrl: string | undefined, publisher: string): boolean {
  if (COURT_PUBLISHER.test(publisher)) return true
  if (!pageUrl) return false
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
    return COURT_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export function extractCourtParties(text: string): CourtParty[] {
  const roles: CourtParty['role'][] = ['被上诉人', '上诉人', '原告', '被告', '申请执行人', '被执行人', '申请人', '被申请人']
  const found: CourtParty[] = []
  const seen = new Set<string>()
  const sentences = text.split(/[\n。；;]/).map((part) => part.trim()).filter(Boolean)
  for (const sentence of sentences) {
    const claimed: Array<[number, number]> = []
    for (const role of roles) {
      const pattern = new RegExp(`${role}(?:人|方)?[：:\\s]*([\\u4e00-\\u9fff（）()A-Za-z0-9·]{2,40})`, 'g')
      for (const match of sentence.matchAll(pattern)) {
        const start = match.index ?? 0
        const end = start + role.length
        if (claimed.some(([from, to]) => start >= from && start < to)) continue
        claimed.push([start, end])
        const name = match[1].trim().replace(/[，,、].*$/, '').replace(/(?:与|和|及)?(?:被告|原告|上诉人|被上诉人)$/, '')
        if (name.length < 2) continue
        const key = `${role}:${name}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ role, name, quote: sentence.slice(0, 160) })
      }
    }
  }
  return found
}

export function extractCourtResult(text: string): string | undefined {
  const match = text.match(/(?:判决如下|裁定如下|裁判结果|执行标的|和解协议|撤回起诉|撤诉|终结本次执行|履行完毕)[^\n]{0,120}/)
  return match?.[0]?.trim().slice(0, 160)
}

export function extractCourtStage(text: string): CourtAnnouncementFacts['stage'] {
  if (/被执行人|执行标的|执行案号|终结本次执行/.test(text)) return '执行'
  if (/再审/.test(text)) return '再审'
  if (/二审|被上诉人|上诉人|终审/.test(text)) return '二审'
  if (/一审|民初|原告|被告/.test(text)) return '一审'
  return undefined
}

/** 兼容"定于2025-01-21 10:30开庭"与"开庭时间：2025-01-21 10:30"两种写法。 */
export function extractHearingAt(text: string): string | undefined {
  const labeled = text.match(/(?:开庭时间|开庭日期|审理时间)[：:\s]*(20\d{2}[-年/.]\d{1,2}[-月/.]?\d{0,2}(?:\s*\d{1,2}:\d{2})?)/)
  if (labeled?.[1]) return labeled[1].trim()
  const scheduled = text.match(/(?:定于|于)\s*(20\d{2}[-年/.]\d{1,2}[-月/.]?\d{0,2}(?:\s*\d{1,2}:\d{2})?)\s*(?:开庭|审理)/)
  return scheduled?.[1]?.trim()
}

export function parseCourtAnnouncement(text: string, pageUrl: string | undefined, publisher: string): CourtAnnouncementFacts {
  const isCourtSource = isCourtAnnouncementSource(pageUrl, publisher)
  const caseNumber = text.match(/[（(]\s*20\d{2}\s*[）)][\u4e00-\u9fff]{1,4}\d{1,5}[\u4e00-\u9fff]{0,6}\d{0,6}\s*号/)?.[0]?.replace(/\s+/g, '')
  const court = text.match(/[\u4e00-\u9fff]{2,12}(?:人民法院|中级法院|高级法院)/)?.[0]
  const hearingAt = extractHearingAt(text)
  const parties = extractCourtParties(text)
  const result = extractCourtResult(text)
  const stage = extractCourtStage(text)
  const quotes = [...new Set([...parties.map((party) => party.quote), ...(result ? [result] : [])])].slice(0, 6)
  return {
    isCourtSource,
    ...(court ? { court } : {}),
    ...(stage ? { stage } : {}),
    ...(caseNumber ? { caseNumber } : {}),
    ...(hearingAt ? { hearingAt } : {}),
    parties,
    ...(result ? { result } : {}),
    quotes,
  }
}