import React, { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type {
  AnalyticsKpis,
  ExperimentComparisonResponse,
  SimulationState,
} from '../types/simulation'
import { triggerBlobDownload } from './analyticsHelpers'

interface ExportAndSummaryPanelProps {
  sessionId: string
  simState: SimulationState
  kpis: AnalyticsKpis
  lastComparison: ExperimentComparisonResponse | null
}

export const ExportAndSummaryPanel: React.FC<ExportAndSummaryPanelProps> = ({
  sessionId,
  simState,
  kpis,
  lastComparison,
}) => {
  const pushToast = useSimulationStore((s) => s.pushToast)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [lastExportName, setLastExportName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSessionExport = async (
    key: string,
    format: 'json' | 'csv',
    scope: 'snapshot' | 'metrics' | 'events',
  ) => {
    setBusyKey(key)
    setError(null)
    try {
      const { filename, blob } = await apiClient.downloadAnalyticsExport(sessionId, format, scope)
      triggerBlobDownload(filename, blob)
      setLastExportName(filename)
      pushToast({ severity: 'success', title: 'Export Downloaded', message: filename })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleExperimentExport = async (
    key: string,
    kind: 'comparison' | 'scheduling' | 'synchronization',
    format: 'csv' | 'json',
  ) => {
    setBusyKey(key)
    setError(null)
    try {
      let dataPayload: Record<string, unknown>
      let title = `deadlock-city-${simState.preset ?? 'session'}`

      if (kind === 'comparison') {
        const comp =
          lastComparison ??
          (await apiClient.compareExperiments({
            mode: 'avoidance',
            preset: simState.preset ?? 'classic_banker_safe',
            seed: simState.seed,
            steps_after: 2,
          }))
        dataPayload = comp as unknown as Record<string, unknown>
        title = `comparison-${comp.mode}-${comp.preset}`
      } else if (kind === 'scheduling') {
        const procs = simState.processes.map((p) => ({
          id: p.id,
          name: p.name,
          arrival_time: p.arrival_time,
          burst_time: Math.max(1, p.burst_time),
          priority: p.priority,
        }))
        const sched = await apiClient.compareScheduling({
          quantum: 2,
          processes:
            procs.length > 0
              ? procs
              : [{ id: 'P0', name: 'Baseline', arrival_time: 0, burst_time: 4, priority: 1 }],
        })
        dataPayload = sched as unknown as Record<string, unknown>
        title = `cpu-scheduling-${simState.preset ?? 'workload'}`
      } else {
        const sync = await apiClient.runSynchronization({
          scenario: 'dining_philosophers',
          mode: 'safe',
          iterations: 5,
          buffer_size: 4,
          seed: simState.seed,
        })
        dataPayload = sync as unknown as Record<string, unknown>
        title = `sync-lab-dining-philosophers-seed${simState.seed}`
      }

      const { filename, blob } = await apiClient.downloadExperimentExport({
        kind,
        format,
        title,
        data: dataPayload,
      })
      triggerBlobDownload(filename, blob)
      setLastExportName(filename)
      pushToast({ severity: 'success', title: 'Export Downloaded', message: filename })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Experiment export failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const recoveryEvents = simState.events.filter(
    (e) => e.type === 'RECOVERY' || e.type === 'ROLLBACK',
  )
  const anomalyEvents = simState.events.filter(
    (e) => e.severity === 'error' || e.severity === 'warning' || e.type === 'DEADLOCK',
  )
  const initialPt = simState.metrics_history[0]
  const totalMetricSamples = Math.max(
    simState.metrics_history.length,
    simState.total_metric_samples_recorded ?? simState.metrics_history.length,
  )
  const totalEventsRecorded = Math.max(
    simState.events.length,
    simState.total_events_recorded ?? simState.events.length,
  )

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="no-print border border-rose-500/60 bg-rose-950/35 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {/* Export Center Controls */}
      <div className="no-print border border-[#253057] bg-[#0a0f20] p-4 text-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f294a] pb-2.5">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Authoritative FastAPI Data Export Center
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              All CSV and JSON exports are generated directly from FastAPI &amp; C++ engine telemetry with units and metadata.
            </p>
          </div>
          {lastExportName ? (
            <span className="border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-1 font-mono-tabular text-[10px] text-emerald-300">
              Last downloaded: {lastExportName}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* 1. Snapshot JSON */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">Simulation Snapshot JSON</div>
            <p className="text-[11px] text-slate-400">
              Full canonical C++ state, KPIs, process/resource vectors, history, and events.
            </p>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => void handleSessionExport('snap-json', 'json', 'snapshot')}
              className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busyKey === 'snap-json' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Snapshot (.json)
            </button>
          </div>

          {/* 2. Metrics History CSV */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">Simulation Metrics CSV</div>
            <p className="text-[11px] text-slate-400">
              Time-series utilization %, available/allocated units, active/blocked/completed counts &amp; UTC timestamps.
            </p>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => void handleSessionExport('metrics-csv', 'csv', 'metrics')}
              className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busyKey === 'metrics-csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Metrics (.csv)
            </button>
          </div>

          {/* 3. Event History CSV */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">Event History CSV</div>
            <p className="text-[11px] text-slate-400">
              Chronological events with tick, UTC timestamp, category, severity, affected PID/RID &amp; metadata JSON.
            </p>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => void handleSessionExport('events-csv', 'csv', 'events')}
              className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busyKey === 'events-csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Events (.csv)
            </button>
          </div>

          {/* 4. Comparative Results */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">Comparative Experiment Results</div>
            <p className="text-[11px] text-slate-400">
              Exports active comparative run (or executes isolated avoidance comparison cleanly).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('cmp-csv', 'comparison', 'csv')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-cyan-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('cmp-json', 'comparison', 'json')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-slate-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                JSON
              </button>
            </div>
          </div>

          {/* 5. CPU Scheduling Results */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">CPU Scheduling Benchmark</div>
            <p className="text-[11px] text-slate-400">
              Runs C++ CPUScheduler on current workload across FCFS/SJF/SRTF/Priority/RR and exports metrics.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('sched-csv', 'scheduling', 'csv')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-cyan-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('sched-json', 'scheduling', 'json')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-slate-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                JSON
              </button>
            </div>
          </div>

          {/* 6. Synchronization Lab Results */}
          <div className="border border-[#202b4f] bg-[#0e152b] p-3 space-y-2">
            <div className="font-display font-semibold text-slate-100">Synchronization Lab Report</div>
            <p className="text-[11px] text-slate-400">
              Executes C++ SyncLab (std::thread) and exports thread event trace &amp; anomaly totals.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('sync-csv', 'synchronization', 'csv')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-cyan-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleExperimentExport('sync-json', 'synchronization', 'json')}
                className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1 text-slate-200 hover:border-cyan-400 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Print-Friendly Academic Experiment Summary */}
      <article className="print-summary-sheet border border-[#253057] bg-[#0a0f20] p-4 text-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202a4d] pb-2.5">
          <div>
            <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wider text-cyan-300 uppercase">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Experiment Summary Report
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Canonical academic summary generated strictly from recorded engine state.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print inline-flex min-h-8 items-center gap-1.5 border border-[#304075] bg-[#121936] px-3 py-1.5 text-xs font-medium text-cyan-200 hover:border-cyan-400"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            Print Summary
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Experiment &amp; Configuration</dt>
            <dd className="mt-1 font-mono-tabular text-[11px] text-slate-200">
              Preset: {simState.preset ?? 'Custom'} • Session: {sessionId} • Seed: {simState.seed} • Tick: {simState.tick}
            </dd>
          </div>
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Initial vs. Final State</dt>
            <dd className="mt-1 font-mono-tabular text-[11px] text-slate-200">
              Initial (T{initialPt?.tick ?? 0}): {initialPt?.safety_status ?? simState.safety_status}, Util {initialPt?.utilization_pct ?? kpis.resource_utilization_pct}% → Final (T{simState.tick}): {simState.safety_status}, Util {kpis.resource_utilization_pct}%
            </dd>
          </div>
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Algorithms Executed</dt>
            <dd className="mt-1 text-[11px] text-slate-200">
              Banker&apos;s Safety Check ({simState.banker_report.is_safe ? 'SAFE' : 'UNSAFE'}), Multi-Instance Deadlock Detection ({simState.deadlock_report.detected ? 'DEADLOCKED' : 'Clear'})
              {kpis.recovery_count > 0 ? `, RecoveryManager (${kpis.recovery_count} op)` : ''}
            </dd>
          </div>
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Relevant Metrics</dt>
            <dd className="mt-1 font-mono-tabular text-[11px] text-slate-200">
              Procs {kpis.active_processes}/{kpis.total_processes} active ({kpis.completed_processes} completed, {kpis.blocked_processes} blocked) • Res {kpis.allocated_instances}/{kpis.total_resource_instances} allocated • Req Granted/Rej {kpis.granted_request_count}/{kpis.rejected_request_count} • Avg Wait {kpis.avg_waiting_ticks}t
            </dd>
            <dd className="mt-1 font-mono-tabular text-[10px] text-slate-400">
              Retained window: {simState.metrics_history.length}/{totalMetricSamples} samples, {simState.events.length}/{totalEventsRecorded} events
            </dd>
          </div>
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Detected Anomalies &amp; Key Observations</dt>
            <dd className="mt-1 text-[11px] text-slate-300">
              {anomalyEvents.length > 0
                ? `${anomalyEvents.length} warning/error event(s) recorded; latest: ${anomalyEvents[anomalyEvents.length - 1]!.message}`
                : simState.deadlock_report.explanation || simState.banker_report.explanation}
            </dd>
          </div>
          <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
            <dt className="text-[10px] font-semibold text-slate-400 uppercase">Recovery Actions &amp; Final Outcome</dt>
            <dd className="mt-1 text-[11px] text-slate-200">
              {recoveryEvents.length > 0
                ? `${recoveryEvents.map((r) => r.message).join(' | ')} -> Final State: ${simState.safety_status}.`
                : `No recovery operations invoked (${kpis.recovery_count} ops, ${kpis.preemption_count} preemptions). Final state: ${simState.safety_status}.`}
            </dd>
          </div>
        </dl>
      </article>
    </div>
  )
}
