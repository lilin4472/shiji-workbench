import type { DshCapabilityLock } from './dsh-capability-package.js'

/** Trusted lock for the locally built DSH capability release. Update only by rebuilding and re-verifying the package. */
export const DSH_RELEASE_LOCK: DshCapabilityLock = {
  dshVersion: '0.1.1-rc.2',
  nodeVersion: '24.20.0',
  runtimeIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
  fileCount: 22_766,
  treeSha256: '633ce81b20709fa3482334f058c65b80a39cc20fde72c8917e0a4929e351b030',
}

/** Runtime payload locked for the Windows x64 installer. Declaration/source-map files and ARM64 binaries are omitted. */
export const DSH_PACKAGED_RELEASE_LOCK: DshCapabilityLock = {
  dshVersion: '0.1.1-rc.2',
  nodeVersion: '24.20.0',
  runtimeIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
  fileCount: 12_573,
  treeSha256: '4cb425ab5e50edf3eb1ccadad2b0851ff052fe9d0adbc8fbd9528e6360c05ee5',
}
