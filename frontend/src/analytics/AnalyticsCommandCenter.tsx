import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  FlaskConical,
  GitCompare,
  Layers,
  LineChart as LineChartIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { SafetyBadge } from '../components/ui/StatusBadge'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { ExperimentComparisonResponse, PresetCatalogItem } from '../types/simulation'
import { deriveCanonicalAnalytics } from './analyticsHelpers'
import { ComparativeEnginePanel } from './ComparativeEnginePanel'
import { EventTimelinePanel } from './EventTimelinePanel'
import { ExportAndSummaryPanel } from './ExportAndSummaryPanel'
import { GuidedExperimentsPanel } from './GuidedExperimentsPanel'
import { HistoricalChartsPanel } from './HistoricalChartsPanel'
import { PresetCenterPanel } from './PresetCenterPanel'

type AnalyticsSubTab =
  | 'overview'
  | 'charts'
  | 'presets'
  | 'guided'
  | 'compare'
  | 'events'
  | 'export'

const SUB_TABS: Array<{ id: AnalyticsSubTab; label: string; Icon: React.FC<{ className?: string }> }> = [
  { id: 'overview', label: 'Command Center', Icon: BarChart3 },
  { id: 'charts', label: 'Historical Charts', Icon: LineChartIcon },
  { id: 'presets', label: 'Preset Center', Icon: SlidersHorizontal },
  { id: 'guided', label: 'Guided Labs', Icon: FlaskConical },
  { id: 'compare', label: 'Comparative Engine', Icon: GitCompare },
  { id: 'events', label: 'Event Timeline', Icon: Clock },
  { id: 'export', label: 'Exports & Summary', Icon: Download },
]

export const AnalyticsCommandCenter: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const simState = useSimulationStore((s) => s.simState)
  const isMutating = useSimulationStore((s) => s.isMutating)
  const step = useSimulationStore((s) => s.step)

  const [subTab, setSubTab] = useState<AnalyticsSubTab>('overview')
  const [presets, setPresets] = useState<PresetCatalogItem[]>([])
  const [lastComparison, setLastComparison] = useState<ExperimentComparisonResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getExperimentPresets()
      .then((res) => {
        if (!cancelled) setPresets(res.presets)
      })
      .catch(() => {
        // PresetCenterPanel handles visible error reporting
      })
    return () => {
      cancelled = true
    }
  }, [])

  const canonical = useMemo(() => {
    if (!simState) return null
    return deriveCanonicalAnalytics(simState)
  }, [simState])

  if (!simState || !sessionId || !canonical) {
    return (
      <section
        aria-label="Analytics Command Center"
        className="hud-panel flex h-full w-full items-center justify-center p-8 text-xs text-slate-400"
      >
        Initializing analytics telemetry session…
      </section>
    )
  }

  const { kpis, distribution } = canonical

  const kpiCards: Array<{ label: string; value: string | number; sub: string; tone: string }> = [
    { label: 'Simulation Tick', value: simState.tick, sub: `Seed ${simState.seed}`, tone: 'text-cyan-300' },
    { label: 'Total / Active Procs', value: `${kpis.total_processes} / ${kpis.active_processes}`, sub: `${kpis.completed_processes} completed`, tone: 'text-slate-100' },
    { label: 'Waiting / Blocked', value: `${kpis.waiting_processes} / ${kpis.blocked_processes}`, sub: `${kpis.terminated_processes} terminated`, tone: kpis.blocked_processes > 0 ? 'text-amber-300' : 'text-slate-200' },
    { label: 'Resource Instances', value: `${kpis.available_resource_instances} / ${kpis.total_resource_instances}`, sub: `${kpis.allocated_instances} allocated`, tone: 'text-emerald-300' },
    { label: 'Resource Utilization', value: `${kpis.resource_utilization_pct.toFixed(1)}%`, sub: `${kpis.total_resource_types} resource pools`, tone: 'text-cyan-300' },
    { label: 'Pending Requests', value: `${kpis.pending_request_units} units`, sub: `${kpis.pending_request_processes} blocked proc(s)`, tone: kpis.pending_request_units > 0 ? 'text-amber-300' : 'text-slate-300' },
    { label: 'Requests Granted / Rej', value: `${kpis.granted_request_count} / ${kpis.rejected_request_count}`, sub: 'Runtime request counter', tone: 'text-emerald-300' },
    { label: 'Deadlock Occurrences', value: kpis.deadlock_count, sub: `${kpis.deadlocked_processes} currently deadlocked`, tone: kpis.deadlock_count > 0 ? 'text-rose-300' : 'text-slate-200' },
    { label: 'Recovery Operations', value: kpis.recovery_count, sub: `${kpis.recovery_terminated_count} recovery-terminated`, tone: 'text-cyan-200' },
    { label: 'Resource Preemptions', value: kpis.preemption_count, sub: `Avg wait ${kpis.avg_waiting_ticks.toFixed(2)} ticks`, tone: 'text-indigo-300' },
  ]

  return (
    <section
      aria-label="Analytics Command Center"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Analytics &amp; Experimentation Command Center
            </h1>
            <p className="text-[11px] text-slate-400">
              Canonical C++ metrics, presets, guided labs, isolated comparisons &amp; data exports •{' '}
              <span className="font-mono-tabular text-cyan-300">{simState.preset ?? 'custom'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SafetyBadge status={simState.safety_status} />
          <span className="border border-[#27335c] bg-[#0d1328] px-2 py-1 font-mono-tabular text-[10px] text-slate-300">
            {simState.metrics_history.length} Samples • {simState.events.length} Events
          </span>
        </div>
      </div>

      {/* Sub-Navigation Tablist */}
      <div
        role="tablist"
        aria-label="Analytics sections"
        className="no-print flex flex-wrap items-center gap-1 border-b border-[#202a4d] bg-[#0b1022] px-3 py-1.5 text-xs"
      >
        {SUB_TABS.map(({ id, label, Icon }) => {
          const active = subTab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      {/* Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {subTab === 'overview' ? (
          <div className="space-y-4">
            {/* Canonical KPI Grid */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {kpiCards.map((card) => (
                <div
                  key={card.label}
                  className="border border-[#253057] bg-[#0a0f20] px-3 py-2.5 text-xs"
                >
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    {card.label}
                  </div>
                  <div className={`mt-1 font-mono-tabular text-lg font-bold ${card.tone}`}>
                    {card.value}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Process Lifecycle Breakdown + Pool Saturation */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="border border-[#253057] bg-[#0a0f20] p-3.5 text-xs">
                <h2 className="flex items-center gap-2 font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  Process State Breakdown
                </h2>
                <div className="mt-3 grid grid-cols-3 gap-2 font-mono-tabular sm:grid-cols-6">
                  {(['NEW', 'READY', 'RUNNING', 'WAITING', 'BLOCKED', 'TERMINATED'] as const).map(
                    (st) => (
                      <div key={st} className="border border-[#1f294a] bg-[#0e152b] p-2 text-center">
                        <div className="text-[10px] text-slate-400">{st}</div>
                        <div className="mt-1 text-base font-bold text-slate-100">
                          {distribution[st] ?? 0}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="border border-[#253057] bg-[#0a0f20] p-3.5 text-xs">
                <h2 className="flex items-center gap-2 font-display text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  Resource Facility Utilization
                </h2>
                <div className="mt-3 space-y-2 font-mono-tabular">
                  {simState.resources.map((res) => {
                    const pct =
                      res.total_instances > 0
                        ? Math.round((res.allocated_instances / res.total_instances) * 100)
                        : 0
                    return (
                      <div key={res.id}>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-200">
                            {res.id} • {res.name} ({res.category})
                          </span>
                          <span className="text-cyan-300">
                            {res.allocated_instances}/{res.total_instances} allocated ({pct}%)
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full bg-[#131b36]">
                          <div
                            className={`h-full ${pct >= 90 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-400' : 'bg-cyan-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Process Telemetry Table */}
            <div className="overflow-auto border border-[#253057] bg-[#0a0f20]">
              <table className="w-full border-collapse text-left text-xs font-mono-tabular">
                <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-cyan-300 uppercase">
                  Live Process Telemetry Matrix
                </caption>
                <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">PID</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Name</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">State</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Remaining</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Wait Ticks</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Preemptions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2442]">
                  {simState.processes.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className="px-3 py-1.5 text-cyan-300">{p.id}</th>
                      <td className="px-3 py-1.5 font-sans text-slate-200">{p.name}</td>
                      <td className="px-3 py-1.5">{p.state}</td>
                      <td className="px-3 py-1.5">{p.remaining_time}/{p.burst_time}</td>
                      <td className="px-3 py-1.5">{p.waiting_ticks}</td>
                      <td className="px-3 py-1.5">{p.preemption_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {subTab === 'charts' ? (
          <HistoricalChartsPanel
            metricsHistory={simState.metrics_history}
            totalRecordedSamples={simState.total_metric_samples_recorded}
            currentSafety={simState.safety_status}
            currentTick={simState.tick}
            isMutating={isMutating}
            onStepTick={() => void step()}
          />
        ) : null}

        {subTab === 'presets' ? <PresetCenterPanel /> : null}

        {subTab === 'guided' ? <GuidedExperimentsPanel /> : null}

        {subTab === 'compare' ? (
          <ComparativeEnginePanel
            presets={presets}
            lastComparison={lastComparison}
            onComparisonComplete={setLastComparison}
          />
        ) : null}

        {subTab === 'events' ? (
          <EventTimelinePanel
            events={simState.events}
            totalRecordedEvents={simState.total_events_recorded}
          />
        ) : null}

        {subTab === 'export' ? (
          <ExportAndSummaryPanel
            sessionId={sessionId}
            simState={simState}
            kpis={kpis}
            lastComparison={lastComparison}
          />
        ) : null}
      </div>
    </section>
  )
}
