import React, { useEffect, useId, useState } from 'react'
import { Activity, Database, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { ApiError, apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { ResourceCategory } from '../types/simulation'
import { ProcessStateBadge, ResourceStatusBadge } from '../components/ui/StatusBadge'

export const ProcessResourceManager: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const simState = useSimulationStore((s) => s.simState)
  const applyEnvelope = useSimulationStore((s) => s.applyEnvelope)
  const pushToast = useSimulationStore((s) => s.pushToast)
  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)

  const [subTab, setSubTab] = useState<'processes' | 'resources' | 'alloc'>('processes')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Add Process form state
  const [procName, setProcName] = useState('WorkerService')
  const [arrivalTime, setArrivalTime] = useState(0)
  const [burstTime, setBurstTime] = useState(5)
  const [priority, setPriority] = useState(3)
  const [termCost, setTermCost] = useState(3)
  const [maxDemand, setMaxDemand] = useState<Record<string, number>>({})

  // Add Resource form state
  const [resName, setResName] = useState('Telemetry Bus')
  const [resCategory, setResCategory] = useState<ResourceCategory>('IO')
  const [resInstances, setResInstances] = useState(2)
  const [resPreemptible, setResPreemptible] = useState(false)

  // Request / Release form state
  const [targetPid, setTargetPid] = useState('')
  const [useBanker, setUseBanker] = useState(true)
  const [ioVector, setIoVector] = useState<Record<string, number>>({})

  const procNameId = useId()
  const arrivalId = useId()
  const burstId = useId()
  const prioId = useId()
  const costId = useId()
  const resNameId = useId()
  const resCatId = useId()
  const resInstId = useId()
  const resPreId = useId()
  const reqProcId = useId()
  const useBankerId = useId()

  const processes = simState?.processes ?? []
  const resources = simState?.resources ?? []
  const activeProcs = processes.filter((p) => p.state !== 'TERMINATED')
  const resKey = resources.map((r) => r.id).join(',')

  useEffect(() => {
    const init: Record<string, number> = {}
    for (const id of resKey.split(',').filter(Boolean)) init[id] = 0
    setMaxDemand(init)
    setIoVector(init)
  }, [resKey])

  useEffect(() => {
    if (activeProcs.length > 0 && !activeProcs.some((p) => p.id === targetPid)) {
      setTargetPid(activeProcs[0]!.id)
    }
  }, [activeProcs, targetPid])

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true)
    setFormError(null)
    try {
      await fn()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Operation failed.'
      setFormError(msg)
      pushToast({ severity: 'error', title: 'Validation / Engine Error', message: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleAddProcess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId) return
    if (!procName.trim()) {
      setFormError('Process name is required.')
      return
    }
    await runMutation(async () => {
      const env = await apiClient.addProcess(sessionId, {
        name: procName.trim(),
        arrival_time: arrivalTime,
        burst_time: burstTime,
        priority,
        max_demand: maxDemand,
        termination_cost: termCost,
      })
      applyEnvelope(env)
      pushToast({ severity: 'success', title: 'Process Created', message: `Added ${procName.trim()}.` })
    })
  }

  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionId) return
    if (!resName.trim()) {
      setFormError('Resource name is required.')
      return
    }
    await runMutation(async () => {
      const env = await apiClient.addResource(sessionId, {
        name: resName.trim(),
        category: resCategory,
        total_instances: resInstances,
        preemptible: resPreemptible,
      })
      applyEnvelope(env)
      pushToast({ severity: 'success', title: 'Resource Added', message: `Created ${resName.trim()}.` })
    })
  }

  const handleRequestOrRelease = async (mode: 'request' | 'release') => {
    if (!sessionId || !targetPid) return
    const total = Object.values(ioVector).reduce((a, b) => a + b, 0)
    if (total <= 0) {
      setFormError('Enter at least 1 unit across resources.')
      return
    }
    await runMutation(async () => {
      if (mode === 'request') {
        const env = await apiClient.requestResources(sessionId, {
          process_id: targetPid,
          request: ioVector,
          use_banker: useBanker,
        })
        applyEnvelope(env)
        const res = env.result as { granted?: boolean; reason?: string } | undefined
        pushToast({
          severity: res?.granted ? 'success' : 'warning',
          title: res?.granted ? 'Allocated' : 'Blocked / Rejected',
          message: res?.reason ?? 'Request processed.',
        })
      } else {
        const env = await apiClient.releaseResources(sessionId, {
          process_id: targetPid,
          release: ioVector,
        })
        applyEnvelope(env)
        pushToast({ severity: 'info', title: 'Released', message: `Released units from ${targetPid}.` })
      }
    })
  }

  if (!simState) return null

  return (
    <section
      aria-label="Process and Resource Management"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header + Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Process &amp; Resource Management
            </h1>
            <p className="text-[11px] text-slate-400">
              Create, suspend, resume, terminate processes and manage multi-instance pools
            </p>
          </div>
        </div>

        <div role="tablist" aria-label="Management sections" className="flex border border-[#2a3866] bg-[#0a0f20] p-0.5 text-xs">
          {[
            { id: 'processes', label: `Processes (${processes.length})` },
            { id: 'resources', label: `Resources (${resources.length})` },
            { id: 'alloc', label: 'Request / Release' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={subTab === tab.id}
              onClick={() => {
                setSubTab(tab.id as 'processes' | 'resources' | 'alloc')
                setFormError(null)
              }}
              className={`border-b-2 px-3 py-1 font-medium ${
                subTab === tab.id
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {formError ? (
        <div role="alert" className="border-b border-rose-500/50 bg-rose-950/40 px-4 py-2 text-xs text-rose-200">
          {formError}
        </div>
      ) : null}

      {/* Content */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
        {subTab === 'processes' ? (
          <>
            <div className="xl:col-span-2 overflow-auto border border-[#253057] bg-[#0a0f20]">
              <table className="w-full border-collapse text-left text-xs font-mono-tabular">
                <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-cyan-300 uppercase">
                  Process Control Blocks
                </caption>
                <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">PID</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">State</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Burst</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Prio</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Alloc / Need</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2442]">
                  {processes.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedEntity({ kind: 'process', id: p.id })}
                      className="cursor-pointer hover:bg-slate-800/40"
                    >
                      <th scope="row" className="px-3 py-2 font-semibold text-slate-100">
                        {p.id} <span className="font-sans text-[10px] font-normal text-slate-400">{p.name}</span>
                      </th>
                      <td className="px-3 py-2">
                        <ProcessStateBadge state={p.state} />
                      </td>
                      <td className="px-3 py-2">
                        {p.remaining_time}/{p.burst_time}
                      </td>
                      <td className="px-3 py-2">P{p.priority}</td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="text-cyan-300">
                          [{resources.map((r) => p.allocated[r.id] ?? 0).join(',')}]
                        </span>{' '}
                        /{' '}
                        <span className="text-amber-300">
                          [{resources.map((r) => p.need[r.id] ?? 0).join(',')}]
                        </span>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {p.state !== 'TERMINATED' ? (
                            <>
                              {p.state === 'WAITING' ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`Resume ${p.id}`}
                                  onClick={() =>
                                    void runMutation(async () => {
                                      if (!sessionId) return
                                      applyEnvelope(await apiClient.resumeProcess(sessionId, p.id))
                                    })
                                  }
                                  className="border border-emerald-500/50 bg-emerald-500/15 p-1 text-emerald-300 hover:bg-emerald-500/25"
                                >
                                  <Play className="h-3 w-3" aria-hidden="true" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`Suspend ${p.id}`}
                                  onClick={() =>
                                    void runMutation(async () => {
                                      if (!sessionId) return
                                      applyEnvelope(await apiClient.suspendProcess(sessionId, p.id))
                                    })
                                  }
                                  className="border border-amber-500/50 bg-amber-500/15 p-1 text-amber-300 hover:bg-amber-500/25"
                                >
                                  <Pause className="h-3 w-3" aria-hidden="true" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={`Terminate ${p.id}`}
                                onClick={() =>
                                  void runMutation(async () => {
                                    if (!sessionId) return
                                    applyEnvelope(await apiClient.terminateProcess(sessionId, p.id))
                                  })
                                }
                                className="border border-rose-500/50 bg-rose-500/15 p-1 text-rose-300 hover:bg-rose-500/25"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-500">Terminated</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form
              onSubmit={(e) => void handleAddProcess(e)}
              className="border border-[#253057] bg-[#0a0f20] p-3 text-xs space-y-2.5"
            >
              <h2 className="font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
                Create New Process
              </h2>
              <div>
                <label htmlFor={procNameId} className="block text-[11px] text-slate-300">Process Name</label>
                <input
                  id={procNameId}
                  type="text"
                  required
                  value={procName}
                  onChange={(e) => setProcName(e.target.value)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={arrivalId} className="block text-[11px] text-slate-300">Arrival</label>
                  <input
                    id={arrivalId}
                    type="number"
                    min={0}
                    value={arrivalTime}
                    onChange={(e) => setArrivalTime(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor={burstId} className="block text-[11px] text-slate-300">Burst</label>
                  <input
                    id={burstId}
                    type="number"
                    min={1}
                    value={burstTime}
                    onChange={(e) => setBurstTime(Math.max(1, Number(e.target.value) || 1))}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor={prioId} className="block text-[11px] text-slate-300">Priority (1-10)</label>
                  <input
                    id={prioId}
                    type="number"
                    min={1}
                    max={10}
                    value={priority}
                    onChange={(e) => setPriority(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor={costId} className="block text-[11px] text-slate-300">Term Cost</label>
                  <input
                    id={costId}
                    type="number"
                    min={1}
                    value={termCost}
                    onChange={(e) => setTermCost(Math.max(1, Number(e.target.value) || 1))}
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
              </div>
              <fieldset className="border border-[#1f294a] p-2">
                <legend className="px-1 text-[10px] text-slate-400 uppercase">Max Demand</legend>
                <div className="grid grid-cols-2 gap-2">
                  {resources.map((r) => (
                    <div key={r.id}>
                      <label htmlFor={`max-${r.id}`} className="block text-[10px] font-mono-tabular text-slate-300">
                        {r.id} (Max {r.total_instances})
                      </label>
                      <input
                        id={`max-${r.id}`}
                        type="number"
                        min={0}
                        value={maxDemand[r.id] ?? 0}
                        onChange={(e) =>
                          setMaxDemand((prev) => ({
                            ...prev,
                            [r.id]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="mt-0.5 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full min-h-8 items-center justify-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Spawn Process
              </button>
            </form>
          </>
        ) : subTab === 'resources' ? (
          <>
            <div className="xl:col-span-2 overflow-auto border border-[#253057] bg-[#0a0f20]">
              <table className="w-full border-collapse text-left text-xs font-mono-tabular">
                <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-emerald-300 uppercase">
                  Resource Facility Pools
                </caption>
                <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Resource</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Category</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Avail / Total</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Status</th>
                    <th scope="col" className="border-b border-[#222d52] px-3 py-2">Modify Capacity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2442]">
                  {resources.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedEntity({ kind: 'resource', id: r.id })}
                      className="cursor-pointer hover:bg-slate-800/40"
                    >
                      <th scope="row" className="px-3 py-2 font-semibold text-slate-100">
                        {r.id} <span className="font-sans text-[10px] font-normal text-slate-400">{r.name}</span>
                      </th>
                      <td className="px-3 py-2">{r.category}</td>
                      <td className="px-3 py-2 text-emerald-300">
                        {r.available_instances} / {r.total_instances}
                      </td>
                      <td className="px-3 py-2">
                        <ResourceStatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Decrease ${r.id} capacity`}
                            onClick={() =>
                              void runMutation(async () => {
                                if (!sessionId) return
                                applyEnvelope(
                                  await apiClient.modifyResource(sessionId, r.id, {
                                    total_instances: Math.max(1, r.total_instances - 1),
                                  }),
                                )
                              })
                            }
                            className="border border-[#2b3968] bg-[#101730] px-2 py-0.5 hover:border-cyan-400"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Increase ${r.id} capacity`}
                            onClick={() =>
                              void runMutation(async () => {
                                if (!sessionId) return
                                applyEnvelope(
                                  await apiClient.modifyResource(sessionId, r.id, {
                                    total_instances: r.total_instances + 1,
                                  }),
                                )
                              })
                            }
                            className="border border-[#2b3968] bg-[#101730] px-2 py-0.5 hover:border-cyan-400"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runMutation(async () => {
                                if (!sessionId) return
                                applyEnvelope(
                                  await apiClient.modifyResource(sessionId, r.id, {
                                    preemptible: !r.preemptible,
                                  }),
                                )
                              })
                            }
                            className={`border px-1.5 py-0.5 text-[10px] ${
                              r.preemptible
                                ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                                : 'border-slate-600 bg-slate-800/60 text-slate-400'
                            }`}
                          >
                            {r.preemptible ? 'Preemptible' : 'Locked'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form
              onSubmit={(e) => void handleAddResource(e)}
              className="border border-[#253057] bg-[#0a0f20] p-3 text-xs space-y-3"
            >
              <h2 className="font-display text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                Add Resource Facility
              </h2>
              <div>
                <label htmlFor={resNameId} className="block text-[11px] text-slate-300">Resource Name</label>
                <input
                  id={resNameId}
                  type="text"
                  required
                  value={resName}
                  onChange={(e) => setResName(e.target.value)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
              <div>
                <label htmlFor={resCatId} className="block text-[11px] text-slate-300">Category</label>
                <select
                  id={resCatId}
                  value={resCategory}
                  onChange={(e) => setResCategory(e.target.value as ResourceCategory)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="COMPUTE">COMPUTE</option>
                  <option value="MEMORY">MEMORY</option>
                  <option value="STORAGE">STORAGE</option>
                  <option value="IO">IO</option>
                  <option value="LOCK">LOCK</option>
                </select>
              </div>
              <div>
                <label htmlFor={resInstId} className="block text-[11px] text-slate-300">Total Instances</label>
                <input
                  id={resInstId}
                  type="number"
                  min={1}
                  max={64}
                  value={resInstances}
                  onChange={(e) => setResInstances(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={resPreId}
                  type="checkbox"
                  checked={resPreemptible}
                  onChange={(e) => setResPreemptible(e.target.checked)}
                />
                <label htmlFor={resPreId} className="text-xs text-slate-300">
                  Allow Resource Preemption
                </label>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full min-h-8 items-center justify-center gap-1.5 border border-emerald-400/70 bg-emerald-500/20 px-3 py-1.5 font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                Create Resource Type
              </button>
            </form>
          </>
        ) : (
          <div className="xl:col-span-3 max-w-2xl border border-[#253057] bg-[#0a0f20] p-4 text-xs space-y-3">
            <h2 className="font-display text-xs font-semibold tracking-wider text-cyan-300 uppercase">
              Direct Resource Request &amp; Release
            </h2>
            <div>
              <label htmlFor={reqProcId} className="block text-[11px] text-slate-300">Target Process</label>
              <select
                id={reqProcId}
                value={targetPid}
                onChange={(e) => setTargetPid(e.target.value)}
                className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2.5 py-1.5 font-mono-tabular text-xs text-slate-100"
              >
                {activeProcs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.name} ({p.state})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {resources.map((r) => (
                <div key={r.id}>
                  <label htmlFor={`io-${r.id}`} className="block text-[10px] font-mono-tabular text-slate-300">
                    {r.id} (Avail {r.available_instances})
                  </label>
                  <input
                    id={`io-${r.id}`}
                    type="number"
                    min={0}
                    value={ioVector[r.id] ?? 0}
                    onChange={(e) =>
                      setIoVector((prev) => ({
                        ...prev,
                        [r.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                id={useBankerId}
                type="checkbox"
                checked={useBanker}
                onChange={(e) => setUseBanker(e.target.checked)}
              />
              <label htmlFor={useBankerId} className="text-xs text-slate-300">
                Enforce Banker&apos;s Algorithm safety check on Request (uncheck to allow unsafe/deadlocking requests)
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy || !targetPid}
                onClick={() => void handleRequestOrRelease('request')}
                className="min-h-8 border border-cyan-400/70 bg-cyan-500/20 px-4 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                Request Resources
              </button>
              <button
                type="button"
                disabled={busy || !targetPid}
                onClick={() => void handleRequestOrRelease('release')}
                className="min-h-8 border border-[#304075] bg-[#131b38] px-4 py-1.5 font-medium text-slate-200 hover:border-amber-400 disabled:opacity-50"
              >
                Release Resources
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
