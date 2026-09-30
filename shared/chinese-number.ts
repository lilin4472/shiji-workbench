const digits: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
}

/** Parse the ordinary Chinese integer forms used in natural-language filters. */
export function parseChineseInteger(value: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (/^\d+$/.test(normalized)) return Number(normalized)
  if (!/^[零〇一二两三四五六七八九十百千万亿]+$/.test(normalized)) return undefined

  let total = 0
  let section = 0
  let number = 0
  for (const character of normalized) {
    const digit = digits[character]
    if (digit !== undefined) {
      number = digit
      continue
    }
    const unit = character === '十' ? 10
      : character === '百' ? 100
        : character === '千' ? 1_000
          : character === '万' ? 10_000
            : 100_000_000
    if (unit < 10_000) {
      section += (number || 1) * unit
    } else {
      section = (section + number) || 1
      total += section * unit
      section = 0
    }
    number = 0
  }
  const result = total + section + number
  return Number.isFinite(result) && result >= 0 ? result : undefined
}

export function numericTokenPattern(): string {
  return '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万亿]+)'
}

export function parseNumericToken(value: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  return parseChineseInteger(value)
}
