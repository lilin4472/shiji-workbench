import { useEffect, useRef, useState } from 'react'
import type { ColorTheme, OpportunitySearchCriteria, Opportunity } from '../domain'
import { splitNearbyMapOpportunities } from '../nearby'

interface TiandituMapProps {
  profile: OpportunitySearchCriteria
  /** 全量机会：仅将已按公告项目地址定位并计算出距离的项目上图；未知位置留在线索列表。 */
  opportunities: Opportunity[]
  theme: ColorTheme
  onActivityStart: (label: string) => () => void
}

interface TiandituOverlay {
  addOverLay?: (overlay: unknown) => void
  clearOverLays?: () => void
}

interface TiandituMarker {
  addEventListener?: (type: string, listener: () => void) => void
}

interface TiandituMapApi {
  Map: new (element: string | HTMLElement) => TiandituOverlay & {
    centerAndZoom: (center: unknown, zoom: number) => void
  }
  LngLat: new (longitude: number, latitude: number) => unknown
    Point: new (x: number, y: number) => unknown
  Marker: new (point: unknown, options?: { icon?: unknown }) => TiandituMarker
  Circle: new (center: unknown, radius: number, options?: { color?: string; weight?: number; opacity?: number; fillColor?: string; fillOpacity?: number }) => unknown
  Icon: new (options: { iconUrl: string; iconSize?: unknown; iconAnchor?: unknown }) => unknown
  Label: new (text: string, lnglat: unknown, options?: { offset?: unknown; backgroundColor?: string; color?: string; fontSize?: number }) => unknown
}

declare global {
  interface Window {
    T?: TiandituMapApi
  }
}

let scriptPromise: Promise<TiandituMapApi> | undefined
let scriptPromiseKey: string | undefined
let loadedScriptKey: string | undefined

function clearTiandituScripts() {
  document.querySelectorAll<HTMLScriptElement>('script[data-shiji-tianditu="true"]').forEach((script) => script.remove())
  window.T = undefined
}

function loadTiandituScript(apiKey: string, forceReload = false): Promise<TiandituMapApi> {
  const key = apiKey.trim()
  if (!forceReload && window.T && typeof window.T.Map === 'function' && loadedScriptKey === key) return Promise.resolve(window.T)
  if (!forceReload && scriptPromise && scriptPromiseKey === key) return scriptPromise
  // 用户可能在设置页替换 Key 后直接点“重新加载地图”。旧 Key 的脚本已经
  // 注入 DOM，必须清掉并重新加载，否则会一直使用旧授权。
  if (forceReload || loadedScriptKey !== key || !window.T || typeof window.T.Map !== 'function') {
    clearTiandituScripts()
    scriptPromise = undefined
    scriptPromiseKey = undefined
    loadedScriptKey = undefined
  }
  if (scriptPromise) return scriptPromise
  scriptPromiseKey = key
  scriptPromise = new Promise<TiandituMapApi>((resolve, reject) => {
    const urls = [
      `https://api.tianditu.gov.cn/api?v=4.0&tk=${encodeURIComponent(key)}`,
      `https://api.tianditu.gov.cn/api/v4/jsapi?tk=${encodeURIComponent(key)}`,
    ]
    let index = 0
    const attempt = () => {
      const script = document.createElement('script')
      script.src = urls[index]
      script.async = true
      script.referrerPolicy = 'origin'
      script.dataset.shijiTianditu = 'true'
      script.onload = () => {
        if (window.T && typeof window.T.Map === 'function') {
          resolve(window.T)
          return
        }
        script.remove()
        if (index < urls.length - 1) {
          index += 1
          attempt()
        } else reject(new Error('天地图脚本未提供地图对象。'))
      }
      script.onerror = () => {
        script.remove()
        if (index < urls.length - 1) {
          index += 1
          attempt()
        } else reject(new Error('天地图网页端脚本加载失败。'))
      }
      document.head.appendChild(script)
    }
    attempt()
  }).then((api) => {
    loadedScriptKey = key
    scriptPromiseKey = undefined
    return api
  }).catch((error) => {
    scriptPromise = undefined
    scriptPromiseKey = undefined
    loadedScriptKey = undefined
    throw error
  })
  return scriptPromise
}

// 三主题量化色板：与 styles.css tokens 一一对应。
// 纪律：今后凡涉及地图/前端配色的改动，必须同时给出三套值，或直接从 tokens 读取。
const THEME_PALETTE = {
  current: { center: '#6f54f0', project: '#805eff', ring: '#6f54f0', ringFill: '#805eff', pinRing: '#c9c8f5', labelBg: '#ffffffe6', labelText: '#312e81' },
  warm: { center: '#f35b57', project: '#f39a55', ring: '#f35b57', ringFill: '#f39a55', pinRing: '#f3b8ad', labelBg: '#fffaf3e6', labelText: '#7c2d12' },
  porcelain: { center: '#ff5038', project: '#ff7b43', ring: '#ff5038', ringFill: '#ff7b43', pinRing: '#ffc8b8', labelBg: '#fffffff2', labelText: '#7f2819' },
} as const

function svgPin(fill: string, ring: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="${ring}" fill-opacity=".35"/><circle cx="11" cy="11" r="6.5" fill="${fill}" stroke="#ffffff" stroke-width="2"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const SUBJECT_NAME_PLACEHOLDERS = new Set(['主体待核验', '主体待从正文确认', '正文未识别', '待核验'])

function isPlaceholderSubject(name: string | undefined): boolean {
  const value = name?.trim()
  return !value || SUBJECT_NAME_PLACEHOLDERS.has(value)
}

export default function TiandituMap({ profile, opportunities, theme, onActivityStart }: TiandituMapProps) {
  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapId = useRef(`tianditu-map-${Math.random().toString(36).slice(2, 10)}`)
  const mapRef = useRef<TiandituOverlay | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [message, setMessage] = useState('正在加载天地图底图…')
  const [retryNonce, setRetryNonce] = useState(0)
  const [activeSubject, setActiveSubject] = useState<{ name: string; detail: string }>()
  const lastScriptRequest = useRef<{ key: string; retryNonce: number } | undefined>(undefined)
  const opportunityKey = opportunities.map((item) => `${item.id}:${item.companyName}:${item.locationPoint?.longitude ?? ''},${item.locationPoint?.latitude ?? ''}`).join('|')

  useEffect(() => {
    let disposed = false
    const address = profile.address.trim()
    // A profile update can briefly render before the controlled input value is
    // available. Do not send an empty address through IPC; that used to leave
    // the map permanently in the failure panel until the whole view remounted.
    if (!address) {
      setState('fallback')
      setMessage('请先填写经营地址，再加载天地图。')
      return () => { disposed = true }
    }
    setState('loading')
    setMessage('正在加载天地图底图…')
    const finishActivity = onActivityStart('附近招标地图 · 加载底图与定位')
    mapRef.current?.clearOverLays?.()
    mapRef.current = undefined
    mapElement.current?.replaceChildren()
    const credentials = window.shijiDesktop?.credentials
    const mapOpportunities = splitNearbyMapOpportunities(opportunities)
      window.shijiDesktop?.debug?.log(`map: mount start address=${address} contract=${window.shijiDesktop?.contractVersion ?? '-'}`)
    async function mount() {
      if (!credentials) throw new Error('请在识机桌面端加载天地图；浏览器预览不会读取地图 Key。')
      const keyResponse = await credentials.readTiandituWeb()
      if (!keyResponse.ok) throw new Error('尚未配置天地图网页端 Key，请到设置页保存后再加载真实底图。')
      const webKey = keyResponse.value.apiKey.trim()
        window.shijiDesktop?.debug?.log(`map: web key loaded length=${webKey.length}`)
        if (!webKey) throw new Error('天地图网页端 Key 为空，请到设置页重新保存。')
        const forceScriptReload = lastScriptRequest.current?.key !== webKey || lastScriptRequest.current?.retryNonce !== retryNonce
        lastScriptRequest.current = { key: webKey, retryNonce }
        // 服务端 Key 的地理编码失败不应把整张地图判死：底图仍加载；
        // 未定位的项目保留在列表，但不按主体地址伪造项目地图点位。
        let centerPoint: { longitude: number; latitude: number } | undefined
        let centerError: string | undefined
        try {
          const pointResponse = await credentials.geocodeTianditu(address)
        
      window.shijiDesktop?.debug?.log(`map: center geocode ${pointResponse.ok ? `ok lng=${pointResponse.value.longitude} lat=${pointResponse.value.latitude}` : `failed: ${pointResponse.message}`}`)
          if (pointResponse.ok) centerPoint = pointResponse.value
          else centerError = pointResponse.message
        } catch (error) {
          centerError = error instanceof Error ? error.message : '经营地址暂未定位。'
        }
      const api = await loadTiandituScript(webKey, forceScriptReload)
        // 官方脚本虽然同步暴露 T.Map，但个别部署会在 onload 后继续补全
        // LngLat/Event 等内部对象；给初始化一个事件循环，避免半初始化调用。
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
        window.shijiDesktop?.debug?.log('map: script ready')
      if (disposed || !mapElement.current) return
      mapElement.current.replaceChildren()
      // 天地图 JS API 4.0 的官方构造方式接收容器 id（而不是 React
      // HTMLElement 引用）；给每次挂载的容器一个稳定 id，避免多窗口/热更新串图。
      mapElement.current.id = mapId.current
      const palette = THEME_PALETTE[theme]
      let map: TiandituOverlay & { centerAndZoom: (center: unknown, zoom: number) => void }
        try {
          map = new api.Map(mapId.current)
        } catch (error) {
          window.shijiDesktop?.debug?.log(`map: Map(id) failed message=${error instanceof Error ? error.message : String(error)}`)
          map = new api.Map(mapElement.current ?? mapId.current)
        }
        window.shijiDesktop?.debug?.log('map: Map object created')
      const firstLocated = mapOpportunities.located[0]?.locationPoint ?? undefined
        const locatedInside = mapOpportunities.located
        const initialCenter = centerPoint ?? firstLocated ?? { longitude: 104.1954, latitude: 35.8617 }
        const initialZoom = centerPoint ? zoomForRadius(profile.radiusKm) : firstLocated ? 11 : 4
        let pinProject = svgPin(palette.project, palette.pinRing)
        try {
          map.centerAndZoom(new api.LngLat(initialCenter.longitude, initialCenter.latitude), initialZoom)
        window.shijiDesktop?.debug?.log('map: centerAndZoom done')
      if (centerPoint) {
          window.shijiDesktop?.debug?.log('map: adding center circle')
          // 服务半径圈：颜色随主题。
      map.addOverLay?.(new api.Circle(
        new api.LngLat(centerPoint.longitude, centerPoint.latitude),
        profile.radiusKm * 1000,
        { color: palette.ring, weight: 2, opacity: 0.85, fillColor: palette.ringFill, fillOpacity: 0.08 },
      ))
      window.shijiDesktop?.debug?.log('map: adding center marker/label')
        const centerLnglat = new api.LngLat(centerPoint.longitude, centerPoint.latitude)
      map.addOverLay?.(new api.Marker(centerLnglat))
      
        
      

      }
        // 只有公告中提取的项目地址经过本地距离计算后，才绘制为招标项目点。
      window.shijiDesktop?.debug?.log('map: adding located markers')
        pinProject = svgPin(palette.project, palette.pinRing)
        window.shijiDesktop?.debug?.log('map: pin project prepared')
      const locationSeen = new Map<string, number>()
      for (const opportunity of locatedInside) {
        const point = opportunity.locationPoint
        if (!point) continue
        const pointKey = `${point.longitude},${point.latitude}`
          const seen = locationSeen.get(pointKey) ?? 0
          locationSeen.set(pointKey, seen + 1)
          const displayPoint = seen === 0 ? point : offsetDisplayPoint(point, seen)
        addSubjectMarker(map, api, displayPoint, subjectLabel(opportunity.companyName), opportunity.title, setActiveSubject)
        
      }
      } catch (error) {
          window.shijiDesktop?.debug?.log(`map: center/overlay stage failed message=${error instanceof Error ? error.message : String(error)}`)
        }
        mapRef.current = map
      setState('ready')
      setMessage(centerPoint
          ? `底图已加载 · 中心已定位 · 共 ${opportunities.length} 条搜索结果 · ${locatedInside.length} 条按项目地址定位`
          : `底图已加载 · 中心地址暂未定位（${centerError ?? '请检查天地图服务端 Key'}） · 共 ${opportunities.length} 条搜索结果`)

      // 位置未知的项目仍在线索列表展示，但绝不按招标主体名称（可能是注册地址）补点，
      // 否则会把甲方所在地误画成工程实施地点。
      const pending = mapOpportunities.pending
      const pendingWithAddress = pending.filter((item) => Boolean(item.locationAddress?.trim())).length
      const pendingWithoutAddress = pending.length - pendingWithAddress
      window.shijiDesktop?.debug?.log(`map: marker summary locatedByProjectAddress=${locatedInside.length} pending=${pending.length} pendingWithAddress=${pendingWithAddress} pendingWithoutAddress=${pendingWithoutAddress}; company-name fallback disabled`)
        const parts = [
          '底图已加载',
          centerPoint ? '中心已定位' : `中心地址未定位（${centerError ?? '请检查天地图服务端 Key'}），半径圈未绘制`,
          `共 ${opportunities.length} 条搜索结果`,
          `${locatedInside.length} 条按公告项目地址定位`,
        ]
      if (pending.length > 0) parts.push(`${pending.length} 条项目位置待核验（${pendingWithAddress} 条有项目地址但未定位，${pendingWithoutAddress} 条未提取项目地址）；未用招标主体地址代替`)
      setMessage(parts.join(' · '))
    }
    void mount().catch(async (error) => {
      if (disposed) return
      let message = error instanceof Error ? error.message : '天地图底图加载失败。'
        window.shijiDesktop?.debug?.log(`map: mount failed message=${message} stack=${error instanceof Error ? (error.stack ?? '').slice(0, 2000) : ''}`)
      // The renderer's script tag only exposes a generic onerror. Ask the
      // main process for the same Key's diagnostic so an invalid/unauthorized
      // web Key is distinguishable from an ordinary transient load failure.
      if (message.includes('脚本') || message.includes('地图对象')) {
        try {
          const diagnostic = await credentials?.testTiandituWeb()
          if (diagnostic && !diagnostic.ok) message = diagnostic.message
        } catch {
          // Keep the original renderer error when the diagnostic itself fails.
        }
      }
      if (disposed) return
      setMessage(message)
      setState('fallback')
    }).finally(finishActivity)
    return () => {
      disposed = true
      mapRef.current?.clearOverLays?.()
      mapRef.current = undefined
    }
  }, [opportunityKey, profile.address, profile.radiusKm, theme, retryNonce, onActivityStart])

  if (state === 'fallback') return <section className="tianditu-unavailable panel-surface">
    <div className="tianditu-fallback-note">{message}</div>
    <strong>天地图真实底图未加载</strong>
    <span>当前页面来源：{window.location.origin === 'null' ? 'file:// 本地页面' : window.location.origin} · v{window.shijiDesktop?.version ?? '网页'} / 契约 {window.shijiDesktop?.contractVersion ?? '—'}。请到天地图控制台确认网页端 Key 的应用类型和来源白名单包含该来源；保存 Key 后点击“重新加载地图”，旧 Key 脚本会被清掉并重新加载。</span>
    <button type="button" className="button-secondary tianditu-retry" onClick={() => setRetryNonce((value) => value + 1)}>重新加载地图</button>
  </section>
  return <section className={`map-canvas tianditu-map ${state} theme-${theme}`}>
    <div ref={mapElement} id={mapId.current} className="tianditu-map-surface" />
    <div className="map-legend"><i className="legend-pin center" />中心<i className="legend-pin project" />项目公告地址点 · {profile.address} · {profile.radiusKm}km</div>
    {activeSubject && <div className="map-subject-popup">
        <button type="button" onClick={() => setActiveSubject(undefined)} aria-label="关闭">×</button>
        <strong>{activeSubject.name}</strong>
        <span>{activeSubject.detail} · 公告项目地址已定位</span>
      </div>}


    <div className="map-legend-tip">只显示已定位的公告项目地址；未知位置保留在右侧列表，不用甲方地址代替</div>
      
      
{/* removed subject strip

        const name = item.companyName?.trim()
        
      
    </div>}
*/}

    <div className="tianditu-map-status">{message}</div>
  </section>
}

function subjectLabel(name: string): string {
  return isPlaceholderSubject(name) ? '主体待识别' : name.trim()
}

/** 同一项目地址/主体在地图上只错开显示，不改变右侧列表中的事实坐标。 */
function offsetDisplayPoint(point: { longitude: number; latitude: number }, index: number): { longitude: number; latitude: number } {
  const angle = (index % 12) * (Math.PI / 6)
  const radius = 0.0015 * (1 + Math.floor(index / 12))
  return {
    longitude: point.longitude + Math.cos(angle) * radius,
    latitude: point.latitude + Math.sin(angle) * radius,
  }
}

function addSubjectMarker(
  map: TiandituOverlay,
  api: TiandituMapApi,
  point: { longitude: number; latitude: number },
  name: string,
  detail: string,
  onSelect: (value: { name: string; detail: string }) => void,
): void {
  const marker = new api.Marker(new api.LngLat(point.longitude, point.latitude))
  const show = () => onSelect({ name, detail })
  marker.addEventListener?.('click', show)
  marker.addEventListener?.('mouseover', show)
  map.addOverLay?.(marker)
}

function zoomForRadius(radiusKm: number): number {
  if (radiusKm <= 2) return 13
  if (radiusKm <= 5) return 12
  if (radiusKm <= 10) return 11
  return 10
}
