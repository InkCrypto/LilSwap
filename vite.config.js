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
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove all console.* calls in production
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          ethers: ['ethers'],
          aave: ['@bgd-labs/aave-address-book'],
          vendor: ['axios', 'lucide-react'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})