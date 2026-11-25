import React, { useMemo, useState } from 'react'
import { ArrowUpRight, Filter, Search } from 'lucide-react'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { NavTabId, SimulationEvent } from '../types/simulation'
import {
  type EventCategoryFilter,
  filterTimelineEvents,
  formatUtcTimestamp,
  mapEventCategory,
} from './analyticsHelpers'

interface EventTimelinePanelProps {
  events: SimulationEvent[]
  totalRecordedEvents?: number
}

const CATEGORY_TABS: Array<{ id: EventCategoryFilter; label: string }> = [
  { id: 'ALL', label: 'All Events' },
  { id: 'PROCESS', label: 'Process' },
  { id: 'RESOURCE', label: 'Resource' },
  { id: 'REQUEST_ALLOC', label: 'Requests / Allocs' },
  { id: 'REJECTION', label: 'Rejections' },
  { id: 'DEADLOCK_SAFETY', label: 'Deadlock / Safety' },
  { id: 'RECOVERY_CHECKPOINT', label: 'Recovery / Rollback' },
]

export const EventTimelinePanel: React.FC<EventTimelinePanelProps> = ({
  events,
  totalRecordedEvents,
}) => {
  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)
  const setActiveTab = useSimulationStore((s) => s.setActiveTab)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<EventCategoryFilter>('ALL')
  const [severity, setSeverity] = useState<'ALL' | 'info' | 'success' | 'warning' | 'error'>('ALL')

  const filtered = useMemo(
    () => [...filterTimelineEvents(events, search, category, severity)].reverse(),
    [events, search, category, severity],
  )

  const navigateFromEvent = (ev: SimulationEvent) => {
    const pid = ev.metadata?.process_id ? String(ev.metadata.process_id) : null
    const rid = ev.metadata?.resource_id ? String(ev.metadata.resource_id) : null

    if (pid) setSelectedEntity({ kind: 'process', id: pid })
    else if (rid) setSelectedEntity({ kind: 'resource', id: rid })

    const cat = mapEventCategory(ev)
    let targetTab: NavTabId = 'city'
    if (cat === 'DEADLOCK_SAFETY') targetTab = 'detection'
    else if (cat === 'RECOVERY_CHECKPOINT') targetTab = 'recovery'
    else if (cat === 'REJECTION') targetTab = 'banker'
    else if (cat === 'REQUEST_ALLOC') targetTab = 'graph'
    setActiveTab(targetTab)
  }

  return (
    <div className="space-y-3">
      {/* Search & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border border-[#253057] bg-[#0a0f20] p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
          {CATEGORY_TABS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`border px-2 py-1 text-[11px] transition-colors ${
                category === c.id
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-[#28335c] bg-[#0e152b] text-slate-300 hover:border-cyan-400/50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-2 left-2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="ev-search" className="visually-hidden">
              Search event timeline
            </label>
            <input
              id="ev-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter message, P0, R1…"
              className="w-48 border border-[#2b3968] bg-[#0e152b] py-1 pr-2 pl-7 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <div>
            <label htmlFor="ev-severity" className="visually-hidden">
              Severity filter
            </label>
            <select
              id="ev-severity"
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as 'ALL' | 'info' | 'success' | 'warning' | 'error')
              }
              className="border border-[#2b3968] bg-[#0e152b] px-2 py-1 text-xs text-slate-100"
            >
              <option value="ALL">All Severities</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>
      </div>

      {/* Event Table */}
      <div className="overflow-auto border border-[#253057] bg-[#0a0f20]">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="border-b border-[#222d52] bg-[#101730] px-3 py-1.5 text-left font-display text-[11px] font-semibold text-cyan-300 uppercase">
            Recorded Simulation Event Timeline ({filtered.length} matching / {events.length} retained
            {typeof totalRecordedEvents === 'number' && totalRecordedEvents > events.length
              ? ` of ${totalRecordedEvents} total`
              : ''}
            )
          </caption>
          <thead className="bg-[#0e152b] text-[10px] font-mono-tabular text-slate-400 uppercase">
            <tr>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Tick</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Real Time</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Category</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Severity</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Entities</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Description</th>
              <th scope="col" className="border-b border-[#222d52] px-3 py-2">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1b2442]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No simulation events match the current filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((ev) => {
                const pid = ev.metadata?.process_id ? String(ev.metadata.process_id) : null
                const rid = ev.metadata?.resource_id ? String(ev.metadata.resource_id) : null
                const sevClass =
                  ev.severity === 'error'
                    ? 'text-rose-300 border-rose-500/50 bg-rose-500/10'
                    : ev.severity === 'warning'
                      ? 'text-amber-300 border-amber-500/50 bg-amber-500/10'
                      : ev.severity === 'success'
                        ? 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10'
                        : 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10'
                return (
                  <tr key={ev.id} className="hover:bg-[#111936]">
                    <th scope="row" className="px-3 py-2 font-mono-tabular text-cyan-300">
                      T{ev.tick}
                    </th>
                    <td className="px-3 py-2 font-mono-tabular text-[11px] text-slate-400">
                      {formatUtcTimestamp(ev.recorded_at)}
                    </td>
                    <td className="px-3 py-2 font-mono-tabular text-[11px] text-slate-200">
                      {ev.type}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`border px-1.5 py-0.5 font-mono-tabular text-[10px] uppercase ${sevClass}`}>
                        {ev.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono-tabular text-[11px] text-amber-200">
                      {[pid, rid].filter(Boolean).join(' • ') || 'System'}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{ev.message}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => navigateFromEvent(ev)}
                        aria-label={`Inspect event ${ev.id} in workbench`}
                        className="inline-flex items-center gap-1 border border-[#2b3968] bg-[#111834] px-2 py-0.5 text-[10px] text-cyan-200 hover:border-cyan-400"
                      >
                        Open
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
