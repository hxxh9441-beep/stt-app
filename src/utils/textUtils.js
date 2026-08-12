// ===== أدوات النصوص =====

/** يقصّ النص إلى أجزاء بأقصى طول معيّن (يحترم حدود الجمل) */
export function chunkText(text, maxLen = 500) {
  const clean = text.trim()
  if (!clean) return []
  if (clean.length <= maxLen) return [clean]

  const parts = clean.split(/(?<=[.!?؟،])\s+/)
  const chunks = []
  let current = ''

  for (const part of parts) {
    if ((current + ' ' + part).trim().length > maxLen && current) {
      chunks.push(current.trim())
      current = part
    } else {
      current = (current + ' ' + part).trim()
    }
  }
  if (current) chunks.push(current.trim())
  return chunks
}

/** تنظيف النص قبل التوليد: إزالة الأسطر الفارغة الزائدة */
export function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** يفحص دعم الكلام في المتصفح */
export function isSpeechSupported() {
  return 'speechSynthesis' in window
}

/** يُرجع صوتاً عربياً/إنجليزياً مناسباً */
export function pickVoice(lang) {
  if (!isSpeechSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  const wanted = lang === 'ar' ? 'ar' : 'en'
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith(wanted) && v.localService) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(wanted)) ||
    null
  )
}

// ====== التحقق من النص وتقسيمه (TTS) ======

/** الحد الأقصى لطول نص التحويل إلى كلام */
export const MAX_TEXT_CHARS = 2000

/**
 * يتحقق من ألا يتجاوز النص 2000 حرف.
 * @returns {{ok: boolean, length: number, max: number, remaining: number}}
 */
export function validateText(text) {
  const length = (text || '').length
  return {
    ok: length <= MAX_TEXT_CHARS,
    length,
    max: MAX_TEXT_CHARS,
    remaining: Math.max(0, MAX_TEXT_CHARS - length),
  }
}

/**
 * يقسّم النص إلى شرائح (جمل) بناءً على الفواصل والنقاط [.؟!،\n]
 * مع الاحتفاظ بعلامات الترقيم نهاية كل شريحة وتجاهل الفراغات.
 * @returns {string[]} مصفوفة الجمل غير الفارغة
 */
export function splitSentences(text) {
  const clean = (text || '').trim()
  if (!clean) return []

  // تقسيم على الفواصل مع الاحتفاظ بها
  const parts = clean.match(/[^.!?؟،\n]+[.!?؟،]*/g) || []

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * يكشف لغة النص المدخل: عربية إذا غلبت الحروف العربية، وإلا إنجليزية.
 * @returns {'ar' | 'en'}
 */
export function detectLang(text) {
  const t = (text || '').trim()
  if (!t) return 'en'
  const arCount = (t.match(/[\u0600-\u06FF]/g) || []).length
  const enCount = (t.match(/[A-Za-z]/g) || []).length
  if (arCount === 0 && enCount === 0) return 'en'
  return arCount >= enCount ? 'ar' : 'en'
}

// ====== تصدير النصوص ======

/** تنسيق الثواني لصيغة SRT: 00:00:00,000 */
export function fmtSrtTime(sec) {
  const s = Math.max(0, Math.floor(sec))
  const ms = Math.floor((sec - s) * 1000)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${ss},${String(ms).padStart(3, '0')}`
}

/** يحوّل الشرائح إلى ملف SRT كامل */
export function toSRT(segments) {
  return segments
    .map((seg, i) => {
      const text = (seg.text || '').replace(/\n/g, ' ')
      if (!text) return ''
      return `${i + 1}\n${fmtSrtTime(seg.start)} --> ${fmtSrtTime(seg.end)}\n${text}\n`
    })
    .filter(Boolean)
    .join('\n')
}

/** ينزّل نصاً كملف على جهاز المستخدم */
export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
