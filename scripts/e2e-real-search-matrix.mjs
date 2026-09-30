// 真实搜索验收矩阵：雷达/附近 × 条件栏/自由输入；每条路径最多要求 3 个结果。
// Key 仅从 Windows safeStorage 短暂解密并留在进程内，输出报告不包含 Key。
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

app.setName('shiji-workbench')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts')
const appData = join(process.env.APPDATA ?? '', 'shiji-workbench')
const credentialPath = join(appData, 'secure', 'credentials.v1.json')
const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const region = arg('region', '南京市')
const company = arg('name', '思杰')
const specialty = arg('specialty', '机电安装')
const count = Number(arg('count', '3'))
const limit = Number.isInteger(count) && count >= 1 && count <= 20 ? count : 3
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
let failed = 0
const check = (label, passed, detail = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${passed || !detail ? '' : `\n        -> ${detail}`}`)
  if (!passed) failed += 1
}
const decrypt = (entry) => entry?.encrypted
  ? safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64')).trim()
  : ''

app.whenReady().then(async () => {
  await mkdir(artifacts, { recursive: true })
  if (!existsSync(credentialPath)) throw new Error('没有找到识机本机加密凭据。')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本机 Key。')
  const credentialFile = JSON.parse(await readFile(credentialPath, 'utf8'))
  const doubaoKey = decrypt(credentialFile.doubao)
  const deepseekKey = decrypt(credentialFile.deepseek)
  check('豆包搜索 Key 已配置并可安全读取', doubaoKey.length > 8)
  check('DeepSeek Key 已配置并可安全读取', deepseekKey.length > 8)
  if (!doubaoKey || !deepseekKey) throw new Error('真实矩阵测试需要已配置的豆包搜索与 DeepSeek Key。')

  // 使用隔离 userData，避免改动用户项目库、缓存、画像或工作区。
  const sandbox = join(tmpdir(), `shiji-search-matrix-${Date.now()}`)
  app.setPath('userData', sandbox)
  const workspaceRoot = join(sandbox, 'workspace')
  const sessionRoot = join(sandbox, 'sessions', 'dsh')
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(sessionRoot, { recursive: true })])

  const profile = {
    subjectType: 'enterprise', name: company, businessRegions: [region], companyNature: '', scale: '',
    industries: ['建筑安装'], specialties: [specialty], qualifications: [], assetsAndEquipment: '',
    personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
  }
  const criteria = {
    targetCompanyName: '', targetProjectName: '', address: region, radiusKm: 100, specialty,
    amountMin: 0, amountMax: 999999999, projectType: '不限', timeWindow: '未来90天',
    targetStageId: 'tender', candidateLimit: 5,
  }
  const doubao = createDoubaoPort(async () => doubaoKey)
  const discoverOpportunity = createOpportunityDiscoveryService(doubao, async () => 'doubao')
  const prepared = await prepareInstalledDshBackend({
    packageRoot: installedDshPackageRoot(appData),
    electronExecutable: process.execPath,
    workspaceRoot,
    sessionRoot,
    readDeepSeekKey: async () => deepseekKey,
    readDoubaoKey: async () => doubaoKey,
    discoverOpportunity,
    // This matrix isolates search/structure routing. It does not test geocoding or map display.
  })
  check('已加载锁定版本的 DSH 能力包', prepared.available, prepared.available ? '' : prepared.reason)
  if (!prepared.available) throw new Error(prepared.reason)

  const modes = ['conditions', 'free']
  const areas = ['radar', 'nearby']
  const results = []
  for (const area of areas) {
    for (const inputMode of modes) {
      const id = `real-${area}-${inputMode}-${Date.now()}`
      const prompt = inputMode === 'free'
        ? `${region}附近未来90天内，${specialty}专业的招标项目，最多${limit}个。`
        : `按已锁定的 ${region} / ${specialty} / 未来90天 / 招标阶段条件搜索，最多${limit}个。`
      const task = area === 'radar'
        ? createDeepRadarTask(id, prompt, profile, 'doubao', 'tender', inputMode)
        : { id, kind: 'nearby-enterprise-search', prompt, criteria, inputMode, searchProvider: 'doubao' }
      task.requestedCount = limit
      const events = []
      console.log(`\n运行真实路径：${area} / ${inputMode} / 最多 ${limit} 个`)
      let result
      let error
      try {
        result = await prepared.runner.run(task, {
          timeoutMs: 240_000,
          onEvent: (event) => {
            events.push(event.message)
            console.log(`   ${event.message}`)
          },
        })
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
        console.log(`   路径失败：${error}`)
      }
      const discovery = result?.discovery
      const opportunities = result?.opportunities ?? []
      const actualIntent = events.some((message) => message.includes('读取原始自由输入'))
      check(`${area}/${inputMode} 使用预期入口`, inputMode === 'free' ? actualIntent : !actualIntent, events.slice(0, 3).join(' | '))
      check(`${area}/${inputMode} 执行了新的真实豆包搜索`, discovery?.requestCount > 0 && discovery?.cacheHit === false, JSON.stringify(discovery ?? { error }))
      check(`${area}/${inputMode} DSH 返回了结构化结果或可追溯来源线索`, opportunities.length > 0, error ?? `结果=${opportunities.length}`)
      const structuredCount = opportunities.filter((item) => !item.reason.startsWith('来源线索卡片')).length
      results.push({ area, inputMode, requestedCount: limit, search: discovery, resultCount: opportunities.length, structuredCount, opportunities: opportunities.map((item) => ({ title: item.title, companyName: item.companyName, locationAddress: item.locationAddress, confidence: item.confidence, evidenceCount: item.evidenceIds.length })), events, error })
      console.log(`   汇总：搜索调用=${discovery?.requestCount ?? 0}，来源=${discovery?.sourceCount ?? 0}，结果=${opportunities.length}，结构化=${structuredCount}`)
    }
  }

  const reportPath = join(artifacts, `e2e-real-search-matrix-${timestamp}.json`)
  await writeFile(reportPath, JSON.stringify({ startedAt: timestamp, input: { region, company, specialty, requestedCount: limit }, results, failed, finishedAt: new Date().toISOString() }, null, 2), 'utf8')
  console.log(`\n真实搜索矩阵报告：${reportPath}`)
  console.log(failed === 0 ? '真实搜索矩阵通过。' : `真实搜索矩阵有 ${failed} 项未通过。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => {
  console.error('真实搜索矩阵异常：', error instanceof Error ? error.message : String(error))
  app.exit(2)
})
