import React, { useEffect, useState } from 'react'
import { AlertOctagon, AlertTriangle, RefreshCw, ShieldCheck, Siren } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import { SafetyBadge } from '../components/ui/StatusBadge'
import { TracePlaybackControls } from './TracePlaybackControls'

export const DeadlockDetectionLab: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const simState = useSimulationStore((s) => s.simState)
  const applyEnvelope = useSimulationStore((s) => s.applyEnvelope)
  const pushToast = useSimulationStore((s) => s.pushToast)

  const [stepIndex, setStepIndex] = useState(0)
  const [running, setRunning] = useState(false)

  const report = simState?.deadlock_report
  const steps = report?.steps ?? []
  const activeStep = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))] ?? null

  useEffect(() => {
    setStepIndex(0)
  }, [simState?.tick, simState?.preset, steps.length])

  const handleRunDetection = async () => {
    if (!sessionId) return
    setRunning(true)
    try {
      const env = await apiClient.detectDeadlock(sessionId)
      applyEnvelope(env)
      setStepIndex(0)
      pushToast({
        severity: env.state.deadlock_report.detected ? 'error' : 'success',
        title: 'Detection Complete',
        message: env.state.deadlock_report.detected
          ? `Deadlock detected across ${env.state.deadlock_report.deadlocked_processes.join(', ')}.`
          : 'No deadlock detected by Work/Finish engine.',
      })
    } catch (err) {
      pushToast({
        severity: 'error',
        title: 'Detection Error',
        message: err instanceof Error ? err.message : 'Failed to run detection.',
      })
    } finally {
      setRunning(false)
    }
  }

  if (!simState || !report) return null

  const resources = simState.resources
  const activeProcesses = simState.processes.filter((p) => p.state !== 'TERMINATED')
  const finishSnapshot = activeStep?.finish_snapshot ?? {}

  return (
    <section
      aria-label="Deadlock Detection Laboratory"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Siren className="h-4 w-4 text-rose-400" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Deadlock Detection Engine (Work / Finish + WFG)
            </h1>
            <p className="text-[11px] text-slate-400">
              Authoritative C++ detection across multi-instance resources
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SafetyBadge status={simState.safety_status} />
          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunDetection()}
            className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/15 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
            Run Detection
          </button>
        </div>
      </div>

      {/* Distinct Verdict Banner: SAFE vs UNSAFE (not deadlocked) vs DEADLOCKED */}
      <div
        className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
          simState.safety_status === 'DEADLOCKED'
            ? 'border-rose-500/50 bg-rose-950/45 text-rose-200'
            : simState.safety_status === 'UNSAFE'
              ? 'border-amber-500/50 bg-amber-950/35 text-amber-200'
              : 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200'
        }`}
      >
        <div className="flex items-center gap-2">
          {simState.safety_status === 'DEADLOCKED' ? (
            <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
          ) : simState.safety_status === 'UNSAFE' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          )}
          <span>{report.explanation}</span>
        </div>
        {report.deadlocked_processes.length > 0 ? (
          <span className="font-mono-tabular shrink-0 border border-rose-400/60 bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold">
            Deadlocked: {report.deadlocked_processes.join(', ')}
          </span>
        ) : null}
      </div>

      {/* Playback Controls */}
      <div className="border-b border-[#202a4d] bg-[#0b1022] px-4 py-2">
        <TracePlaybackControls
          label="Deadlock detection trace playback"
          totalSteps={steps.length}
          currentStep={stepIndex}
          onStepChange={setStepIndex}
        />
        {activeStep ? (
          <p className="mt-1.5 text-xs text-cyan-200">
            <span className="font-mono-tabular font-semibold">
              {activeStep.selected_process ? `[${activeStep.selected_process}] ` : '[HALT] '}
            </span>
            {activeStep.note}
          </p>
        ) : null}
      </div>

      {/* Main Content Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 xl:grid-cols-3">
        {/* Matrix Table (Allocation, Request, Finish) */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="detection-matrix-caption"
            className="overflow-auto border border-[#253057] bg-[#0a0f20]"
          >
            <table className="w-full border-collapse text-left text-xs font-mono-tabular">
              <caption
                id="detection-matrix-caption"
                className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase"
              >
                Allocation, Request &amp; Finish Vectors (Step {steps.length > 0 ? stepIndex + 1 : 0})
              </caption>
              <thead className="sticky top-0 bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">
                    Process
                  </th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">
                    Allocation ({resources.map((r) => r.id).join(' ')})
                  </th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">
                    Request ({resources.map((r) => r.id).join(' ')})
                  </th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">
                    Finish
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2442]">
                {activeProcesses.map((proc) => {
                  const isSelectedStep = activeStep?.selected_process === proc.id
                  const isDead = report.deadlocked_processes.includes(proc.id)
                  const finished = finishSnapshot[proc.id] ?? false
                  return (
                    <tr
                      key={proc.id}
                      className={
                        isSelectedStep
                          ? 'bg-cyan-500/15 text-cyan-100'
                          : isDead
                            ? 'bg-rose-500/15 text-rose-200'
                            : 'text-slate-200'
                      }
                    >
                      <th scope="row" className="px-3 py-2 font-semibold">
                        {proc.id}{' '}
                        <span className="font-sans text-[10px] font-normal text-slate-400">
                          ({proc.name})
                        </span>
                      </th>
                      <td className="px-3 py-2">
                        [{resources.map((r) => proc.allocated[r.id] ?? 0).join(', ')}]
                      </td>
                      <td className="px-3 py-2 text-amber-200">
                        [{resources.map((r) => proc.pending_request[r.id] ?? 0).join(', ')}]
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block border px-1.5 py-0.5 text-[10px] ${
                            finished
                              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                              : isDead
                                ? 'border-rose-500/70 bg-rose-500/20 text-rose-300'
                                : 'border-slate-600 bg-slate-800/70 text-slate-400'
                          }`}
                        >
                          {finished ? 'TRUE' : 'FALSE'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Available & Work Vector Progression */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 font-mono-tabular text-xs">
            <div className="border border-[#253057] bg-[#0a0f20] p-3">
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Available Vector
              </div>
              <div className="mt-1.5 text-sm font-semibold text-emerald-300">
                [{resources.map((r) => `${r.id}:${r.available_instances}`).join('  ')}]
              </div>
            </div>
            <div className="border border-[#253057] bg-[#0a0f20] p-3">
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Work (Before Step)
              </div>
              <div className="mt-1.5 text-sm font-semibold text-slate-200">
                [
                {resources
                  .map((r) => `${r.id}:${activeStep?.work_before[r.id] ?? r.available_instances}`)
                  .join('  ')}
                ]
              </div>
            </div>
            <div className="border border-[#253057] bg-[#0a0f20] p-3">
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Work (After Step)
              </div>
              <div className="mt-1.5 text-sm font-semibold text-cyan-300">
                [
                {resources
                  .map((r) => `${r.id}:${activeStep?.work_after[r.id] ?? r.available_instances}`)
                  .join('  ')}
                ]
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Wait-For Graph & Cycles */}
        <div className="flex flex-col gap-3">
          <div className="border border-[#253057] bg-[#0a0f20] p-3 text-xs">
            <h2 className="font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
              Wait-For Graph Edges ({report.wait_for_edges.length})
            </h2>
            {report.wait_for_edges.length === 0 ? (
              <p className="mt-2 text-slate-400">No process-to-process wait edges active.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 font-mono-tabular text-[11px]">
                {report.wait_for_edges.map((edge, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between border border-[#1f294a] bg-[#0e152b] px-2.5 py-1.5"
                  >
                    <span className="text-rose-300">
                      {edge.from} → {edge.to}
                    </span>
                    <span className="text-slate-400">on {edge.resource_id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-[#253057] bg-[#0a0f20] p-3 text-xs">
            <h2 className="font-display text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
              RAG Cycles ({report.cycles.length})
            </h2>
            {report.cycles.length === 0 ? (
              <p className="mt-2 text-slate-400">No directed cycles in RAG.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 font-mono-tabular text-[11px]">
                {report.cycles.map((cyc, idx) => (
                  <li
                    key={idx}
                    className="border border-amber-500/30 bg-amber-950/20 px-2.5 py-1.5 text-amber-200"
                  >
                    {cyc.join(' → ')} → {cyc[0]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
