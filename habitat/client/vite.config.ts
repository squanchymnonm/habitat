import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../web', emptyOutDir: true, assetsDir: 'build' },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8377', ws: true },
      '/term': { target: 'ws://127.0.0.1:8377', ws: true },
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
