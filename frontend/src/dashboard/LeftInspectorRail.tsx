import React from 'react'
import { Building2, Cpu, Crosshair, Database, Gauge, Layers, ShieldAlert, X } from 'lucide-react'
import { useSimulationStore } from '../stores/useSimulationStore'
import { ProcessStateBadge, ResourceStatusBadge } from '../components/ui/StatusBadge'

export const LeftInspectorRail: React.FC = () => {
  const simState = useSimulationStore((s) => s.simState)
  const selectedEntity = useSimulationStore((s) => s.selectedEntity)
  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)
  const triggerCamera = useSimulationStore((s) => s.triggerCamera)

  if (!simState) return null

  const selectedProcess =
    selectedEntity?.kind === 'process'
      ? simState.processes.find((p) => p.id === selectedEntity.id) ?? null
      : null
  const selectedResource =
    selectedEntity?.kind === 'resource'
      ? simState.resources.find((r) => r.id === selectedEntity.id) ?? null
      : null

  return (
    <aside
      aria-label="Entity inspector"
      className="hud-panel pointer-events-auto fixed left-3 top-28 z-20 flex max-h-[calc(100vh-14.5rem)] w-64 flex-col overflow-hidden"
    >
      {/* Inspector Header + Quick Switcher */}
      <div className="border-b border-[#253057] bg-[#121833]/90 px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          <span className="font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
            {selectedProcess
              ? `Building • ${selectedProcess.id}`
              : selectedResource
                ? `Facility • ${selectedResource.id}`
                : 'Entity Inspector'}
          </span>
          <div className="flex items-center gap-1">
            {selectedProcess ? <ProcessStateBadge state={selectedProcess.state} /> : null}
            {selectedResource ? <ResourceStatusBadge status={selectedResource.status} /> : null}
            {selectedEntity ? (
              <>
                <button
                  type="button"
                  onClick={() => triggerCamera('focus')}
                  title="Focus camera on selected entity"
                  aria-label="Focus camera on selected entity"
                  className="inline-flex h-5 w-5 items-center justify-center border border-[#2c3a68] bg-[#0d1328] text-cyan-300 hover:border-cyan-400"
                >
                  <Crosshair className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEntity(null)}
                  title="Clear selection"
                  aria-label="Clear selection"
                  className="inline-flex h-5 w-5 items-center justify-center border border-[#2c3a68] bg-[#0d1328] text-slate-400 hover:border-slate-400 hover:text-slate-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs font-medium text-slate-100">
          {selectedProcess?.name ?? selectedResource?.name ?? 'Select a process or resource'}
        </p>
      </div>

      {/* Selector Strip for Processes & Resources */}
      <div className="flex flex-wrap gap-1 border-b border-[#202a4d] bg-[#0b1022]/80 px-2.5 py-1.5">
        {simState.processes.map((p) => {
          const active = selectedEntity?.kind === 'process' && selectedEntity.id === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedEntity({ kind: 'process', id: p.id })}
              className={`min-h-6 border px-1.5 text-[10px] font-mono-tabular transition-colors ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                  : 'border-[#27335c] bg-[#101630] text-slate-300 hover:border-cyan-400/50'
              }`}
            >
              {p.id}
            </button>
          )
        })}
        {simState.resources.map((r) => {
          const active = selectedEntity?.kind === 'resource' && selectedEntity.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedEntity({ kind: 'resource', id: r.id })}
              className={`min-h-6 border px-1.5 text-[10px] font-mono-tabular transition-colors ${
                active
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                  : 'border-[#27335c] bg-[#101630] text-slate-400 hover:border-amber-400/50'
              }`}
            >
              {r.id}
            </button>
          )
        })}
      </div>

      {/* Inspector Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 text-xs">
        {selectedProcess ? (
          <div className="space-y-3">
            {/* Vertical Metric Rows matching reference Relay panel */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Cpu className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                  Remaining Burst
                </span>
                <span className="font-mono-tabular font-semibold text-slate-100">
                  {selectedProcess.remaining_time}/{selectedProcess.burst_time}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Gauge className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
                  Priority / Cost
                </span>
                <span className="font-mono-tabular font-semibold text-slate-100">
                  P{selectedProcess.priority} / ${selectedProcess.termination_cost}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                  Waiting Ticks
                </span>
                <span className="font-mono-tabular font-semibold text-amber-200">
                  {selectedProcess.waiting_ticks}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  City Plot
                </span>
                <span className="font-mono-tabular text-[11px] text-slate-300">
                  {selectedProcess.city_position.plot_id}
                </span>
              </div>
            </div>

            {/* Resource Vector Breakdown */}
            <div className="border-t border-[#222d52] pt-2">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Resource Vectors (Alloc / Need / Max)
              </div>
              <div className="space-y-1 font-mono-tabular text-[11px]">
                {simState.resources.map((res) => {
                  const alloc = selectedProcess.allocated[res.id] ?? 0
                  const need = selectedProcess.need[res.id] ?? 0
                  const max = selectedProcess.max_demand[res.id] ?? 0
                  const req = selectedProcess.pending_request[res.id] ?? 0
                  return (
                    <div
                      key={res.id}
                      className="flex items-center justify-between border border-[#1f294a] bg-[#0b1022]/80 px-2 py-1"
                    >
                      <span className="text-slate-300">{res.id}</span>
                      <span className="text-slate-100">
                        <span className="text-cyan-300">{alloc}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-amber-300">{need}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-300">{max}</span>
                        {req > 0 ? <span className="ml-1 text-rose-400">(req {req})</span> : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : selectedResource ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Database className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                Available / Total
              </span>
              <span className="font-mono-tabular font-semibold text-emerald-300">
                {selectedResource.available_instances}/{selectedResource.total_instances}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Layers className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                Allocated Units
              </span>
              <span className="font-mono-tabular font-semibold text-cyan-200">
                {selectedResource.allocated_instances}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Category</span>
              <span className="font-mono-tabular text-slate-200">{selectedResource.category}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Preemptible</span>
              <span className="font-mono-tabular text-slate-200">
                {selectedResource.preemptible ? 'YES' : 'NO'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Plot</span>
              <span className="font-mono-tabular text-[11px] text-slate-300">
                {selectedResource.city_position.plot_id}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-slate-400">Select any building or resource facility to inspect live C++ state.</p>
        )}
      </div>
    </aside>
  )
}
