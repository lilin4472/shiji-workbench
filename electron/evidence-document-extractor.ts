import { load } from 'cheerio/slim'
import { extractText } from 'unpdf'
import type {
  EvidenceDocumentExtraction,
  EvidenceDocumentIdentifier,
  EvidenceDocumentIdentifierKind,
  LocalEvidenceMediaKind,
} from '../shared/evidence-contract.js'

const MAX_EXTRACTED_CHARS = 200_000
const MIN_USEFUL_TEXT_CHARS = 12

export interface EvidenceDocumentInput {
  mediaKind: LocalEvidenceMediaKind
  bytes: Uint8Array
  sourceUrl?: string
  /** Search title/snippet used only to rank same-page detail links. */
  linkHints?: string[]
}

export async function extractDocument(input: EvidenceDocumentInput): Promise<EvidenceDocumentExtraction> {
  if (input.mediaKind === 'image') return needsOcr('图片材料没有文字层，需要 OCR 后才能提取正文。')
  if (input.mediaKind === 'pdf') return extractPdf(input.bytes)

  const decoded = decodeUtf8(input.bytes)
  if (!decoded) return failed('材料不是可识别的 UTF-8 文本。')
  if (input.mediaKind === 'html') return extractHtml(decoded, input.sourceUrl, input.linkHints)
  return fromText(decoded)
}

async function extractPdf(bytes: Uint8Array): Promise<EvidenceDocumentExtraction> {
  try {
    // PDF.js rejects Node Buffers even though Buffer extends Uint8Array.
    const pdfBytes = new Uint8Array(bytes.byteLength)
    pdfBytes.set(bytes)
    const result = await extractText(pdfBytes, { mergePages: true })
    const normalized = normalizeText(result.text)
    if (usefulCharacterCount(normalized) < MIN_USEFUL_TEXT_CHARS) {
      return { ...needsOcr('PDF 没有可用文字层，可能是扫描件，需要 OCR。'), pageCount: result.totalPages }
    }
    const limited = limitText(normalized)
    return {
      ...factsFromText(normalized),
      processingStatus: 'content-ready',
      text: limited.text,
      pageCount: result.totalPages,
      truncated: limited.truncated,
      warnings: limited.truncated ? ['正文超过本地提取上限，已截断。'] : [],
    }
  } catch {
    return failed('PDF 文字层解析失败；请检查文件是否损坏或加密。')
  }
}

function extractHtml(html: string, sourceUrl?: string, linkHints: string[] = []): EvidenceDocumentExtraction {
  try {
    const $ = load(html)
    const title = firstText([
      $('h1').first().text(),
      $('meta[property="og:title"]').attr('content'),
      $('title').first().text().split(/\s+[-—_|]\s+/)[0],
    ])
    const publisherCandidate = firstText([
      $('meta[property="og:site_name"]').attr('content'),
      $('meta[name="publisher"]').attr('content'),
      $('meta[name="source"]').attr('content'),
      sourceUrl ? safeHostname(sourceUrl) : undefined,
    ])
    const originalUrlCandidate = findOriginalUrl($, sourceUrl)
    const detailUrlCandidates = findDetailUrls($, sourceUrl, linkHints)
    const attachmentCandidates = findAttachmentUrls($, sourceUrl)

    $('script,style,noscript,template,svg,nav,header,footer,aside,[aria-hidden="true"]').remove()
    const body = selectMainContent($)
    body.find('br').replaceWith('\n')
    body.find('p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article').each((_index, element) => {
      $(element).append('\n')
    })
    const normalized = normalizeText(body.text())
    if (usefulCharacterCount(normalized) < MIN_USEFUL_TEXT_CHARS) {
      // A repost/index page may contain little text but still expose an
      // explicit 原文 link. Preserve that link so the reader can continue to
      // the actual tender page instead of stopping at the wrapper page.
      return {
        ...failed('HTML 页面没有提取到可用正文。'),
        ...(title ? { title } : {}),
        ...(publisherCandidate ? { publisherCandidate } : {}),
        ...(originalUrlCandidate ? { originalUrlCandidate, provenanceTypeCandidate: 'explicit-repost' as const } : {}),
        ...(detailUrlCandidates.length > 0 ? { detailUrlCandidates } : {}),
        ...(attachmentCandidates.length > 0 ? { attachmentCandidates } : {}),
      }
    }
    const limited = limitText(normalized)
    const facts = factsFromText(normalized)
    return {
      ...facts,
      processingStatus: 'content-ready',
      text: limited.text,
      ...(title ? { title } : {}),
      ...(publisherCandidate ? { publisherCandidate } : {}),
      ...(originalUrlCandidate ? { originalUrlCandidate } : {}),
      ...(detailUrlCandidates.length > 0 ? { detailUrlCandidates } : {}),
      ...(attachmentCandidates.length > 0 ? { attachmentCandidates } : {}),
      provenanceTypeCandidate: facts.originalPublisherCandidate || originalUrlCandidate || hasExplicitRepostMarker(normalized)
        ? 'explicit-repost'
        : 'unknown',
      truncated: limited.truncated,
      warnings: limited.truncated ? ['正文超过本地提取上限，已截断。'] : [],
    }
  } catch {
    return failed('HTML 页面结构无法解析。')
  }
}

function findAttachmentUrls($: ReturnType<typeof load>, sourceUrl?: string): Array<{ label: string; url: string }> {
  if (!sourceUrl) return []
  const base = new URL(sourceUrl)
  const candidates: Array<{ label: string; url: string }> = []
  const seen = new Set<string>()
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')?.trim()
    const label = anchor.text().replace(/\s+/g, ' ').trim()
    if (!href || !label) return
    let resolved: URL
    try { resolved = new URL(href, base) } catch { return }
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.username || resolved.password || seen.has(resolved.href)) return
    const looksLikeFile = /\.(?:pdf|docx?|xlsx?|zip|rar|7z)(?:$|[?#])/i.test(resolved.href)
    const looksLikeAttachment = /(?:附件|下载|招标文件|采购文件|工程量清单|图纸)/i.test(`${label} ${anchor.attr('title') ?? ''}`)
    if (!looksLikeFile && !looksLikeAttachment) return
    seen.add(resolved.href)
    candidates.push({ label: label.slice(0, 120), url: resolved.href })
  })
  return candidates.slice(0, 20)
}

function findDetailUrls($: ReturnType<typeof load>, sourceUrl: string | undefined, linkHints: string[]): string[] {
  if (!sourceUrl || linkHints.length === 0) return []
  const base = new URL(sourceUrl)
  const hints = linkHints.map(normalizeLinkText).filter((value) => value.length >= 4).slice(0, 3)
  if (hints.length === 0) return []
  const scored: Array<{ url: string; score: number }> = []
  const seen = new Set<string>()
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const label = normalizeLinkText(anchor.text())
    const href = anchor.attr('href')?.trim()
    if (!href || !label || label.length < 4 || /^(?:首页|登录|注册|联系我们|网站地图|返回顶部|下一页|上一页)$/i.test(label)) return
    let resolved: URL
    try { resolved = new URL(href, base) } catch { return }
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.hostname !== base.hostname || resolved.href === base.href || seen.has(resolved.href)) return
    const haystack = normalizeLinkText(`${label} ${anchor.attr('title') ?? ''}`)
    let score = 0
    for (const hint of hints) {
      if (haystack.includes(hint)) score += 8
      else score += sharedPhraseScore(haystack, hint)
    }
    if (/(?:招标|采购|项目|公告|中标|成交|详情|文件|报名)/.test(haystack)) score += 2
    if (score < 4) return
    seen.add(resolved.href)
    scored.push({ url: resolved.href, score })
  })
  return scored.sort((left, right) => right.score - left.score).slice(0, 3).map((item) => item.url)
}

function normalizeLinkText(value: string): string {
  return value.replace(/[\s【】「」“”‘’'"()（）·|｜:：,，。！？!?.]/g, '').toLowerCase()
}

function sharedPhraseScore(left: string, right: string): number {
  let score = 0
  for (let index = 0; index + 1 < right.length; index += 1) {
    if (left.includes(right.slice(index, index + 2))) score += 1
  }
  return score >= 2 ? Math.min(score, 6) : 0
}

function fromText(raw: string): EvidenceDocumentExtraction {
  const normalized = normalizeText(raw)
  if (usefulCharacterCount(normalized) < MIN_USEFUL_TEXT_CHARS) return failed('文本材料没有可用正文。')
  const limited = limitText(normalized)
  return {
    ...factsFromText(normalized),
    processingStatus: 'content-ready',
    text: limited.text,
    truncated: limited.truncated,
    warnings: limited.truncated ? ['正文超过本地提取上限，已截断。'] : [],
  }
}

function factsFromText(text: string): Pick<
  EvidenceDocumentExtraction,
  'originalPublisherCandidate' | 'provenanceTypeCandidate' | 'documentIdentifiers' | 'publishedAtCandidate'
> {
  const originalPublisherCandidate = captureLineValue(text, /(?:转载自|转自|原文来源)\s*[:：]\s*([^\n]{2,100})/i)
  const publishedAtCandidate = extractPublishedDate(text)
  return {
    ...(originalPublisherCandidate ? { originalPublisherCandidate } : {}),
    provenanceTypeCandidate: originalPublisherCandidate || hasExplicitRepostMarker(text) ? 'explicit-repost' : 'unknown',
    documentIdentifiers: extractDocumentIdentifiers(text),
    ...(publishedAtCandidate ? { publishedAtCandidate } : {}),
  }
}

function selectMainContent($: ReturnType<typeof load>) {
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.TRS_Editor',
    '.article-content',
    '.article_content',
    '.detail-content',
    '.detail_content',
    '#zoom',
    '#content',
    '.content',
  ]
  let best: ReturnType<typeof $> = $('body').first()
  let bestScore = -1
  for (const selector of selectors) {
    $(selector).each((_index, element) => {
      const candidate = $(element)
      const textLength = normalizeText(candidate.text()).length
      const linkLength = normalizeText(candidate.find('a').text()).length
      const score = textLength - linkLength * 2
      if (textLength >= MIN_USEFUL_TEXT_CHARS && score > bestScore) {
        best = candidate
        bestScore = score
      }
    })
  }
  return best
}

function findOriginalUrl($: ReturnType<typeof load>, sourceUrl?: string): string | undefined {
  let candidate: string | undefined
  $('a[href]').each((_index, element) => {
    if (candidate) return
    const anchor = $(element)
    const context = `${anchor.text()} ${anchor.parent().text()}`
    if (!/(?:查看|阅读|点击)?\s*原文|原文链接|来源链接/i.test(context)) return
    const href = anchor.attr('href')
    if (!href) return
    try {
      const resolved = sourceUrl ? new URL(href, sourceUrl) : new URL(href)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') candidate = resolved.href
    } catch {
      // A malformed or unresolvable link remains a missing provenance check.
    }
  })
  return candidate
}

function extractDocumentIdentifiers(text: string): EvidenceDocumentIdentifier[] {
  const normalizedText = text.replace(/\\?[*_`]+/g, '')
  const patterns: ReadonlyArray<[EvidenceDocumentIdentifierKind, RegExp]> = [
    ['project-number', /项目编号\s*[:：]\s*([^\s，,；;。]{3,100})/gi],
    ['purchase-number', /(?:采购|招标)编号\s*[:：]\s*([^\s，,；;。]{3,100})/gi],
    ['document-number', /(?:文号|文件编号)\s*[:：]\s*([^\n，,；;。]{3,100})/gi],
    ['unified-social-credit-code', /统一社会信用代码\s*[:：]?\s*([0-9A-Z]{18})/gi],
  ]
  const identifiers: EvidenceDocumentIdentifier[] = []
  const seen = new Set<string>()
  for (const [kind, pattern] of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const value = cleanCandidate(match[1])
      const key = `${kind}:${value}`
      if (!value || seen.has(key)) continue
      seen.add(key)
      identifiers.push({ kind, value })
    }
  }
  return identifiers
}

function extractPublishedDate(text: string): string | undefined {
  const match = text.match(/(?:发布日期|发布时间|公示日期|公告日期)\s*[:：]?\s*(20\d{2})[年\-/\.]\s*(\d{1,2})[月\-/\.]\s*(\d{1,2})日?/i)
  if (!match) return undefined
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function captureLineValue(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern)
  return match ? cleanCandidate(match[1]) : undefined
}

function cleanCandidate(value: string): string {
  return value.trim().replace(/[。；;，,|]+$/g, '').slice(0, 100)
}

function hasExplicitRepostMarker(text: string): boolean {
  return /(?:转载自|转自|原文来源|原文链接)\s*[:：]?/i.test(text)
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return undefined
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function usefulCharacterCount(value: string): number {
  return value.replace(/\s/g, '').length
}

function limitText(value: string): { text: string; truncated: boolean } {
  return value.length > MAX_EXTRACTED_CHARS
    ? { text: value.slice(0, MAX_EXTRACTED_CHARS), truncated: true }
    : { text: value, truncated: false }
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function firstText(values: Array<string | undefined>): string | undefined {
  return values.map(value => value?.trim()).find((value): value is string => Boolean(value))
}

function needsOcr(message: string): EvidenceDocumentExtraction {
  return {
    processingStatus: 'needs-ocr',
    text: '',
    provenanceTypeCandidate: 'unknown',
    documentIdentifiers: [],
    truncated: false,
    warnings: [message],
  }
}

function failed(message: string): EvidenceDocumentExtraction {
  return {
    processingStatus: 'failed',
    text: '',
    provenanceTypeCandidate: 'unknown',
    documentIdentifiers: [],
    truncated: false,
    warnings: [message],
  }
}
