import { describe, expect, it } from 'vitest'
import type { AgentTask } from '../shared/agent-contract'
import { AgentRunError, AgentRunner } from '../shared/agent-runtime'
import { vi } from 'vitest'
import { buildDshDeepRadarIntentPrompt, buildDshIntentPrompt, buildDshOpportunityPrompt, createControllerDshTaskExecutor, DSH_SMOKE_MAX_TOKENS, DshAgentBackend, parseDshIntent, runDshModelSmokeTest } from './dsh-agent-backend'
import { DshRuntimeController, type DshRuntimeClient } from './dsh-runtime-controller'
import type { SearchResult } from '../shared/search-contract'

const task: AgentTask = {
  id: 'dsh-task-1', kind: 'opportunity-search', prompt: '找上海机电项目',
  criteria: { address: '上海', radiusKm: 20, specialty: '机电安装', amountMin: 1000, amountMax: 5000, projectType: '不限', timeWindow: '未来60天', targetStageId: 'all', candidateLimit: 10 },
}

const opportunity = {
  id: 'dsh-opp-1', title: '示例项目', companyId: 'company-1', companyName: '示例建设有限公司', amountWan: 1200, locationAddress: null, distanceKm: null,
  deadline: '2026-10-01', matchScore: 88, projectType: '产业园区', reason: '匹配', evidenceIds: ['ev-1'], followUpLevel: '值得验证', confidence: '中',
  timelineEvidence: [{ evidenceId: 'ev-1', stageId: 'tender', occurredAt: '2026-09-01', title: '招标公告', source: '公共资源交易平台' }],
}

const discovery: SearchResult = {
  provider: 'doubao', purpose: 'opportunity-discovery', query: '上海 机电安装 招标公告 官方',
  sources: [{ url: 'https://example.gov.cn/tender/1', sourceClass: 'government', title: '示例项目招标公告', content: '招标人为示例建设有限公司，项目金额1200万元。' }],
  evidenceRecords: [{
    id: 'ev-1', subject: { kind: 'unknown' }, title: '示例项目招标公告',
    artifact: { origin: 'web', mediaKind: 'webpage', processingStatus: 'content-ready' },
    provenance: { pageUrl: 'https://example.gov.cn/tender/1', publisher: 'example.gov.cn', provenanceType: 'unknown', documentIdentifiers: [], capturedAt: '2026-09-07T02:00:00.000Z', corroboratingEvidenceIds: [] },
    discovery: { provider: 'doubao', query: '上海 机电安装 招标公告 官方', providerSourceClass: 'government' },
    assessment: { status: 'pending', reasons: [], missingChecks: ['待核验'] },
  }],
  truncated: false, requestCount: 1, cacheHit: false, checkedAt: '2026-09-07T02:00:00.000Z',
}

const discover = vi.fn(async () => discovery)

describe('DshAgentBackend', () => {
  it('does not search using old conditions if intent interpretation fails', async () => {
    const search = vi.fn()
    const backend = new DshAgentBackend(vi.fn(), search, undefined, async () => ({ finalResponse: '{}' }))
    await expect(new AgentRunner(backend).run({ ...task, inputMode: 'free' })).rejects.toThrow('未发起搜索')
    expect(search).not.toHaveBeenCalled()
  })

  it('routes business credit without launching a tender search or replacing projects', async () => {
    const search = vi.fn()
    const backend = new DshAgentBackend(vi.fn(), search, undefined, async () => ({
      finalResponse: JSON.stringify({ route: 'risk', subject: '企业主体', message: '查询登记及处罚' }),
    }))
    const result = await new AgentRunner(backend).run({ ...task, inputMode: 'free' })
    expect(result.handoff).toMatchObject({ route: 'risk', subject: '企业主体' })
    expect(search).not.toHaveBeenCalled()
  })

  it('reads the untouched free prompt with DSH before discovery', async () => {
    const order: string[] = []
    const interpret = vi.fn(async (freeTask: AgentTask) => {
      order.push(`intent:${freeTask.prompt}`)
      return { finalResponse: JSON.stringify({ criteria: {
        ...freeTask.criteria, address: '北京', specialty: '消防', timeWindow: '未来十天', targetStageId: 'tender',
      }, requestedCount: 2 }) }
    })
    const discoverFree = vi.fn(async (freeTask: AgentTask) => {
      order.push(`search:${freeTask.criteria.address}:${freeTask.criteria.specialty}:${freeTask.requestedCount}`)
      return discovery
    })
    const runner = new AgentRunner(new DshAgentBackend(async () => {
      order.push('model')
      return { finalResponse: JSON.stringify({ opportunities: [opportunity] }) }
    }, discoverFree, undefined, interpret))

    await runner.run({ ...task, inputMode: 'free', prompt: '我想在北京找未来十天的消防项目，给我两个' })

    expect(order[0]).toContain('我想在北京找未来十天的消防项目，给我两个')
    expect(order[1]).toBe('search:北京:消防:2')
    expect(parseDshIntent('{"criteria":{"timeWindow":"未来十天"},"requestedCount":2}')).toMatchObject({
      criteria: { timeWindow: '未来十天' }, requestedCount: 2,
    })
  })

  it('does not let the intent model rewrite a condition-button radar region', async () => {
    const radarTask: AgentTask = {
      ...task,
      kind: 'deep-radar-search',
      inputMode: 'conditions',
      prompt: '按当前画像匹配商机',
      profile: {
        subjectType: 'enterprise', name: '南京思杰', businessRegions: ['南京'], companyNature: '民营', scale: '50人',
        industries: ['建筑安装'], specialties: ['机电安装'], qualifications: [], assetsAndEquipment: '', personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
      },
      criteria: { ...task.criteria, address: '南京', specialty: '机电安装', targetStageId: 'tender' },
    }
    const interpret = vi.fn(async () => ({ finalResponse: JSON.stringify({ criteria: { ...radarTask.criteria, address: '北京' } }) }))
    const discoverConditions = vi.fn(async (received: AgentTask) => {
      expect(received.criteria.address).toBe('南京')
      return { ...discovery, sources: [], evidenceRecords: [] }
    })

    await new AgentRunner(new DshAgentBackend(vi.fn(), discoverConditions, undefined, interpret)).run(radarTask)

    expect(interpret).not.toHaveBeenCalled()
    expect(discoverConditions).toHaveBeenCalledOnce()
  })

  it('tells automatic intent that an explicit tender request overrides a saved candidate stage', () => {
    const prompt = buildDshIntentPrompt({ ...task, inputMode: 'free', prompt: '成都招标项目两个', criteria: { ...task.criteria, targetStageId: 'candidate' } })
    expect(prompt).toContain('必须覆盖条件栏中的 candidate')
    expect(prompt).toContain('程序不会用旧条件补齐缺失字段')
  })

  it('uses the model-composed final criteria instead of merging a stale candidate stage back in', async () => {
    const staleTask: AgentTask = { ...task, inputMode: 'free', prompt: '成都招标项目两个', criteria: { ...task.criteria, targetStageId: 'candidate' } }
    const discoverFree = vi.fn(async (interpretedTask: AgentTask) => {
      expect(interpretedTask.criteria.targetStageId).toBe('tender')
      return { ...discovery, sources: [], evidenceRecords: [] }
    })
    const interpret = vi.fn(async () => ({ finalResponse: JSON.stringify({
      route: 'opportunity', requestedCount: 2, searchQuery: '成都 招标项目',
      criteria: { ...staleTask.criteria, targetStageId: 'tender' },
    }) }))

    await new AgentRunner(new DshAgentBackend(vi.fn(), discoverFree, undefined, interpret)).run(staleTask)
    expect(discoverFree).toHaveBeenCalledOnce()
  })

  it('stops before search when the model omits a final field instead of silently inheriting it', async () => {
    const discoverFree = vi.fn()
    const interpret = vi.fn(async () => ({ finalResponse: JSON.stringify({
      route: 'opportunity', searchQuery: '成都 招标项目', criteria: { address: '成都', specialty: '安装', targetStageId: 'tender' },
    }) }))

    await expect(new AgentRunner(new DshAgentBackend(vi.fn(), discoverFree, undefined, interpret)).run({ ...task, inputMode: 'free' }))
      .rejects.toThrow('避免错误沿用旧条件')
    expect(discoverFree).not.toHaveBeenCalled()
  })

  it('gives deep radar an isolated profile-only intent contract', () => {
    const radarTask: AgentTask = { ...task, kind: 'deep-radar-search', inputMode: 'free', prompt: '按我的长期能力画像匹配项目', profile: {
      subjectType: 'enterprise', name: '成都安装企业', businessRegions: ['成都'], companyNature: '民营', scale: '50人',
      industries: ['建筑安装'], specialties: ['机电安装'], qualifications: [], assetsAndEquipment: '', personnelAndExperience: '', deliveryBoundary: '', riskPreference: 'balanced',
    } }
    const prompt = buildDshDeepRadarIntentPrompt(radarTask)
    expect(prompt).toContain('不得读取或沿用自动识别')
    expect(prompt).toContain('用户长期商业能力画像')
    expect(prompt).not.toContain('上海')
  })

  it('maps notifications and accepts only the structured opportunity payload', async () => {
    const events: string[] = []
    const runner = new AgentRunner(new DshAgentBackend(async (_task, context) => {
      context.onNotification({ method: 'session.event', params: {} })
      context.onNotification({ method: 'session.event', params: {} })
      context.onNotification({ method: 'session.status', params: { status: 'idle' } })
      context.onNotification({ method: 'session.status', params: { status: 'idle' } })
      return { finalResponse: `说明文字\n${JSON.stringify({ opportunities: [opportunity] })}` }
    }, discover))
    const result = await runner.run(task, { onEvent: (event) => events.push(event.message) })
    expect(result.backend).toContain('DeepSeek Harness')
    expect(result.opportunities[0]?.id).toBe('dsh-opp-1')
    expect(result.discovery).toMatchObject({ provider: 'doubao', sourceCount: 1, requestCount: 1, cacheHit: false })
    expect(events).toContain('已用 豆包搜索 Custom 取得 1 条候选来源，本次产生 1 次搜索调用。')
    expect(events.filter((message) => message === 'DSH 正在处理模型与工具事件…')).toHaveLength(1)
    expect(events.filter((message) => message === 'DSH 任务已完成，正在校验结构化结果…')).toHaveLength(1)
    expect(events.at(-1)).toContain('真实搜索命中 1 条')
    expect(events.at(-1)).toContain('DSH 结构化 1 条')
  })

  it('keeps a source candidate when the model output is incomplete', async () => {
    const runner = new AgentRunner(new DshAgentBackend(async () => ({ finalResponse: '{"opportunities":[{"id":"bad"}]}' }), discover))
    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('surfaces a persisted provider quota failure while keeping the source candidate', async () => {
    const runner = new AgentRunner(new DshAgentBackend(async () => ({
      finalResponse: '',
      events: [{ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', status: 402 } } } }],
    }), discover))
    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('builds a prompt with an explicit JSON contract', () => {
    const prompt = buildDshOpportunityPrompt(task, discovery)
    expect(prompt).toContain('只输出一个 JSON 对象')
    expect(prompt).toContain(task.id)
    expect(prompt).toContain('https://example.gov.cn/tender/1')
    expect(prompt).toContain('不得调用搜索')
    expect(prompt).toContain('严禁把 occurredAt 设为 null')
    expect(prompt).not.toContain('项目金额1200万元')
  })

  it('creates internal ids locally and normalizes model score and low confidence', async () => {
    const modelValue = { ...opportunity, companyId: null, matchScore: 0.85, confidence: '低' }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [modelValue] }) }),
      discover,
    ))

    const result = await runner.run(task)

    expect(result.opportunities[0]).toMatchObject({
      companyId: expect.stringMatching(/^company-[0-9a-f]{8}$/),
      matchScore: 85,
      confidence: '中低',
    })
  })

  it('drops a timeline item with no observed stage date instead of rejecting the whole opportunity', async () => {
    const noDatedTimeline = {
      ...opportunity,
      timelineEvidence: [{ ...opportunity.timelineEvidence[0], occurredAt: null }],
    }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [noDatedTimeline] }) }),
      discover,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ timelineEvidence: [] }] })
  })

  it('connects one agent task to the controlled runtime and always closes it', async () => {
    const client: DshRuntimeClient = {
      start: vi.fn(),
      initialize: vi.fn(async () => ({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })),
      run: vi.fn(async (_input, options) => {
        options.onNotification?.({ method: 'session.status', params: { status: 'idle' } })
        return { finalResponse: JSON.stringify({ opportunities: [opportunity] }) }
      }),
      close: vi.fn(async () => {}),
    }
    const versionProbe = (version: string) => ({ command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(version)})`] })
    const controller = new DshRuntimeController({
      launch: { command: 'electron.exe', args: ['runtime.js'] },
      dshVersionProbe: versionProbe('0.1.1-rc.2'),
      nodeVersionProbe: versionProbe('24.20.0'),
      expectedVersions: { dsh: '0.1.1-rc.2', node: '24.20.0' },
      expectedIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      createClient: () => client,
    })
    const backend = new DshAgentBackend(createControllerDshTaskExecutor(controller, {
      cwd: 'C:\\workspace', provider: 'deepseek-official', model: 'deepseek-v4-flash',
    }), discover)
    const result = await new AgentRunner(backend).run(task)
    expect(result.opportunities).toHaveLength(1)
    expect(client.run).toHaveBeenCalledWith(expect.stringContaining('https://example.gov.cn/tender/1'), expect.objectContaining({ sessionId: task.id }))
    expect(client.close).toHaveBeenCalledOnce()
    expect(controller.state).toBe('stopped')
  })

  it('does not spend a model call when the selected search returns no sources', async () => {
    const execute = vi.fn()
    const emptyDiscovery = { ...discovery, sources: [], evidenceRecords: [] }
    const result = await new AgentRunner(new DshAgentBackend(execute, async () => emptyDiscovery)).run(task)

    expect(execute).not.toHaveBeenCalled()
    expect(result.opportunities).toEqual([])
    expect(result.discovery).toMatchObject({ provider: 'doubao', sourceCount: 0 })
  })

  it('keeps rejected pages as evidence only instead of promoting them to opportunities', async () => {
    const execute = vi.fn()
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: false, subjectCandidates: [],
          stageIds: ['award'], stageDateCandidates: ['2026-09-01'], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [], reasons: ['未命中目标招标阶段。'],
        },
      })),
    }

    const result = await new AgentRunner(new DshAgentBackend(execute, async () => screenedDiscovery)).run(task)

    expect(execute).not.toHaveBeenCalled()
    expect(result.opportunities).toHaveLength(0)
    expect(result.evidenceRecords).toHaveLength(1)
  })

  it('does not spend a model call when explicit amount and deadline candidates miss the user conditions', async () => {
    const execute = vi.fn()
    const events: string[] = []
    const screenedDiscovery: SearchResult = {
      ...discovery,
      checkedAt: '2026-09-07T12:35:41.083Z',
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true, subjectCandidates: ['示例建设有限公司'],
          stageIds: ['tender'], stageDateCandidates: [], deadlineCandidates: ['2026-02-25'], amountWanCandidates: [540], addressCandidates: [], reasons: ['主体与阶段已有文字依据。'],
        },
      })),
    }

    const result = await new AgentRunner(new DshAgentBackend(execute, async () => screenedDiscovery)).run(task, {
      onEvent: (event) => events.push(event.message),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]?.confidence).toBe('中低')
    expect(events.at(-1)).toContain('金额或招标截止时间')
  })

  it('does not send a stale published source to DSH for a recent-window task', async () => {
    const execute = vi.fn()
    const recentTask: AgentTask = {
      ...task,
      criteria: { ...task.criteria, timeWindow: '近10天' },
    }
    const staleDiscovery: SearchResult = {
      ...discovery,
      checkedAt: '2026-09-13T04:00:00.000Z',
      sources: discovery.sources.map((source) => ({
        ...source,
        publishedAt: '2026-04-29',
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true, subjectCandidates: ['示例建设有限公司'],
          stageIds: ['tender'], stageDateCandidates: ['2026-04-29'], deadlineCandidates: [], amountWanCandidates: [1200], addressCandidates: [], reasons: ['主体与目标阶段已有文字依据。'],
        },
      })),
    }
    const events: string[] = []
    const result = await new AgentRunner(new DshAgentBackend(execute, async () => staleDiscovery)).run(recentTask, {
      onEvent: (event) => events.push(event.message),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]?.confidence).toBe('中低')
    expect(events.at(-1)).toContain('明确时间窗不满足')
    expect(result.evidenceRecords[0]?.assessment.missingChecks.join('')).toContain('发布日期')
  })

  it('keeps a recent initiation clue even when an embedded tender deadline is not in the future window', () => {
    const initiationDiscovery: SearchResult = {
      ...discovery,
      checkedAt: '2026-09-07T12:35:41.083Z',
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true, subjectCandidates: ['示例建设有限公司'],
          stageIds: ['initiation'], stageDateCandidates: ['2026-08-10'], deadlineCandidates: ['2026-08-31'], amountWanCandidates: [1200], addressCandidates: [], reasons: ['立项主体与日期已有文字依据。'],
        },
      })),
    }

    const prompt = buildDshOpportunityPrompt(task, initiationDiscovery)

    expect(prompt).toContain('https://example.gov.cn/tender/1')
    expect(prompt).toContain('2026-08-10')
  })

  it('sends only deterministically eligible bodies and their checks to the model prompt', () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: [
        {
          ...discovery.sources[0],
          opportunityChecks: {
            readStatus: 'body-ready', eligibleForModel: true, subjectCandidates: ['示例建设有限公司'],
            stageIds: ['tender'], stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2026-10-01'], amountWanCandidates: [1200], addressCandidates: ['上海市浦东新区'], reasons: ['主体与目标阶段均有明确文字。'],
          },
        },
        {
          url: 'https://example.com/award/2', sourceClass: 'other', title: '另一项目中标公告',
          opportunityChecks: {
            readStatus: 'body-ready', eligibleForModel: false, subjectCandidates: ['另一公司'],
            stageIds: ['award'], stageDateCandidates: [], deadlineCandidates: [], amountWanCandidates: [], addressCandidates: [], reasons: ['未命中目标阶段。'],
          },
        },
      ],
      evidenceRecords: [
        discovery.evidenceRecords[0],
        { ...discovery.evidenceRecords[0], id: 'ev-2', provenance: { ...discovery.evidenceRecords[0].provenance, pageUrl: 'https://example.com/award/2' } },
      ],
    }

    const prompt = buildDshOpportunityPrompt(task, screenedDiscovery)

    expect(prompt).toContain('示例建设有限公司')
    expect(prompt).toContain('主体与目标阶段均有明确文字')
    expect(prompt).not.toContain('https://example.com/award/2')
  })

  it('keeps a pending source candidate when model evidence ids are not grounded', async () => {
    const ungrounded = { ...opportunity, evidenceIds: ['invented-id'] }
    const runner = new AgentRunner(new DshAgentBackend(async () => ({ finalResponse: JSON.stringify({ opportunities: [ungrounded] }) }), discover))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('keeps a pending source candidate when a model result misses the locked target', async () => {
    const lockedTask: AgentTask = {
      ...task,
      criteria: { ...task.criteria, targetCompanyName: '目标建设有限公司', targetProjectName: '目标产业园工程' },
    }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [opportunity] }) }),
      discover,
    ))

    await expect(runner.run(lockedTask)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('keeps grounded items when another model item in the same batch is invalid', async () => {
    const invalid = { ...opportunity, id: 'invalid', evidenceIds: ['invented-id'] }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [invalid, opportunity] }) }),
      discover,
    ))

    const result = await runner.run(task)

    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]?.id).toBe('dsh-opp-1')
  })

  it('keeps a pending source candidate when model facts conflict with deterministic checks', async () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true,
          subjectCandidates: ['示例建设有限公司'], stageIds: ['tender'],
          stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2026-10-01'], amountWanCandidates: [1200], addressCandidates: ['上海市浦东新区'], reasons: ['主体与阶段已有文字依据。'],
        },
      })),
    }
    const fabricated = {
      ...opportunity,
      companyName: '无关企业有限公司',
      timelineEvidence: [{ ...opportunity.timelineEvidence[0], stageId: 'award', occurredAt: '2026-09-30' }],
    }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [fabricated] }) }),
      async () => screenedDiscovery,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('accepts company and timeline facts that exactly match deterministic source checks', async () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true,
          subjectCandidates: ['示例建设有限公司'], stageIds: ['tender'],
          stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2026-10-01'], amountWanCandidates: [1200], addressCandidates: ['上海市浦东新区'], reasons: ['主体与阶段已有文字依据。'],
        },
      })),
    }
    const groundedOpportunity = { ...opportunity, distanceKm: null }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [groundedOpportunity] }) }),
      async () => screenedDiscovery,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ companyName: '示例建设有限公司' }] })
  })

  it('keeps the source when the model invents an address instead of dropping the source', async () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true,
          subjectCandidates: ['示例建设有限公司'], stageIds: ['tender'],
          stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2026-10-01'], amountWanCandidates: [1200],
          addressCandidates: ['上海市浦东新区临港大道100号'], reasons: ['主体、阶段和项目地址已有文字依据。'],
        },
      })),
    }
    const fabricated = { ...opportunity, locationAddress: '模型猜测的地址' }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [fabricated] }) }),
      async () => screenedDiscovery,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('keeps a pending source when the model invents amount, deadline or distance', async () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true,
          subjectCandidates: ['示例建设有限公司'], stageIds: ['tender'],
          stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2026-10-01'], amountWanCandidates: [1200], addressCandidates: ['上海市浦东新区'],
          reasons: ['主体与阶段已有文字依据。'],
        },
      })),
    }
    const fabricated = { ...opportunity, amountWan: 1300, deadline: '2026-10-02', distanceKm: 4 }
    const runner = new AgentRunner(new DshAgentBackend(
      async () => ({ finalResponse: JSON.stringify({ opportunities: [fabricated] }) }),
      async () => screenedDiscovery,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', evidenceIds: ['ev-1'] }] })
  })

  it('screens out a sourced deadline outside the user future window before model execution', async () => {
    const screenedDiscovery: SearchResult = {
      ...discovery,
      sources: discovery.sources.map((source) => ({
        ...source,
        opportunityChecks: {
          readStatus: 'body-ready', eligibleForModel: true,
          subjectCandidates: ['示例建设有限公司'], stageIds: ['tender'],
          stageDateCandidates: ['2026-09-01'], deadlineCandidates: ['2027-01-20'], amountWanCandidates: [1200], addressCandidates: ['上海市浦东新区'],
          reasons: ['主体与阶段已有文字依据。'],
        },
      })),
    }
    const outsideWindow = { ...opportunity, distanceKm: null, deadline: '2027-01-20' }
    const execute = vi.fn(async () => ({ finalResponse: JSON.stringify({ opportunities: [outsideWindow] }) }))
    const runner = new AgentRunner(new DshAgentBackend(
      execute,
      async () => screenedDiscovery,
    ))

    await expect(runner.run(task)).resolves.toMatchObject({ opportunities: [{ confidence: '中低', deadline: '2027-01-20' }] })
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps unsupported amount, distance and deadline unknown instead of forcing invented values', async () => {
    const unknownFields = { ...opportunity, amountWan: null, distanceKm: null, deadline: null }
    const runner = new AgentRunner(new DshAgentBackend(async () => ({ finalResponse: JSON.stringify({ opportunities: [unknownFields] }) }), discover))

    await expect(runner.run(task)).resolves.toMatchObject({
      opportunities: [{ amountWan: null, distanceKm: null, deadline: null }],
    })
  })

  it('limits the real model smoke test and always closes the runtime', async () => {
    const client: DshRuntimeClient = {
      start: vi.fn(),
      initialize: vi.fn(async () => ({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })),
      run: vi.fn(async () => ({ finalResponse: '{"status":"SHIJI_DSH_READY"}' })),
      close: vi.fn(async () => {}),
    }
    const versionProbe = (version: string) => ({ command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(version)})`] })
    const controller = new DshRuntimeController({
      launch: { command: 'electron.exe', args: ['runtime.js'] },
      dshVersionProbe: versionProbe('0.1.1-rc.2'),
      nodeVersionProbe: versionProbe('24.20.0'),
      expectedVersions: { dsh: '0.1.1-rc.2', node: '24.20.0' },
      expectedIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      createClient: () => client,
    })

    const result = await runDshModelSmokeTest(controller, { cwd: 'C:\\workspace', provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    expect(result).toMatchObject({ connected: true, model: 'deepseek-v4-flash', maxOutputTokens: DSH_SMOKE_MAX_TOKENS })
    expect(client.initialize).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: DSH_SMOKE_MAX_TOKENS }))
    expect(client.run).toHaveBeenCalledWith(expect.stringContaining('SHIJI_DSH_READY'), expect.any(Object))
    expect(client.close).toHaveBeenCalledOnce()
    expect(controller.state).toBe('stopped')
  })

  it('maps a persisted QUOTA event to controlled balance guidance', async () => {
    const client: DshRuntimeClient = {
      start: vi.fn(),
      initialize: vi.fn(async () => ({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })),
      run: vi.fn(async () => ({
        finalResponse: '',
        events: [{
          type: 'turn/end',
          data: { turn: 1, reason: { kind: 'error', error: { message: 'Insufficient Balance', code: 'QUOTA', status: 402 } } },
        }],
      })),
      close: vi.fn(async () => {}),
    }
    const versionProbe = (version: string) => ({ command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(version)})`] })
    const controller = new DshRuntimeController({
      launch: { command: 'electron.exe', args: ['runtime.js'] },
      dshVersionProbe: versionProbe('0.1.1-rc.2'),
      nodeVersionProbe: versionProbe('24.20.0'),
      expectedVersions: { dsh: '0.1.1-rc.2', node: '24.20.0' },
      expectedIdentity: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
      createClient: () => client,
    })

    await expect(runDshModelSmokeTest(controller, {
      cwd: 'C:\\workspace', provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })).rejects.toThrow('账户余额不足')
    expect(client.close).toHaveBeenCalledOnce()
  })
})
