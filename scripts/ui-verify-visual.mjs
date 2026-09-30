// 视觉/结构自测（2026-09-16 第 3 轮 · 用户口径修正版）
// 目标：用可复现断言锁定"模块页结构"与同级卡片一致性，并留档 6 张截图供人复核审美。
//
// 结构（用户 2026-09-16 修正）：
//   ① 项目进入模块：只带"够用的引用"——名字（可点进详情）/ 主体 / 已知阶段 / 本机证据条数；
//      不把项目字段铺满每个模块，不做复杂载荷卡。
//   ② 点「启动分析」：对象卡片收起（默认折叠），改以**本模块的分析结果卡片**呈现，
//      时间链＝每个项目一张卡 + 该项目的七阶段节点链。
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
  id, title, companyId: `company-${id}`, companyName: `验证主体 ${id}`,
  amountWan: 1280, locationAddress: '成都市高新区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '工程改造', reason: '视觉自测数据：弱电智能化改造项目。',
  evidenceIds: [`ev-${id}`], followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [{ evidenceId: `ev-${id}`, stageId: 'tender', occurredAt: '2026-09-16', title: '招标公告', source: '示例公共资源交易中心' }],
})
const evidence = (id) => ({
  id,
  subject: { kind: 'opportunity', id: `subject-${id}`, name: `验证主体 ${id}` },
  title: `公告正文 ${id}`,
  artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
  provenance: {
    pageUrl: `https://example.gov.cn/${id}`, publisher: '示例公共资源交易中心', provenanceType: 'original',
    documentIdentifiers: [{ kind: 'project-number', value: `XM-2026-${id}` }],
    publishedAt: '2026-09-16T08:00:00.000Z', capturedAt: '2026-09-16T08:00:00.000Z', corroboratingEvidenceIds: [],
  },
  assessment: {
    status: 'assessed', claimType: 'project-stage', grade: 'A',
    permittedUses: ['discovery', 'report-candidate', 'stage-confirmation'],
    reasons: ['原始发布单位、项目编号与原文链接完整。'], missingChecks: [], assessedAt: '2026-09-16T08:05:00.000Z',
  },
  opportunityDetails: {
    companyCandidates: [`验证主体 ${id}`], amountWanCandidates: [1280], stageIds: ['tender'],
    deadlineCandidates: ['2026-10-15'], addressCandidates: ['成都市高新区示例路 1 号'],
    agencyCandidates: ['示例招标代理有限公司'], lotCandidates: ['一标段'], scopeCandidates: ['弱电智能化改造'],
    qualificationCandidates: ['电子与智能化工程专业承包二级'], depositCandidates: ['2 万元'],
    openingTimeCandidates: ['2026-10-15 09:30'], contactCandidates: [], attachmentCandidates: [],
  },
})

const a = opportunity('visual-1', '甲项目  视觉收口自测')
const b = opportunity('visual-2', '乙项目  视觉收口自测')
const catalog = { version: 1, records: { [a.id]: a, [b.id]: b }, currentResultIds: [a.id, b.id], currentEvidenceIds: [`ev-${a.id}`, `ev-${b.id}`], lifecycle: {} }
const run = (item, status) => ({
  opportunityId: item.id, moduleId: 'timeline', targetSubjectName: item.companyName,
  status, updatedAt: '2026-09-16T09:00:00.000Z',
  message: status === 'completed' ? '补全执行完成：新增 1 条阶段证据，保留 0 条待核候选。' : '补全执行完成：保留 1 条待核候选。',
  actualSearchCalls: 1, actualModelCalls: 0,
})

const css = (selector, prop) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}) : null })()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1080, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', ${JSON.stringify(JSON.stringify([evidence(`ev-${a.id}`), evidence(`ev-${b.id}`)]))});
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([a.id, b.id]))});
    return true
  })()`)

  const themes = ['current', 'warm']
  const backgrounds = {}
  for (const theme of themes) {
    // ── ① 未启动：对象行（只有够用的引用） ────────────────────────────
    await wc.executeJavaScript(`(() => {
      localStorage.setItem('shiji.color-theme.v1', ${JSON.stringify(theme)});
      localStorage.setItem('shiji.analysis-runs.v1', '[]');
      localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'timeline', selectedOpportunityId: a.id }))});
      return true
    })()`)
    await wc.reload()
    await sleep(1500)
    const objectPage = await wc.executeJavaScript(`(() => {
      const text = document.querySelector('.analysis-not-started')?.textContent ?? ''
      const row = document.querySelector('.scope-object-list > li')
      return {
        rows: document.querySelectorAll('.scope-object-list > li').length,
        rowText: row ? row.textContent : '',
        titleClickable: Boolean(row && row.querySelector('button.scope-title')),
        titleSize: ${css('.scope-object-list .scope-title strong', 'font-size')},
        leakedField: ['代理机构', '标段', '招标范围', '投标资格'].some((label) => text.includes(label)),
        legacyCards: document.querySelectorAll('.scope-card, .scope-fields').length,
        toggle: Boolean(document.querySelector('.scope-objects-toggle')),
        startHeight: (() => { const el = document.querySelector('.analysis-not-started > button:not(:disabled)'); return el ? Math.round(el.getBoundingClientRect().height) : 0 })(),
        startBackground: ${css('.analysis-not-started > button:not(:disabled)', 'background-image')},
        nodeCount: document.querySelectorAll('.time-node').length,
      }
    })()`)
    if (theme === 'current') {
      check('对象行 = 勾选数量（2 行）', objectPage.rows === 2, `行数=${objectPage.rows}`)
      check('对象行只带够用的引用（名字/主体/阶段/证据条数）', ['甲项目', '验证主体 visual-1', '招标公告', '1 条本机证据'].every((t) => objectPage.rowText.includes(t)), objectPage.rowText.slice(0, 120))
      check('项目名可点击进详情', objectPage.titleClickable === true && Number.parseFloat(objectPage.titleSize) >= 12)
      check('不再把项目字段铺进模块（无复杂载荷卡）', objectPage.leakedField === false && objectPage.legacyCards === 0)
      check('对象区可手动收起/展开', objectPage.toggle === true)
      check('「启动分析」为主操作样式且高度 ≥32px', String(objectPage.startBackground).includes('gradient') && objectPage.startHeight >= 32, `${objectPage.startBackground} / ${objectPage.startHeight}px`)
      check('未启动不预渲染节点链', objectPage.nodeCount === 0, `节点数=${objectPage.nodeCount}`)
    }
    writeFileSync(join(artifacts, `ui-visual-objects-${theme}.png`), (await wc.capturePage()).toPNG())
    console.log('截图: artifacts/' + `ui-visual-objects-${theme}.png`)

    // ── ② 已启动：对象收起 + 每个项目一张结果卡 ────────────────────────
    await wc.executeJavaScript(`(() => {
      localStorage.setItem('shiji.analysis-runs.v1', ${JSON.stringify(JSON.stringify([run(a, 'completed'), run(b, 'partial')]))});
      return true
    })()`)
    await wc.reload()
    await sleep(1500)
    const resultPage = await wc.executeJavaScript(`(() => {
      const card = document.querySelector('.timeline-result-card')
      return {
        objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
        visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
        cards: document.querySelectorAll('.timeline-result-card').length,
        nodeCounts: [...document.querySelectorAll('.timeline-result-card')].map((c) => c.querySelectorAll('.time-node').length),
        titles: [...document.querySelectorAll('.timeline-result-card > header strong')].map((el) => el.textContent),
        statuses: [...document.querySelectorAll('.timeline-result-card > header span')].map((el) => el.textContent),
        radius: card ? getComputedStyle(card).borderRadius : null,
        background: card ? getComputedStyle(card).backgroundColor : null,
        titleSize: ${css('.timeline-result-card > header strong', 'font-size')},
        runButtons: document.querySelectorAll('.timeline-result-card button.card-run').length,
        subscribeButtons: document.querySelectorAll('.timeline-result-card > footer button').length,
        nodeSize: ${css('.timeline-result-card .time-node strong', 'font-size')},
      }
    })()`)
    backgrounds[theme] = resultPage.background
    console.log(`[${theme}] 结果视图: ` + JSON.stringify(resultPage))
    if (theme === 'current') {
      check('启动后对象卡片收起（默认不展开）', resultPage.visibleObjectRows === 0 && resultPage.objectBar.includes('2 个项目'), `可见对象行=${resultPage.visibleObjectRows}`)
      check('每个项目一张结果卡（2 张）且标题为项目名', resultPage.cards === 2 && resultPage.titles.join(',') === '甲项目  视觉收口自测,乙项目  视觉收口自测', resultPage.titles.join(','))
      check('每张结果卡带该项目的七阶段节点链', resultPage.nodeCounts.every((count) => count === 7), JSON.stringify(resultPage.nodeCounts))
      check('结果卡标出运行状态（实际调用）', resultPage.statuses.every((text) => text.includes('实际调用')), JSON.stringify(resultPage.statuses))
      check('结果卡与结果行同一圆角语言（14px）', resultPage.radius === '14px', String(resultPage.radius))
      check('结果卡提供重新分析与订阅入口', resultPage.runButtons === 2 && resultPage.subscribeButtons === 2, `${resultPage.runButtons} / ${resultPage.subscribeButtons}`)
      check('节点文字可读（≥11px）', Number.parseFloat(resultPage.nodeSize) >= 11, String(resultPage.nodeSize))
    }
    writeFileSync(join(artifacts, `ui-visual-module-${theme}.png`), (await wc.capturePage()).toPNG())
    console.log('截图: artifacts/' + `ui-visual-module-${theme}.png`)

    // ── ③ 总览：提示语 + 结果卡 ────────────────────────────────────────
    await wc.executeJavaScript(`(() => { localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'overview', selectedOpportunityId: a.id }))}); return true })()`)
    await wc.reload()
    await sleep(1500)
    const overview = await wc.executeJavaScript(`(() => {
      const hint = document.querySelector('.result-stack .section-heading small')
      return {
        hintText: hint ? hint.textContent : '',
        hintSize: hint ? getComputedStyle(hint).fontSize : null,
        hintWeight: hint ? getComputedStyle(hint).fontWeight : null,
        checkboxes: document.querySelectorAll('.result-select input').length,
        checked: document.querySelectorAll('.result-select input:checked').length,
        resultRadius: ${css('.result-row', 'border-radius')},
        selectionText: document.querySelector('.selection-bar')?.textContent ?? '',
      }
    })()`)
    if (theme === 'current') {
      check('总览提示语 ≥12px 且加粗 ≥700', Number.parseFloat(overview.hintSize) >= 12 && Number(overview.hintWeight) >= 700, `${overview.hintSize} / ${overview.hintWeight}`)
      check('提示语完整（含"放入项目库由你决定"）', overview.hintText.includes('放入项目库由你决定'), overview.hintText.slice(0, 40))
      check('勾选状态可见（2/2）', overview.checked === 2 && overview.selectionText.includes('已选'), `${overview.checked}`)
    }
    await wc.executeJavaScript(`(() => { const s = document.querySelector('.result-stack'); if (s) s.scrollIntoView({ block: 'start' }); return true })()`)
    await sleep(300)
    writeFileSync(join(artifacts, `ui-visual-overview-${theme}.png`), (await wc.capturePage()).toPNG())
    console.log('截图: artifacts/' + `ui-visual-overview-${theme}.png`)
  }

  check('冷/暖两套主题都作用到结果卡（底色不同）', backgrounds.current !== backgrounds.warm, `${backgrounds.current} vs ${backgrounds.warm}`)

  console.log('')
  console.log(failed === 0 ? '模块页结构自测通过：对象只带引用、启动后收起、按项目出结果卡、双主题一致。' : `模块页结构自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })
