import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  Compass,
  Crosshair,
  Eye,
  Loader2,
  Maximize2,
  RefreshCw,
  ServerOff,
  Sliders,
} from 'lucide-react'
import {
  type GraphicsQuality,
  useSimulationStore,
} from '../stores/useSimulationStore'
import { CityCameraRig } from './CityCameraRig'
import { CityFallback2D } from './CityFallback2D'
import { CityInfrastructure } from './CityInfrastructure'
import {
  QUALITY_PROFILES,
  buildConduitLinks,
  detectWebGLSupport,
  resolveEntityPosition,
} from './citySceneUtils'
import { ProcessBuilding } from './ProcessBuilding'
import { ResourceConduits } from './ResourceConduits'
import { ResourceFacility } from './ResourceFacility'
import { WebGLErrorBoundary } from './WebGLErrorBoundary'

interface CityCanvasViewportProps {
  onOpenSessionDialog: () => void
}

export const CityCanvasViewport: React.FC<CityCanvasViewportProps> = ({
  onOpenSessionDialog,
}) => {
  const simState = useSimulationStore((s) => s.simState)
  const isLoading = useSimulationStore((s) => s.isLoading)
  const errorMessage = useSimulationStore((s) => s.errorMessage)
  const backendConnected = useSimulationStore((s) => s.backendConnected)
  const selectedEntity = useSimulationStore((s) => s.selectedEntity)
  const hoveredEntity = useSimulationStore((s) => s.hoveredEntity)
  const graphicsQuality = useSimulationStore((s) => s.graphicsQuality)
  const viewMode = useSimulationStore((s) => s.viewMode)
  const cameraCommand = useSimulationStore((s) => s.cameraCommand)

  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)
  const setHoveredEntity = useSimulationStore((s) => s.setHoveredEntity)
  const setGraphicsQuality = useSimulationStore((s) => s.setGraphicsQuality)
  const setViewMode = useSimulationStore((s) => s.setViewMode)
  const triggerCamera = useSimulationStore((s) => s.triggerCamera)
  const bootstrapSession = useSimulationStore((s) => s.bootstrapSession)

  const prefersReducedMotion = useReducedMotion() ?? false
  const [webglSupported] = useState<boolean>(() => detectWebGLSupport())
  const [contextLost, setContextLost] = useState(false)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasEl) return
    const handleLost = (e: Event) => {
      e.preventDefault()
      setContextLost(true)
    }
    const handleRestored = () => {
      setContextLost(false)
    }
    canvasEl.addEventListener('webglcontextlost', handleLost)
    canvasEl.addEventListener('webglcontextrestored', handleRestored)
    return () => {
      canvasEl.removeEventListener('webglcontextlost', handleLost)
      canvasEl.removeEventListener('webglcontextrestored', handleRestored)
    }
  }, [canvasEl])

  const qualityProfile = QUALITY_PROFILES[graphicsQuality]

  const deadlockedSet = useMemo(
    () => new Set(simState?.deadlock_report.deadlocked_processes ?? []),
    [simState?.deadlock_report.deadlocked_processes],
  )
  const involvedResSet = useMemo(
    () => new Set(simState?.deadlock_report.involved_resources ?? []),
    [simState?.deadlock_report.involved_resources],
  )
  const cycleOnlyNodes = useMemo(() => {
    const s = new Set<string>()
    if (simState && simState.deadlock_report.has_cycle_in_rag && !simState.deadlock_report.detected) {
      for (const cyc of simState.deadlock_report.cycles) {
        for (const id of cyc) s.add(id)
      }
    }
    return s
  }, [simState])

  const conduitLinks = useMemo(() => {
    if (!simState) return []
    return buildConduitLinks(simState.processes, simState.resources, simState.deadlock_report)
  }, [simState])

  const focusTarget = useMemo(() => {
    if (!simState) return null
    return resolveEntityPosition(selectedEntity, simState.processes, simState.resources)
  }, [simState, selectedEntity])

  const handleSelectProcess = useCallback(
    (id: string) => setSelectedEntity({ kind: 'process', id }),
    [setSelectedEntity],
  )
  const handleFocusProcess = useCallback(
    (id: string) => {
      setSelectedEntity({ kind: 'process', id })
      triggerCamera('focus')
    },
    [setSelectedEntity, triggerCamera],
  )
  const handleHoverProcess = useCallback(
    (id: string | null) => setHoveredEntity(id ? { kind: 'process', id } : null),
    [setHoveredEntity],
  )

  const handleSelectResource = useCallback(
    (id: string) => setSelectedEntity({ kind: 'resource', id }),
    [setSelectedEntity],
  )
  const handleFocusResource = useCallback(
    (id: string) => {
      setSelectedEntity({ kind: 'resource', id })
      triggerCamera('focus')
    },
    [setSelectedEntity, triggerCamera],
  )
  const handleHoverResource = useCallback(
    (id: string | null) => setHoveredEntity(id ? { kind: 'resource', id } : null),
    [setHoveredEntity],
  )

  const resources = simState?.resources ?? []
  const totalInst = resources.reduce((acc, r) => acc + r.total_instances, 0)
  const allocInst = resources.reduce((acc, r) => acc + r.allocated_instances, 0)
  const utilPct = totalInst > 0 ? Math.round((allocInst / totalInst) * 100) : 0

  const showFallback = viewMode === '2d' || !webglSupported || contextLost

  return (
    <main
      aria-label="Interactive 3D City Viewport"
      className="city-atmospheric-bg relative h-full w-full overflow-hidden select-none"
    >
      {/* Mid-Right System Summary & Camera/Quality Controls */}
      {simState ? (
        <aside
          aria-label="City sector and camera controls"
          className="pointer-events-auto fixed right-4 top-48 z-20 hidden sm:flex flex-col gap-2"
        >
          {/* Sector Summary Badge (matches reference Patland summary) */}
          <div className="hud-panel flex flex-col gap-1 px-3 py-2 text-xs">
            <span className="font-display text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              City Sector
            </span>
            <div className="flex items-center gap-3 font-mono-tabular">
              <span className="text-slate-200">
                {allocInst}/{totalInst} Units
              </span>
              <span className="font-semibold text-cyan-300">{utilPct}% Util</span>
            </div>
            {simState.deadlock_report.detected ? (
              <span className="text-[10px] font-semibold text-rose-300">
                {simState.deadlock_report.deadlocked_processes.length} Deadlocked
              </span>
            ) : simState.safety_status === 'UNSAFE' ? (
              <span className="text-[10px] font-semibold text-amber-300">
                Unsafe (No Deadlock)
              </span>
            ) : simState.banker_report.safe_sequence.length > 0 ? (
              <span className="text-[10px] text-emerald-300 font-mono-tabular">
                Seq: {simState.banker_report.safe_sequence.join('→')}
              </span>
            ) : null}
          </div>

          {/* Camera & Quality Toolbar */}
          <div className="hud-panel flex flex-col gap-1.5 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-1 border-b border-[#222d52] pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              <span className="flex items-center gap-1">
                <Compass className="h-3 w-3 text-cyan-300" aria-hidden="true" />
                Viewport
              </span>
              <button
                type="button"
                onClick={() => setViewMode(viewMode === '3d' ? '2d' : '3d')}
                aria-pressed={viewMode === '2d'}
                title="Switch between 3D WebGL City and 2D Tactical Map"
                className="border border-[#2b3968] bg-[#10162f] px-1.5 py-0.5 text-[9px] font-mono-tabular text-cyan-200 hover:border-cyan-400"
              >
                {viewMode === '3d' ? '3D' : '2D'}
              </button>
            </div>

            {!showFallback ? (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => triggerCamera('isometric')}
                  title="Reset to isometric overview"
                  className="inline-flex items-center justify-center gap-1 border border-[#27335c] bg-[#0e142c] px-2 py-1 text-[10px] text-slate-200 hover:border-cyan-400"
                >
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  Iso
                </button>
                <button
                  type="button"
                  onClick={() => triggerCamera('top')}
                  title="Top-down tactical overview"
                  className="inline-flex items-center justify-center gap-1 border border-[#27335c] bg-[#0e142c] px-2 py-1 text-[10px] text-slate-200 hover:border-cyan-400"
                >
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  Top
                </button>
                <button
                  type="button"
                  aria-disabled={!selectedEntity}
                  onClick={() => {
                    if (selectedEntity) triggerCamera('focus')
                  }}
                  title="Focus camera on selected building or facility"
                  className="col-span-2 inline-flex items-center justify-center gap-1 border border-[#27335c] bg-[#0e142c] px-2 py-1 text-[10px] text-cyan-200 hover:border-cyan-400 aria-disabled:opacity-45"
                >
                  <Crosshair className="h-3 w-3" aria-hidden="true" />
                  Focus Selected
                </button>
              </div>
            ) : null}

            {/* Graphics Quality Preset */}
            <div className="flex items-center gap-1 pt-0.5">
              <Sliders className="h-3 w-3 text-slate-400" aria-hidden="true" />
              {(['low', 'medium', 'high'] as GraphicsQuality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  aria-pressed={graphicsQuality === q}
                  onClick={() => setGraphicsQuality(q)}
                  className={`flex-1 border py-0.5 text-[9px] font-mono-tabular uppercase ${
                    graphicsQuality === q
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                      : 'border-[#253159] bg-[#0b1022] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {q === 'medium' ? 'Med' : q}
                </button>
              ))}
            </div>
          </div>
        </aside>
      ) : null}

      {/* Loading, Error, or Live City Scene */}
      {isLoading ? (
        <div className="relative z-10 flex h-full w-full items-center justify-center px-6">
          <div className="hud-panel flex flex-col items-center gap-3 px-8 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-300" aria-hidden="true" />
            <div>
              <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
                Initializing Deadlock City
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                Connecting to FastAPI orchestration layer and C++17 simulation engine…
              </p>
            </div>
          </div>
        </div>
      ) : !simState || (!backendConnected && errorMessage) ? (
        <div className="relative z-10 flex h-full w-full items-center justify-center px-6">
          <div className="hud-panel flex max-w-md flex-col items-center gap-3 border-rose-500/50 px-7 py-6 text-center">
            <ServerOff className="h-7 w-7 text-rose-400" aria-hidden="true" />
            <h1 className="font-display text-sm font-semibold tracking-wider text-rose-200 uppercase">
              Backend / Engine Disconnected
            </h1>
            <p className="text-xs text-slate-300">
              {errorMessage ?? 'No active simulation session. Ensure FastAPI and deadlock_engine are running.'}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void bootstrapSession()}
                className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400 bg-cyan-500/20 px-3.5 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/30"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry Connection
              </button>
              <button
                type="button"
                onClick={onOpenSessionDialog}
                className="min-h-8 border border-[#303f70] bg-[#121936] px-3 py-1.5 text-xs text-slate-200 hover:border-cyan-400"
              >
                Open Presets
              </button>
            </div>
          </div>
        </div>
      ) : showFallback ? (
        <CityFallback2D
          simState={simState}
          selectedEntity={selectedEntity}
          onSelect={setSelectedEntity}
          reason={contextLost ? 'WebGL Context Lost' : !webglSupported ? 'WebGL Unavailable' : undefined}
        />
      ) : (
        <WebGLErrorBoundary
          fallback={
            <CityFallback2D
              simState={simState}
              selectedEntity={selectedEntity}
              onSelect={setSelectedEntity}
              reason="WebGL Fallback"
            />
          }
        >
          <div className="relative h-full w-full">
            {errorMessage ? (
              <div
                role="alert"
                className="hud-panel pointer-events-auto absolute top-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border-amber-400/60 px-3.5 py-2 text-xs text-amber-200"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <Canvas
              shadows={qualityProfile.shadows}
              dpr={qualityProfile.dpr}
              camera={{ position: [21, 18.5, 24], fov: 42, near: 0.5, far: 140 }}
              onPointerMissed={() => setSelectedEntity(null)}
              onCreated={({ gl }) => setCanvasEl(gl.domElement)}
            >
              <color attach="background" args={['#14253b']} />
              <fog attach="fog" args={['#1a314c', 26, 68]} />

              {/* Restrained Twilight Lighting */}
              <hemisphereLight args={['#7fb3d5', '#0b1424', 0.85]} />
              <directionalLight
                position={[18, 28, 14]}
                intensity={1.35}
                color="#cfe8ff"
                castShadow={qualityProfile.shadows}
                shadow-mapSize-width={qualityProfile.shadowMapSize}
                shadow-mapSize-height={qualityProfile.shadowMapSize}
                shadow-camera-near={5}
                shadow-camera-far={75}
                shadow-camera-left={-22}
                shadow-camera-right={22}
                shadow-camera-top={22}
                shadow-camera-bottom={-22}
              />
              <directionalLight position={[-16, 10, -14]} intensity={0.45} color="#38bdf8" />

              <CityInfrastructure
                safetyStatus={simState.safety_status}
                blockCount={qualityProfile.backgroundBlockCount}
                receiveShadows={qualityProfile.shadows}
              />

              {/* Process Buildings */}
              {simState.processes.map((proc) => (
                <ProcessBuilding
                  key={proc.id}
                  process={proc}
                  isSelected={selectedEntity?.kind === 'process' && selectedEntity.id === proc.id}
                  isHovered={hoveredEntity?.kind === 'process' && hoveredEntity.id === proc.id}
                  isDeadlocked={deadlockedSet.has(proc.id)}
                  isCycleOnly={cycleOnlyNodes.has(proc.id)}
                  showLabel={qualityProfile.showRooftopLabels}
                  reducedMotion={prefersReducedMotion}
                  castShadows={qualityProfile.shadows}
                  onSelect={handleSelectProcess}
                  onFocus={handleFocusProcess}
                  onHover={handleHoverProcess}
                />
              ))}

              {/* Resource Facilities */}
              {simState.resources.map((res) => (
                <ResourceFacility
                  key={res.id}
                  resource={res}
                  isSelected={selectedEntity?.kind === 'resource' && selectedEntity.id === res.id}
                  isHovered={hoveredEntity?.kind === 'resource' && hoveredEntity.id === res.id}
                  isInvolvedInDeadlock={involvedResSet.has(res.id)}
                  showLabel={qualityProfile.showRooftopLabels}
                  reducedMotion={prefersReducedMotion}
                  castShadows={qualityProfile.shadows}
                  onSelect={handleSelectResource}
                  onFocus={handleFocusResource}
                  onHover={handleHoverResource}
                />
              ))}

              {/* Directed Allocation & Pending Request Conduits */}
              <ResourceConduits
                links={conduitLinks}
                animatePackets={qualityProfile.animatePackets}
                reducedMotion={prefersReducedMotion}
              />

              <CityCameraRig
                cameraCommand={cameraCommand}
                focusTarget={focusTarget}
                reducedMotion={prefersReducedMotion}
              />
            </Canvas>
          </div>
        </WebGLErrorBoundary>
      )}
    </main>
  )
}
