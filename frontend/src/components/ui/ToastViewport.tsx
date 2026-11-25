import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useSimulationStore } from '../../stores/useSimulationStore'

const SEVERITY_CONFIG = {
  info: {
    border: 'border-cyan-400/50',
    iconColor: 'text-cyan-300',
    Icon: Info,
  },
  success: {
    border: 'border-emerald-400/50',
    iconColor: 'text-emerald-300',
    Icon: CheckCircle2,
  },
  warning: {
    border: 'border-amber-400/60',
    iconColor: 'text-amber-300',
    Icon: AlertTriangle,
  },
  error: {
    border: 'border-rose-500/70',
    iconColor: 'text-rose-300',
    Icon: XCircle,
  },
} as const

export const ToastViewport: React.FC = () => {
  const toasts = useSimulationStore((s) => s.toasts)
  const dismissToast = useSimulationStore((s) => s.dismissToast)
  const activeTab = useSimulationStore((s) => s.activeTab)
  const visibleToasts = toasts.slice(-2)
  const posClass =
    activeTab === 'city' ? 'top-14 left-72' : 'bottom-24 right-6'

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className={`pointer-events-none fixed ${posClass} z-50 flex w-full max-w-xs flex-col gap-2`}
    >
      <AnimatePresence initial={false}>
        {visibleToasts.map((toast) => {
          const cfg = SEVERITY_CONFIG[toast.severity]
          const Icon = cfg.Icon
          return (
            <motion.div
              key={toast.id}
              role={toast.severity === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className={`hud-panel-elevated pointer-events-auto flex items-start gap-2.5 border ${cfg.border} px-3.5 py-2.5 text-xs`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconColor}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-display font-semibold tracking-wide text-slate-100 uppercase">
                  {toast.title}
                </p>
                <p className="mt-0.5 text-slate-300">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="inline-flex min-h-6 min-w-6 items-center justify-center text-slate-400 hover:text-slate-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
