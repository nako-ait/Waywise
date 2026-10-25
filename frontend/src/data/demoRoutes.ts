/**
 * 三条主题演示线路（模块 5）。
 *
 * 为什么内置在前端而不是问后端要：演示现场**零网络依赖**是最重要的。
 * 这三条线覆盖了三种典型玩法，各自能演示不同的能力：
 *   经典一日 → 单日 TSP + 营业时间窗（豫园 16:45 关门）
 *   浦江夜景 → 打车 + 观光厅的晚场时间窗 + 沿江顺路
 *   水乡两日 → 多日地理聚类（朱家角/七宝 在西边，市区在东边）
 *
 * 演示起点的坐标取的是同名地标（标注为「演示起点」），
 * 现场可以随时用左侧「出发酒店」搜索真实酒店替换掉。
 */
import type { TravelMode } from '@/types'

export interface DemoRoute {
  id: string
  name: string
  desc: string
  hotel: { name: string; lng: number; lat: number; address?: string }
  mode: TravelMode
  days: number
  /** 要加入并选中的 POI 名称（必须能在 SHANGHAI_POIS 里找到） */
  poiNames: string[]
}

export const DEMO_ROUTES: DemoRoute[] = [
  {
    id: 'classic',
    name: '经典一日',
    desc: '外滩 · 豫园 · 南京路 · 上博 · 新天地 · 田子坊｜公交 1 天',
    hotel: { name: '人民广场 · 演示起点', lng: 121.4737, lat: 31.2304, address: '黄浦区人民大道' },
    mode: 'transit',
    days: 1,
    poiNames: ['外滩', '豫园·城隍庙', '南京路步行街', '上海博物馆', '新天地', '田子坊'],
  },
  {
    id: 'night',
    name: '浦江夜景',
    desc: '陆家嘴 · 东方明珠 · 上海之巅 · 北外滩 · 外滩｜打车 1 天',
    hotel: { name: '外滩 · 演示起点', lng: 121.4903, lat: 31.2397, address: '黄浦区中山东一路' },
    mode: 'taxi',
    days: 1,
    poiNames: [
      '外滩',
      '陆家嘴滨江大道',
      '东方明珠广播电视塔',
      '上海中心大厦·上海之巅观光厅',
      '北外滩·白玉兰广场',
      '南京路步行街',
    ],
  },
  {
    id: 'watertown',
    name: '水乡两日',
    desc: '朱家角 · 七宝老街 · 动物园 + 市区｜公交 2 天',
    hotel: { name: '徐家汇 · 演示起点', lng: 121.4370, lat: 31.1930, address: '徐汇区徐家汇' },
    mode: 'transit',
    days: 2,
    poiNames: [
      '朱家角古镇',
      '七宝老街',
      '上海动物园',
      '徐家汇天主教堂',
      '武康路·武康大楼',
      '新天地',
      '田子坊',
    ],
  },
]
