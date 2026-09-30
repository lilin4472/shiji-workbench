// 精简真实验收探测：一个真实时间链项目 + 天地图地理编码和网页 SDK。
// 凭据从本机加密存储读取；只驻留进程内，报告不含任何 Key。
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDoubaoPort } from '../dist-electron/electron/doubao-provider.js'
import { SearchCache, createCachedSearchPort } from '../dist-electron/electron/search-cache.js'
import { SearchManager } from '../dist-electron/electron/search-manager.js'
import { createProjectTimelineDiscoveryService } from '../dist-electron/electron/project-timeline-service.js'
import { requestTiandituGeocode } from '../dist-electron/electron/tianditu-geocoder.js'

app.setName('shiji-workbench')
// Keep the E2E process alive after the hidden map window closes so the awaited
// report write completes; Electron otherwise auto-quits when the last window is destroyed.
app.on('window-all-closed', () => {})
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appData = join(process.env.APPDATA ?? '', 'shiji-workbench')
const credentialPath = join(appData, 'secure', 'credentials.v1.json')
const target = {
  id: 'acceptance-live-timeline-20260923',
  title: '金陵药业股份有限公司研发型中试生产车间改造项目机电安装工程招标公告',
  companyName: '金陵药业股份有限公司',
}
const mapCenterAddress = '南京市'
const projectAddress = '南京市江宁区正方中路166号'
const nowTag = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const reportPath = join(root, 'artifacts', `e2e-real-acceptance-smoke-${nowTag}.json`)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mapOnly = process.argv.includes('--map-only')
const safeReadKey = (credential, name) => {
  if (!credential?.encrypted) return undefined
  try { return safeStorage.decryptString(Buffer.from(credential.encrypted, 'base64')) }
  catch { throw new Error(`本机${name}无法解密；没有发起该服务调用。`) }
}

function distanceKm(a, b) {
  const radians = (value) => value * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(tk|key|api[_-]?key)=?[^\s&"']+/gi, '$1=[REDACTED]')
}

let exitCode = 0
app.whenReady().then(async () => {
  const report = {
    startedAt: new Date().toISOString(),
    target,
    credentials: { doubao: false, tiandituServer: false, tiandituWeb: false },
    timeline: { status: 'not-run' },
    map: { status: 'not-run' },
    boundaries: [
      '时间链使用真实豆包搜索，不调用 DSH 模型；本次最多发起 1 次时间链搜索。',
      '地图分别检查服务端地理编码与网页端 SDK/瓦片，不把坐标成功等同于底图可用。',
      '仅在报告中保留摘要、来源标题/URL 和调用数量；不保存正文或 Key。',
    ],
  }

  try {
    if (!existsSync(credentialPath)) throw new Error('没有找到识机本地加密凭据文件；未发起联网调用。')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储不可用；未发起联网调用。')
    const credentials = JSON.parse(await readFile(credentialPath, 'utf8'))
    const doubaoKey = safeReadKey(credentials.doubao, '豆包搜索 Key')
    const tiandituServerKey = safeReadKey(credentials.tiandituServer, '天地图服务端 Key')
    const tiandituWebKey = safeReadKey(credentials.tiandituWeb, '天地图网页端 Key')
    report.credentials = { doubao: Boolean(doubaoKey), tiandituServer: Boolean(tiandituServerKey), tiandituWeb: Boolean(tiandituWebKey) }
    if (!mapOnly && !doubaoKey) throw new Error('本机没有已保存的豆包搜索 Key；时间链未运行。')
    if (!tiandituServerKey) throw new Error('本机没有已保存的天地图服务端 Key；地图探测不能完成。')
    if (!tiandituWebKey) throw new Error('本机没有已保存的天地图网页端 Key；地图底图探测不能完成。')

    // 所有 Electron 个人数据路径切到临时目录；搜索缓存也仅使用内存实现。
    const isolatedUserData = join(app.getPath('temp'), `shiji-acceptance-${Date.now()}`)
    app.setPath('userData', isolatedUserData)

    if (mapOnly) {
      report.timeline = { status: 'skipped', reason: '本次只复核地图验收器，不重复调用搜索服务。' }
    } else {
      let cacheText
      const cache = new SearchCache({ read: async () => cacheText, write: async (value) => { cacheText = value } })
      const manager = new SearchManager()
      manager.register('doubao', createCachedSearchPort(createDoubaoPort(async () => doubaoKey), cache, { provider: 'doubao', ttlMs: 0 }))
      const timeline = createProjectTimelineDiscoveryService((request) => manager.search(request), async () => 'doubao')
      const startedTimeline = Date.now()
      try {
        const value = await timeline({
          opportunityId: target.id,
          projectTitle: target.title,
          companyName: target.companyName,
          knownIdentifiers: [],
          mode: 'full',
        })
        report.timeline = {
          status: 'completed',
          provider: value.provider,
          query: value.query,
          requestCount: value.requestCount,
          cacheHit: value.cacheHit,
          durationMs: Date.now() - startedTimeline,
          evidenceCount: value.evidenceRecords.length,
          confirmedStageEvidence: value.confirmedStageEvidence.map(({ stageId, occurredAt, title, source }) => ({ stageId, occurredAt, title, source })),
          candidateCount: value.candidateEvidenceIds.length,
          rejectedCount: value.rejectedEvidenceIds.length,
          sources: value.evidenceRecords.slice(0, 5).map((record) => ({ title: record.title, publisher: record.provenance.publisher, url: record.provenance.pageUrl ?? null })),
          evidenceGateDiagnostics: value.evidenceRecords.map((record) => ({
            title: record.title,
            url: record.provenance.pageUrl ?? null,
            processingStatus: record.artifact.processingStatus,
            grade: record.assessment.grade ?? null,
            permittedUses: record.assessment.permittedUses ?? [],
            missingChecks: record.assessment.missingChecks,
            stageIds: record.opportunityDetails?.stageIds ?? [],
            stageDateCandidates: record.opportunityDetails?.stageDateCandidates ?? [],
            subjectCandidates: record.opportunityDetails?.subjectCandidates ?? [],
          })),
          boundary: value.boundary,
        }
      } catch (error) {
        report.timeline = { status: 'failed', message: redactError(error), durationMs: Date.now() - startedTimeline }
        exitCode = 1
      }
    }

    const geocodes = {}
    for (const address of [mapCenterAddress, projectAddress]) {
      const started = Date.now()
      try {
        geocodes[address] = { ...(await requestTiandituGeocode(tiandituServerKey, address)), durationMs: Date.now() - started, status: 'located' }
      } catch (error) {
        geocodes[address] = { status: 'failed', message: redactError(error), durationMs: Date.now() - started }
        exitCode = 1
      }
    }
    const center = geocodes[mapCenterAddress]
    const project = geocodes[projectAddress]
    const distance = center.status === 'located' && project.status === 'located' ? distanceKm(center, project) : undefined
    report.map.geocoding = {
      centerAddress: mapCenterAddress,
      center: center.status === 'located' ? { longitude: center.longitude, latitude: center.latitude } : center,
      projectAddress,
      project: project.status === 'located' ? { longitude: project.longitude, latitude: project.latitude } : project,
      distanceKm: distance === undefined ? null : Number(distance.toFixed(2)),
      within100Km: distance === undefined ? null : distance <= 100,
    }

    ipcMain.handle('e2e-map:read-web-key', async () => ({ ok: true, value: { apiKey: tiandituWebKey } }))
    ipcMain.handle('e2e-map:geocode', async (_event, address) => {
      if (typeof address !== 'string' || !address.trim()) return { ok: false, message: '测试地址为空。' }
      try { return { ok: true, value: await requestTiandituGeocode(tiandituServerKey, address) } }
      catch (error) { return { ok: false, message: redactError(error) } }
    })

    const mapWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const mapHtml = join(root, 'scripts', 'tianditu-map-smoke.html')
    const mapStarted = Date.now()
    try {
      await mapWindow.loadFile(mapHtml)
      if (center.status !== 'located' || project.status !== 'located') throw new Error('坐标未成功返回，跳过地图 SDK 初始化。')
      const encodedKey = JSON.stringify(tiandituWebKey)
      const encodedCenter = JSON.stringify(center)
      const encodedProject = JSON.stringify(project)
      await mapWindow.webContents.executeJavaScript(`(async () => {
        const status = document.getElementById('status')
        const key = ${encodedKey}
        const urls = [
          'https://api.tianditu.gov.cn/api?v=4.0&tk=' + encodeURIComponent(key),
          'https://api.tianditu.gov.cn/api/v4/jsapi?tk=' + encodeURIComponent(key),
        ]
        const loadScript = (url) => new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = url
          script.async = true
          script.referrerPolicy = 'origin'
          script.onload = () => window.T?.Map ? resolve() : reject(new Error('脚本加载成功但未创建 T.Map'))
          script.onerror = () => reject(new Error('官方地图脚本加载失败'))
          document.head.appendChild(script)
        })
        let lastError
        for (const url of urls) { try { await loadScript(url); lastError = undefined; break } catch (error) { lastError = error } }
        if (lastError) throw lastError
        await new Promise((resolve) => setTimeout(resolve, 100))
        const map = new T.Map('map')
        const center = ${encodedCenter}
        const project = ${encodedProject}
        map.centerAndZoom(new T.LngLat(center.longitude, center.latitude), 10)
        map.addOverLay(new T.Marker(new T.LngLat(center.longitude, center.latitude)))
        map.addOverLay(new T.Marker(new T.LngLat(project.longitude, project.latitude)))
        status.textContent = 'sdk-ready'
        return { sdkReady: true }
      })()`, true)
      await pause(7000)
      const dom = await mapWindow.webContents.executeJavaScript(`(() => ({
        status: document.getElementById('status')?.textContent ?? '',
        mapChildren: document.getElementById('map')?.children.length ?? 0,
        images: [...document.querySelectorAll('#map img')].map((image) => ({ loaded: image.complete && image.naturalWidth > 0, width: image.naturalWidth, srcHost: (() => { try { return new URL(image.src).hostname } catch { return '' } })() })),
        canvases: document.querySelectorAll('#map canvas').length,
      }))()`)
      const loadedTiles = dom.images.filter((image) => image.loaded && /tianditu\.gov\.cn$/.test(image.srcHost)).length
      report.map.sdk = {
        ...dom,
        status: loadedTiles > 0 || dom.canvases > 0 ? 'rendered' : 'sdk-loaded-no-tile-evidence',
        durationMs: Date.now() - mapStarted,
        loadedTiandituImages: loadedTiles,
        imageHosts: [...new Set(dom.images.map((image) => image.srcHost))],
        imageCount: dom.images.length,
      }
      delete report.map.sdk.images
      const screenshot = await mapWindow.webContents.capturePage()
      const screenshotPath = join(root, 'artifacts', `e2e-real-tianditu-map-${nowTag}.png`)
      await mkdir(dirname(screenshotPath), { recursive: true })
      await writeFile(screenshotPath, screenshot.toPNG())
      report.map.screenshot = screenshotPath
      if (loadedTiles === 0 && dom.canvases === 0) exitCode = 1
    } catch (error) {
      report.map.sdk = { status: 'failed', message: redactError(error), durationMs: Date.now() - mapStarted }
      exitCode = 1
    } finally {
      if (!mapWindow.isDestroyed()) mapWindow.destroy()
    }

    // 再走真实应用组件路径：真实本机 Key + 真实地理编码 IPC + Nearby/TiandituMap。
    // 项目只取自前一轮真实附近搜索的标题、主体、地址；本测试不重复搜索。
    if (center.status === 'located' && project.status === 'located') {
      const appWindow = new BrowserWindow({
        width: 1720,
        height: 1080,
        show: false,
        webPreferences: {
          preload: join(root, 'scripts', 'e2e-real-map-preload.cjs'),
          partition: `e2e-map-${Date.now()}`,
          contextIsolation: false,
          nodeIntegration: false,
          sandbox: false,
        },
      })
      const appStarted = Date.now()
      try {
        await appWindow.loadFile(join(root, 'dist', 'index.html'))
        const liveNearbyOpportunity = {
          id: 'live-nearby-map-project',
          title: '(江宁分中心) 11号厂房2层及5层机电及净化安装工程施工招标公告',
          companyId: 'live-nearby-map-owner',
          companyName: '中国电子科技集团公司第五十五研究所',
          amountWan: null,
          locationAddress: projectAddress,
          locationPoint: { longitude: project.longitude, latitude: project.latitude },
          distanceKm: Number(distance.toFixed(2)),
          deadline: null,
          matchScore: 75,
          projectType: '机电安装',
          reason: '使用真实附近搜索结果中的公告项目地址测试地图定位。',
          evidenceIds: [],
          followUpLevel: '值得验证',
          confidence: '中',
          timelineEvidence: [],
        }
        const catalog = { version: 1, records: { [liveNearbyOpportunity.id]: liveNearbyOpportunity }, currentResultIds: [liveNearbyOpportunity.id], currentEvidenceIds: [], lifecycle: {} }
        const profile = { targetCompanyName: '', targetProjectName: '', address: mapCenterAddress, radiusKm: 100, specialty: '机电安装', amountMin: 0, amountMax: 9000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 10 }
        await appWindow.webContents.executeJavaScript(`(() => {
          localStorage.setItem('shiji.opportunity-catalog.v1', ${JSON.stringify(JSON.stringify(catalog))})
          localStorage.setItem('shiji.search-evidence.v2', '[]')
          localStorage.setItem('shiji.analysis-selection.v1', '[]')
          localStorage.setItem('shiji.analysis-runs.v1', '[]')
          localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'nearby' }))})
          localStorage.setItem('shiji.opportunity-search-criteria.v1', ${JSON.stringify(JSON.stringify(profile))})
          localStorage.setItem('shiji.color-theme.v1', 'current')
          return true
        })()`)
        await appWindow.webContents.reload()
        const uiDeadline = Date.now() + 25_000
        let appMap
        while (Date.now() < uiDeadline) {
          appMap = await appWindow.webContents.executeJavaScript(`(() => {
            const status = document.querySelector('.tianditu-map-status')?.textContent ?? ''
            const surface = document.querySelector('.tianditu-map-surface')
            const images = [...(surface?.querySelectorAll('img') ?? [])]
            return {
              status,
              mapReady: Boolean(document.querySelector('.map-canvas.tianditu-map.ready')),
              fallback: Boolean(document.querySelector('.tianditu-unavailable')),
              loadedTiles: images.filter((image) => image.complete && image.naturalWidth > 0).length,
              imageCount: images.length,
              resultAddress: document.querySelector('.tender-address')?.textContent ?? '',
            }
          })()`)
          if (appMap.mapReady || appMap.fallback) break
          await pause(500)
        }
        await pause(2500)
        appMap = await appWindow.webContents.executeJavaScript(`(() => {
          const status = document.querySelector('.tianditu-map-status')?.textContent ?? ''
          const surface = document.querySelector('.tianditu-map-surface')
          const images = [...(surface?.querySelectorAll('img') ?? [])]
          return {
            status,
            mapReady: Boolean(document.querySelector('.map-canvas.tianditu-map.ready')),
            fallback: Boolean(document.querySelector('.tianditu-unavailable')),
            loadedTiles: images.filter((image) => image.complete && image.naturalWidth > 0).length,
            imageCount: images.length,
            resultAddress: document.querySelector('.tender-address')?.textContent ?? '',
          }
        })()`)
        const appScreenshot = join(root, 'artifacts', `e2e-real-tianditu-app-${nowTag}.png`)
        await writeFile(appScreenshot, (await appWindow.webContents.capturePage()).toPNG())
        report.map.application = { ...appMap, status: appMap.mapReady && appMap.loadedTiles > 0 && appMap.status.includes('中心已定位') && appMap.status.includes('1 条按公告项目地址定位') ? 'passed' : 'failed', durationMs: Date.now() - appStarted, screenshot: appScreenshot }
        if (report.map.application.status !== 'passed') exitCode = 1
      } catch (error) {
        report.map.application = { status: 'failed', message: redactError(error), durationMs: Date.now() - appStarted }
        exitCode = 1
      } finally {
        if (!appWindow.isDestroyed()) appWindow.destroy()
      }
    } else {
      report.map.application = { status: 'skipped', reason: '地址没有成功编码，不能验证应用地图组件。' }
    }
    report.map.status = report.map.sdk?.status === 'rendered'
      && report.map.geocoding?.center?.longitude !== undefined
      && report.map.geocoding?.project?.longitude !== undefined
      && report.map.application?.status === 'passed'
      ? 'passed'
      : 'failed'
    report.finishedAt = new Date().toISOString()
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify({ reportPath, timeline: report.timeline, map: report.map, credentials: report.credentials }, null, 2))
  } catch (error) {
    report.error = redactError(error)
    report.finishedAt = new Date().toISOString()
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.error(JSON.stringify({ reportPath, error: report.error, credentials: report.credentials }, null, 2))
    exitCode = 1
  }
  app.exit(exitCode)
}).catch((error) => {
  console.error(redactError(error))
  app.exit(1)
})
