import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: string }
const appVersion = String(pkg.version || '0.0.0')

/** Build React UI as browser SPA (served by API server at /) */
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
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
