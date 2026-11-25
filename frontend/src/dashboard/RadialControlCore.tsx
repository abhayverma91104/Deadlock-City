import React from 'react'
import { Gauge, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { useSimulationStore } from '../stores/useSimulationStore'

export const RadialControlCore: React.FC = () => {
  const simState = useSimulationStore((s) => s.simState)
  const runtime = useSimulationStore((s) => s.runtime)
  const sessionId = useSimulationStore((s) => s.sessionId)
  const isMutating = useSimulationStore((s) => s.isMutating)
  const start = useSimulationStore((s) => s.start)
  const pause = useSimulationStore((s) => s.pause)
  const resume = useSimulationStore((s) => s.resume)
  const step = useSimulationStore((s) => s.step)
  const reset = useSimulationStore((s) => s.reset)
  const setSpeed = useSimulationStore((s) => s.setSpeed)

  const tick = simState?.tick ?? 0
  const disabled = !sessionId || isMutating

  // Ring progress derived from active processes' completed burst work
  const processes = simState?.processes ?? []
  const totalBurst = processes.reduce((acc, p) => acc + p.burst_time, 0)
  const remainingBurst = processes.reduce((acc, p) => acc + p.remaining_time, 0)
  const completionRatio = totalBurst > 0 ? (totalBurst - remainingBurst) / totalBurst : 0

  const radius = 44
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - completionRatio)

  const ringColor =
    simState?.safety_status === 'DEADLOCKED'
      ? '#ef4444'
      : simState?.safety_status === 'UNSAFE'
        ? '#f59e0b'
        : '#22d3ee'

  const cycleSpeed = () => {
    const speeds = [0.5, 1, 2, 4]
    const idx = speeds.indexOf(runtime.speed)
    const next = speeds[(idx + 1) % speeds.length] ?? 1
    void setSpeed(next)
  }

  return (
    <aside
      aria-label="Simulation control core"
      className="pointer-events-auto fixed right-4 bottom-20 z-20 hidden lg:flex flex-col items-center"
    >
      <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-[#2c3a69] bg-[#0b1023]/92 shadow-2xl backdrop-blur-md">
        {/* Progress Ring */}
        <svg
          aria-hidden="true"
          viewBox="0 0 104 104"
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
        >
          <circle
            cx="52"
            cy="52"
            r={radius}
            fill="none"
            stroke="#1b2447"
            strokeWidth="4"
          />
          <circle
            cx="52"
            cy="52"
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>

        {/* Center Readout */}
        <div className="flex flex-col items-center text-center">
          <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase">
            {runtime.is_running ? 'Running' : simState?.safety_status ?? 'Idle'}
          </span>
          <span className="font-mono-tabular text-lg font-bold text-slate-100 leading-tight">
            T:{tick}
          </span>
          <span className="font-mono-tabular text-[10px] text-cyan-300">
            {runtime.speed}x
          </span>
        </div>

        {/* Satellite Action Buttons */}
        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return
            if (runtime.is_running) {
              void pause()
            } else {
              void (tick > 0 ? resume() : start())
            }
          }}
          title={runtime.is_running ? 'Pause simulation' : tick > 0 ? 'Resume simulation' : 'Start simulation'}
          aria-label={runtime.is_running ? 'Pause simulation' : tick > 0 ? 'Resume simulation' : 'Start simulation'}
          className="absolute -top-2 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-400/70 bg-[#101836] text-cyan-200 shadow hover:bg-cyan-500/25"
        >
          {runtime.is_running ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>

        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) void step()
          }}
          title="Step +1 tick"
          aria-label="Step forward 1 tick"
          className="absolute top-1/2 -left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#2e3d70] bg-[#101836] text-slate-200 shadow hover:border-cyan-400 hover:text-cyan-200"
        >
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) void reset()
          }}
          title="Reset simulation"
          aria-label="Reset simulation"
          className="absolute -bottom-2 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-[#2e3d70] bg-[#101836] text-slate-200 shadow hover:border-cyan-400 hover:text-cyan-200"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={cycleSpeed}
          title="Cycle simulation speed (0.5x / 1x / 2x / 4x)"
          aria-label="Cycle simulation speed"
          className="absolute top-1/2 -right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#2e3d70] bg-[#101836] text-amber-300 shadow hover:border-amber-400"
        >
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}
