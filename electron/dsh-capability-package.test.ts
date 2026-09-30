import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  computeCapabilityTreeDigest,
  inspectDshCapabilityPackage,
  type DshCapabilityLock,
} from './dsh-capability-package'

const versionLock = {
  dshVersion: '0.1.1-rc.2',
  nodeVersion: '24.20.0',
  runtimeIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
}
const roots: string[] = []

async function createPackage(): Promise<{ root: string; lock: DshCapabilityLock }> {
  const root = await mkdtemp(path.join(tmpdir(), 'shiji-dsh-package-'))
  roots.push(root)
  const files = {
    'node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js': 'runtime',
    'node/sdk-client/index.js': 'client',
    'cordis.yml': 'config',
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content)
  }
  const digest = await computeCapabilityTreeDigest(root)
  const lock = { ...versionLock, ...digest }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, ...lock }))
  return { root, lock }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH capability package inspection', () => {
  it('accepts a locked package with a matching full-tree digest', async () => {
    const { root, lock } = await createPackage()
    const result = await inspectDshCapabilityPackage(root, lock)
    expect(result).toMatchObject({ available: true, package: { root } })
  })

  it('distinguishes a missing package from a malformed manifest', async () => {
    const missing = path.join(tmpdir(), `dsh-missing-${Date.now()}`)
    const missingLock = { ...versionLock, fileCount: 1, treeSha256: '0'.repeat(64) }
    await expect(inspectDshCapabilityPackage(missing, missingLock)).resolves.toMatchObject({ available: false, code: 'not-installed' })
    const { root, lock } = await createPackage()
    await writeFile(path.join(root, 'manifest.json'), '{}')
    await expect(inspectDshCapabilityPackage(root, lock)).resolves.toMatchObject({ available: false, code: 'manifest-invalid' })
  })

  it('rejects incompatible DSH, Node, or runtime identity versions', async () => {
    const { root, lock } = await createPackage()
    await expect(inspectDshCapabilityPackage(root, { ...lock, nodeVersion: '24.21.0' }))
      .resolves.toMatchObject({ available: false, code: 'version-incompatible' })
  })

  it('rejects changed, missing, or extra files', async () => {
    const { root: changed, lock: changedLock } = await createPackage()
    await writeFile(path.join(changed, 'cordis.yml'), 'changed')
    await expect(inspectDshCapabilityPackage(changed, changedLock)).resolves.toMatchObject({ available: false, code: 'package-corrupt' })

    const { root: extra, lock: extraLock } = await createPackage()
    await writeFile(path.join(extra, 'unexpected.js'), 'extra')
    await expect(inspectDshCapabilityPackage(extra, extraLock)).resolves.toMatchObject({ available: false, code: 'package-corrupt' })
  })

  it('rejects symbolic links instead of following them outside the package', async () => {
    const { root, lock } = await createPackage()
    const external = path.join(root, '..', `external-${Date.now()}.txt`)
    await writeFile(external, 'outside')
    try {
      await symlink(external, path.join(root, 'linked.txt'))
      await expect(inspectDshCapabilityPackage(root, lock)).resolves.toMatchObject({ available: false, code: 'package-corrupt' })
    } finally {
      await rm(external, { force: true })
    }
  })
})
