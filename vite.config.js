import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'

const createCameraProxy = () => {
  let activeProcess = null

  const stopActiveProcess = () => {
    if (activeProcess && !activeProcess.killed) {
      activeProcess.kill()
    }
    activeProcess = null
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

    stopActiveProcess()

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

    activeProcess = ffmpeg
    res.statusCode = 200
    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Connection', 'close')
    res.setHeader('Access-Control-Allow-Origin', '*')

    ffmpeg.stdout.pipe(res)

    const cleanup = () => {
      if (activeProcess === ffmpeg) {
        stopActiveProcess()
      } else if (!ffmpeg.killed) {
        ffmpeg.kill()
      }
    }

    req.on('close', cleanup)
    ffmpeg.on('error', () => {
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
