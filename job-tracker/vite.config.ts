import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Job Sweep Tracker',
        short_name: 'JobTracker',
        theme_color: '#0066cc',
        background_color: '#f5f5f7',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})