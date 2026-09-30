import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DshRuntimeIdentity } from './dsh-runtime-controller.js'

const MANIFEST_NAME = 'manifest.json'
const REQUIRED_PATHS = {
  runtimeEntry: 'node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js',
  config: 'cordis.yml',
  sdkClient: 'node/sdk-client/index.js',
} as const

export interface DshCapabilityLock {
  dshVersion: string
  nodeVersion: string
  runtimeIdentity: DshRuntimeIdentity
  fileCount: number
  treeSha256: string
}

export const DSH_CAPABILITY_VERSION = {
  dshVersion: '0.1.1-rc.2',
  nodeVersion: '24.20.0',
  runtimeIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
} as const

export interface DshCapabilityManifest extends DshCapabilityLock {
  schemaVersion: 1
  fileCount: number
  treeSha256: string
}

export interface DshCapabilityPackage {
  root: string
  manifest: DshCapabilityManifest
  runtimeEntry: string
  config: string
  sdkClient: string
}

export type DshCapabilityInspection =
  | { available: true; package: DshCapabilityPackage }
  | { available: false; code: 'not-installed' | 'manifest-invalid' | 'version-incompatible' | 'package-corrupt'; message: string }

export interface CapabilityTreeDigest {
  fileCount: number
  treeSha256: string
}

export async function computeCapabilityTreeDigest(root: string): Promise<CapabilityTreeDigest> {
  const resolvedRoot = path.resolve(root)
  const files: string[] = []
  await collectFiles(resolvedRoot, resolvedRoot, files)
  files.sort((left, right) => left.localeCompare(right, 'en'))
  const tree = createHash('sha256')
  for (const relativePath of files) {
    const absolutePath = resolveInside(resolvedRoot, relativePath)
    const content = await readFile(absolutePath)
    const digest = createHash('sha256').update(content).digest('hex')
    tree.update(relativePath.replaceAll(path.sep, '/'))
    tree.update('\0')
    tree.update(String(content.byteLength))
    tree.update('\0')
    tree.update(digest)
    tree.update('\n')
  }
  return { fileCount: files.length, treeSha256: tree.digest('hex') }
}

export async function inspectDshCapabilityPackage(
  root: string,
  lock: DshCapabilityLock,
): Promise<DshCapabilityInspection> {
  const resolvedRoot = path.resolve(root)
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(await readFile(path.join(resolvedRoot, MANIFEST_NAME), 'utf8'))
  } catch (error) {
    if (isFileMissing(error)) return { available: false, code: 'not-installed', message: '未安装 DSH 可选能力包。' }
    return { available: false, code: 'manifest-invalid', message: 'DSH 能力包清单无法读取。' }
  }
  if (!isManifest(manifestValue)) {
    return { available: false, code: 'manifest-invalid', message: 'DSH 能力包清单格式无效。' }
  }
  if (manifestValue.dshVersion !== lock.dshVersion
    || manifestValue.nodeVersion !== lock.nodeVersion
    || manifestValue.runtimeIdentity.name !== lock.runtimeIdentity.name
    || manifestValue.runtimeIdentity.version !== lock.runtimeIdentity.version
    || manifestValue.fileCount !== lock.fileCount
    || manifestValue.treeSha256 !== lock.treeSha256) {
    return { available: false, code: 'version-incompatible', message: 'DSH 能力包版本与当前识机版本不兼容。' }
  }

  try {
    for (const relativePath of Object.values(REQUIRED_PATHS)) {
      const metadata = await lstat(resolveInside(resolvedRoot, relativePath))
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('required path is not a regular file')
    }
    const digest = await computeCapabilityTreeDigest(resolvedRoot)
    if (digest.fileCount !== manifestValue.fileCount || digest.treeSha256 !== manifestValue.treeSha256) {
      throw new Error('tree digest mismatch')
    }
  } catch {
    return { available: false, code: 'package-corrupt', message: 'DSH 能力包文件缺失或完整性校验失败。' }
  }

  return {
    available: true,
    package: {
      root: resolvedRoot,
      manifest: manifestValue,
      runtimeEntry: resolveInside(resolvedRoot, REQUIRED_PATHS.runtimeEntry),
      config: resolveInside(resolvedRoot, REQUIRED_PATHS.config),
      sdkClient: resolveInside(resolvedRoot, REQUIRED_PATHS.sdkClient),
    },
  }
}

async function collectFiles(root: string, directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) throw new Error('symbolic links are not allowed in a capability package')
    if (metadata.isDirectory()) {
      await collectFiles(root, absolutePath, files)
    } else if (metadata.isFile()) {
      const relativePath = path.relative(root, absolutePath)
      if (relativePath !== MANIFEST_NAME) files.push(relativePath)
    } else {
      throw new Error('unsupported filesystem entry in capability package')
    }
  }
}

function resolveInside(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath)
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) throw new Error('path escapes capability root')
  return absolutePath
}

function isManifest(value: unknown): value is DshCapabilityManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.fileCount) || (value.fileCount as number) < 1) return false
  if (typeof value.treeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.treeSha256)) return false
  return typeof value.dshVersion === 'string'
    && typeof value.nodeVersion === 'string'
    && isRecord(value.runtimeIdentity)
    && typeof value.runtimeIdentity.name === 'string'
    && typeof value.runtimeIdentity.version === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
