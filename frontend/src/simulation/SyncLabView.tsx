import React, { useId, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Play, ShieldAlert } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SyncEvent, SyncReport } from '../types/simulation'
import { TracePlaybackControls } from './TracePlaybackControls'

type Scenario = 'producer_consumer' | 'readers_writers' | 'dining_philosophers'
type Mode = 'safe' | 'unsafe'

export const SyncLabView: React.FC = () => {
  const pushToast = useSimulationStore((s) => s.pushToast)

  const [scenario, setScenario] = useState<Scenario>('producer_consumer')
  const [mode, setMode] = useState<Mode>('safe')
  const [iterations, setIterations] = useState(6)
  const [bufferSize, setBufferSize] = useState(4)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<SyncReport | null>(null)
  const [stepIdx, setStepIdx] = useState(0)

  const iterId = useId()
  const bufId = useId()

  const handleRun = async () => {
    setRunning(true)
    try {
      const rep = await apiClient.runSynchronization({
        scenario,
        mode,
        iterations,
        buffer_size: bufferSize,
        seed: 42,
      })
      setReport(rep)
      setStepIdx(Math.max(0, rep.events.length - 1))
    } catch (err) {
      pushToast({
        severity: 'error',
        title: 'Synchronization Lab Error',
        message: err instanceof Error ? err.message : 'Unable to execute C++ SyncLab.',
      })
    } finally {
      setRunning(false)
    }
  }

  const events = report?.events ?? []
  const activeEvent: SyncEvent | null = events[Math.min(stepIdx, Math.max(0, events.length - 1))] ?? null

  // Derive per-philosopher state up to active step from actual C++ events
  const philosopherStates = ['THINKING', 'THINKING', 'THINKING', 'THINKING', 'THINKING']
  if (report?.scenario === 'dining_philosophers') {
    for (let i = 0; i <= stepIdx && i < events.length; i += 1) {
      const ev = events[i]!
      const match = ev.thread_id.match(/Philosopher-(\d+)/)
      if (match) {
        const idx = Number(match[1])
        if (idx >= 0 && idx < 5) philosopherStates[idx] = ev.state
      }
    }
  }

  const forkOwners = activeEvent?.fork_owners ?? [-1, -1, -1, -1, -1]

  return (
    <section
      aria-label="Synchronization Laboratory"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              C++17 Concurrency &amp; Synchronization Lab
            </h1>
            <p className="text-[11px] text-slate-400">
              Isolated real std::thread / std::mutex / std::condition_variable execution (bounded time)
            </p>
          </div>
        </div>

        <div role="tablist" aria-label="Synchronization scenarios" className="flex border border-[#2a3866] bg-[#0a0f20] p-0.5 text-xs">
          {[
            { id: 'producer_consumer', label: 'Producer-Consumer' },
            { id: 'readers_writers', label: 'Readers-Writers' },
            { id: 'dining_philosophers', label: 'Dining Philosophers' },
          ].map((sc) => (
            <button
              key={sc.id}
              type="button"
              role="tab"
              aria-selected={scenario === sc.id}
              onClick={() => {
                setScenario(sc.id as Scenario)
                setReport(null)
              }}
              className={`border-b-2 px-3 py-1 font-medium ${
                scenario === sc.id
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      {/* Config Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202a4d] bg-[#0b1022] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 border border-[#2a3866] bg-[#0e152b] p-0.5">
            <button
              type="button"
              aria-pressed={mode === 'safe'}
              onClick={() => setMode('safe')}
              className={`px-2.5 py-1 text-[11px] font-medium ${
                mode === 'safe' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
              }`}
            >
              Safe (Synchronized)
            </button>
            <button
              type="button"
              aria-pressed={mode === 'unsafe'}
              onClick={() => setMode('unsafe')}
              className={`px-2.5 py-1 text-[11px] font-medium ${
                mode === 'unsafe' ? 'bg-rose-500/20 text-rose-300' : 'text-slate-400'
              }`}
            >
              Unsafe (Race / Contention)
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor={iterId} className="text-[11px] text-slate-300">Iterations</label>
            <input
              id={iterId}
              type="number"
              min={1}
              max={40}
              value={iterations}
              onChange={(e) => setIterations(Math.min(40, Math.max(1, Number(e.target.value) || 1)))}
              className="w-16 border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs"
            />
          </div>

          {scenario === 'producer_consumer' ? (
            <div className="flex items-center gap-1.5">
              <label htmlFor={bufId} className="text-[11px] text-slate-300">Buffer Capacity</label>
              <input
                id={bufId}
                type="number"
                min={1}
                max={16}
                value={bufferSize}
                onChange={(e) => setBufferSize(Math.min(16, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 border border-[#2b3968] bg-[#0e152b] px-2 py-1 font-mono-tabular text-xs"
              />
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={running}
          onClick={() => void handleRun()}
          className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3.5 py-1 font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {running ? 'Running C++ Threads…' : 'Execute C++ Experiment'}
        </button>
      </div>

      {/* Main Visualizer + Trace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
        {!report ? (
          <div className="xl:col-span-3 flex items-center justify-center border border-[#253057] bg-[#0a0f20] p-10 text-xs text-slate-400">
            Select Safe or Unsafe mode and click &ldquo;Execute C++ Experiment&rdquo; to inspect real recorded C++ thread events.
          </div>
        ) : (
          <>
            <div className="xl:col-span-2 flex flex-col gap-3">
              {/* Outcome Banner */}
              <div
                className={`flex items-center justify-between gap-2 border px-3.5 py-2 text-xs ${
                  report.completed_cleanly
                    ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200'
                    : 'border-rose-500/60 bg-rose-950/35 text-rose-200'
                }`}
              >
                <span className="flex items-center gap-2">
                  {report.completed_cleanly ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  ) : report.scenario === 'dining_philosophers' ? (
                    <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
                  )}
                  {report.summary}
                </span>
                <span className="font-mono-tabular text-[10px] uppercase">
                  {report.scenario === 'dining_philosophers' && !report.completed_cleanly
                    ? 'Deadlock Timeout'
                    : report.race_or_deadlock_detected
                      ? 'Race / Sync Violation'
                      : 'Verified Clean'}
                </span>
              </div>

              {/* Event Trace Playback */}
              <TracePlaybackControls
                label="Synchronization event playback"
                totalSteps={events.length}
                currentStep={stepIdx}
                onStepChange={setStepIdx}
              />

              {/* Scenario-Specific Visualizer driven by activeEvent */}
              {report.scenario === 'producer_consumer' ? (
                <div className="border border-[#253057] bg-[#0a0f20] p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono-tabular">
                    <span>Produced: <strong className="text-cyan-300">{report.produced_count}</strong></span>
                    <span>Consumed: <strong className="text-emerald-300">{report.consumed_count}</strong></span>
                    <span>Overflows: <strong className={report.overflows > 0 ? 'text-rose-400' : 'text-slate-300'}>{report.overflows}</strong></span>
                    <span>Underflows: <strong className={report.underflows > 0 ? 'text-rose-400' : 'text-slate-300'}>{report.underflows}</strong></span>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-300">
                      <span>Bounded Buffer Slots (Event #{activeEvent?.seq ?? 0})</span>
                      <span className="font-mono-tabular text-cyan-300">
                        Occupancy: {activeEvent?.buffer_occupancy ?? 0} / {activeEvent?.buffer_capacity ?? bufferSize}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {Array.from({ length: activeEvent?.buffer_capacity ?? bufferSize }).map((_, idx) => {
                        const occ = activeEvent?.buffer_occupancy ?? 0
                        const filled = idx < Math.max(0, occ)
                        const overflowed = occ > (activeEvent?.buffer_capacity ?? bufferSize)
                        return (
                          <div
                            key={idx}
                            className={`flex h-12 items-center justify-center border font-mono-tabular text-[11px] ${
                              overflowed && filled
                                ? 'border-rose-500 bg-rose-500/25 text-rose-200'
                                : filled
                                  ? 'border-cyan-400 bg-cyan-500/25 text-cyan-100'
                                  : 'border-[#253057] bg-[#0d1429] text-slate-500'
                            }`}
                          >
                            {filled ? `SLOT ${idx}` : 'EMPTY'}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : report.scenario === 'readers_writers' ? (
                <div className="border border-[#253057] bg-[#0a0f20] p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-3 font-mono-tabular">
                    <div className="border border-[#1f294a] bg-[#0e152b] p-3">
                      <div className="text-[10px] text-slate-400 uppercase">Active Readers</div>
                      <div className="mt-1 text-xl font-bold text-cyan-300">{activeEvent?.active_readers ?? 0}</div>
                    </div>
                    <div className="border border-[#1f294a] bg-[#0e152b] p-3">
                      <div className="text-[10px] text-slate-400 uppercase">Active Writers</div>
                      <div className="mt-1 text-xl font-bold text-amber-300">{activeEvent?.active_writers ?? 0}</div>
                    </div>
                    <div className="border border-[#1f294a] bg-[#0e152b] p-3">
                      <div className="text-[10px] text-slate-400 uppercase">R/W Conflicts</div>
                      <div className={`mt-1 text-xl font-bold ${report.conflicts > 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
                        {report.conflicts}
                      </div>
                    </div>
                  </div>
                  <div className="border border-[#1f294a] bg-[#0c1224] p-3">
                    <span className="font-mono-tabular text-cyan-300">[{activeEvent?.thread_id ?? '---'}]</span>{' '}
                    <span className="text-slate-200">{activeEvent?.detail ?? ''}</span>
                  </div>
                </div>
              ) : (
                /* Dining Philosophers Circular Table */
                <div className="border border-[#253057] bg-[#0a0f20] p-4 text-xs">
                  <div className="mb-2 flex items-center justify-between font-mono-tabular">
                    <span>Completed Meals: <strong className="text-emerald-300">{report.completed_meals}</strong></span>
                    <span>Circular-Wait Timeouts: <strong className={report.conflicts > 0 ? 'text-rose-400' : 'text-slate-300'}>{report.conflicts}</strong></span>
                  </div>
                  <svg viewBox="0 0 360 250" className="mx-auto h-56 w-full max-w-md" role="img" aria-label="Dining philosophers circular arrangement">
                    <circle cx="180" cy="125" r="56" fill="#0d162c" stroke="#283562" strokeWidth="2" />
                    <text x="180" y="129" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">
                      TABLE
                    </text>

                    {[0, 1, 2, 3, 4].map((i) => {
                      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
                      const px = 180 + Math.cos(angle) * 92
                      const py = 125 + Math.sin(angle) * 86
                      const st = philosopherStates[i] ?? 'THINKING'
                      const stroke =
                        st === 'EATING'
                          ? '#10b981'
                          : st === 'BLOCKED'
                            ? '#ef4444'
                            : st === 'WAITING' || st === 'HUNGRY'
                              ? '#f59e0b'
                              : '#22d3ee'

                      // Fork i sits between Philosopher i and (i+1)%5
                      const fAngle = ((i + 0.5) / 5) * Math.PI * 2 - Math.PI / 2
                      const fx = 180 + Math.cos(fAngle) * 66
                      const fy = 125 + Math.sin(fAngle) * 62
                      const owner = forkOwners[i] ?? -1

                      return (
                        <g key={i}>
                          <circle cx={fx} cy={fy} r="9" fill={owner >= 0 ? '#0ea5e9' : '#1e293b'} stroke={owner >= 0 ? '#38bdf8' : '#475569'} />
                          <text x={fx} y={fy + 3} textAnchor="middle" fill="#f8fafc" fontSize="8" fontFamily="JetBrains Mono">
                            F{i}
                          </text>
                          <circle cx={px} cy={py} r="20" fill="#0f172e" stroke={stroke} strokeWidth="2.5" />
                          <text x={px} y={py - 1} textAnchor="middle" fill="#f8fafc" fontSize="9" fontWeight="700" fontFamily="JetBrains Mono">
                            Ph{i}
                          </text>
                          <text x={px} y={py + 9} textAnchor="middle" fill={stroke} fontSize="7" fontFamily="JetBrains Mono">
                            {st}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              )}
            </div>

            {/* Right: Recorded C++ Execution Event Timeline */}
            <div className="flex flex-col border border-[#253057] bg-[#0a0f20] overflow-hidden">
              <div className="border-b border-[#222d52] bg-[#101730] px-3 py-2 font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
                Recorded C++ Thread Events ({events.length})
              </div>
              <ul className="flex-1 divide-y divide-[#1a2240] overflow-y-auto p-2 text-[11px] font-mono-tabular">
                {events.map((ev, idx) => (
                  <li key={ev.seq}>
                    <button
                      type="button"
                      onClick={() => setStepIdx(idx)}
                      className={`w-full px-2 py-1.5 text-left transition-colors ${
                        idx === stepIdx ? 'bg-cyan-500/20 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-cyan-300">{ev.thread_id}</span>
                        <span
                          className={`text-[10px] ${
                            ev.state === 'RACE' || ev.state === 'BLOCKED'
                              ? 'text-rose-400'
                              : ev.state === 'WAITING' || ev.state === 'HUNGRY'
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                          }`}
                        >
                          {ev.action}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">{ev.detail}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
