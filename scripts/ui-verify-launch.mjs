// 第 4 步界面自测：模块「启动分析」+ 项目载荷卡（对象+证据+字段，可点详情）
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
// 夹具必须满足 shared/evidence-contract.ts 的 isEvidenceRecord：
// 曾经这里写的是"看起来像证据"的字段（source/reliability/label），
// 结果被 loadSearchEvidence 全部过滤掉，自测变成"0 条证据也通过"的空验证。
// 现在严格按契约构造：subject / artifact / provenance / assessment(assessed 需 claimType+grade+permittedUses+assessedAt)
// / opportunityDetails。同时补 timelineEvidence，让载荷卡有真实阶段来源。
const opportunity = (id, title) => ({
  id, title, companyId: `company-${id}`, companyName: `验证主体 ${id}`,
  amountWan: 500, locationAddress: '成都市高新区示例路 1 号', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '工程改造', reason: '第 4 步界面自测数据',
  evidenceIds: [`ev-${id}`], followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [{ evidenceId: `ev-${id}`, stageId: 'tender', occurredAt: '2026-09-16', title: '招标公告', source: '示例公共资源交易中心' }],
})
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
    status: 'assessed',
    claimType: 'project-stage',
    grade: 'A',
    permittedUses: ['discovery', 'report-candidate', 'stage-confirmation'],
    reasons: ['原始发布单位、项目编号与原文链接完整。'],
    missingChecks: [],
    assessedAt: '2026-09-16T08:05:00.000Z',
  },
  opportunityDetails: {
    companyCandidates: [`验证主体 ${id}`], amountWanCandidates: [500], stageIds: ['tender'],
    deadlineCandidates: ['2026-10-15'], addressCandidates: ['成都市高新区示例路 1 号'],
    agencyCandidates: ['示例招标代理有限公司'], lotCandidates: ['一标段'], scopeCandidates: ['弱电智能化改造'],
    qualificationCandidates: ['电子与智能化工程专业承包二级'], depositCandidates: ['2 万元'],
    openingTimeCandidates: ['2026-10-15 09:30'], contactCandidates: [], attachmentCandidates: [],
  },
})

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 980, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))

  const a = opportunity('verify-launch-1', '甲项目  启动分析验证')
  const b = opportunity('verify-launch-2', '乙项目  启动分析验证')
  const c = opportunity('verify-launch-3', '丙项目  启动分析验证')
  const d = opportunity('verify-launch-4', '丁项目  启动分析验证')
  const selected = [a, b, c, d]
  const catalog = { version: 1, records: Object.fromEntries(selected.map((item) => [item.id, item])), currentResultIds: selected.map((item) => item.id), currentEvidenceIds: selected.map((item) => `ev-${item.id}`), lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', ${JSON.stringify(JSON.stringify(selected.map((item) => evidence(`ev-${item.id}`))))});
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify(selected.map((item) => item.id)))});
    localStorage.setItem('shiji.analysis-runs.v1', '[]');
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'timeline' }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1600)

  check('未启动时不渲染链条图', (await wc.executeJavaScript(`document.querySelectorAll('.time-node').length`)) === 0)
  // 用户口径（2026-09-16 修正）：项目进入模块只带"够用的引用"，不做复杂卡片、不铺项目字段。
  const rows = await wc.executeJavaScript(`document.querySelectorAll('.scope-object-list > li').length`)
  check('超过旧上限时，对象行仍按勾选数量渲染（4 行）', rows === 4, `行数=${rows}`)
  check('多项目分析页不显示单项目顶部卡片', (await wc.executeJavaScript(`document.querySelectorAll('.workspace-context').length`)) === 0)
  check('多项目未启动标题显示项目数量', (await wc.executeJavaScript(`document.querySelector('.analysis-not-started > section > strong')?.textContent`)) === '4 个项目待分析')
  const timelineSubtitle = await wc.executeJavaScript(`(() => ({ text: document.querySelector('.workspace-head p')?.textContent ?? '', size: getComputedStyle(document.querySelector('.workspace-head p')).fontSize }))()`)
  check('时间链说明保留原意且六模块说明字号增大', timelineSubtitle.text === '判断项目现在走到哪里、下一节点何时出现' && ['12px', '13px'].includes(timelineSubtitle.size), JSON.stringify(timelineSubtitle))
  const rowText = await wc.executeJavaScript(`document.querySelector('.scope-object-list > li')?.textContent ?? ''`)
  check('对象行只带够用的引用（名字/主体/阶段/证据条数）', ['甲项目', '验证主体 verify-launch-1', '招标公告', '1 条本机证据'].every((text) => rowText.includes(text)), rowText.slice(0, 140))
  const leakedFields = await wc.executeJavaScript(`['代理机构','标段','招标范围','投标资格','保证金'].some((label) => (document.querySelector('.analysis-not-started')?.textContent ?? '').includes(label))`)
  check('不再把项目字段铺进模块（无复杂载荷卡）', leakedFields === false && (await wc.executeJavaScript(`document.querySelectorAll('.scope-card, .scope-fields').length`)) === 0)

  await wc.executeJavaScript(`(() => { document.querySelector('.scope-object-list .scope-title').click(); return true })()`)
  await sleep(600)
  const detailOpen = await wc.executeJavaScript(`Boolean(document.querySelector('.nearby-detail-report'))`)
  check('点击项目名打开完整招标报告', detailOpen === true, String(detailOpen))
  const detailText = await wc.executeJavaScript(`document.querySelector('.nearby-detail-report')?.textContent ?? ''`)
  check('详情报告带出本机已提取字段与证据链', detailText.includes('示例招标代理有限公司') && detailText.includes('证据链'), detailText.slice(0, 160))
  await wc.executeJavaScript(`(() => { const b = document.querySelector('.nearby-detail-back'); if (b) b.click(); return true })()`)
  await sleep(400)

  const launchEnabled = await wc.executeJavaScript(`(() => { const b = document.querySelector('button[data-module="timeline"]'); return b ? !b.disabled : false })()`)
  check('时间链「启动分析」可用', launchEnabled === true)
  await wc.executeJavaScript(`(() => {
    const original = window.shijiDesktop.search.discoverProjectTimeline
    window.__originalTimelineApi = original
    window.__timelineActivityRelease = undefined
    window.shijiDesktop.search.discoverProjectTimeline = (...args) => {
      window.__verifyCalls.push({ api: 'discoverProjectTimeline', args })
      return new Promise((resolve) => { window.__timelineActivityRelease = () => resolve({ ok: false, message: '界面状态自测结束' }) })
    }
    return true
  })()`)
  // Hold the first API response so the global indicator is observable.
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="timeline"]').click(); return true })()`)
  await sleep(250)
  const timelineActivity = await wc.executeJavaScript(`(() => ({ text: document.querySelector('.global-activity')?.textContent ?? '', progress: document.querySelector('.global-activity [role="progressbar"]')?.getAttribute('aria-valuetext') }))()`)
  check('时间链任务运行时显示全局进度提示且不伪造百分比', timelineActivity.text.includes('时间链') && timelineActivity.progress === '处理中', JSON.stringify(timelineActivity))
  await wc.executeJavaScript(`(() => {
    window.shijiDesktop.search.discoverProjectTimeline = window.__originalTimelineApi
    window.__timelineActivityRelease?.()
    window.__timelineActivityRelease = undefined
    return true
  })()`)
  await sleep(900)
  const calls = await wc.executeJavaScript(`(window.__verifyCalls || []).filter((c) => c.api === 'discoverProjectTimeline').length`)
  check('超过旧上限时，仍按全部勾选范围执行（4 次）', calls === 4, `调用次数=${calls}`)
  check('启动后切换到时间链结果区', (await wc.executeJavaScript(`Boolean(document.querySelector('.timeline-view'))`)) === true)
  // 用户口径：点「启动分析」后项目对象卡片收起，改以本模块结果卡片呈现。
  const resultView = await wc.executeJavaScript(`(() => ({
    objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
    objectRowsVisible: document.querySelectorAll('.scope-object-list > li').length,
    resultCards: document.querySelectorAll('.timeline-result-card').length,
    nodeCounts: [...document.querySelectorAll('.timeline-result-card')].map((card) => card.querySelectorAll('.time-node').length),
    cardTitles: [...document.querySelectorAll('.timeline-result-card > header strong')].map((el) => el.textContent),
    runButtons: document.querySelectorAll('.timeline-result-card button.card-run').length,
    statuses: [...document.querySelectorAll('.timeline-result-card > header span')].map((el) => el.textContent),
  }))()`)
  check('启动后项目对象卡片收起（默认不展开）', resultView.objectRowsVisible === 0 && resultView.objectBar.includes('4 个项目'), `可见对象行=${resultView.objectRowsVisible} 对象条=${resultView.objectBar.slice(0, 40)}`)
  check('每个项目一张时间链结果卡（4 张）', resultView.resultCards === 4, `结果卡=${resultView.resultCards}`)
  check('每张结果卡都带该项目的七阶段节点链', resultView.nodeCounts.every((count) => count === 7), JSON.stringify(resultView.nodeCounts))
  check('结果卡标出运行状态与重新分析入口', resultView.statuses.every((text) => text.includes('实际调用')) && resultView.runButtons === 4, JSON.stringify(resultView.statuses))

  await wc.executeJavaScript(`(() => { const tab = [...document.querySelectorAll('.analysis-tabs button')].find((b) => b.textContent.includes('政策链')); if (tab) tab.click(); return true })()`)
  await sleep(400)
  const moduleDescriptions = await wc.executeJavaScript(`(async () => {
    const descriptions = {}
    for (const [label, key] of [['政策链', 'policy'], ['产业链', 'industry'], ['公开风险', 'risk'], ['获客', 'leads'], ['行动', 'actions'], ['政策链', 'policy']]) {
      const tab = [...document.querySelectorAll('.analysis-tabs button')].find((button) => button.textContent.includes(label))
      tab?.click()
      await new Promise((resolve) => setTimeout(resolve, 80))
      const subtitle = document.querySelector('.workspace-head p')
      descriptions[key] = { text: subtitle?.textContent ?? '', size: subtitle ? getComputedStyle(subtitle).fontSize : '' }
    }
    return descriptions
  })()`)
  check('政策链说明突出逐级预测下一项目与跨区域机会', moduleDescriptions.policy.text.includes('国家、省、市各级政策') && moduleDescriptions.policy.text.includes('跨区域') && ['12px', '13px'].includes(moduleDescriptions.policy.size), JSON.stringify(moduleDescriptions.policy))
  check('产业链说明突出集团、供应合作链及上下游', moduleDescriptions.industry.text.includes('集团组织') && moduleDescriptions.industry.text.includes('上游供方') && moduleDescriptions.industry.text.includes('下游客户') && ['12px', '13px'].includes(moduleDescriptions.industry.size), JSON.stringify(moduleDescriptions.industry))
  check('公开风险说明覆盖工商、处罚、经营异常与信用线索', moduleDescriptions.risk.text.includes('工商登记') && moduleDescriptions.risk.text.includes('行政处罚') && moduleDescriptions.risk.text.includes('经营异常') && moduleDescriptions.risk.text.includes('公开信用'), JSON.stringify(moduleDescriptions.risk))
  check('获客说明覆盖产业链、客户供应商及公开联系信息', moduleDescriptions.leads.text.includes('从产业链') && moduleDescriptions.leads.text.includes('客户与供应商') && moduleDescriptions.leads.text.includes('依法依规') && moduleDescriptions.leads.text.includes('联系方式'), JSON.stringify(moduleDescriptions.leads))
  check('行动说明明确依托前序沉淀并帮助执行落地', moduleDescriptions.actions.text.includes('前序模块') && moduleDescriptions.actions.text.includes('商务对接') && moduleDescriptions.actions.text.includes('落地行动'), JSON.stringify(moduleDescriptions.actions))
  const policyEnabled = await wc.executeJavaScript(`(() => { const b = document.querySelector('button[data-module="policy"]'); return b ? !b.disabled : null })()`)
  check('政策链已接入真实执行器：按钮可用且显示 4 个项目对象行', policyEnabled === true && (await wc.executeJavaScript(`document.querySelectorAll('.scope-object-list > li').length`)) === 4, String(policyEnabled))

  await wc.executeJavaScript(`(() => { localStorage.setItem('shiji.workspace.v3', JSON.stringify({ activeView: 'nearby' })); return true })()`)
  await wc.reload()
  await sleep(1200)
  check('附近招标结果卡提供总览、详情、归档、忽略、删除操作', await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.tender-nearby-list article')
    return Boolean(card && card.querySelector('[data-action="toggle-overview"]') && card.querySelector('[data-action="open-details"]') && card.querySelector('[data-action="archive"]') && card.querySelector('[data-action="ignore"]') && card.querySelector('[data-action="delete"]'))
  })()`))
  check('附近搜索结果已在总览时显示勾选状态', await wc.executeJavaScript(`document.querySelector('.tender-nearby-list [data-action="toggle-overview"] input')?.checked === true`))
  try { writeFileSync(join(artifacts, 'ui-verify-nearby-actions.png'), (await wc.capturePage()).toPNG()); console.log('附近操作卡截图: artifacts/ui-verify-nearby-actions.png') } catch (error) { console.log('附近操作卡截图失败: ' + error.message) }
  await wc.executeJavaScript(`(() => { document.querySelector('.tender-nearby-list [data-action="toggle-overview"] input').click(); return true })()`)
  await sleep(350)
  const afterOverviewRemoval = await wc.executeJavaScript(`JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1')).currentResultIds`)
  check('取消附近结果的总览勾选只移出当前列表', !afterOverviewRemoval.includes('verify-launch-1') && (await wc.executeJavaScript(`document.querySelectorAll('.tender-nearby-list article').length`)) === 3, JSON.stringify(afterOverviewRemoval))
  await wc.executeJavaScript(`(() => { document.querySelector('.tender-nearby-list article [data-action="open-details"]').click(); return true })()`)
  await sleep(300)
  check('附近卡片详情入口打开完整招标报告', await wc.executeJavaScript(`Boolean(document.querySelector('.nearby-detail-report'))`))
  await wc.executeJavaScript(`(() => { document.querySelector('.nearby-detail-back')?.click(); return true })()`)
  await sleep(250)
  await wc.executeJavaScript(`(() => { document.querySelector('.tender-nearby-list article [data-action="archive"]').click(); return true })()`)
  await sleep(350)
  const afterArchive = await wc.executeJavaScript(`JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1'))`)
  check('归档将附近结果写入本机项目库并从当前列表移除', afterArchive.lifecycle['verify-launch-2']?.status === 'archived' && (await wc.executeJavaScript(`document.querySelectorAll('.tender-nearby-list article').length`)) === 2, JSON.stringify({ lifecycle: afterArchive.lifecycle['verify-launch-2'], renderedCards: await wc.executeJavaScript(`document.querySelectorAll('.tender-nearby-list article').length`) }))
  await wc.executeJavaScript(`(() => { document.querySelector('.tender-nearby-list article [data-action="ignore"]').click(); return true })()`)
  await sleep(350)
  const afterIgnore = await wc.executeJavaScript(`JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1'))`)
  check('忽略将附近结果标记为不感兴趣并从当前列表移除', afterIgnore.lifecycle['verify-launch-3']?.status === 'ignored' && (await wc.executeJavaScript(`document.querySelectorAll('.tender-nearby-list article').length`)) === 1, JSON.stringify({ lifecycle: afterIgnore.lifecycle['verify-launch-3'], renderedCards: await wc.executeJavaScript(`document.querySelectorAll('.tender-nearby-list article').length`) }))
  await wc.executeJavaScript(`(() => { document.querySelector('.tender-nearby-list article [data-action="delete"]').click(); return true })()`)
  await sleep(200)
  check('删除附近结果先要求确认', await wc.executeJavaScript(`Boolean(document.querySelector('.delete-opportunity-overlay'))`))
  await wc.executeJavaScript(`(() => { document.querySelector('.delete-opportunity-overlay button.danger').click(); return true })()`)
  await sleep(350)
  const afterDelete = await wc.executeJavaScript(`JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1'))`)
  check('确认删除后清除本机项目记录', !afterDelete.records['verify-launch-4'] && !afterDelete.currentResultIds.includes('verify-launch-4'))

  // 复现：附近搜索没有结构化项目时，旧实现把本机所有历史来源都塞进右侧，
  // 且来源卡没有任何从当前列表移出的入口。
  const liveSource = { ...evidence('ev-m101-live'), title: '轨道交通M101线一期工程机电系统设备安装监理项目监理招标公告' }
  const staleSource = { ...evidence('ev-m101-stale'), title: liveSource.title }
  const sourceOnlyCatalog = { version: 1, records: {}, currentResultIds: [], currentEvidenceIds: [liveSource.id], lifecycle: {} }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(sourceOnlyCatalog))});
    localStorage.setItem('shiji.search-evidence.v2', ${JSON.stringify(JSON.stringify([liveSource, staleSource]))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'nearby' }))});
    return true
  })()`)
  await wc.reload()
  await sleep(900)
  const nearbySources = await wc.executeJavaScript(`({ count: document.querySelectorAll('.discovery-evidence-card').length, title: document.querySelector('.discovery-evidence-card')?.textContent ?? '', actions: document.querySelector('.discovery-evidence-card [data-action="remove-evidence"]')?.textContent ?? '' })`)
  check('附近无项目卡时只展示本次来源，不把历史重复来源混入右侧', nearbySources.count === 1 && nearbySources.title.includes('轨道交通M101线一期工程机电系统设备安装监理项目监理招标公告'), JSON.stringify(nearbySources))
  check('原始来源线索提供“移出本次”操作', nearbySources.actions.includes('移出本次'), JSON.stringify(nearbySources))
  await wc.executeJavaScript(`document.querySelector('.discovery-evidence-card [data-action="remove-evidence"]')?.click()`)
  await sleep(350)
  const sourceRemoval = await wc.executeJavaScript(`({ cards: document.querySelectorAll('.discovery-evidence-card').length, currentIds: JSON.parse(localStorage.getItem('shiji.opportunity-catalog.v1')).currentEvidenceIds, cacheHasRecord: JSON.parse(localStorage.getItem('shiji.search-evidence.v2')).some((item) => item.id === 'ev-m101-live') })`)
  check('移出来源只清理本次列表，原始证据仍保存在本机', sourceRemoval.cards === 0 && !sourceRemoval.currentIds.includes('ev-m101-live') && sourceRemoval.cacheHasRecord, JSON.stringify(sourceRemoval))

  await wc.executeJavaScript(`(() => {
    window.__resolvePendingAgentRun = undefined
    window.shijiDesktop.agent.run = () => new Promise((resolve) => { window.__resolvePendingAgentRun = resolve })
    document.querySelector('.composer-foot button').click()
    return true
  })()`)
  await sleep(250)
  const freeRunState = await wc.executeJavaScript(`(() => {
    const condition = document.querySelector('.condition-run')
    const composer = document.querySelector('.composer-foot button')
    return { conditionText: condition?.textContent?.trim(), conditionDisabled: condition?.disabled, conditionBusy: condition?.getAttribute('aria-busy'), conditionClass: condition?.className, composerText: composer?.textContent?.trim(), activityText: document.querySelector('.global-activity')?.textContent ?? '' }
  })()`)
  check('自由搜索运行时，条件按钮保持自身静态状态并说明被互斥', freeRunState.conditionText === '按以上条件运行' && freeRunState.conditionDisabled && freeRunState.conditionBusy === 'false' && freeRunState.conditionClass.includes('blocked-by-other-route') && (await wc.executeJavaScript(`document.querySelector('.condition-run-row > small')?.textContent.includes('自由搜索正在运行')`)), JSON.stringify(freeRunState))
  check('全局自由搜索期间，提示可见并标明当前搜索路由', (freeRunState.activityText.includes('附近招标') || freeRunState.activityText.includes('商机雷达')) && freeRunState.activityText.includes('自由搜索'), JSON.stringify(freeRunState))
  await wc.executeJavaScript(`window.__resolvePendingAgentRun({ ok: false, error: { code: 'RUNTIME_ERROR', message: '界面状态自测结束' } })`)
  await sleep(350)
  check('搜索任务结束后全局提示自动收起', (await wc.executeJavaScript(`document.querySelector('.global-activity') === null`)) === true)
  await wc.executeJavaScript(`(() => {
    window.__resolvePendingAgentRun = undefined
    document.querySelector('.condition-run').click()
    return true
  })()`)
  await sleep(250)
  const conditionRunState = await wc.executeJavaScript(`(() => {
    const condition = document.querySelector('.condition-run')
    const composer = document.querySelector('.composer-foot button')
    return { conditionText: condition?.textContent?.trim(), conditionDisabled: condition?.disabled, conditionBusy: condition?.getAttribute('aria-busy'), composerText: composer?.textContent?.trim(), composerDisabled: composer?.disabled }
  })()`)
  check('条件搜索运行时，仅条件入口显示运行态，自由入口不冒充停止按钮', conditionRunState.conditionText === '停止条件搜索' && !conditionRunState.conditionDisabled && conditionRunState.conditionBusy === 'true' && conditionRunState.composerText === '运行' && conditionRunState.composerDisabled, JSON.stringify(conditionRunState))
  await wc.executeJavaScript(`window.__resolvePendingAgentRun({ ok: false, error: { code: 'RUNTIME_ERROR', message: '界面状态自测结束' } })`)
  await sleep(350)

  try { writeFileSync(join(artifacts, 'ui-verify-launch.png'), (await wc.capturePage()).toPNG()); console.log('截图: artifacts/ui-verify-launch.png') } catch (error) { console.log('截图失败: ' + error.message) }
  console.log('')
  console.log(failed === 0 ? '界面自测通过：多项目分析范围、附近招标生命周期，以及自由/条件搜索运行状态隔离。' : `界面自测失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('E2E 运行异常:', error); app.exit(2) })
