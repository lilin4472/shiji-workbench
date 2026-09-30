import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

// The trial is a separate executable payload. It has no preload, credentials,
// search, agent or analysis IPC handlers; hiding buttons is not its boundary.
app.setName('识机体验版')
const locked = app.requestSingleInstanceLock()

function openWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#f6f4f0',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadFile(path.join(app.getAppPath(), 'dist-trial', 'trial.html'))
}

if (!locked) app.quit()
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) { if (window.isMinimized()) window.restore(); window.focus() }
  })
  app.whenReady().then(openWindow)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
