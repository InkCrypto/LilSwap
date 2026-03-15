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
    chunkSizeWarningLimit: 1000,
    terserOptions: {
      compress: {
        drop_debugger: true,
      },
    },
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress "/*#__PURE__*/" annotation warnings from node_modules
        if (warning.code === 'INVALID_ANNOTATION' && warning.message.includes('/*#__PURE__*/')) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          'ethers-core': ['ethers'],
          'wallet-libs': ['@reown/appkit', '@reown/appkit-adapter-ethers'],
          'aave-discovery': ['@bgd-labs/aave-address-book'],
          'ui-vendor': ['lucide-react', 'react', 'react-dom'],
          axios: ['axios'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
}))