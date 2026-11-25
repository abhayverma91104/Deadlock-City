import React, { useId, useState } from 'react'
import { Cpu, Download, Play, Plus, Trash2 } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type {
  ScheduleInputProcess,
  ScheduleResult,
  SchedulingAlgorithm,
} from '../types/simulation'

const DEFAULT_WORKLOAD: ScheduleInputProcess[] = [
  { id: 'P1', name: 'KernelTask', arrival_time: 0, burst_time: 5, priority: 2 },
  { id: 'P2', name: 'NetDispatch', arrival_time: 1, burst_time: 3, priority: 1 },
  { id: 'P3', name: 'DiskFlush', arrival_time: 2, burst_time: 1, priority: 3 },
  { id: 'P4', name: 'Telemetry', arrival_time: 6, burst_time: 2, priority: 4 },
]

const PROC_COLORS = [
  'bg-cyan-500/80 border-cyan-300 text-slate-950',
  'bg-emerald-500/80 border-emerald-300 text-slate-950',
  'bg-indigo-500/80 border-indigo-300 text-slate-50',
  'bg-amber-500/80 border-amber-300 text-slate-950',
  'bg-pink-500/80 border-pink-300 text-slate-50',
  'bg-sky-500/80 border-sky-300 text-slate-950',
]

export const CpuSchedulingLab: React.FC = () => {
  const simState = useSimulationStore((s) => s.simState)
  const pushToast = useSimulationStore((s) => s.pushToast)

  const [processes, setProcesses] = useState<ScheduleInputProcess[]>(DEFAULT_WORKLOAD)
  const [selectedAlg, setSelectedAlg] = useState<SchedulingAlgorithm>('SRTF')
  const [quantum, setQuantum] = useState<number>(2)
  const [compareMode, setCompareMode] = useState<boolean>(true)
  const [results, setResults] = useState<ScheduleResult[]>([])
  const [highlightedPid, setHighlightedPid] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // Add process form state
  const [newId, setNewId] = useState('P5')
  const [newArrival, setNewArrival] = useState(0)
  const [newBurst, setNewBurst] = useState(4)
  const [newPrio, setNewPrio] = useState(2)

  const algSelectId = useId()
  const quantumId = useId()
  const pidInputId = useId()
  const arrInputId = useId()
  const burstInputId = useId()
  const prioInputId = useId()

  const runScheduler = async (showAll: boolean) => {
    if (processes.length === 0) {
      pushToast({ severity: 'warning', title: 'Empty Workload', message: 'Add at least one process.' })
      return
    }
    setRunning(true)
    setCompareMode(showAll)
    try {
      const resp = await apiClient.compareScheduling({ quantum, processes })
      setResults(resp.comparisons)
    } catch (err) {
      pushToast({
        severity: 'error',
        title: 'Scheduling Error',
        message: err instanceof Error ? err.message : 'Unable to execute C++ CPU scheduler.',
      })
    } finally {
      setRunning(false)
    }
  }

  const handleImportFromCity = () => {
    if (!simState || simState.processes.length === 0) return
    const imported: ScheduleInputProcess[] = simState.processes.map((p) => ({
      id: p.id,
      name: p.name,
      arrival_time: p.arrival_time,
      burst_time: Math.max(1, p.burst_time),
      priority: p.priority,
    }))
    setProcesses(imported)
    pushToast({
      severity: 'info',
      title: 'Workload Imported',
      message: `Imported ${imported.length} processes into isolated scheduling lab.`,
    })
  }

  const handleAddProcess = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanId = newId.trim()
    if (!cleanId) return
    if (processes.some((p) => p.id === cleanId)) {
      pushToast({ severity: 'warning', title: 'Duplicate ID', message: `Process ${cleanId} already exists.` })
      return
    }
    setProcesses((prev) => [
      ...prev,
      { id: cleanId, name: cleanId, arrival_time: newArrival, burst_time: newBurst, priority: newPrio },
    ])
    setNewId(`P${processes.length + 2}`)
  }

  const activeResult = results.find((r) => r.algorithm === selectedAlg) ?? results[0] ?? null

  const colorMap = new Map<string, string>()
  processes.forEach((p, idx) => {
    colorMap.set(p.id, PROC_COLORS[idx % PROC_COLORS.length]!)
  })

  const buildTimelineBlocks = (res: ScheduleResult) => {
    const blocks: Array<{ kind: 'proc' | 'idle'; id: string; start: number; end: number }> = []
    let cursor = 0
    for (const seg of res.gantt) {
      if (seg.start_time > cursor) {
        blocks.push({ kind: 'idle', id: 'IDLE', start: cursor, end: seg.start_time })
      }
      blocks.push({ kind: 'proc', id: seg.process_id, start: seg.start_time, end: seg.end_time })
      cursor = seg.end_time
    }
    return blocks
  }

  return (
    <section
      aria-label="CPU Scheduling Laboratory"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Cpu className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              CPU Scheduling Laboratory
            </h1>
            <p className="text-[11px] text-slate-400">
              Isolated C++17 Scheduler (FCFS, SJF, SRTF, Non-Preemptive Priority, Round Robin)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleImportFromCity}
            className="inline-flex min-h-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 text-slate-200 hover:border-cyan-400"
          >
            <Download className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            Import City Workload
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void runScheduler(false)}
            className="inline-flex min-h-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-3 text-slate-100 hover:border-cyan-400 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
            Run {selectedAlg}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void runScheduler(true)}
            className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            Compare All 5
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
        {/* Left: Workload Configuration */}
        <div className="flex flex-col gap-3">
          <div className="border border-[#253057] bg-[#0a0f20] p-3 text-xs space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={algSelectId} className="block text-[10px] font-semibold text-slate-400 uppercase">
                  Focus Algorithm
                </label>
                <select
                  id={algSelectId}
                  value={selectedAlg}
                  onChange={(e) => setSelectedAlg(e.target.value as SchedulingAlgorithm)}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 text-xs text-slate-100"
                >
                  <option value="FCFS">FCFS</option>
                  <option value="SJF">SJF (Non-Preemptive)</option>
                  <option value="SRTF">SRTF (Preemptive)</option>
                  <option value="PRIORITY">Priority (Non-Preemptive, 1=High)</option>
                  <option value="RR">Round Robin (RR)</option>
                </select>
              </div>
              <div>
                <label htmlFor={quantumId} className="block text-[10px] font-semibold text-slate-400 uppercase">
                  RR Quantum
                </label>
                <input
                  id={quantumId}
                  type="number"
                  min={1}
                  max={50}
                  value={quantum}
                  onChange={(e) => setQuantum(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="overflow-auto border border-[#1f294a]">
              <table className="w-full border-collapse text-left text-[11px] font-mono-tabular">
                <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th scope="col" className="px-2 py-1.5">ID</th>
                    <th scope="col" className="px-2 py-1.5">Arr</th>
                    <th scope="col" className="px-2 py-1.5">Burst</th>
                    <th scope="col" className="px-2 py-1.5">Prio</th>
                    <th scope="col" className="px-2 py-1.5">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a2240]">
                  {processes.map((p) => (
                    <tr
                      key={p.id}
                      onMouseEnter={() => setHighlightedPid(p.id)}
                      onMouseLeave={() => setHighlightedPid(null)}
                      className={highlightedPid === p.id ? 'bg-cyan-500/15' : ''}
                    >
                      <th scope="row" className="px-2 py-1 font-semibold text-cyan-300">{p.id}</th>
                      <td className="px-2 py-1">{p.arrival_time}</td>
                      <td className="px-2 py-1">{p.burst_time}</td>
                      <td className="px-2 py-1">{p.priority}</td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          aria-label={`Remove ${p.id}`}
                          onClick={() => setProcesses((prev) => prev.filter((item) => item.id !== p.id))}
                          className="text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={handleAddProcess} className="grid grid-cols-4 gap-1.5 pt-1">
              <div>
                <label htmlFor={pidInputId} className="block text-[9px] text-slate-400">ID</label>
                <input
                  id={pidInputId}
                  type="text"
                  required
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className="w-full border border-[#2b3968] bg-[#0e152b] px-1.5 py-1 font-mono-tabular text-[11px]"
                />
              </div>
              <div>
                <label htmlFor={arrInputId} className="block text-[9px] text-slate-400">Arrival</label>
                <input
                  id={arrInputId}
                  type="number"
                  min={0}
                  value={newArrival}
                  onChange={(e) => setNewArrival(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full border border-[#2b3968] bg-[#0e152b] px-1.5 py-1 font-mono-tabular text-[11px]"
                />
              </div>
              <div>
                <label htmlFor={burstInputId} className="block text-[9px] text-slate-400">Burst</label>
                <input
                  id={burstInputId}
                  type="number"
                  min={1}
                  value={newBurst}
                  onChange={(e) => setNewBurst(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full border border-[#2b3968] bg-[#0e152b] px-1.5 py-1 font-mono-tabular text-[11px]"
                />
              </div>
              <div>
                <label htmlFor={prioInputId} className="block text-[9px] text-slate-400">Prio</label>
                <input
                  id={prioInputId}
                  type="number"
                  min={1}
                  max={10}
                  value={newPrio}
                  onChange={(e) => setNewPrio(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-full border border-[#2b3968] bg-[#0e152b] px-1.5 py-1 font-mono-tabular text-[11px]"
                />
              </div>
              <button
                type="submit"
                className="col-span-4 mt-1 inline-flex min-h-7 items-center justify-center gap-1 border border-[#304075] bg-[#121936] text-[11px] text-cyan-200 hover:border-cyan-400"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add Process
              </button>
            </form>
          </div>
        </div>

        {/* Right: Gantt Chart & Metrics */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          {results.length === 0 ? (
            <div className="flex flex-1 items-center justify-center border border-[#253057] bg-[#0a0f20] p-8 text-xs text-slate-400">
              Click &ldquo;Run {selectedAlg}&rdquo; or &ldquo;Compare All 5&rdquo; to execute the C++ CPU scheduler.
            </div>
          ) : (
            <>
              {/* Gantt Chart Card(s) */}
              {(compareMode ? results : activeResult ? [activeResult] : []).map((res) => {
                const blocks = buildTimelineBlocks(res)
                return (
                  <div key={res.algorithm} className="border border-[#253057] bg-[#0a0f20] p-3 text-xs">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedAlg(res.algorithm)}
                        className="font-display font-semibold tracking-wider text-cyan-300 uppercase hover:underline"
                      >
                        {res.algorithm}
                        {res.algorithm === 'PRIORITY' ? ' (Non-Preemptive)' : ''}
                        {res.algorithm === 'RR' ? ` (q=${res.quantum})` : ''}
                      </button>
                      <div className="flex flex-wrap gap-3 font-mono-tabular text-[11px] text-slate-300">
                        <span>Avg WT: <strong className="text-emerald-300">{res.avg_waiting_time.toFixed(2)}</strong></span>
                        <span>Avg TAT: <strong className="text-cyan-300">{res.avg_turnaround_time.toFixed(2)}</strong></span>
                        <span>CS: <strong className="text-amber-300">{res.context_switches}</strong></span>
                        <span>Util: <strong>{res.cpu_utilization_pct.toFixed(1)}%</strong></span>
                      </div>
                    </div>

                    <div
                      aria-label={`${res.algorithm} Gantt timeline`}
                      className="flex h-9 w-full overflow-hidden border border-[#263259] bg-[#070b17]"
                    >
                      {blocks.map((blk, i) => {
                        const pct = ((blk.end - blk.start) / Math.max(1, res.total_time)) * 100
                        const isIdle = blk.kind === 'idle'
                        const cls = isIdle
                          ? 'bg-slate-800/70 border-slate-600 text-slate-400'
                          : colorMap.get(blk.id) ?? PROC_COLORS[0]!
                        const dimmed = highlightedPid && !isIdle && highlightedPid !== blk.id
                        return (
                          <div
                            key={`${blk.id}-${i}`}
                            style={{ width: `${pct}%` }}
                            onMouseEnter={() => !isIdle && setHighlightedPid(blk.id)}
                            onMouseLeave={() => setHighlightedPid(null)}
                            title={`${blk.id}: [${blk.start}..${blk.end}]`}
                            className={`flex flex-col items-center justify-center border-r text-[10px] font-mono-tabular transition-opacity ${cls} ${
                              dimmed ? 'opacity-35' : 'opacity-100'
                            }`}
                          >
                            <span className="font-bold leading-none">{blk.id}</span>
                            <span className="text-[9px] leading-none opacity-85">
                              {blk.start}-{blk.end}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Detailed Process Metrics Table for Active Algorithm */}
              {activeResult ? (
                <div className="overflow-auto border border-[#253057] bg-[#0a0f20]">
                  <table className="w-full border-collapse text-left text-xs font-mono-tabular">
                    <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-cyan-300 uppercase">
                      {activeResult.algorithm} Per-Process Metrics (Avg Resp: {activeResult.avg_response_time.toFixed(2)})
                    </caption>
                    <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                      <tr>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">PID</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Arrival</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Burst</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Completion</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Turnaround</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Waiting</th>
                        <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Response</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b2442]">
                      {activeResult.process_metrics.map((m) => (
                        <tr key={m.id} className={highlightedPid === m.id ? 'bg-cyan-500/15' : ''}>
                          <th scope="row" className="px-3 py-1.5 font-semibold text-cyan-300">{m.id}</th>
                          <td className="px-3 py-1.5">{m.arrival_time}</td>
                          <td className="px-3 py-1.5">{m.burst_time}</td>
                          <td className="px-3 py-1.5">{m.completion_time}</td>
                          <td className="px-3 py-1.5 text-cyan-200">{m.turnaround_time}</td>
                          <td className="px-3 py-1.5 text-emerald-300">{m.waiting_time}</td>
                          <td className="px-3 py-1.5">{m.response_time}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
