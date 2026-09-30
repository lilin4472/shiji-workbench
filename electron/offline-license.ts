import { createHash, verify, type KeyObject } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { SHIJI_LICENSE_PRODUCT, SHIJI_LICENSE_VERSION, type OfflineLicenseStatus } from '../shared/license-contract.js'

const execFile = promisify(execFileCallback)

export interface SignedLicensePayload {
  licenseVersion: 1
  product: typeof SHIJI_LICENSE_PRODUCT
  licenseId: string
  orderRef: string
  deviceCode: string
  issuedAt: string
}

export interface OfflineLicenseRecord {
  version: 1
  activationCode: string
}

export interface OfflineLicenseFilePort {
  read(): Promise<string | undefined>
  write(value: string): Promise<void>
}

export interface OfflineLicenseDevicePort {
  deviceCode(): Promise<string>
}

export function normalizeDeviceCode(value: string): string {
  return value.replace(/[^a-f\d]/gi, '').toUpperCase()
}

export function formatDeviceCode(value: string): string {
  const normalized = normalizeDeviceCode(value)
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized
}

export function deviceCodeFromMachineGuid(machineGuid: string): string {
  return createHash('sha256').update(`${SHIJI_LICENSE_PRODUCT}\0${machineGuid.trim().toLowerCase()}`).digest('hex').slice(0, 20).toUpperCase()
}

/** Stable Windows installation identity without exposing the raw MachineGuid to the seller. */
export async function getWindowsDeviceCode(): Promise<string> {
  if (process.platform !== 'win32') throw new Error('离线授权目前仅支持 Windows 设备。')
  const { stdout } = await execFile('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
    windowsHide: true,
    timeout: 5_000,
  })
  const match = stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
  if (!match?.[1]?.trim()) throw new Error('无法读取本机设备码，请联系卖家处理。')
  return deviceCodeFromMachineGuid(match[1])
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z\d_-]+$/.test(value)) throw new Error('授权码格式无效。')
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4), 'base64')
}

function readPayload(token: string): { payloadSegment: string; signature: Buffer; payload: SignedLicensePayload } {
  if (token.length > 8_192) throw new Error('授权码长度无效。')
  const [payloadSegment, signatureSegment, extra] = token.trim().split('.')
  if (!payloadSegment || !signatureSegment || extra !== undefined) throw new Error('授权码格式无效。')
  const payload = JSON.parse(decodeBase64Url(payloadSegment).toString('utf8')) as Partial<SignedLicensePayload>
  const signature = decodeBase64Url(signatureSegment)
  if (
    payload.licenseVersion !== SHIJI_LICENSE_VERSION
    || payload.product !== SHIJI_LICENSE_PRODUCT
    || typeof payload.licenseId !== 'string'
    || !/^[\da-f-]{36}$/i.test(payload.licenseId)
    || typeof payload.orderRef !== 'string'
    || payload.orderRef.length < 1 || payload.orderRef.length > 120
    || typeof payload.deviceCode !== 'string'
    || !/^[A-F\d]{20}$/.test(payload.deviceCode)
    || typeof payload.issuedAt !== 'string'
    || !Number.isFinite(Date.parse(payload.issuedAt))
  ) throw new Error('授权码内容无效。')
  return { payloadSegment, signature, payload: payload as SignedLicensePayload }
}

export function verifyOfflineLicenseCode(token: string, deviceCode: string, publicKey: string | Buffer | KeyObject): SignedLicensePayload {
  const parsed = readPayload(token)
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode)
  if (parsed.payload.deviceCode !== normalizedDeviceCode) throw new Error('此授权码不属于当前电脑。')
  if (!verify(null, Buffer.from(parsed.payloadSegment, 'ascii'), publicKey, parsed.signature)) throw new Error('授权码签名无效。')
  return parsed.payload
}

export class OfflineLicenseStore {
  constructor(
    private readonly file: OfflineLicenseFilePort,
    private readonly device: OfflineLicenseDevicePort,
    private readonly publicKey: string | Buffer | KeyObject,
  ) {}

  async status(): Promise<OfflineLicenseStatus> {
    const deviceCode = await this.device.deviceCode()
    const raw = await this.file.read()
    if (!raw) return { activated: false, deviceCode }
    try {
      const value = JSON.parse(raw) as Partial<OfflineLicenseRecord>
      if (value.version !== 1 || typeof value.activationCode !== 'string') throw new Error('本机授权记录格式无效。')
      const payload = verifyOfflineLicenseCode(value.activationCode, deviceCode, this.publicKey)
      return { activated: true, deviceCode, licenseId: payload.licenseId }
    } catch {
      return { activated: false, deviceCode, message: '本机授权记录无效，请重新输入卖家提供的授权码。' }
    }
  }

  async activate(activationCode: string): Promise<OfflineLicenseStatus> {
    const deviceCode = await this.device.deviceCode()
    const payload = verifyOfflineLicenseCode(activationCode, deviceCode, this.publicKey)
    await this.file.write(JSON.stringify({ version: 1, activationCode: activationCode.trim() } satisfies OfflineLicenseRecord))
    return { activated: true, deviceCode, licenseId: payload.licenseId }
  }
}
