import { useEffect, useState } from 'react'
import { CheckCircle2, Clipboard, KeyRound, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import type { OfflineLicenseStatus } from '../../shared/license-contract'

export default function LicenseActivation() {
  const [status, setStatus] = useState<OfflineLicenseStatus>()
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('正在读取本机设备码…')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.shijiDesktop?.license.status().then((result) => {
      if (!result.ok) {
        setNotice(result.message)
        return
      }
      setStatus(result.value)
      setNotice(result.value.message ?? (result.value.activated ? '授权已验证。正在启动识机…' : '请把本机设备码发给卖家，获取此电脑的授权码。'))
    }).catch(() => setNotice('暂时无法读取设备码，请关闭软件后重新打开。'))
  }, [])

  async function copyDeviceCode() {
    if (!status?.deviceCode) return
    const formatted = status.deviceCode.match(/.{1,4}/g)?.join('-') ?? status.deviceCode
    try {
      await navigator.clipboard.writeText(formatted)
      setNotice('设备码已复制。请只发给本次订单对应的卖家。')
    } catch {
      setNotice(`请手动复制设备码：${formatted}`)
    }
  }

  async function activate() {
    if (!code.trim() || busy) return
    setBusy(true)
    setNotice('正在本机校验授权码…')
    try {
      const result = await window.shijiDesktop?.license.activate(code.trim())
      if (!result) throw new Error('桌面授权接口不可用。')
      if (!result.ok) throw new Error(result.message)
      setStatus(result.value)
      setNotice('授权成功，识机即将自动重启。')
      setCode('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '授权失败，请核对授权码。')
    } finally {
      setBusy(false)
    }
  }

  return <main className="license-page">
    <section className="license-card">
      <div className="license-brand"><span className="license-mark"><Sparkles size={21} /></span><div><strong>识机</strong><small>本机商业机会工作台</small></div></div>
      <div className="license-title"><span><LockKeyhole size={15} />正式版授权</span><h1>激活这台电脑</h1><p>授权码在本机验证，不需要注册账号，也不会上传你的 Key、搜索内容或项目资料。</p></div>

      <div className="device-code-block">
        <div><b>本机设备码</b><small>请发给卖家生成对应授权码</small></div>
        <strong className="device-code">{status?.deviceCode ? status.deviceCode.match(/.{1,4}/g)?.join('-') : '正在读取…'}</strong>
        <button type="button" className="copy-device" disabled={!status?.deviceCode} onClick={() => void copyDeviceCode()}><Clipboard size={15} />复制设备码</button>
      </div>

      <label className="license-input"><span><KeyRound size={15} />粘贴卖家发给你的授权码</span><textarea value={code} onChange={(event) => setCode(event.target.value)} rows={4} maxLength={8192} spellCheck={false} autoComplete="off" placeholder="授权码通常是一段较长的字符，请完整粘贴" /></label>
      <button type="button" className="activate-button" disabled={!code.trim() || busy || !status?.deviceCode} onClick={() => void activate()}>{busy ? '正在验证…' : <><ShieldCheck size={17} />验证并启动识机</>}</button>
      <p className={`license-notice ${status?.activated ? 'success' : ''}`} aria-live="polite">{status?.activated && <CheckCircle2 size={15} />}{notice}</p>
      <div className="license-footnote"><span>每份授权绑定一台电脑</span><i /> <span>每笔订单最多可申请两台</span><i /> <span>更换设备请联系卖家</span></div>
    </section>
    <footer>离线授权 · 设备码仅用于本机绑定</footer>
  </main>
}
