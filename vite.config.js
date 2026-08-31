import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'

const createCameraProxy = () => {
  // Keyed by camera URL so unrelated viewers (different tabs, Live Monitor vs
  // Receiver Face Registration, etc.) don't kill each other's stream. Only a
  // second request for the SAME camera URL replaces the earlier process.
  const activeProcesses = new Map()

  const stopProcessFor = (cameraUrl) => {
    const process = activeProcesses.get(cameraUrl)
    if (process && !process.killed) {
      process.kill()
    }
    activeProcesses.delete(cameraUrl)
  }

  const handleRequest = (req, res, next) => {
    const requestUrl = new URL(req.url, 'http://localhost')

    if (requestUrl.pathname !== '/api/ip-camera/stream') {
      next()
      return
    }

    const cameraUrl = requestUrl.searchParams.get('url')

    if (!cameraUrl || !cameraUrl.startsWith('rtsp://')) {
      res.statusCode = 400
      res.end('A valid RTSP camera URL is required.')
      return
    }

    stopProcessFor(cameraUrl)

    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      'tcp',
      '-i',
      cameraUrl,
      '-an',
      '-vf',
      'fps=8,scale=960:-2',
      '-q:v',
      '5',
      '-f',
      'mpjpeg',
      '-boundary_tag',
      'frame',
      'pipe:1',
    ], {
      windowsHide: true,
    })

    activeProcesses.set(cameraUrl, ffmpeg)
    res.statusCode = 200
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Connection', 'close')
    res.setHeader('Access-Control-Allow-Origin', '*')

    ffmpeg.stderr.on('data', (chunk) => {
      console.error(`[rtsp-camera-proxy] ffmpeg: ${chunk}`)
    })

    ffmpeg.stdout.pipe(res)

    const cleanup = () => {
      if (activeProcesses.get(cameraUrl) === ffmpeg) {
        stopProcessFor(cameraUrl)
      } else if (!ffmpeg.killed) {
        ffmpeg.kill()
      }
    }

    req.on('close', cleanup)
    ffmpeg.on('error', (error) => {
      console.error('[rtsp-camera-proxy] Failed to start ffmpeg:', error.message)
      if (!res.writableEnded) {
        res.end()
      }
      cleanup()
    })
    ffmpeg.on('close', () => {
      if (!res.writableEnded) {
        res.end()
      }
      cleanup()
    })
  }

  return {
    name: 'rtsp-camera-proxy',
    configureServer(server) {
      server.middlewares.use(handleRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleRequest)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), createCameraProxy()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
})
