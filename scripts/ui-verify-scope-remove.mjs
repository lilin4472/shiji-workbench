// 模块页「移出」按钮自测：点下去必须真的把项目移出本模块的分析范围。
// 运行：node_modules\electron\dist\electron.exe scripts\ui-verify-scope-remove.mjs
//
// 对应用户反馈（2026-09-18）：时间链 / 政策链 / 产业链 / 公开风险对象行上的「移出」
// 点下去像没反应项目没消失，勾选集合也没变。本脚本同时锁住三条路径：
//    正常删除（勾选集合同步变短）
//    未勾选时模块页"退回当前选中项目"的兜底对象（点「移出」必须真的移走，不能被勾回来）
//    移空之后不得再退回当前选中项目（否则移走的项目下一秒又出现）
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
  matchScore: 78, projectType: '工程改造', reason: '「移出」按钮自测数据',
  evidenceIds: [], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
})
const analysisRun = (id, moduleId, name) => ({
  opportunityId: id, moduleId, targetSubjectName: name, status: 'completed',
  updatedAt: '2026-09-18T04:00:00.000Z', message: '自测注入的完成态运行',
  actualSearchCalls: 1, actualModelCalls: 0,
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 980, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))

  const a = opportunity('verify-remove-1', '甲项目  移出验证')
  const b = opportunity('verify-remove-2', '乙项目  移出验证')
  const catalog = { version: 1, records: { [a.id]: a, [b.id]: b }, currentResultIds: [a.id, b.id], currentEvidenceIds: [], lifecycle: {} }

  const seed = async ({ view, selection, selectedId, runs = [] }) => {
    await wc.executeJavaScript(`(() => {
      localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
      localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: view, selectedOpportunityId: selectedId }))});
      localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify(selection))});
      localStorage.setItem('shiji.analysis-runs.v1', ${JSON.stringify(JSON.stringify(runs))});
      return true
    })()`)
    await wc.reload()
    await sleep(1500)
  }
  const state = () => wc.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.scope-object-list > li').length,
    cards: document.querySelectorAll('.timeline-result-card').length,
    removeLabel: document.querySelector('.scope-object-list .scope-remove')?.textContent ?? '',
    selection: localStorage.getItem('shiji.analysis-selection.v1'),
    heroTitle: document.querySelector('.analysis-not-started > section > strong')?.textContent ?? '',
    viewText: document.querySelector('.view-stage')?.innerText ?? '',
  }))()`)
  const click = async (selector) => {
    const ok = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return Boolean(el) })()`)
    await sleep(420)
    return ok
  }
  const openTab = async (label) => {
    const ok = await wc.executeJavaScript(`(() => {
      const tab = [...document.querySelectorAll('.analysis-tabs button')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
      if (tab) tab.click(); return Boolean(tab)
    })()`)
    await sleep(500)
    return ok
  }

  //   未启动页：2 个项目逐个「移出」到空 
  await seed({ view: 'timeline', selection: [a.id, b.id], selectedId: a.id })
  let s = await state()
  check('未启动页按勾选渲染 2 个对象行', s.rows === 2, `对象行=${s.rows}`)
  check('对象行上的按钮就是「移出」', s.removeLabel.includes('移出'), s.removeLabel)
  await click('.scope-object-list .scope-remove')
  s = await state()
  check('点第 1 个「移出」：对象 2  1，本机勾选集合同步变短', s.rows === 1 && s.selection === JSON.stringify([b.id]), `对象行=${s.rows} 勾选=${s.selection}`)
  await click('.scope-object-list .scope-remove')
  s = await state()
  check('点最后 1 个「移出」：对象清空（不再退回当前选中项目）', s.rows === 0, `对象行=${s.rows} 勾选=${s.selection}`)
  check('移空后模块页不再挂着那个项目名', !s.viewText.includes('甲项目') && !s.viewText.includes('乙项目'), `大标题=${s.heroTitle} 模块区=${s.viewText.slice(0, 80)}`)

  //   兜底路径：未勾选时模块页退回"当前选中项目"，此时「移出」也必须真的移出 
  await seed({ view: 'timeline', selection: [], selectedId: a.id })
  s = await state()
  check('未勾选时模块页退回当前选中项目（1 个对象行）', s.rows === 1, `对象行=${s.rows}`)
  await click('.scope-object-list .scope-remove')
  s = await state()
  check('兜底对象点「移出」也真的移出（没有被勾进分析范围）', s.rows === 0 && s.selection === '[]', `对象行=${s.rows} 勾选=${s.selection}`)

  //   已启动的结果页：结果卡随「移出」一起减 
  const runs = [analysisRun(a.id, 'timeline', a.companyName), analysisRun(b.id, 'timeline', b.companyName)]
  await seed({ view: 'timeline', selection: [a.id, b.id], selectedId: a.id, runs })
  s = await state()
  check('启动态：每个项目一张时间链结果卡（2 张）', s.cards === 2, `结果卡=${s.cards}`)
  check('启动态：对象行默认收起', s.rows === 0, `对象行=${s.rows}`)
  await click('.result-object-bar > button')
  s = await state()
  check('点「展开项目（可移出 / 清除结果）」后能看到 2 个对象行', s.rows === 2, `对象行=${s.rows}`)
  await click('.scope-object-list .scope-remove')
  s = await state()
  check('结果页点「移出」：结果卡 2  1，勾选集合同步', s.cards === 1 && s.selection === JSON.stringify([b.id]), `结果卡=${s.cards} 勾选=${s.selection}`)
  await click('.scope-object-list .scope-remove')
  s = await state()
  check('结果页移空：结果卡归零，不再退回当前选中项目', s.cards === 0 && s.rows === 0, `结果卡=${s.cards} 对象行=${s.rows} 勾选=${s.selection}`)

  //   四个模块的对象行都有「移出」，且点了立刻生效 
  for (const [view, label] of [['timeline', '时间链'], ['policy', '政策链'], ['industry', '产业链'], ['risk', '公开风险']]) {
    await seed({ view, selection: [a.id, b.id], selectedId: a.id })
    const hasButton = await wc.executeJavaScript(`Boolean(document.querySelector('.scope-object-list .scope-remove'))`)
    check(`${label}对象行有「移出」按钮`, hasButton === true)
    await click('.scope-object-list .scope-remove')
    const after = await state()
    check(`${label}点「移出」立即生效（2  1）`, after.rows === 1 && after.selection === JSON.stringify([b.id]), `对象行=${after.rows} 勾选=${after.selection}`)
  }

  //   总览「清空」后模块页同步清空 
  await seed({ view: 'overview', selection: [a.id, b.id], selectedId: a.id })
  // 注意：必须等 React 提交后再读本机存储点击同一 tick 里读到的还是旧值（第一版自测就栽在这）。
  const clicked = await wc.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.selection-bar button')].find((x) => x.textContent.includes('清空'));
    if (button) button.click(); return Boolean(button)
  })()`)
  await sleep(400)
  const stored = await wc.executeJavaScript(`localStorage.getItem('shiji.analysis-selection.v1')`)
  check('总览「清空」写入空勾选集合', clicked === true && stored === '[]', `按钮=${clicked} 之后=${stored}`)
  await openTab('时间链')
  const afterClear = await state()
  check('清空后进模块页不再退回当前选中项目', afterClear.rows === 0, `对象行=${afterClear.rows}`)

  try {
    writeFileSync(join(artifacts, 'ui-verify-scope-remove.png'), (await wc.capturePage()).toPNG())
    console.log('截图: artifacts/ui-verify-scope-remove.png')
  } catch (error) { console.log('截图失败: ' + error.message) }

  console.log('')
  console.log(failed === 0 ? '「移出」按钮自测通过：点下去真的移出，移空后不再退回当前选中项目。' : `「移出」按钮自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })