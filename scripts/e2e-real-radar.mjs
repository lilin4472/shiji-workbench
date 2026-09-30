// 商机雷达真实定向验收：一次真实豆包搜索 + DeepSeek 连通性 + 条件模式 DSH 结构化。
// 凭据只在 Electron safeStorage 中解密并留在进程内；报告和控制台绝不输出 Key。
import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDoubaoPort } from '../dist-electron/electron/doubao-provider.js'
import { createOpportunityDiscoveryService } from '../dist-electron/electron/opportunity-discovery-service.js'
import { installedDshPackageRoot, prepareInstalledDshBackend } from '../dist-electron/electron/installed-dsh-backend.js'
import { createDeepRadarTask } from '../dist-electron/shared/deep-radar-task.js'
import { eligibleDeepRadarOpportunities } from '../dist-electron/shared/deep-radar.js'

app.setName('shiji-workbench')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts')
const appData = join(process.env.APPDATA ?? '', 'shiji-workbench')
const credentialPath = join(appData, 'secure', 'credentials.v1.json')
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const region = arg('region', '南京市')
const subjectName = arg('name', '思杰')
const specialty = arg('specialty', '机电安装')

let failed = 0
const check = (label, passed, detail = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${passed || !detail ? '' : `\n        -> ${detail}`}`)
  if (!passed) failed += 1
}

app.whenReady().then(async () => {
  await mkdir(artifacts, { recursive: true })
  if (!existsSync(credentialPath)) throw new Error(`找不到本机凭据文件：${credentialPath}`)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本机 Key。')
  const credentialFile = JSON.parse(await readFile(credentialPath, 'utf8'))
  const decrypt = (entry) => entry?.encrypted
    ? safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64')).trim()
    : ''
  const doubaoKey = decrypt(credentialFile.doubao)
  const deepseekKey = decrypt(credentialFile.deepseek)
  check('豆包 Key 已配置并可安全读取', doubaoKey.length > 8)
  check('DeepSeek Key 已配置并可安全读取', deepseekKey.length > 8)
  if (!doubaoKey || !deepseekKey) throw new Error('真实验收需要同时配置豆包与 DeepSeek Key。')

  // 解密后立即切换到临时 userData；测试不改动用户的搜索缓存、项目库和界面状态。
  const sandboxUserData = join(tmpdir(), `shiji-radar-e2e-${Date.now()}`)
  app.setPath('userData', sandboxUserData)
  const workspaceRoot = join(sandboxUserData, 'workspace')
  const sessionRoot = join(sandboxUserData, 'sessions', 'dsh')
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(sessionRoot, { recursive: true })])

  const profile = {
    subjectType: 'enterprise',
    name: subjectName,
    businessRegions: [region],
    companyNature: '',
    scale: '',
    industries: ['建筑安装'],
    specialties: [specialty],
    qualifications: [],
    assetsAndEquipment: '',
    personnelAndExperience: '',
    deliveryBoundary: '',
    riskPreference: 'balanced',
  }
  const task = createDeepRadarTask(`real-radar-${Date.now()}`, '按当前保存的能力画像匹配商机', profile, 'doubao', 'tender', 'conditions')

  // 不接缓存：本次必须真实请求豆包一次，不能拿旧结果冒充验收。后续 DSH 复用这份发现结果，绝不发第二次搜索。
  const doubao = createDoubaoPort(async () => doubaoKey)
  const discoverLive = createOpportunityDiscoveryService(doubao, async () => 'doubao')
  const liveDiscovery = await discoverLive(task)
  check('豆包发生一次真实搜索调用', liveDiscovery.requestCount === 1 && liveDiscovery.cacheHit === false, JSON.stringify({ query: liveDiscovery.query, sourceCount: liveDiscovery.sources.length, requestCount: liveDiscovery.requestCount, cacheHit: liveDiscovery.cacheHit }))
  check('实际查询锁定南京而非北京', liveDiscovery.query.includes(region.replace(/市$/, '')) && !liveDiscovery.query.includes('北京'), liveDiscovery.query)

  const prepared = await prepareInstalledDshBackend({
    packageRoot: installedDshPackageRoot(appData),
    electronExecutable: process.execPath,
    workspaceRoot,
    sessionRoot,
    readDeepSeekKey: async () => deepseekKey,
    readDoubaoKey: async () => doubaoKey,
    discoverOpportunity: async () => liveDiscovery,
  })
  check('DSH 能力包可加载', prepared.available, prepared.available ? '' : prepared.reason)
  if (!prepared.available) throw new Error(prepared.reason)

  const events = []
  let smoke
  let result
  let dshError
  try {
    smoke = await prepared.testModel()
    check('DeepSeek 真实模型连接成功', smoke.connected === true, smoke.model)
    result = await prepared.runner.run(task, {
      timeoutMs: 180_000,
      onEvent: (event) => {
        events.push(event.message)
        console.log(`   ${event.message}`)
      },
    })
  } catch (error) {
    dshError = error instanceof Error ? error.message : String(error)
    check('DeepSeek 真实模型连接成功', false, dshError)
  }
  const opportunities = result?.opportunities ?? []
  const visible = eligibleDeepRadarOpportunities(profile, opportunities)
  const structured = opportunities.filter((item) => !item.reason.startsWith('来源线索卡片')).length
  const rejected = opportunities.filter((item) => !visible.some((entry) => entry.id === item.id))
  if (result) check('条件入口未调用 DSH 意图改写', !events.some((message) => message.includes('读取原始自由输入')), events.join(' | '))
  if (result) check('DSH 收到来源并完成结构化', structured > 0, `结构化=${structured}，总结果=${opportunities.length}`)
  if (result) check('雷达可见结果没有明确跨地区硬冲突', rejected.length === 0 || visible.length < opportunities.length, `剔除=${rejected.length}`)

  const report = {
    startedAt: new Date().toISOString(),
    input: { region, subjectName, specialty, inputMode: task.inputMode },
    dsh: { connected: smoke?.connected === true, model: smoke?.model, structuredCount: structured, error: dshError },
    discovery: { provider: liveDiscovery.provider, query: liveDiscovery.query, sourceCount: liveDiscovery.sources.length, requestCount: liveDiscovery.requestCount, cacheHit: liveDiscovery.cacheHit, checkedAt: liveDiscovery.checkedAt },
    counts: { rawOpportunities: opportunities.length, visibleOpportunities: visible.length, rejectedHardMismatch: rejected.length },
    visible: visible.map((item) => ({ title: item.title, companyName: item.companyName, locationAddress: item.locationAddress, confidence: item.confidence, evidenceCount: item.evidenceIds.length })),
    rejected: rejected.map((item) => ({ title: item.title, locationAddress: item.locationAddress })),
    events,
    finishedAt: new Date().toISOString(),
    failed,
  }
  const reportPath = join(artifacts, 'e2e-real-radar.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n真实雷达报告：${reportPath}`)
  console.log(failed === 0 ? '真实雷达验收通过。' : `真实雷达验收失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => {
  console.error('真实雷达验收异常：', error instanceof Error ? error.message : String(error))
  app.exit(2)
})
