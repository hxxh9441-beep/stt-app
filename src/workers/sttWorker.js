// ===== Worker تحويل الكلام إلى نص (STT) — Whisper عبر WebGPU/WASM =====
// يعمل في خيط منفصل حتى لا يتجمد الواجهة أثناء التحميل والمعالجة.
// النموذج يُخزَّن تلقائياً في Cache API (transformers-cache) — يُحمَّل محلياً بعد أول استخدام.
//
// وضع التوليد (يُرسله الواجهة):
//   webgpu → device:'webgpu' (EP webgpu+wasm) — أسرع
//   wasm   → device:'wasm' (EP wasm فقط) — ملفات WASM تُخدم محلياً (public/ort-stt) لأوفلاين مستقر
//   auto   → WebGPU إن توفر وإلا WASM
// عند تغيير الوضع أثناء عمل مهمة، يُطبَّق التغيير فور انتهائها.

import { pipeline, env } from '@huggingface/transformers'
import {
  resolveEngineMode, detectWebGPUSupport, isEngineMode, ENGINE_MODES,
} from '../utils/engineCheck.js'

let transcriber = null
let device = 'wasm'
let desiredMode = ENGINE_MODES.AUTO
let transcribing = false
let pendingReinit = false // تغيير الوضع أثناء عمل مهمة — يُطبَّق بعد الانتهاء

env.allowLocalModels = false
env.useBrowserCache = true // تخزين أوزان النموذج في Cache API — تشغيل دون إنترنت بعد أول مرة

// wasmPaths الافتراضي الذي حدده transformers.js (CDN) — نعيده لوضع WebGPU
// لأن وضع WebGPU يحتاج ملف ort-wasm-simd-threaded.jsep.wasm (26MB) الذي لا
// يمكن استضافته محلياً (حد Cloudflare Pages 25MB لكل ملف).
const CDN_WASM_PATHS = (() => {
  try {
    return env.backends?.onnx?.wasm?.wasmPaths
  } catch {
    return undefined
  }
})()

/** جذر التطبيق — يدعم النشر في مسار فرعي (مثل GitHub Pages) */
function appRoot() {
  try {
    const href = self.location?.href || ''
    const idx = href.indexOf('/assets/')
    if (idx > -1) return href.slice(0, idx + 1)
    return new URL('.', href).href
  } catch {
    return '/'
  }
}
const ROOT = appRoot()

// Safari يحتاج الزوج القياسي، باقي المتصفحات تستخدم asyncify (بلا SharedArrayBuffer)
const IS_SAFARI =
  typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '')

/** ضبط wasmPaths حسب وضع التوليد: WASM → محلي (أوفلاين) / WebGPU → CDN (jsep) */
function setWasmPaths(target) {
  try {
    if (target === 'wasm') {
      env.backends.onnx.wasm.wasmPaths = IS_SAFARI
        ? {
            mjs: `${ROOT}ort-stt/ort-wasm-simd-threaded.mjs`,
            wasm: `${ROOT}ort-stt/ort-wasm-simd-threaded.wasm`,
          }
        : {
            mjs: `${ROOT}ort-stt/ort-wasm-simd-threaded.asyncify.mjs`,
            wasm: `${ROOT}ort-stt/ort-wasm-simd-threaded.asyncify.wasm`,
          }
    } else if (CDN_WASM_PATHS) {
      env.backends.onnx.wasm.wasmPaths = CDN_WASM_PATHS
    }
  } catch {
    /* ignore */
  }
}

// تقرير نسبة تنزيل أوزان النموذج إلى الواجهة (أول استخدام فقط)
env.onProgress = (info) => {
  try {
    const pct = Math.round((info.loaded / info.total) * 100)
    postMessage({
      type: 'dl-progress',
      payload: { percent: Math.min(100, Math.max(0, pct)), file: info.file || info.name || '' },
    })
  } catch {
    /* ignore */
  }
}

const MODEL_ID = 'onnx-community/whisper-small'
const CHUNK_SEC = 30

/** فحص هل النموذج مخزّن محلياً مسبقاً */
async function isWhisperCached() {
  try {
    if (typeof caches === 'undefined') return false
    for (const cacheName of [env.cacheKey || 'transformers-cache', 'transformers-models']) {
      const cache = await caches.open(cacheName)
      const keys = await cache.keys()
      if (keys.some((k) => k.url.includes('whisper-small'))) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

// ====== تدشين النموذج حسب وضع التوليد: WebGPU أولاً مع fallback لـ WASM ======
// ملاحظة مهمة: dtype يختلف حسب الوضع —
//   webgpu → 'q8' (كمّية سريعة — تعمل على WebGPU)
//   wasm   → 'fp32' (أوزان غير مكممة — q8/int8 تفشل على WASM: خطأ ort
//            "TransposeDQWeightsForMatMulNBits Missing required scale" لأن
//            ملفات q8/int8 مكممة 4-bit عبر MatMulNBits، وهي غير مدعومة على
//            محرك WASM في onnxruntime-web). مع تعطيل التحسينات المعقدة
//            للرسم البياني (graphOptimizationLevel: 'basic') لضمان الاستقرار.
async function createTranscriber() {
  const support = await detectWebGPUSupport()
  const target = resolveEngineMode(desiredMode, support)
  setWasmPaths(target)

  if (target === 'webgpu') {
    try {
      postMessage({ type: 'status', payload: 'initializing', device: 'webgpu' })
      const p = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q8',
      })
      device = 'webgpu'
      return p
    } catch {
      postMessage({
        type: 'notice',
        payload: 'stt.fallbackNotice',
      })
      setWasmPaths('wasm')
    }
  }

  postMessage({ type: 'status', payload: 'initializing', device: 'wasm' })
  // وضع WASM: fp32 (بلا كمّية) لمنع خطأ MatMulNBits + إيقاف تحسينات الرسم
  // البياني المعقدة (graphOptimizationLevel: 'basic') التي تحاول نقل أوزان
  // DQ وتفشل على محرك WASM مع الأوزان المكممة.
  const p = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    session_options: {
      graphOptimizationLevel: 'basic',
    },
  })
  device = 'wasm'
  return p
}

/** إعادة تهيئة النموذج بعد تغيير وضع التوليد */
async function reinitTranscriber() {
  try {
    postMessage({ type: 'status', payload: 'initializing', device })
    transcriber = null
    transcriber = await createTranscriber()
    postMessage({ type: 'status', payload: 'ready', device })
  } catch (err) {
    postMessage({ type: 'error', payload: String(err?.message || err) })
  }
}

// ====== تنسيق الشرائح مع timestamps ======
function fmtSegments(chunks, offsetSec) {
  return (chunks || [])
    .map((c) => {
      const t = c?.timestamp || [0, 0]
      return {
        start: Math.round((offsetSec + (t[0] || 0)) * 10) / 10,
        end: Math.round((offsetSec + (t[1] || t[0] || 0)) * 10) / 10,
        text: (c?.text || '').trim(),
      }
    })
    .filter((s) => s.text)
}

self.onmessage = async (e) => {
  const { type, payload } = e.data || {}

  switch (type) {
    case 'LOAD': {
      desiredMode = isEngineMode(payload?.mode) ? payload.mode : ENGINE_MODES.AUTO
      postMessage({ type: 'status', payload: 'loading', device })
      try {
        // إعلام الواجهة: نموذج محفوظ محلياً أم سيُنزَّل لأول مرة
        const cached = await isWhisperCached()
        postMessage({ type: 'status', payload: cached ? 'model-cached' : 'downloading', device })
        transcriber = await createTranscriber()
        postMessage({ type: 'status', payload: 'ready', device })
      } catch (err) {
        postMessage({ type: 'error', payload: String(err?.message || err) })
      }
      break
    }

    case 'SET_ENGINE_MODE': {
      const mode = payload?.mode
      if (!isEngineMode(mode) || mode === desiredMode) break
      desiredMode = mode
      if (transcribing) {
        // يوجد عمل جارٍ — يُطبَّق الوضع الجديد فور اكتماله
        pendingReinit = true
        break
      }
      await reinitTranscriber()
      break
    }

    case 'TRANSCRIBE': {
      if (!transcriber) {
        postMessage({ type: 'error', payload: 'Engine not loaded' })
        return
      }
      const { chunks = [] } = payload || {}
      if (!chunks.length) {
        postMessage({ type: 'error', payload: 'No audio chunks' })
        return
      }

      transcribing = true
      postMessage({ type: 'status', payload: 'transcribing', device })

      const allText = []
      const allSegments = []
      let language = null

      try {
        for (let i = 0; i < chunks.length; i++) {
          postMessage({ type: 'progress', payload: { index: i + 1, total: chunks.length } })

          const output = await transcriber(chunks[i], {
            chunk_length_s: CHUNK_SEC,
            stride_length_s: 5,
            language: null, // Auto-Detect Language
            task: 'transcribe',
            return_timestamps: true,
          })

          if (output?.language) language = output.language
          const text = (output?.text || '').trim()
          if (text) allText.push(text)
          allSegments.push(...fmtSegments(output?.chunks, i * CHUNK_SEC))
        }

        postMessage({
          type: 'result',
          payload: { text: allText.join(' '), segments: allSegments, language },
        })
        postMessage({ type: 'status', payload: 'idle', device })
      } catch (err) {
        postMessage({ type: 'error', payload: String(err?.message || err) })
      } finally {
        transcribing = false
        // تطبيق وضع التوليد الجديد الذي طُلب أثناء العمل
        if (pendingReinit) {
          pendingReinit = false
          await reinitTranscriber()
        }
      }
      break
    }

    case 'UNLOAD': {
      transcriber = null
      transcribing = false
      pendingReinit = false
      postMessage({ type: 'status', payload: 'idle', device })
      break
    }

    default:
      postMessage({ type: 'error', payload: 'Unknown message type: ' + type })
  }
}
