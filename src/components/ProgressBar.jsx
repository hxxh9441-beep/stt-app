import { Loader2 } from 'lucide-react'

/**
 * مؤشر تحميل برمجي احترافي — يُظهر نسبة تجهيز المحرك عند التشغيل الأول.
 * - mode="determinate": نسبة مئوية حقيقية مع شريط متدرج لامع
 * - mode="indeterminate": حركة تموّجية عندما لا تُعرف النسبة بدقة
 */
export default function ProgressBar({
  percent = 0,
  mode = 'determinate',
  label,
  sublabel,
  color = 'cyan', // cyan | indigo | emerald | amber
  size = 'md', // sm | md | lg
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))

  const colorMap = {
    cyan: {
      bar: 'from-cyan-400 to-teal-400',
      text: 'text-cyan-300',
      glow: 'shadow-cyan-500/40',
    },
    indigo: {
      bar: 'from-indigo-400 to-cyan-400',
      text: 'text-indigo-300',
      glow: 'shadow-indigo-500/40',
    },
    emerald: {
      bar: 'from-emerald-400 to-teal-400',
      text: 'text-emerald-300',
      glow: 'shadow-emerald-500/40',
    },
    amber: {
      bar: 'from-amber-400 to-orange-400',
      text: 'text-amber-300',
      glow: 'shadow-amber-500/40',
    },
  }
  const c = colorMap[color] || colorMap.cyan

  const sizeMap = {
    sm: { h: 'h-1.5', text: 'text-[10px]', gap: 'gap-1.5' },
    md: { h: 'h-2', text: 'text-xs', gap: 'gap-2' },
    lg: { h: 'h-2.5', text: 'text-sm', gap: 'gap-2.5' },
  }
  const s = sizeMap[size] || sizeMap.md

  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className={`flex items-center justify-between mb-1.5 ${s.gap}`}>
          <div className="flex items-center gap-2 min-w-0">
            {mode === 'indeterminate' && <Loader2 size={13} className={`animate-spin shrink-0 ${c.text}`} />}
            {label && (
              <span className={`font-bold ${s.text} ${c.text} truncate`}>{label}</span>
            )}
            {sublabel && <span className={`${s.text} text-slate-500 truncate`}>{sublabel}</span>}
          </div>
          {mode === 'determinate' && (
            <span className={`font-extrabold tabular-nums ${s.text} ${c.text} shrink-0`}>{pct}%</span>
          )}
        </div>
      )}

      <div className={`w-full ${s.h} rounded-full bg-slate-800/90 overflow-hidden relative`}>
        {mode === 'determinate' ? (
          <div
            className={`h-full rounded-full bg-gradient-to-r ${c.bar} transition-[width] duration-500 ease-out ${c.glow} shadow-lg`}
            style={{ width: `${pct}%` }}
          >
            {/* لمعة متحركة على حافة الشريط */}
            <div className="absolute inset-y-0 right-0 w-8 bg-white/25 blur-[3px] animate-pulse" />
          </div>
        ) : (
          <div className={`h-full w-1/3 rounded-full bg-gradient-to-r ${c.bar} animate-loading-slide`} />
        )}
      </div>
    </div>
  )
}
