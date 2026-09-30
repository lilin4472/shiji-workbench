import { describe, expect, it } from 'vitest'
import { CredentialStore, type CredentialFileIO, type SecureCodec } from '../electron/credential-store'

const testCodec: SecureCodec = {
  isAvailable: () => true,
  encrypt: (plainText) => [...plainText].reverse().join(''),
  decrypt: (encrypted) => [...encrypted].reverse().join(''),
}

function createStore(codec: SecureCodec = testCodec) {
  let content: string | undefined
  const fileIO: CredentialFileIO = {
    read: async () => content,
    write: async (nextContent) => { content = nextContent },
  }
  return { store: new CredentialStore(fileIO, codec), readRaw: () => content }
}

describe('CredentialStore', () => {
  it('stores only encrypted key material and reports configured status', async () => {
    const { store, readRaw } = createStore()
    await store.saveDeepSeekKey('sk-secret-value')

    expect(readRaw()).not.toContain('sk-secret-value')
    await expect(store.readDeepSeekKey()).resolves.toBe('sk-secret-value')
    await expect(store.getDeepSeekStatus()).resolves.toMatchObject({ configured: true, encryptionAvailable: true })
  })

  it('deletes the stored key without returning its value', async () => {
    const { store } = createStore()
    await store.saveDeepSeekKey('sk-secret-value')
    await expect(store.deleteDeepSeekKey()).resolves.toBe(true)
    await expect(store.readDeepSeekKey()).resolves.toBeUndefined()
    await expect(store.getDeepSeekStatus()).resolves.toMatchObject({ configured: false })
  })

  it('stores active provider keys separately without exposing or overwriting them', async () => {
    const { store, readRaw } = createStore()
    await store.saveDeepSeekKey('sk-deepseek-secret')
    await store.saveDoubaoKey('doubao-search-secret')
    await store.saveTiandituServerKey('tdt-tianditu-server-secret')
    await store.saveTiandituWebKey('tdt-tianditu-web-secret')

    expect(readRaw()).not.toContain('sk-deepseek-secret')
    expect(readRaw()).not.toContain('doubao-search-secret')
    expect(readRaw()).not.toContain('tdt-tianditu-server-secret')
    expect(readRaw()).not.toContain('tdt-tianditu-web-secret')
    await expect(store.readDeepSeekKey()).resolves.toBe('sk-deepseek-secret')
    await expect(store.readDoubaoKey()).resolves.toBe('doubao-search-secret')
    await expect(store.readTiandituServerKey()).resolves.toBe('tdt-tianditu-server-secret')
    await expect(store.readTiandituWebKey()).resolves.toBe('tdt-tianditu-web-secret')
    await expect(store.getDoubaoStatus()).resolves.toMatchObject({ configured: true, encryptionAvailable: true })
    await expect(store.getTiandituServerStatus()).resolves.toMatchObject({ configured: true, encryptionAvailable: true })
    await expect(store.getTiandituWebStatus()).resolves.toMatchObject({ configured: true, encryptionAvailable: true })

    await expect(store.deleteDoubaoKey()).resolves.toBe(true)
    await expect(store.readDoubaoKey()).resolves.toBeUndefined()
    await expect(store.readDeepSeekKey()).resolves.toBe('sk-deepseek-secret')
    await expect(store.deleteTiandituServerKey()).resolves.toBe(true)
    await expect(store.readTiandituServerKey()).resolves.toBeUndefined()
    await expect(store.deleteTiandituWebKey()).resolves.toBe(true)
    await expect(store.readTiandituWebKey()).resolves.toBeUndefined()
  })

  it('refuses to save when operating-system encryption is unavailable', async () => {
    const { store } = createStore({ ...testCodec, isAvailable: () => false })
    await expect(store.saveDeepSeekKey('sk-secret-value')).rejects.toThrow('系统加密能力不可用')
  })

  it('rejects empty and excessively long keys before writing', async () => {
    const { store } = createStore()
    await expect(store.saveDeepSeekKey('   ')).rejects.toThrow('请输入')
    await expect(store.saveDeepSeekKey('x'.repeat(513))).rejects.toThrow('长度异常')
  })
})
