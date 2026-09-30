export type EntityRelationshipType =
  | 'project-owner'
  | 'parent-company-of'
  | 'branch-of'
  | 'operates-project'
  | 'supplies-to'
  | 'tender-agent'
  | 'contractor'
  | 'consortium-member'
  | 'historical-bidder'
  | 'historical-winner'

export type RelationshipConfidence = 'confirmed' | 'supported-candidate' | 'discovery-clue'
export type ContactPointKind = 'phone' | 'email' | 'website' | 'address'
export type ContactContext = 'official-business' | 'public-professional' | 'user-provided'
export type ContactStatus = 'source-observed' | 'user-confirmed'

export interface ProjectEntity {
  id: string
  kind: 'project'
  name: string
  region?: string
}

export interface CompanyEntity {
  id: string
  kind: 'company'
  name: string
  region?: string
  unifiedSocialCreditCode?: string
}

export interface EntityRelationship {
  id: string
  sourceEntityId: string
  targetEntityId: string
  type: EntityRelationshipType
  confidence: RelationshipConfidence
  evidenceIds: string[]
  summary: string
}

/** A contact may be stored only when observed in public material or entered by the user. */
export interface ContactPoint {
  id: string
  entityId: string
  kind: ContactPointKind
  value: string
  label: string
  personName?: string
  role?: string
  context: ContactContext
  status: ContactStatus
  evidenceId: string
}

export interface BusinessGraph {
  project: ProjectEntity
  companies: CompanyEntity[]
  relationships: EntityRelationship[]
  contacts: ContactPoint[]
}

export interface LeadCandidate {
  id: string
  opportunityId: string
  entityId: string
  relationshipIds: string[]
  contactPointIds: string[]
  company: string
  role: string
  reason: string
  channel: string
  nextMove: string
  priority: 'A' | 'B' | 'C'
}

const relationshipLabels: Record<EntityRelationshipType, string> = {
  'project-owner': '项目投资与建设主体',
  'parent-company-of': '上级集团 / 母公司',
  'branch-of': '集团分支机构',
  'operates-project': '项目运营主体',
  'supplies-to': '上下游供应关系',
  'tender-agent': '招标代理',
  contractor: '承包与履约主体',
  'consortium-member': '联合体成员',
  'historical-bidder': '历史投标方',
  'historical-winner': '历史中标方',
}

export function deriveLeadCandidates(graph: BusinessGraph, opportunityId: string): LeadCandidate[] {
  return graph.companies.flatMap((company) => {
    const relationships = graph.relationships.filter((relationship) =>
      relationship.sourceEntityId === company.id || relationship.targetEntityId === company.id)
    if (relationships.length === 0) return []
    const contacts = graph.contacts.filter((contact) => contact.entityId === company.id)
    const strongest = strongestRelationship(relationships)
    const primaryContact = contacts[0]
    const lead: LeadCandidate = {
      id: `lead:${opportunityId}:${company.id}`,
      opportunityId,
      entityId: company.id,
      relationshipIds: relationships.map((relationship) => relationship.id),
      contactPointIds: contacts.map((contact) => contact.id),
      company: company.name,
      role: relationshipTypeLabel(strongest.type),
      reason: unique(relationships.map((relationship) => relationship.summary)).join('；'),
      channel: primaryContact ? contactLabel(primaryContact) : '公开联系方式待提取',
      nextMove: primaryContact ? '打开来源核对联系人与号码时效后再联系' : '从关系证据原文和企业公开页面补充联系方式',
      priority: strongest.confidence === 'confirmed' ? 'A' : strongest.confidence === 'supported-candidate' ? 'B' : 'C',
    }
    return [lead]
  }).sort((left, right) => left.priority.localeCompare(right.priority))
}

export function relationshipTypeLabel(type: EntityRelationshipType): string {
  return relationshipLabels[type]
}

export function assertBusinessGraph(graph: BusinessGraph, allowedEvidenceIds?: ReadonlySet<string>): void {
  const entities = [graph.project, ...graph.companies]
  const entityIds = new Set(entities.map((entity) => entity.id))
  if (entityIds.size !== entities.length || entities.some((entity) => !entity.id.trim() || !entity.name.trim())) {
    throw new Error('关系图主体不完整或存在重复。')
  }
  for (const relationship of graph.relationships) {
    if (!entityIds.has(relationship.sourceEntityId) || !entityIds.has(relationship.targetEntityId)) {
      throw new Error('关系引用了不存在的主体。')
    }
    assertEvidenceIds(relationship.evidenceIds, allowedEvidenceIds)
  }
  const companyIds = new Set(graph.companies.map((company) => company.id))
  for (const contact of graph.contacts) {
    if (!companyIds.has(contact.entityId) || !contact.value.trim() || !contact.label.trim()) {
      throw new Error('联系方式没有关联有效企业主体。')
    }
    assertEvidenceIds([contact.evidenceId], allowedEvidenceIds)
  }
}

function assertEvidenceIds(evidenceIds: string[], allowedEvidenceIds?: ReadonlySet<string>): void {
  if (evidenceIds.length === 0 || evidenceIds.some((id) => !id.trim() || (allowedEvidenceIds && !allowedEvidenceIds.has(id)))) {
    throw new Error('关系或联系方式缺少有效证据。')
  }
}

function strongestRelationship(relationships: EntityRelationship[]): EntityRelationship {
  const rank: Record<RelationshipConfidence, number> = { confirmed: 0, 'supported-candidate': 1, 'discovery-clue': 2 }
  return relationships.reduce((best, item) => rank[item.confidence] < rank[best.confidence] ? item : best)
}

function contactLabel(contact: ContactPoint): string {
  return contact.personName ? `${contact.personName} · ${contact.value}` : `${contact.label} · ${contact.value}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
