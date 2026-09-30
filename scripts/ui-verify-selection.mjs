// 第 3 步界面自测：总览复选框  模块分析范围（本机持久化）
// 运行：node_modules\electron\dist\electron.exe scripts\ui-verify-selection.mjs
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
  amountWan: 320, locationAddress: null, distanceKm: null, deadline: '2026-10-01',
  matchScore: 78, projectType: '工程改造', reason: '第 3 步界面自测数据',
  evidenceIds: [], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 980, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))

  const first = opportunity('verify-sel-1', '甲项目  复选框验证')
  const second = opportunity('verify-sel-2', '乙项目  复选框验证')
  const catalog = { version: 1, records: { [first.id]: first, [second.id]: second }, currentResultIds: [first.id, second.id], currentEvidenceIds: [], lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'overview' }))});
    localStorage.setItem('shiji.analysis-selection.v1', '[]');
    return true
  })()`)
  await wc.reload()
  await sleep(1500)

  const cards = await wc.executeJavaScript(`document.querySelectorAll('.result-row').length`)
  check('总览渲染 2 张结果卡', cards === 2, `卡片数=${cards}`)
  const boxes = await wc.executeJavaScript(`document.querySelectorAll('.result-select input').length`)
  check('每张卡片都有复选框', boxes === 2, `复选框数=${boxes}`)
  const barText = await wc.executeJavaScript(`document.querySelector('.selection-bar')?.textContent ?? ''`)
  check('出现"已选 N / M"选择条', barText.includes('已选') && barText.includes('全选') && barText.includes('清空'), barText)

  await wc.executeJavaScript(`(() => { document.querySelectorAll('.result-select input')[0].click(); return true })()`)
  await sleep(250)
  const stored1 = await wc.executeJavaScript(`localStorage.getItem('shiji.analysis-selection.v1')`)
  const count1 = await wc.executeJavaScript(`document.querySelector('.selection-bar b')?.textContent ?? ''`)
  check('勾选第 1 个项目  本机保存 1 个 id', String(stored1).includes('verify-sel-1') && !String(stored1).includes('verify-sel-2'), String(stored1))
  check('选择条计数 = 1', count1.trim() === '1', String(count1))

  await wc.executeJavaScript(`(() => { [...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('全选')).click(); return true })()`)
  await sleep(250)
  const stored2 = await wc.executeJavaScript(`localStorage.getItem('shiji.analysis-selection.v1')`)
  check('点击全选  2 个 id', String(stored2).includes('verify-sel-1') && String(stored2).includes('verify-sel-2'), String(stored2))

  await wc.executeJavaScript(`(() => { [...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent.includes('清空')).click(); return true })()`)
  await sleep(250)
  const stored3 = await wc.executeJavaScript(`localStorage.getItem('shiji.analysis-selection.v1')`)
  check('点击清空  0 个 id', String(stored3) === '[]', String(stored3))

  await wc.executeJavaScript(`(() => { document.querySelectorAll('.result-select input')[1].click(); return true })()`)
  await sleep(200)
  await wc.reload()
  await sleep(1200)
  const checked = await wc.executeJavaScript(`[...document.querySelectorAll('.result-select input')].map((i) => i.checked)`)
  check('刷新后勾选状态保持（第二个被勾选）', Array.isArray(checked) && checked[1] === true, JSON.stringify(checked))

  try {
    const image = await wc.capturePage()
    writeFileSync(join(artifacts, 'ui-verify-selection.png'), image.toPNG())
    console.log('截图: artifacts/ui-verify-selection.png')
  } catch (error) { console.log('截图失败: ' + error.message) }

  console.log('')
  console.log(failed === 0 ? '第 3 步界面自测通过：复选框  分析范围  本机持久化 端到端可用。' : `第 3 步界面自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })