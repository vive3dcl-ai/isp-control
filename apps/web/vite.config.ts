import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      // Portal cautivo en el origen del panel (dev)
      '^/[A-Za-z0-9_-]+/suspension/?$': {
        target: process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => {
          const m = path.match(/^\/([A-Za-z0-9_-]+)\/suspension\/?$/)
          return m
            ? `/api/public/suspension-portal/${m[1]}`
            : path
        },
      },
      '/api': {
        target: process.env.VITE_DEV_API_PROXY || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
