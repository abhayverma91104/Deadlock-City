import React, { Suspense, lazy, useEffect, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { CityCanvasViewport } from './city/CityCanvasViewport'
import { ToastViewport } from './components/ui/ToastViewport'
import { BottomCommandDock } from './dashboard/BottomCommandDock'
import { CreateSessionDialog } from './dashboard/CreateSessionDialog'
import { LeftInspectorRail } from './dashboard/LeftInspectorRail'
import { RadialControlCore } from './dashboard/RadialControlCore'
import { TopTelemetryBar } from './dashboard/TopTelemetryBar'
import { useSimulationStore } from './stores/useSimulationStore'

const ResourceAllocationGraphView = lazy(() =>
  import('./graph/ResourceAllocationGraphView').then((m) => ({
    default: m.ResourceAllocationGraphView,
  })),
)
const DeadlockDetectionLab = lazy(() =>
  import('./simulation/DeadlockDetectionLab').then((m) => ({
    default: m.DeadlockDetectionLab,
  })),
)
const BankersAlgorithmLab = lazy(() =>
  import('./simulation/BankersAlgorithmLab').then((m) => ({
    default: m.BankersAlgorithmLab,
  })),
)
const RecoveryCenter = lazy(() =>
  import('./simulation/RecoveryCenter').then((m) => ({
    default: m.RecoveryCenter,
  })),
)
const ProcessResourceManager = lazy(() =>
  import('./simulation/ProcessResourceManager').then((m) => ({
    default: m.ProcessResourceManager,
  })),
)
const CpuSchedulingLab = lazy(() =>
  import('./simulation/CpuSchedulingLab').then((m) => ({
    default: m.CpuSchedulingLab,
  })),
)
const SyncLabView = lazy(() =>
  import('./simulation/SyncLabView').then((m) => ({
    default: m.SyncLabView,
  })),
)
const AnalyticsCommandCenter = lazy(() =>
  import('./analytics/AnalyticsCommandCenter').then((m) => ({
    default: m.AnalyticsCommandCenter,
  })),
)

export const App: React.FC = () => {
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const activeTab = useSimulationStore((s) => s.activeTab)
  const bootstrapSession = useSimulationStore((s) => s.bootstrapSession)
  const disconnectWs = useSimulationStore((s) => s.disconnectWs)

  useEffect(() => {
    void bootstrapSession()
    return () => {
      disconnectWs()
    }
  }, [bootstrapSession, disconnectWs])

  const showWorkspaceOverlay = activeTab !== 'city'

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-screen w-screen overflow-hidden bg-[#080c18] text-slate-100">
        <TopTelemetryBar
          onOpenSessionDialog={() => setSessionDialogOpen(true)}
          showQueue={!showWorkspaceOverlay}
        />
        <ToastViewport />

        {/* Persistent 3D City Base Canvas */}
        <div aria-hidden={showWorkspaceOverlay} className="h-full w-full">
          <CityCanvasViewport onOpenSessionDialog={() => setSessionDialogOpen(true)} />
        </div>

        {/* Active Module Workspace Overlay */}
        {showWorkspaceOverlay ? (
          <div className="pointer-events-auto fixed inset-x-3 top-28 bottom-24 z-[25] lg:left-[276px] lg:right-4">
            <Suspense
              fallback={
                <div className="hud-panel flex h-full w-full items-center justify-center gap-2 text-xs text-cyan-300">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading module…
                </div>
              }
            >
              {activeTab === 'graph' ? <ResourceAllocationGraphView /> : null}
              {activeTab === 'detection' ? <DeadlockDetectionLab /> : null}
              {activeTab === 'banker' ? <BankersAlgorithmLab /> : null}
              {activeTab === 'recovery' ? <RecoveryCenter /> : null}
              {activeTab === 'processes' ? <ProcessResourceManager /> : null}
              {activeTab === 'scheduling' ? <CpuSchedulingLab /> : null}
              {activeTab === 'sync' ? <SyncLabView /> : null}
              {activeTab === 'analytics' ? <AnalyticsCommandCenter /> : null}
            </Suspense>
          </div>
        ) : null}

        <LeftInspectorRail />
        {!showWorkspaceOverlay ? <RadialControlCore /> : null}
        <BottomCommandDock onOpenSessionDialog={() => setSessionDialogOpen(true)} />
        <CreateSessionDialog
          open={sessionDialogOpen}
          onClose={() => setSessionDialogOpen(false)}
        />
      </div>
    </MotionConfig>
  )
}

export default App
