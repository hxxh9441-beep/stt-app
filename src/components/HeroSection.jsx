import { useTranslation } from 'react-i18next'
import { AudioLines, Mic, Sparkles, ShieldCheck } from 'lucide-react'

/**
 * قسم البطل (Hero) — نسخة STT فقط:
 * الشعار + عبارة تعريفية + زر واحد ينفّذ Smooth Scroll لقسم التفريغ.
 */
export default function HeroSection({ onNavigate }) {
  const { t } = useTranslation()

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onNavigate?.(id)
  }

  return (
    <section id="hero" className="min-h-[100svh] flex flex-col items-center justify-center text-center px-5 py-16">
      {/* الشعار */}
      <div className="relative mb-8">
        <div className="absolute inset-0 blur-3xl opacity-40 bg-gradient-to-tr from-indigo-500 via-cyan-400 to-emerald-400 rounded-full scale-150" />
        <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-500 via-indigo-400 to-cyan-400 flex items-center justify-center shadow-2xl shadow-indigo-500/40">
          <AudioLines size={44} className="text-white" strokeWidth={2.2} />
        </div>
        <span className="absolute -bottom-2 -end-2 w-9 h-9 rounded-2xl bg-cyan-400/90 flex items-center justify-center shadow-lg shadow-cyan-500/40">
          <Sparkles size={18} className="text-slate-900" />
        </span>
      </div>

      {/* شارة */}
      <span className="inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-full glass text-cyan-200 mb-5">
        <Sparkles size={13} />
        {t('hero.badge')}
      </span>

      {/* العنوان */}
      <h1 className="text-4xl sm:text-6xl font-black tracking-tight bg-gradient-to-br from-white via-slate-100 to-slate-400 bg-clip-text text-transparent mb-4">
        {t('hero.title')}
      </h1>

      {/* العبارة التعريفية */}
      <p className="max-w-xl text-slate-400 text-base sm:text-lg leading-relaxed mb-10">
        {t('hero.subtitle')}
      </p>

      {/* زر التفريغ الرئيسي */}
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <button
          onClick={() => scrollTo('stt-section')}
          className="group relative flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-bold text-base bg-gradient-to-r from-indigo-500 to-indigo-400 text-white shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          <Mic size={20} className="transition-transform group-hover:scale-110" />
          {t('hero.sttBtn')}
        </button>
      </div>

      {/* شارة الأمان */}
      <div className="mt-10 flex items-center gap-2 text-[12px] text-slate-500 max-w-md">
        <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
        <span className="leading-snug">{t('securityBadge')}</span>
      </div>
    </section>
  )
}
