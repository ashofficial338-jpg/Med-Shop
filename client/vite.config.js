import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import http from 'node:http'
import https from 'node:https'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // In dev the browser always calls same-origin "/api" and Vite forwards it
  // here. That way the app works from localhost AND from the Wi-Fi/LAN URL
  // (e.g. http://10.57.1.234:5173) without the backend's CORS list needing
  // to know that address. VITE_API_URL picks the backend (the live Render one
  // by default); without it, a local backend on :5000 is used.
  const backend = env.VITE_API_URL
    ? env.VITE_API_URL.replace(/\/api\/?$/, '')
    : 'http://localhost:5000'
  const proxyOptions = {
    target: backend,
    changeOrigin: true,
    secure: true,
    // Node 19+ reuses connections by default, but Render's load balancer closes
    // idle ones - reusing a closed socket fails with ECONNRESET. Open a fresh
    // connection per request instead.
    agent: backend.startsWith('https')
      ? new https.Agent({ keepAlive: false })
      : new http.Agent({ keepAlive: false }),
    // When the backend drops the connection (e.g. Render restarting after a
    // deploy), answer 502 with a readable message instead of an empty 500, so
    // the client knows it's transient and retries.
    configure: (proxy) => {
      proxy.on('error', (err, req, res) => {
        if (!res || !('writeHead' in res) || res.headersSent || res.writableEnded) return
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Server is restarting. Please try again in a moment.' }))
      })
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // Listen on all interfaces so other devices on the network can connect.
      host: true,
      port: 5173,
      // Lets a demo tunnel (loca.lt / trycloudflare.com / etc.) reach this dev
      // server - Vite blocks unrecognized Host headers by default.
      allowedHosts: true,
      proxy: {
        '/api': proxyOptions,
        '/uploads': proxyOptions,
      },
    },
  }
})
