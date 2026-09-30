import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { inspectDshCapabilityPackage } from '../dist-electron/electron/dsh-capability-package.js'
import { DSH_RELEASE_LOCK } from '../dist-electron/electron/dsh-release-lock.js'
import { scrubRuntimeEnvironment } from '../dist-electron/electron/dsh-runtime-controller.js'

const packageRoot = path.resolve(process.argv[2] ?? '')
const electron = path.resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node scripts/verify-dsh-capability.mjs <package-root> <electron-executable>')
}

const inspection = await inspectDshCapabilityPackage(packageRoot, DSH_RELEASE_LOCK)
if (!inspection.available) throw new Error(`${inspection.code}: ${inspection.message}`)

const sdkModule = await import(pathToFileURL(inspection.package.sdkClient).href)
if (typeof sdkModule.HarnessClient !== 'function') throw new Error('official SDK Client export is missing')

const workspace = await mkdtemp(path.join(tmpdir(), 'shiji-dsh-installed-'))
const env = scrubRuntimeEnvironment(process.env)
Object.assign(env, {
  ELECTRON_RUN_AS_NODE: '1',
  DSH_CORDIS_CONFIG: inspection.package.config,
  DSH_CWD: workspace,
  DSH_SESSION_ROOT: path.join(workspace, 'sessions'),
})
delete env.DEEPSEEK_API_KEY

const client = new sdkModule.HarnessClient({
  command: electron,
  args: [inspection.package.runtimeEntry],
  cwd: workspace,
  env,
  requestTimeoutMs: 30_000,
})

const started = performance.now()
try {
  client.start()
  const result = await client.initialize({ cwd: workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  if (result.serverInfo.name !== DSH_RELEASE_LOCK.runtimeIdentity.name
    || result.serverInfo.version !== DSH_RELEASE_LOCK.runtimeIdentity.version) {
    throw new Error('installed runtime identity mismatch')
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    identity: result.serverInfo,
    initializeMs: Math.round(performance.now() - started),
    apiKeyPresent: Object.hasOwn(env, 'DEEPSEEK_API_KEY'),
    packageRoot,
  })}\n`)
} finally {
  await client.close().catch(() => {})
  await rm(workspace, { recursive: true, force: true })
}
