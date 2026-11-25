import React, { useState } from 'react'
import { Download, GitCompare, Loader2, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { apiClient } from '../services/api'
import type { ExperimentComparisonResponse, PresetCatalogItem } from '../types/simulation'
import { triggerBlobDownload } from './analyticsHelpers'

interface ComparativeEnginePanelProps {
  presets: PresetCatalogItem[]
  lastComparison: ExperimentComparisonResponse | null
  onComparisonComplete: (res: ExperimentComparisonResponse | null) => void
}

type CompareMode = 'avoidance' | 'recovery' | 'scheduling' | 'synchronization'

export const ComparativeEnginePanel: React.FC<ComparativeEnginePanelProps> = ({
  presets,
  lastComparison,
  onComparisonComplete,
}) => {
  const [mode, setMode] = useState<CompareMode>('avoidance')
  const [preset, setPreset] = useState('classic_banker_safe')
  const [seed, setSeed] = useState(42)
  const [stepsAfter, setStepsAfter] = useState(2)
  const [quantum, setQuantum] = useState(2)
  const [syncScenario, setSyncScenario] = useState<
    'producer_consumer' | 'readers_writers' | 'dining_philosophers'
  >('dining_philosophers')
  const [syncIterations, setSyncIterations] = useState(6)

  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleModeChange = (next: CompareMode) => {
    setMode(next)
    if (next === 'recovery' && !['recovery_demo', 'single_instance_deadlock', 'multiple_instance_deadlock'].includes(preset)) {
      setPreset('recovery_demo')
    } else if (next === 'avoidance' && ['recovery_demo', 'single_instance_deadlock', 'multiple_instance_deadlock'].includes(preset)) {
      setPreset('classic_banker_safe')
    }
  }

  const runComparison = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await apiClient.compareExperiments({
        mode,
        preset,
        seed,
        steps_after: stepsAfter,
        quantum,
        sync_scenario: syncScenario,
        sync_iterations: syncIterations,
        sync_buffer_size: 4,
      })
      onComparisonComplete(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparative execution failed.')
    } finally {
      setRunning(false)
    }
  }

  const handleExport = async (format: 'csv' | 'json') => {
    if (!lastComparison) return
    try {
      const { filename, blob } = await apiClient.downloadExperimentExport({
        kind: 'comparison',
        format,
        title: `compare-${lastComparison.mode}-${lastComparison.preset}-seed${lastComparison.seed}`,
        data: lastComparison as unknown as Record<string, unknown>,
      })
      triggerBlobDownload(filename, blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export comparison.')
    }
  }

  return (
    <div className="space-y-4">
      {/* Isolation Notice & Parameter Controls */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runComparison()
        }}
        className="border border-[#253057] bg-[#0a0f20] p-3.5 text-xs space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f294a] pb-2.5">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
              <GitCompare className="h-4 w-4" aria-hidden="true" />
              Isolated Side-by-Side Comparative Engine
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Clones identical initial conditions &amp; deterministic seed into isolated C++ runs.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-1 font-mono-tabular text-[10px] text-emerald-300 uppercase">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Active City Unmodified
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="cmp-mode" className="block text-[10px] text-slate-400 uppercase">
              Comparison Mode
            </label>
            <select
              id="cmp-mode"
              value={mode}
              onChange={(e) => handleModeChange(e.target.value as CompareMode)}
              className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="avoidance">Banker Avoidance ON vs OFF</option>
              <option value="recovery">All 4 Recovery Strategies</option>
              <option value="scheduling">All 5 CPU Schedulers</option>
              <option value="synchronization">Sync Lab Safe vs Unsafe</option>
            </select>
          </div>

          {mode === 'avoidance' || mode === 'recovery' ? (
            <div>
              <label htmlFor="cmp-preset" className="block text-[10px] text-slate-400 uppercase">
                Initial Preset
              </label>
              <select
                id="cmp-preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 text-xs text-slate-100"
              >
                {(presets.length > 0
                  ? presets
                  : [
                      { id: 'classic_banker_safe', name: "Classic Banker's Safe State" },
                      { id: 'normal_workload', name: 'Normal Workload' },
                      { id: 'recovery_demo', name: 'Recovery Experiment' },
                      { id: 'single_instance_deadlock', name: 'Single-Instance Deadlock' },
                      { id: 'multiple_instance_deadlock', name: 'Multi-Instance Deadlock' },
                    ]
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : mode === 'synchronization' ? (
            <div>
              <label htmlFor="cmp-sync-sc" className="block text-[10px] text-slate-400 uppercase">
                Sync Scenario
              </label>
              <select
                id="cmp-sync-sc"
                value={syncScenario}
                onChange={(e) =>
                  setSyncScenario(
                    e.target.value as 'producer_consumer' | 'readers_writers' | 'dining_philosophers',
                  )
                }
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="dining_philosophers">Dining Philosophers</option>
                <option value="producer_consumer">Producer-Consumer</option>
                <option value="readers_writers">Readers-Writers</option>
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="cmp-quantum" className="block text-[10px] text-slate-400 uppercase">
                RR Quantum (Ticks)
              </label>
              <input
                id="cmp-quantum"
                type="number"
                min={1}
                max={20}
                value={quantum}
                onChange={(e) => setQuantum(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 font-mono-tabular text-xs text-slate-100"
              />
            </div>
          )}

          <div>
            <label htmlFor="cmp-seed" className="block text-[10px] text-slate-400 uppercase">
              Deterministic Seed
            </label>
            <input
              id="cmp-seed"
              type="number"
              min={0}
              value={seed}
              onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 font-mono-tabular text-xs text-slate-100"
            />
          </div>

          {mode === 'avoidance' ? (
            <div>
              <label htmlFor="cmp-steps" className="block text-[10px] text-slate-400 uppercase">
                Post-Request Ticks
              </label>
              <input
                id="cmp-steps"
                type="number"
                min={0}
                max={20}
                value={stepsAfter}
                onChange={(e) => setStepsAfter(Math.min(20, Math.max(0, Number(e.target.value) || 0)))}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 font-mono-tabular text-xs text-slate-100"
              />
            </div>
          ) : mode === 'synchronization' ? (
            <div>
              <label htmlFor="cmp-iters" className="block text-[10px] text-slate-400 uppercase">
                Iterations
              </label>
              <input
                id="cmp-iters"
                type="number"
                min={1}
                max={30}
                value={syncIterations}
                onChange={(e) => setSyncIterations(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1.5 font-mono-tabular text-xs text-slate-100"
              />
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={running}
              className="flex-1 inline-flex min-h-8 items-center justify-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {lastComparison ? 'Rerun' : 'Compare'}
            </button>
            <button
              type="button"
              onClick={() => {
                onComparisonComplete(null)
                setError(null)
              }}
              aria-label="Reset comparison"
              className="inline-flex min-h-8 items-center justify-center border border-[#2b3968] bg-[#111834] px-2.5 text-slate-300 hover:border-cyan-400"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div role="alert" className="border border-rose-500/60 bg-rose-950/35 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {/* Side-by-Side Comparison Output */}
      {lastComparison ? (
        <div className="space-y-3 border border-[#253057] bg-[#0a0f20] p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f294a] pb-2.5">
            <div>
              <div className="font-display font-semibold tracking-wider text-cyan-300 uppercase">
                Comparative Outcome — {lastComparison.mode.toUpperCase()} ({lastComparison.preset}, Seed {lastComparison.seed})
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                Parameters: {JSON.stringify(lastComparison.parameters)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExport('csv')}
                className="inline-flex items-center gap-1 border border-[#2b3968] bg-[#111834] px-2.5 py-1 text-[11px] text-cyan-200 hover:border-cyan-400"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => void handleExport('json')}
                className="inline-flex items-center gap-1 border border-[#2b3968] bg-[#111834] px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-400"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                JSON
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
              <div className="text-[10px] font-semibold text-amber-300 uppercase">
                Theoretical Expectation
              </div>
              <p className="mt-1 text-[11px] text-slate-300">{lastComparison.expectation}</p>
            </div>
            <div className="border border-[#1f294a] bg-[#0d1428] p-2.5">
              <div className="text-[10px] font-semibold text-emerald-300 uppercase">
                Actual Observed Summary
              </div>
              <p className="mt-1 font-mono-tabular text-[11px] text-slate-200">
                {lastComparison.initial_safety_status
                  ? `Initial: ${lastComparison.initial_safety_status} -> `
                  : ''}
                {lastComparison.arms.map((a) => `${a.label}: ${a.safety_status}`).join(' | ')}
              </p>
            </div>
          </div>

          <div className="overflow-auto border border-[#222d52] bg-[#090e1d]">
            <table className="w-full border-collapse text-left text-xs font-mono-tabular">
              <caption className="sr-only">Side-by-side comparative arms</caption>
              <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Experiment Arm</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Final State</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Tick / Time</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Util %</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Key Metrics</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-2">Engine Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2442]">
                {lastComparison.arms.map((arm) => (
                  <tr key={arm.label}>
                    <th scope="row" className="px-3 py-2 font-semibold text-cyan-200">{arm.label}</th>
                    <td className="px-3 py-2">
                      <span
                        className={
                          arm.safety_status === 'SAFE' || arm.safety_status === 'CLEAN'
                            ? 'text-emerald-300'
                            : arm.safety_status.includes('DEADLOCK')
                              ? 'text-rose-300'
                              : 'text-amber-300'
                        }
                      >
                        {arm.safety_status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{arm.tick}</td>
                    <td className="px-3 py-2">{arm.utilization_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-200">{arm.primary_metric}</td>
                    <td className="px-3 py-2 font-sans text-[11px] text-slate-300">{arm.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border border-[#253057] bg-[#0a0f20] p-8 text-center text-xs text-slate-400">
          Configure identical initial conditions above and click &ldquo;Compare&rdquo; to execute isolated side-by-side C++ experiments.
        </div>
      )}
    </div>
  )
}
