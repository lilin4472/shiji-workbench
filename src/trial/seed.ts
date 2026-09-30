import { createOpportunityCatalog } from '../../shared/opportunity-catalog'
import type { Opportunity } from '../../shared/agent-contract'
import type { EvidenceRecord } from '../../shared/evidence-contract'
import { loadAnalysisRuns, saveAnalysisRuns, saveDeepRadarResults, saveOpportunityCatalog, saveOpportunitySearchCriteria, saveSearchEvidence, saveWorkspace } from '../repository'
import { TRIAL_CASES } from './cases'

const SEED_KEY = 'shiji.trial-cases.v1'
const REPLAY_KEY = 'shiji.trial-replay.v2'

export function seedTrialCases() {
  // Existing r1 installs had a pre-completed timeline flag. Clear only that
  // trial-owned flag once so the user can actively replay it; keep their
  // project selections, archive state and other locally saved data intact.
  if (localStorage.getItem(SEED_KEY) === '1') {
    if (localStorage.getItem(REPLAY_KEY) !== '1') {
      saveAnalysisRuns(loadAnalysisRuns().filter((run) => !(run.opportunityId === 'trial-yuehu-monitoring' && run.moduleId === 'timeline' && run.message.includes('2026-09-17 的历史验收'))))
      localStorage.setItem(REPLAY_KEY, '1')
    }
    return
  }

  const opportunities: Opportunity[] = TRIAL_CASES.map((item, index) => ({
    id: `trial-${item.id}`,
    title: item.title,
    companyId: `trial-company-${item.id}`,
    companyName: item.subject,
    amountWan: null,
    locationAddress: item.place,
    distanceKm: null,
    deadline: null,
    matchScore: 0,
    projectType: index === 0 ? '市政项目 · 监测服务' : '机电安装工程',
    reason: `${item.summary} 金额线索：${item.amount}。本体验版不计算用户适配评分。`,
    evidenceIds: [`trial-evidence-${item.id}`],
    followUpLevel: '持续观察',
    confidence: '中低',
    timelineEvidence: index === 0 ? [{
      evidenceId: `trial-evidence-${item.id}`,
      stageId: 'tender',
      occurredAt: '2026-09-08',
      title: '竞争性磋商公告',
      source: '成都市武侯区人民政府',
    }] : [],
  }))

  const evidence: EvidenceRecord[] = TRIAL_CASES.map((item, index) => ({
    id: `trial-evidence-${item.id}`,
    subject: { kind: 'project', name: item.title },
    title: item.title,
    artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'discovered' },
    provenance: {
      pageUrl: item.source.url,
      publisher: item.source.label,
      provenanceType: index === 0 ? 'original' : 'reported-summary',
      documentIdentifiers: [],
      publishedAt: index === 0 ? '2026-09-08T00:00:00.000Z' : '2026-01-28T00:00:00.000Z',
      capturedAt: index === 0 ? '2026-09-17T09:38:59.706Z' : '2026-09-23T08:41:48.890Z',
      corroboratingEvidenceIds: [],
    },
    opportunityDetails: {
      companyCandidates: [item.subject],
      amountWanCandidates: [],
      stageIds: index === 0 ? ['tender'] : [],
      deadlineCandidates: [],
      addressCandidates: [item.place],
      overview: item.summary,
      contactCandidates: [],
      attachmentCandidates: [],
    },
    assessment: index === 0 ? {
      status: 'assessed', claimType: 'project-stage', grade: 'A', permittedUses: ['discovery', 'report-candidate', 'stage-confirmation'],
      reasons: ['2026-09-17 识机联网验收确认政府原公告与招标阶段。'], missingChecks: ['公告已过期，不代表现在仍可投标。'], assessedAt: '2026-09-17T09:38:59.706Z',
    } : { status: 'pending', reasons: ['中标信息来自公开转载，未核对企业原公告。'], missingChecks: ['打开原公告核对中标人、金额与日期。'] },
  }))

  const catalog = createOpportunityCatalog(opportunities, evidence.map((item) => item.id))
  catalog.nearbyResultIds = [opportunities[0].id]
  catalog.nearbyEvidenceIds = [evidence[0].id]
  saveSearchEvidence(evidence)
  saveOpportunityCatalog(catalog)
  saveAnalysisRuns([])
  saveDeepRadarResults(opportunities)
  saveOpportunitySearchCriteria({
    targetCompanyName: '', targetProjectName: '', address: '成都市武侯区', radiusKm: 50,
    specialty: '机电安装', amountMin: 0, amountMax: 9000, projectType: '不限',
    timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 5,
  })
  saveWorkspace({ activeView: 'overview', selectedOpportunityId: opportunities[0].id })
  localStorage.setItem(SEED_KEY, '1')
  localStorage.setItem(REPLAY_KEY, '1')
}
