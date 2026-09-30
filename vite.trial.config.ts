import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist-trial', emptyOutDir: true, rollupOptions: { input: 'trial.html' } },
})
