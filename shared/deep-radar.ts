import type { BusinessProfile, Opportunity } from './agent-contract.js'

export type RadarMatchStatus = 'match' | 'partial' | 'hard-mismatch' | 'unknown'

export interface RadarMatchDimension {
  id: 'region' | 'specialty' | 'industry' | 'qualification' | 'scale' | 'delivery'
  label: string
  status: RadarMatchStatus
  reason: string
}

export interface DeepRadarMatch {
  opportunityId: string
  eligible: boolean
  score: number | null
  hardMismatches: string[]
  dimensions: RadarMatchDimension[]
}

/**
 * Local, deterministic first-pass matching. It never upgrades an unknown field
 * to a match, and an explicit hard mismatch always wins over the advisory score.
 */
export function evaluateDeepRadarMatch(profile: BusinessProfile, opportunity: Opportunity): DeepRadarMatch {
  const dimensions: RadarMatchDimension[] = [
    evaluateRegion(profile, opportunity),
    evaluateSpecialty(profile, opportunity),
    advisoryDimension('industry', '行业', profile.industries, opportunity),
    unknownDimension('qualification', '资质', profile.qualifications.length > 0 ? '需从招标详情逐条核对用户资质。' : '用户尚未填写资质。'),
    unknownDimension('scale', '规模', profile.scale ? '项目人员/产能要求尚未结构化。' : '用户尚未填写规模。'),
    unknownDimension('delivery', '履约边界', profile.deliveryBoundary ? '项目工期与履约要求尚未结构化。' : '用户尚未填写履约边界。'),
  ]
  const hardMismatches = dimensions.filter((item) => item.status === 'hard-mismatch').map((item) => `${item.label}不匹配`)
  const known = dimensions.filter((item) => item.status !== 'unknown')
  const score = known.length === 0 ? null : Math.round(known.reduce((total, item) => total + (item.status === 'match' ? 100 : item.status === 'partial' ? 60 : 0), 0) / known.length)
  return { opportunityId: opportunity.id, eligible: hardMismatches.length === 0, score, hardMismatches, dimensions }
}

/**
 * Radar cards are a matched result set, not a raw search dump. Keep unknown
 * fields for user verification, but remove explicit hard mismatches before the
 * renderer stores or selects them.
 */
export function eligibleDeepRadarOpportunities(profile: BusinessProfile, opportunities: Opportunity[]): Opportunity[] {
  return opportunities.filter((opportunity) => evaluateDeepRadarMatch(profile, opportunity).eligible)
}

function evaluateRegion(profile: BusinessProfile, opportunity: Opportunity): RadarMatchDimension {
  if (profile.businessRegions.length === 0) return unknownDimension('region', '服务地域', '用户尚未填写服务地域。')
  if (!opportunity.locationAddress) return unknownDimension('region', '服务地域', '公告尚未提取项目地址，不能假定在服务范围内。')
  const address = normalize(opportunity.locationAddress)
  const match = profile.businessRegions.some((region) => address.includes(normalize(region)))
  return match
    ? { id: 'region', label: '服务地域', status: 'match', reason: `项目地址命中服务地域：${opportunity.locationAddress}` }
    : { id: 'region', label: '服务地域', status: 'hard-mismatch', reason: `项目地址不在已填写的 ${profile.businessRegions.join('、')} 服务范围内。` }
}

function evaluateSpecialty(profile: BusinessProfile, opportunity: Opportunity): RadarMatchDimension {
  if (profile.specialties.length === 0) return unknownDimension('specialty', '专业能力', '用户尚未填写专业能力。')
  const haystack = normalize([opportunity.title, opportunity.projectType, opportunity.reason].join(' '))
  const matched = profile.specialties.filter((item) => haystack.includes(normalize(item)))
  return matched.length > 0
    ? { id: 'specialty', label: '专业能力', status: 'match', reason: `项目文字命中：${matched.join('、')}` }
    : { id: 'specialty', label: '专业能力', status: 'hard-mismatch', reason: `项目标题、类型和已有说明均未命中：${profile.specialties.join('、')}` }
}

function advisoryDimension(id: RadarMatchDimension['id'], label: string, values: string[], opportunity: Opportunity): RadarMatchDimension {
  if (values.length === 0) return unknownDimension(id, label, `用户尚未填写${label}。`)
  const haystack = normalize([opportunity.title, opportunity.projectType, opportunity.reason].join(' '))
  const matched = values.filter((item) => haystack.includes(normalize(item)))
  return matched.length > 0
    ? { id, label, status: 'match', reason: `项目文字命中：${matched.join('、')}` }
    : { id, label, status: 'unknown', reason: `已填写${label}，但现有公告字段不足以判定是否匹配。` }
}

function unknownDimension(id: RadarMatchDimension['id'], label: string, reason: string): RadarMatchDimension {
  return { id, label, status: 'unknown', reason }
}

function normalize(value: string): string {
  return value.replace(/[\s,，、;；/\\()（）\-_]/g, '').toLocaleLowerCase('zh-CN')
}
