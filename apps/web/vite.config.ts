import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:3001', ws: true },
      '/collaboration': { target: 'http://127.0.0.1:1234', ws: true, rewrite: (path) => path.replace(/^\/collaboration/, '') || '/' },
    },
  },
})
