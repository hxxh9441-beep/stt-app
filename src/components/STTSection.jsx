import { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Mic, Square, Eraser, Copy, Check, Loader2, FileAudio, UploadCloud,
  FileText, Captions, Sparkles, AlertTriangle,
} from 'lucide-react'
import {
  initRecorder, recordBlob, decodeToPCM, splitPCM, validateAudioFile,
  MAX_SIZE_MB, MAX_DURATION_SEC,
} from '../utils/audioUtils'
import { toSRT, downloadText } from '../utils/textUtils'
import ProgressBar from './ProgressBar'
import { useToast } from './ToastContext'

// أسماء اللغات المعروفة لـ Whisper
const LANG_NAMES = {
  ar: 'العربية', en: 'English', fr: 'Français', es: 'Español',
  de: 'Deutsch', ru: 'Русский', tr: 'Türkçe', ur: 'اردو',
  hi: 'हिन्दी', zh: '中文', ja: '日本語', ko: '한국어',
}

/** رسم الشكل الموجي من عينات PCM على canvas */
function drawWaveform(canvas, samples) {
  if (!canvas || !samples?.length) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.max(1, Math.floor(w * dpr))
  canvas.height = Math.max(1, Math.floor(h * dpr))
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const mid = h / 2
  const step = Math.max(1, Math.floor(samples.length / w))
  const grad = ctx.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, '#6d7cff')
  grad.addColorStop(0.6, '#22d3ee')
  grad.addColorStop(1, '#34d399')
  ctx.strokeStyle = grad
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = 0; x < w; x++) {
    const start = x * step
    let min = 1, max = -1
    for (let i = start; i < start + step && i < samples.length; i++) {
      const v = samples[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = mid - Math.max(0.01, Math.abs(max)) * mid * 0.92
    const y2 = mid - Math.max(0.01, Math.abs(min)) * mid * 0.92
    ctx.moveTo(x, y1)
    ctx.lineTo(x, y2)
  }
  ctx.stroke()
}

/** محوّل بسيط: ثواني → mm:ss */
function fmtDur(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * قسم تحويل الكلام إلى نص (STT) — Whisper محلي:
 * تسجيل مباشر + رفع ملف (Drag & Drop) + Waveform + عارض نصوص + تصدير TXT/SRT.
 * @param {string} engineMode  وضع التوليد (auto | webgpu | wasm) — يُطبَّق على المحرك
 */
export default function STTSection({ engineMode = 'auto' }) {
  const { t } = useTranslation()
  const toast = useToast()

  // ====== الحالة ======
  const [engineStatus, setEngineStatus] = useState('loading') // loading | ready | error | transcribing
  const [engineMsg, setEngineMsg] = useState('')
  const [engineNotice, setEngineNotice] = useState('')
  const [dlProgress, setDlProgress] = useState(null) // { percent, file } — أول تنزيل فقط
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(null) // { index, total }
  const [result, setResult] = useState('')
  const [segments, setSegments] = useState([])
  const [detectedLang, setDetectedLang] = useState(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState(null)
  const [fileMeta, setFileMeta] = useState(null) // { sizeMb, durationSec }
  const [pcm, setPcm] = useState(null)

  // ====== مراجع ======
  const workerRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  // أحدث وضع توليد — للوصول إليه داخل معالج رسائل الـ worker
  const engineModeRef = useRef(engineMode)
  engineModeRef.current = engineMode

  // ====== تدشين الـ Worker عند التحميل ======
  useEffect(() => {
    let cancelled = false
    try {
      const worker = new Worker(new URL('../workers/sttWorker.js', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker
      setEngineMsg(t('stt.engineLoading'))

      worker.onmessage = (e) => {
        if (cancelled) return
        const { type, payload } = e.data || {}
        switch (type) {
          case 'status':
            if (payload === 'ready') {
              setEngineStatus('ready')
              setEngineMsg(t('stt.engineReady'))
            } else if (payload === 'initializing') {
              setEngineStatus('loading')
              setEngineMsg(t('stt.engineLoading'))
            } else if (payload === 'downloading') {
              setEngineStatus('loading')
              setEngineMsg(t('stt.engineDownloading'))
            } else if (payload === 'model-cached') {
              setEngineStatus('loading')
              setEngineMsg(t('stt.modelCached'))
            } else if (payload === 'transcribing') {
              setEngineStatus('transcribing')
              setEngineMsg(t('stt.transcribing'))
            } else if (payload === 'idle') {
              setEngineStatus('ready')
              setEngineMsg(t('stt.engineReady'))
            }
            // وضع التوافق (غير WebGPU) — رسالة ودّية بدل المصطلح التقني
            if (e.data?.device === 'wasm' && (payload === 'ready' || payload === 'idle')) {
              setEngineNotice(
                engineModeRef.current === 'wasm'
                  ? t('engine.modeStandardNotice')
                  : t('stt.engineNotice'),
              )
            } else if (e.data?.device === 'webgpu') {
              setEngineNotice('')
            }
            break
          case 'notice':
            // إشعارات ودّية (مفتاح ترجمة من الـ worker — تُترجم هنا)
            setEngineNotice(t(payload) === payload ? payload : t(payload))
            break
          case 'dl-progress':
            setDlProgress(payload)
            break
          case 'progress':
            setProgress(payload)
            break
          case 'result':
            setResult(payload?.text || '')
            setSegments(payload?.segments || [])
            if (payload?.language) setDetectedLang(LANG_NAMES[payload.language] || payload.language)
            setProcessing(false)
            setProgress(null)
            setDlProgress(null)
            break
          case 'error':
            setEngineStatus('error')
            setEngineMsg(t('stt.engineError'))
            setProcessing(false)
            setProgress(null)
            setDlProgress(null)
            setError(payload || t('stt.error'))
            toast.error(payload || t('stt.error'))
            break
          default:
            break
        }
      }

      worker.postMessage({ type: 'LOAD', payload: { mode: engineMode } })
    } catch {
      setEngineStatus('error')
      setEngineMsg(t('stt.engineError'))
    }

    return () => {
      cancelled = true
      workerRef.current?.postMessage?.({ type: 'UNLOAD' })
      workerRef.current?.terminate?.()
      workerRef.current = null
    }
  }, [t, toast])

  // ====== تطبيق تغيير وضع التوليد على المحرك (إعادة تهيئة عند اللزوم) ======
  useEffect(() => {
    workerRef.current?.postMessage?.({ type: 'SET_ENGINE_MODE', payload: { mode: engineMode } })
  }, [engineMode])

  // ====== رسم الـ Waveform عند توفر الصوت ======
  useEffect(() => {
    if (pcm && canvasRef.current) {
      drawWaveform(canvasRef.current, pcm.samples)
    }
  }, [pcm])

  // ====== إيقاف التسجيل ======
  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  // ====== معالجة Blob صوتي (من تسجيل أو ملف) ======
  const processAudio = useCallback(
    async (blob, name) => {
      setError('')
      setProcessing(true)
      setProgress(null)
      setDlProgress(null)
      setResult('')
      setSegments([])
      setDetectedLang(null)
      setFileName(name || null)
      try {
        // فك الترميز إلى 16kHz أحادي القناة
        const decoded = await decodeToPCM(blob)
        setPcm(decoded)
        setFileMeta({ sizeMb: Math.round((blob.size / 1048576) * 10) / 10, durationSec: Math.round(decoded.durationSec * 10) / 10 })

        // تقسيم إلى شرائح 30 ثانية
        const chunks = splitPCM(decoded.samples, decoded.sampleRate)
        if (!workerRef.current) throw new Error('no-worker')
        workerRef.current.postMessage({
          type: 'TRANSCRIBE',
          payload: { chunks, sampleRate: decoded.sampleRate },
        })
      } catch (e) {
        setError(e?.message || t('stt.error'))
        setProcessing(false)
      }
    },
    [t],
  )

  // ====== بدء/إيقاف التسجيل ======
  const handleRecord = useCallback(async () => {
    setError('')
    try {
      if (recording) {
        recorderRef.current?.stop()
        return
      }
      const { stream, mime } = await initRecorder()
      streamRef.current = stream
      const rec = recordBlob(stream, mime)
      recorderRef.current = rec
      setRecording(true)

      rec.blobPromise
        .then(async (blob) => {
          stopTracks()
          setRecording(false)
          await processAudio(blob, 'recording.webm')
        })
        .catch(() => {
          stopTracks()
          setRecording(false)
          setError(t('stt.error'))
        })
    } catch (e) {
      setError(t('stt.error'))
      stopTracks()
    }
  }, [recording, t, stopTracks, processAudio])

  // ====== معالجة ملف مرفوع ======
  const handleFile = useCallback(
    async (file) => {
      if (!file) return
      setDragOver(false)
      setError('')
      const check = await validateAudioFile(file)
      if (!check.ok) {
        if (check.error === 'audio.tooBig') {
          const msg = t('stt.audioTooBig', { maxMb: check.meta.maxMb, sizeMb: check.meta.sizeMb })
          setError(msg)
          toast.warning(msg, { duration: 5000 })
        } else if (check.error === 'audio.tooLong') {
          const msg = t('stt.audioTooLong', { maxSec: check.meta.maxSec, durationSec: check.meta.durationSec })
          setError(msg)
          toast.warning(msg, { duration: 5000 })
        } else {
          const msg = t('stt.audioInvalid')
          setError(msg)
          toast.error(msg)
        }
        return
      }
      await processAudio(file, file.name)
    },
    [t, processAudio],
  )

  // ====== النسخ ======
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      toast.success(t('stt.copied'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  // ====== التصدير ======
  const handleExportTxt = () => {
    downloadText('transcript.txt', result.trim())
    toast.success(t('toast.exported'))
  }
  const handleExportSrt = () => {
    downloadText('transcript.srt', toSRT(segments), 'application/x-subrip')
    toast.success(t('toast.exported'))
  }

  const busy = engineStatus === 'transcribing' || processing
  const engineColor =
    engineStatus === 'ready' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : engineStatus === 'error' ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
        : 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'

  const inputBtnCls = `flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border border-slate-700/60 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 disabled:opacity-40`

  return (
    <section id="stt-section" className="scroll-mt-24 px-5 py-14">
      <div className="max-w-2xl mx-auto">
        {/* العنوان */}
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <Mic size={19} className="text-indigo-300" />
          </span>
          <div>
            <h2 className="text-2xl font-extrabold">{t('stt.title')}</h2>
            <p className="text-sm text-slate-400">{t('stt.subtitle')}</p>
          </div>
        </div>

        {/* حالة المحرك */}
        <div className={`mt-4 flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-semibold ${engineColor}`}>
          {engineStatus === 'loading' && <Loader2 size={16} className="animate-spin" />}
          {engineStatus === 'ready' && <Sparkles size={16} />}
          {engineStatus === 'error' && <AlertTriangle size={16} />}
          <span className="flex-1">{engineMsg}</span>
          {engineStatus === 'ready' && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              {t('engine.label')} ✓
            </span>
          )}
        </div>
        {engineNotice && (
          <p className="mt-2 text-[11px] text-amber-300/80 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            {engineNotice}
          </p>
        )}

        <div className="glass rounded-3xl p-5 sm:p-6 mt-4">
          {/* ===== منطقة الإدخال: تسجيل + رفع ===== */}
          <div className="grid sm:grid-cols-2 gap-3">
            {/* التسجيل */}
            <button
              onClick={handleRecord}
              disabled={busy || engineStatus === 'loading'}
              className={`flex items-center justify-center gap-2.5 py-4 rounded-2xl font-extrabold text-base transition-all active:scale-[0.98] disabled:opacity-40 ${
                recording
                  ? 'bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-xl shadow-rose-500/30 animate-pulse'
                  : 'bg-gradient-to-r from-indigo-500 to-indigo-400 text-white shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50'
              }`}
            >
              {recording ? <Square size={19} /> : <Mic size={19} />}
              {recording ? t('stt.stop') : t('stt.record')}
            </button>

            {/* رفع ملف */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || engineStatus === 'loading'}
              className="flex items-center justify-center gap-2.5 py-4 rounded-2xl font-extrabold text-base border-2 border-dashed border-slate-600/70 text-slate-300 hover:border-indigo-400/70 hover:text-indigo-200 transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <UploadCloud size={19} />
              {t('stt.browse')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
          </div>

          {/* منطقة Drag & Drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              handleFile(e.dataTransfer.files?.[0])
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-3 rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-indigo-400/80 bg-indigo-500/10 scale-[1.01]'
                : 'border-slate-700/60 hover:border-slate-500/70'
            }`}
          >
            <UploadCloud size={26} className={`mx-auto mb-2 ${dragOver ? 'text-indigo-300' : 'text-slate-500'}`} />
            <p className="text-sm font-bold text-slate-200">{t('stt.dropTitle')}</p>
            <p className="text-[11px] text-slate-500 mt-1">{t('stt.dropHint')}</p>
          </div>

          {/* معلومات الملف الحالي */}
          {fileName && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 px-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <FileAudio size={13} className="text-indigo-300" />
                {fileName}
              </span>
              {fileMeta?.durationSec != null && (
                <span>{t('stt.durationLabel')}: {fmtDur(fileMeta.durationSec)}</span>
              )}
              {fileMeta?.sizeMb != null && (
                <span>{t('stt.sizeLabel')}: {fileMeta.sizeMb}MB</span>
              )}
              {detectedLang && (
                <span className="flex items-center gap-1.5">
                  <Sparkles size={12} className="text-cyan-300" />
                  {t('stt.languageLabel')}: {detectedLang}
                </span>
              )}
            </div>
          )}

          {/* الشكل الموجي */}
          {pcm && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                {t('stt.waveformLabel')}
              </p>
              <canvas ref={canvasRef} className="w-full h-24 rounded-xl bg-slate-950/50 border border-slate-800/80" />
            </div>
          )}

          {/* مؤشر نسبة تجهيز محرك التعرف — يظهر أثناء التنزيل حتى لو لم يكن هناك معالجة */}
          {engineStatus === 'loading' && dlProgress?.percent != null && (
            <div className="mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
              <ProgressBar
                percent={dlProgress.percent}
                label={t('stt.engineDownloading')}
                sublabel={dlProgress.file}
                color="indigo"
                size="sm"
              />
            </div>
          )}

          {/* شريط التقدم */}
          {busy && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm text-cyan-200 font-semibold">
                <Loader2 size={15} className="animate-spin" />
                {progress
                  ? t('stt.chunkProgress', { index: progress.index, total: progress.total })
                  : engineMsg}
              </div>

              {progress && (
                <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400 transition-all duration-300"
                    style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm text-rose-400 flex items-center gap-2">
              <AlertTriangle size={14} />
              {error}
            </p>
          )}

          {/* ===== النتيجة ===== */}
          {(result || segments.length > 0) && (
            <div className="mt-5">
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                placeholder={t('stt.resultPlaceholder')}
                rows={5}
                className="w-full resize-none rounded-2xl bg-slate-950/60 border border-slate-700/60 focus:border-indigo-400/60 outline-none p-4 text-slate-200 placeholder:text-slate-600 text-[15px] leading-relaxed transition-colors"
              />

              {/* الشرائح الزمنية */}
              {segments.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                    <Captions size={12} />
                    {t('stt.segmentsTitle')} · {segments.length}
                  </p>
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800/80 divide-y divide-slate-800/60">
                    {segments.map((seg, i) => (
                      <div key={i} className="flex gap-3 px-3 py-2 text-sm hover:bg-slate-800/40">
                        <span className="shrink-0 text-[11px] text-cyan-300/80 font-mono pt-0.5 tabular-nums">
                          {fmtDur(seg.start)}–{fmtDur(seg.end)}
                        </span>
                        <span className="text-slate-300 leading-snug">{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* أزرار الإجراءات */}
              <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
                <button onClick={() => setResult('')} disabled={!result} className={inputBtnCls}>
                  <Eraser size={15} />
                  {t('stt.clear')}
                </button>
                <button
                  onClick={handleCopy}
                  disabled={!result}
                  className={`${inputBtnCls} ${copied ? '!text-emerald-300 !border-emerald-500/50' : ''}`}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? t('stt.copied') : t('stt.copy')}
                </button>
                <button
                  onClick={handleExportTxt}
                  disabled={!result.trim()}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-700/70 text-slate-100 hover:bg-slate-600/70 transition-all active:scale-95 disabled:opacity-40"
                >
                  <FileText size={15} />
                  {t('stt.exportTxt')}
                </button>
                <button
                  onClick={handleExportSrt}
                  disabled={!segments.length}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-700/70 text-slate-100 hover:bg-slate-600/70 transition-all active:scale-95 disabled:opacity-40"
                >
                  <Captions size={15} />
                  {t('stt.exportSrt')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
