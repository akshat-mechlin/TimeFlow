import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Use environment variable for base path (for GitHub Pages)
  // Falls back to './' for local development
  base: process.env.VITE_BASE_PATH || './',
  server: {
    port: 5173,
    allowedHosts:['timeflow.mechlintech.com'],
  },
  build: {
    outDir: 'dist',
  },
})


