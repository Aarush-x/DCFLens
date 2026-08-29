import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API lives on Render, on a different origin. Proxying /api in dev means
// useAnalysis can call fetch(`/api/analyze/${ticker}`) as a same-origin path with
// no CORS handling and no host baked into the client. In production the same path
// needs an equivalent rewrite wherever web/ is deployed — see vercel.json, which
// is that rewrite. Both must name the same origin.
const API = process.env.DCFLENS_API || 'https://dcflens-api.onrender.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        /* Render's free tier cold-starts; the first call can take ~30s to wake
           the container before the analysis even begins. Held above the client's
           own 90s limit (useAnalysis.js TIMEOUT_MS) on purpose: if the proxy gave
           up first, dev would show a proxy error page where production shows the
           designed "not responding" state, and the two would disagree about what
           a slow request looks like. */
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
})
