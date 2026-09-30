import type { CredentialStatus, DeepSeekCredentialStatus, DoubaoCredentialStatus, TiandituServerCredentialStatus, TiandituWebCredentialStatus } from '../shared/credential-contract.js'

export interface SecureCodec {
  isAvailable(): boolean
  encrypt(plainText: string): string
  decrypt(encrypted: string): string
}

export interface CredentialFileIO {
  read(): Promise<string | undefined>
  write(content: string): Promise<void>
}

interface StoredCredential {
  encrypted: string
  savedAt: string
}

interface CredentialFile {
  version: 1
  deepseek?: StoredCredential
  doubao?: StoredCredential
  /** Preserved only so upgrading never deletes the user's encrypted legacy keys. */
  anysearch?: StoredCredential
  tavily?: StoredCredential
  tiandituServer?: StoredCredential
  tiandituWeb?: StoredCredential
}

type CredentialKind = 'deepseek' | 'doubao' | 'tiandituServer' | 'tiandituWeb'

function parseCredentialFile(raw: string): CredentialFile {
  const value = JSON.parse(raw) as Partial<CredentialFile>
  if (value.version !== 1) throw new Error('本地凭据文件版本不受支持。')
  if (value.deepseek
    && (typeof value.deepseek.encrypted !== 'string' || typeof value.deepseek.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  if (value.doubao
    && (typeof value.doubao.encrypted !== 'string' || typeof value.doubao.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  if (value.anysearch
    && (typeof value.anysearch.encrypted !== 'string' || typeof value.anysearch.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  if (value.tavily
    && (typeof value.tavily.encrypted !== 'string' || typeof value.tavily.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  if (value.tiandituServer
    && (typeof value.tiandituServer.encrypted !== 'string' || typeof value.tiandituServer.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  if (value.tiandituWeb
    && (typeof value.tiandituWeb.encrypted !== 'string' || typeof value.tiandituWeb.savedAt !== 'string')) {
    throw new Error('本地凭据文件格式损坏。')
  }
  return value as CredentialFile
}

export class CredentialStore {
  constructor(
    private readonly fileIO: CredentialFileIO,
    private readonly codec: SecureCodec,
  ) {}

  private async readFile(): Promise<CredentialFile> {
    const raw = await this.fileIO.read()
    return raw === undefined ? { version: 1 } : parseCredentialFile(raw)
  }

  private async writeFile(value: CredentialFile) {
    await this.fileIO.write(JSON.stringify(value, null, 2))
  }

  async getDeepSeekStatus(): Promise<DeepSeekCredentialStatus> {
    const file = await this.readFile()
    return this.status(file.deepseek)
  }

  async saveDeepSeekKey(apiKeyValue: string) {
    return this.saveKey('deepseek', 'DeepSeek', apiKeyValue)
  }

  async readDeepSeekKey(): Promise<string | undefined> {
    return this.readKey('deepseek')
  }

  async deleteDeepSeekKey() {
    return this.deleteKey('deepseek')
  }

  async getDoubaoStatus(): Promise<DoubaoCredentialStatus> {
    const file = await this.readFile()
    return this.status(file.doubao)
  }

  async saveDoubaoKey(apiKeyValue: string) {
    return this.saveKey('doubao', '豆包搜索 Custom 版', apiKeyValue)
  }

  async readDoubaoKey(): Promise<string | undefined> {
    return this.readKey('doubao')
  }

  async deleteDoubaoKey() {
    return this.deleteKey('doubao')
  }

  async getTiandituServerStatus(): Promise<TiandituServerCredentialStatus> {
    const file = await this.readFile()
    return this.status(file.tiandituServer)
  }

  async saveTiandituServerKey(apiKeyValue: string) {
    return this.saveKey('tiandituServer', '天地图服务端', apiKeyValue)
  }

  async readTiandituServerKey(): Promise<string | undefined> {
    return this.readKey('tiandituServer')
  }

  async deleteTiandituServerKey() {
    return this.deleteKey('tiandituServer')
  }

  async getTiandituWebStatus(): Promise<TiandituWebCredentialStatus> {
    const file = await this.readFile()
    return this.status(file.tiandituWeb)
  }

  async saveTiandituWebKey(apiKeyValue: string) {
    return this.saveKey('tiandituWeb', '天地图网页端', apiKeyValue)
  }

  async readTiandituWebKey(): Promise<string | undefined> {
    return this.readKey('tiandituWeb')
  }

  async deleteTiandituWebKey() {
    return this.deleteKey('tiandituWeb')
  }

  private status(credential?: StoredCredential): CredentialStatus {
    return {
      configured: Boolean(credential),
      encryptionAvailable: this.codec.isAvailable(),
      savedAt: credential?.savedAt,
    }
  }

  private async saveKey(kind: CredentialKind, label: string, apiKeyValue: string) {
    if (!this.codec.isAvailable()) throw new Error('系统加密能力不可用，已拒绝保存 Key。')
    const apiKey = apiKeyValue.trim()
    if (!apiKey) throw new Error(`请输入 ${label} API Key。`)
    if (apiKey.length > 512) throw new Error('API Key 长度异常，已拒绝保存。')
    const file = await this.readFile()
    const savedAt = new Date().toISOString()
    file[kind] = { encrypted: this.codec.encrypt(apiKey), savedAt }
    await this.writeFile(file)
    return savedAt
  }

  private async readKey(kind: CredentialKind): Promise<string | undefined> {
    const file = await this.readFile()
    const credential = file[kind]
    if (!credential) return undefined
    if (!this.codec.isAvailable()) throw new Error('系统加密能力不可用，无法读取已保存的 Key。')
    return this.codec.decrypt(credential.encrypted)
  }

  private async deleteKey(kind: CredentialKind) {
    const file = await this.readFile()
    if (!file[kind]) return false
    delete file[kind]
    await this.writeFile(file)
    return true
  }
}
