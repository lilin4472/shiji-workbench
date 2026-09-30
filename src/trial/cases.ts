export interface TrialCase {
  id: string
  title: string
  subject: string
  place: string
  stage: string
  date: string
  amount: string
  summary: string
  source: { label: string; url: string; note: string; originalUrl?: string }
  milestones: { date: string; stage: string; evidence: string }[]
  related: { name: string; role: string; source: string }[]
  checks: { label: string; result: string; note: string }[]
  actions: string[]
}

// Historical cases only. Module-specific replay lives in replay.ts and must
// distinguish past source evidence from facts that have not been verified.
export const TRIAL_CASES: TrialCase[] = [
  {
    id: 'yuehu-monitoring',
    title: '悦湖片区市政道路基础设施配套工程（四期）地铁保护监测服务',
    subject: '成都市武侯区智慧宜居建设开发有限公司', place: '四川 · 成都 · 武侯',
    stage: '竞争性磋商公告', date: '2026-09-08', amount: '约 43 万元 · 搜索候选，需核对原文',
    summary: '真实历史公告。识机在 2026-09-17 的联网验收中，定位到武侯区政府公告并确认招标阶段。这里展示的是当时的证据快照，不代表现在仍可投标。',
    source: { label: '成都市武侯区人民政府公告', url: 'https://www.cdwh.gov.cn/wuhou/c180402/2026-09/08/content_8dac2c338bd44c37939b89ccbc7ffd6c.shtml', note: '识机 2026-09-17 实测取得正文；外部页面可用性取决于发布站。' },
    milestones: [{ date: '2026-09-08', stage: '招标公告', evidence: '武侯区人民政府公告，2026-09-17 识机验收确认' }],
    related: [{ name: '成都市武侯区智慧宜居建设开发有限公司', role: '采购人 / 本案例主体', source: '公告标题与正文' }],
    checks: [
      { label: '政策链', result: '历史回放', note: '2026-09-17 联网验收取得三级政策背景；没有本甲方资金拨付证据，不能补造下一招标日期。' },
      { label: '产业链', result: '历史回放', note: '历史公告明确点名的成交方和代理机构可回放；不推断完整上下游。' },
      { label: '公开风险', result: '局部历史资料', note: '有历史登记页面，未取得具体处罚或失信事实；搜不到不等于没有风险。' },
      { label: '获客', result: '局部历史资料', note: '只提供另一项目官方公告中的代理机构公司级电话与地址；不是本项目联系人。' },
    ],
    actions: ['打开原公告，核对采购范围、资格和附件。', '核对响应截止时间；历史公告不能当成当前机会。', '如需继续跟踪该项目，在正式版用自己的 Key 搜索最新阶段。'],
  },
  {
    id: 'jinling-installation',
    title: '金陵药业研发型中试生产车间改造项目机电安装工程',
    subject: '金陵药业股份有限公司', place: '江苏 · 南京',
    stage: '中标结果线索', date: '2026-01-27', amount: '162.50 万元 · 中标候选报价，非核验合同额',
    summary: '真实历史项目。识机在 2026-09-23 的联网验收中找到企业招标页及多个中标转载页；中标人与报价来自公开转载，需以企业公告原文为准。',
    source: { label: '新浪财经公开转载', url: 'https://finance.sina.com.cn/stock/aigc/zab/2026-01-28/doc-inhivfch5100133.shtml', originalUrl: 'http://www.jlyy1999.com/zbgg/detail.aspx?id=837', note: '阶段、报价与中标人主要来自转载；原站招标页可另行核对，但可能无法打开。' },
    milestones: [
      { date: '2025-12-30', stage: '招标公告', evidence: '金陵药业原招标页，识机 2026-09-23 搜索留档' },
      { date: '2026-01-22', stage: '中标候选人', evidence: '新浪财经转述公开招采信息；非本机原文核验' },
      { date: '2026-01-27', stage: '中标结果线索', evidence: '新浪财经转述，指向江苏省工业设备安装集团有限公司' },
    ],
    related: [
      { name: '金陵药业股份有限公司', role: '招标人', source: '企业原招标页 / 公开转载' },
      { name: '江苏省工业设备安装集团有限公司', role: '中标人线索', source: '新浪财经 2026-01-28 转载，待原公告核验' },
      { name: '江苏省设备成套股份有限公司', role: '招标代理线索', source: '新浪财经 2026-01-28 转载，待原公告核验' },
    ],
    checks: [
      { label: '政策链', result: '未运行', note: '未取得该项目的政策资金证据，不推断拨款或下一项目。' },
      { label: '产业链', result: '转载线索回放', note: '仅展示转载点名的中标人和代理机构；不把一次中标自动扩展为上下游合作。' },
      { label: '公开风险', result: '未运行', note: '企业身份不等于信用结论；本案例未做专项工商信用查询。' },
      { label: '获客', result: '转载线索回放', note: '转载页提供代理机构电话和地址，按媒体参考呈现；不与项目联系人作无证据配对。' },
    ],
    actions: ['核对企业原公告和正式中标结果公告。', '区分中标候选报价、最终中标额与合同额。', '需要最新商机时，在正式版以自己的 Key 重新搜索。'],
  },
]
