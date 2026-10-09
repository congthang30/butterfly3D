import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * Pre-allocated math objects to avoid per-frame allocations (zero GC stutter on mobile).
 */
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _desiredVel = new THREE.Vector3()
const _steerForce = new THREE.Vector3()
const _repelForce = new THREE.Vector3()
const _alignForce = new THREE.Vector3()
const _targetPos = new THREE.Vector3()
const _queenForward = new THREE.Vector3()
const _queenUp = new THREE.Vector3(0, 1, 0)
const _queenRight = new THREE.Vector3()
const _rotMatrix = new THREE.Matrix4()
const _targetQuat = new THREE.Quaternion()
const _upVec = new THREE.Vector3(0, 1, 0)

export class ButterflySwarm {
  constructor(options = {}) {
    this.followerCount = options.followerCount || 16
    this.root = new THREE.Group()
    this.root.name = 'ButterflySwarmRoot'

    // Flight parameters
    this.flightProgress = 0
    this.flightSpeed = 0.028 // Majestic, graceful glide speed along smooth spline
    this.isFlying = false
    this.cinematicTime = 0

    // Cinematic state: 'idle', 'takeoff', 'cruising', 'spread', 'leadAway'
    this.cinematicPhase = 'idle'
    this.spreadAmount = 1.0
    this.targetSpreadAmount = 1.0

    // Queen data
    this.queen = null
    this.queenMixer = null
    this.queenBasePath = new THREE.Vector3(0, 0, 0) // Smooth spline anchor (no jitter)
    this.queenPosition = new THREE.Vector3(0, 0, 0) // Visual position with organic undulation
    this.queenVelocity = new THREE.Vector3(0, 0, -1)
    this.queenQuaternion = new THREE.Quaternion()
    this.queenBank = 0 // Damped bank roll angle
    this.queenScale = 0.22 // Wingspan ~0.70m (prominent, majestic leader)

    // Followers data
    this.followers = []
    this.followerTemplate = null
    this.followerClip = null

    // Trail particles for Queen
    this.sparkleSystem = null

    // Smooth curved flight trajectory
    this.flightCurve = this.createFlightTrajectory()

    // Loading status
    this.isLoaded = false
    this.onLoadComplete = options.onLoadComplete || null
  }

  /**
   * Defines an ultra-smooth, looping 3D curved flight path (Catmull-Rom spline)
   * Carefully contoured to weave gracefully across the user's AR field of view.
   * Curvature is gradual and continuous, eliminating abrupt kinks and directional snaps.
   */
  createFlightTrajectory() {
    const points = [
      new THREE.Vector3( 0.00, 0.85, -1.25), // 0: Start / perch point (center-front, eye level)
      new THREE.Vector3( 0.55, 1.02, -1.55), // 1: Smooth launch curve climbing to right
      new THREE.Vector3( 1.15, 1.25, -2.05), // 2: Sweeping right ascending curve
      new THREE.Vector3( 1.45, 1.42, -2.70), // 3: High right outer apex
      new THREE.Vector3( 1.00, 1.55, -3.25), // 4: Cresting inward and back
      new THREE.Vector3( 0.05, 1.52, -3.20), // 5: High central crossover
      new THREE.Vector3(-0.95, 1.42, -2.75), // 6: Descending glide to left
      new THREE.Vector3(-1.40, 1.25, -2.10), // 7: Left outer banking turn
      new THREE.Vector3(-1.20, 1.00, -1.50), // 8: Gentle dip near left foreground
      new THREE.Vector3(-0.60, 0.90, -1.20), // 9: Low glide across front towards center
      new THREE.Vector3( 0.25, 1.05, -1.35), // 10: Ascending graceful weave
      new THREE.Vector3( 0.85, 1.25, -1.75), // 11: Mid-depth sweep
      new THREE.Vector3( 0.65, 1.42, -2.40), // 12: High turn back
      new THREE.Vector3(-0.40, 1.22, -2.15), // 13: Diagonal graceful glide
      new THREE.Vector3(-0.65, 0.98, -1.55), // 14: Returning curve
      new THREE.Vector3(-0.25, 0.86, -1.30), // 15: Aligning smoothly back to start
    ]
    return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
  }

  /**
   * Loads both GLTF models:
   * 1. Loads Queen model once
   * 2. Loads Ulysses model once, then clones it for all followers
   */
  async loadModels(onProgress) {
    const loader = new GLTFLoader()

    try {
      // 1. Load Queen GLB first
      if (onProgress) onProgress('Loading Queen Butterfly...')
      const queenGltf = await loader.loadAsync('/model/fantasy_butterfly_animation.glb')
      this.setupQueen(queenGltf)

      // 2. Load Ulysses GLB once
      if (onProgress) onProgress('Loading Ulysses Follower Butterfly...')
      const ulyssesGltf = await loader.loadAsync('/model/ulysses_butterfly.glb')
      this.followerTemplate = ulyssesGltf.scene
      this.followerClip = ulyssesGltf.animations[0] // 'fly' clip

      // 3. Clone followers from the single Ulysses model
      if (onProgress) onProgress('Spawning Butterfly Swarm...')
      this.spawnFollowers()

      // 4. Create magical fairy dust trail for the Queen
      this.setupQueenSparkleTrail()

      this.isLoaded = true
      if (this.onLoadComplete) this.onLoadComplete()
    } catch (error) {
      console.error('[ButterflySwarm] Error loading models:', error)
      throw error
    }
  }

  /**
   * Configures the Queen butterfly as the visually dominant leader.
   */
  setupQueen(gltf) {
    const queenModel = gltf.scene

    // Restore Queen's glowing fantasy neon aesthetics
    queenModel.traverse((node) => {
      if (node.isMesh && node.material) {
        node.castShadow = false
        node.receiveShadow = false
        const mat = node.material
        mat.side = THREE.DoubleSide
        mat.transparent = true
        mat.blending = THREE.AdditiveBlending
        mat.depthWrite = false
        mat.depthTest = true
        // Set base color to deep obsidian crystal tone so the rich neon emissive veins pop
        mat.color.setRGB(0.05, 0.07, 0.1)
        mat.emissive.set(0xffffff)
        mat.emissiveIntensity = 1.6
        mat.roughness = 0.25
        mat.metalness = 0.3
        mat.toneMapped = true
      }
    })

    // Container hierarchy:
    // queenWrapper holds the world position and orientation along flight path
    // The Queen model natively faces +Z (head is at +Z, tail at -Z).
    // In Three.js Object3D.lookAt, local +Z points towards target.
    // Therefore rotation.y is 0 so the Queen flies head-first!
    this.queenWrapper = new THREE.Group()
    this.queenWrapper.name = 'QueenWrapper'

    const queenInner = new THREE.Group()
    queenInner.name = 'QueenInner'
    queenInner.rotation.y = 0 // Natively faces +Z (head-first)
    queenInner.scale.setScalar(this.queenScale)
    queenInner.add(queenModel)

    this.queenWrapper.add(queenInner)
    this.root.add(this.queenWrapper)
    this.queen = this.queenWrapper

    // Setup Queen wing flap animation
    if (gltf.animations && gltf.animations.length > 0) {
      this.queenMixer = new THREE.AnimationMixer(queenModel)
      const action = this.queenMixer.clipAction(gltf.animations[0])
      action.timeScale = 1.15 // Majestic, graceful wing flaps
      action.play()
    }

    // Set initial position at start of curve
    this.flightCurve.getPointAt(0, this.queenBasePath)
    this.queenPosition.copy(this.queenBasePath)
    this.queenWrapper.position.copy(this.queenPosition)
  }

  /**
   * Spawns 10-20 Ulysses followers by cloning the single loaded GLB model.
   * Uses SkeletonUtils.clone to properly clone bones and skinning!
   */
  spawnFollowers() {
    if (!this.followerTemplate || !this.followerClip) return

    for (let i = 0; i < this.followerCount; i++) {
      // Deep clone bones and skin weights using SkeletonUtils.clone
      const clonedScene = SkeletonUtils.clone(this.followerTemplate)

      // Optimize meshes
      clonedScene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true
          node.receiveShadow = false
          if (node.material && !node.material.userData.cloned) {
            node.material = node.material.clone()
            node.material.userData.cloned = true
            node.material.side = THREE.DoubleSide
            node.material.transparent = true
            node.material.alphaTest = 0.35
            node.material.depthWrite = true
            const hueShift = (Math.random() - 0.5) * 0.08
            node.material.color.offsetHSL(hueShift, 0.05, (Math.random() - 0.5) * 0.06)
          }
        }
      })

      // Cloned wrapper for motion
      const wrapper = new THREE.Group()
      wrapper.name = `Follower_${i}`

      // Ulysses model natively faces -Z (head at -Z, tail at +Z).
      // Rotate by Math.PI around Y so its head points to +Z,
      // matching the Queen and Three.js forward direction!
      const followerInner = new THREE.Group()
      followerInner.name = `FollowerInner_${i}`
      followerInner.rotation.y = Math.PI // Flip so head points to +Z (head-first)
      followerInner.add(clonedScene)

      const baseScale = 0.062 + Math.random() * 0.016 // ~1/2 to 1/3 of Queen scale
      wrapper.scale.setScalar(0.0001) // Start invisible, smoothly scales up when emerging
      wrapper.add(followerInner)

      this.root.add(wrapper)

      // Dedicated mixer for independent wing flap phase and rate
      const mixer = new THREE.AnimationMixer(clonedScene)
      const action = mixer.clipAction(this.followerClip)
      action.timeScale = 1.9 + Math.random() * 0.7 // Natural varied flap speeds (1.9 - 2.6x)
      action.play()
      // Desynchronize initial wing flap phase
      mixer.setTime(Math.random() * this.followerClip.duration)

      // Organic follower trailing offsets in Queen's wake
      // Staggered in natural loose V-formation / cluster behind Queen
      const rank = (i / this.followerCount)
      const angle = rank * Math.PI * 2.8 + (i % 2 === 0 ? 0.3 : -0.3)
      const radius = 0.28 + rank * 0.35 + (Math.random() - 0.5) * 0.12
      const trailDist = 0.35 + rank * 1.15 + (Math.random() - 0.5) * 0.15

      this.followers.push({
        id: i,
        wrapper,
        followerInner,
        mixer,
        baseScale,
        currentScale: 0.0001,
        active: false,
        spawnDelay: 0.5 + i * 0.22, // Staggered spawn behind Queen
        position: new THREE.Vector3().copy(this.queenBasePath),
        velocity: new THREE.Vector3(0, 0, -0.6),
        bankAngle: 0,
        // Personalized trailing offset in Queen's local frame
        // x: lateral, y: elevation, z: distance behind Queen along forward vector
        localOffset: new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle * 1.5) * 0.22 + (Math.random() - 0.5) * 0.12,
          trailDist
        ),
        // Gentle personal harmonic wave properties (smooth undulating glide)
        floatFreq: 1.8 + Math.random() * 0.8,
        floatPhaseX: Math.random() * Math.PI * 2,
        floatPhaseY: Math.random() * Math.PI * 2,
        floatAmp: 0.035 + Math.random() * 0.02,
        // Individual flight dynamics
        maxSpeed: 1.8 + Math.random() * 0.5,
        maxForce: 4.2 + Math.random() * 1.0,
      })
    }
  }

  /**
   * Creates a sparkling fairy dust particle trail that follows the Queen's tail.
   */
  setupQueenSparkleTrail() {
    const particleCount = 80
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const opacities = new Float32Array(particleCount)

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 0] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      opacities[i] = 0
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1))

    // Soft glowing circle texture created procedurally
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0.0, 'rgba(255, 245, 210, 1.0)')
    gradient.addColorStop(0.3, 'rgba(255, 210, 120, 0.75)')
    gradient.addColorStop(0.7, 'rgba(210, 160, 255, 0.3)')
    gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)

    const material = new THREE.PointsMaterial({
      size: 0.075,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(0xffe8b8),
    })

    this.sparklePoints = new THREE.Points(geometry, material)
    this.root.add(this.sparklePoints)

    this.sparkleData = {
      history: Array.from({ length: particleCount }, () => ({
        pos: new THREE.Vector3(),
        life: 0,
        maxLife: 1.4 + Math.random() * 0.8,
      })),
      index: 0,
      spawnTimer: 0,
    }
  }

  /**
   * Starts the cinematic takeoff and flight sequence.
   */
  startCinematicFlight() {
    this.isFlying = true
    this.cinematicPhase = 'takeoff'
    this.cinematicTime = 0
    this.flightProgress = 0
    this.targetSpreadAmount = 1.0
    this.spreadAmount = 1.0
    this.lastSpreadTime = 0
    this.hasTriggeredFirstSpread = false
  }

  /**
   * Triggers the swarm to spread wider around the Queen,
   * then smoothly contract back.
   */
  triggerSpread(durationSec = 4.5) {
    this.targetSpreadAmount = 2.4
    clearTimeout(this._spreadResetTimer)
    this._spreadResetTimer = setTimeout(() => {
      this.targetSpreadAmount = 1.0
    }, durationSec * 1000)
  }

  /**
   * Resets the swarm back to the start/perch position.
   */
  reset() {
    this.isFlying = false
    this.cinematicPhase = 'idle'
    this.cinematicTime = 0
    this.flightProgress = 0
    this.spreadAmount = 1.0
    this.targetSpreadAmount = 1.0
    this.queenBank = 0
    this.lastSpreadTime = 0
    this.hasTriggeredFirstSpread = false
    clearTimeout(this._spreadResetTimer)

    // Reset Queen
    this.flightCurve.getPointAt(0, this.queenBasePath)
    this.queenPosition.copy(this.queenBasePath)
    this.flightCurve.getTangentAt(0, _queenForward).normalize()
    if (this.queenWrapper) {
      this.queenWrapper.position.copy(this.queenPosition)
      _targetPos.copy(this.queenPosition).add(_queenForward)
      _rotMatrix.lookAt(_targetPos, this.queenPosition, _upVec)
      this.queenWrapper.quaternion.setFromRotationMatrix(_rotMatrix)
      this.queenQuaternion.copy(this.queenWrapper.quaternion)
    }

    // Reset followers
    for (const f of this.followers) {
      f.active = false
      f.currentScale = 0.0001
      f.bankAngle = 0
      f.wrapper.scale.setScalar(0.0001)
      f.position.copy(this.queenBasePath)
      f.velocity.copy(_queenForward).multiplyScalar(0.4)
      f.wrapper.position.copy(this.queenBasePath)
    }
  }

  /**
   * Main per-frame update loop.
   * Zero per-frame object allocation for 60fps mobile WebAR smoothness.
   */
  update(deltaSeconds) {
    if (!this.isLoaded) return

    // Cap delta to prevent large step on tab switch / lag spike
    const dt = Math.min(deltaSeconds, 0.05)

    // 1. Update animations for Queen and Ulysses followers
    if (this.queenMixer) this.queenMixer.update(dt)
    for (let i = 0; i < this.followers.length; i++) {
      this.followers[i].mixer.update(dt)
    }

    // 2. Manage cinematic timeline phases
    this.updateCinematicPhases(dt)

    // 3. Update Queen position & flight dynamics
    this.updateQueen(dt)

    // 4. Update Ulysses followers flocking simulation
    this.updateFollowers(dt)

    // 5. Update Queen fairy dust sparkles
    this.updateSparkles(dt)
  }

  /**
   * Updates high-level cinematic story phases.
   */
  updateCinematicPhases(dt) {
    if (!this.isFlying) return

    this.cinematicTime += dt

    // Frame-rate independent smooth spread interpolation
    this.spreadAmount = THREE.MathUtils.damp(this.spreadAmount, this.targetSpreadAmount, 2.2, dt)

    // Automatic cinematic progression
    if (this.cinematicPhase === 'takeoff') {
      if (this.cinematicTime > 3.5) {
        this.cinematicPhase = 'cruising'
      }
    } else if (this.cinematicPhase === 'cruising' || this.cinematicPhase === 'leadAway') {
      // First automatic spread revelation right after takeoff stabilizes
      if (this.cinematicTime >= 5.5 && !this.hasTriggeredFirstSpread) {
        this.hasTriggeredFirstSpread = true
        this.lastSpreadTime = this.cinematicTime
        this.triggerSpread(4.5)
      }
      // Periodic automatic spread every 20-22 seconds
      else if (this.cinematicTime - this.lastSpreadTime > 20.0 && this.targetSpreadAmount === 1.0) {
        this.lastSpreadTime = this.cinematicTime
        this.triggerSpread(4.5)
      }

      // Transition to leadAway for a boost of speed, then back
      if (this.cinematicTime > 28.0 && this.cinematicPhase === 'cruising') {
        this.cinematicPhase = 'leadAway'
      } else if (this.cinematicTime > 40.0) {
        this.cinematicPhase = 'cruising'
      }
    }
  }

  /**
   * Updates Queen's flight path, orientation, banking, and organic glide.
   * Uses smooth spline progression with continuous Frenet-like orientation.
   */
  updateQueen(dt) {
    if (!this.queenWrapper) return

    if (this.isFlying) {
      // Speed modulation: gentle during takeoff, faster during leadAway
      let speedFactor = 1.0
      if (this.cinematicPhase === 'takeoff') {
        speedFactor = Math.min(this.cinematicTime / 3.5, 1.0) * 0.8
      } else if (this.cinematicPhase === 'leadAway') {
        speedFactor = 1.35
      }

      this.flightProgress = (this.flightProgress + this.flightSpeed * speedFactor * dt) % 1.0

      // Sample pure spline base anchor (completely smooth, zero jitter)
      this.flightCurve.getPointAt(this.flightProgress, this.queenBasePath)
      this.flightCurve.getTangentAt(this.flightProgress, _queenForward).normalize()

      // Queen velocity vector
      this.queenVelocity.copy(_queenForward).multiplyScalar(speedFactor * 1.6)

      // Calculate smooth banking roll from horizontal curve turn rate
      const lookDelta = 0.015
      const futureU = (this.flightProgress + lookDelta) % 1.0
      this.flightCurve.getTangentAt(futureU, _v1).normalize()
      const turnRate = (_v1.x * _queenForward.z - _v1.z * _queenForward.x) / lookDelta
      const targetBank = THREE.MathUtils.clamp(-turnRate * 0.42, -0.42, 0.42)
      this.queenBank = THREE.MathUtils.damp(this.queenBank, targetBank, 4.2, dt)

      // Base orientation along forward tangent
      _targetPos.copy(this.queenBasePath).add(_queenForward)
      _rotMatrix.lookAt(_targetPos, this.queenBasePath, _upVec)
      _targetQuat.setFromRotationMatrix(_rotMatrix)

      // Apply banking roll around local Z axis
      _rotMatrix.makeRotationZ(this.queenBank)
      _targetQuat.multiply(new THREE.Quaternion().setFromRotationMatrix(_rotMatrix))

      // Frame-rate independent smooth rotation slerp
      const slerpFactor = 1.0 - Math.exp(-6.5 * dt)
      this.queenWrapper.quaternion.slerp(_targetQuat, slerpFactor)
      this.queenQuaternion.copy(this.queenWrapper.quaternion)

      // Compute current local coordinate axes from orientation
      _queenForward.set(0, 0, 1).applyQuaternion(this.queenQuaternion)
      _queenUp.set(0, 1, 0).applyQuaternion(this.queenQuaternion)
      _queenRight.set(1, 0, 0).applyQuaternion(this.queenQuaternion)

      // Organic butterfly flight undulation (LOCAL to the butterfly's wing plane!)
      // Gentle vertical wave lift and subtle lateral drift synced to wing flaps
      const flapTime = this.cinematicTime * 3.6
      const liftWave = Math.sin(flapTime) * 0.026 + Math.sin(flapTime * 2.0) * 0.010
      const sideSway = Math.sin(flapTime * 0.65) * 0.016

      this.queenPosition.copy(this.queenBasePath)
      this.queenPosition.addScaledVector(_queenUp, liftWave)
      this.queenPosition.addScaledVector(_queenRight, sideSway)

      this.queenWrapper.position.copy(this.queenPosition)
    } else {
      // Idle resting/hovering motion
      const idleTime = performance.now() * 0.0015
      this.flightCurve.getPointAt(0, this.queenBasePath)
      this.queenPosition.copy(this.queenBasePath)
      this.queenPosition.y += Math.sin(idleTime * 2.2) * 0.025
      this.queenPosition.x += Math.sin(idleTime * 1.1) * 0.015

      this.flightCurve.getTangentAt(0, _queenForward).normalize()
      _targetPos.copy(this.queenPosition).add(_queenForward)
      _rotMatrix.lookAt(_targetPos, this.queenPosition, _upVec)
      _targetQuat.setFromRotationMatrix(_rotMatrix)
      this.queenWrapper.quaternion.slerp(_targetQuat, 0.1)
      this.queenQuaternion.copy(this.queenWrapper.quaternion)
      this.queenWrapper.position.copy(this.queenPosition)
      this.queenVelocity.set(0, 0, 0)
    }
  }

  /**
   * Updates all follower Ulysses butterflies using silky-smooth flocking:
   * - Followers track Queen's smooth base path (eliminating jitter transmission)
   * - Continuous soft quadratic separation (no cliff-edge twitching)
   * - Velocity alignment matching Queen's majestic heading
   * - Organic harmonic floating waves unique to each butterfly
   * - Frame-rate independent velocity integration and damped banking
   */
  updateFollowers(dt) {
    // Coordinate axes for trailing space (+Z is forward)
    _queenForward.set(0, 0, 1).applyQuaternion(this.queenQuaternion)
    _queenRight.set(1, 0, 0).applyQuaternion(this.queenQuaternion)
    _queenUp.set(0, 1, 0).applyQuaternion(this.queenQuaternion)

    const sepRadius = 0.28 // Soft separation distance threshold
    const sepRadiusSq = sepRadius * sepRadius

    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i]

      // Staggered emergence
      if (!f.active) {
        if (this.isFlying && this.cinematicTime >= f.spawnDelay) {
          f.active = true
          // Initial position smoothly trailing behind Queen
          f.position.copy(this.queenBasePath).addScaledVector(_queenForward, -0.45)
          f.velocity.copy(this.queenVelocity).multiplyScalar(0.7)
        } else {
          continue
        }
      }

      // Smooth scale-in animation when emerging
      if (f.currentScale < f.baseScale) {
        f.currentScale = THREE.MathUtils.damp(f.currentScale, f.baseScale, 3.2, dt)
        f.wrapper.scale.setScalar(f.currentScale)
      }

      _steerForce.set(0, 0, 0)

      // 1. Leader Pursuit (Tracking Queen's wake smoothly)
      const effectiveSpread = this.spreadAmount
      // Individual organic undulating wave (swaying naturally in air currents)
      const waveTime = this.cinematicTime * f.floatFreq
      const swayX = Math.sin(waveTime + f.floatPhaseX) * f.floatAmp
      const liftY = Math.sin(waveTime * 1.6 + f.floatPhaseY) * f.floatAmp * 0.9

      _targetPos.copy(this.queenBasePath)
      _targetPos.addScaledVector(_queenRight, f.localOffset.x * effectiveSpread + swayX)
      _targetPos.addScaledVector(_queenUp, f.localOffset.y * (1.0 + (effectiveSpread - 1.0) * 0.35) + liftY)
      _targetPos.addScaledVector(_queenForward, -f.localOffset.z)

      // Smooth arrival steering
      _desiredVel.subVectors(_targetPos, f.position)
      const distToTarget = _desiredVel.length()

      if (distToTarget > 0.001) {
        _desiredVel.normalize()
        // Smoothstep arrival curve: slow down gracefully within 0.6m
        const arrivalRatio = THREE.MathUtils.clamp(distToTarget / 0.65, 0.15, 1.15)
        _desiredVel.multiplyScalar(f.maxSpeed * arrivalRatio)
        // Smooth proportional pursuit force
        _steerForce.subVectors(_desiredVel, f.velocity).multiplyScalar(2.4)
      }

      // 2. Swarm Alignment Force (Harmonious flight matching Queen's velocity)
      _alignForce.subVectors(this.queenVelocity, f.velocity).multiplyScalar(0.85)
      _steerForce.add(_alignForce)

      // 3. Continuous Soft Separation (Zero twitching / no force jumps)
      _repelForce.set(0, 0, 0)
      for (let j = 0; j < this.followers.length; j++) {
        if (i === j) continue
        const other = this.followers[j]
        if (!other.active) continue

        _v1.subVectors(f.position, other.position)
        const distSq = _v1.lengthSq()

        if (distSq < sepRadiusSq && distSq > 0.0001) {
          const dist = Math.sqrt(distSq)
          // Smooth quadratic falloff: (1 - dist/sepRadius)^2 -> continuous derivative at boundary
          const falloff = (1.0 - dist / sepRadius)
          const forceMag = falloff * falloff * 2.6
          _v1.multiplyScalar(forceMag / dist)
          _repelForce.add(_v1)
        }
      }
      _steerForce.add(_repelForce)

      // Clamp max steering force
      if (_steerForce.length() > f.maxForce) {
        _steerForce.normalize().multiplyScalar(f.maxForce)
      }

      // 4. Integrate Velocity with Frame-Rate Independent Drag
      f.velocity.addScaledVector(_steerForce, dt)
      // Exponential drag decay: Math.exp(-dragCoeff * dt)
      const dragFactor = Math.exp(-1.5 * dt)
      f.velocity.multiplyScalar(dragFactor)

      // Clamp speed
      const speed = f.velocity.length()
      if (speed > f.maxSpeed) {
        f.velocity.multiplyScalar(f.maxSpeed / speed)
      }

      // Update position
      f.position.addScaledVector(f.velocity, dt)
      f.wrapper.position.copy(f.position)

      // 5. Smooth Heading and Banking Rotation
      if (speed > 0.06) {
        _v3.copy(f.position).add(f.velocity)
        _rotMatrix.lookAt(_v3, f.position, _upVec)
        _targetQuat.setFromRotationMatrix(_rotMatrix)

        // Realistic banking roll based on lateral turn (centripetal tilt)
        const latTurn = -f.velocity.x * 0.16
        f.bankAngle = THREE.MathUtils.damp(f.bankAngle, THREE.MathUtils.clamp(latTurn, -0.35, 0.35), 4.0, dt)
        _rotMatrix.makeRotationZ(f.bankAngle)
        _targetQuat.multiply(new THREE.Quaternion().setFromRotationMatrix(_rotMatrix))

        // Frame-rate independent rotation slerp
        const slerpFactor = 1.0 - Math.exp(-6.8 * dt)
        f.wrapper.quaternion.slerp(_targetQuat, slerpFactor)
      }
    }
  }

  /**
   * Updates Queen's magical fairy dust particle trail.
   */
  updateSparkles(dt) {
    if (!this.sparklePoints || !this.isFlying) return

    const { history } = this.sparkleData
    const positions = this.sparklePoints.geometry.attributes.position.array

    // Spawn new sparkles periodically at Queen's tail
    this.sparkleData.spawnTimer += dt
    if (this.sparkleData.spawnTimer > 0.045) {
      this.sparkleData.spawnTimer = 0
      const p = history[this.sparkleData.index]
      // Spawn at tail position (behind Queen in local coords)
      _queenForward.set(0, 0, 1).applyQuaternion(this.queenQuaternion)
      p.pos.copy(this.queenPosition).addScaledVector(_queenForward, -0.16)
      p.pos.x += (Math.random() - 0.5) * 0.05
      p.pos.y += (Math.random() - 0.5) * 0.03
      p.pos.z += (Math.random() - 0.5) * 0.05
      p.life = p.maxLife
      this.sparkleData.index = (this.sparkleData.index + 1) % history.length
    }

    // Update particle lifetimes and drift
    for (let i = 0; i < history.length; i++) {
      const p = history[i]
      if (p.life > 0) {
        p.life -= dt
        p.pos.y -= dt * 0.035 // gentle floating descent
        positions[i * 3 + 0] = p.pos.x
        positions[i * 3 + 1] = p.pos.y
        positions[i * 3 + 2] = p.pos.z
      } else {
        positions[i * 3 + 0] = 9999 // hide inactive particles
        positions[i * 3 + 1] = 9999
        positions[i * 3 + 2] = 9999
      }
    }

    this.sparklePoints.geometry.attributes.position.needsUpdate = true
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.queenMixer) this.queenMixer.stopAllAction()
    for (const f of this.followers) {
      f.mixer.stopAllAction()
    }
    if (this.sparklePoints) {
      this.sparklePoints.geometry.dispose()
      this.sparklePoints.material.dispose()
    }
    this.root.clear()
  }
}
