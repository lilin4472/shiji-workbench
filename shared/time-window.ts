import { parseChineseInteger, numericTokenPattern } from './chinese-number.js'

export type ParsedTimeWindow =
  | { kind: 'unbounded' }
  | { kind: 'future'; days: number }
  | { kind: 'recent'; days: number }

/** Parse only explicit product-supported time phrases; unknown wording is not guessed. */
export function parseTimeWindow(value: string | undefined): ParsedTimeWindow {
  const normalized = value?.replace(/\s+/g, '').trim() ?? ''
  if (!normalized || normalized === '不限时间') return { kind: 'unbounded' }
  const token = numericTokenPattern()
  const future = new RegExp(`^(?:未来|后续)(${token})天$`).exec(normalized)
  const futureDays = future ? parseChineseInteger(future[1]) : undefined
  if (futureDays !== undefined && futureDays <= 999) return { kind: 'future', days: futureDays }
  const recent = new RegExp(`^(?:近|最近|过去)(${token})天$`).exec(normalized)
  const recentDays = recent ? parseChineseInteger(recent[1]) : undefined
  if (recentDays !== undefined && recentDays <= 999) return { kind: 'recent', days: recentDays }
  return { kind: 'unbounded' }
}

export function recentTimeWindowFromPrompt(prompt: string): string | undefined {
  const match = new RegExp(`(?:近|最近|过去)\\s*(${numericTokenPattern()})\\s*天`).exec(prompt)
  const days = match ? parseChineseInteger(match[1]) : undefined
  return days !== undefined && days <= 999 ? `近${days}天` : undefined
}

export function timeWindowFromPrompt(prompt: string): string | undefined {
  const token = numericTokenPattern()
  const match = new RegExp(`(?:未来|后续)\\s*(${token})\\s*天`).exec(prompt)
  const futureDays = match ? parseChineseInteger(match[1]) : undefined
  if (futureDays !== undefined && futureDays <= 999) return `未来${futureDays}天`
  return recentTimeWindowFromPrompt(prompt)
}
