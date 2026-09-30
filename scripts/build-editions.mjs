import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Arch, Platform, build } from 'electron-builder'

const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outputArgumentIndex = process.argv.findIndex((argument) => argument === '--output')
const outputArgument = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined
if (outputArgumentIndex >= 0 && !outputArgument) throw new Error('--output 后必须提供目录')
const trialOnly = process.argv.includes('--trial-only')
const fullOnly = process.argv.includes('--full-only')
if (trialOnly && fullOnly) throw new Error('不能同时指定 trial-only 与 full-only')
const trialArtifactName = `Shiji-Trial-Setup-${pkg.version}-r2-x64.exe`
const outputRoot = path.resolve(outputArgument || process.env.SHIJI_RELEASE_OUTPUT || path.join(root, 'release'))
const trialOutputRoot = path.join(outputRoot, 'trial-build')
let packagedDshRoot
let dshStagingRoot
const capability = process.env.SHIJI_DSH_PACKAGE
  || path.join(process.env.APPDATA || '', 'shiji-workbench', 'capabilities', 'dsh', '0.1.1-rc.2')

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

run('npm', ['run', 'typecheck'])
run('npm', ['run', 'build'])
run('npm', ['run', 'build:electron'])
if (!fullOnly) run('npx', ['vite', 'build', '--config', 'vite.trial.config.ts', '--mode', 'trial'])

const { computeCapabilityTreeDigest, inspectDshCapabilityPackage } = await import('../dist-electron/electron/dsh-capability-package.js')
const { DSH_PACKAGED_RELEASE_LOCK, DSH_RELEASE_LOCK } = await import('../dist-electron/electron/dsh-release-lock.js')
if (!trialOnly) {
  if (!existsSync(path.join(root, 'licenses', 'shiji-license-public.pem'))) throw new Error('正式包缺少离线授权公钥；先运行 node scripts/license-admin.mjs generate。')
  const inspection = await inspectDshCapabilityPackage(capability, DSH_RELEASE_LOCK)
  if (!inspection.available) throw new Error(`正式包不能构建：${inspection.message}`)

  // The full DSH development tree includes declaration/source-map data and ARM64
  // native binaries. NSIS's x64 app install prunes these files, which made the
  // original all-platform manifest fail its runtime digest check after install.
  // Create a Windows-x64 runtime tree and lock precisely what the installer ships.
  dshStagingRoot = mkdtempSync(path.join(tmpdir(), 'shiji-dsh-win-x64-'))
  packagedDshRoot = path.join(dshStagingRoot, DSH_RELEASE_LOCK.dshVersion)
  cpSync(capability, packagedDshRoot, {
    recursive: true,
    filter: (source) => {
      if (source === capability) return true
      const relativePath = path.relative(capability, source).replaceAll(path.sep, '/')
      if (/\.(?:map)$/i.test(relativePath) || /\.d\.ts$/i.test(relativePath)) return false
      if (/(?:^|\/)(?:win32-arm64|win10-arm64)(?:\/|$)/i.test(relativePath)) return false
      return true
    },
  })
  const packagedDigest = await computeCapabilityTreeDigest(packagedDshRoot)
  if (packagedDigest.fileCount !== DSH_PACKAGED_RELEASE_LOCK.fileCount
    || packagedDigest.treeSha256 !== DSH_PACKAGED_RELEASE_LOCK.treeSha256) {
    throw new Error('Windows x64 DSH 发行树与内置锁不一致；停止打包。')
  }
  writeFileSync(path.join(packagedDshRoot, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    dshVersion: DSH_PACKAGED_RELEASE_LOCK.dshVersion,
    nodeVersion: DSH_PACKAGED_RELEASE_LOCK.nodeVersion,
    runtimeIdentity: DSH_PACKAGED_RELEASE_LOCK.runtimeIdentity,
    fileCount: DSH_PACKAGED_RELEASE_LOCK.fileCount,
    treeSha256: DSH_PACKAGED_RELEASE_LOCK.treeSha256,
  }, null, 2))
  const packagedInspection = await inspectDshCapabilityPackage(packagedDshRoot, DSH_PACKAGED_RELEASE_LOCK)
  if (!packagedInspection.available) throw new Error(`Windows x64 DSH 发行树校验失败：${packagedInspection.message}`)
}

// Reuse the already installed Electron binary. On this Windows machine the
// builder's default ZIP extraction can stall even when its cache is valid.
const common = {
  ...pkg.build,
  electronVersion: pkg.devDependencies.electron,
  electronDist: path.join(root, 'node_modules', 'electron', 'dist'),
  directories: { output: outputRoot, buildResources: path.join(root, 'build') },
}
const windows = Platform.WINDOWS.createTarget(['nsis'], Arch.x64)

// electron-builder merges a programmatic `files` override with package.json's
// build.files, which leaked the full backend into the first trial archive.
// Build from a separate directory containing only the trial entry and UI.
if (!fullOnly) {
  mkdirSync(outputRoot, { recursive: true })
  const stage = mkdtempSync(path.join(outputRoot, 'trial-stage-'))
  mkdirSync(path.join(stage, 'dist-electron', 'electron'), { recursive: true })
  cpSync(path.join(root, 'dist-trial'), path.join(stage, 'dist-trial'), { recursive: true })
  cpSync(path.join(root, 'dist-electron', 'electron', 'trial-main.js'), path.join(stage, 'dist-electron', 'electron', 'trial-main.js'))
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'shiji-trial', version: pkg.version, private: true,
    type: 'module', main: 'dist-electron/electron/trial-main.js',
  }, null, 2))

  await build({
    targets: windows,
    projectDir: stage,
    config: {
      ...common,
      directories: { ...common.directories, output: trialOutputRoot },
      productName: '识机体验版',
      appId: 'com.shiji.workbench.trial',
      // The trial still loads its UI through file:// inside app.asar, so it
      // must retain the same file-protocol access as the full desktop app.
      electronFuses: { ...pkg.build.electronFuses, runAsNode: false },
      files: ['dist-trial/**', 'dist-electron/electron/trial-main.js', 'package.json'],
      extraResources: [],
      win: { ...pkg.build.win, artifactName: 'Shiji-Trial-Setup-${version}-r2-${arch}.${ext}' },
    },
  })

  const trialContents = listPackage(path.join(trialOutputRoot, 'win-unpacked', 'resources', 'app.asar'))
  const trialAllowed = (entry) => entry === '\\package.json'
    || entry === '\\dist-electron' || entry === '\\dist-electron\\electron'
    || entry === '\\dist-electron\\electron\\trial-main.js'
    || entry === '\\dist-trial' || entry === '\\dist-trial\\assets'
    || entry.startsWith('\\dist-trial\\assets\\') || entry === '\\dist-trial\\trial.html'
  if (trialContents.some((entry) => !trialAllowed(entry))) throw new Error('体验版混入未允许的正式版文件')
  if (trialContents.some((entry) => /\.(?:map|tsx?|jsx)$/i.test(entry))) throw new Error('体验版安装包中发现 source map 或源代码文件')
  copyFileSync(path.join(trialOutputRoot, trialArtifactName), path.join(outputRoot, trialArtifactName))
  copyFileSync(path.join(trialOutputRoot, `${trialArtifactName}.blockmap`), path.join(outputRoot, `${trialArtifactName}.blockmap`))
  console.log(`体验版隔离检查通过：${trialContents.length} 个目录/文件条目`)
}

if (!trialOnly) await build({
    targets: windows,
    projectDir: root,
    config: {
      ...common,
      productName: '识机',
      extraResources: [
        { from: packagedDshRoot, to: 'capabilities/dsh/0.1.1-rc.2' },
        { from: path.join(root, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), to: 'licenses/DeepSeek-Harness-LICENSE.txt' },
        { from: path.join(root, 'licenses', 'shiji-license-public.pem'), to: 'licenses/shiji-license-public.pem' },
      ],
      win: { ...pkg.build.win, artifactName: 'Shiji-Full-Setup-${version}-${arch}.${ext}' },
    },
  })

if (!trialOnly) {
  const bundled = await inspectDshCapabilityPackage(path.join(outputRoot, 'win-unpacked', 'resources', 'capabilities', 'dsh', DSH_RELEASE_LOCK.dshVersion), DSH_PACKAGED_RELEASE_LOCK)
  if (!bundled.available) throw new Error(`正式版 DSH 资源校验失败：${bundled.message}`)
  if (!existsSync(path.join(outputRoot, 'win-unpacked', 'resources', 'licenses', 'DeepSeek-Harness-LICENSE.txt'))) throw new Error('正式版缺少 DSH 许可文件')
  if (!existsSync(path.join(outputRoot, 'win-unpacked', 'resources', 'licenses', 'shiji-license-public.pem'))) throw new Error('正式版缺少离线授权公钥')
  const fullContents = listPackage(path.join(outputRoot, 'win-unpacked', 'resources', 'app.asar'))
  if (fullContents.some((entry) => /\.(?:map|tsx?|jsx)$/i.test(entry))) throw new Error('正式版安装包中发现 source map 或源代码文件')
  console.log('正式版 DSH 资源校验通过')
}

const expected = trialOnly ? [trialArtifactName] : fullOnly ? [`Shiji-Full-Setup-${pkg.version}-x64.exe`] : [trialArtifactName, `Shiji-Full-Setup-${pkg.version}-x64.exe`]
for (const name of expected) if (!existsSync(path.join(outputRoot, name))) throw new Error(`${name} 安装包未生成`)
if (dshStagingRoot) rmSync(dshStagingRoot, { recursive: true, force: true })
