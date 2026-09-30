import type { AgentTask, BusinessProfile, OpportunitySearchCriteria, SearchInputMode } from './agent-contract.js'
import type { UserSearchProviderId } from './search-preference.js'
import type { ProjectStageFilter } from './project-timeline.js'

/**
 * 雷达默认阶段：只要"在招、可投标"的项目。用户在雷达筛选框里可以改成
 * 其它阶段或"不限"，该值属于本次搜索条件，不写回长期能力画像。
 */
export const DEEP_RADAR_DEFAULT_STAGE: ProjectStageFilter = 'tender'

export function deepRadarSearchCriteria(
  profile: BusinessProfile,
  targetStageId: ProjectStageFilter = DEEP_RADAR_DEFAULT_STAGE,
): OpportunitySearchCriteria {
  return {
    targetCompanyName: '',
    targetProjectName: '',
    address: profile.businessRegions.join('、'),
    radiusKm: 100,
    specialty: profile.specialties.join('、') || profile.industries.join('、'),
    amountMin: 0,
    amountMax: 999_999_999,
    projectType: '不限',
    timeWindow: '未来90天',
    targetStageId,
    candidateLimit: 10,
  }
}

export function createDeepRadarTask(
  id: string,
  prompt: string,
  profile: BusinessProfile,
  searchProvider: UserSearchProviderId,
  targetStageId: ProjectStageFilter = DEEP_RADAR_DEFAULT_STAGE,
  inputMode: SearchInputMode = 'free',
): AgentTask {
  return {
    id,
    kind: 'deep-radar-search',
    prompt,
    profile,
    criteria: deepRadarSearchCriteria(profile, targetStageId),
    inputMode,
    searchProvider,
  }
}
