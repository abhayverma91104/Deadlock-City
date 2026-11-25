import React, { useId, useState } from 'react'
import { AlertTriangle, BookmarkPlus, CheckCircle2, History, ShieldAlert, Wrench } from 'lucide-react'
import { ApiError, apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { RecoveryResultPayload, SimulationState } from '../types/simulation'
import { NativeDialog } from '../components/ui/NativeDialog'
import { SafetyBadge } from '../components/ui/StatusBadge'

type Strategy = 'terminate_victim' | 'terminate_all' | 'preempt_resource' | 'rollback'
type VictimCriteria = 'lowest_cost' | 'lowest_priority' | 'least_allocated' | 'lowest_remaining_work'

export const RecoveryCenter: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const simState = useSimulationStore((s) => s.simState)
  const applyEnvelope = useSimulationStore((s) => s.applyEnvelope)
  const pushToast = useSimulationStore((s) => s.pushToast)

  const [strategy, setStrategy] = useState<Strategy>('terminate_victim')
  const [criteria, setCriteria] = useState<VictimCriteria>('lowest_cost')
  const [targetPid, setTargetPid] = useState<string>('')
  const [targetRid, setTargetRid] = useState<string>('')
  const [checkpointIndex, setCheckpointIndex] = useState<number>(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [beforeSnap, setBeforeSnap] = useState<SimulationState | null>(null)
  const [lastResult, setLastResult] = useState<RecoveryResultPayload | null>(null)

  const strategyId = useId()
  const criteriaId = useId()
  const targetPidId = useId()
  const targetRidId = useId()
  const cpSelectId = useId()

  if (!simState) return null

  const deadlockedIds = simState.deadlock_report.deadlocked_processes
  const deadlockedProcs = simState.processes.filter((p) => deadlockedIds.includes(p.id))
  const preemptibleResources = simState.resources.filter((r) => r.preemptible)
  const checkpoints = simState.checkpoints ?? []

  const handleCreateCheckpoint = async () => {
    if (!sessionId) return
    setSubmitting(true)
    try {
      const env = await apiClient.createCheckpoint(sessionId)
      applyEnvelope(env)
      pushToast({
        severity: 'success',
        title: 'Checkpoint Saved',
        message: `Saved rollback checkpoint at Tick ${env.state.tick}.`,
      })
    } catch (err) {
      pushToast({
        severity: 'error',
        title: 'Checkpoint Error',
        message: err instanceof Error ? err.message : 'Unable to save checkpoint.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const executeRecovery = async () => {
    if (!sessionId) return
    const snapshotBefore = structuredClone(simState)
    setSubmitting(true)
    setConfirmOpen(false)
    try {
      const env = await apiClient.recoverDeadlock(sessionId, {
        strategy,
        victim_criteria: criteria,
        target_process_id: targetPid || undefined,
        target_resource_id: targetRid || undefined,
        checkpoint_index: strategy === 'rollback' && checkpoints.length > 0 ? checkpointIndex : undefined,
      })
      applyEnvelope(env)
      setBeforeSnap(snapshotBefore)
      const res = (env.result ?? null) as RecoveryResultPayload | null
      setLastResult(res)
      pushToast({
        severity: 'success',
        title: 'Recovery Executed',
        message: res?.message ?? 'Recovery completed.',
      })
    } catch (err) {
      if (err instanceof ApiError && err.state && sessionId) {
        applyEnvelope({
          session_id: err.sessionId ?? sessionId,
          state: err.state,
          result: err.result ?? null,
        })
        setBeforeSnap(snapshotBefore)
        setLastResult((err.result ?? null) as RecoveryResultPayload | null)
      }
      pushToast({
        severity: err instanceof ApiError && err.state ? 'warning' : 'error',
        title: err instanceof ApiError && err.state ? 'Partial Recovery (Deadlock Remains)' : 'Recovery Failed',
        message: err instanceof Error ? err.message : 'Recovery operation rejected.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-label="Deadlock Recovery Center"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Wrench className="h-4 w-4 text-amber-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Deadlock Recovery Center
            </h1>
            <p className="text-[11px] text-slate-400">
              Mutating recovery via C++ RecoveryManager • Recoveries: {simState.recovery_count} • Preemptions: {simState.preemption_count}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SafetyBadge status={simState.safety_status} />
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleCreateCheckpoint()}
            className="inline-flex min-h-8 items-center gap-1.5 border border-[#2e3e73] bg-[#111834] px-3 text-xs text-cyan-200 hover:border-cyan-400 disabled:opacity-50"
          >
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Save Checkpoint ({checkpoints.length})
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
        {/* Left: Deadlocked Processes & Held Resources */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="recovery-deadlocked-caption"
            className="overflow-auto border border-[#253057] bg-[#0a0f20]"
          >
            <table className="w-full border-collapse text-left text-xs font-mono-tabular">
              <caption
                id="recovery-deadlocked-caption"
                className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold tracking-wider text-rose-300 uppercase"
              >
                Currently Deadlocked Processes ({deadlockedProcs.length})
              </caption>
              <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Process</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Priority / Cost</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Held Resources</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Pending Request</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2442]">
                {deadlockedProcs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center font-sans text-slate-400">
                      No processes are currently deadlocked. Load a deadlock preset or use checkpoint rollback to test recovery.
                    </td>
                  </tr>
                ) : (
                  deadlockedProcs.map((proc) => {
                    const held = Object.entries(proc.allocated)
                      .filter(([, q]) => q > 0)
                      .map(([r, q]) => `${r}×${q}`)
                      .join(', ')
                    const req = Object.entries(proc.pending_request)
                      .filter(([, q]) => q > 0)
                      .map(([r, q]) => `${r}×${q}`)
                      .join(', ')
                    return (
                      <tr key={proc.id} className="bg-rose-950/20 text-rose-100">
                        <th scope="row" className="px-3 py-2 font-semibold">
                          {proc.id} <span className="font-sans text-[10px] font-normal text-slate-300">({proc.name})</span>
                        </th>
                        <td className="px-3 py-2">
                          P{proc.priority} / ${proc.termination_cost}
                        </td>
                        <td className="px-3 py-2 text-cyan-300">{held || 'None'}</td>
                        <td className="px-3 py-2 text-amber-300">{req || 'None'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Before / After Recovery Comparison */}
          {lastResult && beforeSnap ? (
            <div className="border border-emerald-500/40 bg-[#0a1322] p-3.5 text-xs space-y-2.5">
              <div className="flex items-center justify-between border-b border-[#21334d] pb-2">
                <span className="flex items-center gap-2 font-display font-semibold text-emerald-300 uppercase">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Recovery Report &amp; Before/After Snapshot Comparison
                </span>
                <span className="font-mono-tabular text-[11px] text-slate-300">
                  {beforeSnap.safety_status} → {simState.safety_status}
                </span>
              </div>
              <p className="text-slate-200">{lastResult.message}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono-tabular text-[11px]">
                <div className="border border-[#20304f] bg-[#0d182b] p-2">
                  <div className="text-[10px] text-slate-400 uppercase">Affected / Terminated</div>
                  <div className="mt-1 text-rose-300">
                    {lastResult.terminated_processes.length > 0
                      ? lastResult.terminated_processes.join(', ')
                      : lastResult.preempted_resources.length > 0
                        ? `Preempted ${lastResult.preempted_resources.join(', ')}`
                        : lastResult.restored_checkpoint_index !== null
                          ? `Checkpoint #${lastResult.restored_checkpoint_index}`
                          : 'None'}
                  </div>
                </div>
                <div className="border border-[#20304f] bg-[#0d182b] p-2">
                  <div className="text-[10px] text-slate-400 uppercase">Recovered Units</div>
                  <div className="mt-1 text-cyan-300">
                    {Object.entries(lastResult.recovered_units)
                      .filter(([, q]) => q > 0)
                      .map(([r, q]) => `${r}×${q}`)
                      .join(', ') || 'Restored Snapshot'}
                  </div>
                </div>
                <div className="border border-[#20304f] bg-[#0d182b] p-2">
                  <div className="text-[10px] text-slate-400 uppercase">Surviving / Unblocked</div>
                  <div className="mt-1 text-emerald-300">
                    {lastResult.surviving_processes.length} alive
                    {lastResult.unblocked_processes.length > 0
                      ? ` (${lastResult.unblocked_processes.join(', ')} unblocked)`
                      : ''}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Recovery Strategy Form */}
        <div className="flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setConfirmOpen(true)
            }}
            className="border border-[#253057] bg-[#0a0f20] p-3 text-xs space-y-3"
          >
            <h2 className="font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
              Configure Recovery Action
            </h2>

            <div>
              <label htmlFor={strategyId} className="block text-[11px] font-medium text-slate-300">
                Recovery Strategy
              </label>
              <select
                id={strategyId}
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as Strategy)}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="terminate_victim">Terminate Victim Process</option>
                <option value="terminate_all">Terminate All Deadlocked</option>
                <option value="preempt_resource">Preempt Resource</option>
                <option value="rollback">Rollback to Checkpoint</option>
              </select>
            </div>

            {strategy === 'terminate_victim' || strategy === 'preempt_resource' ? (
              <>
                <div>
                  <label htmlFor={criteriaId} className="block text-[11px] font-medium text-slate-300">
                    Victim Selection Criteria
                  </label>
                  <select
                    id={criteriaId}
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value as VictimCriteria)}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 text-xs text-slate-100"
                  >
                    <option value="lowest_cost">Lowest Termination Cost</option>
                    <option value="lowest_priority">Lowest Priority</option>
                    <option value="least_allocated">Least Allocated Resources</option>
                    <option value="lowest_remaining_work">Lowest Remaining Work</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={targetPidId} className="block text-[11px] font-medium text-slate-300">
                    Optional Specific Process (Auto if blank)
                  </label>
                  <select
                    id={targetPidId}
                    value={targetPid}
                    onChange={(e) => setTargetPid(e.target.value)}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100"
                  >
                    <option value="">Auto-select via criteria</option>
                    {simState.processes
                      .filter((p) => p.state !== 'TERMINATED')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} — {p.name}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            ) : null}

            {strategy === 'preempt_resource' ? (
              <div>
                <label htmlFor={targetRidId} className="block text-[11px] font-medium text-slate-300">
                  Preemptible Resource (Auto if blank)
                </label>
                <select
                  id={targetRidId}
                  value={targetRid}
                  onChange={(e) => setTargetRid(e.target.value)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100"
                >
                  <option value="">Auto-select preemptible</option>
                  {preemptibleResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} — {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {strategy === 'rollback' ? (
              <div>
                <label htmlFor={cpSelectId} className="block text-[11px] font-medium text-slate-300">
                  Target Checkpoint ({checkpoints.length} saved)
                </label>
                <select
                  id={cpSelectId}
                  value={checkpointIndex}
                  onChange={(e) => setCheckpointIndex(Number(e.target.value) || 0)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100"
                >
                  {checkpoints.length === 0 ? (
                    <option value={0}>No checkpoints available</option>
                  ) : (
                    checkpoints.map((_, idx) => (
                      <option key={idx} value={idx}>
                        Checkpoint #{idx}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}

            <div className="border border-[#202a4d] bg-[#0c1226] p-2 text-[11px] text-slate-400">
              <History className="mr-1.5 inline h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              Non-mutating recovery preview is not supported by the C++ engine; executing recovery directly mutates canonical state.
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-9 border border-amber-400/70 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
            >
              Execute Recovery Strategy
            </button>
          </form>
        </div>
      </div>

      {/* Confirmation Modal */}
      <NativeDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm Destructive Recovery Operation"
        subtitle="This operation mutates live C++ simulation state."
      >
        <div className="space-y-4 text-xs">
          <div className="flex items-start gap-2.5 border border-amber-500/40 bg-amber-950/30 p-3 text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">Strategy: {strategy.replace('_', ' ').toUpperCase()}</p>
              <p className="mt-1 text-slate-300">
                {strategy === 'terminate_all'
                  ? `All ${deadlockedIds.length} deadlocked processes will be terminated and their held resources reclaimed.`
                  : strategy === 'terminate_victim'
                    ? `Selected victim (${targetPid || criteria}) will be terminated and its resources reclaimed.`
                    : strategy === 'preempt_resource'
                      ? `Resource units will be forcibly preempted from a holding process.`
                      : `Simulation state will roll back to Checkpoint #${checkpointIndex}.`}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmOpen(false)}
              className="min-h-8 border border-[#304075] bg-[#121936] px-3 py-1.5 text-slate-200 hover:border-cyan-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void executeRecovery()}
              className="inline-flex min-h-8 items-center gap-1.5 border border-rose-500 bg-rose-500/20 px-3 py-1.5 font-semibold text-rose-200 hover:bg-rose-500/30"
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Confirm Recovery
            </button>
          </div>
        </div>
      </NativeDialog>
    </section>
  )
}
