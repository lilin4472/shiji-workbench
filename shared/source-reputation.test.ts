import { describe, expect, it } from 'vitest'
import { isReputablePublisher } from './source-reputation.js'

describe('source reputation', () => {
  it.each(['https://www.ccgp.gov.cn/a', 'bidcenter.com.cn', '中国招采资源网', '人民网'])('recognizes a configured reputable source: %s', (value) => {
    expect(isReputablePublisher(value)).toBe(true)
  })

  it('does not promote an unknown aggregator by default', () => {
    expect(isReputablePublisher('random-example.invalid')).toBe(false)
  })
})
