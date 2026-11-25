import React, { useId, useState } from 'react'
import { EXPERIMENT_PRESETS } from '../types/simulation'
import { useSimulationStore } from '../stores/useSimulationStore'
import { NativeDialog } from '../components/ui/NativeDialog'

interface CreateSessionDialogProps {
  open: boolean
  onClose: () => void
}

export const CreateSessionDialog: React.FC<CreateSessionDialogProps> = ({ open, onClose }) => {
  const currentPreset = useSimulationStore((s) => s.simState?.preset ?? 'normal_workload')
  const currentSeed = useSimulationStore((s) => s.simState?.seed ?? 42)
  const sessionId = useSimulationStore((s) => s.sessionId)
  const isMutating = useSimulationStore((s) => s.isMutating)
  const createSession = useSimulationStore((s) => s.createSession)
  const selectPreset = useSimulationStore((s) => s.selectPreset)

  const [selectedPreset, setSelectedPreset] = useState<string>(currentPreset)
  const [seedInput, setSeedInput] = useState<number>(currentSeed)
  const seedId = useId()

  const handleLoadInCurrent = async () => {
    await selectPreset(selectedPreset, seedInput)
    onClose()
  }

  const handleCreateNew = async () => {
    await createSession(selectedPreset, seedInput, 1.0)
    onClose()
  }

  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      title="Simulation Session & Experiment Presets"
      subtitle="All scenarios execute inside the C++17 simulation engine."
    >
      <div className="space-y-4">
        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {EXPERIMENT_PRESETS.map((preset) => {
            const active = selectedPreset === preset.id
            const badgeColor =
              preset.category === 'Safe'
                ? 'text-emerald-300 border-emerald-500/40'
                : preset.category === 'Deadlock'
                  ? 'text-rose-300 border-rose-500/50'
                  : 'text-amber-300 border-amber-500/40'
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedPreset(preset.id)}
                className={`flex flex-col items-start border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15'
                    : 'border-[#253159] bg-[#0c1124] hover:border-[#394b85]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-xs font-semibold text-slate-100">
                    {preset.label}
                  </span>
                  <span className={`border px-1.5 py-0.5 text-[9px] font-mono-tabular uppercase ${badgeColor}`}>
                    {preset.category}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-400">{preset.description}</p>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[#222d52] pt-3">
          <div className="flex items-center gap-2">
            <label htmlFor={seedId} className="text-xs font-medium text-slate-300">
              Deterministic Seed
            </label>
            <input
              id={seedId}
              type="number"
              min={0}
              value={seedInput}
              onChange={(e) => setSeedInput(Math.max(0, Number(e.target.value) || 0))}
              className="font-mono-tabular w-24 border border-[#2c3a67] bg-[#090d1c] px-2 py-1 text-xs text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2">
            {sessionId ? (
              <button
                type="button"
                disabled={isMutating}
                onClick={() => void handleLoadInCurrent()}
                className="min-h-8 border border-[#324275] bg-[#141c3b] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-50"
              >
                Load in Current
              </button>
            ) : null}
            <button
              type="button"
              disabled={isMutating}
              onClick={() => void handleCreateNew()}
              className="min-h-8 border border-cyan-400 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              Create New Session
            </button>
          </div>
        </div>
      </div>
    </NativeDialog>
  )
}
