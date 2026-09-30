// Isolated renderer acceptance: nearby selection, radar selection, overview drag and comparison.
import { app, BrowserWindow } from 'electron'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'shiji-ui-flow-')))
const traceFile = join(app.getPath('userData'), 'verify.log')
const trace = (message) => { appendFileSync(traceFile, `${message}\n`); process.stdout.write(`${message}\n`) }
setTimeout(() => { trace('TIMEOUT: renderer verification exceeded 20 seconds'); app.exit(2) }, 20000).unref()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const opportunity = (id, title, amount) => ({
  id, title, companyId: `company-${id}`, companyName: `建设单位 ${id}`,
  amountWan: amount, locationAddress: '成都市武侯区', distanceKm: 4.2, deadline: '2026-10-20',
  matchScore: 83, projectType: '机电安装', reason: '项目正文命中', evidenceIds: [`evidence-${id}`],
  followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
})
const first = opportunity('nearby-a', '附近甲项目', 120)
const second = opportunity('nearby-b', '附近乙项目', 230)
const radar = opportunity('radar-a', '雷达独立项目', 340)
const catalog = {
  version: 1, records: { [first.id]: first, [second.id]: second }, currentResultIds: [], currentEvidenceIds: [],
  nearbyResultIds: [first.id, second.id], nearbyEvidenceIds: [], lifecycle: {},
}
const failures = []
function check(label, passed, actual) {
  trace(`${passed ? 'PASS' : 'FAIL'} ${label}${passed ? '' : ` | ${JSON.stringify(actual)}`}`)
  if (!passed) failures.push(label)
}
const typography = (wc) => wc.executeJavaScript(`(() => {
  const items = [...document.querySelectorAll('body *')].filter((node) => node.children.length === 0 && node.textContent?.trim() && node.getClientRects().length > 0)
    .map((node) => ({ text: node.textContent.trim().slice(0, 28), size: parseFloat(getComputedStyle(node).fontSize) }))
    .filter((item) => Number.isFinite(item.size) && item.size < 12)
  return { count: items.length, samples: items.slice(0, 10) }
})()`)

app.whenReady().then(async () => {
  trace('ready')
  const win = new BrowserWindow({ width: 1550, height: 950, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false } })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  trace('file loaded')
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.deep-radar-results.v1', ${JSON.stringify(JSON.stringify([radar]))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'nearby' }))});
    localStorage.setItem('shiji.managed-buckets.v1', ${JSON.stringify(JSON.stringify({ focus: [], compare: [], action: [] }))});
    return true
  })()`)
  await wc.reload()
  trace('reloaded')
  await sleep(850)

  const initial = await wc.executeJavaScript(`({ cards: document.querySelectorAll('.enterprise-nearby .tender-nearby-list article').length, checked: [...document.querySelectorAll('.nearby-result-actions input')].map((item) => item.checked) })`)
  check('附近两张卡保留且默认不加入总览', initial.cards === 2 && initial.checked.every((value) => value === false), initial)
  const nearbyType = await typography(wc)
  check('附近页可见文字没有低于 12px', nearbyType.count === 0, nearbyType)
  await wc.executeJavaScript(`document.querySelector('.nearby-result-actions input')?.click()`)
  await sleep(180)
  const added = await wc.executeJavaScript(`JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1')).currentResultIds`)
  check('附近勾选加入总览', added.length === 1 && added[0] === first.id, added)
  await wc.executeJavaScript(`document.querySelector('.nearby-result-actions input')?.click()`)
  await sleep(180)
  const removed = await wc.executeJavaScript(`({ cards: document.querySelectorAll('.enterprise-nearby .tender-nearby-list article').length, overview: JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1')).currentResultIds, sources: document.querySelectorAll('.enterprise-nearby .discovery-evidence-panel').length })`)
  check('取消总览仅取消勾选，附近卡片不消失、原始来源不弹出', removed.cards === 2 && removed.overview.length === 0 && removed.sources === 0, removed)

  await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '商机雷达')?.click(); return true })()`)
  await sleep(160)
  const radarInitial = await wc.executeJavaScript(`({ view: document.querySelector('.workspace-head h2')?.textContent, cards: document.querySelectorAll('.radar-result-item').length, checked: [...document.querySelectorAll('.radar-pick-item input')].map((input) => input.checked) })`)
  check('雷达结果也不是自动加入总览', radarInitial.cards === 1 && radarInitial.checked.length === 1 && radarInitial.checked[0] === false, radarInitial)
  const radarType = await typography(wc)
  check('雷达页可见文字没有低于 12px', radarType.count === 0, radarType)
  await wc.executeJavaScript(`document.querySelector('.radar-pick-item input')?.click()`)
  await sleep(120)
  await wc.executeJavaScript(`document.querySelector('.radar-pick-item input')?.click()`)
  await sleep(120)
  const radarAfterToggle = await wc.executeJavaScript(`({ cards: document.querySelectorAll('.radar-result-item').length, checked: document.querySelector('.radar-pick-item input')?.checked })`)
  check('雷达取消总览仍保留雷达卡', radarAfterToggle.cards === 1 && radarAfterToggle.checked === false, radarAfterToggle)

  await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '附近招标')?.click(); return true })()`)
  await sleep(160)
  await wc.executeJavaScript(`document.querySelector('.nearby-result-actions input')?.click()`)
  await sleep(130)
  await wc.executeJavaScript(`(() => { [...document.querySelectorAll('.analysis-tabs button')].find((button) => button.textContent.trim() === '总览')?.click(); return true })()`)
  await sleep(160)
  const overview = await wc.executeJavaScript(`document.querySelectorAll('.result-row').length`)
  check('总览只有明确选择的项目', overview === 1, overview)
  await wc.executeJavaScript(`(() => {
    const row = document.querySelector('.result-row');
    const transfer = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    window.__verifyTransfer = transfer;
    return true
  })()`)
  await sleep(120)
  await wc.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-bucket="compare"]');
    const transfer = window.__verifyTransfer;
    dock.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    dock.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true
  })()`)
  await sleep(240)
  const compare = await wc.executeJavaScript(`({
    bucket: JSON.parse(localStorage.getItem('shiji.managed-buckets.v1')).compare,
    view: document.querySelector('.workspace-head h2')?.textContent,
    columns: document.querySelectorAll('.compare-project-head').length,
    rows: [...document.querySelectorAll('.compare-row')].map((row) => row.textContent)
  })`)
  check('拖入对比篮生成一列、含主体金额地址与截止日期', compare.bucket.length === 1 && compare.columns === 1
    && compare.rows.some((row) => row.includes('建设单位 nearby-a'))
    && compare.rows.some((row) => row.includes('120 万'))
    && compare.rows.some((row) => row.includes('成都市武侯区'))
    && compare.rows.some((row) => row.includes('2026-10-20')), compare)
  const compareType = await typography(wc)
  check('对比页可见文字没有低于 12px', compareType.count === 0, compareType)
  await wc.executeJavaScript(`document.querySelector('.compare-risk-action')?.click()`)
  await sleep(180)
  const riskNeedsSelection = await wc.executeJavaScript(`({ view: document.querySelector('.workspace-head h2')?.textContent, selection: JSON.parse(localStorage.getItem('shiji.analysis-selection.v1') || '[]'), checked: [...document.querySelectorAll('.result-select input')].map((input) => input.checked) })`)
  check('对比栏风险入口未勾选时回总览提示选择，不自动分析', riskNeedsSelection.view === '机会总览' && riskNeedsSelection.checked.every((value) => value === false), riskNeedsSelection)
  await wc.executeJavaScript(`document.querySelector('.result-select input')?.click()`)
  await sleep(120)
  await wc.executeJavaScript(`document.querySelector('[data-bucket="compare"]')?.click()`)
  await sleep(140)
  await wc.executeJavaScript(`document.querySelector('.compare-risk-action')?.click()`)
  await sleep(180)
  const riskLoaded = await wc.executeJavaScript(`({ view: document.querySelector('.workspace-head h2')?.textContent, scope: document.querySelector('.analysis-not-started')?.textContent || '', running: document.body.textContent.includes('正在检索') })`)
  check('勾选后由对比栏进入该项目公开风险，不自动发起查询', riskLoaded.view === '企业公开风险' && riskLoaded.scope.includes('附近甲项目') && !riskLoaded.running, riskLoaded)
  await wc.executeJavaScript(`([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '附近招标'))?.click()`)
  await sleep(120)
  await wc.executeJavaScript(`document.querySelector('.nearby-result-actions input:checked')?.click()`)
  await sleep(120)
  await wc.executeJavaScript(`document.querySelector('[data-bucket="compare"]')?.click()`)
  await sleep(120)
  await wc.executeJavaScript(`document.querySelector('.compare-risk-action')?.click()`)
  await sleep(160)
  const restored = await wc.executeJavaScript(`({ view: document.querySelector('.workspace-head h2')?.textContent, resultIds: JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1')).currentResultIds, checked: [...document.querySelectorAll('.result-select input')].map((input) => input.checked) })`)
  check('对比项目不在总览时明确加入总览但不自动勾选或搜索', restored.view === '机会总览' && restored.resultIds.includes(first.id) && restored.checked.every((value) => value === false), restored)
  win.setBounds({ width: 1180, height: 850 })
  await sleep(180)
  for (const [theme, label] of [['current', '冷色'], ['warm', '暖色'], ['porcelain', '曜白']]) {
    await wc.executeJavaScript(`document.querySelector('.theme-toggle')?.click()`)
    await wc.executeJavaScript(`([...document.querySelectorAll('.theme-menu button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}))?.click()`)
    await sleep(110)
    const layout = await wc.executeJavaScript(`(() => {
      const brand = document.querySelector('.brand-mark > span').getBoundingClientRect()
      const theme = document.querySelector('.theme-picker').getBoundingClientRect()
      const form = document.querySelector('.condition-box').getBoundingClientRect()
      const panel = document.querySelector('.conversation-panel').getBoundingClientRect()
      return { theme: document.querySelector('.app-shell').dataset.theme, brandOverlap: brand.right > theme.left + 1, formOverflow: form.right > panel.right + 1 }
    })()`)
    check(`${label}主题窄窗口字号与三栏无重叠`, layout.theme === theme && !layout.brandOverlap && !layout.formOverflow && (await typography(wc)).count === 0, layout)
  }
  trace(failures.length ? `FAIL ${failures.length} checks` : 'PASS isolated discovery-to-comparison flow')
  app.exit(failures.length ? 1 : 0)
}).catch((error) => { console.error(error); app.exit(2) })
