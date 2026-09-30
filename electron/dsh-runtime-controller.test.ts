import { describe, expect, it, vi } from 'vitest'
import {
  DshRuntimeController,
  DshRuntimeError,
  scrubRuntimeEnvironment,
  type DshRuntimeClient,
  type DshRuntimeControllerOptions,
} from './dsh-runtime-controller.js'

const EXPECTED = { dsh: '0.1.1-rc.2', node: '22.19.0' }
const EXPECTED_IDENTITY = { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' }

function outputProbe(output: string, extraScript = '') {
  return {
    command: process.execPath,
    args: ['-e', `${extraScript}\nprocess.stdout.write(${JSON.stringify(output)})`],
  }
}

function createFakeClient(overrides: Partial<DshRuntimeClient> = {}): DshRuntimeClient {
  return {
    start: vi.fn(),
    initialize: vi.fn(async () => ({
      serverInfo: EXPECTED_IDENTITY,
    })),
    run: vi.fn(async () => ({ finalResponse: '{"opportunities":[]}' })),
    close: vi.fn(async () => {}),
    ...overrides,
  }
}

function controllerOptions(client: DshRuntimeClient, overrides: Partial<DshRuntimeControllerOptions> = {}): DshRuntimeControllerOptions {
  return {
    launch: { command: 'bundled-node.exe', args: ['dsh-runtime.js'] },
    dshVersionProbe: outputProbe(EXPECTED.dsh),
    nodeVersionProbe: outputProbe(`v${EXPECTED.node}`),
    expectedVersions: EXPECTED,
    expectedIdentity: EXPECTED_IDENTITY,
    createClient: vi.fn(() => client),
    ...overrides,
  }
}

describe('DshRuntimeController', () => {
  it('accepts only the exact locked DSH and Node versions', async () => {
    const controller = new DshRuntimeController(controllerOptions(createFakeClient()))
    await expect(controller.inspect()).resolves.toEqual({
      compatible: true,
      executable: 'bundled-node.exe',
      versions: EXPECTED,
    })

    const incompatible = new DshRuntimeController(controllerOptions(createFakeClient(), {
      dshVersionProbe: outputProbe('0.1.0-rc.6'),
    }))
    await expect(incompatible.inspect()).resolves.toMatchObject({
      compatible: false,
      code: 'dsh-version-incompatible',
      detectedVersions: { dsh: '0.1.0-rc.6' },
    })
  })

  it('scrubs inherited secrets from version probes and runtime launch', async () => {
    const source = { PATH: 'safe-path', DEEPSEEK_API_KEY: 'sk-secret', ACCESS_TOKEN: 'token', PLAIN: 'ok' }
    expect(scrubRuntimeEnvironment(source)).toEqual({ PATH: 'safe-path', PLAIN: 'ok' })

    const client = createFakeClient()
    const createClient = vi.fn(() => client)
    const controller = new DshRuntimeController(controllerOptions(client, {
      environment: source,
      createClient,
      dshVersionProbe: outputProbe(EXPECTED.dsh, "if (process.env.DEEPSEEK_API_KEY) process.exit(9)"),
    }))
    await controller.start({ cwd: 'C:\\workspace', provider: 'test', model: 'test' })

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      env: { PATH: 'safe-path', PLAIN: 'ok' },
    }))
    await controller.stop()
  })

  it('injects the task-scoped DeepSeek Key only after secret-free version probes pass', async () => {
    const client = createFakeClient()
    const createClient = vi.fn(() => client)
    const controller = new DshRuntimeController(controllerOptions(client, {
      environment: { PATH: 'safe-path', DEEPSEEK_API_KEY: 'inherited-key' },
      runtimeSecrets: { deepseekApiKey: 'task-key' },
      createClient,
      dshVersionProbe: outputProbe(EXPECTED.dsh, "if (process.env.DEEPSEEK_API_KEY) process.exit(9)"),
      nodeVersionProbe: outputProbe(EXPECTED.node, "if (process.env.DEEPSEEK_API_KEY) process.exit(9)"),
    }))

    await controller.start({ cwd: 'C:\\workspace', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      env: { PATH: 'safe-path', DEEPSEEK_API_KEY: 'task-key' },
    }))
    await controller.stop()
  })

  it('refuses startup before constructing a client when the runtime is incompatible', async () => {
    const client = createFakeClient()
    const createClient = vi.fn(() => client)
    const controller = new DshRuntimeController(controllerOptions(client, {
      dshVersionProbe: outputProbe('0.1.0-rc.6'),
      createClient,
    }))

    await expect(controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' }))
      .rejects.toMatchObject({ code: 'dsh-version-incompatible' })
    expect(createClient).not.toHaveBeenCalled()
    expect(controller.state).toBe('stopped')
  })

  it('reports an absent executable as a controlled inspection result', async () => {
    const controller = new DshRuntimeController(controllerOptions(createFakeClient(), {
      dshVersionProbe: { command: 'C:\\definitely-missing\\dsh-runtime.exe' },
    }))

    await expect(controller.inspect()).resolves.toMatchObject({
      compatible: false,
      code: 'runtime-not-found',
    })
  })

  it('performs the SDK handshake and delegates controlled shutdown', async () => {
    const client = createFakeClient()
    const controller = new DshRuntimeController(controllerOptions(client))
    const params = { cwd: 'C:\\workspace', provider: 'deepseek', model: 'model', maxTokens: 4096 }

    await expect(controller.start(params)).resolves.toEqual({
      name: 'deepseek-harness-sdk-runtime',
      version: '0.0.1',
    })
    expect(client.start).toHaveBeenCalledOnce()
    expect(client.initialize).toHaveBeenCalledWith(params)
    expect(controller.state).toBe('running')

    await expect(controller.run('prompt', { sessionId: 'task-1' })).resolves.toEqual({
      finalResponse: '{"opportunities":[]}',
    })
    expect(client.run).toHaveBeenCalledWith('prompt', { sessionId: 'task-1' })

    await controller.stop()
    expect(client.close).toHaveBeenCalledOnce()
    expect(controller.state).toBe('stopped')
    await expect(controller.stop()).resolves.toBeUndefined()
  })

  it('rejects task execution before startup and contains raw SDK failures', async () => {
    const client = createFakeClient({
      run: vi.fn(async () => { throw new Error('leaked runtime detail') }),
    })
    const controller = new DshRuntimeController(controllerOptions(client))
    await expect(controller.run('prompt', { sessionId: 'task-1' })).rejects.toMatchObject({ code: 'not-running' })
    await controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' })
    const failure = await controller.run('prompt', { sessionId: 'task-1' }).catch(error => error)
    expect(failure).toMatchObject({ code: 'run-failed' })
    expect(String(failure)).not.toContain('leaked runtime detail')
    await controller.stop()
  })

  it('closes a mismatched SDK peer and exposes only a controlled error', async () => {
    const client = createFakeClient({
      initialize: vi.fn(async () => ({ serverInfo: { name: 'unexpected-peer', version: EXPECTED_IDENTITY.version } })),
    })
    const controller = new DshRuntimeController(controllerOptions(client))

    const failure = await controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' }).catch(error => error)
    expect(failure).toBeInstanceOf(DshRuntimeError)
    expect(failure).toMatchObject({ code: 'identity-mismatch' })
    expect(client.close).toHaveBeenCalledOnce()
    expect(controller.state).toBe('stopped')
  })

  it('contains startup failures without leaking raw runtime error text', async () => {
    const client = createFakeClient({
      initialize: vi.fn(async () => { throw new Error('provider leaked sk-secret-value') }),
    })
    const controller = new DshRuntimeController(controllerOptions(client))

    const failure = await controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' }).catch(error => error)
    expect(failure).toMatchObject({ code: 'startup-failed' })
    expect(String(failure)).not.toContain('sk-secret-value')
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('contains client construction failures and restores the stopped state', async () => {
    const controller = new DshRuntimeController(controllerOptions(createFakeClient(), {
      createClient: () => { throw new Error('constructor secret detail') },
    }))

    const failure = await controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' }).catch(error => error)
    expect(failure).toMatchObject({ code: 'startup-failed' })
    expect(String(failure)).not.toContain('constructor secret detail')
    expect(controller.state).toBe('stopped')
  })

  it('bounds a hung version probe and never constructs the runtime client', async () => {
    const client = createFakeClient()
    const createClient = vi.fn(() => client)
    const controller = new DshRuntimeController(controllerOptions(client, {
      dshVersionProbe: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
      createClient,
      probeTimeoutMs: 50,
    }))

    await expect(controller.start({ cwd: 'C:\\workspace', provider: 'p', model: 'm' }))
      .rejects.toMatchObject({ code: 'probe-timeout' })
    expect(createClient).not.toHaveBeenCalled()
  })
})
