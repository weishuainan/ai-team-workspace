import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rawPublicPath = process.env.PUBLIC_PATH || '/'
const PUBLIC_PATH = rawPublicPath.endsWith('/') ? rawPublicPath : rawPublicPath + '/'

export default defineConfig({
  plugins: [react()],
  base: PUBLIC_PATH,
  build: {
    outDir: 'dist',
  },
})
