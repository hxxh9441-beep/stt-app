import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// ===== نسخ ملفات onnxruntime-web الخاصة بـ transformers.js إلى public/ort-stt/ =====
// transformers.js يجلب WASM من CDN افتراضياً؛ نسخها محلياً يضمن عمل وضع WASM
// بشكل أوفلاين مستقر. ملاحظة: لا ننسخ ort-wasm-simd-threaded.jsep.wasm (26MB —
// يتجاوز حد Cloudflare Pages البالغ 25MB لكل ملف)؛ وضع WebGPU يجلب الـ jsep من
// CDN عند الحاجة، ووضع WASM (المستهدف بالاستقرار الأوفلاين) لا يحتاجه إطلاقاً.
function copyTransformersWasm() {
  const srcBase = resolve('node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist')
  const outDir = resolve('public/ort-stt')
  mkdirSync(outDir, { recursive: true })
  // الزوج القياسي (Safari) + زوج asyncify (باقي المتصفحات — بلا SharedArrayBuffer)
  const files = [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
  ]
  for (const f of files) {
    try {
      copyFileSync(resolve(srcBase, f), resolve(outDir, f))
    } catch (e) {
      console.warn('[copyTransformersWasm] missing:', f, e?.message || '')
    }
  }
}
copyTransformersWasm()

// رؤوس مطلوبة لتفعيل WebGPU و SharedArrayBuffer داخل المتصفح
const secureHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // ===== PWA: عمل أوفلاين كامل بعد الزيارة الأولى =====
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa-180.png'],
      manifest: {
        name: 'صوت → نص | تحويل الكلام إلى نص محلي',
        short_name: 'صوت → نص',
        description: 'تحويل الكلام إلى نص — محلياً 100% على جهازك دون إنترنت.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        dir: 'rtl',
        lang: 'ar',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // precache خفيف: الأساسيات فقط (بدون WASM — تُخزَّن عند الطلب)
        globPatterns: ['**/*.{css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/ort-stt/**'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // ملفات التطبيق JS: تُخزَّن عند أول طلب — تُمكّن العمل أوفلاين تدريجياً
            urlPattern: ({ url }) =>
              url.origin === self.location.origin && /\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-files',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            // ملفات WASM تُمرَّر مباشرة (لا يعترضها SW — تبقى في HTTP cache)
            urlPattern: /\/ort-stt\/.*|huggingface\.co/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    headers: secureHeaders,
  },
  preview: {
    headers: secureHeaders,
  },
  build: {
    target: 'chrome110',
    sourcemap: false,
  },
})
