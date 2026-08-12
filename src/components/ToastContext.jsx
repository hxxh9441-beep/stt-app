import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

/**
 * نظام إشعارات (Toast Notifications) خفيف بدون مكتبات خارجية:
 * - ToastProvider يغلّف التطبيق
 * - useToast() يعيد { success, error, warning, info, dismiss }
 * - إشعارات تظهر أسفل الشاشة (تتأقلم مع RTL/LTR) وتختفي تلقائياً
 */
const ToastContext = createContext(null)

const ICONS = {
  success: { Icon: CheckCircle2, cls: 'text-emerald-300', bar: 'bg-emerald-400' },
  error: { Icon: XCircle, cls: 'text-rose-300', bar: 'bg-rose-400' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-300', bar: 'bg-amber-400' },
  info: { Icon: Info, cls: 'text-cyan-300', bar: 'bg-cyan-400' },
}

let uid = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (type, message, opts = {}) => {
      const id = ++uid
      setToasts((prev) => [...prev.slice(-3), { id, type, message, duration: opts.duration ?? 3800 }])
      const timer = setTimeout(() => dismiss(id), opts.duration ?? 3800)
      timers.current.set(id, timer)
      return id
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      success: (msg, opts) => push('success', msg, opts),
      error: (msg, opts) => push('error', msg, opts),
      warning: (msg, opts) => push('warning', msg, opts),
      info: (msg, opts) => push('info', msg, opts),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* حاوية الإشعارات — أسفل الشاشة، منتصف على الجوال */}
      <div className="fixed bottom-4 inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((toast) => {
          const { Icon, cls, bar } = ICONS[toast.type] || ICONS.info
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-black/50 animate-toast-in"
            >
              {/* شريط لوني جانبي */}
              <span className={`absolute inset-y-0 start-0 w-1 ${bar}`} />
              <div className="flex items-center gap-3 py-3 ps-4 pe-3">
                <Icon size={18} className={`shrink-0 ${cls}`} />
                <p className="flex-1 text-[13px] font-semibold text-slate-200 leading-snug">{toast.message}</p>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}
