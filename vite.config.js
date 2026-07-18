import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend dev server. The API + live SSE live in a standalone Node server
// (server/index.js); we proxy to it so the browser uses same-origin URLs.
const API_PORT = process.env.AGENTDECK_PORT || 47841
const target = `http://localhost:${API_PORT}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.AGENTDECK_WEB_PORT || 47842),
    // Fail loudly if the web port is taken instead of walking to a random high
    // port whose /api proxy then can't reach the backend. `predev` frees it first.
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      // SSE stream — must not buffer; http-proxy streams it through.
      '/events': { target, changeOrigin: true },
      // per-provider continue-a-session chat websockets (/chat/<provider>)
      '/chat': { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
})
