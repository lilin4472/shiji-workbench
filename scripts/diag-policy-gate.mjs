// 诊断：真实检索一遍"当前项目相关的政策/预算文件"，逐条对比"原始结果"与"门禁判定"，
// 看门禁到底拦掉了哪些其实算政策的文件。只读，不写用户数据。
import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDoubaoPort } from '../dist-electron/electron/doubao-provider.js'
import { SearchCache, createCachedSearchPort } from '../dist-electron/electron/search-cache.js'
import { createSearchDocumentReader } from '../dist-electron/electron/search-document-reader.js'
import { readPolicySignals, policySourceTier, policyScopeKeywords, matchesPolicyScope } from '../dist-electron/shared/policy-chain.js'

app.setName('shiji-workbench')

const appData = join(process.env.APPDATA ?? '', 'shiji-workbench')
const cachePath = join(appData, 'cache', 'doubao.v1.json')
const credentialPath = join(appData, 'secure', 'credentials.v1.json')
const INDUSTRY = process.argv.find((v) => v.startsWith('--industry='))?.slice(11) ?? '市政基础设施'
const COMPANY = process.argv.find((v) => v.startsWith('--company='))?.slice(10) ?? '成都市武侯区智慧宜居建设开发有限公司'
const PROJECT_TITLE = process.argv.find((v) => v.startsWith('--project='))?.slice(10) ?? '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务'
const ADDRESS = process.argv.find((v) => v.startsWith('--address='))?.slice(10) ?? '四川省成都市武侯区'

const QUERIES = [
  { level: '国家级', query: `财政部 国家发展改革委 ${INDUSTRY} 资金 下达 通知 管理办法 实施细则 五年规划 五年计划 2026 最新` },
  { level: '四川省', query: `四川省财政厅 四川省发展和改革委员会 ${INDUSTRY} 资金 下达 通知 管理办法 实施细则 实施方案 任务分解 2026 最新` },
  { level: '成都市', query: `成都市财政局 成都市住房和城乡建设局 ${INDUSTRY} 资金 下达 通知 管理办法 实施细则 实施方案 任务分解 2026 最新` },
  { level: '国家级补充', query: `中央预算内投资 地方政府专项债券 城市更新 市政基础设施 管理办法 资金 下达 通知 2026` },
  { level: '四川省补充', query: `四川省 城市更新 市政基础设施 专项资金 管理办法 实施方案 通知 2026` },
  { level: '成都市补充', query: `成都市 城市更新 市政基础设施 城市管理 资金 项目库 管理办法 通知 2026` },
]

app.whenReady().then(async () => {
  const credentialFile = JSON.parse(await readFile(credentialPath, 'utf8'))
  const key = safeStorage.decryptString(Buffer.from(credentialFile.doubao.encrypted, 'base64'))
  app.setPath('userData', join(tmpdir(), `shiji-diag-${Date.now()}`))
  const cache = new SearchCache({
    read: async () => (existsSync(cachePath) ? await readFile(cachePath, 'utf8') : undefined),
    write: async (content) => { await mkdir(join(appData, 'cache'), { recursive: true }); await writeFile(cachePath, content, 'utf8') },
  })
  const port = createCachedSearchPort(createDoubaoPort(async () => key), cache, { provider: 'doubao', ttlMs: 6 * 60 * 60 * 1_000 })
  const readDocument = createSearchDocumentReader()
  const keywords = policyScopeKeywords({ industry: INDUSTRY, projectTitle: PROJECT_TITLE, address: ADDRESS })
  console.log(`相关性词表（${keywords.length} 个）：${keywords.join('、')}`)
  const report = []

  for (const item of QUERIES) {
    const result = await port({ provider: 'doubao', purpose: 'policy-chain', query: item.query, maxResults: 10 })
    console.log(`\n══════ ${item.level}｜${item.query}`)
    console.log(`       ${result.cacheHit ? '命中缓存' : `实际搜索 ${result.requestCount} 次`}；返回 ${result.sources.length} 条`)
    const rows = []
    for (const [index, source] of result.sources.entries()) {
      const providerBody = source.content?.trim() ?? ''
      let text = providerBody
      let fetchNote = providerBody ? `provider正文${providerBody.length}字` : ''
      if (!text) {
        try {
          const read = await readDocument(source)
          text = read.extraction.processingStatus === 'content-ready' ? read.extraction.text : ''
          fetchNote = `抓取${text.length}字`
        } catch (error) {
          fetchNote = `抓取失败:${error instanceof Error ? error.message : '未知'}`
        }
      }
      const title = source.title ?? ''
      const lower = ['四川省', '成都市']
      const signals = readPolicySignals(text, lower, INDUSTRY, title)
      const bodyOnly = readPolicySignals(text, lower, INDUSTRY, '')
      const relevant = matchesPolicyScope(title, text, keywords)
      const tier = policySourceTier(source.url, source.publisher ?? '')
      const row = {
        index: index + 1, title, url: source.url, publisher: source.publisher ?? '', sourceClass: source.sourceClass,
        chars: text.length, fetchNote, tier,
        keep: signals.isPolicyDocument && relevant && text.length >= 80,
        titlePolicy: signals.isPolicyDocument, bodyPolicy: bodyOnly.isPolicyDocument, relevant,
        documentNumber: signals.documentNumber ?? null, budgetYear: signals.budgetYear ?? null,
        plans: signals.planNames, instruments: signals.instruments,
      }
      rows.push(row)
      const verdict = row.keep ? '保留' : `拦掉(${!signals.isPolicyDocument ? '标题/正文不像政策' : !relevant ? '与本行业无关' : '正文过短'})`
      console.log(`  ${String(index + 1).padStart(2)}. [${verdict}] ${tier === 'official' ? '官方' : '媒体'}｜${title.slice(0, 60)}`)
      console.log(`      ${source.url.slice(0, 110)}`)
      console.log(`      发布者=${source.publisher ?? '—'}｜${fetchNote}｜标题像政策=${signals.isPolicyDocument}｜正文像政策=${bodyOnly.isPolicyDocument}｜相关=${relevant}${signals.documentNumber ? `｜文号=${signals.documentNumber}` : ''}${signals.budgetYear ? `｜预算年=${signals.budgetYear}` : ''}${signals.instruments.length ? `｜渠道=${signals.instruments.join('/')}` : ''}`)
    }
    report.push({ level: item.level, query: item.query, cacheHit: result.cacheHit, requestCount: result.requestCount, rows })
  }

  await writeFile(join(process.cwd(), 'artifacts', 'diag-policy-gate.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('\n诊断报告: artifacts/diag-policy-gate.json')
  app.exit(0)
}).catch((error) => { console.error('诊断异常:', error); app.exit(2) })
