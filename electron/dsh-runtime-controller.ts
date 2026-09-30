import { spawn } from 'node:child_process'

const VERSION_PATTERN = /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/
const OUTPUT_LIMIT = 16 * 1024
const DEFAULT_PROBE_TIMEOUT_MS = 5_000

export interface DshProcessSpec {
  command: string
  args?: readonly string[]
  cwd?: string
}

export interface DshRuntimeLaunchSpec extends DshProcessSpec {
  env: NodeJS.ProcessEnv
}

export interface DshRuntimeVersions {
  dsh: string
  node: string
}

export type DshInspectionFailureCode =
  | 'runtime-not-found'
  | 'probe-timeout'
  | 'probe-failed'
  | 'version-unreadable'
  | 'dsh-version-incompatible'
  | 'node-version-incompatible'

export type DshRuntimeInspection =
  | {
    compatible: true
    executable: string
    versions: DshRuntimeVersions
  }
  | {
    compatible: false
    executable: string
    code: DshInspectionFailureCode
    message: string
    detectedVersions?: Partial<DshRuntimeVersions>
  }

export interface DshInitializeParams {
  cwd: string
  provider: string
  model: string
  maxTokens?: number
}

export interface DshRuntimeIdentity {
  name: string
  version: string
}

export interface DshRuntimeNotification {
  method: string
  params: Record<string, unknown>
}

export interface DshRuntimeRunResult {
  finalResponse: string
  events?: unknown[]
}

export interface DshRuntimeRunOptions {
  sessionId: string
  onNotification?: (notification: DshRuntimeNotification) => void
}

export interface DshRuntimeClient {
  start(): void
  initialize(params: DshInitializeParams): Promise<{ serverInfo: DshRuntimeIdentity }>
  run?(input: string, options: DshRuntimeRunOptions): Promise<DshRuntimeRunResult>
  close(): Promise<void>
}

export interface DshRuntimeControllerOptions {
  launch: DshProcessSpec
  dshVersionProbe: DshProcessSpec
  nodeVersionProbe: DshProcessSpec
  expectedVersions: DshRuntimeVersions
  expectedIdentity: DshRuntimeIdentity
  createClient: (launch: DshRuntimeLaunchSpec) => DshRuntimeClient
  environment?: NodeJS.ProcessEnv
  runtimeSecrets?: { deepseekApiKey: string }
  probeTimeoutMs?: number
}

export class DshRuntimeError extends Error {
  constructor(
    readonly code: DshInspectionFailureCode | 'already-running' | 'startup-failed' | 'identity-mismatch' | 'not-running' | 'run-failed' | 'shutdown-failed',
    message: string,
  ) {
    super(message)
    this.name = 'DshRuntimeError'
  }
}

interface ProbeResult {
  exitCode: number | null
  stdout: string
  timedOut: boolean
  notFound: boolean
  overflowed: boolean
}

/**
 * Remove inherited credentials before a subprocess is launched. A future
 * backend may add the one task-scoped key explicitly after this scrub; the
 * controller itself never reads the credential store.
 */
export function scrubRuntimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(name)) continue
    result[name] = value
  }
  return result
}

function extractVersion(output: string): string | undefined {
  return VERSION_PATTERN.exec(output.trim())?.[1]
}

function appendBounded(current: string, chunk: Buffer | string): { value: string; overflowed: boolean } {
  if (current.length >= OUTPUT_LIMIT) return { value: current, overflowed: true }
  const incoming = chunk.toString()
  const remaining = OUTPUT_LIMIT - current.length
  return {
    value: current + incoming.slice(0, remaining),
    overflowed: incoming.length > remaining,
  }
}

function runProbe(spec: DshProcessSpec, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let overflowed = false
    let timedOut = false
    let notFound = false
    let settled = false

    const child = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ exitCode, stdout, timedOut, notFound, overflowed })
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      const next = appendBounded(stdout, chunk)
      stdout = next.value
      overflowed ||= next.overflowed
    })
    // Drain stderr so a noisy child cannot block. Its raw text is deliberately
    // not retained or exposed across the controller boundary.
    child.stderr.resume()
    child.once('error', (error: NodeJS.ErrnoException) => {
      notFound = error.code === 'ENOENT'
      finish(null)
    })
    child.once('close', (code) => finish(code))

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      // The direct version probes do not own long-lived runtime children. This
      // fallback prevents a broken executable from parking inspection forever.
      setTimeout(() => finish(null), 500).unref()
    }, timeoutMs)
  })
}

function inspectionFailure(
  executable: string,
  code: DshInspectionFailureCode,
  message: string,
  detectedVersions?: Partial<DshRuntimeVersions>,
): DshRuntimeInspection {
  return { compatible: false, executable, code, message, detectedVersions }
}

/**
 * Product-owned compatibility gate in front of the optional official DSH SDK
 * client. It does not implement JSON-RPC, model calls, plugin behavior, or key
 * storage; those remain behind the injected client and the product's stable
 * AgentRunner boundary.
 */
export class DshRuntimeController {
  private client: DshRuntimeClient | undefined
  private lifecycle: 'stopped' | 'starting' | 'running' | 'stopping' = 'stopped'

  constructor(private readonly options: DshRuntimeControllerOptions) {}

  get state(): typeof this.lifecycle {
    return this.lifecycle
  }

  private environment(): NodeJS.ProcessEnv {
    return scrubRuntimeEnvironment(this.options.environment ?? process.env)
  }

  private launchEnvironment(): NodeJS.ProcessEnv {
    const environment = this.environment()
    const apiKey = this.options.runtimeSecrets?.deepseekApiKey.trim()
    if (apiKey) environment.DEEPSEEK_API_KEY = apiKey
    return environment
  }

  async inspect(): Promise<DshRuntimeInspection> {
    const env = this.environment()
    const timeoutMs = this.options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    const executable = this.options.launch.command
    let dshProbe: ProbeResult
    let nodeProbe: ProbeResult
    try {
      [dshProbe, nodeProbe] = await Promise.all([
        runProbe(this.options.dshVersionProbe, env, timeoutMs),
        runProbe(this.options.nodeVersionProbe, env, timeoutMs),
      ])
    } catch {
      return inspectionFailure(executable, 'probe-failed', 'DSH 运行时版本检测失败。')
    }

    if (dshProbe.notFound || nodeProbe.notFound) {
      return inspectionFailure(executable, 'runtime-not-found', '未找到锁定的 DSH 本地运行时。')
    }
    if (dshProbe.timedOut || nodeProbe.timedOut) {
      return inspectionFailure(executable, 'probe-timeout', 'DSH 运行时版本检测超时。')
    }
    if (dshProbe.exitCode !== 0 || nodeProbe.exitCode !== 0 || dshProbe.overflowed || nodeProbe.overflowed) {
      return inspectionFailure(executable, 'probe-failed', 'DSH 运行时版本检测失败。')
    }

    const dsh = extractVersion(dshProbe.stdout)
    const node = extractVersion(nodeProbe.stdout)
    const detectedVersions = { ...(dsh === undefined ? {} : { dsh }), ...(node === undefined ? {} : { node }) }
    if (dsh === undefined || node === undefined) {
      return inspectionFailure(executable, 'version-unreadable', '无法识别 DSH 或 Node 运行时版本。', detectedVersions)
    }
    if (dsh !== this.options.expectedVersions.dsh) {
      return inspectionFailure(
        executable,
        'dsh-version-incompatible',
        `DSH 版本不兼容：需要 ${this.options.expectedVersions.dsh}，检测到 ${dsh}。`,
        { dsh, node },
      )
    }
    if (node !== this.options.expectedVersions.node) {
      return inspectionFailure(
        executable,
        'node-version-incompatible',
        `Node 版本不兼容：需要 ${this.options.expectedVersions.node}，检测到 ${node}。`,
        { dsh, node },
      )
    }
    return { compatible: true, executable, versions: { dsh, node } }
  }

  async start(params: DshInitializeParams): Promise<DshRuntimeIdentity> {
    if (this.lifecycle !== 'stopped') {
      throw new DshRuntimeError('already-running', 'DSH 运行时已经启动或正在切换状态。')
    }
    this.lifecycle = 'starting'
    let client: DshRuntimeClient | undefined
    try {
      const inspection = await this.inspect()
      if (!inspection.compatible) throw new DshRuntimeError(inspection.code, inspection.message)

      client = this.options.createClient({
        ...this.options.launch,
        args: [...(this.options.launch.args ?? [])],
        env: this.launchEnvironment(),
      })
      this.client = client
      client.start()
      const result = await client.initialize(params)
      const identity = result.serverInfo
      if (identity.name !== this.options.expectedIdentity.name || identity.version !== this.options.expectedIdentity.version) {
        throw new DshRuntimeError('identity-mismatch', 'DSH 运行时身份或协议版本不匹配。')
      }
      this.lifecycle = 'running'
      return identity
    } catch (error) {
      await client?.close().catch(() => {})
      this.client = undefined
      this.lifecycle = 'stopped'
      if (error instanceof DshRuntimeError) throw error
      throw new DshRuntimeError('startup-failed', 'DSH 运行时启动失败，已安全关闭。')
    }
  }

  async stop(): Promise<void> {
    if (this.lifecycle === 'stopped') return
    if (this.lifecycle !== 'running' || this.client === undefined) {
      throw new DshRuntimeError('shutdown-failed', 'DSH 运行时正在切换状态，暂时无法关闭。')
    }
    this.lifecycle = 'stopping'
    const client = this.client
    try {
      await client.close()
      this.client = undefined
      this.lifecycle = 'stopped'
    } catch {
      this.lifecycle = 'running'
      throw new DshRuntimeError('shutdown-failed', 'DSH 运行时关闭失败。')
    }
  }

  async run(input: string, options: DshRuntimeRunOptions): Promise<DshRuntimeRunResult> {
    if (this.lifecycle !== 'running' || this.client === undefined) {
      throw new DshRuntimeError('not-running', 'DSH 运行时尚未启动。')
    }
    if (this.client.run === undefined) {
      throw new DshRuntimeError('run-failed', 'DSH SDK Client 不支持任务会话。')
    }
    try {
      return await this.client.run(input, options)
    } catch {
      throw new DshRuntimeError('run-failed', 'DSH 任务执行失败。')
    }
  }
}
