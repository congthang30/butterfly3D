import * as THREE from 'three'

// Override with new ButterflySwarm({ ribbons: { ... } }). Width is in scene units;
// trailLength is seconds of recorded flight, motionSpeed controls shimmer and drift.
export const RIBBON_DEFAULTS = Object.freeze({
  count: 5,
  width: 0.007,
  colors: Object.freeze(['#32dcff', '#3975ff', '#a17aff', '#edf6ff']),
  intensity: 1.5,
  trailLength: 8.5,
  motionSpeed: 0.7,
  quality: 'auto', // 'low' caps at 3 strands; 'high' keeps the requested count.
})

const MAX_SEGMENTS = 160
const SAMPLE_INTERVAL = 1 / 24
const bounded = (value, fallback, min, max) => Number.isFinite(value)
  ? THREE.MathUtils.clamp(value, min, max) : fallback

const ribbonVertex = /* glsl */`
  attribute vec3 tangent;
  uniform float uWidth;
  uniform float uPhase;
  uniform float uGlow;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 direction = mat3(modelViewMatrix) * tangent;
    // Project the tangent, including perspective, so orbiting never twists the strip.
    vec2 projected = direction.xy * (-view.z) + view.xy * direction.z;
    vec2 side = length(projected) > 0.00001
      ? normalize(vec2(-projected.y, projected.x)) : vec2(1.0, 0.0);
    float taper = pow(max(sin(uv.x * 3.14159265), 0.0), 0.65);
    float width = uWidth * uGlow * taper * (0.86 + 0.14 * sin(uv.x * 13.0 + uPhase));
    width *= length(modelMatrix[0].xyz);
    view.xy += side * (uv.y * 2.0 - 1.0) * width;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`

const ribbonFragment = /* glsl */`
  uniform vec3 uColor;
  uniform vec3 uPearl;
  uniform float uTime;
  uniform float uPhase;
  uniform float uIntensity;
  uniform float uOpacity;
  uniform float uGlints;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float across = abs(vUv.y * 2.0 - 1.0);
    float aa = max(fwidth(across), 0.001);
    float coreWidth = max(0.085, aa * 0.6);
    float core = exp(-pow(across / coreWidth, 2.0)) * (0.085 / coreWidth);
    float halo = exp(-across * across * 6.0) * (1.0 - smoothstep(0.55, 1.0, across));
    float taper = smoothstep(0.0, 0.045, vUv.x) * pow(1.0 - vUv.x, 0.45);
    taper *= 1.0 - smoothstep(0.78, 1.0, vUv.x);
    float breath = 0.83 + 0.17 * sin(vUv.x * 16.0 - uTime * 0.7 + uPhase);
    float travel = fract(uTime * 0.13 + uPhase * 0.17);
    float glint = exp(-pow((vUv.x - travel) / 0.018, 2.0));
    glint *= pow(max(sin(uTime * 0.55 + uPhase), 0.0), 8.0) * uGlints;
    float depthFade = 1.0 / (1.0 + vDepth * vDepth * 0.016);
    depthFade *= smoothstep(0.15, 0.5, vDepth);
    vec3 color = mix(uColor, uPearl, core * 0.4 + glint * 0.25);
    float alpha = (core * 1.15 + halo * 0.24 + glint * halo * 0.55);
    alpha *= taper * breath * depthFade * uOpacity * uIntensity;
    gl_FragColor = vec4(color, min(alpha, 0.85));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const moteVertex = /* glsl */`
  attribute float opacity;
  attribute float size;
  uniform float uViewportHeight;
  varying float vOpacity;
  varying float vGlint;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-view.z, 0.1);
    vOpacity = opacity * smoothstep(0.15, 0.5, depth) / (1.0 + depth * depth * 0.035);
    vGlint = smoothstep(0.034, 0.04, size);
    gl_PointSize = clamp(size * length(modelMatrix[0].xyz) * uViewportHeight
      * projectionMatrix[1][1] * 0.5 / depth, 1.0, 16.0);
    gl_Position = projectionMatrix * view;
  }
`

const moteFragment = /* glsl */`
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vOpacity;
  varying float vGlint;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float r2 = dot(p, p);
    float glow = exp(-r2 * 5.0) * (1.0 - smoothstep(0.4, 1.0, r2));
    glow += vGlint * 0.4 * (exp(-abs(p.x) * 28.0) + exp(-abs(p.y) * 28.0))
      * pow(max(1.0 - r2, 0.0), 2.0);
    gl_FragColor = vec4(uColor, glow * vOpacity * uIntensity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function ribbonGeometry() {
  const geometry = new THREE.BufferGeometry()
  for (const name of ['position', 'tangent']) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array((MAX_SEGMENTS + 1) * 6), 3)
      .setUsage(THREE.DynamicDrawUsage))
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((MAX_SEGMENTS + 1) * 4), 2))
  const indices = new Uint16Array(MAX_SEGMENTS * 6)
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const v = i * 2
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6)
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

export class MagicalLightRibbons {
  constructor(queen, followers, options = {}) {
    const quality = options.quality ?? RIBBON_DEFAULTS.quality
    this.options = {
      count: Math.round(bounded(options.count, RIBBON_DEFAULTS.count, 3, 6)),
      width: bounded(options.width, RIBBON_DEFAULTS.width, 0.001, 0.025),
      intensity: bounded(options.intensity, RIBBON_DEFAULTS.intensity, 0, 3),
      trailLength: bounded(options.trailLength, RIBBON_DEFAULTS.trailLength, 1, 15),
      motionSpeed: bounded(options.motionSpeed, RIBBON_DEFAULTS.motionSpeed, 0, 3),
      quality: ['low', 'high'].includes(quality) ? quality : 'auto',
    }
    const colors = Array.isArray(options.colors) && options.colors.length > 0
      && options.colors.every(color => /^#[\da-f]{6}$/i.test(color)
        || (Number.isInteger(color) && color >= 0 && color <= 0xffffff))
      ? options.colors.slice(0, 8) : RIBBON_DEFAULTS.colors
    this.colors = colors.map(color => new THREE.Color(color))
    this.group = new THREE.Group()
    this.group.name = 'MagicalLightRibbons'
    this.qualityQuery = globalThis.matchMedia?.('(max-width: 767px), (pointer: coarse)')
    this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.target = new THREE.Vector3()
    this.tangent = new THREE.Vector3()
    this.viewport = new THREE.Vector2()
    this.time = 0
    this.strands = []

    for (let i = 0; i < this.options.count; i++) {
      const primary = i < 2
      const follower = followers[Math.floor((i - 1.5) / (this.options.count - 2) * followers.length)]
      const duration = this.options.trailLength * (1 - i * 0.065)
      const history = Array.from({ length: Math.ceil(duration / SAMPLE_INTERVAL) + 2 }, () => new THREE.Vector3())
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.colors[i % this.colors.length] },
          uPearl: { value: new THREE.Color('#edf6ff') },
          uWidth: { value: this.options.width * (i === 0 ? 1 : primary ? 0.75 : 0.6) },
          uPhase: { value: i * 2.4 },
          uTime: { value: 0 },
          uGlow: { value: 4.5 },
          uIntensity: { value: this.options.intensity },
          uOpacity: { value: 0 },
          uGlints: { value: 1 },
        },
        vertexShader: ribbonVertex,
        fragmentShader: ribbonFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(ribbonGeometry(), material)
      mesh.name = primary ? `QueenRibbon_${i}` : `FlockRibbon_${i}`
      // Draw beneath the transparent wings; additive strands do not need sorting.
      mesh.renderOrder = -1
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.strands.push({
        mesh, follower: primary ? null : follower,
        source: primary ? queen : follower?.wrapper,
        primary, duration, history, index: 0, sampleTime: 0, age: 0, initialized: false,
        head: new THREE.Vector3(), previous: new THREE.Vector3(),
        offset: new THREE.Vector3(primary ? (i === 0 ? -0.025 : 0.035) : 0, -0.018, primary ? -0.15 : -0.05),
        curve: new THREE.CatmullRomCurve3(Array.from({ length: 40 }, () => new THREE.Vector3())),
        centers: Array.from({ length: MAX_SEGMENTS + 1 }, () => new THREE.Vector3()),
      })
    }

    const moteGeometry = new THREE.BufferGeometry()
    const moteCount = this.options.count * 12
    for (const [name, size] of [['position', 3], ['opacity', 1], ['size', 1]]) {
      moteGeometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(moteCount * size), size)
        .setUsage(THREE.DynamicDrawUsage))
    }
    this.motes = new THREE.Points(moteGeometry, new THREE.ShaderMaterial({
      uniforms: {
        uViewportHeight: { value: 1 },
        uColor: { value: new THREE.Color('#bdeaff') },
        uIntensity: { value: this.options.intensity },
      },
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    }))
    this.motes.name = 'RibbonStardust'
    this.motes.frustumCulled = false
    this.motes.renderOrder = -1
    this.motes.onBeforeRender = renderer => {
      renderer.getDrawingBufferSize(this.viewport)
      this.motes.material.uniforms.uViewportHeight.value = this.viewport.y
    }
    this.group.add(this.motes)
    this.lowQuality = null
    this.reset()
  }

  updateQuality() {
    const low = this.options.quality === 'low'
      || (this.options.quality === 'auto' && !!this.qualityQuery?.matches)
    if (low === this.lowQuality) return
    this.lowQuality = low
    this.segments = low ? 72 : MAX_SEGMENTS
    this.activeCount = low ? Math.min(3, this.options.count) : this.options.count
    this.motesPerStrand = low ? 5 : 12
    // ponytail: analytic glow in the strip; add bloom only if the whole scene needs it.
    for (let i = 0; i < this.strands.length; i++) {
      const strand = this.strands[i]
      strand.mesh.material.uniforms.uGlow.value = low ? 3.2 : 4.5
      const { geometry } = strand.mesh
      geometry.setDrawRange(0, this.segments * 6)
      for (let j = 0; j <= this.segments; j++) {
        geometry.attributes.uv.setXY(j * 2, j / this.segments, 0)
        geometry.attributes.uv.setXY(j * 2 + 1, j / this.segments, 1)
      }
      geometry.attributes.uv.needsUpdate = true
      if (i >= this.activeCount) {
        strand.mesh.visible = false
        strand.initialized = false
      }
    }
    this.motes.geometry.setDrawRange(0, this.activeCount * this.motesPerStrand)
  }

  reset() {
    this.time = 0
    this.group.visible = false
    for (const strand of this.strands) {
      strand.initialized = false
      strand.mesh.visible = false
    }
    this.motes.geometry.attributes.opacity.array.fill(0)
    this.motes.geometry.attributes.opacity.needsUpdate = true
  }

  sampleHistory(strand, age, target) {
    const { history, index, sampleTime, head } = strand
    if (age <= sampleTime && sampleTime > 0) {
      return target.lerpVectors(head, history[index], age / sampleTime)
    }
    const offset = Math.max(0, (age - sampleTime) / SAMPLE_INTERVAL)
    const back = Math.min(Math.floor(offset), history.length - 2)
    const a = (index - back + history.length) % history.length
    const b = (a - 1 + history.length) % history.length
    return target.lerpVectors(history[a], history[b], offset - back)
  }

  update(deltaSeconds, flying) {
    const dt = bounded(deltaSeconds, 0, 0, 0.05)
    if (!dt) return
    this.updateQuality()
    this.group.visible = flying
    if (!flying) return
    const motion = this.motionQuery?.matches ? 0 : this.options.motionSpeed
    this.time += dt * motion
    const moteAttributes = this.motes.geometry.attributes
    moteAttributes.opacity.array.fill(0)

    for (let i = 0; i < this.activeCount; i++) {
      const strand = this.strands[i]
      if (!strand.source || (strand.follower && !strand.follower.active)) {
        strand.mesh.visible = false
        strand.initialized = false
        continue
      }
      this.target.copy(strand.offset).applyQuaternion(strand.source.quaternion).add(strand.source.position)
      if (!strand.initialized || strand.head.distanceToSquared(this.target) > 0.64) {
        for (const point of strand.history) point.copy(this.target)
        strand.head.copy(this.target)
        strand.index = 0
        strand.sampleTime = 0
        strand.age = 0
        strand.initialized = true
      }
      strand.previous.copy(strand.head)
      strand.head.lerp(this.target, 1 - Math.exp(-(strand.primary ? 8 : 6) * dt))
      strand.age += dt
      strand.sampleTime += dt
      // Interpolate fixed-time samples so recording does not depend on render cadence.
      while (strand.sampleTime >= SAMPLE_INTERVAL) {
        strand.sampleTime -= SAMPLE_INTERVAL
        strand.index = (strand.index + 1) % strand.history.length
        strand.history[strand.index].lerpVectors(strand.previous, strand.head, 1 - strand.sampleTime / dt)
      }

      const span = Math.min(strand.duration, strand.age)
      const growth = THREE.MathUtils.smoothstep(strand.age, 0, 1.2)
      for (let j = 0; j < strand.curve.points.length; j++) {
        const u = j / (strand.curve.points.length - 1)
        const point = this.sampleHistory(strand, u * span, strand.curve.points[j])
        const phase = u * 7.5 + i * 2.4 - this.time * 0.32
        const weave = Math.sin(u * Math.PI) * growth * (strand.primary ? 0.1 : 0.055)
        point.x += Math.sin(phase) * weave * 0.5
        point.y += Math.cos(phase * 0.85) * weave
        point.z += Math.sin(phase + 0.8) * weave
      }
      const { geometry, material } = strand.mesh
      for (let j = 0; j <= this.segments; j++) {
        strand.curve.getPoint(j / this.segments, strand.centers[j])
      }
      for (let j = 0; j <= this.segments; j++) {
        const center = strand.centers[j]
        this.tangent.subVectors(strand.centers[Math.min(j + 1, this.segments)], strand.centers[Math.max(j - 1, 0)])
        for (let side = 0; side < 2; side++) {
          geometry.attributes.position.setXYZ(j * 2 + side, center.x, center.y, center.z)
          geometry.attributes.tangent.setXYZ(j * 2 + side, this.tangent.x, this.tangent.y, this.tangent.z)
        }
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.tangent.needsUpdate = true
      material.uniforms.uTime.value = this.time
      material.uniforms.uGlints.value = motion > 0 ? 1 : 0
      material.uniforms.uOpacity.value = growth * (i === 0 ? 1 : strand.primary ? 0.7 : 0.52)
      strand.mesh.visible = true

      for (let j = 0; j < this.motesPerStrand; j++) {
        const index = i * this.motesPerStrand + j
        const seed = j * 2.39996 + i * 1.73
        const dust = j % 3 === 0
        const glint = j === 1 && motion > 0
        const life = (j * 0.618034 + i * 0.17 + this.time * (dust ? 0.085 : 0.035)) % 1
        const u = dust ? 0.68 + life * 0.3 : 0.08 + life * 0.83
        strand.curve.getPoint(u, this.target)
        const drift = dust ? 0.012 + life * 0.09 : glint ? 0 : 0.008
        this.target.x += Math.sin(seed) * drift
        this.target.y += Math.cos(seed) * drift - (dust ? life * 0.025 : 0)
        this.target.z += Math.sin(seed * 1.7) * drift
        const twinkle = motion > 0 ? Math.pow(Math.max(0, Math.sin(this.time * (glint ? 0.65 : 1.2) + seed)), 6) : 0.45
        moteAttributes.position.setXYZ(index, this.target.x, this.target.y, this.target.z)
        moteAttributes.size.setX(index, (dust ? 0.018 : glint ? 0.055 : 0.026) * (strand.primary ? 1 : 0.75))
        moteAttributes.opacity.setX(index, growth * Math.pow(Math.sin(life * Math.PI), 2)
          * (dust ? 0.22 : glint ? twinkle : 0.25 + 0.65 * twinkle) * (strand.primary ? 1 : 0.65))
      }
    }
    moteAttributes.position.needsUpdate = true
    moteAttributes.opacity.needsUpdate = true
    moteAttributes.size.needsUpdate = true
  }

  dispose() {
    for (const strand of this.strands) {
      strand.mesh.geometry.dispose()
      strand.mesh.material.dispose()
    }
    this.motes.geometry.dispose()
    this.motes.material.dispose()
    this.group.removeFromParent()
    this.group.clear()
  }
}
