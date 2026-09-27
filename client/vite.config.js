import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

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
  const proxyOptions = { target: backend, changeOrigin: true, secure: true }

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
