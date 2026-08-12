// ===== أدوات الصوت: تسجيل + تشغيل =====

/**
 * يطلب إذن الميكروفون ويُرجع MediaRecorder جاهزاً
 * مع دعم WebM/Opus مع fallback للتسجيل الأساسي
 */
export async function initRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  })

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : ''

  return { stream, mime }
}

/**
 * يبدأ التسجيل ويعيد كائناً:
 * { recorder, blobPromise, stop }
 * — blobPromise يُحلّ بـ Blob صوتي عند الإيقاف
 */
export function recordBlob(stream, mime) {
  const chunks = []
  let recorder
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch (e) {
    return {
      recorder: null,
      blobPromise: Promise.reject(e),
      stop() {},
    }
  }

  const blobPromise = new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime || 'audio/webm' }))
    recorder.onerror = (e) => reject(e)
    recorder.start(250)
  })

  return {
    recorder,
    blobPromise,
    stop() {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
  }
}

/**
 * يشغّل Blob صوتي داخل عنصر <audio> ويعيد وعداً عند الانتهاء/الإيقاف
 */
export function playBlob(blob, audioEl) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    audioEl.src = url
    audioEl.onended = () => {
      URL.revokeObjectURL(url)
      resolve('ended')
    }
    audioEl.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('error')
    }
    audioEl.play().catch(() => {
      URL.revokeObjectURL(url)
      resolve('error')
    })
  })
}

/** يحوّل Float32Array إلى Int16Array (PCM 16-bit) — لازم لنماذج Whisper */
export function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

/** يفكّ Blob صوتي إلى AudioBuffer (يُستخدم قبل إرساله للموديل) */
export async function decodeAudio(blob) {
  const arrayBuf = await blob.arrayBuffer()
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const buffer = await ctx.decodeAudioData(arrayBuf)
  return buffer
}

// ====== إعدادات معالجة Whisper ======
export const TARGET_SR = 16000 // Whisper يتطلب 16kHz
export const MAX_DURATION_SEC = 600 // 10 دقائق
export const MAX_SIZE_MB = 25
export const CHUNK_SEC = 30 // طول الشريحة

/**
 * تحقق سريع من ملف الصوت قبل المعالجة:
 * - الحجم ≤ 25MB
 * - المدة ≤ 10 دقائق
 * يعيد { ok: true } أو { ok: false, error }
 */
export async function validateAudioFile(file) {
  const sizeMb = file.size / (1024 * 1024)
  if (sizeMb > MAX_SIZE_MB) {
    return {
      ok: false,
      error: `audio.tooBig`,
      meta: { sizeMb: Math.round(sizeMb * 10) / 10, maxMb: MAX_SIZE_MB },
    }
  }

  try {
    const { durationSec } = await decodeToPCM(file)
    if (durationSec > MAX_DURATION_SEC) {
      return {
        ok: false,
        error: `audio.tooLong`,
        meta: { durationSec: Math.round(durationSec), maxSec: MAX_DURATION_SEC },
      }
    }
    return { ok: true, meta: { sizeMb: Math.round(sizeMb * 10) / 10, durationSec: Math.round(durationSec * 10) / 10 } }
  } catch {
    return { ok: false, error: 'audio.invalid' }
  }
}

/**
 * يفك ترميز أي Blob صوتي ويحوّله إلى:
 * Float32Array أحادي القناة بتردد 16kHz (جاهز لـ Whisper)
 */
export async function decodeToPCM(blob) {
  const arrayBuf = await blob.arrayBuffer()

  // فك الترميز الأولي
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  let buffer
  try {
    buffer = await ctx.decodeAudioData(arrayBuf)
  } finally {
    ctx.close().catch(() => {})
  }

  // إذا كان التردد 16kHz وأحادي القناة — استخدمه مباشرة
  if (buffer.sampleRate === TARGET_SR && buffer.numberOfChannels === 1) {
    return {
      samples: buffer.getChannelData(0),
      durationSec: buffer.duration,
      sampleRate: TARGET_SR,
    }
  }

  // إعادة أخذ العينات إلى 16kHz أحادي القناة عبر OfflineAudioContext
  const targetLen = Math.ceil(buffer.duration * TARGET_SR)
  const offline = new OfflineAudioContext(1, targetLen, TARGET_SR)
  const src = offline.createBufferSource()
  src.buffer = buffer
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()

  return {
    samples: rendered.getChannelData(0),
    durationSec: rendered.duration,
    sampleRate: TARGET_SR,
  }
}

/**
 * يقسّم عينات PCM إلى شرائح متساوية (افتراضياً 30 ثانية).
 * يعيد مصفوفة من Float32Array جاهزة للمعالجة.
 */
export function splitPCM(samples, sampleRate = TARGET_SR, chunkSec = CHUNK_SEC) {
  const perChunk = Math.floor(sampleRate * chunkSec)
  if (perChunk <= 0) return [samples]
  const chunks = []
  for (let i = 0; i < samples.length; i += perChunk) {
    chunks.push(samples.slice(i, Math.min(i + perChunk, samples.length)))
  }
  return chunks
}
