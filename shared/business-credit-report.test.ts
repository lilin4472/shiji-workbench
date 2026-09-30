import { describe, expect, it } from 'vitest'
import type { SearchSource } from './search-contract.js'
import { buildCreditDiscoveryReport, CREDIT_CHECK_DEFINITIONS } from './business-credit-report.js'

const subject = '示例建设发展有限公司'

function source(overrides: Partial<SearchSource> = {}): SearchSource {
  return {
    url: 'https://example.gov.cn/result',
    sourceClass: 'government',
    title: `${subject}公开信息`,
    snippet: '公开信息摘要',
    ...overrides,
  }
}

describe('business credit discovery report', () => {
  it('keeps all checks unverified when search returns no sources', () => {
    const report = buildCreditDiscoveryReport(subject, [], '2026-09-06T09:00:00.000Z')

    expect(report.overallStatus).toBe('unverified')
    expect(report.coverage).toEqual({ confirmed: 0, total: CREDIT_CHECK_DEFINITIONS.length })
    expect(report.checks.every((check) => check.status === 'unverified')).toBe(true)
    expect(report).not.toHaveProperty('score')
    expect(report).not.toHaveProperty('riskLevel')
  })

  it('does not turn non-official search hits into confirmed records', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      url: 'https://example.com/risk',
      sourceClass: 'other',
      title: `${subject}行政处罚信息`,
    })])

    expect(report.overallStatus).toBe('unverified')
    expect(report.checks.every((check) => check.status === 'unverified')).toBe(true)
    expect(report.candidateSources).toHaveLength(1)
  })

  it('classifies exact official registration and adverse candidates without claiming verification', () => {
    const report = buildCreditDiscoveryReport(subject, [
      source({ url: 'https://www.gsxt.gov.cn/company/1', sourceClass: 'registry', title: `${subject}企业登记信息` }),
      source({ url: 'https://zxgk.court.gov.cn/shixin/1', sourceClass: 'court', title: `${subject}失信被执行人信息` }),
    ])

    expect(report.overallStatus).toBe('attention')
    expect(report.checks.find((check) => check.dimension === 'registration')?.status).toBe('record-found')
    expect(report.checks.find((check) => check.dimension === 'dishonest-enforcement')?.status).toBe('record-found')
    expect(report.checks.some((check) => check.status === 'verified-clear')).toBe(false)
    expect(report.coverage.confirmed).toBe(0)
  })

  it('ignores official results that do not contain the exact subject name', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      sourceClass: 'credit-china',
      title: '另一家公司行政处罚信息',
      snippet: '另一家公司被列入经营异常名录',
    })])

    expect(report.overallStatus).toBe('unverified')
    expect(report.checks.every((check) => check.status === 'unverified')).toBe(true)
  })

  it('does not treat procurement eligibility boilerplate as the purchaser own adverse record', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      title: '园区绿化工程竞争性磋商公告',
      snippet: `采购单位：${subject}。供应商须未被信用中国列入失信被执行人、政府采购严重违法失信行为记录名单。`,
    })])

    expect(report.overallStatus).toBe('unverified')
    expect(report.checks.find((check) => check.dimension === 'serious-violation')?.status).toBe('unverified')
    expect(report.checks.find((check) => check.dimension === 'dishonest-enforcement')?.status).toBe('unverified')
    expect(report.candidateSources).toHaveLength(1)
  })

  it('keeps an explicit subject-linked adverse record as a candidate', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      sourceClass: 'government',
      title: `${subject}经营异常名录信息`,
      snippet: `${subject}因未按期公示年度报告被列入经营异常名录。`,
    })])

    expect(report.checks.find((check) => check.dimension === 'business-abnormal')?.status).toBe('record-found')
  })

  it('extracts a compact registration snapshot instead of requiring the user to read every source', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      sourceClass: 'other', url: 'https://www.qcc.com/company/example', title: `企查查：${subject}工商信息`,
      snippet: `${subject} 统一社会信用代码：91310105090037252C 法定代表人：张三 注册资本：1000万元 成立日期：2014-01-09 经营状态：存续 地址：上海市示例路1号`,
    })])

    expect(report.registrationSummary).toMatchObject({
      unifiedSocialCreditCode: '91310105090037252C', legalRepresentative: '张三', registeredCapital: '1000万元',
      establishedAt: '2014-01-09', operatingStatus: '存续',
    })
  })

  it('recognizes an official fine notice as an administrative-penalty candidate', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      sourceClass: 'government', title: '情况通报', snippet: `${subject}逾期未改正，税务机关依法对其处以10万元罚款。`,
    })])

    expect(report.checks.find((check) => check.dimension === 'administrative-penalty')?.status).toBe('record-found')
  })

  it('accepts a reputable business-information source as a candidate, but not an unrelated site', () => {
    const reputable = buildCreditDiscoveryReport(subject, [source({
      url: 'https://www.qcc.com/company/example', sourceClass: 'other',
      title: `企查查：${subject}行政处罚`, snippet: `${subject}受到行政处罚。`,
    })])
    const unrelated = buildCreditDiscoveryReport(subject, [source({
      url: 'https://unknown.example/company', sourceClass: 'other',
      title: `${subject}行政处罚`, snippet: `${subject}受到行政处罚。`,
    })])

    expect(reputable.checks.find((check) => check.dimension === 'administrative-penalty')?.status).toBe('record-found')
    expect(unrelated.checks.find((check) => check.dimension === 'administrative-penalty')?.status).toBe('unverified')
    expect(unrelated.checks.find((check) => check.dimension === 'administrative-penalty')?.referenceSources).toHaveLength(1)
  })

  it('does not assign another company risk to a subject that is only the applicant', () => {
    const report = buildCreditDiscoveryReport(subject, [source({
      sourceClass: 'court',
      snippet: `被执行人：另一家公司，失信被执行人记录。申请执行人：${subject}。`,
    })])

    expect(report.checks.find((check) => check.dimension === 'dishonest-enforcement')?.status).toBe('unverified')
  })

  it('recomputes the same report with subject-bound local extracted material', () => {
    const report = buildCreditDiscoveryReport(subject, [], '2026-09-13T08:00:00.000Z', [{
      id: 'local-1', subjectName: subject, title: `${subject}行政处罚决定书`,
      text: `${subject}因违法行为被作出行政处罚决定。`,
    }])

    expect(report.checks.find((check) => check.dimension === 'administrative-penalty')).toMatchObject({
      status: 'record-found', localEvidenceIds: ['local-1'],
    })
    expect(report.candidateSources).toEqual([])
  })

  it('does not merge a local document bound to a different subject', () => {
    const report = buildCreditDiscoveryReport(subject, [], '2026-09-13T08:00:00.000Z', [{
      id: 'local-2', subjectName: '另一家公司', title: `${subject}行政处罚决定书`,
      text: `${subject}行政处罚。`,
    }])

    expect(report.checks.every((check) => check.status === 'unverified')).toBe(true)
  })

  it('applies a clear review only while its institutional evidence still exists', () => {
    const official = source({ url: 'https://credit.example.gov.cn/check/1', sourceClass: 'credit-china', snippet: `${subject}未发现经营异常记录。` })
    const review = {
      dimension: 'business-abnormal' as const, outcome: 'verified-clear' as const,
      evidence: { kind: 'web' as const, url: official.url }, reviewedAt: '2026-09-13T09:00:00.000Z', note: '已查看查询结果。',
    }

    const available = buildCreditDiscoveryReport(subject, [official], undefined, [], [review])
    const removed = buildCreditDiscoveryReport(subject, [], undefined, [], [review])

    expect(available.checks.find((check) => check.dimension === 'business-abnormal')).toMatchObject({ status: 'verified-clear', review })
    expect(available.coverage.confirmed).toBe(1)
    expect(removed.checks.find((check) => check.dimension === 'business-abnormal')?.status).toBe('unverified')
    expect(removed.coverage.confirmed).toBe(0)
  })

  it('does not allow a general knowledge reference to prove a clear outcome', () => {
    const commercial = source({ url: 'https://example.com/company/1', sourceClass: 'other' })
    const report = buildCreditDiscoveryReport(subject, [commercial], undefined, [], [{
      dimension: 'administrative-penalty', outcome: 'verified-clear', evidence: { kind: 'web', url: commercial.url },
      reviewedAt: '2026-09-13T09:00:00.000Z', note: '',
    }])

    expect(report.checks.find((check) => check.dimension === 'administrative-penalty')?.status).toBe('unverified')
    expect(report.coverage.confirmed).toBe(0)
  })

  it('accepts a subject-bound local material as review evidence', () => {
    const local = { id: 'local-3', subjectName: subject, title: '失信被执行人查询留档', text: `${subject} 失信被执行人查询结果` }
    const report = buildCreditDiscoveryReport(subject, [], undefined, [local], [{
      dimension: 'dishonest-enforcement', outcome: 'verified-clear', evidence: { kind: 'local', id: local.id },
      reviewedAt: '2026-09-13T09:00:00.000Z', note: '人工复核留档。',
    }])

    expect(report.checks.find((check) => check.dimension === 'dishonest-enforcement')?.status).toBe('verified-clear')
    expect(report.coverage.confirmed).toBe(1)
  })
})
