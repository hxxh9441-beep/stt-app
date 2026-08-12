import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CloudOff, CloudCog, Database, Loader2, Wifi, WifiOff,
  RefreshCw, Info, CheckCircle2,
} from 'lucide-react'
import { checkModelCache } from '../utils/modelCache'
import {
  ENGINE_MODES, detectWebGPUSupport, resolveEngineMode, isEngineModeAvailable,
} from '../utils/engineCheck'
import { useToast } from './ToastContext'

/**
 * لوحة حالة الخدمة + محدد وضع التوليد:
 * 1) حالة الخدمة (متصلة/غير متاحة)
 * 2) حالة أوزان النماذج المحلية (محفوظة → عمل دون إنترنت)
 * 3) وضع التوليد (تلقائي / فائق WebGPU / قياسي WASM) — يُطبَّق على المحركين
 *    مع حماية: خيار WebGPU يُعطَّل (رمادي) إذا لم يدعمه الجهاز/الاستضافة.
 */
export default function EngineStatus({ engineMode, onEngineModeChange }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [models, setModels] = useState('checking') // checking | cached | pending
  const [gpu, setGpu] = useState(null) // null | { available, isolated, reason }
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false

    const checkService = () => {
      // دعم المعالجة المحلية متاح في كل المتصفحات الحديثة تقريباً
      const supported =
        typeof WebAssembly !== 'undefined' ||
        (typeof navigator !== 'undefined' && 'gpu' in navigator)
      return supported ? 'ready' : 'error'
    }

    const init = async () => {
      setStatus(checkService())
      // فحص الأوزان المخزنة (Whisper + Piper)
      try {
        const cache = await checkModelCache()
        if (!cancelled) setModels(cache.anyCached ? 'cached' : 'pending')
      } catch {
        if (!cancelled) setModels('pending')
      }
      // فحص دعم WebGPU (مرة واحدة — مخزَّن)
      try {
        const s = await detectWebGPUSupport()
        if (!cancelled) setGpu(s)
      } catch {
        if (!cancelled) setGpu({ available: false, reason: 'unknown' })
      }
    }
    init()

    return () => {
      cancelled = true
    }
  }, [])

  // الوضع الفعلي بعد الحسم مع دعم الجهاز (auto → webgpu/wasm)
  const resolved = resolveEngineMode(engineMode, gpu || { available: false })
  const gpuAvailable = gpu ? gpu.available : true // أثناء الفحص نفترض التوفر

  const handleModeChange = (mode) => {
    if (mode === engineMode) return
    if (!isEngineModeAvailable(mode, gpu || { available: false })) return
    setApplying(true)
    onEngineModeChange(mode)
    toast.info(
      t('engine.modeChanged', {
        mode:
          mode === ENGINE_MODES.WEBGPU
            ? t('engine.modeWebGPU')
            : mode === ENGINE_MODES.WASM
              ? t('engine.modeWasm')
              : t('engine.modeAuto'),
      }),
      { duration: 3500 },
    )
    // مهلة قصيرة لتحديث واجهة الأقسام ثم إعادة تمكين الزر
    setTimeout(() => setApplying(false), 600)
  }

  const serviceColor =
    status === 'ready' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : status === 'error' ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
        : 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'

  // ====== زر وضع التوليد ======
  const modeBtnCls = (active, disabled) =>
    `flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all active:scale-95 border ${
      active
        ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-100 shadow-inner'
        : disabled
          ? 'border-slate-800/60 bg-slate-900/30 text-slate-600 cursor-not-allowed'
          : 'border-slate-700/60 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
    }`

  const modes = [
    { id: ENGINE_MODES.AUTO, label: t('engine.modeAuto'), title: t('engine.modeAutoTitle'), disabled: false },
    { id: ENGINE_MODES.WEBGPU, label: t('engine.modeWebGPU'), title: gpuAvailable ? t('engine.modeWebGPUTitle') : t('engine.webgpuDisabledHint'), disabled: !gpuAvailable },
    { id: ENGINE_MODES.WASM, label: t('engine.modeWasm'), title: t('engine.modeWasmTitle'), disabled: false },
  ]

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {/* حالة الخدمة */}
        <div className={`glass rounded-2xl px-4 py-3 flex items-center gap-3 text-sm ${serviceColor}`}>
          {status === 'loading' && <Loader2 size={17} className="animate-spin" />}
          {status === 'ready' && <Wifi size={17} />}
          {status === 'error' && <WifiOff size={17} />}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-300 font-medium whitespace-nowrap">{t('engine.label')}</span>
            <span className="text-slate-500">·</span>
            <span className={status === 'ready' ? 'text-emerald-300' : 'text-rose-300'}>
              {status === 'loading' ? t('engine.loading') : status === 'ready' ? t('engine.ready') : t('engine.error')}
            </span>
          </div>
        </div>

        {/* حالة النماذج المحلية */}
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3 text-sm">
          {models === 'checking' ? (
            <Loader2 size={17} className="text-cyan-300 animate-spin" />
          ) : models === 'cached' ? (
            <Database size={17} className="text-emerald-400" />
          ) : (
            <CloudCog size={17} className="text-amber-300" />
          )}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-300 font-medium whitespace-nowrap">
              {models === 'checking' ? '...' : models === 'cached' ? t('engine.modelsCached') : t('engine.modelsPending')}
            </span>
            {models === 'pending' && <CloudOff size={14} className="text-slate-500 shrink-0" />}
          </div>
        </div>
      </div>

      {/* ===== محدد وضع التوليد (المحرك المزدوج) ===== */}
      <div className="glass rounded-2xl px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
            <RefreshCw size={13} className="text-cyan-300" />
            {t('engine.modeLabel')}
          </span>
          {/* الوضع الفعلي النشط */}
          <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 size={11} />
            {t('engine.modeActive')}: {resolved === 'webgpu' ? t('engine.modeActiveTurbo') : t('engine.modeActiveStandard')}
          </span>
        </div>

        {/* الأزرار الثلاثة */}
        <div className="flex gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              disabled={m.disabled || applying}
              title={m.title}
              className={modeBtnCls(engineMode === m.id, m.disabled)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* تلميح حالة الدعم */}
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Info size={11} className="shrink-0 text-slate-500" />
          {gpu === null ? (
            t('engine.modeChecking')
          ) : gpuAvailable ? (
            engineMode === ENGINE_MODES.WEBGPU
              ? t('engine.modeWebGPUHintActive')
              : engineMode === ENGINE_MODES.WASM
                ? t('engine.modeWasmHintActive')
                : t('engine.modeAutoHint', { mode: resolved === 'webgpu' ? t('engine.modeActiveTurbo') : t('engine.modeActiveStandard') })
          ) : (
            <span className="text-amber-300/80">{t('engine.webgpuDisabledHint')}</span>
          )}
        </p>
      </div>
    </div>
  )
}
