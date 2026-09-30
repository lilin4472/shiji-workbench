import { execFileSync } from 'node:child_process'
import { cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { computeCapabilityTreeDigest, DSH_CAPABILITY_VERSION } from '../dist-electron/electron/dsh-capability-package.js'

const sourceRoot = path.resolve(process.argv[2] ?? '')
const outputRoot = path.resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node scripts/build-dsh-capability.mjs <dsh-source-root> <output-root>')
}

const expectedTag = `dsh-v${DSH_CAPABILITY_VERSION.dshVersion}`
const actualTag = execFileSync('git', ['-C', sourceRoot, 'describe', '--tags', '--exact-match'], { encoding: 'utf8' }).trim()
if (actualTag !== expectedTag) throw new Error(`DSH source tag mismatch: expected ${expectedTag}, received ${actualTag}`)

const stageNode = path.join(sourceRoot, 'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node')
const config = path.join(sourceRoot, 'python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml')
const sdkClient = path.join(sourceRoot, 'packages/sdk/client/lib/index.js')
await Promise.all([stageNode, config, sdkClient].map(async required => {
  const metadata = await stat(required)
  if (!metadata.isFile() && !metadata.isDirectory()) throw new Error(`invalid required source: ${required}`)
}))

try {
  await stat(outputRoot)
  throw new Error(`output already exists: ${outputRoot}`)
} catch (error) {
  if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
}

const partialRoot = `${outputRoot}.partial-${process.pid}`
await mkdir(path.dirname(outputRoot), { recursive: true })
try {
  await cp(stageNode, path.join(partialRoot, 'node'), { recursive: true, dereference: false, errorOnExist: true })
  await cp(config, path.join(partialRoot, 'cordis.yml'))
  await mkdir(path.join(partialRoot, 'node/sdk-client'), { recursive: true })
  await cp(sdkClient, path.join(partialRoot, 'node/sdk-client/index.js'))

  const digest = await computeCapabilityTreeDigest(partialRoot)
  const manifest = { schemaVersion: 1, ...DSH_CAPABILITY_VERSION, ...digest }
  await writeFile(path.join(partialRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(partialRoot, outputRoot)
  process.stdout.write(`${JSON.stringify({ outputRoot, ...manifest })}\n`)
} catch (error) {
  await rm(partialRoot, { recursive: true, force: true })
  throw error
}
