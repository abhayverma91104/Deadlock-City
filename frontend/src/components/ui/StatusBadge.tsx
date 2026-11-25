import React from 'react'
import type { ProcessState, ResourceStatus, SafetyStatus } from '../../types/simulation'

const SAFETY_STYLES: Record<SafetyStatus, string> = {
  SAFE: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300',
  UNSAFE: 'border-amber-400/60 bg-amber-500/15 text-amber-300',
  DEADLOCKED: 'border-rose-500/75 bg-rose-500/20 text-rose-300',
}

const PROCESS_STYLES: Record<ProcessState, string> = {
  NEW: 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200',
  READY: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200',
  RUNNING: 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200',
  WAITING: 'border-amber-400/60 bg-amber-500/15 text-amber-200',
  BLOCKED: 'border-rose-500/70 bg-rose-500/20 text-rose-200',
  TERMINATED: 'border-slate-600/60 bg-slate-800/60 text-slate-400',
}

const RESOURCE_STYLES: Record<ResourceStatus, string> = {
  AVAILABLE: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200',
  ALLOCATED: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200',
  REQUESTED: 'border-amber-400/60 bg-amber-500/15 text-amber-200',
  UNAVAILABLE: 'border-rose-500/70 bg-rose-500/20 text-rose-200',
}

export const SafetyBadge: React.FC<{ status: SafetyStatus }> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase font-mono-tabular ${SAFETY_STYLES[status]}`}
  >
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 rounded-full ${
        status === 'SAFE'
          ? 'bg-emerald-400'
          : status === 'UNSAFE'
            ? 'bg-amber-400'
            : 'bg-rose-500 pulse-status'
      }`}
    />
    {status}
  </span>
)

export const ProcessStateBadge: React.FC<{ state: ProcessState }> = ({ state }) => (
  <span
    className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase font-mono-tabular ${PROCESS_STYLES[state]}`}
  >
    {state}
  </span>
)

export const ResourceStatusBadge: React.FC<{ status: ResourceStatus }> = ({ status }) => (
  <span
    className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase font-mono-tabular ${RESOURCE_STYLES[status]}`}
  >
    {status}
  </span>
)
