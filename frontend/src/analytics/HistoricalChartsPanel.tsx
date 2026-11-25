import React, { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FastForward, Table2 } from 'lucide-react'
import {
  type EnrichedHistoryPoint,
  filterHistoryRange,
  formatUtcTimestamp,
  type HistoryRangeMode,
  normalizeAndBoundHistory,
  type TimeAxisMode,
} from './analyticsHelpers'
import type { MetricPoint, SafetyStatus } from '../types/simulation'

interface HistoricalChartsPanelProps {
  metricsHistory: MetricPoint[]
  totalRecordedSamples?: number
  currentSafety: SafetyStatus
  currentTick: number
  isMutating: boolean
  onStepTick: () => void
}

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{
    name?: string
    value?: number | string
    color?: string
    payload?: EnrichedHistoryPoint
  }>
}

const HistoricalTooltip: React.FC<ChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  return (
    <div className="border border-[#324275] bg-[#0a0f20]/95 px-3 py-2 text-[11px] font-mono-tabular text-slate-100 shadow-lg">
      <div className="mb-1 border-b border-[#243058] pb-1 text-cyan-300">
        Simulation Tick {pt.tick} • {pt.safety_status}
      </div>
      <div className="mb-1.5 text-[10px] text-slate-400">
        Timestamp: {formatUtcTimestamp(pt.recordedAt)}
      </div>
      <div className="space-y-0.5">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-3">
            <span className="text-slate-300" style={{ color: entry.color }}>
              {entry.name}:
            </span>
            <span className="font-semibold text-slate-100">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const HistoricalChartsPanel: React.FC<HistoricalChartsPanelProps> = React.memo(
  ({ metricsHistory, totalRecordedSamples, currentSafety, currentTick, isMutating, onStepTick }) => {
    const [rangeMode, setRangeMode] = useState<HistoryRangeMode>('all')
    const [axisMode, setAxisMode] = useState<TimeAxisMode>('tick')
    const [customMinTick, setCustomMinTick] = useState<number>(0)
    const [customMaxTick, setCustomMaxTick] = useState<number>(Math.max(10, currentTick))
    const [showDataTable, setShowDataTable] = useState(false)

    const boundedPoints = useMemo(
      () => normalizeAndBoundHistory(metricsHistory, currentSafety, 240),
      [metricsHistory, currentSafety],
    )

    const filteredPoints = useMemo(
      () => filterHistoryRange(boundedPoints, rangeMode, customMinTick, customMaxTick),
      [boundedPoints, rangeMode, customMinTick, customMaxTick],
    )

    const totalRecorded = Math.max(boundedPoints.length, totalRecordedSamples ?? boundedPoints.length)
    const discardedSamples = Math.max(0, totalRecorded - boundedPoints.length)
    const retainedRangeLabel =
      boundedPoints.length > 0
        ? `T${boundedPoints[0]!.tick}–T${boundedPoints[boundedPoints.length - 1]!.tick}`
        : 'None'

    const xDataKey = axisMode === 'tick' ? 'tickLabel' : 'timeLabel'

    if (boundedPoints.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 border border-[#253057] bg-[#0a0f20] p-8 text-center text-xs text-slate-300">
          <p className="font-display text-sm font-semibold text-cyan-300 uppercase">
            No Historical Samples Recorded
          </p>
          <p className="max-w-md text-slate-400">
            Load a preset or step the C++ simulation engine to begin capturing bounded time-series snapshots.
          </p>
          <button
            type="button"
            disabled={isMutating}
            onClick={onStepTick}
            className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/70 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
          >
            <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
            Step +1 Tick
          </button>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#253057] bg-[#0a0f20] px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Range:
            </span>
            {(
              [
                { id: 'all', label: `All (${boundedPoints.length})` },
                { id: 'last20', label: 'Last 20' },
                { id: 'last10', label: 'Last 10' },
                { id: 'custom', label: 'Custom Ticks' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={rangeMode === opt.id}
                onClick={() => setRangeMode(opt.id)}
                className={`border px-2.5 py-1 text-[11px] font-mono-tabular ${
                  rangeMode === opt.id
                    ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                    : 'border-[#28335c] bg-[#0e152b] text-slate-300 hover:border-cyan-400/50'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {rangeMode === 'custom' ? (
              <div className="flex items-center gap-1.5 font-mono-tabular text-[11px]">
                <label htmlFor="hist-min-tick" className="text-slate-400">From</label>
                <input
                  id="hist-min-tick"
                  type="number"
                  min={0}
                  value={customMinTick}
                  onChange={(e) => setCustomMinTick(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 border border-[#2b3968] bg-[#0e152b] px-1.5 py-0.5 text-slate-100"
                />
                <label htmlFor="hist-max-tick" className="text-slate-400">To</label>
                <input
                  id="hist-max-tick"
                  type="number"
                  min={0}
                  value={customMaxTick}
                  onChange={(e) => setCustomMaxTick(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 border border-[#2b3968] bg-[#0e152b] px-1.5 py-0.5 text-slate-100"
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400">X-Axis:</span>
            <button
              type="button"
              aria-pressed={axisMode === 'tick'}
              onClick={() => setAxisMode('tick')}
              className={`border px-2 py-1 text-[11px] ${
                axisMode === 'tick'
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-[#28335c] bg-[#0e152b] text-slate-300'
              }`}
            >
              Sim Tick
            </button>
            <button
              type="button"
              aria-pressed={axisMode === 'timestamp'}
              onClick={() => setAxisMode('timestamp')}
              className={`border px-2 py-1 text-[11px] ${
                axisMode === 'timestamp'
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-[#28335c] bg-[#0e152b] text-slate-300'
              }`}
            >
              Real Time (UTC)
            </button>
            <button
              type="button"
              aria-pressed={showDataTable}
              onClick={() => setShowDataTable((s) => !s)}
              className="inline-flex items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-400"
            >
              <Table2 className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
              {showDataTable ? 'Hide Table' : 'Accessible Table'}
            </button>
          </div>
        </div>

        {discardedSamples > 0 ? (
          <div className="border border-cyan-500/35 bg-cyan-950/20 px-3.5 py-2 text-[11px] font-mono-tabular text-cyan-200">
            Bounded retention window: displaying latest {boundedPoints.length} of {totalRecorded} recorded samples ({retainedRangeLabel}); {discardedSamples} earlier sample(s) trimmed at the 240-sample cap.
          </div>
        ) : null}

        {filteredPoints.length < 2 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-amber-500/40 bg-amber-950/25 px-3.5 py-2 text-xs text-amber-200">
            <span>
              Insufficient trend span ({filteredPoints.length} sample in selected range). Advance ticks or adjust custom tick range to observe multi-point trends.
            </span>
            <button
              type="button"
              disabled={isMutating}
              onClick={onStepTick}
              className="inline-flex min-h-7 items-center gap-1 border border-amber-400/70 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30"
            >
              <FastForward className="h-3 w-3" aria-hidden="true" />
              Step +1 Tick
            </button>
          </div>
        ) : null}

        {/* 8 Historical Charts Grid */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* 1. Resource Utilization (%) */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-cyan-300 uppercase">
              <span>1. Resource Utilization (%) Over Time</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">
                Latest: {filteredPoints[filteredPoints.length - 1]?.utilization_pct ?? 0}%
              </span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={10} unit="%" />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area
                    type="monotone"
                    dataKey="utilization_pct"
                    name="Utilization %"
                    stroke="#22d3ee"
                    fill="#0891b2"
                    fillOpacity={0.28}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 2. Available vs Allocated Resource Instances */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-emerald-300 uppercase">
              <span>2. Available vs. Allocated Resource Units</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Instances</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="allocation_count"
                    name="Allocated Units"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="available_count"
                    name="Available Units"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 3. Process Lifecycle Distribution Over Time */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-cyan-300 uppercase">
              <span>3. Process Lifecycle Distribution</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Process Count</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="active_count" name="Active" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="blocked_count" name="Blocked" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="waiting_count" name="Waiting" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="terminated_count" name="Terminated" stroke="#94a3b8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 4. Pending Resource Requests Over Time */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-amber-300 uppercase">
              <span>4. Pending Resource Requests</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Requested Units</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="pending_request_units" name="Pending Units" fill="#f59e0b" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 5. Process Completion Trends */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-emerald-300 uppercase">
              <span>5. Process Completion &amp; Termination Trend</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Cumulative</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area type="stepAfter" dataKey="completed_count" name="Completed" stroke="#10b981" fill="#10b981" fillOpacity={0.22} isAnimationActive={false} />
                  <Area type="stepAfter" dataKey="terminated_count" name="Total Terminated" stroke="#64748b" fill="#64748b" fillOpacity={0.14} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 6. Deadlock Occurrence Timeline */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-rose-300 uppercase">
              <span>6. Deadlock Occurrence Timeline</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Events &amp; Scope</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="stepAfter" dataKey="deadlock_count" name="Deadlock Occurrences" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey="deadlocked_count" name="Deadlocked Processes" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 7. Recovery Event Timeline */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-cyan-300 uppercase">
              <span>7. Recovery Operations Timeline</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">Cumulative Recoveries</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={10} />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area type="stepAfter" dataKey="recovery_count" name="Recovery Ops" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.22} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </figure>

          {/* 8. Safety State Transitions */}
          <figure className="border border-[#253057] bg-[#0a0f20] p-3">
            <figcaption className="mb-2 flex items-center justify-between text-xs font-display font-semibold text-emerald-300 uppercase">
              <span>8. Safety State Transitions</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">2=SAFE • 1=UNSAFE • 0=DEADLOCK</span>
            </figcaption>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredPoints}>
                  <CartesianGrid stroke="#1d2747" strokeDasharray="3 3" />
                  <XAxis dataKey={xDataKey} stroke="#94a3b8" fontSize={10} />
                  <YAxis
                    domain={[0, 2]}
                    ticks={[0, 1, 2]}
                    tickFormatter={(v) => (v === 2 ? 'SAFE' : v === 1 ? 'UNSAFE' : 'DEADLOCK')}
                    stroke="#94a3b8"
                    fontSize={9}
                    width={62}
                  />
                  <Tooltip content={<HistoricalTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line
                    type="stepAfter"
                    dataKey="safety_numeric"
                    name="Safety Level (0-2)"
                    stroke="#10b981"
                    strokeWidth={2.2}
                    dot
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>
        </div>

        {/* Accessible Tabular Alternative */}
        {showDataTable ? (
          <div className="overflow-auto border border-[#253057] bg-[#0a0f20]">
            <table className="w-full border-collapse text-left text-xs font-mono-tabular">
              <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-cyan-300 uppercase">
                Historical Telemetry Samples ({filteredPoints.length} points, capped at 240)
              </caption>
              <thead className="bg-[#0e152b] text-[10px] text-slate-400 uppercase">
                <tr>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Tick</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Recorded UTC</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Safety</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Util %</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Avail</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Alloc</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Active/Blk</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Pending Req</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">Comp</th>
                  <th scope="col" className="border-b border-[#222d52] px-3 py-1.5">DL/Rec</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2442]">
                {filteredPoints.map((pt) => (
                  <tr key={`${pt.index}-${pt.tick}`}>
                    <th scope="row" className="px-3 py-1.5 text-cyan-300">{pt.tick}</th>
                    <td className="px-3 py-1.5 text-slate-400">{formatUtcTimestamp(pt.recordedAt)}</td>
                    <td className="px-3 py-1.5">{pt.safety_status}</td>
                    <td className="px-3 py-1.5">{pt.utilization_pct}%</td>
                    <td className="px-3 py-1.5">{pt.available_count}</td>
                    <td className="px-3 py-1.5">{pt.allocation_count}</td>
                    <td className="px-3 py-1.5">{pt.active_count}/{pt.blocked_count}</td>
                    <td className="px-3 py-1.5">{pt.pending_request_units}</td>
                    <td className="px-3 py-1.5">{pt.completed_count}</td>
                    <td className="px-3 py-1.5">{pt.deadlock_count}/{pt.recovery_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    )
  },
)
HistoricalChartsPanel.displayName = 'HistoricalChartsPanel'
