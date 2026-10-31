import { coordsFrom, tagsFromType } from './amapParse'
import type { PoiPreset } from '@/types'

/** SDK callback errors, malformed results and timeouts are not "no matches". */
export function searchPoi(AMap: any, keyword: string, city = '上海', pageSize = 10, timeoutMs = 8000): Promise<PoiPreset[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('地图地点搜索超时，请重试')), timeoutMs)
    try {
      const ps = new AMap.PlaceSearch({ city, citylimit: true, pageSize, pageIndex: 1, extensions: 'base' })
      ps.search(keyword, (status: string, result: any) => {
        clearTimeout(timer)
        if (status === 'no_data') { resolve([]); return }
        if (status !== 'complete') {
          const raw = typeof result === 'string' ? result : result?.info
          const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw) ? `（${raw}）` : ''
          reject(new Error(`地图地点搜索失败${code}，请检查搜索权限或配额`)); return
        }
        const raw = result?.poiList?.pois
        if (!Array.isArray(raw)) { reject(new Error('地图地点搜索返回格式异常')); return }
        const items: PoiPreset[] = raw.flatMap((poi: any) => {
          const coords = coordsFrom(poi?.location)
          const name = typeof poi?.name === 'string' ? poi.name.trim() : ''
          if (!coords || !name || Math.abs(coords.lng) > 180 || Math.abs(coords.lat) > 90) return []
          return [{ name, ...coords, openTime: '', closeTime: '', stayMin: 60, tags: tagsFromType(poi.type),
            district: typeof poi.adname === 'string' ? poi.adname : undefined }]
        })
        if (raw.length && !items.length) { reject(new Error('地图搜索结果缺少有效坐标')); return }
        resolve(items)
      })
    } catch {
      clearTimeout(timer)
      reject(new Error('地图地点搜索未就绪，请重试'))
    }
  })
}
