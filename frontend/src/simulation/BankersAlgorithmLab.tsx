import React, { useEffect, useId, useState } from 'react'
import { AlertTriangle, CheckCircle2, PlayCircle, ShieldCheck, XCircle } from 'lucide-react'
import { ApiError, apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { BankerCheckResponse } from '../types/simulation'
import { TracePlaybackControls } from './TracePlaybackControls'

export const BankersAlgorithmLab: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const simState = useSimulationStore((s) => s.simState)
  const applyEnvelope = useSimulationStore((s) => s.applyEnvelope)
  const pushToast = useSimulationStore((s) => s.pushToast)

  const [stepIndex, setStepIndex] = useState(0)
  const [selectedPid, setSelectedPid] = useState<string>('')
  const [requestVec, setRequestVec] = useState<Record<string, number>>({})
  const [hypotheticalResult, setHypotheticalResult] = useState<BankerCheckResponse | null>(null)
  const [checking, setChecking] = useState(false)

  const procSelectId = useId()

  const activeProcesses = (simState?.processes ?? []).filter((p) => p.state !== 'TERMINATED')
  const resources = simState?.resources ?? []
  const resourceIdsKey = resources.map((r) => r.id).join(',')

  useEffect(() => {
    if (activeProcesses.length > 0 && !activeProcesses.some((p) => p.id === selectedPid)) {
      setSelectedPid(activeProcesses[0]!.id)
    }
  }, [activeProcesses, selectedPid])

  useEffect(() => {
    const init: Record<string, number> = {}
    for (const id of resourceIdsKey.split(',').filter(Boolean)) init[id] = 0
    setRequestVec(init)
    setHypotheticalResult(null)
    setStepIndex(0)
  }, [simState?.preset, simState?.tick, resourceIdsKey])

  const activeReport = hypotheticalResult?.banker_report ?? simState?.banker_report
  const steps = activeReport?.steps ?? []
  const activeStep = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))] ?? null

  const handleRunSafetyCheck = async () => {
    if (!sessionId) return
    setChecking(true)
    setHypotheticalResult(null)
    try {
      const env = await apiClient.checkBanker(sessionId, {})
      applyEnvelope(env)
      setStepIndex(0)
    } catch (err) {
      pushToast({
        severity: 'error',
        title: "Banker's Check Failed",
        message: err instanceof Error ? err.message : 'Unable to run safety check.',
      })
    } finally {
      setChecking(false)
    }
  }

  const handleEvaluateHypothetical = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId || !selectedPid) return
    setChecking(true)
    try {
      const env = await apiClient.checkBanker(sessionId, {
        process_id: selectedPid,
        hypothetical_request: requestVec,
      })
      setHypotheticalResult((env.result ?? null) as BankerCheckResponse | null)
      setStepIndex(0)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Invalid request payload.'
      setHypotheticalResult({
        would_approve: false,
        error_code: err instanceof ApiError ? err.code : 'ERROR',
        reason: msg,
      })
    } finally {
      setChecking(false)
    }
  }

  const handleExecuteRequest = async () => {
    if (!sessionId || !selectedPid) return
    setChecking(true)
    try {
      const env = await apiClient.requestResources(sessionId, {
        process_id: selectedPid,
        request: requestVec,
        use_banker: true,
      })
      applyEnvelope(env)
      const res = env.result as { granted?: boolean; reason?: string } | undefined
      setHypotheticalResult(null)
      pushToast({
        severity: res?.granted ? 'success' : 'warning',
        title: res?.granted ? 'Request Granted' : 'Request Rejected / Blocked',
        message: res?.reason ?? 'Evaluated by Banker safety guard.',
      })
    } catch (err) {
      pushToast({
        severity: 'error',
        title: 'Request Rejected',
        message: err instanceof Error ? err.message : 'Invalid resource request.',
      })
    } finally {
      setChecking(false)
    }
  }

  if (!simState || !activeReport) return null

  const finishSnapshot = activeStep?.finish_snapshot ?? {}

  return (
    <section
      aria-label="Banker's Algorithm Laboratory"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Banker&apos;s Algorithm &amp; Safety Avoidance Lab
            </h1>
            <p className="text-[11px] text-slate-400">
              Need = Max − Allocation • Evaluates Request ≤ Need, Request ≤ Available, and Safety
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`border px-2.5 py-0.5 text-xs font-mono-tabular font-semibold ${
              activeReport.is_safe
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-400/60 bg-amber-500/15 text-amber-300'
            }`}
          >
            {activeReport.is_safe ? 'SAFE STATE' : 'UNSAFE STATE'}
          </span>
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleRunSafetyCheck()}
            className="min-h-8 border border-cyan-400/70 bg-cyan-500/15 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            Run Safety Algorithm
          </button>
        </div>
      </div>

      {/* Safe Sequence & Playback Controls */}
      <div className="border-b border-[#202a4d] bg-[#0b1022] px-4 py-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-300">{activeReport.explanation}</span>
          {activeReport.safe_sequence.length > 0 ? (
            <div className="flex items-center gap-1 font-mono-tabular">
              <span className="text-[10px] text-slate-400 uppercase mr-1">Safe Sequence:</span>
              {activeReport.safe_sequence.map((pid, idx) => (
                <React.Fragment key={pid}>
                  {idx > 0 ? <span className="text-slate-500">→</span> : null}
                  <span
                    className={`border px-1.5 py-0.5 text-[11px] ${
                      activeStep?.selected_process === pid
                        ? 'border-cyan-400 bg-cyan-500/25 text-cyan-100 font-semibold'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    }`}
                  >
                    {pid}
                  </span>
                </React.Fragment>
              ))}
            </div>
          ) : null}
        </div>

        <TracePlaybackControls
          label="Banker safety trace playback"
          totalSteps={steps.length}
          currentStep={stepIndex}
          onStepChange={setStepIndex}
        />
      </div>

      {/* Main Content */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
        {/* Matrices */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="banker-matrices-caption"
            className="overflow-auto border border-[#253057] bg-[#0a0f20]"
          >
            <table className="w-full border-collapse text-left text-xs font-mono-tabular">
              <caption
                id="banker-matrices-caption"
                className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase"
              >
                Allocation, Max, Need &amp; Finish Matrices ({resources.map((r) => r.id).join(', ')})
              </caption>
              <thead className="sticky top-0 bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Process</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Allocation</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Max</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Need (Max−Alloc)</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Finish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2442]">
                {activeProcesses.map((proc) => {
                  const isStepProc = activeStep?.selected_process === proc.id
                  const finished = finishSnapshot[proc.id] ?? false
                  return (
                    <tr
                      key={proc.id}
                      className={isStepProc ? 'bg-cyan-500/15 text-cyan-100' : 'text-slate-200'}
                    >
                      <th scope="row" className="px-3 py-2 font-semibold">
                        {proc.id}
                      </th>
                      <td className="px-3 py-2">
                        [{resources.map((r) => proc.allocated[r.id] ?? 0).join(', ')}]
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        [{resources.map((r) => proc.max_demand[r.id] ?? 0).join(', ')}]
                      </td>
                      <td className="px-3 py-2 text-amber-200">
                        [{resources.map((r) => proc.need[r.id] ?? 0).join(', ')}]
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`border px-1.5 py-0.5 text-[10px] ${
                            finished
                              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 font-mono-tabular text-xs">
            <div className="border border-[#253057] bg-[#0a0f20] p-3">
              <div className="text-[10px] text-slate-400 uppercase">Current Available Vector</div>
              <div className="mt-1 text-sm font-semibold text-emerald-300">
                [{resources.map((r) => `${r.id}:${r.available_instances}`).join('  ')}]
              </div>
            </div>
            <div className="border border-[#253057] bg-[#0a0f20] p-3">
              <div className="text-[10px] text-slate-400 uppercase">Work Vector (Active Step)</div>
              <div className="mt-1 text-sm font-semibold text-cyan-300">
                [
                {resources
                  .map((r) => `${r.id}:${activeStep?.work_after[r.id] ?? r.available_instances}`)
                  .join('  ')}
                ]
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Hypothetical Request Evaluator & Safe Execution */}
        <div className="flex flex-col gap-3">
          <form
            onSubmit={(e) => void handleEvaluateHypothetical(e)}
            aria-labelledby="hyp-request-title"
            className="border border-[#253057] bg-[#0a0f20] p-3 text-xs space-y-3"
          >
            <div>
              <h2
                id="hyp-request-title"
                className="font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase"
              >
                Resource Request Evaluator
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Test a request without mutating state, or execute safely via C++ Banker guard.
              </p>
            </div>

            <div>
              <label htmlFor={procSelectId} className="block text-[11px] font-medium text-slate-300">
                Target Process
              </label>
              <select
                id={procSelectId}
                value={selectedPid}
                onChange={(e) => setSelectedPid(e.target.value)}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100"
              >
                {activeProcesses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="space-y-2 border border-[#1f294a] p-2.5">
              <legend className="px-1 text-[10px] font-semibold text-slate-400 uppercase">
                Request Vector
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {resources.map((r) => {
                  const inputId = `banker-req-${r.id}`
                  return (
                    <div key={r.id}>
                      <label htmlFor={inputId} className="block text-[10px] font-mono-tabular text-slate-300">
                        {r.id} (Avail {r.available_instances})
                      </label>
                      <input
                        id={inputId}
                        type="number"
                        min={0}
                        value={requestVec[r.id] ?? 0}
                        onChange={(e) =>
                          setRequestVec((prev) => ({
                            ...prev,
                            [r.id]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                      />
                    </div>
                  )
                })}
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={checking || !selectedPid}
                className="flex-1 min-h-8 border border-[#304075] bg-[#131b38] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-cyan-400 disabled:opacity-50"
              >
                Check Hypothetical
              </button>
              <button
                type="button"
                disabled={checking || !selectedPid}
                onClick={() => void handleExecuteRequest()}
                className="flex-1 min-h-8 inline-flex items-center justify-center gap-1 border border-emerald-400/70 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Execute Safe
              </button>
            </div>
          </form>

          {hypotheticalResult ? (
            <div
              role="status"
              className={`border p-3 text-xs ${
                hypotheticalResult.would_approve
                  ? 'border-emerald-500/60 bg-emerald-950/30 text-emerald-200'
                  : 'border-rose-500/60 bg-rose-950/30 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-display font-semibold uppercase">
                {hypotheticalResult.would_approve ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                ) : hypotheticalResult.error_code === 'UNSAFE_STATE_REJECTED' ? (
                  <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />
                )}
                <span>
                  {hypotheticalResult.would_approve
                    ? 'Hypothetical Request: SAFE TO GRANT'
                    : `Rejected (${hypotheticalResult.error_code ?? 'DENIED'})`}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-200">{hypotheticalResult.reason}</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
