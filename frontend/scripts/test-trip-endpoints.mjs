import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite/package.json'))] }))
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scratch = path.resolve(frontend, '..', '.tmp')
fs.mkdirSync(scratch, { recursive: true })
const temporary = fs.mkdtempSync(path.join(scratch, 'trip-endpoints-'))
const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
globalThis.window = globalThis

try {
  const output = path.join(temporary, 'test.cjs')
  const from = name => JSON.stringify(path.join(frontend, 'src', name))
  await build({ stdin: { contents: ['store/useTripStore.ts','hooks/usePlanController.ts','lib/routeDisplay.ts','lib/tripEndpoints.ts','lib/amapSearch.ts','lib/mapInstance.ts','lib/amapNav.ts','lib/longImage.ts'].map(name=>`export * from ${from(name)}`).join(';'), resolveDir: frontend, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent', alias: { '@': path.join(frontend, 'src') }, define: { 'import.meta.env': '{}' } })
  const api = require(output)
  const {useTripStore: store, snapshotTrip, buildPlanPayload, displayRoutes, dayEndPoint, dayFinishName, setSearchCity, localPoisForCity, searchPlaces, setMapInstance, resolveSuggestion, buildNavUrl, exportTripLongImage} = api
  assert.equal(store.getState().endMode,'return')
  store.getState().setCity('hangzhou')
  const origin = store.getState().hotel
  store.getState().addDestination({name:'西湖',lng:120.15,lat:30.25,selected:true})
  const signature = store.getState().currentSignature()
  const end = {name:'杭州东站',lng:120.21,lat:30.29,address:'天城路'}
  store.getState().setEndPoint(end)
  assert.notEqual(store.getState().currentSignature(),signature)
  let payload = buildPlanPayload()
  assert.equal(payload.cityName,'杭州')
  assert.equal(payload.endMode,'custom')
  assert.deepEqual(payload.endPoint,end)
  store.getState().saveProfile({nickname:'保留的用户'})
  const saved = store.getState().saveTrip('异地结束')
  store.getState().setCity('beijing')
  assert.equal(store.getState().endMode,'return')
  assert.equal(store.getState().endPoint,null)
  store.getState().openTrip(saved.id)
  assert.equal(store.getState().cityId,'hangzhou')
  assert.deepEqual(buildPlanPayload().endPoint,end)
  const shared = snapshotTrip(store.getState())
  store.getState().setFullTripState(JSON.parse(JSON.stringify(shared)))
  assert.deepEqual(buildPlanPayload().endPoint,end)
  assert.equal(store.getState().profile.nickname,'保留的用户')

  const stop = {id:'a',name:'西湖',lng:120.15,lat:30.25,arriveTime:'09:05',leaveTime:'10:05'}
  const day = {date:'2026-11-02',endMode:'custom',endPoint:end,stops:[stop],returnTime:'10:30',stats:{totalWalkKm:1,totalTransitMin:20,totalCost:7}}
  let routes = displayRoutes(day,origin,'transit')
  assert.equal(routes.length,2)
  assert.deepEqual(routes[1].path.at(-1),[end.lng,end.lat])
  assert.deepEqual(dayEndPoint(day,origin),end)
  const url = new URL(buildNavUrl({from:stop,to:end,mode:'transit'}))
  assert.equal(url.searchParams.get('to'),'120.210000,30.290000,杭州东站')
  const freeDay = {...day,endMode:'last_stop',endPoint:stop}
  assert.equal(dayEndPoint(freeDay,origin),null)
  assert.equal(dayFinishName(freeDay,origin),'西湖')
  assert.equal(displayRoutes(freeDay,origin,'transit').length,1)
  store.getState().setEndMode('last_stop')
  payload=buildPlanPayload()
  assert.equal(payload.endPoint,null)
  assert.equal(payload.endMode,'last_stop')

  const legacy={...shared};delete legacy.endMode;delete legacy.endPoint
  store.getState().setFullTripState(legacy)
  assert.equal(store.getState().endMode,'return')
  assert.equal(store.getState().endPoint,null)
  assert.deepEqual(dayEndPoint({stops:[stop]},origin),origin)
  assert.deepEqual(displayRoutes({stops:[stop]},origin,'transit')[1].path.at(-1),[origin.lng,origin.lat])

  assert.ok(localPoisForCity('杭州').some(x=>x.name==='断桥残雪'))
  assert.ok(!localPoisForCity('杭州').some(x=>x.name==='外滩'))
  const options=[]
  const sdk={ AutoComplete:class {constructor(o){options.push(o)}search(kw,cb){cb('complete',{tips:[{id:kw,name:kw,location:{lng:120.1,lat:30.2}}]})}}, PlaceSearch:class {constructor(o){options.push(o)}getDetails(id,cb){cb('complete',{poiList:{pois:[{id,name:id,location:{lng:120.1,lat:30.2}}]}})}} }
  setMapInstance({},sdk)
  setSearchCity('杭州')
  const first=(await searchPlaces('测试景点')) .items[0]
  setSearchCity('北京')
  await searchPlaces('另一景点')
  await resolveSuggestion(first)
  assert.deepEqual(options.map(x=>x.city),['杭州','北京','杭州'],'A delayed details lookup keeps the suggestion city')

  const texts=[]
  const context=new Proxy({fillText:(t)=>texts.push(t)}, {get:(o,p)=>p in o?o[p]:()=>{},set:(o,p,v)=>{o[p]=v;return true}})
  globalThis.document={createElement:()=>({getContext:()=>context,toBlob:()=>{}})}
  exportTripLongImage({hotel:origin,plan:{days:[day,freeDay]}})
  assert.ok(texts.some(x=>x.includes('到达终点：杭州东站')))
  assert.ok(texts.some(x=>x.includes('在 西湖 结束')))
  store.getState().setCity('hangzhou')
  store.getState().setEndPoint(end)
  store.getState().resetAll()
  assert.equal(buildPlanPayload().cityName,'杭州')
  assert.ok(store.getState().hotel.lng > 120 && store.getState().hotel.lng < 121,'Clearing a Hangzhou journey must not reset the origin to Shanghai')
  assert.equal(buildPlanPayload().endMode,'return')
  assert.equal(buildPlanPayload().endPoint,null)
  console.log('PASS: legacy defaults, saved/shared endpoints, dirty-state detection, city-aware payload/search/details, correct terminal map/nav, no free-end return, and export finish labels.')
} finally {
  assert.equal(path.dirname(temporary),scratch)
  fs.rmSync(temporary,{recursive:true,force:true})
}
