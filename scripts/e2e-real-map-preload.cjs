const { ipcRenderer } = require('electron')

const ok = async (value) => ({ ok: true, value })
window.shijiDesktop = {
  platform: process.platform,
  version: '0.2.26-e2e-map',
  contractVersion: 21,
  mockEnabled: false,
  debug: { log: () => {} },
  agent: { onEvent: () => () => {}, cancel: async () => ok(true) },
  evidence: { list: async () => ok([]), readText: async () => ({ ok: false, message: '验收夹具没有本地证据。' }) },
  search: { getPreference: async () => ok({ defaultProvider: 'doubao' }) },
  credentials: {
    readTiandituWeb: () => ipcRenderer.invoke('e2e-map:read-web-key'),
    geocodeTianditu: (address) => ipcRenderer.invoke('e2e-map:geocode', address),
  },
}
