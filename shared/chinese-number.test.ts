import { describe, expect, it } from 'vitest'
import { parseChineseInteger } from './chinese-number.js'
import { parseTimeWindow, timeWindowFromPrompt } from './time-window.js'

describe('Chinese natural-language numbers', () => {
  it('parses count, amount and time values', () => {
    expect(parseChineseInteger('两个')).toBeUndefined()
    expect(parseChineseInteger('两')).toBe(2)
    expect(parseChineseInteger('十')).toBe(10)
    expect(parseChineseInteger('一百万')).toBe(1_000_000)
    expect(parseTimeWindow('未来十天')).toEqual({ kind: 'future', days: 10 })
    expect(timeWindowFromPrompt('未来十天的招标项目')).toBe('未来10天')
  })
})
