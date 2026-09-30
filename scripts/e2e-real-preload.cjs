// 真实端到端验证专用 preload：把 window.shijiDesktop 直接接到主进程里**真实的**
// 豆包搜索 + 时间链/政策链执行器（不使用任何桩）。
// 与 scripts/ui-verify-preload.cjs 的区别：那个是桩，这个是真的。
const { ipcRenderer } = require('electron')

const contractVersion = Number(process.argv.find((value) => value.startsWith('--e2e-contract-version='))?.split('=')[1] || 0)
const ok = async (value) => ({ ok: true, value })

window.__e2eCalls = []
window.shijiDesktop = {
  platform: process.platform,
  version: '0.0.0-e2e-real',
  contractVersion,
  mockEnabled: false,
  debug: { log: () => {} },
  agent: { onEvent: () => () => {}, cancel: async () => ok(true) },
  evidence: { list: async () => ok([]) },
  credentials: { doubaoStatus: async () => ok({ configured: true, encryptionAvailable: true }) },
  search: {
    getPreference: async () => ok({ defaultProvider: 'doubao' }),
    discoverProjectTimeline: (request) => ipcRenderer.invoke('e2e:project-timeline-discover', request),
    runPolicyChain: (request) => ipcRenderer.invoke('e2e:policy-chain-run', request),
    runIndustryChain: (request) => ipcRenderer.invoke('e2e:industry-chain-run', request),
    runCreditRisk: (request) => ipcRenderer.invoke('e2e:credit-risk-run', request),
  },
}
