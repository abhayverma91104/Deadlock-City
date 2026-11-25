import React, { useState } from 'react'
import { ArrowUpRight, CheckCircle2, FlaskConical, Loader2, Play } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { NavTabId } from '../types/simulation'

interface GuidedExperimentDef {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  title: string
  subtitle: string
  objective: string
  initialConditions: string
  steps: string[]
  expectedObservations: string
  shortcuts: Array<{ label: string; tab: NavTabId }>
}

interface GuidedRunResult {
  executedAt: string
  headline: string
  rows: Array<{ label: string; status: string; metric: string; detail: string }>
  explanation: string
}

const GUIDED_EXPERIMENTS: GuidedExperimentDef[] = [
  {
    id: 'A',
    title: 'Experiment A: Deadlock Prevention / Avoidance',
    subtitle: "Compare resource allocation with Banker's Algorithm enabled vs. disabled",
    objective:
      'Demonstrate how pre-grant safety simulation blocks unsafe allocations before a deadlock cycle can form.',
    initialConditions: 'Preset: classic_banker_safe (Seed 42), P4 requests [R0:3, R1:3, R2:0].',
    steps: [
      'Initialize identical classic_banker_safe snapshots (Available [3, 3, 2]).',
      'Arm 1 (Banker ON): evaluate P4 request [3, 3, 0] through C++ BankersAlgorithm.',
      'Arm 2 (Banker OFF): allocate [3, 3, 0] directly without safety verification.',
      'Compare resulting safety_status and remaining Safe Sequence.',
    ],
    expectedObservations:
      'Banker ON rejects the request cleanly (SAFE maintained); Banker OFF grants and enters UNSAFE.',
    shortcuts: [
      { label: "Banker's Lab", tab: 'banker' },
      { label: 'Process / Resource Mgr', tab: 'processes' },
    ],
  },
  {
    id: 'B',
    title: 'Experiment B: Unsafe State vs. Deadlock',
    subtitle: 'Distinguish an unsafe state (lost safety guarantee) from confirmed runtime deadlock',
    objective:
      'Verify empirically via C++ Banker + DeadlockDetector that UNSAFE does not automatically imply DEADLOCKED.',
    initialConditions: 'Preset: unsafe_no_deadlock (Seed 42) — Backup-A & Backup-B holding 3/4 R0, 1/2 R1.',
    steps: [
      'Load unsafe_no_deadlock in the active session (or isolated verification) without deadlock.',
      'Run C++ BankersAlgorithm safety verification.',
      'Run C++ DeadlockDetector allocation/request matrix verification.',
      'Inspect pending requests, safe_sequence, and deadlocked_processes.',
    ],
    expectedObservations:
      'banker_report.is_safe = false (UNSAFE), while deadlock_report.detected = false (0 deadlocked processes).',
    shortcuts: [
      { label: 'Detection Lab', tab: 'detection' },
      { label: "Banker's Lab", tab: 'banker' },
    ],
  },
  {
    id: 'C',
    title: 'Experiment C: Multiple-Instance Resources & RAG Cycles',
    subtitle: 'Show why a Resource Allocation Graph cycle alone cannot prove deadlock with multiple instances',
    objective:
      'Contrast structural RAG cycle detection against matrix-based Work/Finish deadlock detection.',
    initialConditions: 'Preset: multi_instance_safe_cycle (Seed 42) — R0 has 2 instances held by P0 and P2.',
    steps: [
      'Load multi_instance_safe_cycle and compute the RAG & Wait-For Graph in C++.',
      'Observe the cycle P0 -> R1 -> P1 -> R0 -> P0.',
      'Execute C++ DeadlockDetector to test whether P2 (Finisher-2) releases R0.',
    ],
    expectedObservations:
      'has_cycle_in_rag = true, yet deadlock_detected = false because P2 completes and breaks the wait chain.',
    shortcuts: [
      { label: 'RAG Graph', tab: 'graph' },
      { label: 'Detection Lab', tab: 'detection' },
    ],
  },
  {
    id: 'D',
    title: 'Experiment D: Recovery Strategy Comparison',
    subtitle: 'Compare process termination, victim selection, resource preemption, and checkpoint rollback',
    objective:
      'Measure tradeoffs in lost work, preemptions, recovered units, and post-recovery safety from identical deadlocks.',
    initialConditions: 'Preset: recovery_demo (Seed 42) — 3-process circular wait + preemptible R1 + Checkpoint #0.',
    steps: [
      'Clone identical deadlocked recovery_demo initial states across 4 isolated C++ runs.',
      'Run TERMINATE_ALL, TERMINATE_VICTIM (lowest_cost), PREEMPT_RESOURCE, and ROLLBACK (#0).',
      'Compare surviving processes, terminated processes, recovered units, and final safety status.',
    ],
    expectedObservations:
      'TERMINATE_VICTIM saves 2 processes vs 0 for TERMINATE_ALL; PREEMPT preserves all 3 processes; ROLLBACK restores tick 0 SAFE state.',
    shortcuts: [
      { label: 'Recovery Center', tab: 'recovery' },
      { label: 'RAG Graph', tab: 'graph' },
    ],
  },
  {
    id: 'E',
    title: 'Experiment E: CPU Scheduling Comparison',
    subtitle: 'Benchmark FCFS, SJF, SRTF, Non-Preemptive Priority, and Round Robin on identical arrivals',
    objective:
      'Quantify waiting time, turnaround time, response time, and context-switch overhead across C++ schedulers.',
    initialConditions: 'Workload: P1(0,6,p2), P2(1,3,p1), P3(2,2,p4), P4(4,4,p3), Quantum = 2.',
    steps: [
      'Submit the exact 4-process workload to C++ CPUScheduler::compare_all.',
      'Compare Average Waiting Time, Turnaround Time, Response Time, and Context Switches.',
    ],
    expectedObservations:
      'SRTF achieves minimum average waiting/turnaround time while incurring extra preemptive context switches vs SJF/FCFS.',
    shortcuts: [{ label: 'CPU Scheduling Lab', tab: 'scheduling' }],
  },
  {
    id: 'F',
    title: 'Experiment F: Synchronization Comparison',
    subtitle: 'Contrast mutex/condition-variable synchronization vs unsynchronized races & circular wait',
    objective:
      'Observe real C++ std::thread execution anomalies (circular-wait timeouts vs clean completion).',
    initialConditions: 'Scenario: Dining Philosophers (5 threads × 6 iterations) in Safe vs Unsafe mode.',
    steps: [
      'Execute C++ SyncLab in Safe mode (asymmetric lock hierarchy).',
      'Execute C++ SyncLab in Unsafe mode (uniform left-then-right lock acquisition with timeout).',
      'Compare completed meals, race/deadlock flags, and recorded thread events.',
    ],
    expectedObservations:
      'Safe mode completes 30/30 meals cleanly; Unsafe mode hits circular-wait timeouts (incomplete meals).',
    shortcuts: [{ label: 'Synchronization Lab', tab: 'sync' }],
  },
]

export const GuidedExperimentsPanel: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const setActiveTab = useSimulationStore((s) => s.setActiveTab)
  const selectPreset = useSimulationStore((s) => s.selectPreset)

  const [selectedId, setSelectedId] = useState<'A' | 'B' | 'C' | 'D' | 'E' | 'F'>('A')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, GuidedRunResult>>({})
  const [error, setError] = useState<string | null>(null)

  const activeDef = GUIDED_EXPERIMENTS.find((e) => e.id === selectedId) ?? GUIDED_EXPERIMENTS[0]!
  const activeResult = results[activeDef.id]

  const runExperiment = async (exp: GuidedExperimentDef) => {
    setRunningId(exp.id)
    setError(null)
    try {
      const nowStr = new Date().toISOString().slice(11, 19) + 'Z'
      if (exp.id === 'A') {
        const comp = await apiClient.compareExperiments({
          mode: 'avoidance',
          preset: 'classic_banker_safe',
          seed: 42,
          steps_after: 1,
        })
        setResults((prev) => ({
          ...prev,
          A: {
            executedAt: nowStr,
            headline: 'Banker Guard vs. Unguarded Allocation (classic_banker_safe)',
            rows: comp.arms.map((a) => ({
              label: a.label,
              status: a.safety_status,
              metric: a.primary_metric,
              detail: a.summary,
            })),
            explanation: `Observed from live C++ engine: ${comp.arms.map((a) => `${a.label} ended ${a.safety_status} (${a.primary_metric})`).join('; ')}.`,
          },
        }))
      } else if (exp.id === 'B') {
        const created = await apiClient.createSimulation({ preset: 'unsafe_no_deadlock', seed: 42 })
        const bank = await apiClient.checkBanker(created.session_id, {})
        const det = await apiClient.detectDeadlock(created.session_id)
        const bankSafe = bank.state.banker_report.is_safe
        const dlDetected = det.state.deadlock_report.detected
        setResults((prev) => ({
          ...prev,
          B: {
            executedAt: nowStr,
            headline: `Verified on isolated session ${created.session_id} (unsafe_no_deadlock)`,
            rows: [
              {
                label: "Banker's Safety Check",
                status: bankSafe ? 'SAFE' : 'UNSAFE',
                metric: `SafeSeq=${bank.state.banker_report.safe_sequence.length}`,
                detail: bank.state.banker_report.explanation,
              },
              {
                label: 'Deadlock Detector',
                status: dlDetected ? 'DEADLOCKED' : 'NO DEADLOCK',
                metric: `Deadlocked=${det.state.deadlock_report.deadlocked_processes.length}`,
                detail: det.state.deadlock_report.explanation,
              },
            ],
            explanation: `Live C++ Banker reported is_safe=${String(bankSafe)} (${det.state.safety_status}), while C++ DeadlockDetector reported detected=${String(dlDetected)} — proving an unsafe state has no guaranteed completion sequence without being blocked yet.`,
          },
        }))
      } else if (exp.id === 'C') {
        const created = await apiClient.createSimulation({ preset: 'multi_instance_safe_cycle', seed: 42 })
        const graphRes = await apiClient.getGraph(created.session_id)
        const g = graphRes.graph
        setResults((prev) => ({
          ...prev,
          C: {
            executedAt: nowStr,
            headline: `Verified on isolated session ${created.session_id} (multi_instance_safe_cycle)`,
            rows: [
              {
                label: 'Structural RAG Cycle Check',
                status: g.has_cycle ? 'CYCLE PRESENT' : 'ACYCLIC',
                metric: `${g.cycles.length} cycle(s)`,
                detail: g.cycles.map((c) => c.join(' → ')).join('; ') || 'No cycle',
              },
              {
                label: 'Authoritative C++ Deadlock Detection',
                status: g.deadlock_detected ? 'DEADLOCKED' : 'NOT DEADLOCKED',
                metric: `Deadlocked=${g.deadlocked_processes.length}`,
                detail: graphRes.state.deadlock_report.explanation,
              },
            ],
            explanation: `C++ RAG builder detected cycle (${g.cycles[0]?.join(' → ') ?? 'cycle'}), yet DeadlockDetector confirmed deadlock_detected=${String(g.deadlock_detected)} because P2 can release an instance of multi-unit R0.`,
          },
        }))
      } else if (exp.id === 'D') {
        const comp = await apiClient.compareExperiments({
          mode: 'recovery',
          preset: 'recovery_demo',
          seed: 42,
        })
        setResults((prev) => ({
          ...prev,
          D: {
            executedAt: nowStr,
            headline: 'All 4 Recovery Strategies Evaluated from Identical Deadlock (recovery_demo)',
            rows: comp.arms.map((a) => ({
              label: a.label,
              status: a.safety_status,
              metric: a.primary_metric,
              detail: a.summary,
            })),
            explanation: `Compared 4 independent C++ recoveries from ${comp.initial_safety_status}: ${comp.arms.map((a) => `${a.label} -> ${a.safety_status}`).join(', ')}.`,
          },
        }))
      } else if (exp.id === 'E') {
        const comp = await apiClient.compareExperiments({
          mode: 'scheduling',
          quantum: 2,
          seed: 42,
        })
        const bestWt = [...(comp.comparisons ?? [])].sort((a, b) => a.avg_waiting_time - b.avg_waiting_time)[0]
        setResults((prev) => ({
          ...prev,
          E: {
            executedAt: nowStr,
            headline: 'C++ CPUScheduler Benchmark Across All 5 Algorithms (Quantum = 2)',
            rows: comp.arms.map((a) => ({
              label: a.label,
              status: `Total ${a.tick}t`,
              metric: a.primary_metric,
              detail: a.summary,
            })),
            explanation: bestWt
              ? `Lowest average waiting time observed was ${bestWt.algorithm} at ${bestWt.avg_waiting_time.toFixed(2)} ticks (${bestWt.context_switches} context switches).`
              : comp.expectation,
          },
        }))
      } else {
        const comp = await apiClient.compareExperiments({
          mode: 'synchronization',
          sync_scenario: 'dining_philosophers',
          sync_iterations: 6,
          seed: 42,
        })
        setResults((prev) => ({
          ...prev,
          F: {
            executedAt: nowStr,
            headline: 'C++17 std::thread Dining Philosophers: Safe vs. Unsafe',
            rows: comp.arms.map((a) => ({
              label: a.label,
              status: a.safety_status,
              metric: a.primary_metric,
              detail: a.summary,
            })),
            explanation: `Live C++ thread execution confirmed: ${comp.arms.map((a) => `${a.label}: ${a.summary}`).join(' | ')}.`,
          },
        }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guided experiment execution failed.')
    } finally {
      setRunningId(null)
    }
  }

  const openInActiveCity = async (exp: GuidedExperimentDef) => {
    if (exp.id === 'A') await selectPreset('classic_banker_safe', 42)
    else if (exp.id === 'B') await selectPreset('unsafe_no_deadlock', 42)
    else if (exp.id === 'C') await selectPreset('multi_instance_safe_cycle', 42)
    else if (exp.id === 'D') await selectPreset('recovery_demo', 42)
    if (exp.shortcuts[0]) setActiveTab(exp.shortcuts[0].tab)
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Left Experiment Selector */}
      <div className="space-y-2">
        <div className="border border-[#253057] bg-[#0a0f20] p-2.5 text-xs">
          <div className="mb-2 font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
            Guided OS Laboratory Modules
          </div>
          <div className="space-y-1.5">
            {GUIDED_EXPERIMENTS.map((exp) => {
              const active = exp.id === selectedId
              const done = Boolean(results[exp.id])
              return (
                <button
                  key={exp.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(exp.id)}
                  className={`flex w-full items-start justify-between gap-2 border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-slate-100'
                      : 'border-[#212b4f] bg-[#0e152b] text-slate-300 hover:border-cyan-400/50'
                  }`}
                >
                  <div>
                    <div className="font-display text-[11px] font-semibold text-cyan-200">
                      {exp.title}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{exp.subtitle}</div>
                  </div>
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Completed" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Right Experiment Details & Live Results */}
      <div className="xl:col-span-2 space-y-3">
        {error ? (
          <div role="alert" className="border border-rose-500/60 bg-rose-950/35 p-3 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="border border-[#253057] bg-[#0a0f20] p-4 text-xs space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#202a4d] pb-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wider text-cyan-300 uppercase">
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                {activeDef.title}
              </h2>
              <p className="mt-0.5 text-slate-300">{activeDef.objective}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={runningId !== null}
                onClick={() => void runExperiment(activeDef)}
                className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {runningId === activeDef.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Run Live C++ Experiment
              </button>
              {sessionId && ['A', 'B', 'C', 'D'].includes(activeDef.id) ? (
                <button
                  type="button"
                  onClick={() => void openInActiveCity(activeDef)}
                  className="inline-flex min-h-8 items-center gap-1 border border-[#304075] bg-[#121936] px-2.5 py-1.5 text-[11px] text-slate-200 hover:border-cyan-400"
                >
                  Load in City &amp; Inspect
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
              <div className="font-display text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Initial Conditions
              </div>
              <p className="mt-1 font-mono-tabular text-[11px] text-slate-200">
                {activeDef.initialConditions}
              </p>
            </div>
            <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
              <div className="font-display text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Theoretical Expectation
              </div>
              <p className="mt-1 text-[11px] text-amber-200">{activeDef.expectedObservations}</p>
            </div>
          </div>

          <div>
            <div className="font-display text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Procedure Steps
            </div>
            <ol className="mt-1.5 list-decimal list-inside space-y-1 text-[11px] text-slate-300">
              {activeDef.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[#1e2747] pt-2.5">
            <span className="text-[10px] text-slate-400 uppercase">Workbench Shortcuts:</span>
            {activeDef.shortcuts.map((sc) => (
              <button
                key={sc.tab}
                type="button"
                onClick={() => setActiveTab(sc.tab)}
                className="inline-flex items-center gap-1 border border-[#2b3968] bg-[#111834] px-2.5 py-1 text-[11px] text-cyan-200 hover:border-cyan-400"
              >
                {sc.label}
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        {/* Observed Live Results */}
        {activeResult ? (
          <div className="border border-emerald-500/50 bg-[#0a1322] p-4 text-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#203350] pb-2">
              <span className="font-display font-semibold text-emerald-300 uppercase">
                Observed Results — {activeResult.headline}
              </span>
              <span className="font-mono-tabular text-[10px] text-slate-400">
                Executed {activeResult.executedAt}
              </span>
            </div>

            <div className="overflow-auto border border-[#223055] bg-[#0a0f20]">
              <table className="w-full border-collapse text-left text-xs font-mono-tabular">
                <caption className="sr-only">{activeResult.headline}</caption>
                <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Run / Arm</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Outcome</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Measured Metric</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Engine Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2442]">
                  {activeResult.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="px-3 py-2 font-semibold text-cyan-200">{row.label}</th>
                      <td className="px-3 py-2 text-emerald-300">{row.status}</td>
                      <td className="px-3 py-2 text-amber-200">{row.metric}</td>
                      <td className="px-3 py-2 font-sans text-[11px] text-slate-300">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border border-[#20304f] bg-[#0d182b] p-2.5 text-[11px] text-slate-200">
              <strong className="text-cyan-300">Outcome Explanation: </strong>
              {activeResult.explanation}
            </div>
          </div>
        ) : (
          <div className="border border-[#253057] bg-[#0a0f20] p-6 text-center text-xs text-slate-400">
            Click &ldquo;Run Live C++ Experiment&rdquo; to execute this lab against the C++17 engine and capture real observed outputs.
          </div>
        )}
      </div>
    </div>
  )
}
