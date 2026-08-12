// ====== فحص المحرك واختيار وضع التوليد — مشترك بين الواجهة والـ Workers ======
// أوضاع التوليد الثلاثة:
//   auto   → تلقائي: يختار الأفضل حسب جهاز المستخدم (WebGPU إن توفر، وإلا WASM)
//   webgpu → فائق: معالج GPU (أسرع) مع fallback تلقائي لـ WASM عند الفشل
//   wasm   → قياسي: معالج WASM (يعمل على كل الأجهزة — أوفلاين بالكامل)
//
// ملاحظة: هذا الملف آمن للتشغيل داخل Web Worker (كل الوصول للبيئة محمي).

export const ENGINE_MODES = {
  AUTO: 'auto',
  WEBGPU: 'webgpu',
  WASM: 'wasm',
}

export const ENGINE_MODE_KEY = 'engine-mode'

/** هل القيمة وضع توليد صالح؟ (يقارن بالقيم الفعلية — لا بمفاتيح الكائن) */
export function isEngineMode(value) {
  return (
    value === ENGINE_MODES.AUTO ||
    value === ENGINE_MODES.WEBGPU ||
    value === ENGINE_MODES.WASM
  )
}

/** وضع التوليد المحفوظ (auto افتراضياً) */
export function getSavedEngineMode() {
  try {
    const v = localStorage.getItem(ENGINE_MODE_KEY)
    return isEngineMode(v) ? v : ENGINE_MODES.AUTO
  } catch {
    return ENGINE_MODES.AUTO
  }
}

/** حفظ وضع التوليد المختار */
export function saveEngineMode(mode) {
  try {
    localStorage.setItem(ENGINE_MODE_KEY, isEngineMode(mode) ? mode : ENGINE_MODES.AUTO)
  } catch {
    /* ignore */
  }
}

let gpuSupportCache = null

/**
 * فحص دعم WebGPU في المتصفح/البيئة (يُستدعى مرة واحدة — النتيجة مخزنة).
 * @returns {Promise<{ available: boolean, isolated: boolean, reason: string }>}
 */
export async function detectWebGPUSupport() {
  if (gpuSupportCache) return gpuSupportCache

  const result = { available: false, isolated: false, reason: '' }
  try {
    result.isolated = typeof self !== 'undefined' && self.crossOriginIsolated === true
  } catch {
    /* ignore */
  }

  try {
    // 1) هل واجهة WebGPU موجودة أصلاً؟
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      result.reason = 'no-api'
    } else {
      // 2) هل يوجد محول GPU فعلي متاح؟ (مع إعادة محاولة — بعض البيئات تتأخر في توفير المحول)
      let adapter = null
      let lastErr = null
      for (let attempt = 0; attempt < 3 && !adapter; attempt++) {
        try {
          adapter = await navigator.gpu.requestAdapter()
        } catch (e) {
          lastErr = e
        }
        if (!adapter && attempt < 2) {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      if (adapter) {
        result.available = true
        result.reason = 'ok'
      } else {
        result.reason = lastErr ? 'adapter-error' : 'no-adapter'
      }
    }
  } catch {
    result.reason = 'no-api'
  }

  gpuSupportCache = result
  return result
}

/**
 * حسم وضع التوليد الفعلي من التفضيل ودعم الجهاز.
 * @param {string} pref  'auto' | 'webgpu' | 'wasm'
 * @param {{ available: boolean }} support  نتيجة detectWebGPUSupport
 * @returns {'webgpu' | 'wasm'}
 */
export function resolveEngineMode(pref, support) {
  const mode = isEngineMode(pref) ? pref : ENGINE_MODES.AUTO
  if (mode === ENGINE_MODES.WASM) return 'wasm'
  const gpu = Boolean(support?.available)
  return gpu ? 'webgpu' : 'wasm'
}

/** هل وضع معيّن متاح على هذا الجهاز؟ (webgpu يُقيَّد بعدم توفر الدعم) */
export function isEngineModeAvailable(mode, support) {
  if (mode !== ENGINE_MODES.WEBGPU) return true
  return Boolean(support?.available)
}
