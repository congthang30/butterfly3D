import * as THREE from 'three'
import { XR8Promise } from '@8thwall/engine-binary'

export class ARSession {
  constructor() {
    this.engine = null
    this.running = false
    this.pipeline = null
    this.modules = []
  }

  /**
   * Checks camera permission capability.
   */
  async checkDeviceSupport() {
    this.engine = await this.loadXR8()
    return true
  }

  async loadXR8(timeoutMs = 15000) {
    if (window.XR8) return window.XR8
    let timeoutId
    try {
      return await Promise.race([
        XR8Promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('Timed out waiting for 8th Wall Engine (xr.js) to load.'))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  /**
   * Starts the 8th Wall camera pipeline with World Effects (SLAM)
   */
  async start(canvas, callbacks) {
    if (this.running) return 'started'

    await this.checkDeviceSupport()

    const xr = this.engine
    window.THREE = THREE

    // Configure 8th Wall World Tracking (SLAM)
    xr.XrController.configure({
      disableWorldTracking: false,
      enableWorldPoints: true,
      enableLighting: true,
      scale: 'absolute',
    })

    const extras = window.XRExtras
    const landingPage = window.LandingPage

    let lastFrameTime = 0
    this.pipeline = {
      name: 'butterfly-swarm-pipeline',
      onStart: ({ canvas: targetCanvas }) => {
        const xrScene = xr.Threejs.xrScene()
        const activeCanvas = targetCanvas || xrScene.renderer.domElement
        callbacks.onReady({
          scene: xrScene.scene,
          camera: xrScene.camera,
          renderer: xrScene.renderer,
          canvas: activeCanvas,
        })
        console.info('[Butterfly][AR] Three.js scene successfully attached to 8th Wall World Tracking')
      },
      onUpdate: ({ processCpuResult }) => {
        const now = performance.now()
        const delta = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0.016
        lastFrameTime = now
        callbacks.onFrame(delta, processCpuResult?.reality)
      },
      onCameraStatusChange: ({ status }) => {
        callbacks.onCameraStatus(status)
      },
      onException: (error) => {
        callbacks.onError(error)
      },
    }

    this.modules = [
      xr.GlTextureRenderer.pipelineModule(),
      xr.Threejs.pipelineModule(),
      xr.XrController.pipelineModule(),
      ...(landingPage ? [landingPage.pipelineModule()] : []),
      ...(extras ? [
        extras.FullWindowCanvas.pipelineModule(),
        extras.Loading.pipelineModule(),
        extras.RuntimeError.pipelineModule(),
      ] : []),
      this.pipeline,
    ]

    const direction = xr.XrConfig.camera().BACK

    try {
      xr.addCameraPipelineModules(this.modules)
      this.running = true
      xr.run({
        canvas,
        cameraConfig: { direction },
        allowedDevices: xr.XrConfig.device().ANY,
      })
      return 'started'
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop() {
    if (!this.running || !this.engine) return
    this.engine.stop()
    if (this.modules.length) {
      this.engine.removeCameraPipelineModules(this.modules.map((m) => m.name))
    }
    this.running = false
    this.pipeline = null
    this.modules = []
  }
}
