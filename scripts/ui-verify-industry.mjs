// 产业链界面自测（桩执行器，记录调用次数）：
//   ① 未启动：只显示对象行 + 启动按钮，不预渲染任何企业；
//   ② 点「启动分析」：按勾选范围每项目各一次调用；对象卡片收起；
//   ③ 结果卡：每个项目一张；一级标题＝甲方 / 以往中标企业 / 上下游供应链；
//      标题下是紧凑表格（列＝公司名称 / 联系方式 / 法人 / 行业领域 / 来源），
//      一家一行、缺值用"—"、原句放悬停提示（用户 2026-09-16 要求压缩版面）；
//   ④ 不出现任何图/地图元素。
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts')
mkdirSync(artifacts, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = 0
const check = (title, passed, extra = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${title}${passed || !extra ? '' : `\n        -> 实际: ${extra}`}`)
  if (!passed) failed += 1
}
const opportunity = (id, title) => ({
  id, title, companyId: `company-${id}`, companyName: `甲方公司${id}有限公司`,
  amountWan: 1280, locationAddress: '四川省成都市武侯区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '市政基础设施', reason: '产业链界面自测数据',
  evidenceIds: [], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1080, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  const a = opportunity('industry-1', '甲项目  产业链自测')
  const b = opportunity('industry-2', '乙项目  产业链自测')
  const catalog = { version: 1, records: { [a.id]: a, [b.id]: b }, currentResultIds: [a.id, b.id], currentEvidenceIds: [], lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', '[]');
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([a.id, b.id]))});
    localStorage.setItem('shiji.analysis-runs.v1', '[]');
    localStorage.setItem('shiji.industry-chain.v1', '[]');
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'industry', selectedOpportunityId: a.id }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1500)

  const before = await wc.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.scope-object-list > li').length,
    cards: document.querySelectorAll('.industry-result-card').length,
    companies: document.querySelectorAll('.industry-company').length,
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runIndustryChain').length,
    mapNodes: document.querySelectorAll('.tianditu-map, .industry-graph, .react-flow').length,
  }))()`)
  check('未启动只显示对象行（2 行），不预渲染任何企业', before.rows === 2 && before.cards === 0 && before.companies === 0, JSON.stringify(before))
  check('未启动时没有发起产业链调用', before.calls === 0, `调用=${before.calls}`)
  check('本模块没有任何图/地图元素', before.mapNodes === 0, `图元素=${before.mapNodes}`)

  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="industry"]').click(); return true })()`)
  await sleep(1500)
  const afterStart = await wc.executeJavaScript(`(() => ({
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runIndustryChain').map((call) => ({ id: call.input.opportunityId, company: call.input.companyName, industry: call.input.industry })),
    cards: document.querySelectorAll('.industry-result-card').length,
    visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
    objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
  }))()`)
  check('按勾选范围逐个执行（2 个项目各 1 次）', afterStart.calls.length === 2 && new Set(afterStart.calls.map((call) => call.id)).size === 2, JSON.stringify(afterStart.calls))
  check('请求带上甲方名称与行业（供关系与四维度抽取）', afterStart.calls.every((call) => call.company.includes('甲方公司') && call.industry), JSON.stringify(afterStart.calls))
  check('启动后对象卡片收起、结果卡按项目渲染', afterStart.visibleObjectRows === 0 && afterStart.cards === 2 && afterStart.objectBar.includes('2 个项目'), JSON.stringify({ rows: afterStart.visibleObjectRows, cards: afterStart.cards }))

  const dom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.industry-result-card')
    const rows = [...card.querySelectorAll('.industry-company-card')]
    const valueFor = (row, label) => {
      const field = [...row.querySelectorAll('dl > div')].find((item) => item.querySelector('dt')?.textContent?.trim() === label)
      return field?.querySelector('dd')?.textContent?.trim() ?? ''
    }
    return {
      blocks: [...card.querySelectorAll('.industry-block > header > span')].map((node) => node.textContent),
      blockCounts: [...card.querySelectorAll('.industry-block > header b')].map((node) => node.textContent),
      rows: rows.map((row) => ({
        name: row.querySelector('header strong')?.textContent?.trim() ?? '',
        phone: valueFor(row, '联系电话'),
        legal: valueFor(row, '法定代表人'),
        industry: valueFor(row, '行业领域'),
        source: valueFor(row, '证据来源'),
        tip: row.getAttribute('title') ?? '',
        hasRelationDisclosure: Boolean(row.querySelector('details.industry-relation-evidence')),
        relationText: row.querySelector('details.industry-relation-evidence p')?.textContent?.trim() ?? '',
        primary: row.classList.contains('primary'),
      })),
      gaps: [...card.querySelectorAll('.policy-gaps li')].map((node) => node.textContent),
      boundary: card.querySelector('.policy-boundary')?.textContent ?? '',
      status: card.querySelector('header span')?.textContent ?? '',
      hasLink: Boolean(card.querySelector('.industry-company-card header strong a')),
      graphNodes: card.querySelectorAll('.react-flow, .industry-graph, .tianditu-map').length,
      quoteBlocks: card.querySelectorAll('.industry-relation-evidence').length,
      cardHeight: Math.round(card.getBoundingClientRect().height),
    }
  })()`)
  console.log(JSON.stringify(dom, null, 2).slice(0, 1100))

  check('一级标题不变：甲方 / 以往中标企业 / 上下游供应链', dom.blocks.join('|') === '甲方（招标/建设主体）|以往中标企业|上下游供应链', JSON.stringify(dom.blocks))
  check('清单条数与桩数据一致（中标 1 / 供应链 2）', dom.blockCounts.join('|') === '1|2', JSON.stringify(dom.blockCounts))
  check('每家企业使用独立结构化卡片，显示电话/法人/行业/证据来源', dom.rows.length === 4 && dom.rows.every((row) => row.name && row.phone && row.legal && row.industry && row.source), JSON.stringify(dom.rows))
  check('甲方行在最前并带甲方标记', dom.rows[0].primary === true && dom.rows[0].name.includes('甲方'), JSON.stringify(dom.rows[0]))
  check('缺值明确显示“未取得”，不伪造字段', dom.rows.some((row) => [row.phone, row.legal, row.industry].includes('未取得')), JSON.stringify(dom.rows.map((row) => row.legal)))
  check('关系原文折叠展示，不挤入企业事实卡默认内容', dom.quoteBlocks === 3 && dom.rows.slice(1).every((row) => row.hasRelationDisclosure && row.relationText && row.tip.includes(row.relationText)), JSON.stringify({ blocks: dom.quoteBlocks, rows: dom.rows.slice(1).map((row) => ({ disclosure: row.hasRelationDisclosure, quote: row.relationText, tip: row.tip.slice(0, 50) })) }))
  check('公司名可点开来源', dom.hasLink === true)
  check('结果卡内没有图元素', dom.graphNodes === 0)
  check('显示缺口与边界说明（含"—"图例）', dom.gaps.length > 0 && dom.boundary.includes('—') && dom.status.includes('实际调用'), JSON.stringify({ gaps: dom.gaps.length, status: dom.status }))
  check('结构化企业卡完整渲染且未丢失结果容器', dom.cardHeight > 0, `${dom.cardHeight}px`)

  const beforeRerun = (await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runIndustryChain').length`))
  await wc.executeJavaScript(`(() => { document.querySelector('.industry-result-card button.card-run').click(); return true })()`)
  await sleep(1200)
  const afterRerun = (await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runIndustryChain').length`))
  check('「重新分析」6 小时内直接复用本机结果，0 次新调用', afterRerun === beforeRerun, `新增 ${afterRerun - beforeRerun} 次`)
const reuseStatus = await wc.executeJavaScript(`document.querySelector('.industry-result-card header span')?.textContent ?? ''`)
check('复用后显示「检索成功 / 命中缓存 / 暂无更新」', reuseStatus.includes('检索成功') && reuseStatus.includes('命中缓存') && reuseStatus.includes('暂无更新'), reuseStatus)

  writeFileSync(join(artifacts, 'ui-verify-industry.png'), (await wc.capturePage()).toPNG())
  console.log('截图: artifacts/ui-verify-industry.png')
  console.log('')
  console.log(failed === 0 ? '产业链界面自测通过：企业卡片（名称/电话/法人/行业/来源）+ 关系原文 + 无图。' : `产业链界面自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })
