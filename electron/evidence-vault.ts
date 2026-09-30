import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type {
  EvidenceDocumentExtraction,
  LocalEvidenceExtractionSummary,
  LocalEvidenceMediaKind,
  LocalEvidenceRecord,
} from '../shared/evidence-contract.js'
import { extractDocument } from './evidence-document-extractor.js'

export const DEFAULT_EVIDENCE_MAX_BYTES = 50 * 1024 * 1024

const allowedExtensions: Readonly<Record<string, LocalEvidenceMediaKind>> = {
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.txt': 'text',
  '.html': 'html',
  '.htm': 'html',
}

interface EvidenceIndex {
  version: 1
  records: LocalEvidenceRecord[]
}

const localMediaKinds = new Set<LocalEvidenceMediaKind>(['pdf', 'image', 'text', 'html'])
const localProcessingStatuses = new Set(['stored-unparsed', 'content-ready', 'needs-ocr', 'failed'])
const extractedProcessingStatuses = new Set(['content-ready', 'needs-ocr', 'failed'])
const provenanceCandidates = new Set(['explicit-repost', 'unknown'])
const identifierKinds = new Set(['project-number', 'purchase-number', 'document-number', 'unified-social-credit-code', 'other'])

export class EvidenceVault {
  private readonly filesRoot: string
  private readonly extractedTextRoot: string
  private readonly indexPath: string

  constructor(
    private readonly vaultRoot: string,
    private readonly maxBytes = DEFAULT_EVIDENCE_MAX_BYTES,
  ) {
    this.filesRoot = path.join(vaultRoot, 'files')
    this.extractedTextRoot = path.join(vaultRoot, 'extracted-text')
    this.indexPath = path.join(vaultRoot, 'index.v1.json')
  }

  async importFile(subjectNameValue: string, sourcePath: string): Promise<LocalEvidenceRecord> {
    const subjectName = subjectNameValue.trim()
    if (!subjectName || subjectName.length > 120) throw new Error('企业名称为空或长度异常。')
    const extension = path.extname(sourcePath).toLowerCase()
    const mediaKind = allowedExtensions[extension]
    if (!mediaKind) throw new Error('文件类型不受支持；请选择 PDF、图片、TXT 或 HTML。')

    const sourceStat = await stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error('选择的路径不是普通文件。')
    if (sourceStat.size === 0) throw new Error('空文件不能作为核验材料。')
    if (sourceStat.size > this.maxBytes) throw new Error(`文件过大；单个材料不能超过 ${formatMiB(this.maxBytes)} MiB。`)

    const sha256 = await hashFile(sourcePath)
    const index = await this.readIndex()
    const existing = index.records.find((record) => record.subjectName === subjectName && record.sha256 === sha256)
    if (existing) return existing

    await mkdir(this.filesRoot, { recursive: true })
    const id = randomUUID()
    const destination = path.join(this.filesRoot, `${id}${extension}`)
    await copyFile(sourcePath, destination)
    const extraction = await this.extractStoredFile(destination, mediaKind)
    const record: LocalEvidenceRecord = {
      id,
      subjectName,
      fileName: path.basename(sourcePath),
      extension,
      mediaKind,
      sizeBytes: sourceStat.size,
      sha256,
      importedAt: new Date().toISOString(),
      processingStatus: extraction.processingStatus,
      extraction: summarizeExtraction(extraction),
    }

    try {
      if (extraction.processingStatus === 'content-ready') {
        await mkdir(this.extractedTextRoot, { recursive: true })
        await writeFile(this.extractedTextPath(id), extraction.text, { encoding: 'utf8', mode: 0o600 })
      }
      index.records.push(record)
      await this.writeIndex(index)
    } catch (error) {
      await unlink(destination).catch(() => undefined)
      await unlink(this.extractedTextPath(id)).catch(() => undefined)
      throw error
    }
    return record
  }

  async list(subjectNameValue?: string): Promise<LocalEvidenceRecord[]> {
    const subjectName = subjectNameValue?.trim()
    const index = await this.readIndex()
    return index.records
      .filter((record) => !subjectName || record.subjectName === subjectName)
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt))
  }

  async readExtractedText(recordId: string): Promise<string | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return undefined
    const index = await this.readIndex()
    const record = index.records.find(item => item.id === recordId)
    if (!record || record.processingStatus !== 'content-ready') return undefined
    try {
      return await readFile(this.extractedTextPath(recordId), 'utf8')
    } catch (error) {
      if (isFileError(error, 'ENOENT')) return undefined
      throw error
    }
  }

  private async extractStoredFile(filePath: string, mediaKind: LocalEvidenceMediaKind): Promise<EvidenceDocumentExtraction> {
    try {
      const bytes = await readFile(filePath)
      return await extractDocument({ mediaKind, bytes: new Uint8Array(bytes) })
    } catch {
      return {
        processingStatus: 'failed',
        text: '',
        provenanceTypeCandidate: 'unknown',
        documentIdentifiers: [],
        truncated: false,
        warnings: ['材料已保存，但本地正文解析失败。'],
      }
    }
  }

  private extractedTextPath(recordId: string): string {
    return path.join(this.extractedTextRoot, `${recordId}.txt`)
  }

  private async readIndex(): Promise<EvidenceIndex> {
    let raw: string
    try {
      raw = await readFile(this.indexPath, 'utf8')
    } catch (error) {
      if (isFileError(error, 'ENOENT')) return { version: 1, records: [] }
      throw error
    }
    const value = JSON.parse(raw) as Partial<EvidenceIndex>
    if (value.version !== 1 || !Array.isArray(value.records) || !value.records.every(isEvidenceRecord)) {
      throw new Error('本地证据索引格式损坏。')
    }
    return value as EvidenceIndex
  }

  private async writeIndex(index: EvidenceIndex): Promise<void> {
    await mkdir(this.vaultRoot, { recursive: true })
    const temporaryPath = path.join(this.vaultRoot, `index.${randomUUID()}.tmp`)
    await writeFile(temporaryPath, JSON.stringify(index, null, 2), { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporaryPath, this.indexPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

function isEvidenceRecord(value: unknown): value is LocalEvidenceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Partial<LocalEvidenceRecord>
  return typeof record.id === 'string'
    && typeof record.subjectName === 'string'
    && typeof record.fileName === 'string'
    && typeof record.extension === 'string'
    && localMediaKinds.has(record.mediaKind as LocalEvidenceMediaKind)
    && typeof record.sizeBytes === 'number'
    && Number.isFinite(record.sizeBytes)
    && typeof record.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(record.sha256)
    && typeof record.importedAt === 'string'
    && localProcessingStatuses.has(record.processingStatus ?? '')
    && (record.processingStatus === 'stored-unparsed'
      ? record.extraction === undefined
      : isExtractionSummary(record.extraction) && record.extraction.processingStatus === record.processingStatus)
}

function isExtractionSummary(value: unknown): value is LocalEvidenceExtractionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const summary = value as Partial<LocalEvidenceExtractionSummary>
  return typeof summary.textCharacters === 'number'
    && Number.isInteger(summary.textCharacters)
    && summary.textCharacters >= 0
    && extractedProcessingStatuses.has(summary.processingStatus ?? '')
    && provenanceCandidates.has(summary.provenanceTypeCandidate ?? '')
    && Array.isArray(summary.documentIdentifiers)
    && summary.documentIdentifiers.every(item => typeof item === 'object'
      && item !== null
      && !Array.isArray(item)
      && identifierKinds.has((item as { kind?: unknown }).kind as string)
      && isNonEmptyString((item as { value?: unknown }).value))
    && Array.isArray(summary.warnings)
    && summary.warnings.every(item => typeof item === 'string')
    && typeof summary.truncated === 'boolean'
    && optionalNonEmptyString(summary.title)
    && optionalNonEmptyString(summary.publisherCandidate)
    && optionalNonEmptyString(summary.originalPublisherCandidate)
    && optionalNonEmptyString(summary.originalUrlCandidate)
    && optionalNonEmptyString(summary.publishedAtCandidate)
    && (summary.pageCount === undefined || (Number.isInteger(summary.pageCount) && summary.pageCount > 0))
}

function summarizeExtraction(extraction: EvidenceDocumentExtraction): LocalEvidenceExtractionSummary {
  const { text, ...summary } = extraction
  return { ...summary, textCharacters: text.length }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value)
}

function isFileError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)
}
