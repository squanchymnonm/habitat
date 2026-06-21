import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// El build sale a ../web, que es lo que sirve el server Node (habitat/server/index.js).
// En dev, Vite sirve en :5173 y proxea el WS y /preview al backend en :8377.
export default defineConfig({
  plugins: [vue()],
  // assetsDir 'build' separa el bundle JS/CSS de los sprites en public/assets.
  build: { outDir: '../web', emptyOutDir: true, assetsDir: 'build' },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8377', ws: true },
      '/term': { target: 'ws://127.0.0.1:8377', ws: true },
    },
  },
})
