import type { Opportunity } from './agent-contract.js'
import type { EvidenceDocumentIdentifier, EvidenceRecord } from './evidence-contract.js'

export interface StoredCompany {
  id: string
  name: string
  evidenceIds: string[]
  updatedAt: string
}

export interface StoredProject {
  id: string
  companyId: string
  name: string
  normalizedName: string
  documentIdentifiers: EvidenceDocumentIdentifier[]
  evidenceIds: string[]
  updatedAt: string
}

export interface BusinessObjectStore {
  version: 1
  companies: Record<string, StoredCompany>
  projects: Record<string, StoredProject>
  opportunityProjectIds: Record<string, string>
}

export function emptyBusinessObjectStore(): BusinessObjectStore {
  return { version: 1, companies: {}, projects: {}, opportunityProjectIds: {} }
}

export function upsertBusinessObjects(
  current: BusinessObjectStore,
  opportunities: Opportunity[],
  evidenceRecords: EvidenceRecord[],
  updatedAt = new Date().toISOString(),
): BusinessObjectStore {
  const next: BusinessObjectStore = {
    version: 1,
    companies: { ...current.companies },
    projects: { ...current.projects },
    opportunityProjectIds: { ...current.opportunityProjectIds },
  }
  const evidenceById = new Map(evidenceRecords.map((record) => [record.id, record]))

  for (const opportunity of opportunities) {
    const companyEvidenceIds = unique([...(next.companies[opportunity.companyId]?.evidenceIds ?? []), ...opportunity.evidenceIds])
    next.companies[opportunity.companyId] = {
      id: opportunity.companyId,
      name: opportunity.companyName,
      evidenceIds: companyEvidenceIds,
      updatedAt,
    }

    const identifiers = uniqueIdentifiers(opportunity.evidenceIds.flatMap((id) => evidenceById.get(id)?.provenance.documentIdentifiers ?? []))
    const normalizedName = normalizeProjectName(opportunity.title)
    const existing = Object.values(next.projects).find((project) => project.companyId === opportunity.companyId && (
      identifiersOverlap(project.documentIdentifiers, identifiers)
      || (normalizedName.length > 0 && project.normalizedName === normalizedName)
    ))
    const idSeed = identifiers[0]
      ? `${opportunity.companyId}|${identifiers[0].kind}|${identifiers[0].value}`
      : `${opportunity.companyId}|${normalizedName}`
    const projectId = existing?.id ?? stableLocalId('project', idSeed)
    next.projects[projectId] = {
      id: projectId,
      companyId: opportunity.companyId,
      name: opportunity.title,
      normalizedName,
      documentIdentifiers: uniqueIdentifiers([...(existing?.documentIdentifiers ?? []), ...identifiers]),
      evidenceIds: unique([...(existing?.evidenceIds ?? []), ...opportunity.evidenceIds]),
      updatedAt,
    }
    next.opportunityProjectIds[opportunity.id] = projectId
  }
  return next
}

export function removeOpportunityBusinessObjects(current: BusinessObjectStore, opportunityId: string): BusinessObjectStore {
  const projectId = current.opportunityProjectIds[opportunityId]
  if (!projectId) return current
  const opportunityProjectIds = { ...current.opportunityProjectIds }
  delete opportunityProjectIds[opportunityId]
  if (Object.values(opportunityProjectIds).includes(projectId)) return { ...current, opportunityProjectIds }

  const projects = { ...current.projects }
  const companyId = projects[projectId]?.companyId
  delete projects[projectId]
  const companies = { ...current.companies }
  if (companyId && !Object.values(projects).some((project) => project.companyId === companyId)) delete companies[companyId]
  return { version: 1, companies, projects, opportunityProjectIds }
}

export function normalizeProjectName(value: string): string {
  return projectBaseTitle(value)
    .replace(/[\s【】\[\]()（）:：,，。;；\-—_]/g, '')
    .toLocaleLowerCase('zh-CN')
}

/** Keeps the readable project name while removing only a trailing procurement-stage label. */
export function projectBaseTitle(value: string): string {
  return value
    .trim()
    .replace(/[（(]\s*(?:立项|备案|采购意向|招标计划|资格预审|招标|采购|开标|评标|中标候选|成交候选|中标结果|成交结果|中标|成交|合同)(?:公告|公示|结果|阶段)?\s*[）)]\s*$/g, '')
    .replace(/(?:资格预审公告?|采购意向|招标计划|公开招标公告|招标公告|采购公告|竞争性磋商公告|竞争性谈判公告|询价公告|征集公告|中标候选人公示|成交候选人公示|中标[（(]成交[）)]结果公告|中标结果公告|中标公告|成交结果公告|成交公告|合同公告)$/g, '')
    .trim()
}

function identifiersOverlap(left: EvidenceDocumentIdentifier[], right: EvidenceDocumentIdentifier[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  const keys = new Set(left.map(identifierKey))
  return right.some((identifier) => keys.has(identifierKey(identifier)))
}

function uniqueIdentifiers(items: EvidenceDocumentIdentifier[]): EvidenceDocumentIdentifier[] {
  const byKey = new Map<string, EvidenceDocumentIdentifier>()
  for (const item of items) byKey.set(identifierKey(item), item)
  return [...byKey.values()]
}

function identifierKey(item: EvidenceDocumentIdentifier): string {
  return `${item.kind}:${item.value.replace(/\s+/g, '').toLowerCase()}`
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function stableLocalId(prefix: string, value: string): string {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
