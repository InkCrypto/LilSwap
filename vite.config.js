import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => ({
  base: '/',
  publicDir: 'public_assets',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          ethers: ['ethers'],
          aave: ['@bgd-labs/aave-address-book'],
          vendor: ['axios', 'lucide-react', 'react', 'react-dom'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
}))