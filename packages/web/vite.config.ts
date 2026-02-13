import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy WebSocket connections to the relay server
      '/ws': {
        target: 'ws://localhost:8443',
        ws: true,
        changeOrigin: true,
      },
      // Proxy REST API calls to the relay server
      '/api': {
        target: 'http://localhost:8443',
        changeOrigin: true,
      },
    },
  },
})
