// 公开风险界面自测（桩执行器，记录调用次数）：
//   ① 未启动：只显示对象行 + 启动按钮，不预渲染任何主体或风险；
//   ② 点「启动分析」：按勾选范围每项目各一次调用；对象卡片收起；
//   ③ 结果卡：主体基础信息卡（主体名称/机构类型/地址/代码/联系方式）+ 逐条公开风险事实卡
//      （主体名称/类别/信用事实/时间/来源）；政府/事业单位也能正常显示；
//   ④ 无风险时明确写"未取得可核验的公开风险记录"，不编造；无任何图/地图元素。
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
const opportunity = (id, title, companyName) => ({
  id, title, companyId: `company-${id}`, companyName,
  amountWan: 1280, locationAddress: '四川省成都市武侯区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '市政基础设施', reason: '公开风险界面自测数据',
  evidenceIds: [], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1080, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  const a = opportunity('risk-1', '甲项目  公开风险自测', '四川中测检测技术有限公司')
  const b = opportunity('risk-2', '乙项目  公开风险自测', '成都市武侯区住房和城乡建设局')
  const catalog = { version: 1, records: { [a.id]: a, [b.id]: b }, currentResultIds: [a.id, b.id], currentEvidenceIds: [], lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', '[]');
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([a.id, b.id]))});
    localStorage.setItem('shiji.analysis-runs.v1', '[]');
    localStorage.setItem('shiji.credit-risk.v1', '[]');
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'risk', selectedOpportunityId: a.id }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1500)

  const before = await wc.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.scope-object-list > li').length,
    cards: document.querySelectorAll('.credit-risk-card').length,
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runCreditRisk').length,
    maps: document.querySelectorAll('.tianditu-map, .react-flow').length,
  }))()`)
  check('未启动只显示对象行（2 行），不预渲染主体与风险', before.rows === 2 && before.cards === 0, JSON.stringify(before))
  check('未启动时没有发起公开风险调用', before.calls === 0, `调用=${before.calls}`)

  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="risk"]').click(); return true })()`)
  await sleep(1500)
  const afterStart = await wc.executeJavaScript(`(() => ({
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runCreditRisk').map((call) => ({ id: call.input.opportunityId, company: call.input.companyName })),
    cards: document.querySelectorAll('.credit-risk-card').length,
    visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
    objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
  }))()`)
  check('按勾选范围逐个执行（2 个项目各 1 次）', afterStart.calls.length === 2 && new Set(afterStart.calls.map((call) => call.id)).size === 2, JSON.stringify(afterStart.calls))
  check('请求带上招标单位名称', afterStart.calls.every((call) => call.company.length > 4), JSON.stringify(afterStart.calls))
  check('启动后对象卡片收起、结果卡按项目渲染', afterStart.visibleObjectRows === 0 && afterStart.cards === 2 && afterStart.objectBar.includes('2 个项目'), JSON.stringify({ rows: afterStart.visibleObjectRows, cards: afterStart.cards }))

  const dom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.credit-risk-card')
    const facts = [...card.querySelectorAll('.risk-fact-card')]
    return {
      subjectHead: [...card.querySelectorAll('.risk-subject-card dt')].map((s) => s.textContent),
      factSection: [...card.querySelectorAll('.industry-block > header > span')].map((s) => s.textContent).find((s) => s === '公开风险事实') ?? '',
      subjectCells: [...card.querySelectorAll('.risk-subject-card dd')].map((s) => s.textContent),
      subjectTip: card.querySelector('.risk-subject-name')?.textContent ?? '',
      facts: facts.map((row) => ({
        name: row.querySelector('strong')?.textContent?.trim() ?? '',
        category: row.querySelector('.risk-category')?.textContent?.trim() ?? '',
        reason: row.querySelector('p')?.textContent?.trim() ?? '',
        date: row.querySelector('time')?.textContent?.trim() ?? '',
        source: row.querySelector('footer a, footer em')?.textContent?.trim() ?? '',
      })),
      chip: card.querySelector('header > em')?.textContent ?? '',
      gaps: [...card.querySelectorAll('.policy-gaps li')].map((n) => n.textContent),
      boundary: card.querySelector('.policy-boundary')?.textContent ?? '',
      maps: card.querySelectorAll('.tianditu-map, .react-flow, .industry-graph').length,
      status: card.querySelector('header span')?.textContent ?? '',
    }
  })()`)
  console.log(JSON.stringify(dom, null, 2).slice(0, 1100))

  check('主体信息卡四项必显：统一社会信用代码/法人/地址/联系方式', dom.subjectHead.join('|') === '统一社会信用代码|法人|地址|联系方式', JSON.stringify(dom.subjectHead))
  check('风险事实区明确单独呈现', dom.factSection === '公开风险事实', dom.factSection)
  check('主体卡显示代码、法人、地址、电话（都不隐藏）', dom.subjectCells.join('|').includes('91510100MA6XXXXX1A') && dom.subjectCells.join('|').includes('王强') && dom.subjectCells.join('|').includes('武侯区') && dom.subjectCells.join('|').includes('028-86001234'), JSON.stringify(dom.subjectCells))
  check('主体名旁显示机构类型与行业', dom.subjectTip.includes('企业') && dom.subjectTip.includes('检验检测'), dom.subjectTip)
  check('风险事实卡都有主体、类别、事由、时间、来源', dom.facts.length >= 2 && dom.facts.every((fact) => fact.name && fact.category && fact.reason && fact.date && fact.source), JSON.stringify(dom.facts))
  check('事由写得清楚且简洁（≤140 字，含时间/地点/结果）', dom.facts.every((fact) => fact.reason.length <= 140 && fact.reason.length >= 4), JSON.stringify(dom.facts.map((fact) => fact.reason.length)))
  check('顶部标记风险条数', dom.chip.includes('风险事实'), dom.chip)
  check('显示缺口与边界说明', dom.gaps.length > 0 && dom.boundary.includes('不等于') , JSON.stringify({ gaps: dom.gaps.length }))
  check('结果卡内没有图元素', dom.maps === 0, String(dom.maps))

  // ④ 无风险主体：第二张卡是政府机关，桩里给 0 条事实 → 应显示"未取得可核验的公开风险记录"
  const second = await wc.executeJavaScript(`(() => {
    const card = document.querySelectorAll('.credit-risk-card')[1]
    return {
      empty: card?.querySelector('.industry-empty')?.textContent ?? '',
      chip: card?.querySelector('header > em')?.textContent ?? '',
      subjectCells: [...(card?.querySelectorAll('.risk-subject-card dd') ?? [])].map((s) => s.textContent),
      subjectName: card?.querySelector('.risk-subject-name')?.textContent ?? '',
    }
  })()`)
  check('政府机关主体也能正常出卡（不是企业也受理）', second.subjectName.includes('政府机关') && second.subjectCells.join('|').includes('1151010'), JSON.stringify({ name: second.subjectName, cells: second.subjectCells }))
  check('无风险时明确写"未取得可核验的公开风险记录"', second.empty.includes('未取得可核验的公开风险记录') && second.chip.includes('未发现'), JSON.stringify({ empty: second.empty, chip: second.chip }))

  const beforeRerun = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runCreditRisk').length`)
  await wc.executeJavaScript(`(() => { document.querySelector('.credit-risk-card button.card-run').click(); return true })()`)
  await sleep(1200)
  const afterRerun = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runCreditRisk').length`)
  check('「重新分析」6 小时内直接复用本机结果，0 次新调用', afterRerun === beforeRerun, `新增 ${afterRerun - beforeRerun} 次`)
  const cachedStatus = await wc.executeJavaScript(`document.querySelector('.credit-risk-card header span')?.textContent ?? ''`)
  check('复用后显示「检索成功 / 命中缓存 / 暂无更新」', cachedStatus.includes('检索成功') && cachedStatus.includes('命中缓存') && cachedStatus.includes('暂无更新'), cachedStatus)

  // 2026-09-17 用户复核："前端显示了没有？"  直接在真实前端 DOM 上断言入口与两个按钮。
const barDom = await wc.executeJavaScript(`(() => {
  const bar = document.querySelector('.credit-risk-view .result-object-bar')
  const toggle = bar?.querySelector('button')
  return {
    text: (toggle?.textContent ?? '').trim(),
    removeVisible: !!document.querySelector('.credit-risk-view .scope-remove'),
    clearVisible: !!document.querySelector('.credit-risk-view .scope-clear'),
  }
})()`)
check('前端展开按钮写着"可移出 / 清除结果"（未展开时按钮不可见）', barDom.text.includes('可移出') && barDom.text.includes('清除结果') && !barDom.removeVisible && !barDom.clearVisible, JSON.stringify(barDom))
await wc.executeJavaScript(`(() => { const b = document.querySelector('.credit-risk-view .result-object-bar button'); if (b) b.click(); return true })()`)
await sleep(400)
const openDom = await wc.executeJavaScript(`(() => ({
  remove: (document.querySelector('.credit-risk-view .scope-remove')?.textContent ?? '').trim(),
  clear: (document.querySelector('.credit-risk-view .scope-clear')?.textContent ?? '').trim(),
}))()`)
check('展开后前端确实出现「移出」「清除结果」两个按钮', openDom.remove === '移出' && openDom.clear === '清除结果', JSON.stringify(openDom))
writeFileSync(join(artifacts, 'ui-verify-risk.png'), (await wc.capturePage()).toPNG())
  console.log('截图: artifacts/ui-verify-risk.png')
  console.log('')
  console.log(failed === 0 ? '公开风险界面自测通过：主体信息卡 + 风险事实卡 + 政府/事业单位同样受理 + 无风险明确标注。' : `公开风险界面自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })
