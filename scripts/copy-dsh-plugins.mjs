// 把 DSH 插件源文件拷到编译输出目录：provider 在运行时由识机读入并写进能力包，
// 因此它必须与 dist-electron/electron/*.js 同目录（否则 import.meta.dirname 找不到）。
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugins = ['dsh-plugin-doubao-web.js']
const target = join(root, 'dist-electron', 'electron')
mkdirSync(target, { recursive: true })
for (const name of plugins) {
  const from = join(root, 'electron', name)
  if (!existsSync(from)) { console.error(`缺少 DSH 插件源文件：${name}`); process.exit(1) }
  copyFileSync(from, join(target, name))
  console.log(`DSH 插件已拷贝：${name}`)
}