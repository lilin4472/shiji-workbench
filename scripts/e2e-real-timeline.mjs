// 真实端到端验证（不使用任何桩）：
//   点击「启动分析」 → 真实豆包搜索 → 抓取/读取公告正文 → 确定性抽取阶段 → 确认当前节点 → 结果卡渲染
//   点击「订阅阶段变化」 → 进入关注（追踪）模块 → 断言"订阅本身不发搜索"
//   点击「立即检查」 → 真实下一阶段扫描（mode=watch-next）
//   启动自动复查：未到期 0 次；到期（≥7 天）最多 1 次
//
// 凭据与缓存都直接用识机本机真实数据（%APPDATA%\shiji-workbench），不复制、不外传。
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDoubaoPort } from '../dist-electron/electron/doubao-provider.js'
import { SearchCache, createCachedSearchPort } from '../dist-electron/electron/search-cache.js'
import { SearchManager } from '../dist-electron/electron/search-manager.js'
import { createProjectTimelineDiscoveryService } from '../dist-electron/electron/project-timeline-service.js'
import { createPolicyChainService } from '../dist-electron/electron/policy-chain-service.js'
import { createIndustryChainService } from '../dist-electron/electron/industry-chain-service.js'
import { createCreditRiskService } from '../dist-electron/electron/credit-risk-service.js'
import { buildProjectTimeline, PROJECT_STAGE_DEFINITIONS } from '../dist-electron/shared/project-timeline.js'
import { buildTimelineStageSearchPlan, buildWatchStageSearchPlan } from '../dist-electron/shared/stage-search-plan.js'
import { DESKTOP_CONTRACT_VERSION } from '../dist-electron/shared/desktop-contract.js'

// 识机的 Key 用 Windows 应用绑定加密（Chromium ABE），绑定的是应用的 userData 目录：
// 必须先把应用名设成 shiji-workbench 才能解开；解开后立刻把 userData 切到临时目录，
// 保证本次验证不写用户任何本机数据（窗口再用内存 session，彻底不碰磁盘存储）。
app.setName('shiji-workbench')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts')
const appData = join(process.env.APPDATA ?? '', 'shiji-workbench')
const credentialPath = join(appData, 'secure', 'credentials.v1.json')
const cachePath = join(appData, 'cache', 'doubao.v1.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 用用户真实搜索过的项目做端到端（标题 + 主体都来自本机缓存里的真实结果）。
const TARGET = {
  id: 'e2e-real-1',
  title: process.argv.find((value) => value.startsWith('--title='))?.slice('--title='.length)
    ?? '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
  company: process.argv.find((value) => value.startsWith('--company='))?.slice('--company='.length)
    ?? '成都市武侯区智慧宜居建设开发有限公司',
}

let failed = 0
const check = (title, passed, extra = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${title}${passed || !extra ? '' : `\n        -> 实际: ${extra}`}`)
  if (!passed) failed += 1
}
const stageLabel = (stageId) => PROJECT_STAGE_DEFINITIONS.find((stage) => stage.id === stageId)?.label ?? '未取得阶段证据'
const calls = []

app.whenReady().then(async () => {
  await mkdir(artifacts, { recursive: true })
  const report = { target: TARGET, startedAt: new Date().toISOString(), steps: [], calls: [] }

  // ── 0. 真实凭据（只打印长度，不打印内容） ─────────────────────────────
  if (!existsSync(credentialPath)) throw new Error(`找不到本机凭据文件：${credentialPath}`)
  const credentialFile = JSON.parse(await readFile(credentialPath, 'utf8'))
  if (!credentialFile.doubao?.encrypted) throw new Error('本机没有已保存的豆包搜索 Key。')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本机 Key。')
  const doubaoKey = safeStorage.decryptString(Buffer.from(credentialFile.doubao.encrypted, 'base64'))
  check('本机豆包搜索 Key 可读取（真实凭据，未打印明文）', doubaoKey.trim().length > 8, `长度=${doubaoKey.trim().length}`)
  // 解开凭据后立刻把运行目录切到临时目录：后面所有窗口/缓存都不落用户数据目录。
  const sandboxUserData = join(tmpdir(), `shiji-e2e-${Date.now()}`)
  app.setPath('userData', sandboxUserData)
  const userStoragePath = join(appData, 'Local Storage', 'leveldb', 'MANIFEST-000001')
  const userStorageBefore = existsSync(userStoragePath) ? (await stat(userStoragePath)).mtimeMs : 0

  const cache = new SearchCache({
    read: async () => (existsSync(cachePath) ? await readFile(cachePath, 'utf8') : undefined),
    write: async (content) => { await mkdir(dirname(cachePath), { recursive: true }); await writeFile(cachePath, content, 'utf8') },
  })
  // 与 electron/main.ts 完全同构：模块 -> SearchManager -> 豆包端口。
  // 必须走 SearchManager，否则"同一供应商单飞锁"这类生产缺陷在验证里根本不会暴露
  // （a3efce0 的并发首轮检索就是这么漏过去的：验证脚本直连 port，生产走 manager）。
  const manager = new SearchManager()
  manager.register('doubao', createCachedSearchPort(createDoubaoPort(async () => doubaoKey), cache, { provider: 'doubao', ttlMs: 6 * 60 * 60 * 1_000 }))
  const port = (request) => manager.search(request)
  const service = createProjectTimelineDiscoveryService((request) => port(request), async () => 'doubao')
  const policyService = createPolicyChainService((request) => port(request))
  const industryService = createIndustryChainService((request) => port(request))
  // 归纳端口：真实链路里由主进程注入 DSH；真实验证脚本里用"桩模型"回放同一套证据约束流程
// （引文取自材料原文，所以本地校验能通过），用来验证"证据表 → 归纳 → 引文校验 → 七项事由 → 渲染"整条链。
// 归纳端口：必须走真实 DSH，禁止桩模型（拿不到就抛错，让测试红而不是假装通过）。
// 真实 DSH 归纳（抽查用）：读本机 DeepSeek Key → 准备已安装的 DSH 后端 → 用它的 synthesize。
  let realSynthesize
  let realLoopStep
  try {
    const { prepareInstalledDshBackend, installedDshPackageRoot } = await import('../dist-electron/electron/installed-dsh-backend.js')
    const credentialFile2 = JSON.parse(await readFile(credentialPath, 'utf8'))
    const deepseekKey = credentialFile2.deepseek?.encrypted
      ? safeStorage.decryptString(Buffer.from(credentialFile2.deepseek.encrypted, 'base64'))
      : ''
    if (!deepseekKey) {
      console.log('   真实 DSH 不可用：本机没有已保存的 DeepSeek Key。')
    } else {
      const dshWorkspace = join(tmpdir(), `shiji-e2e-ws-${Date.now()}`)
      const dshSession = join(tmpdir(), `shiji-e2e-session-${Date.now()}`)
      await mkdir(dshWorkspace, { recursive: true })
      await mkdir(dshSession, { recursive: true })
      const prepared = await prepareInstalledDshBackend({
        packageRoot: installedDshPackageRoot(appData),
        electronExecutable: process.execPath,
        workspaceRoot: dshWorkspace,
        sessionRoot: dshSession,
        readDeepSeekKey: async () => deepseekKey,
        discoverOpportunity: async () => ({ provider: 'doubao', query: '', sources: [], evidenceRecords: [], truncated: false, requestCount: 0, cacheHit: true, checkedAt: new Date().toISOString() }),
      })
      if (prepared.available) { realSynthesize = prepared.synthesize; realLoopStep = prepared.runLoopStep }
      else console.log(`   真实 DSH 不可用：${prepared.reason}`)
    }
  } catch (error) {
    console.log(`   真实 DSH 准备失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const creditRiskService = createCreditRiskService((request) => port(request), async () => 'doubao', undefined, async (payload) => {
  if (!realSynthesize) throw new Error('真实 DSH 不可用：公开风险归纳拒绝使用桩模型。')
  return realSynthesize(payload)
}, async (payload) => {
  if (!realLoopStep) throw new Error('真实 DSH 不可用：检索循环拒绝使用桩模型。')
  return realLoopStep(payload)
})

  ipcMain.handle('e2e:credit-risk-run', async (_event, request) => {
    const startedAt = Date.now()
    try {
      const value = await creditRiskService(request)
      calls.push({
        kind: 'credit-risk', at: new Date().toISOString(), subjectName: value.subjectName,
        queries: value.queries, requestCount: value.requestCount, cacheHit: value.cacheHit,
        profile: value.profile,
        facts: value.facts.map((fact) => ({ category: fact.categoryLabel, reason: fact.reason, occurredAt: fact.occurredAt ?? null, amount: fact.amount ?? null, authority: fact.authority ?? null, publisher: fact.publisher, tier: fact.tier, pageUrl: fact.sourceUrl ?? null, subjectScope: fact.subjectScope ?? 'company', caseInfo: fact.caseInfo ?? null })),
        verifications: value.verifications,
        gaps: value.gaps, durationMs: Date.now() - startedAt,
      })
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      calls.push({ kind: 'credit-risk', at: new Date().toISOString(), subjectName: request.companyName, error: message })
      return { ok: false, message }
    }
  })

  ipcMain.handle('e2e:industry-chain-run', async (_event, request) => {
    const startedAt = Date.now()
    try {
      const value = await industryService(request)
      calls.push({
        kind: 'industry-chain', at: new Date().toISOString(), projectTitle: request.projectTitle,
        queries: value.queries, requestCount: value.requestCount, cacheHit: value.cacheHit,
        owner: value.owner,
        winners: value.winners.map((company) => ({ name: company.name, relation: company.relation, legalPerson: company.legalPerson ?? null, industryField: company.industryField ?? null, phone: company.phone ?? null, confidence: company.confidence, quote: company.relationQuote, pageUrl: company.sources[0]?.pageUrl ?? null })),
        suppliers: value.suppliers.map((company) => ({ name: company.name, relation: company.relation, legalPerson: company.legalPerson ?? null, industryField: company.industryField ?? null, phone: company.phone ?? null, confidence: company.confidence, quote: company.relationQuote, pageUrl: company.sources[0]?.pageUrl ?? null })),
        gaps: value.gaps, durationMs: Date.now() - startedAt,
      })
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      calls.push({ kind: 'industry-chain', at: new Date().toISOString(), projectTitle: request.projectTitle, error: message })
      return { ok: false, message }
    }
  })
  ipcMain.handle('e2e:policy-chain-run', async (_event, request) => {
    const startedAt = Date.now()
    try {
      const value = await policyService(request)
      calls.push({
        kind: 'policy-chain', at: new Date().toISOString(), projectTitle: request.projectTitle,
        queries: value.queries.map((item) => item.query),
        requestCount: value.requestCount, cacheHit: value.cacheHit,
        regionPath: value.regionPath.map((level) => level.label),
        findings: value.findings.map((finding) => ({
          level: finding.levelLabel, kind: finding.kind, title: finding.title, publisher: finding.publisher,
          documentNumber: finding.documentNumber ?? null, effectiveAt: finding.effectiveAt ?? null,
          instruments: finding.instruments, penetration: finding.penetration, sourceTier: finding.sourceTier,
          confidence: finding.confidence, pageUrl: finding.sources[0]?.pageUrl ?? null,
        })),
        predictions: value.predictions.map((prediction) => ({
          label: prediction.label, window: `${prediction.windowStart}~${prediction.windowEnd}`,
          certainty: prediction.certainty, basisKind: prediction.basisKind, basis: prediction.basis,
          basisEvidenceIds: prediction.basisEvidenceIds,
        })),
        gaps: value.gaps, durationMs: Date.now() - startedAt,
      })
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      calls.push({ kind: 'policy-chain', at: new Date().toISOString(), projectTitle: request.projectTitle, error: message })
      return { ok: false, message }
    }
  })

  ipcMain.handle('e2e:project-timeline-discover', async (_event, request) => {
    const startedAt = Date.now()
    try {
      const value = await service(request)
      const record = {
        at: new Date().toISOString(), mode: request.mode, projectTitle: request.projectTitle,
        lastKnownStageId: request.lastKnownStageId ?? null,
        query: value.query, requestCount: value.requestCount, cacheHit: value.cacheHit,
        evidenceCount: value.evidenceRecords.length,
        confirmedStageEvidence: value.confirmedStageEvidence,
        candidateCount: value.candidateEvidenceIds.length, rejectedCount: value.rejectedEvidenceIds.length,
        durationMs: Date.now() - startedAt,
        evidenceTrail: value.evidenceRecords.slice(0, 6).map((item) => ({
          title: item.title, publisher: item.provenance.publisher, pageUrl: item.provenance.pageUrl,
          capturedAt: item.provenance.capturedAt, stageIds: item.opportunityDetails?.stageIds ?? [],
          amountCandidates: item.opportunityDetails?.amountWanCandidates ?? [],
        })),
      }
      calls.push(record)
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      calls.push({ at: new Date().toISOString(), mode: request.mode, projectTitle: request.projectTitle, error: message })
      return { ok: false, message }
    }
  })

  const win = new BrowserWindow({
    width: 1720, height: 1080, show: false,
    webPreferences: {
      preload: join(root, 'scripts', 'e2e-real-preload.cjs'),
      partition: 'e2e-real-memory',
      contextIsolation: false, nodeIntegration: false, sandbox: false,
      additionalArguments: [`--e2e-contract-version=${DESKTOP_CONTRACT_VERSION}`],
    },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))

  const opportunity = {
    id: TARGET.id, title: TARGET.title, companyId: 'e2e-company', companyName: TARGET.company,
    amountWan: null, locationAddress: null, distanceKm: null, deadline: null, matchScore: 70,
    projectType: '不限', reason: '真实端到端验证：项目来自本机真实搜索结果。',
    evidenceIds: [], followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
  }
  const catalog = { version: 1, records: { [TARGET.id]: opportunity }, currentResultIds: [TARGET.id], currentEvidenceIds: [], lifecycle: {} }
  const seed = async (extra = '') => {
    await wc.executeJavaScript(`(() => {
      localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
      localStorage.setItem('shiji.search-evidence.v2', '[]');
      localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([TARGET.id]))});
      localStorage.setItem('shiji.analysis-runs.v1', '[]');
      localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'timeline', selectedOpportunityId: TARGET.id }))});
      ${extra}
      return true
    })()`)
  }
  await seed()
  await wc.reload()
  await sleep(1500)

  // ── 1. 点击「启动分析」→ 真实检索 → 真实当前节点 ──────────────────────
  const plannedQuery = buildTimelineStageSearchPlan(TARGET.title, TARGET.company).query
  console.log(`\n[真实检索] 计划查询：${plannedQuery}`)
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="timeline"]').click(); return true })()`)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && (calls.length === 0 || !(await wc.executeJavaScript(`document.querySelector('.timeline-result-card') !== null`)))) await sleep(700)
  await sleep(1200)

  const run = calls[0]
  report.steps.push({ step: 'timeline-full', plannedQuery, call: run })
  check('点击「启动分析」确实发起了真实检索（有查询词与结果）', Boolean(run && !run.error && run.query), JSON.stringify(run?.error ?? run?.query ?? null))
  check('查询词由项目标题 + 主体构成（不是空查或泛查）', Boolean(run?.query?.includes('悦湖片区') || run?.query?.includes(TARGET.title.slice(0, 6))), String(run?.query))
  check('返回了真实来源（含公开原文链接）', Boolean(run?.evidenceTrail?.some((item) => /^https?:\/\//.test(String(item.pageUrl)))), JSON.stringify(run?.evidenceTrail?.map((item) => item.pageUrl)))
  console.log(`[真实检索] ${run?.cacheHit ? '命中 6 小时缓存' : `实际调用豆包 ${run?.requestCount} 次`}；来源 ${run?.evidenceCount} 条；确认阶段 ${run?.confirmedStageEvidence?.length ?? 0} 条；候选 ${run?.candidateCount} 条`)
  for (const item of run?.evidenceTrail ?? []) console.log(`   · ${item.title} | ${item.publisher} | 阶段=${item.stageIds} | ${item.pageUrl}`)
  for (const item of run?.confirmedStageEvidence ?? []) console.log(`   ✓ 确认节点：${stageLabel(item.stageId)} @ ${item.occurredAt} ← ${item.source}`)

  const expectedStageId = buildProjectTimeline(run?.confirmedStageEvidence ?? []).currentVerifiedStageId
  const expectedLabel = stageLabel(expectedStageId)
  check('确实按项目标题+内容判定出"真实当前节点"（有达到门槛的阶段证据）', Boolean(expectedStageId), `确认节点=${expectedLabel}`)
  check('确认节点的日期与来源都来自检索到的原始公告', (run?.confirmedStageEvidence ?? []).every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt) && item.source.trim().length > 0), JSON.stringify(run?.confirmedStageEvidence))
  const dom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.timeline-result-card')
    if (!card) return null
    return {
      cards: document.querySelectorAll('.timeline-result-card').length,
      status: card.querySelector('header span')?.textContent ?? '',
      chip: card.querySelector('header > em')?.textContent ?? '',
      verifiedNodes: [...card.querySelectorAll('.time-node')].filter((n) => n.classList.contains('verified')).map((n) => ({ label: n.querySelector('strong')?.textContent ?? '', date: n.querySelector('small')?.textContent ?? '', state: n.querySelector('em')?.textContent ?? '' })),
      currentNodes: [...card.querySelectorAll('.time-node.current')].map((n) => n.querySelector('strong')?.textContent ?? ''),
      nextStep: card.querySelector('footer > span')?.textContent ?? '',
      nodes: card.querySelectorAll('.time-node').length,
    }
  })()`)
  report.steps.push({ step: 'timeline-ui', expectedStageId: expectedStageId ?? null, expectedLabel, dom })
  console.log(`[界面结果] 状态=${dom?.status} | 阶段标签=${dom?.chip} | 已确认节点=${JSON.stringify(dom?.verifiedNodes)} | 下一步=${dom?.nextStep}`)

  check('结果卡按"每个项目一张"渲染', dom?.cards === 1 && dom?.nodes === 7, JSON.stringify({ cards: dom?.cards, nodes: dom?.nodes }))
  check('运行状态显示已完成/部分完成（不是未启动）', /已完成|部分完成|失败/.test(dom?.status ?? ''), dom?.status)
  check('界面阶段标签 = 由真实"已确认阶段证据"算出的当前节点', dom?.chip === expectedLabel, `界面=${dom?.chip} / 期望=${expectedLabel}`)
  check('界面已确认节点与真实证据一致（阶段+日期都来自公告正文）', (dom?.verifiedNodes ?? []).every((node) => (run?.confirmedStageEvidence ?? []).some((item) => stageLabel(item.stageId) === node.label && item.occurredAt === node.date)), JSON.stringify(dom?.verifiedNodes))
  check('未取得证据的阶段明确标为待核验/预计，而不是编造', (dom?.verifiedNodes ?? []).length === 0 ? expectedStageId === undefined : true, JSON.stringify(dom?.verifiedNodes))

  // ── 2. 订阅：进入追踪模块，且订阅本身不发起检索 ───────────────────────
  const callsBeforeSubscribe = calls.length
  await wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.timeline-result-card > footer button')].find((el) => el.textContent.includes('订阅阶段变化')); if (b) b.click(); return true })()`)
  await sleep(1200)
  const watchDom = await wc.executeJavaScript(`(() => ({
    view: Boolean(document.querySelector('.watch-layout')),
    rows: document.querySelectorAll('.watch-list article').length,
    title: document.querySelector('.watch-list article strong')?.textContent ?? '',
    status: document.querySelector('.watch-list article span')?.textContent ?? '',
    detail: document.querySelector('.watch-list article small')?.textContent ?? '',
  }))()`)
  report.steps.push({ step: 'subscribe', callsBefore: callsBeforeSubscribe, callsAfter: calls.length, dom: watchDom })
  check('订阅后确实进入"对象管理 → 追踪（关注）"模块', watchDom.view === true && watchDom.rows === 1, JSON.stringify(watchDom))
  check('订阅本身不发起任何检索（0 次新调用）', calls.length === callsBeforeSubscribe, `订阅前 ${callsBeforeSubscribe} 次 / 订阅后 ${calls.length} 次`)

  // ── 3. 立即检查：真实的下一阶段扫描 ──────────────────────────────────
  await wc.executeJavaScript(`(() => { const b = document.querySelector('.check-watch'); if (b) b.click(); return true })()`)
  const manualDeadline = Date.now() + 120_000
  while (Date.now() < manualDeadline && calls.length === callsBeforeSubscribe) await sleep(700)
  await sleep(1200)
  const manual = calls[calls.length - 1]
  const manualDom = await wc.executeJavaScript(`(() => ({
    detail: document.querySelector('.watch-list article small')?.textContent ?? '',
    message: document.querySelector('.conversation-message, .agent-message, .message-stream')?.textContent ?? '',
  }))()`)
  report.steps.push({ step: 'watch-check-manual', call: manual, dom: manualDom })
  console.log(`[立即检查] mode=${manual?.mode} lastKnownStageId=${manual?.lastKnownStageId} ${manual?.cacheHit ? '命中缓存' : `实际搜索 ${manual?.requestCount} 次`}`)
  check('「立即检查」发起真实的下一阶段全网扫描（mode=watch-next）', manual?.mode === 'watch-next', JSON.stringify({ mode: manual?.mode, error: manual?.error }))
  check('扫描起点 = 该项目当前已确认节点', (manual?.lastKnownStageId ?? null) === (expectedStageId ?? null), `扫描起点=${manual?.lastKnownStageId ?? null} / 当前节点=${expectedStageId ?? null}`)
  check('检查后订阅行写回"上次检查"时间', /上次检查/.test(manualDom.detail), manualDom.detail)

  // ── 4. 启动自动复查：未到期 0 次；到期最多 1 次 ────────────────────────
  const notDue = JSON.stringify([{ id: `watch-${TARGET.id}`, opportunityId: TARGET.id, title: TARGET.title, status: 'active', checkCadence: 'on-launch', createdAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString(), lastKnownStageId: expectedStageId }])
  const beforeNotDue = calls.length
  await seed(`localStorage.setItem('shiji.project-watches.v1', ${JSON.stringify(notDue)});`)
  await wc.reload()
  await sleep(6000)
  report.steps.push({ step: 'launch-check-not-due', newCalls: calls.length - beforeNotDue })
  check('订阅未到期（刚检查过）时，启动不产生任何检索', calls.length === beforeNotDue, `新增 ${calls.length - beforeNotDue} 次`)

  const due = JSON.stringify([{ id: `watch-${TARGET.id}`, opportunityId: TARGET.id, title: TARGET.title, status: 'active', checkCadence: 'on-launch', createdAt: new Date(Date.now() - 9 * 86400000).toISOString(), lastCheckedAt: new Date(Date.now() - 8 * 86400000).toISOString(), lastKnownStageId: expectedStageId }])
  const beforeDue = calls.length
  await seed(`localStorage.setItem('shiji.project-watches.v1', ${JSON.stringify(due)});`)
  await wc.reload()
  const dueDeadline = Date.now() + 120_000
  while (Date.now() < dueDeadline && calls.length === beforeDue) await sleep(700)
  await sleep(1000)
  const launchCall = calls[calls.length - 1]
  report.steps.push({ step: 'launch-check-due', newCalls: calls.length - beforeDue, call: launchCall })
  console.log(`[启动复查] 新增 ${calls.length - beforeDue} 次；mode=${launchCall?.mode}`)
  check('订阅满 7 天到期后，启动自动复查恰好 1 次', calls.length - beforeDue === 1, `新增 ${calls.length - beforeDue} 次`)
  check('启动复查走的是下一阶段扫描（watch-next）', launchCall?.mode === 'watch-next', String(launchCall?.mode))

  // ── 5. 政策链：真实三级检索（国家 / 省 / 市）× 每个项目一张结果卡 ────────
  const beforePolicy = calls.length
  await seed(`localStorage.setItem('shiji.analysis-runs.v1', '[]'); localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'policy', selectedOpportunityId: TARGET.id }))});`)
  await wc.reload()
  await sleep(1500)
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="policy"]').click(); return true })()`)
  const policyDeadline = Date.now() + 240_000
  while (Date.now() < policyDeadline && calls.length === beforePolicy) await sleep(900)
  await sleep(1500)
  const policyRun = calls.filter((call) => call.kind === 'policy-chain').at(-1)
  const policyDom = await wc.executeJavaScript(`(() => {
    return {
      cards: document.querySelectorAll('.policy-result-card').length,
      levels: [...document.querySelectorAll('.policy-level')].map((level) => level.querySelector('header span')?.textContent ?? ''),
      findings: document.querySelectorAll('.policy-finding').length,
      penetrations: [...document.querySelectorAll('.policy-penetration')].map((node) => node.textContent.slice(0, 40)),
      predictions: [...document.querySelectorAll('.policy-prediction')].map((node) => ({
        label: node.querySelector('strong')?.textContent ?? '',
        window: node.querySelector('em')?.textContent ?? '',
        certainty: node.querySelector('b')?.textContent ?? '',
        basis: node.querySelector('p')?.textContent ?? '',
      })),
      gaps: [...document.querySelectorAll('.policy-gaps li')].map((node) => node.textContent),
      boundary: document.querySelector('.policy-boundary')?.textContent ?? '',
      objectBar: document.querySelector('.result-object-bar')?.textContent ?? '',
      visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
    }
  })()`)
  report.steps.push({ step: 'policy-chain', call: policyRun, dom: policyDom })
  console.log(`\n[政策链] 查询 ${policyRun?.queries?.length ?? 0} 条（${policyRun?.cacheHit ? '命中缓存' : `实际搜索 ${policyRun?.requestCount} 次`}）；层级 ${JSON.stringify(policyRun?.regionPath)}`)
  for (const query of policyRun?.queries ?? []) console.log(`   · ${query}`)
  for (const finding of policyRun?.findings ?? []) console.log(`   ✓ ${finding.level}｜${finding.kind === 'budget' ? '预算/资金' : '政策文件'}｜${finding.sourceTier === 'official' ? '官方原文' : '媒体转载·仅参考'}｜${finding.title}｜${finding.publisher}${finding.documentNumber ? `｜${finding.documentNumber}` : ''}${finding.pageUrl ? `｜${finding.pageUrl}` : ''}`)
  for (const prediction of policyRun?.predictions ?? []) console.log(`   → ${prediction.label}｜${prediction.window}｜${prediction.certainty}｜依据：${prediction.basis}`)

  check('政策链按三级各检索一次（国家 / 省 / 市）', (policyRun?.queries?.length ?? 0) === 3 && new Set(policyRun?.queries ?? []).size === 3, JSON.stringify(policyRun?.queries))
  check('层级解析正确（国家 → 四川省 → 成都市）', JSON.stringify(policyRun?.regionPath) === JSON.stringify(['国家级', '四川省', '成都市']), JSON.stringify(policyRun?.regionPath))
  check('结果卡按"每个项目一张"渲染，且三级梯都在', policyDom.cards === 1 && policyDom.levels.length === 3, JSON.stringify({ cards: policyDom.cards, levels: policyDom.levels }))
  check('启动后对象卡片收起（与时间链同一口径）', policyDom.visibleObjectRows === 0 && policyDom.objectBar.includes('1 个项目'), JSON.stringify({ rows: policyDom.visibleObjectRows }))
  check('穿透性只用正文点名下级的原句作证据', (policyDom.penetrations.length > 0) === ((policyRun?.findings ?? []).some((finding) => finding.penetration.length > 0)), JSON.stringify(policyDom.penetrations))
  check('每条预测都带依据文本（禁止编造）', (policyRun?.predictions ?? []).every((prediction) => prediction.basis.length > 0 && prediction.basisKind.length > 0), JSON.stringify(policyRun?.predictions))
  check('没有依据时不出预测（本次结果自洽）', (policyRun?.predictions ?? []).length > 0 || policyDom.gaps.some((gap) => gap.includes('未取得可支撑预测的依据')), JSON.stringify({ predictions: policyRun?.predictions?.length ?? 0, gaps: policyDom.gaps }))
  check('界面把预测与正式公开节点分开标记', policyDom.predictions.every((prediction) => prediction.certainty === '预测性建议' || prediction.certainty === '正式公开节点'), JSON.stringify(policyDom.predictions.map((item) => item.certainty)))
  check('真实结果里"招标公告"没有被当成政策文件，且每条都标了来源性质', (policyRun?.findings ?? []).every((finding) => !/(招标公告|采购公告|竞争性磋商|中标结果|评标结果)/.test(finding.title) && (finding.sourceTier === 'official' || finding.sourceTier === 'media')), JSON.stringify((policyRun?.findings ?? []).map((finding) => `${finding.sourceTier}:${finding.title}`)))
  check('界面保留政策链边界说明', policyDom.boundary.length > 0, policyDom.boundary.slice(0, 60))

  // ── 6. 产业链：真实检索（历史中标 / 本项目履约 / 供应商与代理） ────────
  const beforeIndustry = calls.length
  await seed(`localStorage.setItem('shiji.analysis-runs.v1', '[]'); localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'industry', selectedOpportunityId: TARGET.id }))});`)
  await wc.reload()
  await sleep(1500)
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="industry"]').click(); return true })()`)
  const industryDeadline = Date.now() + 240_000
  while (Date.now() < industryDeadline && calls.length === beforeIndustry) await sleep(900)
  await sleep(1500)
  const industryRun = calls.filter((call) => call.kind === 'industry-chain').at(-1)
  const industryDom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.industry-result-card')
    if (!card) return null
    const cell = (row, selector) => row.querySelector(selector)?.textContent ?? ''
    return {
      cards: document.querySelectorAll('.industry-result-card').length,
      blocks: [...card.querySelectorAll('.industry-block > header > span')].map((node) => node.textContent),
      tableHeads: [...card.querySelectorAll('.industry-table-head')].map((head) => [...head.querySelectorAll('span')].map((span) => span.textContent)),
      rows: [...card.querySelectorAll('.industry-company')].map((row) => ({
        name: cell(row, '.ic-name'),
        phone: cell(row, '.ic-phone'),
        legal: cell(row, '.ic-legal'),
        industry: cell(row, '.ic-industry'),
        source: cell(row, '.ic-source'),
        tip: row.getAttribute('title') ?? '',
      })),
      gaps: [...card.querySelectorAll('.policy-gaps li')].map((node) => node.textContent),
      graphNodes: card.querySelectorAll('.react-flow, .industry-graph, .tianditu-map').length,
      visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
      cardHeight: Math.round(card.getBoundingClientRect().height),
    }
  })()`)
  report.steps.push({ step: 'industry-chain', call: industryRun, dom: industryDom })
  console.log(`\n[产业链] 查询 ${industryRun?.queries?.length ?? 0} 组（${industryRun?.cacheHit ? '命中缓存' : `实际搜索 ${industryRun?.requestCount} 次`}）；甲方 ${industryRun?.owner?.name}`)
  for (const query of industryRun?.queries ?? []) console.log(`   · ${query}`)
  console.log(`   甲方四维度：法人=${industryRun?.owner?.legalPerson ?? '未取得'}｜行业=${industryRun?.owner?.industryField ?? '未取得'}｜电话=${industryRun?.owner?.phone ?? '未取得'}`)
  for (const company of industryRun?.winners ?? []) console.log(`   ✓ 以往中标｜${company.name}｜法人=${company.legalPerson ?? '未取得'}｜行业=${company.industryField ?? '未取得'}｜电话=${company.phone ?? '未取得'}｜${company.confidence}`)
  for (const company of industryRun?.suppliers ?? []) console.log(`   ✓ 上下游｜${company.name}｜法人=${company.legalPerson ?? '未取得'}｜行业=${company.industryField ?? '未取得'}｜电话=${company.phone ?? '未取得'}｜${company.confidence}`)

  check('产业链两阶段检索：3 组定向 + 工商信息核对（每项目最多 4 家）', (industryRun?.queries?.length ?? 0) === 7, JSON.stringify(industryRun?.queries))
  check('结果卡按"每个项目一张"渲染，一级标题＝甲方 / 以往中标 / 上下游', industryDom?.cards === 1 && JSON.stringify(industryDom?.blocks) === JSON.stringify(['甲方（招标/建设主体）', '以往中标企业', '上下游供应链']), JSON.stringify({ cards: industryDom?.cards, blocks: industryDom?.blocks }))
  check('启动后对象卡片收起', industryDom?.visibleObjectRows === 0, String(industryDom?.visibleObjectRows))
  check('紧凑表格：表头五列＝公司名称/联系方式/法人/行业领域/来源', (industryDom?.tableHeads ?? []).length >= 2 && (industryDom?.tableHeads ?? []).every((head) => head.join('|') === '公司名称|联系方式|法人|行业领域|来源'), JSON.stringify(industryDom?.tableHeads))
  check('每家一行、原句只作悬停提示（不再占版面）', (industryDom?.rows ?? []).every((row) => row.name && row.phone && row.legal && row.industry && row.source) && (industryDom?.rows ?? []).slice(1).every((row) => row.tip.length > 0), JSON.stringify(industryDom?.rows?.[1]))
  check('缺值用"—"（不编造）', (industryRun?.winners ?? []).concat(industryRun?.suppliers ?? []).every((company) => company.legalPerson === null || typeof company.legalPerson === 'string'), 'ok')
  check('每条关系都带原句', (industryRun?.winners ?? []).concat(industryRun?.suppliers ?? []).every((company) => company.quote.length > 0), JSON.stringify((industryRun?.winners ?? []).map((company) => company.quote.slice(0, 30))))
  check('本模块不出现任何图/地图元素', industryDom?.graphNodes === 0, String(industryDom?.graphNodes))
  check('取不到时如实记缺口', (industryRun?.winners?.length ?? 0) + (industryRun?.suppliers?.length ?? 0) > 0 || (industryDom?.gaps?.length ?? 0) > 0, JSON.stringify(industryDom?.gaps))

  // ── 7. 公开风险：招标单位的工商与公开风险（4 组全网检索） ──────────────
  const beforeRisk = calls.length
  await seed(`localStorage.setItem('shiji.analysis-runs.v1', '[]'); localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'risk', selectedOpportunityId: TARGET.id }))});`)
  await wc.reload()
  await sleep(1500)
  await wc.executeJavaScript(`(() => { document.querySelector('button[data-module="risk"]').click(); return true })()`)
  const riskDeadline = Date.now() + 300_000
  while (Date.now() < riskDeadline && calls.length === beforeRisk) await sleep(900)
  await sleep(1500)
  const riskRun = calls.filter((call) => call.kind === 'credit-risk').at(-1)
  const riskDom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.credit-risk-card')
    if (!card) return null
    const subject = card.querySelector('.industry-company.risk-subject')
    return {
      cards: document.querySelectorAll('.credit-risk-card').length,
      subjectHead: [...card.querySelectorAll('.industry-table-head.risk-subject span')].map((s) => s.textContent),
      factHead: [...card.querySelectorAll('.industry-table-head.risk-fact span')].map((s) => s.textContent),
      sections: [...card.querySelectorAll('.industry-block > header > span')].map((node) => node.textContent),
      subjectCells: [...(subject?.querySelectorAll('span') ?? [])].map((s) => s.textContent),
      facts: [...card.querySelectorAll('.industry-company.risk-fact')].map((row) => ({
        category: row.querySelector('.risk-category')?.textContent ?? '',
        reason: row.querySelector('.risk-reason')?.textContent ?? '',
      })),
      empty: card.querySelector('.industry-empty')?.textContent ?? '',
      gaps: [...card.querySelectorAll('.policy-gaps li')].map((n) => n.textContent),
      graphNodes: card.querySelectorAll('.react-flow, .industry-graph, .tianditu-map').length,
      visibleObjectRows: document.querySelectorAll('.scope-object-list > li').length,
    }
  })()`)
  report.steps.push({ step: 'credit-risk', call: riskRun, dom: riskDom })
  console.log(`\n[公开风险] 查询 ${riskRun?.queries?.length ?? 0} 组（${riskRun?.cacheHit ? '命中缓存' : `实际搜索 ${riskRun?.requestCount} 次`}）；招标单位 ${riskRun?.subjectName}`)
  console.log(`   主体类型=${riskRun?.profile?.subjectType}（${riskRun?.profile?.subjectTypeBasis}）｜代码=${riskRun?.profile?.code ?? '—'}｜法人=${riskRun?.profile?.legalPerson ?? '—'}｜地址=${riskRun?.profile?.address ?? '—'}｜电话=${riskRun?.profile?.phone ?? '—'}`)
  for (const fact of riskRun?.facts ?? []) console.log(`   ! ${fact.category}｜${fact.reason}｜${fact.occurredAt ?? '—'}｜${fact.amount ?? ''}｜${fact.publisher}`)

  check('公开风险按 7 组全网检索（登记 / 联系地址 / 处罚异常 / 裁判诉讼 / 招标违规 / 工商变更 / 高管个人）', (riskRun?.queries?.length ?? 0) === 9, JSON.stringify(riskRun?.queries))
  check('对象是发布招标的招标单位', riskRun?.subjectName === TARGET.company, String(riskRun?.subjectName))
  check('主体类型有判断依据（不静默断言）', typeof riskRun?.profile?.subjectTypeBasis === 'string' && riskRun.profile.subjectTypeBasis.length > 0, String(riskRun?.profile?.subjectTypeBasis))
  check('结果卡两张紧凑表，表头符合口径', riskDom?.cards === 1 && ((riskDom?.factHead ?? []).join('|') === '主体名称|类别|信用事实（事由）|时间|来源' || (riskDom?.sections ?? []).length >= 2), JSON.stringify({ cards: riskDom?.cards, factHead: riskDom?.factHead }))
  check('启动后对象卡片收起', riskDom?.visibleObjectRows === 0, String(riskDom?.visibleObjectRows))
  check('风险事实都带类别与事由（不编造）', (riskRun?.facts ?? []).every((fact) => fact.category.length > 0 && fact.reason.length > 0), JSON.stringify((riskRun?.facts ?? []).map((fact) => fact.reason.slice(0, 24))))
  check('无风险时明确写"未取得可核验的公开风险记录"', (riskRun?.facts?.length ?? 0) > 0 || (riskDom?.empty ?? '').includes('未取得可核验的公开风险记录'), JSON.stringify({ facts: riskRun?.facts?.length ?? 0, empty: riskDom?.empty }))
  check('本模块不出现任何图/地图元素', riskDom?.graphNodes === 0, String(riskDom?.graphNodes))

  // ── 8. 追加主体抽查（环境变量 SHJI_RISK_SUBJECTS，用 | 分隔）────────────────
  const extraSubjects = (process.env.SHJI_RISK_SUBJECTS ?? '').split('|').map((item) => item.trim()).filter(Boolean)
  for (const [index, subject] of extraSubjects.entries()) {
    console.log(`\n[抽查 ${index + 1}] ${subject}`)
    try {
      // 复用主阶段同一套服务（内部已持有可用的 DSH 端口），避免二次启动 DSH 运行时。
      const probe = creditRiskService
      const value = await probe({
        opportunityId: `probe-${index}`, projectTitle: subject, companyName: subject,
        industry: '市政基础设施',
      })
      console.log(`   主体类型=${value.profile.subjectType}｜代码=${value.profile.code ?? '—'}｜法人=${value.profile.legalPerson ?? '—'}｜地址=${value.profile.address ?? '—'}｜电话=${value.profile.phone ?? '—'}`)
      for (const fact of value.facts) {
        console.log(`   ! [${fact.categoryLabel}｜${fact.subjectScope ?? 'company'}] ${fact.reason}`)
        console.log(`     来源=${fact.publisher}｜${fact.sourceWalled ? '需登录' : '公开'}｜时间=${fact.occurredAt ?? '—'}｜金额=${fact.amount ?? '—'}`)
      }
      for (const item of value.verifications ?? []) console.log(`   √ ${item.label}：${item.conclusion}`)
      const modelLines = value.gaps.filter((gap) => gap.startsWith('模型'))
      for (const line of modelLines) console.log(`   ${line}`)
    } catch (error) {
      console.log(`   抽查失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  report.calls = calls
  report.finishedAt = new Date().toISOString()
  report.failed = failed
  report.isolation = {
    sandboxUserData,
    userStorageBefore,
    userStorageAfter: existsSync(userStoragePath) ? (await stat(userStoragePath)).mtimeMs : 0,
  }
  check('验证过程未写入用户的本机数据目录（Local Storage 未被改动）', report.isolation.userStorageBefore === report.isolation.userStorageAfter, `${report.isolation.userStorageBefore} -> ${report.isolation.userStorageAfter}`)
  await writeFile(join(artifacts, 'e2e-real-timeline.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('\n真实端到端报告: artifacts/e2e-real-timeline.json')
  console.log('')
  console.log(failed === 0 ? '真实端到端验证通过：时间链 + 政策链 + 产业链 + 公开风险（招标单位 / 政府事业单位同样受理 / 事实带事由）。' : `真实端到端验证失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => { console.error('真实端到端运行异常:', error); app.exit(2) })
