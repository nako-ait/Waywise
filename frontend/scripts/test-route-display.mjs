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
const temporary = fs.mkdtempSync(path.join(scratch, 'route-display-'))
globalThis.window = globalThis
try {
  const output = path.join(temporary, 'test.cjs')
  const source = file => JSON.stringify(path.join(frontend, 'src/lib', file))
  await build({ stdin: { contents: `export * from ${source('routeDisplay.ts')}; export * from ${source('routeGeometry.ts')}`, resolveDir: frontend, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: output })
  const { displayRoutes, verifiedServerPath, fetchLegGeometries, clearGeometryCache } = require(output)
  const origin = { name: '起点', lng: 121.47, lat: 31.23 }
  const verified = { mode: 'transit', approx: false, dataSource: 'amap', durationMin: 15, distanceKm: 4, cost: 4 }
  const estimated = { ...verified, mode: 'walk', approx: true, durationMin: 14 }
  const road = [[121.47,31.23],[121.49,31.22],[121.50,31.24]]
  const straight = [road[0],road[2]]
  const day = { date: '第1天', stops: [
    { id: 'a', name: '外滩', lng:121.5,lat:31.24, transportFromPrev: verified },
    { id: 'b', name: '浦东', lng:121.51,lat:31.25, transportFromPrev: estimated },
  ], returnLeg: { ...estimated, mode: 'taxi' }, polylines:[road,straight,straight] }
  let items = displayRoutes(day,origin,'transit')
  assert.deepEqual(items.map(x=>x.verified), [true,false,false], 'Matrix provenance must not hide failed leg geometry')
  assert.equal(items[2].mode,'taxi')
  const recovery = { path:road,resolvedMode:'walk',durationMin:3,distanceKm:1 }
  items = displayRoutes(day,origin,'transit',[null,recovery])
  assert.equal(items[1].verified,true)
  assert.equal(items[1].statsEstimated,true)
  assert.equal(items[1].leg.durationMin,14, 'Geometry recovery must not silently replace planning statistics')
  assert.equal(displayRoutes(day,origin,'transit',[null,{...recovery,resolvedMode:'drive'}])[1].verified,false)
  assert.equal(verifiedServerPath(verified,[[NaN,0],[1,2]]),false)
  const leg={from:origin,to:{lng:121.5,lat:31.24},mode:'walk'}
  const options={gapMs:0,timeoutMs:20}
  let walking=0,driving=0,cityOptions
  const sdk={LngLat:class {constructor(lng,lat){this.lng=lng;this.lat=lat}},
    Walking:class {search(a,b,cb){walking++;cb('error',{info:'INVALID_USER_SCODE'})}},
    Driving:class {search(){driving++;throw new Error('Wrong fallback')}}}
  let result=await fetchLegGeometries(sdk,[leg],'walk','上海',options)
  assert.equal(result[0].resolvedMode,'none');assert.match(result[0].error,/INVALID_USER_SCODE/)
  assert.equal(driving,0,'A failed walk must not become a driving geometry')
  await fetchLegGeometries(sdk,[leg],'walk','上海',options)
  assert.equal(walking,2,'Failure must remain retryable')
  const transit = { ...sdk, Transfer:class {
    constructor(value){cityOptions=value}
    search(a,b,cb){cb('complete',{plans:[{path:road,time:180,distance:1000,segments:[{transit:{name:'公交1路',type:'公交线路'}}]}]})}
  }}
  result=await fetchLegGeometries(transit,[{...leg,mode:'transit'}],'transit','杭州',options)
  assert.equal(cityOptions.city,'杭州');assert.equal(cityOptions.cityd,'杭州');assert.equal(result[0].resolvedMode,'transit')
  result=await fetchLegGeometries(transit,[{...leg,mode:'subway'}],'subway','杭州',options)
  assert.equal(result[0].resolvedMode,'none','A bus-only result must not be shown as a subway route')
  const successful={...sdk,Walking:class {search(a,b,cb){walking++;cb('complete',{routes:[{steps:[{path:road}],time:180,distance:1000}]})}}}
  clearGeometryCache()
  await fetchLegGeometries(successful,[leg],'walk','上海',options)
  const before=walking
  await fetchLegGeometries(successful,[leg],'walk','上海',options)
  assert.equal(walking,before)
  await fetchLegGeometries(successful,[leg],'walk','杭州',options)
  assert.equal(walking,before+1,'Different cities must not share SDK cache entries')
  assert.deepEqual(await fetchLegGeometries(successful,[{...leg,skip:true}],'walk','上海',options),[null])
  assert.equal(await fetchLegGeometries(successful,[leg],'walk','上海',{...options,cancelled:()=>true}),null)
  const hanging={...sdk,Walking:class {search(){}}}
  clearGeometryCache()
  result=await fetchLegGeometries(hanging,[leg],'walk','上海',options)
  assert.match(result[0].error,/超时/)
  console.log('PASS: per-leg provenance, failed/mixed routes, return mode, geometry-only recovery, no wrong-mode fallback, city-aware lookup/cache, retries, cancellation and timeout.')
} finally {
  assert.equal(path.dirname(temporary),scratch)
  fs.rmSync(temporary,{recursive:true,force:true})
}
