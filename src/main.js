import * as THREE from 'three'
import './style.css'
import { ARSession } from './ar/arSession.js'
import { ButterflySwarm } from './swarm/ButterflySwarm.js'

window.THREE = THREE

// DOM Elements
const canvas = document.querySelector('#ar-canvas')
const welcomePanel = document.querySelector('#welcome-panel')
const startArButton = document.querySelector('#start-ar-btn')
const previewButton = document.querySelector('#preview-btn')
const modeToggleBtn = document.querySelector('#mode-toggle-btn')
const statusPill = document.querySelector('#status-pill')
const statusDot = document.querySelector('#status-dot')
const statusText = document.querySelector('#status-text')
const bottomControls = document.querySelector('#bottom-controls')
const takeoffBtn = document.querySelector('#takeoff-btn')
const spreadBtn = document.querySelector('#spread-btn')
const resetBtn = document.querySelector('#reset-btn')
const toastMsg = document.querySelector('#toast-msg')
const desktopNotice = document.querySelector('#desktop-notice')
const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// State
let arSession = null
let swarm = null
let activeScene = null
let activeCamera = null
let activeRenderer = null
let isDesktopMode = false
let isSessionStarted = false
let currentMode = 'none' // 'ar' or 'preview'

// Desktop Preview controls
let isDragging = false
let previousMousePosition = { x: 0, y: 0 }
let cameraRotation = { theta: 0, phi: 0.15 }
let cameraDistance = 2.4

function updateStatus(text, type = 'normal') {
  if (statusText) statusText.textContent = text
  if (statusDot) {
    statusDot.className = 'status-dot'
    if (type === 'active') statusDot.classList.add('active')
    else if (type === 'loading') statusDot.classList.add('loading')
  }
}

function showToast(text, durationMs = 3000) {
  if (!toastMsg) return
  toastMsg.textContent = text
  toastMsg.classList.remove('hidden')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    toastMsg.classList.add('hidden')
  }, durationMs)
}

/**
 * Creates common Three.js environment (lighting, ground shadow receiver)
 */
function setupEnvironment(scene) {
  // Ambient lighting for soft spatial illumination
  const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x223344, 0.6)
  hemiLight.position.set(0, 20, 0)
  scene.add(hemiLight)

  // Directional sun light for soft cast shadows
  const dirLight = new THREE.DirectionalLight(0xfffaed, 1.0)
  dirLight.position.set(2, 5, 3)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.width = 1024
  dirLight.shadow.mapSize.height = 1024
  dirLight.shadow.bias = -0.001
  scene.add(dirLight)

  // Secondary soft blue rim light for Ulysses iridescent wings
  const rimLight = new THREE.DirectionalLight(0x00d2ff, 0.7)
  rimLight.position.set(-3, 2, -2)
  scene.add(rimLight)
}

/**
 * Initializes desktop 3D preview mode when opened on desktop browsers.
 */
function setupDesktopPreview() {
  if (currentMode === 'preview') return
  currentMode = 'preview'
  isDesktopMode = true

  document.body.classList.remove('ar-mode')
  document.body.classList.add('preview-mode')
  if (statusPill) statusPill.classList.remove('fade-out')

  if (arSession && arSession.running) {
    arSession.stop()
  }

  if (welcomePanel) welcomePanel.classList.add('hidden')
  if (bottomControls) bottomControls.classList.remove('hidden')
  if (modeToggleBtn) {
    modeToggleBtn.classList.remove('hidden')
    modeToggleBtn.querySelector('span').textContent = '📷 Bật Camera AR'
  }

  activeScene = new THREE.Scene()
  activeScene.background = new THREE.Color(0x030914)

  activeCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
  updateDesktopCameraPosition()

  activeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  activeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  activeRenderer.setSize(window.innerWidth, window.innerHeight)
  activeRenderer.toneMapping = THREE.ACESFilmicToneMapping
  activeRenderer.toneMappingExposure = 1.0
  activeRenderer.shadowMap.enabled = true
  activeRenderer.shadowMap.type = THREE.PCFShadowMap

  setupEnvironment(activeScene)

  // Add subtle grid to give spatial ground reference in 3D preview
  const grid = new THREE.GridHelper(8, 16, 0x00d2ff, 0x223344)
  grid.position.y = -0.01
  grid.material.transparent = true
  grid.material.opacity = 0.12
  grid.material.depthWrite = false
  activeScene.add(grid)

  // Attach Swarm
  if (swarm) {
    swarm.dispose()
  }
  swarm = new ButterflySwarm({ followerCount: 16 })
  window.swarm = swarm
  activeScene.add(swarm.root)
  swarm.root.position.set(0, 0, 0)

  // Load models
  updateStatus('Loading Models...', 'loading')
  swarm.loadModels((msg) => {
    updateStatus(msg, 'loading')
  }).then(() => {
    updateStatus('3D Preview Active (16 Followers)', 'active')
    showToast('3D Preview Ready. Drag to rotate camera.')
    startDesktopAnimationLoop()
    swarm.startCinematicFlight()
  }).catch((err) => {
    console.error(err)
    updateStatus('Error Loading Models', 'normal')
  })

  // Desktop mouse / touch orbit controls
  setupDesktopOrbitControls()
  window.addEventListener('resize', onWindowResize)
}

function updateDesktopCameraPosition() {
  if (!activeCamera) return
  const x = cameraDistance * Math.cos(cameraRotation.phi) * Math.sin(cameraRotation.theta)
  const y = 1.05 + cameraDistance * Math.sin(cameraRotation.phi)
  const z = cameraDistance * Math.cos(cameraRotation.phi) * Math.cos(cameraRotation.theta)
  activeCamera.position.set(x, y, z)
  activeCamera.lookAt(0, 0.9, -1.2)
}

function setupDesktopOrbitControls() {
  const onPointerDown = (e) => {
    isDragging = true
    previousMousePosition = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e) => {
    if (!isDragging) return
    const deltaX = e.clientX - previousMousePosition.x
    const deltaY = e.clientY - previousMousePosition.y

    cameraRotation.theta -= deltaX * 0.006
    cameraRotation.phi = Math.max(-0.2, Math.min(1.2, cameraRotation.phi + deltaY * 0.006))

    previousMousePosition = { x: e.clientX, y: e.clientY }
    updateDesktopCameraPosition()
  }

  const onPointerUp = () => {
    isDragging = false
  }

  const onWheel = (e) => {
    cameraDistance = Math.max(1.0, Math.min(5.0, cameraDistance + e.deltaY * 0.002))
    updateDesktopCameraPosition()
  }

  canvas.addEventListener('mousedown', onPointerDown)
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }, { passive: true })

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isDragging) {
      const deltaX = e.touches[0].clientX - previousMousePosition.x
      const deltaY = e.touches[0].clientY - previousMousePosition.y

      cameraRotation.theta -= deltaX * 0.006
      cameraRotation.phi = Math.max(-0.2, Math.min(1.2, cameraRotation.phi + deltaY * 0.006))

      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      updateDesktopCameraPosition()
    }
  }, { passive: true })

  window.addEventListener('touchend', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: true })
}

let lastDesktopTime = 0
let animationFrameId = null
function startDesktopAnimationLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  function animate(now) {
    if (currentMode !== 'preview') return
    animationFrameId = requestAnimationFrame(animate)
    const dt = lastDesktopTime ? Math.min((now - lastDesktopTime) / 1000, 0.05) : 0.016
    lastDesktopTime = now

    if (swarm) swarm.update(dt)
    if (activeRenderer && activeScene && activeCamera) {
      activeRenderer.render(activeScene, activeCamera)
    }
  }
  animationFrameId = requestAnimationFrame(animate)
}

function onWindowResize() {
  if (isDesktopMode && activeCamera && activeRenderer) {
    activeCamera.aspect = window.innerWidth / window.innerHeight
    activeCamera.updateProjectionMatrix()
    activeRenderer.setSize(window.innerWidth, window.innerHeight)
  }
}

/**
 * Starts 8th Wall World Tracking AR camera experience with live camera video.
 * In camera environment, flight and spread are fully automated without bottom buttons.
 */
async function startARExperience() {
  if (currentMode === 'ar') return
  if (!isMobileDevice) {
    setupDesktopPreview()
    showToast('AR cần camera sau và thiết bị di động; đang mở 3D Preview.')
    return
  }
  currentMode = 'ar'
  isDesktopMode = false

  document.body.classList.add('ar-mode')
  document.body.classList.remove('preview-mode')

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  if (startArButton) {
    startArButton.disabled = true
    startArButton.textContent = 'Đang mở Camera...'
  }
  updateStatus('Đang mở Camera AR...', 'loading')
  if (statusPill) statusPill.classList.remove('fade-out')

  try {
    if (!arSession) arSession = new ARSession()

    if (welcomePanel) welcomePanel.classList.add('hidden')
    // Automatically remove/hide bottom buttons in camera AR environment!
    if (bottomControls) bottomControls.classList.add('hidden')
    if (modeToggleBtn) {
      modeToggleBtn.classList.remove('hidden')
      modeToggleBtn.querySelector('span').textContent = '🌐 3D Preview'
    }

    await arSession.start(canvas, {
      onReady: ({ scene, camera, renderer }) => {
        activeScene = scene
        activeCamera = camera
        activeRenderer = renderer

        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.0

        setupEnvironment(scene)

        if (swarm) swarm.dispose()
        swarm = new ButterflySwarm({ followerCount: 16 })
        window.swarm = swarm
        scene.add(swarm.root)

        // Position initial anchor in front of the camera in 3D world space
        const forward = new THREE.Vector3(0, 0, -1.8).applyQuaternion(camera.quaternion)
        swarm.root.position.copy(camera.position).add(forward)
        swarm.root.quaternion.copy(camera.quaternion)

        updateStatus('Đang tải mô hình...', 'loading')
        swarm.loadModels((msg) => {
          updateStatus(msg, 'loading')
        }).then(() => {
          updateStatus('Camera AR Sẵn Sàng (16 Followers)', 'active')
          // AUTOMATIC TAKEOFF & FLIGHT IN CAMERA ENVIRONMENT!
          swarm.startCinematicFlight()

          // Auto-hide status pill after 3.5 seconds so camera view is clean and unobstructed
          setTimeout(() => {
            if (currentMode === 'ar' && statusPill) {
              statusPill.classList.add('fade-out')
            }
          }, 3500)
        }).catch((err) => {
          console.error(err)
          updateStatus('Lỗi tải mô hình', 'normal')
        })
      },
      onFrame: (deltaSeconds) => {
        if (swarm) swarm.update(deltaSeconds)
      },
      onCameraStatus: (status) => {
        if (status === 'failed') {
          updateStatus('Camera bị từ chối', 'normal')
          showToast('Quyền truy cập Camera bị từ chối.')
          setupDesktopPreview()
        }
      },
      onError: (error) => {
        console.warn('[Butterfly][AR] Pipeline warning/error:', error)
      },
    })
  } catch (error) {
    console.error('[Butterfly][AR] Start failed:', error)
    showToast('Không thể mở Camera: ' + error.message)
    setupDesktopPreview()
  } finally {
    if (startArButton) {
      startArButton.disabled = false
      startArButton.innerHTML = '<span>📷 BẬT CAMERA AR</span><span aria-hidden="true">↗</span>'
    }
  }
}

// Button Events
if (startArButton) {
  startArButton.addEventListener('click', () => {
    startARExperience()
  })
}

if (previewButton) {
  previewButton.addEventListener('click', () => {
    setupDesktopPreview()
  })
}

if (modeToggleBtn) {
  modeToggleBtn.addEventListener('click', () => {
    if (currentMode === 'ar') {
      setupDesktopPreview()
    } else {
      startARExperience()
    }
  })
}

if (takeoffBtn) {
  takeoffBtn.addEventListener('click', () => {
    if (!swarm || !swarm.isLoaded) return
    swarm.startCinematicFlight()
    showToast('Queen takes off! Followers ascending...')
  })
}

if (spreadBtn) {
  spreadBtn.addEventListener('click', () => {
    if (!swarm || !swarm.isLoaded) return
    swarm.triggerSpread(4.0)
    showToast('Swarm spreading around the Queen!')
  })
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!swarm || !swarm.isLoaded) return
    swarm.reset()
    showToast('Swarm returned to perch.')
  })
}

// Interactive screen tap: tapping the screen in Camera AR triggers a blooming spread!
canvas.addEventListener('click', () => {
  if (currentMode === 'ar' && swarm && swarm.isLoaded && swarm.isFlying) {
    swarm.triggerSpread(4.5)
  }
})

// Auto-check on desktop: if user opens on desktop, show helpful note
if (window.XR8) {
  // xr.js already loaded
} else {
  window.addEventListener('xrloaded', () => {
    console.info('[Butterfly][AR] 8th Wall Engine loaded.')
  })
}

// If user does not click after a moment or wants direct preview on desktop
if (!isMobileDevice) {
  desktopNotice?.classList.remove('hidden')
}
