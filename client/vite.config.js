import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // Lets a demo tunnel (loca.lt / trycloudflare.com / etc.) reach this dev
    // server - Vite blocks unrecognized Host headers by default.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
    },
  },
})
