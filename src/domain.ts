export type ID = string

import type { BusinessProfile, OpportunitySearchCriteria, Opportunity } from '../shared/agent-contract'
import type { NearbyAudience } from '../shared/agent-contract'

export type { BusinessProfile, OpportunitySearchCriteria, Opportunity } from '../shared/agent-contract'

export type TaskMode = 'radar' | 'nearby'

export type ColorTheme = 'current' | 'warm' | 'porcelain'

export interface Evidence {
  id: ID
  title: string
  source: string
  capturedAt: string
  reliability: 'official' | 'secondary' | 'manual'
}

export interface Company {
  id: ID
  name: string
  region: string
  creditStatus: '待核验' | '已核验未发现' | '发现记录'
  tags: string[]
}

export interface Task {
  id: ID
  title: string
  createdAt: string
  status: 'draft' | 'running' | 'done' | 'cancelled' | 'failed'
  mode: TaskMode
  nearbyAudience?: NearbyAudience
  request: OpportunitySearchCriteria | BusinessProfile
  opportunityIds: ID[]
}


export interface ActionItem {
  id: ID
  opportunityId: ID
  category: '业务跟踪' | '商务对接' | '投标准备'
  title: string
  detail: string
  basis: string
  sourceModules: Array<'项目详情' | '时间链' | '政策链' | '产业链' | '公开风险' | '获客' | '关注'>
  target?: string
  timing: '今天' | '本周' | '持续观察' | '体验复盘'
  owner: string
  done: boolean
}

export type WorkspaceView =
  | 'simulation'
  | 'overview'
  | 'radar'
  | 'nearby'
  | 'timeline'
  | 'policy'
  | 'industry'
  | 'risk'
  | 'leads'
  | 'actions'
  | 'compare'
  | 'watch'
  | 'library'
  | 'capabilities'
  | 'agent'
  | 'settings'

export interface WorkspaceState {
  activeView: WorkspaceView
  selectedOpportunityId?: ID
  selectedRadarOpportunityId?: ID
  currentTask?: Task
}

export type DropBucket = 'focus' | 'compare' | 'action'

export type ManagedObjectKind = 'opportunity' | 'recommendation'

export interface ManagedObject {
  kind: ManagedObjectKind
  id: ID
  title: string
  opportunityId?: ID
}

export type ManagedBuckets = Record<DropBucket, ManagedObject[]>
