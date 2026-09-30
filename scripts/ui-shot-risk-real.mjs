// 用**真实检索结果**渲染公开风险卡并截图（自查用：确认法人/统一社会信用代码/地址/事由真的看得见）。
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts')
mkdirSync(artifacts, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const report = JSON.parse(readFileSync(join(artifacts, 'e2e-real-timeline.json'), 'utf8'))
const step = report.steps.find((item) => item.step === 'credit-risk')
if (!step?.call?.profile) { console.error('报告里没有公开风险结果，请先跑 npm run verify:real'); app.exit(2) }
const call = step.call
const subject = report.target ?? report.steps.find((item) => item.step === 'timeline')?.call?.project ?? {}
const opportunityId = subject.id ?? 'real-risk-1'
const LABELS = { 'business-abnormal': '经营异常', 'serious-violation': '严重违法失信', 'administrative-penalty': '行政处罚', 'dishonest-enforcement': '失信被执行', 'administrative-litigation': '行政诉讼/裁判文书', 'tender-violation': '招标投标违规', registration: '登记信息' }
const result = {
  opportunityId,
  projectTitle: subject.title ?? '真实项目（公开风险自查）',
  subjectName: call.subjectName,
  profile: call.profile,
  facts: (call.facts ?? []).map((fact, index) => ({
    id: `fact-${index}`, subjectName: call.subjectName,
    category: Object.keys(LABELS).find((key) => LABELS[key] === fact.category) ?? 'administrative-penalty',
    categoryLabel: fact.category, reason: fact.reason,
    ...(fact.occurredAt ? { occurredAt: fact.occurredAt } : {}),
    ...(fact.amount ? { amount: fact.amount } : {}),
    ...(fact.authority ? { authority: fact.authority } : {}),
    sourceTitle: `${fact.publisher}（${fact.tier}）`, publisher: fact.publisher,
    ...(fact.pageUrl ? { sourceUrl: fact.pageUrl } : {}),
    tier: fact.tier, subjectScope: fact.subjectScope ?? 'company', sourceWalled: /qcc|aiqicha|qixin|tianyancha|shuidi/.test(fact.pageUrl ?? '') || /企查查|爱企查|启信宝|天眼查|水滴/.test(fact.publisher ?? ''),
  })),
  queries: call.queries ?? [], requestCount: call.requestCount ?? 0, cacheHit: Boolean(call.cacheHit),
  checkedAt: call.at ?? new Date().toISOString(), gaps: call.gaps ?? [],
  verifications: call.verifications ?? [], boundary: '公开风险只记录公开来源里写明的主体与事项；搜不到不等于没有风险。',
}
const opportunity = {
  id: opportunityId, title: result.projectTitle, companyId: 'c1', companyName: call.subjectName,
  amountWan: 1280, locationAddress: '四川省成都市武侯区', distanceKm: null, deadline: '2026-10-15',
  matchScore: 82, projectType: '市政基础设施', reason: '真实结果自查', evidenceIds: [],
  followUpLevel: '值得验证', confidence: '中', timelineEvidence: [],
}
const catalog = { version: 1, records: { [opportunityId]: opportunity }, currentResultIds: [opportunityId], currentEvidenceIds: [], lifecycle: {} }
const runs = [{ opportunityId, moduleId: 'risk', targetSubjectName: call.subjectName, status: 'completed', updatedAt: result.checkedAt, message: `主体 ${call.subjectName}；风险事实 ${result.facts.length} 条`, actualSearchCalls: call.requestCount ?? 0, actualModelCalls: 0 }]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1720, height: 1200, show: false,
    webPreferences: { preload: join(root, 'scripts', 'ui-verify-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false },
  })
  const wc = win.webContents
  await wc.loadFile(join(root, 'dist', 'index.html'))
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))});
    localStorage.setItem('shiji.search-evidence.v2', '[]');
    localStorage.setItem('shiji.analysis-selection.v1', ${JSON.stringify(JSON.stringify([opportunityId]))});
    localStorage.setItem('shiji.analysis-runs.v1', ${JSON.stringify(JSON.stringify(runs))});
    localStorage.setItem('shiji.credit-risk.v1', ${JSON.stringify(JSON.stringify([result]))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'risk', selectedOpportunityId: opportunityId }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1600)
  const dom = await wc.executeJavaScript(`(() => {
    const card = document.querySelector('.credit-risk-card')
    if (!card) return { missing: true }
    const subject = card.querySelector('.industry-company.risk-subject')
    return {
      subjectHead: [...card.querySelectorAll('.industry-table-head.risk-subject span')].map((s) => s.textContent),
      subjectCells: [...(subject?.querySelectorAll('span') ?? [])].map((s) => s.textContent),
      factHead: [...card.querySelectorAll('.industry-table-head.risk-fact span')].map((s) => s.textContent),
      facts: [...card.querySelectorAll('.industry-company.risk-fact')].map((row) => ({
        category: row.querySelector('.risk-category')?.textContent ?? '',
        reason: row.querySelector('.risk-reason')?.textContent ?? '',
        source: row.querySelector('.ic-source')?.textContent ?? '',
      })),
      visibleWidth: card.getBoundingClientRect().width,
      cardHeight: Math.round(card.getBoundingClientRect().height),
    }
  })()`)
  console.log(JSON.stringify(dom, null, 2).slice(0, 2000))
  writeFileSync(join(artifacts, 'ui-shot-risk-real.png'), (await wc.capturePage()).toPNG())
  console.log('截图: artifacts/ui-shot-risk-real.png')
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(2) })
