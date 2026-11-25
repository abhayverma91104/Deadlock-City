import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

interface NativeDialogProps {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}

export const NativeDialog: React.FC<NativeDialogProps> = ({
  open,
  title,
  subtitle,
  onClose,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.showModal()
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    const handleClose = () => {
      dlg.returnValue = ''
      onClose()
    }
    dlg.addEventListener('close', handleClose)
    return () => dlg.removeEventListener('close', handleClose)
  }, [onClose])

  // Pointer-based outside-click dismissal fallback for browsers without closedby="any"
  const pointerDownOutsideRef = useRef(false)
  const isOutside = (e: React.PointerEvent<HTMLDialogElement>, dlg: HTMLDialogElement) => {
    const r = dlg.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onPointerDown={(e) => {
        if (dialogRef.current) {
          pointerDownOutsideRef.current = isOutside(e, dialogRef.current)
        }
      }}
      onPointerUp={(e) => {
        if (dialogRef.current && pointerDownOutsideRef.current && isOutside(e, dialogRef.current)) {
          dialogRef.current.close()
        }
        pointerDownOutsideRef.current = false
      }}
      className="m-auto w-full max-w-xl border border-[#2b3968] bg-[#0d1124]/95 p-0 text-slate-100 shadow-2xl backdrop:bg-slate-950/75"
    >
      <div className="flex items-start justify-between border-b border-[#243056] bg-[#131934] px-5 py-3.5">
        <div>
          <h1 id={titleId} className="font-display text-sm font-semibold tracking-wider text-cyan-300 uppercase">
            {title}
          </h1>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          className="inline-flex min-h-7 min-w-7 items-center justify-center border border-[#2c3a67] bg-[#0b1020] text-slate-300 transition-colors hover:border-cyan-400 hover:text-cyan-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}
