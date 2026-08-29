import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API lives on Render, on a different origin. Proxying /api in dev means
// useAnalysis can call fetch(`/api/analyze/${ticker}`) as a same-origin path with
// no CORS handling and no host baked into the client. In production the same path
// needs an equivalent rewrite wherever web/ is deployed.
const API = process.env.DCFLENS_API || 'https://dcflens-api.onrender.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        // Render's free tier cold-starts; the first call can take ~30s.
        timeout: 60000,
        proxyTimeout: 60000,
      },
    },
  },
})
