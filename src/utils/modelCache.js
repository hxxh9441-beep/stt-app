// ====== إدارة كاش أوزان نموذج التعرف المحلي (Cache API) ======
// نسخة مخصصة لتطبيق STT فقط — تفحص نموذج Whisper المخزّن محلياً.

// أسماء كاشات النموذج
const WHISPER_CACHE = 'transformers-cache' // transformers.js v4
const WHISPER_CACHE_LEGACY = 'transformers-models' // إصدارات سابقة

const WHISPER_MODEL = 'whisper-small'

/**
 * يفحص الكاش المحلي ويعيد حالة أوزان النموذج.
 * @returns {Promise<{
 *   whisper: boolean,          // نموذج Whisper مخزّن؟
 *   piperAr: boolean,          // غير مستخدم في تطبيق STT (ثابت false)
 *   piperEn: boolean,          // غير مستخدم في تطبيق STT (ثابت false)
 *   totalMB: number,           // الحجم التقريبي الكلي (MB)
 *   anyCached: boolean,        // يوجد أي أوزان مخزنة؟
 * }>}
 */
export async function checkModelCache() {
  const result = {
    whisper: false,
    piperAr: false,
    piperEn: false,
    totalMB: 0,
    anyCached: false,
  }

  try {
    if (typeof caches === 'undefined') return result

    // ===== Whisper (transformers.js) =====
    for (const cacheName of [WHISPER_CACHE, WHISPER_CACHE_LEGACY]) {
      try {
        const cache = await caches.open(cacheName)
        const keys = await cache.keys()
        const whisperHits = keys.filter((k) => k.url.includes(WHISPER_MODEL))
        if (whisperHits.length > 0) {
          result.whisper = true
          for (const hit of whisperHits.slice(0, 20)) {
            result.totalMB += await estimateSize(cache, hit)
          }
          break
        }
      } catch {
        /* ignore */
      }
    }

    result.totalMB = Math.round(result.totalMB * 10) / 10
    result.anyCached = result.whisper || result.piperAr || result.piperEn
  } catch {
    /* ignore */
  }

  return result
}

/** تقدير حجم الملف المخزّن في الكاش (MB) */
async function estimateSize(cache, request) {
  try {
    const resp = await cache.match(request)
    if (!resp) return 0
    const len = resp.headers?.get('content-length')
    if (len) return Number(len) / 1048576
    const blob = await resp.clone().blob()
    return blob.size / 1048576
  } catch {
    return 0
  }
}

/**
 * يخزّن استجابة في كاش (Cache API) — تُستخدم في الـ workers.
 * @returns {Promise<Response>} الاستجابة نفسها
 */
export async function cacheFetch(url, cacheName, fetchImpl = fetch) {
  try {
    if (typeof caches === 'undefined') return fetchImpl(url)

    const cache = await caches.open(cacheName)
    const cached = await cache.match(url)
    if (cached) return cached

    const resp = await fetchImpl(url)
    if (resp && resp.ok) {
      try {
        await cache.put(url, resp.clone())
      } catch {
        /* تجاوز سعة الكاش — نتجاهل */
      }
    }
    return resp
  } catch {
    return fetchImpl(url)
  }
}
