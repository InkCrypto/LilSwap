import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  publicDir: false,
  build: {
    outDir: 'public',
    assetsDir: 'build/assets',
    emptyOutDir: false,
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})