import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNDARY_MODULE_OPTIONS, isSupportedBoundary, resolveBoundaryModuleKey } from '../types/boundary.ts'

test('retired categories remain in historical metadata but are excluded from active boundary choices', () => {
  const boundaries = [
    { id: 'weather', category: 'weather', meaning: 'power', name: '风电出力' },
    { id: 'load', category: 'load', meaning: 'load', name: '电负荷' },
    { id: 'retired', category: 'agc', meaning: 'power', name: '历史调度目标' },
    { id: 'unknown', category: 'retired-module', meaning: 'power', name: '历史边界' }
  ]
  const original = JSON.stringify(boundaries)
  assert.deepEqual(boundaries.filter(isSupportedBoundary).map(item => item.id), ['weather', 'load'])
  assert.equal(JSON.stringify(boundaries), original)
  assert.deepEqual(BOUNDARY_MODULE_OPTIONS.map(item => item.key), ['device-fitting', 'weather', 'load', 'price'])
})

test('renewable power and legacy load and price boundaries retain their supported categories', () => {
  for (const category of [undefined, null, '', 'boundary', 'weather', 'load', 'price', 'device-fitting']) {
    assert.equal(isSupportedBoundary({ category }), true)
  }
  assert.equal(resolveBoundaryModuleKey({ meaning: 'power', name: '风机出力' }), 'weather')
  assert.equal(resolveBoundaryModuleKey({ meaning: 'load' }), 'load')
  assert.equal(resolveBoundaryModuleKey({ meaning: 'buy_price' }), 'price')
  assert.equal(resolveBoundaryModuleKey({ meaning: 'factor' }), 'device-fitting')
})
