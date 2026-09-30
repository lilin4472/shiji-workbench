import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { rollupOptions: { input: { app: path.join(root, 'index.html'), license: path.join(root, 'license.html') } } },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**'] },
})
