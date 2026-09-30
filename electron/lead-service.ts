// 获客真实执行器 v3（2026-09-18 用户口径）：
//   对象 = 产业链已发现的同一批关系节点（不含甲方，7 家，硬门禁先跑产业链）；
//   每家：**串行渠道铺底**（官网 / 工商 / 公告联系人栏 / 邮箱专项） 读正文  确定性抽取；
//   然后进入**模型循环**：模型每轮回一个动作 JSON（search 换渠道 / submit 收口），
//         "搜不到了"由模型自己判断，程序只留 AGENT_LOOP_MAX_STEPS 保险丝；
//   取值两条腿，都不许编： 正则确定性抽取（只在含公司名的那几行附近）； 模型提交的值**逐字校验**后采用。
// 目标：尽量让关系企业至少取得 1—2 项可核验联系方式；拿不到就如实留空并记缺口，绝不填客服号。
import { policySourceTier } from '../shared/policy-chain.js'
import type { SearchPort, SearchSource } from '../shared/search-contract.js'
import { resolveIndustrySourceTier } from '../shared/industry-chain.js'
import {
  AGENT_LOOP_MAX_STEPS, buildLeadLoopPrompt, parseLeadLoopAction, validateLeadReport,
  type LeadLoopContact, type LoopEvidenceItem,
} from '../shared/agent-loop.js'
import {
  buildLeadInputFingerprint, collectLeadContacts, isLeadPointForCompany, isLeadResult, leadSupplementRoundLimit, LEAD_BOUNDARY, LEAD_COMPANY_LIMIT, LEAD_EXTRACT_WINDOW, LEAD_SCHEMA_VERSION, missingLeadKinds,
  uniqueLeadStrings, type LeadContactKind, type LeadContactPoint, type LeadContactSourceRef, type LeadNodeSourceRef,
  type LeadRequest, type LeadResult, type LeadRow,
} from '../shared/lead-contacts.js'
import { createSearchDocumentReader } from './search-document-reader.js'
import type { OpportunityDocumentReader } from './opportunity-source-preparer.js'

/** 模型循环的入参：与公开风险同一形状（goal/step/evidence/history/final），goal 由服务层固定。 */
export interface LeadLoopInput {
  companyName: string
  ownerName: string
  projectTitle: string
  step: number
  maxSteps: number
  missing: string[]
  known: string[]
  evidence: LoopEvidenceItem[]
  history: string[]
  final: boolean
}

export type LeadLoopRunner = (input: LeadLoopInput) => Promise<string>
export type LeadService = (request: LeadRequest) => Promise<LeadResult>

/** 串行渠道铺底：四条不同意图的查询，覆盖官网 / 工商 / 公告 / 邮箱。 */
export function buildLeadBootstrapQueries(companyName: string): string[] {
  const name = companyName.trim()
  return [
    `"${name}" 官网 联系我们 电话 邮箱 地址`,
    `"${name}" 工商信息 注册地址 联系电话 邮编`,
    `"${name}" 招标 成交 公告 联系人 电话 邮箱`,
    `"${name}" 邮箱 @ 商务 合作 联系`,
  ]
}

const KIND_LABELS: Record<LeadContactKind, string> = { contact: '联系人', email: '邮箱', phone: '电话', address: '地址' }

export function createLeadService(
  search: SearchPort,
  provider: () => Promise<'doubao'> = async () => 'doubao',
  readDocument: OpportunityDocumentReader = createSearchDocumentReader(),
  runLoopStep?: LeadLoopRunner,
  writeLog?: (message: string) => void,
): LeadService {
  return async (request) => {
    const nodes = request.nodes.slice(0, LEAD_COMPANY_LIMIT)
    const rows: LeadRow[] = []
    const queries: string[] = []
    const gaps: string[] = []
    const log = (message: string) => writeLog?.(`[${request.opportunityId}] ${message}`)
    let requestCount = 0
    let modelCalls = 0
    let anyLive = false
    let checkedAt = new Date().toISOString()

    if (nodes.length === 0) {
      return {
        schemaVersion: LEAD_SCHEMA_VERSION, inputFingerprint: buildLeadInputFingerprint(request),
        opportunityId: request.opportunityId, projectTitle: request.projectTitle, ownerName: request.ownerName,
        rows: [], queries: [], requestCount: 0, modelCalls: 0, cacheHit: false, checkedAt,
        gaps: ['这个项目还没有产业链节点（甲方关联的以往中标 / 上下游供应链），获客只消费同一批节点：请先在产业链跑一次。'],
        boundary: LEAD_BOUNDARY,
      }
    }

    for (const node of nodes) {
      const points = new Map<string, LeadContactPoint>()
      const sources: LeadNodeSourceRef[] = []
      const evidence: LoopEvidenceItem[] = []
      const history: string[] = []
      let companyRequests = 0
      let rounds = 0
      let outcome = '未进入模型循环'

      const grouped = (): Record<LeadContactKind, LeadContactPoint[]> => {
        const all = [...points.values()]
        return {
          contact: all.filter((point) => point.kind === 'contact'),
          email: all.filter((point) => point.kind === 'email'),
          phone: all.filter((point) => point.kind === 'phone'),
          address: all.filter((point) => point.kind === 'address'),
        }
      }

      const ingest = async (query: string): Promise<number> => {
        const result = await search({ provider: await provider(), purpose: 'lead-search', query, maxResults: 10 })
        requestCount += result.requestCount
        companyRequests += result.requestCount
        if (!result.cacheHit) anyLive = true
        checkedAt = result.checkedAt
        const collected: Array<LeadContactSourceRef & { text: string }> = []
        let added = 0
        for (const [index, source] of result.sources.entries()) {
          const record = result.evidenceRecords[index]
          if (!record) continue
          const raw = await readLeadBody(readDocument, source)
          if (!raw) continue
          // 只在这家公司名字附近的那几行抽值：企业名录类页面一次列多家，全页抽取会把别家电话串过来。
          const window = leadWindow(raw, node.name)
          if (!window) continue
          const pageUrl = record.provenance.pageUrl ?? source.url
          const publisher = record.provenance.publisher ?? source.publisher ?? '未取得'
          const title = (source.title ?? record.title ?? '').trim() || '未命名来源'
          const tier = resolveIndustrySourceTier(pageUrl, publisher, policySourceTier(pageUrl, publisher))
          collected.push({ title, publisher, ...(pageUrl ? { pageUrl } : {}), tier, observedAt: result.checkedAt, text: window })
          sources.push({ evidenceId: record.id, title, publisher, ...(pageUrl ? { pageUrl } : {}), tier })
          evidence.push({ id: `E${evidence.length + 1}`, title, publisher, date: result.checkedAt, tier, text: window.slice(0, 1500), ...(pageUrl ? { url: pageUrl } : {}) })
        }
        if (collected.length > 0) {
          const extracted = collectLeadContacts({ companyName: node.name, sources: collected })
          // 联系人可以在电话/邮箱的上一行或下一行；以该联系人的证据小段复核，
          // 不再要求姓名和号码必须挤在同一行，也不因同轮另一来源是名单页而误杀全部联系人。
          const corroborated = (point: LeadContactPoint) =>
            point.evidenceQuote.includes(point.normalized)
            && /(?:联系\s*电话|联系\s*手机|电\s*话|手\s*机|邮\s*箱|电子\s*邮件|传\s*真|座\s*机|分\s*机|email)\s*[:：]?\s*[A-Za-z0-9]/i.test(point.evidenceQuote)
          const merged = [
            // 同一家公司最多展示 4 个有联系方式旁证的联系人，避免长名单淹没企业信息。
            ...extracted.contact.filter(corroborated).slice(0, 4),
            ...extracted.email,
            ...extracted.phone,
            // 园区 / 大厦 / 楼栋地址不一定有门牌号；字段分类已做地址形态门禁，这里只过滤公告尾词与异常长文本。
            ...extracted.address.filter((point) => !/(联系人|公告|公示|项目|中标|招标|结果|联系)$/.test(point.normalized) && point.normalized.length <= 100),
          ]
          added = foldPoints(points, merged)
          if (merged.length > 0) log(`「${node.name}」本轮候选：${merged.map((point) => `${KIND_LABELS[point.kind]}=${point.normalized}`).join('；')}`)
        }
        log(`检索「${query}」 来源 ${result.sources.length} 条 / 可用正文 ${collected.length} 条 / 新增取值 ${added} 个（${result.cacheHit ? '命中缓存' : '真实检索'}）`)
        return added
      }

      //   串行渠道铺底（不能并发：SearchManager 单飞锁 + SearchCache 整文件读改写） 
      for (const query of buildLeadBootstrapQueries(node.name)) {
        history.push(query)
        queries.push(query)
        await ingest(query)
        if (missingLeadKinds(grouped()).length === 0) break
      }

      // 模型循环只处理仍缺的字段；产品成本边界最多 2 轮（只缺邮箱时 1 轮）。
      const loopLimit = Math.min(AGENT_LOOP_MAX_STEPS, leadSupplementRoundLimit(missingLeadKinds(grouped())))
      if (runLoopStep && loopLimit > 0) {
        for (let step = 1; step <= loopLimit; step += 1) {
          rounds = step
          const missing = missingLeadKinds(grouped())
          if (missing.length === 0) { outcome = `模型第 ${step} 轮前四列已齐，不再调用`; log(outcome); break }
          modelCalls += 1
          let raw = ''
          try {
            raw = await runLoopStep({
              companyName: node.name, ownerName: request.ownerName, projectTitle: request.projectTitle,
              step, maxSteps: loopLimit, missing: missing.map((kind) => KIND_LABELS[kind]),
              known: [...points.values()].map((point) => `${KIND_LABELS[point.kind]}=${point.value}`),
              evidence, history, final: step === loopLimit,
            })
          } catch (error) {
            outcome = `模型第 ${step} 轮不可用，按已取得的确定性结果收口`
            log(`${outcome}：${error instanceof Error ? error.message : String(error)}`)
            break
          }
          const action = parseLeadLoopAction(raw)
          if (!action) { outcome = `模型第 ${step} 轮返回无法解析，收口`; log(`${outcome}：${raw.slice(0, 200)}`); break }
          if (action.tool === 'submit') {
            const validated = validateLeadReport(action.report, evidence)
            let added = 0
            for (const item of validated.contacts) {
              const point = modelPoint(item, node.name, evidence)
              if (isLeadPointForCompany(point)) added += foldPoints(points, [point])
            }
            outcome = `模型第 ${step} 轮收口（提交 ${action.report.contacts.length} 条 / 逐字校验通过 ${validated.contacts.length} 条）`
            log(`${outcome}；被拒：${validated.rejected.slice(0, 3).join('；') || '无'}；模型自述：${action.report.assessment.slice(0, 120)}`)
            if (validated.rejected.length > 0) gaps.push(`「${node.name}」有 ${validated.rejected.length} 条模型给出的联系方式因引文对不上原文被丢弃。`)
            break
          }
          const query = action.query.trim()
          if (history.some((line) => line === query)) { outcome = `模型第 ${step} 轮重复查询，收口`; log(`${outcome}：${query}`); break }
          history.push(query)
          queries.push(query)
          const added = await ingest(query)
          if (added === 0 && step >= 3) { outcome = `模型第 ${step} 轮换渠道后仍无新增，收口`; log(outcome); break }
        }
        if (rounds === loopLimit && !outcome.startsWith('模型第') ) outcome = `达到成本上限 ${loopLimit} 轮`
      } else {
        outcome = '未接模型循环，只有渠道铺底结果'
      }

      const byKind = grouped()
      rows.push({
        id: node.id,
        name: node.name,
        ownerName: request.ownerName,
        ...(node.industry ? { industry: node.industry } : {}),
        relation: node.relation,
        relationLabel: node.relationLabel,
        relationQuote: node.relationQuote,
        confidence: node.confidence,
        contact: byKind.contact, email: byKind.email, phone: byKind.phone, address: byKind.address,
        sources: dedupeLeadSources([...node.sources, ...sources]),
        requestCount: companyRequests,
        supplementRounds: rounds,
        missing: missingLeadKinds(byKind),
      })
      log(`「${node.name}」检索 ${companyRequests} 次 / 模型 ${rounds} 轮  ${outcome}；缺列：${missingLeadKinds(byKind).map((kind) => KIND_LABELS[kind]).join('、') || '无'}`)
    }

    const empty = rows.filter((row) => row.missing.length === 4).map((row) => row.name)
    if (empty.length > 0) {
      const head = empty.slice(0, 3).join('、')
      gaps.push(`「${head}」${empty.length > 3 ? ` 等 ${empty.length} 家` : ''}在本次公开来源里没有可核验的联系方式，保持缺失不推测（政府机关常只公示单位电话、小微企业常无官网）。`)
    }
    const withContacts = rows.filter((row) => row.missing.length < 4).length
    const countMissing = (kind: LeadContactKind) => rows.filter((row) => row.missing.includes(kind)).length
    if (rows.length > 0) {
      gaps.push(`本次对象 ${rows.length} 家，其中 ${withContacts} 家至少取得 1 项公开联系方式（覆盖率 ${Math.round((withContacts / rows.length) * 100)}%）；缺邮箱 ${countMissing('email')} 家 / 缺电话 ${countMissing('phone')} 家 / 缺地址 ${countMissing('address')} 家 / 缺联系人 ${countMissing('contact')} 家。`)
    }
    log(`完成：${rows.length} 家 / 有联系方式 ${withContacts} 家 / 总检索 ${requestCount} 次`)

    const value: LeadResult = {
      schemaVersion: LEAD_SCHEMA_VERSION,
      inputFingerprint: buildLeadInputFingerprint(request),
      opportunityId: request.opportunityId,
      projectTitle: request.projectTitle,
      ownerName: request.ownerName,
      rows,
      queries,
      requestCount,
      modelCalls,
      cacheHit: !anyLive,
      checkedAt,
      gaps: uniqueLeadStrings(gaps),
      boundary: LEAD_BOUNDARY,
    }
    if (!isLeadResult(value)) throw new Error('获客结果结构不完整。')
    return value
  }
}

async function readLeadBody(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  const providerBody = source.content?.trim() ?? ''
  const attempt = await tryRead(readDocument, providerBody.length >= 200 ? source : { ...source, content: undefined })
  const pageText = attempt ?? (await tryRead(readDocument, source)) ?? ''
  const merged = [providerBody, pageText].filter((part) => part.length > 0).join('\n')
  return merged.length >= 60 ? merged : undefined
}

async function tryRead(readDocument: OpportunityDocumentReader, source: SearchSource): Promise<string | undefined> {
  try {
    const read = await readDocument(source)
    if (read.extraction.processingStatus !== 'content-ready') return undefined
    const text = read.extraction.text.trim()
    return text.length >= 60 ? text : undefined
  } catch {
    return undefined
  }
}

/** 行内出现"别的公司名"的判定：用于跨公司排他（该行不含本次主体就整行丢掉）。 */
const OTHER_COMPANY = /[\u4e00-\u9fff]{2,20}(?:有限公司|有限责任公司|股份有限公司|集团有限公司|研究院|设计院|事务所|工程处|分公司)/
/** 只在这家公司**自己那几行**附近抽值：名录类页面一次列很多家，按固定半径截窗会把别家电话串过来。 */
function leadWindow(text: string, companyName: string): string | undefined {
  const name = companyName.trim()
  if (!name) return undefined
  const lines = text.split(/\r?\n+/)
  const hits = lines.map((line, index) => (line.includes(name) ? index : -1)).filter((index) => index >= 0)
  if (hits.length === 0) return undefined
  const block: string[] = []
  for (const hit of hits) {
    const from = Math.max(0, hit - 1)
    const to = Math.min(lines.length - 1, hit + 4)
    for (let index = from; index <= to; index += 1) {
      const line = lines[index]
      // 不能只删另一家公司的名字后继续读取它下面的联系人；遇到新主体就结束当前段。
      if (index > hit && OTHER_COMPANY.test(line) && !line.includes(name)) break
      if (index < hit && OTHER_COMPANY.test(line) && !line.includes(name)) continue
      block.push(line)
    }
  }
  if (!block.some((line) => line.includes(name))) return undefined
  return block.join('\n').slice(0, LEAD_EXTRACT_WINDOW * 2)
}

function foldPoints(target: Map<string, LeadContactPoint>, points: LeadContactPoint[]): number {
  let added = 0
  for (const point of points) {
    const key = `${point.kind}:${point.normalized}`
    const existing = target.get(key)
    if (!existing) { target.set(key, { ...point, sources: [...point.sources] }); added += 1; continue }
    for (const source of point.sources) {
      if (!existing.sources.some((known) => known.title === source.title && known.pageUrl === source.pageUrl)) existing.sources.push(source)
    }
  }
  return added
}

/** 模型提交的一条（已过逐字校验）：来源绑到它引用的那条证据上。 */
function modelPoint(item: LeadLoopContact, companyName: string, evidence: LoopEvidenceItem[]): LeadContactPoint {
  const hit = evidence.find((entry) => entry.id === item.evidenceId)
  const evidenceQuote = (() => {
    const text = hit?.text ?? ''
    const index = text.indexOf(item.quote)
    if (index < 0) return item.quote
    return text.slice(Math.max(0, index - 220), Math.min(text.length, index + item.quote.length + 140)).trim()
  })()
  return {
    companyName,
    kind: item.kind,
    value: item.value,
    normalized: item.value.replace(/\s+/g, ' ').trim(),
    evidenceQuote,
    sources: [{
      title: hit?.title ?? '模型引用的证据',
      publisher: hit?.publisher ?? '未取得',
      ...(hit?.url ? { pageUrl: hit.url } : {}),
      tier: (hit?.tier ?? 'media') as LeadContactSourceRef['tier'],
      observedAt: hit?.date ?? new Date().toISOString(),
    }],
  }
}

function dedupeLeadSources(sources: LeadNodeSourceRef[]): LeadNodeSourceRef[] {
  return [...new Map(sources.map((source) => [source.evidenceId, source])).values()].slice(0, 8)
}
