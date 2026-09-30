import { pathToFileURL } from 'node:url'
import type {
  DshInitializeParams,
  DshRuntimeClient,
  DshRuntimeLaunchSpec,
  DshRuntimeRunOptions,
  DshRuntimeRunResult,
} from './dsh-runtime-controller.js'

interface OfficialHarnessClient {
  start(): void
  initialize(params: DshInitializeParams): Promise<{ serverInfo: { name: string; version: string } }>
  close(): Promise<void>
}

interface OfficialHarnessSession {
  run(input: string, options: Pick<DshRuntimeRunOptions, 'onNotification'>): Promise<DshRuntimeRunResult>
}

interface OfficialSdkModule {
  HarnessClient: new (launch: DshRuntimeLaunchSpec) => OfficialHarnessClient
  HarnessSession: new (
    harness: { start(): Promise<void>; client: OfficialHarnessClient },
    sessionId: string,
  ) => OfficialHarnessSession
}

export type DshRuntimeClientFactory = (launch: DshRuntimeLaunchSpec) => DshRuntimeClient

export async function loadOfficialDshClientFactory(sdkClientPath: string): Promise<DshRuntimeClientFactory> {
  const sdkModule = await import(pathToFileURL(sdkClientPath).href) as Partial<OfficialSdkModule>
  if (typeof sdkModule.HarnessClient !== 'function' || typeof sdkModule.HarnessSession !== 'function') {
    throw new Error('DSH 官方 SDK Client 导出不完整。')
  }
  return createOfficialDshClientFactory(sdkModule as OfficialSdkModule)
}

export function createOfficialDshClientFactory(sdkModule: OfficialSdkModule): DshRuntimeClientFactory {
  return (launch) => {
    const client = new sdkModule.HarnessClient(launch)
    const initializedHost = { start: async () => {}, client }
    return {
      start: () => client.start(),
      initialize: params => client.initialize(params),
      run: async (input, options) => {
        const session = new sdkModule.HarnessSession(initializedHost, options.sessionId)
        return session.run(input, { onNotification: options.onNotification })
      },
      close: () => client.close(),
    }
  }
}
