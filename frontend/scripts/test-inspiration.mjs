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
const temporary = fs.mkdtempSync(path.join(scratch, 'waywise-catalog-'))
assert.equal(path.dirname(temporary), scratch)
const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
try {
  const output = path.join(temporary, 'test.cjs')
  const from = name => JSON.stringify(path.join(frontend, 'src', name))
  await build({
    stdin: { contents: `export * from ${from('data/inspiration.ts')}; export * from ${from('lib/loadInspiration.ts')}; export * from ${from('store/useTripStore.ts')};`, resolveDir: frontend, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent',
    alias: { '@': path.join(frontend, 'src') },
  })
  const api = createRequire(import.meta.url)(output)
  const { INSPIRATIONS, resolveInspiration, loadInspiration, useTripStore, snapshotTrip } = api
  assert.equal(INSPIRATIONS.length, 32)
  assert.equal(new Set(INSPIRATIONS.map(x => x.id)).size, 32)
  assert.equal(new Set(INSPIRATIONS.map(x => x.image)).size, 32)
  assert.ok(new Set(INSPIRATIONS.map(x => x.cityId)).size > 10)
  useTripStore.getState().saveProfile({ nickname: '保留的用户' })
  const previous = useTripStore.getState().saveTrip('保留的旧行程')
  localStorage.setItem('tripcompiler:chat:v1', JSON.stringify({ [previous.id]: [{ id: 'm1', role: 'user', text: '保留的历史对话' }] }))
  for (const item of INSPIRATIONS) {
    const { city, route, pois } = resolveInspiration(item)
    assert.equal(city.id, item.cityId)
    assert.equal(pois.length, route.poiNames.length)
    for (const poi of pois) {
      assert.ok(Number.isFinite(poi.lng) && Number.isFinite(poi.lat))
      assert.ok(poi.lng > 70 && poi.lng < 140 && poi.lat > 15 && poi.lat < 55)
    }
    assert.ok(fs.statSync(path.join(frontend, 'public', item.image)).size > 0)
    useTripStore.getState().setLegMode('__return__', 'walk')
    loadInspiration(item)
    const state = useTripStore.getState()
    assert.equal(state.cityId, item.cityId)
    assert.equal(state.destinations.length, item.poiNames.length)
    assert.deepEqual(state.legModes, {})
    assert.equal(state.plan, null)
    assert.equal(state.profile.nickname, '保留的用户')
    assert.ok(state.trips.some(t => t.id === previous.id))
  }
  const item = INSPIRATIONS.find(x => x.cityId === 'hangzhou')
  loadInspiration(item)
  const saved = useTripStore.getState().saveTrip(item.title)
  useTripStore.getState().setCity('shanghai')
  assert.ok(useTripStore.getState().openTrip(saved.id))
  assert.equal(useTripStore.getState().cityId, 'hangzhou')
  const before = snapshotTrip(useTripStore.getState())
  assert.throws(() => loadInspiration({ ...item, poiNames: ['不存在的地点'] }))
  assert.equal(useTripStore.getState().cityId, before.cityId)
  assert.deepEqual(useTripStore.getState().destinations.map(x => x.name), before.destinations.map(x => x.name))
  // Legacy journeys have no cityId; recover the city from their real origin.
  const legacy = { ...before }; delete legacy.cityId
  useTripStore.getState().setCity('datong')
  useTripStore.getState().setFullTripState(legacy)
  assert.equal(useTripStore.getState().cityId, 'hangzhou')
  assert.ok(localStorage.getItem('tripcompiler:v1'))
  assert.ok(localStorage.getItem('tripcompiler:chat:v1').includes('保留的历史对话'))
  console.log('PASS: 32 photo presets resolve; invalid presets preserve drafts; old journeys, city restoration, profiles and chat storage remain compatible.')
} finally {
  assert.equal(path.dirname(temporary), scratch)
  fs.rmSync(temporary, { recursive: true, force: true })
}
