// 商机雷达交互验收脚本（桩数据只用于版面/交互骨架；功能真实性以 npm run verify:real 为准）。
//
// 依赖：scripts/ui-verify-preload.cjs 提供桩 preload；雷达结果与证据由本脚本写入 localStorage
// （与 ui-verify-launch.mjs 同一口径）。证据必须通过 shared/evidence-contract.ts 的 isEvidenceRecord，
// 否则会被 loadSearchEvidence 过滤掉，变成"0 条证据也通过"的空验证。
//
// 验收点（对应用户反馈）：
//   1) 雷达结果项存在且可拖拽（draggable），拖到底部落点后落点逻辑真正触发；
//   2) 结果项有「查看详情」入口，且本机有证据时可打开招标详情弹层；
//   3) 结果项有「归档 / 忽略 / 删除」入口；
//   4) 点击「删除」后列表条数减少。
//
// 用法：npx electron scripts/ui-verify-radar.mjs
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

// 严格按 shared/agent-contract.ts 的 isOpportunity 构造。
const opportunity = (id, title) => ({
  id, title, companyId: `company-${id}`, companyName: `验证主体 ${id}`,
  amountWan: 500, locationAddress: '成都市高新区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '工程改造', reason: '商机雷达交互自测数据',
  evidenceIds: [`ev-${id}`], followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [{ evidenceId: `ev-${id}`, stageId: 'tender', occurredAt: '2026-09-16', title: '招标公告', source: '示例公共资源交易中心' }],
})
// 严格按 shared/evidence-contract.ts 的 isEvidenceRecord 构造。
const evidence = (id) => ({
  id,
  subject: { kind: 'opportunity', id: `subject-${id}`, name: `验证主体 ${id}` },
  title: `公告正文 ${id}`,
  artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
  provenance: {
    pageUrl: `https://example.gov.cn/${id}`,
    publisher: '示例公共资源交易中心',
    provenanceType: 'original',
    documentIdentifiers: [{ kind: 'project-number', value: `XM-2026-${id}` }],
    publishedAt: '2026-09-16T08:00:00.000Z',
    capturedAt: '2026-09-16T08:00:00.000Z',
    corroboratingEvidenceIds: [],
  },
  assessment: {
    status: 'assessed', claimType: 'project-stage', grade: 'A',
    permittedUses: ['discovery', 'report-candidate', 'stage-confirmation'],
    reasons: ['原始发布单位、项目编号与原文链接完整。'], missingChecks: [], assessedAt: '2026-09-16T08:05:00.000Z',
  },
  opportunityDetails: {
    companyCandidates: [`验证主体 ${id}`], amountWanCandidates: [500], stageIds: ['tender'],
    deadlineCandidates: ['2026-10-15'], addressCandidates: ['成都市高新区示例路 1 号'],
    agencyCandidates: [], lotCandidates: [], scopeCandidates: [],
    qualificationCandidates: [], depositCandidates: [], openingTimeCandidates: [],
    contactCandidates: [], attachmentCandidates: [],
  },
})

const ROW = '.deep-radar-view .radar-result-item'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1100, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))

  const items = [
    opportunity('radar-verify-1', '甲项目 雷达交互验证'),
    opportunity('radar-verify-2', '乙项目 雷达交互验证'),
    opportunity('radar-verify-3', '丙项目 雷达交互验证'),
  ]
  const evidenceRecords = items.map((item) => evidence(`ev-${item.id}`))
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.deep-radar-results.v1', ${JSON.stringify(JSON.stringify(items))});
    localStorage.setItem('shiji.search-evidence.v2', ${JSON.stringify(JSON.stringify(evidenceRecords))});
    localStorage.setItem('shiji.managed-buckets.v1', JSON.stringify({ focus: [], compare: [], action: [] }));
localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify({ version: 1, records: { 'nearby-seed-1': opportunity('nearby-seed-1', '附近招标已有项目') }, currentResultIds: ['nearby-seed-1'], currentEvidenceIds: ['ev-nearby-seed-1'], lifecycle: {} }))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'radar' }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1600)

  const dom = await wc.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('${ROW}')]
    const details = document.querySelector('.deep-radar-view [data-action="open-details"]')
    return {
      hasRadarView: Boolean(document.querySelector('.deep-radar-view')),
      rowCount: rows.length,
      draggable: rows.map((row) => row.getAttribute('draggable') !== null),
      hasDetailsButton: Boolean(details),
      detailsEnabled: Boolean(details) && !details.disabled,
      hasDeleteButton: Boolean(document.querySelector('.deep-radar-view [data-action="delete"]')),
      hasArchiveButton: Boolean(document.querySelector('.deep-radar-view [data-action="archive"]')),
      hasIgnoreButton: Boolean(document.querySelector('.deep-radar-view [data-action="ignore"]')),
      dropTargets: document.querySelectorAll('.drop-dock .drop-target').length,
    }
  })()`)
  console.log(JSON.stringify(dom, null, 2).slice(0, 900))

  check('雷达视图已渲染', dom.hasRadarView, JSON.stringify(dom))
  check('雷达有结果项', dom.rowCount === 3, String(dom.rowCount))
  check('结果项全部可拖拽（draggable）', dom.rowCount > 0 && dom.draggable.every(Boolean), JSON.stringify(dom.draggable))
  check('结果项有「查看详情」入口且本机有证据时可点', dom.hasDetailsButton && dom.detailsEnabled, JSON.stringify(dom))
  check('结果项有「删除」入口', dom.hasDeleteButton, String(dom.hasDeleteButton))
  check('结果项有「归档」入口', dom.hasArchiveButton, String(dom.hasArchiveButton))
  check('结果项有「忽略」入口', dom.hasIgnoreButton, String(dom.hasIgnoreButton))
  check('底部存在可放置落点', dom.dropTargets >= 3, String(dom.dropTargets))

  // 查看详情：点开后必须真的出现招标详情弹层（不是空按钮）。
  await wc.executeJavaScript(`(() => { const b = document.querySelector('.deep-radar-view [data-action="open-details"]'); if (b) b.click(); return true })()`)
  await sleep(400)
  const overlayOpen = await wc.executeJavaScript(`Boolean(document.querySelector('.evidence-detail-overlay'))`)
  check('点「查看详情」打开招标详情弹层', overlayOpen, String(overlayOpen))
  await wc.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(300)

  // 删除：点一次必须让列表条数减少。
  const countBefore = await wc.executeJavaScript(`document.querySelectorAll('${ROW}').length`)
  await wc.executeJavaScript(`(() => { const b = document.querySelector('.deep-radar-view [data-action="delete"]'); if (b) b.click(); return Boolean(b) })()`)
  await sleep(700)
  const countAfter = await wc.executeJavaScript(`document.querySelectorAll('${ROW}').length`)
  check('删除后列表条数减少', countAfter < countBefore, `${countBefore} -> ${countAfter}`)

  // 2026-09-17 用户口径（真实追加）：雷达结果勾选＝**立刻**追加进总览当前结果（绝不替换原有项目）；
// 取消勾选＝从总览移出。这里预置一个既有总览结果 nearby-seed-1 来钉死"追加不替换"。
const readCatalog = () => wc.executeJavaScript(`(() => { try { return JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1') || '{}') } catch (error) { return {} } })()`)
const before = await readCatalog()
check('初始：总览只有预置项目，雷达结果还没进去', JSON.stringify(before.currentResultIds) === JSON.stringify(['nearby-seed-1']), JSON.stringify(before.currentResultIds))

const pickDom = await wc.executeJavaScript(`(() => {
  const bar = document.querySelector('.deep-radar-view .radar-pick-bar')
  const boxes = [...document.querySelectorAll('.deep-radar-view .radar-pick-item input')]
  return {
    boxes: boxes.length,
    checked: boxes.filter((box) => box.checked).length,
    hint: (bar?.querySelector('small')?.textContent ?? '').replace(/\s+/g, ' '),
    label: (document.querySelector('.deep-radar-view .radar-pick-item')?.textContent ?? '').trim(),
  }
})()`)
check('雷达每个结果都有「加入总览」勾选框，且勾选状态来自总览真实成员', pickDom.boxes >= 1 && pickDom.checked === 0, JSON.stringify(pickDom))
check('勾选区写明去向：追加到总览 + 到总览再勾选可进分析/获客模块', pickDom.hint.includes('立刻追加') && pickDom.hint.includes('总览') && pickDom.hint.includes('获客'), pickDom.hint)

// 勾选第 1、2 项  不做任何额外点击，总览就应该已经追加
await wc.executeJavaScript(`(() => { [...document.querySelectorAll('.deep-radar-view .radar-pick-item input')].slice(0, 2).forEach((box) => box.click()); return true })()`)
await sleep(500)
const after = await readCatalog()
const ids = after.currentResultIds || []
check('勾选即追加进总览：预置项目保留 + 两个雷达结果已进入', ids.includes('nearby-seed-1') && ids.length === 3, JSON.stringify(ids))
const checkedLabel = await wc.executeJavaScript(`(() => (document.querySelector('.deep-radar-view .radar-pick-item')?.textContent ?? '').trim())()`)
check('已在总览的结果勾选框显示「已在总览」', checkedLabel.includes('已在总览'), checkedLabel)

// 取消其中一个  应该从总览移出，另一个仍在
await wc.executeJavaScript(`(() => { const box = document.querySelector('.deep-radar-view .radar-pick-item input'); box.click(); return true })()`)
await sleep(400)
const afterUncheck = await readCatalog()
const idsAfterUncheck = afterUncheck.currentResultIds || []
check('取消勾选即从总览移出，其他项目不受影响', !idsAfterUncheck.includes(ids[1]) && idsAfterUncheck.includes(ids[2]) && idsAfterUncheck.includes('nearby-seed-1'), JSON.stringify(idsAfterUncheck))
writeFileSync(join(artifacts, 'ui-verify-radar.png'), (await wc.capturePage()).toPNG())
  console.log('截图: artifacts/ui-verify-radar.png')

  // 拖拽：dragstart 后把对象放进「对比篮」，用 localStorage 证明落点逻辑真的跑了。
  const bucketsBefore = await wc.executeJavaScript(`localStorage.getItem('shiji.managed-buckets.v1')`)
  await wc.executeJavaScript(`(() => {
    const row = document.querySelector('${ROW}')
    if (!row) return false
    const data = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
    return true
  })()`)
  await sleep(350)
  const dropped = await wc.executeJavaScript(`(() => {
    const zone = document.querySelector('.drop-dock .drop-target[data-bucket="compare"]')
    if (!zone) return false
    const data = new DataTransfer()
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: data }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }))
    return true
  })()`)
  await sleep(700)
  const bucketsAfter = await wc.executeJavaScript(`localStorage.getItem('shiji.managed-buckets.v1')`)
  const storedInto = (() => {
    try { return (JSON.parse(bucketsAfter ?? '{}').compare ?? []).length } catch { return -1 }
  })()
  check('拖拽到落点后真正写入管理区（落点逻辑被触发）', dropped && storedInto > 0, `before=${bucketsBefore} after=${bucketsAfter}`)

  console.log(failed === 0
    ? '商机雷达交互验收通过：可拖拽落点 + 可点详情 + 归档/忽略/删除入口齐全且删除生效。'
    : `商机雷达交互验收失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('运行异常:', error); app.exit(2) })