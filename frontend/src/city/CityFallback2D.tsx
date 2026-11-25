import React, { useMemo } from 'react'
import { Building2, Database } from 'lucide-react'
import type { SimulationState } from '../types/simulation'
import type { SelectedEntity } from '../stores/useSimulationStore'
import {
  buildConduitLinks,
  getProcessColorScheme,
  getResourceColorScheme,
} from './citySceneUtils'

interface CityFallback2DProps {
  simState: SimulationState
  selectedEntity: SelectedEntity
  onSelect: (entity: SelectedEntity) => void
  reason?: string
}

function toSvgCoord(x: number, z: number): { cx: number; cy: number } {
  // Map [-20..20] world space into [40..560] x [40..360] SVG viewBox
  return {
    cx: 300 + x * 12,
    cy: 200 + z * 8.5,
  }
}

export const CityFallback2D: React.FC<CityFallback2DProps> = ({
  simState,
  selectedEntity,
  onSelect,
  reason,
}) => {
  const deadlockedSet = useMemo(
    () => new Set(simState.deadlock_report.deadlocked_processes),
    [simState.deadlock_report.deadlocked_processes],
  )
  const involvedResSet = useMemo(
    () => new Set(simState.deadlock_report.involved_resources),
    [simState.deadlock_report.involved_resources],
  )
  const links = useMemo(
    () => buildConduitLinks(simState.processes, simState.resources, simState.deadlock_report),
    [simState.processes, simState.resources, simState.deadlock_report],
  )

  return (
    <div
      role="region"
      aria-label="2D Tactical City Map"
      className="flex h-full w-full flex-col items-center justify-center px-6 pt-16 pb-28"
    >
      <div className="hud-panel flex w-full max-w-4xl flex-col gap-3 p-4">
        <div className="flex items-center justify-between border-b border-[#243056] pb-2 text-xs">
          <span className="font-display font-semibold tracking-wider text-cyan-300 uppercase">
            2D Tactical City Grid {reason ? `(${reason})` : ''}
          </span>
          <span className="font-mono-tabular text-[11px] text-slate-400">
            {simState.processes.length} Processes • {simState.resources.length} Facilities
          </span>
        </div>

        <svg
          role="img"
          aria-label="Resource allocation and process city map"
          viewBox="0 0 600 400"
          className="h-[340px] w-full border border-[#1f294a] bg-[#08101f]"
        >
          {/* Rings */}
          <circle cx="300" cy="200" r="105" fill="none" stroke="#183857" strokeWidth="1" />
          <circle cx="300" cy="200" r="158" fill="none" stroke="#133349" strokeWidth="1" />

          {/* Conduits */}
          {links.map((link) => {
            const p1 = toSvgCoord(link.from[0], link.from[2])
            const p2 = toSvgCoord(link.to[0], link.to[2])
            const color = link.isDeadlocked
              ? '#ef4444'
              : link.isCycleOnly
                ? '#f59e0b'
                : link.kind === 'allocation'
                  ? '#00e5ff'
                  : '#f59e0b'
            return (
              <line
                key={link.id}
                x1={p1.cx}
                y1={p1.cy}
                x2={p2.cx}
                y2={p2.cy}
                stroke={color}
                strokeWidth={link.isDeadlocked ? 2.5 : 1.5}
                strokeDasharray={link.kind === 'request' ? '5 4' : undefined}
                opacity={0.85}
              />
            )
          })}

          {/* Resource Nodes */}
          {simState.resources.map((res) => {
            const pos = toSvgCoord(res.city_position.x, res.city_position.z)
            const isSel = selectedEntity?.kind === 'resource' && selectedEntity.id === res.id
            const scheme = getResourceColorScheme(res.status, involvedResSet.has(res.id))
            return (
              <g
                key={res.id}
                role="button"
                tabIndex={0}
                aria-label={`Resource ${res.id} ${res.name}, ${res.available_instances} of ${res.total_instances} available`}
                onClick={() => onSelect({ kind: 'resource', id: res.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect({ kind: 'resource', id: res.id })
                  }
                }}
                className="cursor-pointer"
              >
                <polygon
                  points={`${pos.cx},${pos.cy - 14} ${pos.cx + 14},${pos.cy} ${pos.cx},${pos.cy + 14} ${pos.cx - 14},${pos.cy}`}
                  fill="#0f1d34"
                  stroke={isSel ? '#00e5ff' : scheme.accent}
                  strokeWidth={isSel ? 2.5 : 1.5}
                />
                <text
                  x={pos.cx}
                  y={pos.cy + 25}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {res.id} ({res.available_instances}/{res.total_instances})
                </text>
              </g>
            )
          })}

          {/* Process Nodes */}
          {simState.processes.map((proc) => {
            const pos = toSvgCoord(proc.city_position.x, proc.city_position.z)
            const isSel = selectedEntity?.kind === 'process' && selectedEntity.id === proc.id
            const isDead = deadlockedSet.has(proc.id)
            const scheme = getProcessColorScheme(proc.state, isDead)
            return (
              <g
                key={proc.id}
                role="button"
                tabIndex={0}
                aria-label={`Process ${proc.id} ${proc.name}, state ${proc.state}`}
                onClick={() => onSelect({ kind: 'process', id: proc.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect({ kind: 'process', id: proc.id })
                  }
                }}
                className="cursor-pointer"
              >
                <rect
                  x={pos.cx - 14}
                  y={pos.cy - 14}
                  width="28"
                  height="28"
                  fill={scheme.body}
                  stroke={isSel ? '#00e5ff' : scheme.primary}
                  strokeWidth={isSel ? 2.5 : 1.5}
                />
                <text
                  x={pos.cx}
                  y={pos.cy + 3}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {proc.id}
                </text>
                <text
                  x={pos.cx}
                  y={pos.cy + 26}
                  textAnchor="middle"
                  fill={isDead ? '#fda4af' : '#94a3b8'}
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {scheme.badge}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Accessible Keyboard Button Roster */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1 text-cyan-300">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> Processes:
          </span>
          {simState.processes.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect({ kind: 'process', id: p.id })}
              className={`border px-2 py-0.5 font-mono-tabular ${
                selectedEntity?.kind === 'process' && selectedEntity.id === p.id
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-[#28335c] bg-[#0e142a] text-slate-300'
              }`}
            >
              {p.id}
            </button>
          ))}
          <span className="ml-2 flex items-center gap-1 text-emerald-300">
            <Database className="h-3.5 w-3.5" aria-hidden="true" /> Resources:
          </span>
          {simState.resources.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect({ kind: 'resource', id: r.id })}
              className={`border px-2 py-0.5 font-mono-tabular ${
                selectedEntity?.kind === 'resource' && selectedEntity.id === r.id
                  ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                  : 'border-[#28335c] bg-[#0e142a] text-slate-300'
              }`}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
