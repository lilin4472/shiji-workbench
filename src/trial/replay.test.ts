import { describe, expect, it } from 'vitest'
import { isPolicyChainResult } from '../../shared/policy-chain'
import { isIndustryChainResult } from '../../shared/industry-chain'
import { isCreditRiskResult } from '../../shared/credit-risk'
import { isLeadResult } from '../../shared/lead-contacts'
import { trialIndustryResult, trialLeadResult, trialPolicyResult, trialRiskResult } from './replay'

describe('historical trial analysis replay', () => {
  const yuehuId = 'trial-yuehu-monitoring'

  it('uses the original module result contracts and keeps historical provenance visible', () => {
    const policy = trialPolicyResult(yuehuId)
    const industry = trialIndustryResult(yuehuId)
    const risk = trialRiskResult(yuehuId)
    const leads = industry && trialLeadResult(yuehuId, industry)

    expect(policy && isPolicyChainResult(policy)).toBe(true)
    expect(industry && isIndustryChainResult(industry)).toBe(true)
    expect(risk && isCreditRiskResult(risk)).toBe(true)
    expect(leads && isLeadResult(leads)).toBe(true)
    expect(policy?.regionPath.map((level) => level.id)).toEqual(['national', 'provincial', 'municipal'])
    expect(policy?.findings.every((finding) => finding.sources.every((source) => Boolean(source.pageUrl)))).toBe(true)
    expect(industry?.suppliers.some((company) => company.relation === 'tender-agent')).toBe(true)
    expect(leads?.rows.every((row) => row.ownerName === '成都市武侯区智慧宜居建设开发有限公司')).toBe(true)
    expect(risk?.facts).toEqual([])
    expect(risk?.boundary).toContain('搜不到')
  })

  it('does not turn the less verified second case into a confirmed policy or credit conclusion', () => {
    const policy = trialPolicyResult('trial-jinling-installation')
    const risk = trialRiskResult('trial-jinling-installation')
    expect(policy?.findings).toEqual([])
    expect(policy?.predictions).toEqual([])
    expect(risk?.facts).toEqual([])
    expect(risk?.profile.registrationStatus).toBeUndefined()
  })
})
