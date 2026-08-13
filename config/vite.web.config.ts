import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(__dirname, '..')

/** Build React UI as browser SPA (served by API server at /) */
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'src/renderer/src'),
      '@shared': resolve(root, 'src/shared')
    }
  },
  build: {
    outDir: resolve(root, 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: resolve(root, 'src/renderer/index.html'),
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('xlsx')) return 'xlsx-vendor'
          if (id.includes('react-dom') || /[/\\]react[/\\]/.test(id)) return 'react-vendor'
          if (id.includes('@ant-design') || /[/\\]antd[/\\]/.test(id)) return 'antd-vendor'
        }
      }
    }
  }
})
