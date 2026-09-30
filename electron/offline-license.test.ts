import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { OfflineLicenseStore, deviceCodeFromMachineGuid, formatDeviceCode, verifyOfflineLicenseCode, type OfflineLicenseFilePort, type SignedLicensePayload } from './offline-license'

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url')

function issue(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], deviceCode: string) {
  const payload: SignedLicensePayload = {
    licenseVersion: 1,
    product: 'shiji-workbench-full',
    licenseId: '1d313240-a3a2-4fd0-8091-3d730b91c248',
    orderRef: 'test-order',
    deviceCode,
    issuedAt: '2026-09-26T00:00:00.000Z',
  }
  const segment = b64(JSON.stringify(payload))
  return `${segment}.${sign(null, Buffer.from(segment, 'ascii'), privateKey).toString('base64url')}`
}

describe('offline signed device license', () => {
  const keys = generateKeyPairSync('ed25519')

  it('derives a stable, opaque device code and formats it for customer support', () => {
    const code = deviceCodeFromMachineGuid('example-guid')
    expect(code).toMatch(/^[A-F\d]{20}$/)
    expect(deviceCodeFromMachineGuid(' EXAMPLE-GUID ')).toBe(code)
    expect(formatDeviceCode(code)).toBe(code.match(/.{1,4}/g)?.join('-'))
  })

  it('accepts a valid signed code only for its bound device', () => {
    const code = '0123456789ABCDEF0123'
    const token = issue(keys.privateKey, code)
    expect(verifyOfflineLicenseCode(token, code, keys.publicKey).orderRef).toBe('test-order')
    expect(() => verifyOfflineLicenseCode(token, 'FFFFFFFFFFFFFFFFFFFF', keys.publicKey)).toThrow('不属于当前电脑')
    const [payloadSegment, signature] = token.split('.')
    const corruptedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    expect(() => verifyOfflineLicenseCode(`${payloadSegment}.${corruptedSignature}`, code, keys.publicKey)).toThrow('签名无效')
  })

  it('persists a valid token and refuses a copied token on a different device', async () => {
    let contents: string | undefined
    const file: OfflineLicenseFilePort = {
      read: async () => contents,
      write: async (value) => { contents = value },
    }
    const device = { deviceCode: async () => '0123456789ABCDEF0123' }
    const store = new OfflineLicenseStore(file, device, keys.publicKey)
    expect((await store.status()).activated).toBe(false)
    const token = issue(keys.privateKey, '0123456789ABCDEF0123')
    expect((await store.activate(token)).activated).toBe(true)
    expect((await store.status()).activated).toBe(true)
    const copied = new OfflineLicenseStore(file, { deviceCode: async () => 'FFFFFFFFFFFFFFFFFFFF' }, keys.publicKey)
    expect((await copied.status()).activated).toBe(false)
  })
})
