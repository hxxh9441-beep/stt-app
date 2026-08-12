import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Home, ShieldCheck, Languages, Database, CloudCog, Loader2 } from 'lucide-react'
import HeroSection from './components/HeroSection.jsx'
import STTSection from './components/STTSection.jsx'
import EngineStatus from './components/EngineStatus.jsx'
import { ToastProvider } from './components/ToastContext'
import { setLang } from './i18n'
import { checkModelCache } from './utils/modelCache'
import { getSavedEngineMode, saveEngineMode } from './utils/engineCheck'

/**
 * تطبيق تحويل الكلام إلى نص (STT Only) — Whisper عبر WebGPU/WASM:
 * Hero بملء الشاشة ← حالة المحرك ← قسم التفريغ مع Sticky Header.
 */
export default function App() {
  const { t, i18n } = useTranslation()
  const currentLang = i18n.language === 'ar' ? 'ar' : 'en'
  const toggleLangTo = (lang) => setLang(lang)
  const [showHeader, setShowHeader] = useState(false)
  const [active, setActive] = useState(null)
  const [cacheState, setCacheState] = useState('checking') // checking | cached | pending
  // وضع التوليد المختار (auto | webgpu | wasm) — يُحفظ محلياً
  const [engineMode, setEngineMode] = useState(getSavedEngineMode)

  const handleEngineModeChange = useCallback((mode) => {
    saveEngineMode(mode)
    setEngineMode(mode)
  }, [])

  // فحص الأوزان المخزنة عند فتح الموقع — تُحمَّل محلياً دون إنترنت إن وُجدت
  useEffect(() => {
    let cancelled = false
    checkModelCache().then((r) => {
      if (!cancelled) setCacheState(r.anyCached ? 'cached' : 'pending')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // إظهار الهيدر عند الخروج من الـ Hero
  useEffect(() => {
    const heroEl = document.getElementById('hero')
    if (!heroEl) return
    const obs = new IntersectionObserver(
      ([entry]) => setShowHeader(!entry.isIntersecting),
      { threshold: 0.15 }
    )
    obs.observe(heroEl)
    return () => obs.disconnect()
  }, [])

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }, [])

  const navBtnCls = (isActive) =>
    `flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 border ${
      isActive
        ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200'
        : 'border-slate-700/60 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
    }`

  return (
    <ToastProvider>
      <div className="min-h-screen">
      {/* ===== شارة الأمان أعلى الواجهة ===== */}
      <div className="fixed top-0 inset-x-0 z-50 bg-emerald-950/70 backdrop-blur-md border-b border-emerald-500/20">
        <p className="max-w-5xl mx-auto px-4 py-1.5 text-center text-[11px] sm:text-xs text-emerald-200/90 font-medium flex items-center justify-center gap-2">
          <ShieldCheck size={13} className="shrink-0 text-emerald-300" />
          <span>{t('securityBadge')}</span>
        </p>
        {/* شريط حالة النموذج المحلي */}
        <div
          className={`border-t px-4 py-1 text-center text-[10px] sm:text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            cacheState === 'cached'
              ? 'bg-cyan-950/40 border-cyan-500/10 text-cyan-200/90'
              : cacheState === 'pending'
                ? 'bg-amber-950/30 border-amber-500/10 text-amber-200/80'
                : 'bg-slate-950/40 border-slate-700/20 text-slate-400'
          }`}
        >
          {cacheState === 'checking' && <Loader2 size={11} className="animate-spin" />}
          {cacheState === 'cached' && <Database size={11} />}
          {cacheState === 'pending' && <CloudCog size={11} />}
          <span>
            {cacheState === 'checking'
              ? '...'
              : cacheState === 'cached'
                ? t('engine.modelsCached')
                : t('engine.modelsPending')}
          </span>
        </div>
      </div>

      {/* ===== Sticky Header (يظهر عند التمرير من الـ Hero) ===== */}
      <header
        className={`fixed top-[51px] inset-x-0 z-40 transition-all duration-300 ${
          showHeader ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <div className="glass rounded-2xl px-3 py-2 flex items-center justify-between gap-2 shadow-xl shadow-black/30">
            {/* زر الرئيسية */}
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' })
                setActive(null)
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-slate-300 hover:bg-slate-700/50 transition-colors"
              title={t('sticky.home')}
            >
              <Home size={17} />
              <span className="hidden sm:inline">{t('sticky.home')}</span>
            </button>

            {/* زر الخدمة */}
            <button
              onClick={() => scrollTo('stt-section')}
              className={navBtnCls(active === 'stt-section')}
            >
              <Mic size={16} />
              <span className="hidden sm:inline">{t('sticky.stt')}</span>
              <span className="sm:hidden">STT</span>
            </button>

            {/* تبديل اللغة — يدوي بين العربية والإنجليزية */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-700/60 bg-slate-800/50" title={t('lang.toggleTitle')}>
              <button
                onClick={() => toggleLangTo('ar')}
                className={`px-2.5 py-1.5 rounded-[10px] text-xs font-extrabold transition-all ${
                  currentLang === 'ar'
                    ? 'bg-cyan-500/20 text-cyan-200 shadow-inner'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                عربي
              </button>
              <button
                onClick={() => toggleLangTo('en')}
                className={`px-2.5 py-1.5 rounded-[10px] text-xs font-extrabold transition-all ${
                  currentLang === 'en'
                    ? 'bg-cyan-500/20 text-cyan-200 shadow-inner'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ===== المحتوى ===== */}
      <main className="pt-[51px]">
        <HeroSection onNavigate={setActive} />

        {/* حالة المحرك + اختيار وضع التوليد */}
        <div className="max-w-2xl mx-auto px-5">
          <EngineStatus engineMode={engineMode} onEngineModeChange={handleEngineModeChange} />
        </div>

        <STTSection engineMode={engineMode} />

        {/* الفوتر */}
        <footer className="px-5 pb-10 pt-4 text-center text-xs text-slate-600">
          🔒 Zero-Data — كل المعالجة تتم محلياً على جهازك
        </footer>
        </main>
      </div>
    </ToastProvider>
  )
}
