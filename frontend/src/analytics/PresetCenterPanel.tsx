import React, { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, Dice5, GitFork, Play, ShieldCheck, Wrench } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { NavTabId, PresetCatalogItem, PresetCatalogResponse } from '../types/simulation'

export const PresetCenterPanel: React.FC = () => {
  const activePreset = useSimulationStore((s) => s.simState?.preset)
  const isMutating = useSimulationStore((s) => s.isMutating)
  const selectPreset = useSimulationStore((s) => s.selectPreset)
  const loadRandomWorkload = useSimulationStore((s) => s.loadRandomWorkload)
  const setActiveTab = useSimulationStore((s) => s.setActiveTab)

  const [catalog, setCatalog] = useState<PresetCatalogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seedOverrides, setSeedOverrides] = useState<Record<string, number>>({})

  // Random workload config
  const [randProcs, setRandProcs] = useState(5)
  const [randRes, setRandRes] = useState(3)
  const [randSeed, setRandSeed] = useState(42)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getExperimentPresets()
      .then((res) => {
        if (!cancelled) setCatalog(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load C++ preset registry.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const presets: PresetCatalogItem[] = catalog?.presets ?? []

  const launchPreset = async (preset: PresetCatalogItem, targetTab?: NavTabId) => {
    const seed = seedOverrides[preset.id] ?? preset.default_seed
    await selectPreset(preset.id, seed)
    if (targetTab) setActiveTab(targetTab)
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="flex items-center gap-2 border border-rose-500/60 bg-rose-950/30 p-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Randomized Deterministic Workload Card */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void loadRandomWorkload(randProcs, randRes, randSeed)
        }}
        className="border border-cyan-500/40 bg-[#0b1329] p-3.5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
              <Dice5 className="h-4 w-4" aria-hidden="true" />
              Deterministic Random Workload Generator (C++ mt19937)
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Generates reproducible random resource capacities, process demands, and initial allocations from seed.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 font-mono-tabular">
            <div>
              <label htmlFor="rand-procs" className="block text-[10px] text-slate-400">Processes (2-12)</label>
              <input
                id="rand-procs"
                type="number"
                min={catalog?.random_workload.min_processes ?? 2}
                max={catalog?.random_workload.max_processes ?? 12}
                value={randProcs}
                onChange={(e) => setRandProcs(Math.min(12, Math.max(2, Number(e.target.value) || 2)))}
                className="w-20 border border-[#2b3968] bg-[#0e152b] px-2 py-1 text-xs text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="rand-res" className="block text-[10px] text-slate-400">Resources (2-6)</label>
              <input
                id="rand-res"
                type="number"
                min={catalog?.random_workload.min_resources ?? 2}
                max={catalog?.random_workload.max_resources ?? 6}
                value={randRes}
                onChange={(e) => setRandRes(Math.min(6, Math.max(2, Number(e.target.value) || 2)))}
                className="w-20 border border-[#2b3968] bg-[#0e152b] px-2 py-1 text-xs text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="rand-seed" className="block text-[10px] text-slate-400">Seed</label>
              <input
                id="rand-seed"
                type="number"
                min={0}
                value={randSeed}
                onChange={(e) => setRandSeed(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 border border-[#2b3968] bg-[#0e152b] px-2 py-1 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={isMutating}
              className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1.5 font-sans text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Generate Random Workload
            </button>
          </div>
        </div>
      </form>

      {/* Authoritative C++ Preset Registry Grid */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {presets.map((p) => {
          const isCurrent = activePreset === p.id
          const seedVal = seedOverrides[p.id] ?? p.default_seed
          const badgeClass =
            p.category === 'Safe'
              ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
              : p.category === 'Deadlock'
                ? 'border-rose-500/60 text-rose-300 bg-rose-500/10'
                : 'border-amber-500/50 text-amber-300 bg-amber-500/10'

          const resSummary = Object.entries(p.initial_resource_config)
            .map(([rid, qty]) => `${rid}×${qty}`)
            .join(', ')

          return (
            <article
              key={p.id}
              className={`flex flex-col justify-between border p-3.5 text-xs ${
                isCurrent ? 'border-cyan-400 bg-[#0d1934]' : 'border-[#253057] bg-[#0a0f20]'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xs font-semibold tracking-wider text-slate-100 uppercase">
                      {p.name}
                    </h3>
                    <span className="font-mono-tabular text-[10px] text-cyan-400">{p.id}</span>
                  </div>
                  <span className={`border px-1.5 py-0.5 font-mono-tabular text-[10px] uppercase ${badgeClass}`}>
                    {p.category}
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-300">{p.description}</p>

                <dl className="space-y-1 border-t border-[#1e284a] pt-2 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">OS Concept:</dt>
                    <dd className="text-right font-medium text-cyan-200">{p.os_concept}</dd>
                  </div>
                  <div className="flex justify-between gap-2 font-mono-tabular">
                    <dt className="text-slate-400">Initial Config:</dt>
                    <dd className="text-right text-slate-200">
                      {p.initial_process_count} Procs • [{resSummary}]
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Expected Behavior:</dt>
                    <dd className="text-slate-300">{p.expected_behavior}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Learning Objective:</dt>
                    <dd className="text-slate-300">{p.learning_objective}</dd>
                  </div>
                </dl>

                <div className="border-t border-[#1e284a] pt-2">
                  <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    Recommended Actions
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {p.recommended_actions.map((act) => (
                      <li
                        key={act}
                        className="border border-[#26335e] bg-[#0e152b] px-1.5 py-0.5 text-[10px] text-slate-300"
                      >
                        {act}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-3 space-y-2 border-t border-[#1e284a] pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`seed-${p.id}`} className="text-[10px] text-slate-400">
                    Seed
                  </label>
                  <input
                    id={`seed-${p.id}`}
                    type="number"
                    min={0}
                    value={seedVal}
                    onChange={(e) =>
                      setSeedOverrides((prev) => ({
                        ...prev,
                        [p.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-20 border border-[#2b3968] bg-[#0e152b] px-2 py-0.5 font-mono-tabular text-[11px] text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void launchPreset(p)}
                    className="flex-1 inline-flex min-h-7 items-center justify-center gap-1 border border-cyan-400/70 bg-cyan-500/20 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    Load Preset
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void launchPreset(p, 'graph')}
                    className="inline-flex items-center gap-1 border border-[#2a3866] bg-[#101730] px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400"
                  >
                    <GitFork className="h-3 w-3 text-cyan-300" aria-hidden="true" />
                    RAG
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void launchPreset(p, 'banker')}
                    className="inline-flex items-center gap-1 border border-[#2a3866] bg-[#101730] px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400"
                  >
                    <ShieldCheck className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                    Banker&apos;s
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void launchPreset(p, 'recovery')}
                    className="inline-flex items-center gap-1 border border-[#2a3866] bg-[#101730] px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400"
                  >
                    <Wrench className="h-3 w-3 text-amber-300" aria-hidden="true" />
                    Recovery
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void launchPreset(p, 'scheduling')}
                    className="inline-flex items-center gap-1 border border-[#2a3866] bg-[#101730] px-2 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400"
                  >
                    <Cpu className="h-3 w-3 text-indigo-300" aria-hidden="true" />
                    CPU Lab
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
