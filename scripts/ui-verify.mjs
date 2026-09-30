// 界面级自测：加载 dist 构建产物，用真实 DOM 点击验证「取消跟踪」两步确认  整行消失。
// 运行：node_modules\electron\dist\electron.exe scripts\ui-verify.mjs
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

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 980, show: false,
    webPreferences: {
      preload: join(root, 'scripts', 'ui-verify-preload.cjs'),
      contextIsolation: false, nodeIntegration: false, sandbox: false,
    },
  })
  const wc = win.webContents
  const consoleErrors = []
  wc.on('console-message', (_event, level, message) => { if (level >= 2) consoleErrors.push(message) })

  await wc.loadFile(join(root, 'dist', 'index.html'))

  const watch = {
    id: 'watch-verify-e2e', opportunityId: 'verify-e2e', title: 'E2E 验证项目  取消跟踪',
    status: 'active', checkCadence: 'on-launch', createdAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(), lastKnownStageId: 'tender',
  }
  await wc.executeJavaScript(`(() => {
    localStorage.setItem('shiji.project-watches.v1', ${JSON.stringify(JSON.stringify([watch]))});
    localStorage.setItem('shiji.workspace.v3', ${JSON.stringify(JSON.stringify({ activeView: 'watch' }))});
    return true
  })()`)
  await wc.reload()
  await sleep(1500)

  const rowCount = await wc.executeJavaScript(`document.querySelectorAll('.watch-list article').length`)
  check('跟踪页渲染出预置的 1 行订阅', rowCount === 1, `行数=${rowCount}`)

  const labels = await wc.executeJavaScript(`[...document.querySelectorAll('.watch-list article .watch-actions button')].map((b) => b.textContent.trim())`)
  check('行内三颗按钮齐全（立即检查 / 暂停 / 取消跟踪）', labels.length === 3 && labels.some((t) => t.includes('取消')), JSON.stringify(labels))

  await wc.executeJavaScript(`(() => { const b = document.querySelector('.watch-list article .remove-watch'); if (b) b.click(); return true })()`)
  await sleep(300)
  const firstLabel = await wc.executeJavaScript(`(() => { const b = document.querySelector('.watch-list article .remove-watch'); return b ? b.textContent.trim() : null })()`)
  check('第一次点击进入确认态（文案 = 确认取消？）', firstLabel === '确认取消？', JSON.stringify(firstLabel))

  await wc.executeJavaScript(`(() => { const b = document.querySelector('.watch-list article .remove-watch'); if (b) b.click(); return true })()`)
  await sleep(400)
  const afterRows = await wc.executeJavaScript(`document.querySelectorAll('.watch-list article').length`)
  const stored = await wc.executeJavaScript(`localStorage.getItem('shiji.project-watches.v1')`)
  check('第二次点击后该行整行消失', afterRows === 0, `行数=${afterRows}`)
  check('本机存储中的订阅已删除', stored === '[]' || stored === null, String(stored))

  try {
    const image = await wc.capturePage()
    writeFileSync(join(artifacts, 'ui-verify-watch-cancel.png'), image.toPNG())
    console.log('截图: artifacts/ui-verify-watch-cancel.png')
  } catch (error) {
    console.log('截图失败: ' + error.message)
  }

  if (consoleErrors.length > 0) {
    console.log('渲染层控制台错误(前5条):')
    consoleErrors.slice(0, 5).forEach((m) => console.log('  ! ' + m))
  }
  console.log('')
  console.log(failed === 0 ? '界面级验证通过：取消跟踪端到端可用。' : `界面级验证失败 ${failed} 项。`)
  app.exit(failed === 0 ? 0 : 1)
}).catch((error) => {
  console.error('E2E 运行异常:', error)
  app.exit(2)
})