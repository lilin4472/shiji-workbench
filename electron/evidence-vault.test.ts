import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EvidenceVault } from './evidence-vault.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'shiji-evidence-test-'))
  temporaryRoots.push(root)
  const source = path.join(root, '官方公示.txt')
  const content = '公开信息测试内容，用于本地证据解析。'
  await writeFile(source, content, 'utf8')
  return { root, source, content, vault: new EvidenceVault(path.join(root, 'vault')) }
}

describe('EvidenceVault', () => {
  it('copies an allowed user-selected file into the local vault without retaining its source path', async () => {
    const { root, source, content, vault } = await fixture()

    const record = await vault.importFile('示例建设发展有限公司', source)

    expect(record).toMatchObject({
      subjectName: '示例建设发展有限公司',
      fileName: '官方公示.txt',
      extension: '.txt',
      mediaKind: 'text',
      processingStatus: 'content-ready',
      extraction: {
        textCharacters: content.length,
        provenanceTypeCandidate: 'unknown',
        documentIdentifiers: [],
      },
    })
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(record)).not.toContain(source)
    expect(await readFile(path.join(root, 'vault', 'files', `${record.id}.txt`), 'utf8')).toBe(content)
    await expect(vault.readExtractedText(record.id)).resolves.toBe(content)
    await expect(vault.list('示例建设发展有限公司')).resolves.toEqual([record])
  })

  it('persists HTML provenance candidates separately from the extracted local text', async () => {
    const { root, vault } = await fixture()
    const htmlPath = path.join(root, '公告转载.html')
    await writeFile(htmlPath, `<!doctype html><html><head><meta property="og:site_name" content="行业资讯网"></head><body>
      <nav>网站导航</nav><article><h1>示例项目招标公告</h1><p>转载自：示例市公共资源交易中心</p>
      <p>发布日期：2026年9月5日</p><p>项目编号：XM-2026-009</p><p>这是公告的有效正文内容。</p>
      <a href="https://trade.example.gov.cn/items/9">原文链接</a></article></body></html>`, 'utf8')

    const record = await vault.importFile('示例建设发展有限公司', htmlPath)

    expect(record).toMatchObject({
      processingStatus: 'content-ready',
      extraction: {
        title: '示例项目招标公告',
        publisherCandidate: '行业资讯网',
        originalPublisherCandidate: '示例市公共资源交易中心',
        originalUrlCandidate: 'https://trade.example.gov.cn/items/9',
        provenanceTypeCandidate: 'explicit-repost',
        publishedAtCandidate: '2026-09-05',
        documentIdentifiers: [{ kind: 'project-number', value: 'XM-2026-009' }],
      },
    })
    expect(JSON.stringify(record)).not.toContain('这是公告的有效正文内容')
    await expect(vault.readExtractedText(record.id)).resolves.toContain('这是公告的有效正文内容')
  })

  it('deduplicates the same file for the same subject by SHA-256', async () => {
    const { source, vault } = await fixture()

    const first = await vault.importFile('示例建设发展有限公司', source)
    const second = await vault.importFile('示例建设发展有限公司', source)

    expect(second.id).toBe(first.id)
    await expect(vault.list()).resolves.toHaveLength(1)
  })

  it('rejects unsupported, empty and oversized files before copying', async () => {
    const { root, vault } = await fixture()
    const unsupported = path.join(root, 'script.exe')
    const empty = path.join(root, 'empty.pdf')
    const oversized = path.join(root, 'large.pdf')
    await writeFile(unsupported, 'x')
    await writeFile(empty, '')
    await writeFile(oversized, '123456')
    const smallVault = new EvidenceVault(path.join(root, 'small-vault'), 5)

    await expect(vault.importFile('示例建设发展有限公司', unsupported)).rejects.toThrow('文件类型')
    await expect(vault.importFile('示例建设发展有限公司', empty)).rejects.toThrow('空文件')
    await expect(smallVault.importFile('示例建设发展有限公司', oversized)).rejects.toThrow('文件过大')
    await expect(smallVault.list()).resolves.toEqual([])
  })

  it('keeps legacy unparsed records readable and rejects a malformed extraction summary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shiji-evidence-index-test-'))
    temporaryRoots.push(root)
    const vaultRoot = path.join(root, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    const legacy = {
      id: 'legacy-001',
      subjectName: '示例建设发展有限公司',
      fileName: '旧材料.pdf',
      extension: '.pdf',
      mediaKind: 'pdf',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
      importedAt: '2026-09-05T08:00:00.000Z',
      processingStatus: 'stored-unparsed',
    }
    const indexPath = path.join(vaultRoot, 'index.v1.json')
    await writeFile(indexPath, JSON.stringify({ version: 1, records: [legacy] }), 'utf8')
    const vault = new EvidenceVault(vaultRoot)

    await expect(vault.list()).resolves.toEqual([legacy])

    const malformed = {
      ...legacy,
      processingStatus: 'content-ready',
      extraction: {
        processingStatus: 'content-ready',
        textCharacters: 10,
        provenanceTypeCandidate: 'unknown',
        documentIdentifiers: [],
        truncated: false,
        warnings: [42],
      },
    }
    await writeFile(indexPath, JSON.stringify({ version: 1, records: [malformed] }), 'utf8')
    await expect(vault.list()).rejects.toThrow('索引格式损坏')
  })
})
