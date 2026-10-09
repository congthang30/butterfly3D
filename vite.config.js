import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// Sync 8th Wall engine and extras if needed
function ensureExternalAssets() {
  const targets = [
    { src: 'node_modules/@8thwall/engine-binary/dist', dest: 'public/external/xr' },
    { src: 'node_modules/@8thwall/xrextras/dist', dest: 'public/external/xrextras' },
    { src: 'node_modules/@8thwall/landing-page/dist', dest: 'public/external/landing-page' },
  ]
  for (const { src, dest } of targets) {
    const srcPath = path.resolve(process.cwd(), src)
    const destPath = path.resolve(process.cwd(), dest)
    if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true })
      fs.cpSync(srcPath, destPath, { recursive: true })
    }
  }
}

ensureExternalAssets()

export default defineConfig({
  assetsInclude: ['**/*.glb', '**/*.tflite', '**/*.wasm'],
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
  preview: {
    host: '0.0.0.0',
    port: 5175,
  },
  plugins: [
    {
      name: 'serve-binary-mime',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next()
          const cleanUrl = req.url.split('?')[0]
          if (cleanUrl.endsWith('.glb')) {
            res.setHeader('Content-Type', 'model/gltf-binary')
          } else if (cleanUrl.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm')
          } else if (cleanUrl.endsWith('.tflite')) {
            res.setHeader('Content-Type', 'application/octet-stream')
          }
          next()
        })
      },
    },
  ],
})
