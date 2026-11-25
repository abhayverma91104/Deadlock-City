import React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  Cpu,
  GitFork,
  Pause,
  Play,
  PlusSquare,
  RotateCcw,
  ShieldCheck,
  Siren,
  SkipForward,
  SlidersHorizontal,
  Square,
  Wrench,
} from 'lucide-react'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { NavTabId } from '../types/simulation'

interface BottomCommandDockProps {
  onOpenSessionDialog: () => void
}

interface NavModuleItem {
  id: NavTabId
  hotkey: string
  label: string
  phaseLock?: string
  Icon: LucideIcon
}

const NAV_MODULES: NavModuleItem[] = [
  { id: 'city', hotkey: '1', label: 'City', Icon: Building2 },
  { id: 'graph', hotkey: '2', label: 'RAG Graph', Icon: GitFork },
  { id: 'detection', hotkey: '3', label: 'Detection', Icon: Siren },
  { id: 'banker', hotkey: '4', label: "Banker's", Icon: ShieldCheck },
  { id: 'recovery', hotkey: '5', label: 'Recovery', Icon: Wrench },
  { id: 'processes', hotkey: '6', label: 'Processes', Icon: Activity },
  { id: 'scheduling', hotkey: '7', label: 'CPU Sched', Icon: Cpu },
  { id: 'sync', hotkey: '8', label: 'Sync Lab', Icon: Activity },
  { id: 'analytics', hotkey: '9', label: 'Analytics', Icon: BarChart3 },
  { id: 'docs', hotkey: '0', label: 'Docs', phaseLock: 'P9', Icon: BookOpen },
]

export const BottomCommandDock: React.FC<BottomCommandDockProps> = ({ onOpenSessionDialog }) => {
  const activeTab = useSimulationStore((s) => s.activeTab)
  const setActiveTab = useSimulationStore((s) => s.setActiveTab)
  const simState = useSimulationStore((s) => s.simState)
  const runtime = useSimulationStore((s) => s.runtime)
  const isMutating = useSimulationStore((s) => s.isMutating)
  const sessionId = useSimulationStore((s) => s.sessionId)
  const start = useSimulationStore((s) => s.start)
  const pause = useSimulationStore((s) => s.pause)
  const resume = useSimulationStore((s) => s.resume)
  const stop = useSimulationStore((s) => s.stop)
  const step = useSimulationStore((s) => s.step)
  const reset = useSimulationStore((s) => s.reset)
  const setSpeed = useSimulationStore((s) => s.setSpeed)

  const hasTicked = (simState?.tick ?? 0) > 0
  const controlsDisabled = !sessionId || isMutating

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-30 flex flex-col items-center gap-1.5 px-3">
      {/* Upper Contextual Action Toolbar */}
      <div
        role="toolbar"
        aria-label="Simulation lifecycle actions"
        className="hud-panel pointer-events-auto flex flex-wrap items-center gap-1.5 px-2.5 py-1.5"
      >
        <div role="group" aria-label="Session and presets" className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenSessionDialog}
            title="Create new simulation session or switch preset"
            aria-label="New session or preset"
            className="inline-flex min-h-8 min-w-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 text-[11px] font-medium text-cyan-200 transition-colors hover:border-cyan-400 hover:bg-cyan-500/15"
          >
            <PlusSquare className="h-3.5 w-3.5 text-cyan-300" aria-hidden={true} />
            <span className="hidden sm:inline">Session</span>
          </button>

          <button
            type="button"
            onClick={onOpenSessionDialog}
            title="Select experiment preset"
            aria-label="Select preset"
            className="inline-flex min-h-8 min-w-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-200"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-300" aria-hidden={true} />
            <span className="hidden sm:inline">Preset</span>
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="h-5 w-px bg-[#28335c]" />

        <div role="group" aria-label="Execution controls" className="flex items-center gap-1">
          {runtime.is_running ? (
            <button
              type="button"
              aria-disabled={controlsDisabled}
              onClick={() => {
                if (!controlsDisabled) void pause()
              }}
              title="Pause simulation"
              aria-label="Pause simulation"
              className="inline-flex min-h-8 min-w-8 items-center gap-1.5 border border-amber-400/60 bg-amber-500/15 px-2.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
            >
              <Pause className="h-3.5 w-3.5" aria-hidden={true} />
              <span>Pause</span>
            </button>
          ) : (
            <button
              type="button"
              aria-disabled={controlsDisabled}
              onClick={() => {
                if (!controlsDisabled) void (hasTicked ? resume() : start())
              }}
              title={hasTicked ? 'Resume simulation' : 'Start simulation'}
              aria-label={hasTicked ? 'Resume simulation' : 'Start simulation'}
              className="inline-flex min-h-8 min-w-8 items-center gap-1.5 border border-emerald-400/60 bg-emerald-500/15 px-2.5 text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25"
            >
              <Play className="h-3.5 w-3.5" aria-hidden={true} />
              <span>{hasTicked ? 'Resume' : 'Start'}</span>
            </button>
          )}

          <button
            type="button"
            aria-disabled={controlsDisabled}
            onClick={() => {
              if (!controlsDisabled) void step()
            }}
            title="Advance simulation by 1 tick"
            aria-label="Step forward 1 tick"
            className="inline-flex min-h-8 min-w-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-200"
          >
            <SkipForward className="h-3.5 w-3.5 text-cyan-300" aria-hidden={true} />
            <span className="hidden sm:inline">Step</span>
          </button>

          <button
            type="button"
            aria-disabled={controlsDisabled || !runtime.is_running}
            onClick={() => {
              if (!controlsDisabled && runtime.is_running) void stop()
            }}
            title="Stop running simulation loop"
            aria-label="Stop simulation"
            className="inline-flex min-h-8 min-w-8 items-center gap-1 border border-[#2b3968] bg-[#111834] px-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-rose-400 hover:text-rose-200 aria-disabled:opacity-45"
          >
            <Square className="h-3 w-3" aria-hidden={true} />
            <span className="hidden md:inline">Stop</span>
          </button>

          <button
            type="button"
            aria-disabled={controlsDisabled}
            onClick={() => {
              if (!controlsDisabled) void reset()
            }}
            title="Reset simulation to tick 0"
            aria-label="Reset simulation"
            className="inline-flex min-h-8 min-w-8 items-center gap-1 border border-[#2b3968] bg-[#111834] px-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-cyan-400 hover:text-cyan-200"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden={true} />
            <span className="hidden md:inline">Reset</span>
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="h-5 w-px bg-[#28335c]" />

        <div role="group" aria-label="Simulation speed" className="flex items-center gap-1">
          {[0.5, 1, 2, 4].map((spd) => {
            const active = runtime.speed === spd
            return (
              <button
                key={spd}
                type="button"
                aria-pressed={active}
                onClick={() => void setSpeed(spd)}
                className={`min-h-7 min-w-8 border px-1.5 text-[10px] font-mono-tabular transition-colors ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/25 font-semibold text-cyan-200'
                    : 'border-[#27335c] bg-[#0e142c] text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            )
          })}
        </div>
      </div>

      {/* Lower Primary Module Dock */}
      <nav
        aria-label="Simulation modules"
        className="hud-panel pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto px-2 py-1"
      >
        {NAV_MODULES.map((mod) => {
          const isCurrent = activeTab === mod.id
          const isLocked = Boolean(mod.phaseLock)
          const Icon = mod.Icon
          return (
            <button
              key={mod.id}
              type="button"
              aria-pressed={isCurrent}
              aria-disabled={isLocked}
              onClick={() => {
                if (!isLocked) setActiveTab(mod.id)
              }}
              title={
                mod.phaseLock
                  ? `${mod.label} unlocks in ${mod.phaseLock.replace('P', 'Phase ')}`
                  : `${mod.label} [${mod.hotkey}]`
              }
              className={`relative flex min-h-11 min-w-[68px] flex-col items-center justify-center gap-0.5 border px-2 py-1 text-[10px] transition-colors ${
                isCurrent
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : isLocked
                    ? 'cursor-not-allowed border-transparent bg-transparent text-slate-500 opacity-65'
                    : 'border-transparent bg-transparent text-slate-300 hover:border-[#2e3b6b] hover:bg-[#121936]'
              }`}
            >
              <span className="font-mono-tabular absolute top-0.5 right-1 text-[9px] text-slate-500">
                {mod.phaseLock ?? mod.hotkey}
              </span>
              <Icon className={`h-4 w-4 ${isCurrent ? 'text-cyan-300' : ''}`} aria-hidden={true} />
              <span className="font-medium tracking-wide whitespace-nowrap">{mod.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
