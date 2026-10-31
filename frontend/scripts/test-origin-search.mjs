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
const temporary = fs.mkdtempSync(path.join(scratch, 'origin-search-'))
try {
  const output = path.join(temporary, 'check.cjs')
  await build({ entryPoints: [path.join(frontend, 'src/lib/amapPoiSearch.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output })
  const { searchPoi } = require(output)
  let options
  const sdk = (status, result) => ({ PlaceSearch: class {
    constructor(value) { options = value }
    search(keyword, callback) { assert.equal(keyword, '和平饭店'); callback(status, result) }
  } })
  const variants = [{ lng: 121.49, lat: 31.24 }, '121.49,31.24', { getLng: () => 121.49, getLat: () => 31.24 }]
  for (const location of variants) {
    const pois = await searchPoi(sdk('complete', { poiList: { pois: [{ name: '和平饭店', location, type: '住宿;酒店' }] } }), '和平饭店', '上海', 8)
    assert.equal(pois[0].lng, 121.49)
    assert.equal(options.city, '上海'); assert.equal(options.citylimit, true)
  }
  assert.deepEqual(await searchPoi(sdk('no_data', {}), '和平饭店'), [])
  for (const result of ['INVALID_USER_SCODE', { info: 'INSUFFICIENT_PRIVILEGES' }]) {
    await assert.rejects(searchPoi(sdk('error', result), '和平饭店'), /搜索失败/)
  }
  await assert.rejects(searchPoi(sdk('complete', {}), '和平饭店'), /格式异常/)
  await assert.rejects(searchPoi(sdk('complete', { poiList: { pois: [{ name: 'bad', location: 'not-coordinates' }] } }), '和平饭店'), /有效坐标/)
  await assert.rejects(searchPoi({ PlaceSearch: class { search() {} } }, '和平饭店', '上海', 8, 10), /超时/)
  console.log('PASS: SDK coordinates, city boundary, genuine empty, permission failures, malformed results and timeout.')
} finally {
  assert.equal(path.dirname(temporary), scratch)
  fs.rmSync(temporary, { recursive: true, force: true })
}
