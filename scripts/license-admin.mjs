#!/usr/bin/env node
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const issuerRoot = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(), 'ShijiLicenseIssuer')
const privateKeyPath = path.join(issuerRoot, 'issuer-private-key.pem')
const passphrasePath = path.join(issuerRoot, 'issuer-passphrase.dpapi')
const ledgerPath = path.join(issuerRoot, 'orders.v1.json')
const publicKeyPath = path.join(root, 'licenses', 'shiji-license-public.pem')
const PRODUCT = 'shiji-workbench-full'
const codeRegex = /^[A-F\d]{20}$/

function encode(value) { return Buffer.from(value).toString('base64url') }

function protectPassphrase(passphrase) {
  if (process.platform !== 'win32') throw new Error('授权签发工具需要在卖家 Windows 电脑上初始化。')
  return execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', "$bytes=[Text.Encoding]::UTF8.GetBytes($env:SHIJI_ISSUER_PASSPHRASE); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SHIJI_ISSUER_PASSPHRASE: passphrase },
  }).trim()
}

function unprotectPassphrase(protectedValue) {
  if (process.platform !== 'win32') throw new Error('授权签发工具只能在初始化它的 Windows 账户中使用。')
  return execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', "$bytes=[Convert]::FromBase64String($env:SHIJI_ISSUER_PASSPHRASE_BLOB); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SHIJI_ISSUER_PASSPHRASE_BLOB: protectedValue },
  }).trim()
}

async function generate() {
  await mkdir(issuerRoot, { recursive: true })
  await mkdir(path.dirname(publicKeyPath), { recursive: true })
  const { access } = await import('node:fs/promises')
  for (const target of [privateKeyPath, passphrasePath, publicKeyPath]) {
    try { await access(target); throw new Error(`授权密钥已存在，拒绝覆盖：${target}`) }
    catch (error) { if (error instanceof Error && error.message.startsWith('授权密钥已存在')) throw error }
  }
  const passphrase = randomBytes(48).toString('base64url')
  const protectedPassphrase = protectPassphrase(passphrase)
  if (!protectedPassphrase) throw new Error('Windows 未能保护签发私钥口令。')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  })
  await writeFile(privateKeyPath, privateKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await writeFile(passphrasePath, protectedPassphrase, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await writeFile(publicKeyPath, publicKey, { encoding: 'utf8', flag: 'wx' })
  console.log(`已生成离线授权密钥。\n加密私钥（绝不能发给买家）：${privateKeyPath}\nWindows 账户保护的口令：${passphrasePath}\n公钥（将随正式安装包发布）：${publicKeyPath}\n私钥只能在初始化它的 Windows 账户下签发；更换账户或重装系统前，应先评估恢复方案。`)
}

async function issue(args) {
  const order = option(args, '--order').trim()
  const device = normalize(option(args, '--device'))
  if (!/^[A-Za-z\d_-]{1,120}$/.test(order)) throw new Error('订单编号请使用 1–120 位英文字母、数字、下划线或短横线。')
  if (!codeRegex.test(device)) throw new Error('设备码应为 20 位十六进制字符，可带短横线。')
  const rawLedger = await readFile(ledgerPath, 'utf8').catch((error) => error?.code === 'ENOENT' ? '{"version":1,"orders":{}}' : Promise.reject(error))
  const ledger = JSON.parse(rawLedger)
  if (ledger.version !== 1 || typeof ledger.orders !== 'object' || ledger.orders === null) throw new Error('本地订单签发记录格式错误；不要删除或重建记录，以免超发。')
  const hasOrder = Object.prototype.hasOwnProperty.call(ledger.orders, order)
  if (hasOrder && !Array.isArray(ledger.orders[order])) throw new Error('该订单的本地签发记录损坏，拒绝继续签发以避免超发。')
  const existing = hasOrder ? ledger.orders[order] : []
  const already = existing.find((entry) => entry.deviceCode === device)
  if (already?.activationCode) {
    console.log(already.activationCode)
    return
  }
  if (existing.length >= 2) throw new Error('该订单已经绑定两台不同设备，拒绝签发第三台。')

  const protectedPassphrase = await readFile(passphrasePath, 'utf8')
  const passphrase = unprotectPassphrase(protectedPassphrase)
  const encryptedPrivateKey = await readFile(privateKeyPath, 'utf8')
  const privateKey = createPrivateKey({ key: encryptedPrivateKey, format: 'pem', passphrase })
  const payload = {
    licenseVersion: 1,
    product: PRODUCT,
    licenseId: randomUUID(),
    orderRef: order,
    deviceCode: device,
    issuedAt: new Date().toISOString(),
  }
  const payloadSegment = encode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = sign(null, Buffer.from(payloadSegment, 'ascii'), privateKey).toString('base64url')
  const activationCode = `${payloadSegment}.${signature}`
  const nextLedger = {
    version: 1,
    orders: {
      ...ledger.orders,
      [order]: [...existing, { deviceCode: device, licenseId: payload.licenseId, issuedAt: payload.issuedAt, activationCode }],
    },
  }
  await mkdir(issuerRoot, { recursive: true })
  await writeFile(ledgerPath, JSON.stringify(nextLedger, null, 2), { encoding: 'utf8', mode: 0o600 })
  console.log(activationCode)
}

function option(args, name) {
  const index = args.indexOf(name)
  return index < 0 ? '' : args[index + 1] ?? ''
}

function normalize(value) { return value.replace(/[^a-f\d]/gi, '').toUpperCase() }

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'generate') await generate()
  else if (command === 'issue') await issue(args)
  else {
    console.log('识机离线授权工具（卖家专用，不随安装包分发）\n  node scripts/license-admin.mjs generate\n  node scripts/license-admin.mjs issue --order <订单编号> --device <用户设备码>')
    process.exitCode = command ? 2 : 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '授权操作失败。')
  process.exitCode = 1
}
