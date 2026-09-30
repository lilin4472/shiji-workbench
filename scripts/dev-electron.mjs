import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const outputRoot = path.join(projectRoot, 'dist-electron')
const electronCommand = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const mockEnabled = process.argv.includes('--mock')

let child
let restartTimer
let stopping = false

function startElectron() {
  if (stopping) return
  child = spawn(electronCommand, ['.'], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
    env: { ...process.env, SHIJI_ENABLE_MOCK: mockEnabled ? '1' : '0' },
  })
  child.once('exit', () => { child = undefined })
}

function restartElectron() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    if (child) {
      child.once('exit', startElectron)
      child.kill()
    } else startElectron()
  }, 220)
}

const watcher = watch(outputRoot, { recursive: true }, (_event, fileName) => {
  if (fileName?.endsWith('.js') || fileName?.endsWith('.cjs')) restartElectron()
})

function stop() {
  if (stopping) return
  stopping = true
  clearTimeout(restartTimer)
  watcher.close()
  child?.kill()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)
startElectron()
