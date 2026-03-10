import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Reed API to avoid CORS issues in dev
      '/reed-api': {
        target: 'https://www.reed.co.uk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/reed-api/, ''),
      },
      // Proxy Adzuna API
      '/adzuna-api': {
        target: 'https://api.adzuna.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/adzuna-api/, ''),
      },
    },
  },
})
