import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'chrome110', minify: 'esbuild', sourcemap: false }
})
