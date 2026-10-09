// Run: node src/swarm/MagicalLightRibbons.test.js
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MagicalLightRibbons, RIBBON_DEFAULTS } from './MagicalLightRibbons.js'

function simulate(fps) {
  const queen = new THREE.Group()
  const followers = Array.from({ length: 16 }, () => ({ wrapper: new THREE.Group(), active: false }))
  const ribbons = new MagicalLightRibbons(queen, followers, { quality: 'high', motionSpeed: 0 })
  const buffers = ribbons.strands.map(strand => strand.mesh.geometry.attributes.position.array)
  for (let frame = 0; frame < fps * 12; frame++) {
    const time = (frame + 1) / fps
    queen.position.set(Math.sin(time * 0.4), 1 + Math.sin(time * 0.2) * 0.3, -time * 0.15)
    followers.forEach((follower, index) => {
      follower.active = time > 1 + index * 0.2
      follower.wrapper.position.copy(queen.position).add(new THREE.Vector3(index * 0.02, 0.1, 0.3))
    })
    ribbons.update(1 / fps, true)
    if (time < 1) assert.ok(ribbons.strands.slice(2).every(strand => !strand.mesh.visible))
  }
  ribbons.strands.forEach((strand, index) => {
    assert.equal(strand.mesh.geometry.attributes.position.array, buffers[index], 'reuse GPU buffers')
    assert.ok(buffers[index].every(Number.isFinite), 'curves never contain NaN/Infinity')
    assert.ok(strand.head.distanceTo(queen.position) < 1, 'trail remains attached to its emitter')
    const tip = strand.curve.points.at(-1)
    assert.ok(Math.abs(tip.z - strand.head.z - strand.duration * 0.15) < 0.04, 'history covers the configured lifetime')
    assert.ok(strand.curve.points[0].distanceTo(strand.head) < 1e-8, 'weave does not move the attachment')
  })
  return { ribbons, queen }
}

const slow = simulate(30)
const fast = simulate(120)
for (let i = 0; i < slow.ribbons.strands[0].curve.points.length; i++) {
  assert.ok(slow.ribbons.strands[0].curve.points[i].distanceTo(fast.ribbons.strands[0].curve.points[i]) < 0.015,
    'trajectory history stays consistent at 30 and 120 fps')
}

const { ribbons, queen } = slow
const head = ribbons.strands[0].head.clone()
ribbons.update(NaN, true)
ribbons.update(-1, true)
assert.deepEqual(ribbons.strands[0].head, head, 'invalid deltas cannot corrupt history')
queen.position.x += 10
ribbons.update(1 / 60, true)
assert.ok(ribbons.strands[0].curve.points.every(point => point.distanceTo(ribbons.strands[0].head) < 0.001),
  'teleports cannot create a beam across the scene')

ribbons.options.quality = 'low'
ribbons.update(1 / 60, true)
assert.equal(ribbons.strands.filter(strand => strand.mesh.visible).length, 3)
assert.equal(ribbons.motes.geometry.drawRange.count, 15)
assert.ok(ribbons.strands[0].mesh.geometry.drawRange.count < 160 * 6)
ribbons.options.quality = 'high'
ribbons.update(1 / 60, true)
assert.equal(ribbons.strands.filter(strand => strand.mesh.visible).length, 5)
assert.equal(ribbons.motes.geometry.drawRange.count, 60)

ribbons.reset()
assert.equal(ribbons.group.visible, false)
assert.ok(ribbons.strands.every(strand => !strand.initialized && !strand.mesh.visible))
assert.ok(ribbons.motes.geometry.attributes.opacity.array.every(value => value === 0))
ribbons.update(1 / 60, false)
assert.equal(ribbons.group.visible, false, 'reset stays dark while perched')
ribbons.update(1 / 60, true)
assert.ok(ribbons.strands[0].curve.points.every(point => point.distanceTo(ribbons.strands[0].head) < 0.001))

const invalid = new MagicalLightRibbons(queen, [], {
  count: 100, width: NaN, intensity: -1, trailLength: Infinity, colors: [], motionSpeed: -10,
})
invalid.update(1 / 60, true)
assert.equal(invalid.strands.length, 6)
assert.equal(invalid.options.width, RIBBON_DEFAULTS.width)
assert.equal(invalid.options.trailLength, RIBBON_DEFAULTS.trailLength)
assert.equal(invalid.options.intensity, 0)
assert.equal(invalid.options.motionSpeed, 0)
assert.ok(invalid.strands.slice(2).every(strand => !strand.mesh.visible))

let disposed = 0
for (const object of ribbons.group.children) {
  object.geometry.addEventListener('dispose', () => disposed++)
  object.material.addEventListener('dispose', () => disposed++)
}
const root = new THREE.Group()
root.add(ribbons.group)
ribbons.dispose()
assert.equal(disposed, 12, 'release every ribbon and dust GPU resource')
assert.equal(root.children.length, 0)
fast.ribbons.dispose()
invalid.dispose()
console.log('Ribbon checks passed: frame rates, history, buffer reuse, reset, teleports, quality, validation, disposal.')
