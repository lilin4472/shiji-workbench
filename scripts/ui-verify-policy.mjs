// 政策链界面自测（桩执行器，记录调用次数）：
//   ① 未启动：只显示对象行 + 启动按钮，不预渲染任何结论；
//   ② 点「启动分析」：按勾选范围每项目各一次调用；对象卡片收起；
//   ③ 结果卡：每个项目一张，含 国家 → 省 → 市 三级梯、点名下级的穿透原句、
//      带依据的预测（依据文本 + 预测/确定分开）；边界说明在卡片内。
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
  amountWan: 1280, locationAddress: '四川省成都市武侯区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '市政基础设施', reason: '政策链界面自测数据',
  evidenceIds: [], followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [
    { evidenceId: `ev-a-${id}`, stageId: 'tender', occurredAt: '2025-09-08', title: '招标公告', source: '示例公共资源交易中心' },
    { evidenceId: `ev-b-${id}`, stageId: 'tender', occurredAt: '2026-09-08', title: '招标公告', source: '示例公共资源交易中心' },
  ],
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1080, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  const a = opportunity('policy-1', '甲项目  政策链自测')
  const b = opportunity('policy-2', '乙项目  政策链自测')
  const catalog = { version: 1, records: { [a.id]: a, [b.id]: b }, currentResultIds: [a.id, b.id], currentEvidenceIds: [], lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', '[]');
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([a.id, b.id]))});
    localStorage.setItem('shiji.analysis-runs.v1', '[]');
    localStorage.setItem('shiji.policy-chain.v1', '[]');
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'policy', selectedOpportunityId: a.id }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1500)

  // ① 未启动
  const before = await wc.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('.scope-object-list > li').length,
    cards: document.querySelectorAll('.policy-result-card').length,
    levels: document.querySelectorAll('.policy-level').length,
    startDisabled: document.querySelector('button[data-module="policy"]')?.disabled ?? null,
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').length,
  }))()`)
  check('未启动只显示对象行（2 行），不预渲染任何政策结论', before.rows === 2 && before.cards === 0 && before.levels === 0, JSON.stringify(before))
  check('未启动时没有发起任何政策链调用', before.calls === 0, `调用=${before.calls}`)

  // ② 启动分析：按勾选范围批量
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="policy"]').click(); return true })()`)
  await sleep(1500)
  const afterStart = await wc.executeJavaScript(`(() => ({
    calls: (window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').map((call) => ({ id: call.input.opportunityId, industry: call.input.industry, address: call.input.address, stages: (call.input.stageDates || []).length })),
    cards: document.querySelectorAll('.policy-result-card').length,
    visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
    objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
  }))()`)
  check('按勾选范围逐个执行（2 个项目各 1 次）', afterStart.calls.length === 2 && new Set(afterStart.calls.map((call) => call.id)).size === 2, JSON.stringify(afterStart.calls))
  check('请求带上了行业、地址与本单位阶段历史（供穿透与预测用）', afterStart.calls.every((call) => call.industry && call.address && call.stages === 2), JSON.stringify(afterStart.calls.map((call) => ({ industry: call.industry, address: call.address, stages: call.stages }))))
  check('启动后对象卡片收起、结果卡按项目渲染', afterStart.visibleObjectRows === 0 && afterStart.cards === 2 && afterStart.objectBar.includes('2 个项目'), JSON.stringify({ rows: afterStart.visibleObjectRows, cards: afterStart.cards }))

  // ③ 结果卡内容
  const dom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.policy-result-card')
    return {
      levels: [...card.querySelectorAll('.policy-level')].map((level) => ({
        label: level.querySelector('header span')?.textContent ?? '',
        count: level.querySelector('header b')?.textContent ?? '',
        findings: level.querySelectorAll('.policy-finding').length,
      })),
      findings: [...card.querySelectorAll('.policy-finding')].map((finding) => ({
        kind: finding.querySelector('em')?.textContent ?? '',
        title: finding.querySelector('strong')?.textContent ?? '',
        sourceTier: finding.querySelector('i')?.textContent ?? '',
        confidence: finding.querySelector('b')?.textContent ?? '',
        meta: [...finding.querySelectorAll('.policy-finding-meta > span')].map((span) => span.textContent),
      })),
      penetrations: [...card.querySelectorAll('.policy-penetration')].map((node) => node.textContent),
      predictions: [...card.querySelectorAll('.policy-prediction')].map((node) => ({
        label: node.querySelector('strong')?.textContent ?? '',
        certainty: node.querySelector('b')?.textContent ?? '',
        window: node.querySelector('em')?.textContent ?? '',
        basis: node.querySelector('p')?.textContent ?? '',
        signals: node.querySelector('.policy-signals')?.textContent ?? '',
      })),
      boundary: card.querySelector('.policy-boundary')?.textContent ?? '',
      status: card.querySelector('header span')?.textContent ?? '',
      rerun: Boolean(card.querySelector('button.card-run')),
    }
  })()`)
  console.log(JSON.stringify(dom, null, 2))

  check('三级梯完整（国家 → 省 → 市）', dom.levels.length === 3 && dom.levels[0].label === '国家级' && dom.levels[2].label === '成都市', JSON.stringify(dom.levels.map((level) => level.label)))
  check('每级都渲染出政策/预算文件卡并标注类型', dom.levels.every((level) => level.findings === 1) && dom.findings.some((finding) => finding.kind === '预算/资金') && dom.findings.some((finding) => finding.kind === '政策文件'), JSON.stringify(dom.findings.map((finding) => finding.kind)))
  check('文件卡显示发布机关/文号/生效时间/渠道', dom.findings.every((finding) => finding.meta.length === 4 && finding.meta.join('').length > 20), JSON.stringify(dom.findings[0].meta))
  check('标注来源性质：官方原文 / 媒体转载·仅参考', dom.findings.filter((finding) => finding.sourceTier === '官方原文').length === 2 && dom.findings.filter((finding) => finding.sourceTier === '媒体转载·仅参考').length === 1, JSON.stringify(dom.findings.map((finding) => finding.sourceTier)))
  check('媒体转载不会被标成"依据完整"', dom.findings.find((finding) => finding.sourceTier === '媒体转载·仅参考')?.confidence === '线索', JSON.stringify(dom.findings.map((finding) => finding.confidence)))
  check('穿透性以"点名下级的原文"呈现（不是概括）', dom.penetrations.length === 2 && dom.penetrations.every((text) => text.includes('成都市')), JSON.stringify(dom.penetrations))
  // 2026-09-17 改版：政策链结果卡改成横向 tab（三级政策 / 政策预测），预测不再堆在长列表下面。
  const tabDom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.policy-result-card')
    const buttons = [...card.querySelectorAll('.policy-tabs button')]
    return {
      tabs: buttons.map((b) => ({ label: (b.textContent || '').replace(/[0-9]+/g, '').trim(), count: Number(b.querySelector('b')?.textContent ?? '0') })),
      active: card.querySelector('.policy-tabs button.active')?.textContent ?? '',
      ladder: Boolean(card.querySelector('.policy-ladder')),
      predictionsInline: Boolean(card.querySelector('.policy-prediction')),
      hint: card.querySelector('.policy-tab-hint')?.textContent ?? '',
      dot: Boolean(card.querySelector('.policy-tab-dot')),
    }
  })()`)
  check('结果卡是横向 tab：三级政策 / 政策预测（带计数）', tabDom.tabs.length === 2 && tabDom.tabs[0].label.includes('三级政策') && tabDom.tabs[1].label.includes('政策预测') && tabDom.tabs[1].count === 1, JSON.stringify(tabDom.tabs))
  check('默认停在「三级政策」，预测不再堆在长列表下面', tabDom.active.includes('三级政策') && tabDom.ladder && !tabDom.predictionsInline, JSON.stringify({ active: tabDom.active, ladder: tabDom.ladder, inline: tabDom.predictionsInline }))
  check('预测 tab 有提示点，且三级政策底部有跳转引导', tabDom.dot === true && tabDom.hint.includes('预测'), JSON.stringify({ dot: tabDom.dot, hint: tabDom.hint.slice(0, 40) }))
  const callsBeforeSwitch = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').length`)
  await wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.policy-tabs button')].find((el) => el.textContent.includes('政策预测')); if (b) b.click(); return true })()`)
  await sleep(400)
  dom.predictions = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.policy-result-card')
    return [...card.querySelectorAll('.policy-prediction')].map((node) => ({
      label: node.querySelector('strong')?.textContent ?? '',
      certainty: node.querySelector('b')?.textContent ?? '',
      window: node.querySelector('em')?.textContent ?? '',
      basis: node.querySelector('p')?.textContent ?? '',
      signals: node.querySelector('.policy-signals')?.textContent ?? '',
    }))
  })()`)
  const callsAfterSwitch = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').length`)
  check('切 tab 只是展示切换，不再新增检索调用', callsAfterSwitch === callsBeforeSwitch, `${callsBeforeSwitch} -> ${callsAfterSwitch}`)
  check('预测带依据文本，且与正式节点分开标记', dom.predictions.length === 1 && dom.predictions[0].basis.includes('依据') && dom.predictions[0].certainty === '预测性建议' && Boolean(dom.predictions[0].window), JSON.stringify(dom.predictions))
  check('预测给出继续观察的信号', dom.predictions[0].signals.includes('继续观察'), dom.predictions[0].signals)
  check('卡片内保留边界说明与"重新分析"入口', dom.boundary.length > 0 && dom.rerun === true && dom.status.includes('实际调用 3 次搜索'), dom.status)

// 2026-09-17 用户口径：真的检索过（含命中缓存）=成功；一次都没搜=失败。
// 状态必须在点"重新分析"之前读：点完之后，6 小时窗口内的项目会直接复用本机结果。
const statusDom = await wc.executeJavaScript(`(() => {
  const cards = [...document.querySelectorAll('.policy-result-card')]
  return cards.map((card) => card.querySelector('header span')?.textContent ?? '')
})()`)
check('真实联网的项目显示"实际调用 N 次搜索"', statusDom.some((text) => text.includes('已完成') && text.includes('实际调用 3 次搜索')), JSON.stringify(statusDom))
check('命中缓存的项目显示「检索成功 / 命中缓存 / 暂无更新」，并带数据抓取时间', statusDom.some((text) => text.includes('检索成功') && text.includes('命中缓存') && text.includes('暂无更新') && text.includes('09/17')), JSON.stringify(statusDom))

// 重新分析：6 小时内直接复用本机结果，不再重复付费
const beforeRerun = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').length`)
await wc.executeJavaScript(`(() => { document.querySelector('.policy-result-card button.card-run').click(); return true })()`)
await sleep(1200)
const afterRerun = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((call) => call.api === 'runPolicyChain').length`)
check('「重新分析」6 小时内直接复用本机结果，0 次新调用', afterRerun === beforeRerun, `新增 ${afterRerun - beforeRerun} 次`)
const reuseStatus = await wc.executeJavaScript(`document.querySelector('.policy-result-card header span')?.textContent ?? ''`)
check('复用后显示「检索成功 / 命中缓存 / 暂无更新」', reuseStatus.includes('检索成功') && reuseStatus.includes('命中缓存') && reuseStatus.includes('暂无更新'), reuseStatus)
writeFileSync(join(artifacts, 'ui-verify-policy.png'), (await wc.capturePage()).toPNG())
  console.log('截图: artifacts/ui-verify-policy.png')
  console.log('')
  console.log(failed === 0 ? '政策链界面自测通过：三级梯 / 穿透原句 / 带依据预测 / 边界与重跑。' : `政策链界面自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })
