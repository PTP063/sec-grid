import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  server: {
    proxy: {
      '/hf-proxy-v2': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hf-proxy-v2/, '')
      }
    }
  },
  preview: {
    proxy: {
      '/hf-proxy-v2': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hf-proxy-v2/, '')
      }
    }
  },
  plugins: [
    basicSsl(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,proto,json}'],
        globIgnores: ['**/*.wasm'],
        maximumFileSizeToCacheInBytes: 10000000,
      },
      manifest: {
        name: 'Mesh·OS Tactical',
        short_name: 'Mesh·OS',
        description: 'Zero-infrastructure emergency mesh network with decentralized AI triage.',
        theme_color: '#050505',
        background_color: '#050505',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      }
    })
  ],
})
