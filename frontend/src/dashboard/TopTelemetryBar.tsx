import React from 'react'
import {
  Activity,
  AlertOctagon,
  Boxes,
  Cpu,
  Database,
  Layers,
  Radio,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react'
import { useSimulationStore } from '../stores/useSimulationStore'
import { SafetyBadge } from '../components/ui/StatusBadge'

interface TopTelemetryBarProps {
  onOpenSessionDialog: () => void
  showQueue?: boolean
}

export const TopTelemetryBar: React.FC<TopTelemetryBarProps> = ({
  onOpenSessionDialog,
  showQueue = true,
}) => {
  const simState = useSimulationStore((s) => s.simState)
  const sessionId = useSimulationStore((s) => s.sessionId)
  const health = useSimulationStore((s) => s.health)
  const backendConnected = useSimulationStore((s) => s.backendConnected)
  const wsStatus = useSimulationStore((s) => s.wsStatus)
  const selectedEntity = useSimulationStore((s) => s.selectedEntity)
  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)
  const refreshHealth = useSimulationStore((s) => s.refreshHealth)

  const processes = simState?.processes ?? []
  const resources = simState?.resources ?? []

  const activeProcs = processes.filter((p) => p.state !== 'TERMINATED').length
  const blockedProcs = processes.filter((p) => p.state === 'BLOCKED' || p.state === 'WAITING').length
  const totalInstances = resources.reduce((acc, r) => acc + r.total_instances, 0)
  const availableInstances = resources.reduce((acc, r) => acc + r.available_instances, 0)
  const allocatedInstances = resources.reduce((acc, r) => acc + r.allocated_instances, 0)

  const queueItems = processes.filter((p) => p.state !== 'TERMINATED').slice(0, 4)

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-col">
      {/* Primary Top Telemetry Bar */}
      <div className="pointer-events-auto flex h-10 items-center justify-between border-b border-[#263259] bg-[#0b0f21]/92 px-3 backdrop-blur-md">
        {/* Left: Brand + Canonical Telemetry Counters */}
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-2 pr-2 border-r border-[#243056]">
            <span className="inline-flex h-6 w-6 items-center justify-center border border-cyan-400/50 bg-cyan-500/15 text-cyan-300">
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="font-display text-xs font-bold tracking-widest text-slate-100 uppercase whitespace-nowrap">
              Deadlock City
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono-tabular">
            <div className="flex items-center gap-1.5" title="Active / Total Processes">
              <Activity className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
              <span className="text-slate-400">PROC</span>
              <span className="font-semibold text-slate-100">
                {activeProcs}/{processes.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5" title="Available / Total Resource Units">
              <Database className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              <span className="text-slate-400">AVAIL</span>
              <span className="font-semibold text-emerald-300">
                {availableInstances}/{totalInstances}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5" title="Allocated Resource Units">
              <Boxes className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
              <span className="text-slate-400">ALLOC</span>
              <span className="font-semibold text-slate-100">{allocatedInstances}</span>
            </div>

            <div className="hidden md:flex items-center gap-1.5" title="Blocked or Waiting Processes">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              <span className="text-slate-400">BLK</span>
              <span className={`font-semibold ${blockedProcs > 0 ? 'text-amber-300' : 'text-slate-100'}`}>
                {blockedProcs}
              </span>
            </div>

            <div className="hidden md:flex items-center gap-1.5" title="Cumulative Deadlock Detections">
              <AlertOctagon className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
              <span className="text-slate-400">DLK</span>
              <span
                className={`font-semibold ${
                  (simState?.deadlock_count ?? 0) > 0 ? 'text-rose-300' : 'text-slate-100'
                }`}
              >
                {simState?.deadlock_count ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Engine Health, WebSocket Status, Session/Preset Modal Trigger */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshHealth()}
            title="Refresh backend & C++ engine status"
            className={`inline-flex min-h-7 items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono-tabular transition-colors ${
              backendConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400'
                : 'border-rose-500/50 bg-rose-500/15 text-rose-300 hover:border-rose-400'
            }`}
          >
            {backendConnected ? (
              <Layers className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ServerCrash className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {backendConnected ? `C++ v${health?.engine_version ?? '1.0.0'}` : 'ENGINE OFFLINE'}
            </span>
          </button>

          <span
            title={`WebSocket status: ${wsStatus}`}
            className={`inline-flex min-h-7 items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono-tabular ${
              wsStatus === 'connected'
                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                : wsStatus === 'reconnecting' || wsStatus === 'connecting'
                  ? 'border-amber-400/50 bg-amber-500/10 text-amber-300'
                  : 'border-slate-600/60 bg-slate-800/70 text-slate-400'
            }`}
          >
            {wsStatus === 'reconnecting' ? (
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <Radio className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="hidden lg:inline uppercase">{wsStatus}</span>
          </span>

          <button
            type="button"
            onClick={onOpenSessionDialog}
            className="inline-flex min-h-7 items-center gap-1.5 border border-cyan-400/60 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-cyan-200 transition-colors hover:bg-cyan-500/25"
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
            <span>Presets / Session</span>
          </button>
        </div>
      </div>

      {/* Sub-Header Overlays: Left Angled Status Ribbon & Right Activity Queue */}
      <div className="flex items-start justify-between px-3 pt-2">
        {/* Top-Left Angled Status Banner (matches reference's angled badge) */}
        <div className="pointer-events-auto flex flex-col items-start">
          <div className="hud-chamfer-right flex items-center gap-2.5 border border-[#2c3a68] bg-[#10162f]/92 py-1.5 pl-3 pr-6 shadow-lg">
            {simState ? (
              <SafetyBadge status={simState.safety_status} />
            ) : (
              <span className="text-[11px] font-mono-tabular text-slate-400">NO SESSION</span>
            )}
            <span className="text-xs font-medium text-slate-200 truncate max-w-[200px]">
              {simState?.preset ?? 'Custom Session'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 pl-1 text-[10px] font-mono-tabular text-slate-400">
            <span>SID: {sessionId ?? '---'}</span>
            <span>•</span>
            <span>SEED: {simState?.seed ?? '--'}</span>
          </div>
        </div>

        {/* Top-Right Stacked Activity Queue (matches reference's top-right task list on City view) */}
        {showQueue ? (
        <aside
          aria-label="Active process execution queue"
          className="pointer-events-auto hidden md:flex w-64 flex-col border border-[#28335c] bg-[#0b1022]/90 backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-[#222d52] px-2.5 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            <span>Process Execution Queue</span>
            <span className="font-mono-tabular text-cyan-300">{queueItems.length} Active</span>
          </div>
          {queueItems.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-slate-400">No active processes</div>
          ) : (
            <ul className="divide-y divide-[#1d2647]">
              {queueItems.map((proc) => {
                const pct =
                  proc.burst_time > 0
                    ? Math.round(((proc.burst_time - proc.remaining_time) / proc.burst_time) * 100)
                    : 0
                const isSelected =
                  selectedEntity?.kind === 'process' && selectedEntity.id === proc.id
                return (
                  <li key={proc.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedEntity({ kind: 'process', id: proc.id })}
                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                        isSelected
                          ? 'bg-cyan-500/15 text-cyan-200'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="font-mono-tabular w-9 shrink-0 font-semibold text-cyan-300">
                        {pct}%
                      </span>
                      <span className="min-w-0 flex-1 truncate">{proc.name}</span>
                      <span
                        className={`font-mono-tabular text-[10px] ${
                          proc.state === 'BLOCKED'
                            ? 'text-rose-400'
                            : proc.state === 'RUNNING'
                              ? 'text-emerald-300'
                              : 'text-slate-400'
                        }`}
                      >
                        {proc.id}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        ) : null}
      </div>
    </header>
  )
}
