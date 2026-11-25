import React, { useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'

interface TracePlaybackControlsProps {
  totalSteps: number
  currentStep: number
  onStepChange: (nextStep: number) => void
  label: string
}

export const TracePlaybackControls: React.FC<TracePlaybackControlsProps> = ({
  totalSteps,
  currentStep,
  onStepChange,
  label,
}) => {
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(900)

  useEffect(() => {
    setPlaying(false)
  }, [totalSteps])

  useEffect(() => {
    if (!playing || totalSteps === 0) return
    if (currentStep >= totalSteps - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      onStepChange(Math.min(totalSteps - 1, currentStep + 1))
    }, speedMs)
    return () => window.clearTimeout(timer)
  }, [playing, currentStep, totalSteps, speedMs, onStepChange])

  const disabled = totalSteps === 0

  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5 border border-[#263259] bg-[#0a0f20] px-2.5 py-1.5 text-xs"
    >
      <button
        type="button"
        aria-disabled={disabled || currentStep <= 0}
        onClick={() => {
          if (!disabled && currentStep > 0) {
            setPlaying(false)
            onStepChange(currentStep - 1)
          }
        }}
        aria-label="Previous step"
        className="inline-flex min-h-7 items-center gap-1 border border-[#2a3866] bg-[#101733] px-2 text-[11px] text-slate-200 hover:border-cyan-400 aria-disabled:opacity-45"
      >
        <SkipBack className="h-3 w-3" aria-hidden="true" />
        Prev
      </button>

      <button
        type="button"
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (!playing && currentStep >= totalSteps - 1) {
            onStepChange(0)
          }
          setPlaying((p) => !p)
        }}
        aria-label={playing ? 'Pause trace' : 'Play trace'}
        className="inline-flex min-h-7 items-center gap-1 border border-cyan-400/60 bg-cyan-500/15 px-2.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 aria-disabled:opacity-45"
      >
        {playing ? (
          <>
            <Pause className="h-3 w-3" aria-hidden="true" />
            Pause
          </>
        ) : (
          <>
            <Play className="h-3 w-3" aria-hidden="true" />
            Play
          </>
        )}
      </button>

      <button
        type="button"
        aria-disabled={disabled || currentStep >= totalSteps - 1}
        onClick={() => {
          if (!disabled && currentStep < totalSteps - 1) {
            setPlaying(false)
            onStepChange(currentStep + 1)
          }
        }}
        aria-label="Next step"
        className="inline-flex min-h-7 items-center gap-1 border border-[#2a3866] bg-[#101733] px-2 text-[11px] text-slate-200 hover:border-cyan-400 aria-disabled:opacity-45"
      >
        Next
        <SkipForward className="h-3 w-3" aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setPlaying(false)
            onStepChange(0)
          }
        }}
        aria-label="Reset trace"
        className="inline-flex min-h-7 items-center gap-1 border border-[#2a3866] bg-[#101733] px-2 text-[11px] text-slate-300 hover:border-cyan-400 aria-disabled:opacity-45"
      >
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
        Reset
      </button>

      <div className="ml-1 flex items-center gap-1 border-l border-[#222d52] pl-2">
        {[
          { label: '0.5x', ms: 1600 },
          { label: '1x', ms: 900 },
          { label: '2x', ms: 450 },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-pressed={speedMs === opt.ms}
            onClick={() => setSpeedMs(opt.ms)}
            className={`min-h-6 border px-1.5 text-[10px] font-mono-tabular ${
              speedMs === opt.ms
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                : 'border-[#253159] bg-[#0d1328] text-slate-400'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <span className="ml-auto font-mono-tabular text-[11px] text-slate-300">
        Step {totalSteps > 0 ? currentStep + 1 : 0} / {totalSteps}
      </span>
    </div>
  )
}
