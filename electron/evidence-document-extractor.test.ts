import { describe, expect, it } from 'vitest'
import { extractDocument } from './evidence-document-extractor.js'

function makeTextPdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Uint8Array(Buffer.from(pdf, 'binary'))
}

describe('evidence document extraction', () => {
  it('extracts a Chinese repost body and provenance candidates without navigation noise', async () => {
    const html = `<!doctype html><html><head>
      <title>园区改造项目招标公告 - 示例资讯网</title>
      <meta property="og:site_name" content="示例资讯网">
    </head><body>
      <nav>首页 网站导航 登录 注册</nav>
      <article>
        <h1>园区改造项目招标公告</h1>
        <p>转载自：成都市公共资源交易服务中心</p>
        <p>发布日期：2026年9月5日</p>
        <p>项目编号：CD-2026-001</p>
        <p>本项目已进入招标阶段，建设内容为园区公共区域改造。</p>
        <a href="https://trade.example.gov.cn/original/001">查看原文</a>
      </article>
      <footer>关于我们 联系方式</footer>
    </body></html>`

    const result = await extractDocument({
      mediaKind: 'html',
      bytes: new TextEncoder().encode(html),
      sourceUrl: 'https://news.example.com/repost/001',
    })

    expect(result).toMatchObject({
      processingStatus: 'content-ready',
      title: '园区改造项目招标公告',
      publisherCandidate: '示例资讯网',
      originalPublisherCandidate: '成都市公共资源交易服务中心',
      originalUrlCandidate: 'https://trade.example.gov.cn/original/001',
      provenanceTypeCandidate: 'explicit-repost',
      publishedAtCandidate: '2026-09-05',
      documentIdentifiers: [{ kind: 'project-number', value: 'CD-2026-001' }],
    })
    expect(result.text).toContain('建设内容为园区公共区域改造')
    expect(result.text).not.toContain('网站导航')
    expect(result.text).not.toContain('关于我们')
  })

  it('extracts the text layer from a PDF without invoking OCR', async () => {
    const result = await extractDocument({
      mediaKind: 'pdf',
      bytes: Buffer.from(makeTextPdf('Project No: CD-2026-002 Published: 2026-09-06')),
    })

    expect(result.processingStatus).toBe('content-ready')
    expect(result.text).toContain('CD-2026-002')
    expect(result.pageCount).toBe(1)
    expect(result.warnings).not.toContain('需要 OCR')
  })

  it('preserves public attachment links without following or downloading them', async () => {
    const html = `<html><body><main><h1>招标公告</h1><p>采购人：示例单位</p><p>本项目发布招标公告。</p><a href="/files/bid.pdf">附件1：招标文件.pdf</a><a href="javascript:void(0)">附件按钮</a></main></body></html>`

    const result = await extractDocument({
      mediaKind: 'html', bytes: new TextEncoder().encode(html), sourceUrl: 'https://trade.example.gov.cn/tender/1',
    })

    expect(result.attachmentCandidates).toEqual([
      { label: '附件1：招标文件.pdf', url: 'https://trade.example.gov.cn/files/bid.pdf' },
    ])
  })

  it('extracts a project number from provider Markdown with bold punctuation', async () => {
    const result = await extractDocument({
      mediaKind: 'text',
      bytes: new TextEncoder().encode('**一、项目编号：** 310000000251128157318-00295465\n**二、项目名称：** 临港变电所工程'),
    })

    expect(result.documentIdentifiers).toEqual([
      { kind: 'project-number', value: '310000000251128157318-00295465' },
    ])
  })

  it('marks an image-only input as needing OCR instead of fabricating text', async () => {
    const result = await extractDocument({
      mediaKind: 'image',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    })

    expect(result).toMatchObject({ processingStatus: 'needs-ocr', text: '' })
    expect(result.warnings.join('')).toContain('OCR')
  })
})
