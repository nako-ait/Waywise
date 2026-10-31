/**
 * 高德地图 JS API 封装
 *  - 单例加载（React 严格模式下 useEffect 会跑两次，必须复用同一个 Promise）
 *  - 缺 Key 时抛 MISSING_AMAP_KEY，由 MapView 渲染配置引导卡片，而不是白屏
 *  - 统一封装逆地理编码 / POI 搜索，供地图点击命名与酒店搜索使用
 *
 * ⚠️ 坐标系：高德返回的全部是 GCJ-02，直接使用，不要再做任何转换。
 */
import AMapLoader from '@amap/amap-jsapi-loader'
import type { PoiPreset } from '@/types'

export const AMAP_JS_KEY = (import.meta.env.VITE_AMAP_JS_KEY ?? '').trim()
export const AMAP_SECURITY_CODE = (import.meta.env.VITE_AMAP_SECURITY_CODE ?? '').trim()
const AMAP_SERVICE_HOST = (import.meta.env.VITE_AMAP_SERVICE_HOST ?? '').trim()
export const hasAmapKey = AMAP_JS_KEY.length > 0

/** 上海市中心（人民广场） */
export const SHANGHAI_CENTER: [number, number] = [121.4737, 31.2304]

/** 需要的插件：控件 + 服务类 API（模块 2/3 的距离矩阵、路径规划也在这里预加载） */
const PLUGINS = [
  'AMap.Scale',
  'AMap.ToolBar',
  'AMap.InfoWindow',
  'AMap.Geocoder',
  'AMap.PlaceSearch',
  'AMap.AutoComplete',
  'AMap.Walking',
  'AMap.Driving',
  'AMap.Transfer',
  'AMap.Riding',
]

let loadingPromise: Promise<any> | null = null

/** 加载高德 JS API（幂等） */
export function loadAMap(): Promise<any> {
  if (typeof window !== 'undefined' && window.AMap) return Promise.resolve(window.AMap)
  if (loadingPromise) return loadingPromise

  if (!hasAmapKey) return Promise.reject(new Error('MISSING_AMAP_KEY'))

  // JS API 2.0：如果 Key 绑定了「安全密钥」，必须在加载前注入
  if (AMAP_SERVICE_HOST) {
    window._AMapSecurityConfig = {
      serviceHost: new URL(AMAP_SERVICE_HOST, window.location.origin).href.replace(/\/$/, ''),
    }
  } else if (AMAP_SECURITY_CODE) {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE }
  }

  loadingPromise = AMapLoader.load({
    key: AMAP_JS_KEY,
    version: '2.0',
    plugins: PLUGINS,
  })
    .then((AMap: any) => {
      window.AMap = AMap
      return AMap
    })
    .catch((err: unknown) => {
      loadingPromise = null // 允许失败后重试
      throw err
    })

  return loadingPromise
}

/** 逆地理编码结果 */
export interface RegeoResult {
  /** 最适合作为候选点名称的文案 */
  name: string
  /** 格式化地址 */
  address: string
}

/**
 * 逆地理编码：地图点击后用最近的 POI 名给候选点命名。
 * extensions: 'all' 才会返回周边 pois 列表。
 */
export function reverseGeocode(
  AMap: any,
  lng: number,
  lat: number,
  city = '上海',
): Promise<RegeoResult> {
  return new Promise((resolve) => {
    const geocoder = new AMap.Geocoder({ city, radius: 200, extensions: 'all' })
    geocoder.getAddress([lng, lat], (status: string, result: any) => {
      if (status !== 'complete' || !result?.regeocode) {
        resolve({ name: '候选点', address: '' })
        return
      }
      const rg = result.regeocode
      const address: string = rg.formattedAddress ?? ''
      // 优先取 80m 内最近 POI 的名字，其次地址，最后兜底
      const pois: any[] = rg.pois ?? []
      const near = pois.find((p) => {
        const d = p.distance != null ? Number(p.distance) : Number.POSITIVE_INFINITY
        return d <= 80
      })
      const name = near?.name || address || '候选点'
      resolve({ name, address })
    })
  })
}

/** 搜索 POI（酒店搜索 & 地名搜索共用） */
export function searchPoi(
  AMap: any,
  keyword: string,
  city = '上海',
  pageSize = 10,
): Promise<PoiPreset[]> {
  return new Promise((resolve) => {
    const ps = new AMap.PlaceSearch({
      city,
      citylimit: true,
      pageSize,
      pageIndex: 1,
      extensions: 'all',
    })
    ps.search(keyword, (status: string, result: any) => {
      if (status !== 'complete' || !result?.poiList?.pois) {
        resolve([])
        return
      }
      const list: PoiPreset[] = result.poiList.pois.map((p: any) => ({
        name: p.name,
        lng: Number(p.location?.lng),
        lat: Number(p.location?.lat),
        openTime: '',
        closeTime: '',
        stayMin: 60,
        tags: typeof p.type === 'string' ? p.type.split(';').slice(0, 3) : [],
        district: p.adname,
      }))
      resolve(list.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)))
    })
  })
}

/** 地址 -> 坐标（酒店名直接地理编码时用） */
export function geocode(AMap: any, address: string, city = '上海'): Promise<PoiPreset[]> {
  return new Promise((resolve) => {
    const gc = new AMap.Geocoder({ city })
    gc.getLocation(address, (status: string, result: any) => {
      if (status !== 'complete' || !result?.geocodes?.length) {
        resolve([])
        return
      }
      resolve(
        result.geocodes.map((g: any) => ({
          name: g.formattedAddress ?? address,
          lng: Number(g.location.lng),
          lat: Number(g.location.lat),
          openTime: '',
          closeTime: '',
          stayMin: 60,
          tags: ['geocode'],
          district: g.addressComponent?.district,
        })),
      )
    })
  })
}
