/**
 * 城市库（1.3）：首页选城市 → 推荐线路随城市变；工作台也锁定在该城市。
 *
 * 说明：后端离线快照只有上海 276 个 POI，其它城市用这里内置的少量地标
 * （坐标是公开地标的近似值），保证**不联网也能编译、画图、出时间轴**。
 * 配了高德 Web 服务 Key 时，工作台搜索会走在线数据。
 */
import { DEMO_ROUTES } from './demoRoutes'
import { SHANGHAI_POIS } from './shanghaiPois'
import inspirationCities from './inspirationCities.json'
import inspirationLandmarks from './inspirationLandmarks.json'
import type { TravelMode } from '@/types'

export interface CityPoi {
  name: string
  lng: number
  lat: number
  stayMin?: number
  tags?: string[]
  district?: string
  openTime?: string
  closeTime?: string
}

export interface CityRoute {
  id: string
  name: string
  desc: string
  days: number
  mode: TravelMode
  hotel: { name: string; lng: number; lat: number }
  poiNames: string[]
}

export interface City {
  id: string
  name: string
  /** 地图初始视野中心 */
  center: { lng: number; lat: number; zoom: number }
  hotel: { name: string; lng: number; lat: number }
  pois: CityPoi[]
  routes: CityRoute[]
}

const SHANGHAI: City = {
  id: 'shanghai',
  name: '上海',
  center: { lng: 121.4737, lat: 31.2304, zoom: 12.4 },
  hotel: { name: '人民广场 · 演示起点', lng: 121.4737, lat: 31.2304 },
  pois: [...SHANGHAI_POIS.map((poi) => ({
    name: poi.name,
    lng: poi.lng,
    lat: poi.lat,
    stayMin: poi.stayMin,
    tags: poi.tags,
    district: poi.district,
    openTime: poi.openTime,
    closeTime: poi.closeTime,
  })), ...inspirationLandmarks.shanghai],
  routes: DEMO_ROUTES.map((route) => ({
    id: route.id,
    name: route.name,
    desc: route.desc,
    days: route.days,
    mode: route.mode,
    hotel: route.hotel,
    poiNames: route.poiNames,
  })),
}

const BEIJING: City = {
  id: 'beijing',
  name: '北京',
  center: { lng: 116.3975, lat: 39.9087, zoom: 11.6 },
  hotel: { name: '王府井 · 演示起点', lng: 116.411, lat: 39.915 },
  pois: [
    { name: '天安门广场', lng: 116.3975, lat: 39.9087, stayMin: 45, tags: ['地标'], district: '东城区' },
    { name: '故宫博物院', lng: 116.3972, lat: 39.9163, stayMin: 150, tags: ['博物馆'], district: '东城区', openTime: '08:30', closeTime: '17:00' },
    { name: '景山公园', lng: 116.396, lat: 39.9252, stayMin: 50, tags: ['公园'], district: '西城区' },
    { name: '什刹海', lng: 116.386, lat: 39.94, stayMin: 60, tags: ['街区'], district: '西城区' },
    { name: '南锣鼓巷', lng: 116.403, lat: 39.937, stayMin: 60, tags: ['小吃', '街区'], district: '东城区' },
    { name: '颐和园', lng: 116.2755, lat: 39.9999, stayMin: 150, tags: ['园林'], district: '海淀区', openTime: '06:30', closeTime: '18:00' },
    { name: '天坛公园', lng: 116.4107, lat: 39.8822, stayMin: 90, tags: ['古迹'], district: '东城区' },
    { name: '798 艺术区', lng: 116.495, lat: 39.984, stayMin: 90, tags: ['艺术'], district: '朝阳区' },
    ...inspirationLandmarks.beijing,
  ],
  routes: [
    {
      id: 'axis',
      name: '中轴线一日',
      desc: '天安门 · 故宫 · 景山 · 什刹海 · 南锣鼓巷｜公交 1 天',
      days: 1,
      mode: 'transit',
      hotel: { name: '王府井 · 演示起点', lng: 116.411, lat: 39.915 },
      poiNames: ['天安门广场', '故宫博物院', '景山公园', '什刹海', '南锣鼓巷'],
    },
    {
      id: 'royal',
      name: '皇家园林',
      desc: '颐和园 · 天坛 · 798｜打车 1 天',
      days: 1,
      mode: 'taxi',
      hotel: { name: '王府井 · 演示起点', lng: 116.411, lat: 39.915 },
      poiNames: ['颐和园', '天坛公园', '798 艺术区'],
    },
  ],
}

const HANGZHOU: City = {
  id: 'hangzhou',
  name: '杭州',
  center: { lng: 120.155, lat: 30.259, zoom: 12.2 },
  hotel: { name: '湖滨 · 演示起点', lng: 120.162, lat: 30.255 },
  pois: [
    { name: '断桥残雪', lng: 120.155, lat: 30.259, stayMin: 40, tags: ['西湖'], district: '西湖区' },
    { name: '雷峰塔', lng: 120.148, lat: 30.231, stayMin: 60, tags: ['地标'], district: '西湖区' },
    { name: '灵隐寺', lng: 120.101, lat: 30.241, stayMin: 100, tags: ['寺庙'], district: '西湖区', openTime: '07:00', closeTime: '18:00' },
    { name: '河坊街', lng: 120.169, lat: 30.24, stayMin: 70, tags: ['小吃', '街区'], district: '上城区' },
    { name: '西溪湿地', lng: 120.065, lat: 30.265, stayMin: 120, tags: ['湿地'], district: '西湖区' },
    { name: '龙井村', lng: 120.107, lat: 30.22, stayMin: 80, tags: ['茶'], district: '西湖区' },
  ],
  routes: [
    {
      id: 'westlake',
      name: '西湖环线',
      desc: '断桥 · 雷峰塔 · 龙井村 · 河坊街｜公交 1 天',
      days: 1,
      mode: 'transit',
      hotel: { name: '湖滨 · 演示起点', lng: 120.162, lat: 30.255 },
      poiNames: ['断桥残雪', '雷峰塔', '龙井村', '河坊街'],
    },
    {
      id: 'linger',
      name: '灵隐与西溪',
      desc: '灵隐寺 · 西溪湿地 · 龙井村｜打车 1 天',
      days: 1,
      mode: 'taxi',
      hotel: { name: '湖滨 · 演示起点', lng: 120.162, lat: 30.255 },
      poiNames: ['灵隐寺', '西溪湿地', '龙井村'],
    },
  ],
}

const CHENGDU: City = {
  id: 'chengdu',
  name: '成都',
  center: { lng: 104.065, lat: 30.658, zoom: 11.8 },
  hotel: { name: '春熙路 · 演示起点', lng: 104.08, lat: 30.657 },
  pois: [
    { name: '宽窄巷子', lng: 104.061, lat: 30.669, stayMin: 80, tags: ['街区'], district: '青羊区' },
    { name: '人民公园', lng: 104.065, lat: 30.658, stayMin: 60, tags: ['公园'], district: '青羊区' },
    { name: '武侯祠', lng: 104.044, lat: 30.645, stayMin: 70, tags: ['古迹'], district: '武侯区' },
    { name: '锦里', lng: 104.043, lat: 30.642, stayMin: 80, tags: ['小吃'], district: '武侯区' },
    { name: '杜甫草堂', lng: 104.03, lat: 30.659, stayMin: 80, tags: ['古迹'], district: '青羊区' },
    { name: '大熊猫繁育研究基地', lng: 104.147, lat: 30.733, stayMin: 150, tags: ['动物园'], district: '成华区', openTime: '07:30', closeTime: '18:00' },
  ],
  routes: [
    {
      id: 'downtown',
      name: '市区经典一日',
      desc: '宽窄巷子 · 人民公园 · 武侯祠 · 锦里｜公交 1 天',
      days: 1,
      mode: 'transit',
      hotel: { name: '春熙路 · 演示起点', lng: 104.08, lat: 30.657 },
      poiNames: ['宽窄巷子', '人民公园', '武侯祠', '锦里'],
    },
    {
      id: 'panda',
      name: '熊猫与草堂',
      desc: '熊猫基地 · 杜甫草堂 · 宽窄巷子｜打车 1 天',
      days: 1,
      mode: 'taxi',
      hotel: { name: '春熙路 · 演示起点', lng: 104.08, lat: 30.657 },
      poiNames: ['大熊猫繁育研究基地', '杜甫草堂', '宽窄巷子'],
    },
  ],
}

const XIAN: City = {
  id: 'xian',
  name: '西安',
  center: { lng: 108.942, lat: 34.261, zoom: 12.2 },
  hotel: { name: '钟楼 · 演示起点', lng: 108.942, lat: 34.261 },
  pois: [
    { name: '钟楼', lng: 108.942, lat: 34.261, stayMin: 40, tags: ['地标'], district: '碑林区' },
    { name: '鼓楼', lng: 108.94, lat: 34.264, stayMin: 35, tags: ['地标'], district: '莲湖区' },
    { name: '回民街', lng: 108.933, lat: 34.265, stayMin: 80, tags: ['小吃'], district: '莲湖区' },
    { name: '西安城墙 · 永宁门', lng: 108.945, lat: 34.25, stayMin: 80, tags: ['城墙'], district: '碑林区' },
    { name: '陕西历史博物馆', lng: 108.953, lat: 34.222, stayMin: 120, tags: ['博物馆'], district: '雁塔区' },
    { name: '大雁塔', lng: 108.964, lat: 34.219, stayMin: 70, tags: ['古迹'], district: '雁塔区' },
    { name: '大唐不夜城', lng: 108.968, lat: 34.216, stayMin: 90, tags: ['夜游'], district: '雁塔区' },
  ],
  routes: [
    {
      id: 'oldtown',
      name: '古城一日',
      desc: '钟楼 · 鼓楼 · 回民街 · 城墙 · 大雁塔｜公交 1 天',
      days: 1,
      mode: 'transit',
      hotel: { name: '钟楼 · 演示起点', lng: 108.942, lat: 34.261 },
      poiNames: ['钟楼', '鼓楼', '回民街', '西安城墙 · 永宁门', '大雁塔'],
    },
    {
      id: 'tang',
      name: '唐风夜游',
      desc: '陕历博 · 大雁塔 · 大唐不夜城｜地铁 1 天',
      days: 1,
      mode: 'subway',
      hotel: { name: '钟楼 · 演示起点', lng: 108.942, lat: 34.261 },
      poiNames: ['陕西历史博物馆', '大雁塔', '大唐不夜城'],
    },
  ],
}

const GUANGZHOU: City = {
  id: 'guangzhou',
  name: '广州',
  center: { lng: 113.264, lat: 23.129, zoom: 12.0 },
  hotel: { name: '北京路 · 演示起点', lng: 113.27, lat: 23.125 },
  pois: [
    { name: '陈家祠', lng: 113.247, lat: 23.128, stayMin: 70, tags: ['古迹'], district: '荔湾区' },
    { name: '上下九步行街', lng: 113.244, lat: 23.119, stayMin: 70, tags: ['小吃', '街区'], district: '荔湾区' },
    { name: '沙面', lng: 113.243, lat: 23.107, stayMin: 80, tags: ['街区'], district: '荔湾区' },
    { name: '北京路步行街', lng: 113.27, lat: 23.125, stayMin: 70, tags: ['街区'], district: '越秀区' },
    { name: '越秀公园', lng: 113.264, lat: 23.14, stayMin: 70, tags: ['公园'], district: '越秀区' },
    { name: '广州塔', lng: 113.324, lat: 23.106, stayMin: 90, tags: ['地标', '夜景'], district: '海珠区' },
    { name: '珠江夜游 · 天字码头', lng: 113.276, lat: 23.113, stayMin: 80, tags: ['夜游'], district: '越秀区' },
  ],
  routes: [
    {
      id: 'oldtown',
      name: '老城一日',
      desc: '陈家祠 · 上下九 · 沙面 · 北京路｜公交 1 天',
      days: 1,
      mode: 'transit',
      hotel: { name: '北京路 · 演示起点', lng: 113.27, lat: 23.125 },
      poiNames: ['陈家祠', '上下九步行街', '沙面', '北京路步行街'],
    },
    {
      id: 'river',
      name: '江景夜游',
      desc: '越秀公园 · 广州塔 · 珠江夜游｜打车 1 天',
      days: 1,
      mode: 'taxi',
      hotel: { name: '北京路 · 演示起点', lng: 113.27, lat: 23.125 },
      poiNames: ['越秀公园', '广州塔', '珠江夜游 · 天字码头'],
    },
  ],
}

export const CITIES: City[] = [SHANGHAI, BEIJING, HANGZHOU, CHENGDU, XIAN, GUANGZHOU, ...inspirationCities.map((city): City => ({
  ...city, routes: city.routes.map((route) => ({ ...route, mode: route.mode as TravelMode })),
}))]

export function getCity(cityId: string): City {
  return CITIES.find((city) => city.id === cityId) ?? SHANGHAI
}

/** 把线路里的 POI 名解析成带坐标的点；找不到的跳过 */
export function resolveRoutePois(city: City, route: CityRoute): CityPoi[] {
  return route.poiNames
    .map((name) => city.pois.find((poi) => poi.name === name))
    .filter((poi): poi is CityPoi => Boolean(poi))
}
