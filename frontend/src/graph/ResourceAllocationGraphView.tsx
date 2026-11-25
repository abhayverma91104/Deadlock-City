import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangle, GitFork, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type {
  RagGraphEdge,
  RagGraphPayload,
  RagProcessNodeData,
  RagResourceNodeData,
} from '../types/simulation'
import { ProcessStateBadge, ResourceStatusBadge } from '../components/ui/StatusBadge'

type GraphMode = 'rag' | 'wfg'
type FlowProcessNode = Node<RagProcessNodeData & Record<string, unknown>, 'process'>
type FlowResourceNode = Node<RagResourceNodeData & Record<string, unknown>, 'resource'>
type FlowEdgeData = Record<string, unknown> & { ragEdge?: RagGraphEdge }

const ProcessFlowNode: React.FC<NodeProps<FlowProcessNode>> = ({
  data,
  selected,
}) => {
  const borderClass = data.is_deadlocked
    ? 'border-rose-500 bg-rose-950/85 shadow-[0_0_16px_rgba(239,68,68,0.35)]'
    : selected
      ? 'border-cyan-400 bg-[#0f1b38]/95 shadow-[0_0_14px_rgba(34,211,238,0.3)]'
      : data.in_cycle
        ? 'border-amber-400 bg-[#1a182b]/95'
        : 'border-[#2f4073] bg-[#0e152b]/95'

  const allocEntries = Object.entries(data.allocated).filter(([, qty]) => qty > 0)
  const reqEntries = Object.entries(data.pending_request).filter(([, qty]) => qty > 0)

  return (
    <div className={`min-w-[168px] border-2 px-3 py-2 text-xs text-slate-100 ${borderClass}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-cyan-400" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-tabular font-bold text-cyan-300">{data.id}</span>
        <ProcessStateBadge state={data.state} />
      </div>
      <div className="mt-0.5 truncate font-display text-xs font-semibold text-slate-100">
        {data.name}
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono-tabular text-[10px]">
        <div className="text-slate-300">
          Alloc:{' '}
          {allocEntries.length > 0
            ? allocEntries.map(([r, q]) => `${r}×${q}`).join(', ')
            : 'None'}
        </div>
        <div className={reqEntries.length > 0 ? 'text-amber-300' : 'text-slate-500'}>
          Req:{' '}
          {reqEntries.length > 0 ? reqEntries.map(([r, q]) => `${r}×${q}`).join(', ') : 'None'}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-amber-400" />
    </div>
  )
}

const ResourceFlowNode: React.FC<NodeProps<FlowResourceNode>> = ({
  data,
  selected,
}) => {
  const borderClass = data.is_involved_in_deadlock
    ? 'border-rose-500 bg-rose-950/85'
    : selected
      ? 'border-cyan-400 bg-[#0f1f38]/95'
      : data.in_cycle
        ? 'border-amber-400 bg-[#1c1a2a]/95'
        : 'border-emerald-500/60 bg-[#0c1a29]/95'

  const dots = Math.min(8, data.total_instances)
  const allocDots = Math.round(
    (data.allocated_instances / Math.max(1, data.total_instances)) * dots,
  )

  return (
    <div className={`min-w-[172px] border-2 px-3 py-2 text-xs text-slate-100 ${borderClass}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-amber-400" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-tabular font-bold text-emerald-300">{data.id}</span>
        <ResourceStatusBadge status={data.status} />
      </div>
      <div className="mt-0.5 truncate font-display text-xs font-semibold text-slate-100">
        {data.name}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-mono-tabular text-slate-300">
        <span>{data.category}</span>
        <span>
          {data.available_instances}/{data.total_instances} Avail
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1" aria-label="Resource instance slots">
        {Array.from({ length: dots }).map((_, idx) => (
          <span
            key={idx}
            className={`h-2 w-2 border ${
              idx < allocDots
                ? 'border-cyan-300 bg-cyan-400'
                : 'border-emerald-400 bg-emerald-400/30'
            }`}
          />
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-cyan-400" />
    </div>
  )
}

const NODE_TYPES = {
  process: ProcessFlowNode,
  resource: ResourceFlowNode,
}

export const ResourceAllocationGraphView: React.FC = () => {
  const sessionId = useSimulationStore((s) => s.sessionId)
  const latestSeq = useSimulationStore((s) => s.latestSeq)
  const simState = useSimulationStore((s) => s.simState)
  const selectedEntity = useSimulationStore((s) => s.selectedEntity)
  const setSelectedEntity = useSimulationStore((s) => s.setSelectedEntity)

  const [graphMode, setGraphMode] = useState<GraphMode>('rag')
  const [graphData, setGraphData] = useState<RagGraphPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<RagGraphEdge | null>(null)
  const [layoutSeed, setLayoutSeed] = useState(0)

  const loadGraph = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setFetchError(null)
    try {
      const resp = await apiClient.getGraph(sessionId)
      setGraphData(resp.graph)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load graph.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph, latestSeq])

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!graphData) return { flowNodes: [] as Node[], flowEdges: [] as Edge[] }

    if (graphMode === 'wfg') {
      const procNodes = graphData.nodes.filter((n) => n.type === 'process')
      const radius = Math.max(150, procNodes.length * 32)
      const nodes: Node[] = procNodes.map((n, idx) => {
        const angle = (idx / Math.max(1, procNodes.length)) * Math.PI * 2 - Math.PI / 2
        return {
          id: n.id,
          type: 'process',
          position: {
            x: 280 + Math.cos(angle) * radius + (layoutSeed % 2) * 0.01,
            y: 220 + Math.sin(angle) * radius,
          },
          selected: selectedEntity?.kind === 'process' && selectedEntity.id === n.id,
          data: { ...(n.data as RagProcessNodeData) },
        }
      })

      const edges: Edge[] = graphData.wait_for_edges.map((w, idx) => {
        const isDead =
          graphData.deadlock_detected &&
          graphData.deadlocked_processes.includes(w.from) &&
          graphData.deadlocked_processes.includes(w.to)
        const stroke = isDead ? '#ef4444' : graphData.has_cycle ? '#f59e0b' : '#94a3b8'
        return {
          id: `wfg_${w.from}_${w.to}_${w.resource_id}_${idx}`,
          source: w.from,
          target: w.to,
          label: `waits ${w.resource_id}`,
          animated: isDead,
          style: { stroke, strokeWidth: isDead ? 2.5 : 1.8 },
          labelStyle: { fill: '#e2e8f0', fontSize: 10, fontFamily: 'JetBrains Mono' },
          labelBgStyle: { fill: '#0b1022', fillOpacity: 0.9 },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        }
      })
      return { flowNodes: nodes, flowEdges: edges }
    }

    const procNodes = graphData.nodes.filter((n) => n.type === 'process')
    const resNodes = graphData.nodes.filter((n) => n.type === 'resource')

    const nodes: Node[] = [
      ...procNodes.map((n, idx) => ({
        id: n.id,
        type: 'process',
        position: { x: 80, y: 40 + idx * 135 + (layoutSeed % 2) * 0.01 },
        selected: selectedEntity?.kind === 'process' && selectedEntity.id === n.id,
        data: { ...(n.data as RagProcessNodeData) },
      })),
      ...resNodes.map((n, idx) => ({
        id: n.id,
        type: 'resource',
        position: { x: 470, y: 55 + idx * 145 + (layoutSeed % 2) * 0.01 },
        selected: selectedEntity?.kind === 'resource' && selectedEntity.id === n.id,
        data: { ...(n.data as RagResourceNodeData) },
      })),
    ]

    const edges: Edge<FlowEdgeData>[] = graphData.edges.map((e) => {
      const cycleWithoutDeadlock = e.in_cycle && !graphData.deadlock_detected
      const stroke = e.is_deadlocked
        ? '#ef4444'
        : cycleWithoutDeadlock
          ? '#f59e0b'
          : e.kind === 'allocation'
            ? '#22d3ee'
            : '#f59e0b'
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.is_deadlocked || e.kind === 'request',
        style: {
          stroke,
          strokeWidth: e.is_deadlocked ? 2.8 : cycleWithoutDeadlock ? 2.4 : 1.8,
          strokeDasharray: e.kind === 'request' ? '6 4' : undefined,
        },
        labelStyle: { fill: '#e2e8f0', fontSize: 10, fontFamily: 'JetBrains Mono' },
        labelBgStyle: { fill: '#0b1022', fillOpacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        data: { ragEdge: e },
      }
    })

    return { flowNodes: nodes, flowEdges: edges }
  }, [graphData, graphMode, selectedEntity, layoutSeed])

  return (
    <section
      aria-label="Resource Allocation Graph Workspace"
      className="hud-panel flex h-full w-full flex-col overflow-hidden"
    >
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#253057] bg-[#101730]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <GitFork className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          <div>
            <h1 className="font-display text-sm font-semibold tracking-wider text-slate-100 uppercase">
              Resource Allocation &amp; Wait-For Graph
            </h1>
            <p className="text-[11px] text-slate-400">
              Synchronized with C++ engine state (Tick {simState?.tick ?? 0})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* RAG vs WFG Tablist */}
          <div
            role="tablist"
            aria-label="Graph representation mode"
            className="flex border border-[#2a3866] bg-[#0a0f20] p-0.5 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={graphMode === 'rag'}
              onClick={() => setGraphMode('rag')}
              className={`border-b-2 px-3 py-1 font-medium transition-colors ${
                graphMode === 'rag'
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              RAG View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={graphMode === 'wfg'}
              onClick={() => setGraphMode('wfg')}
              className={`border-b-2 px-3 py-1 font-medium transition-colors ${
                graphMode === 'wfg'
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Wait-For Graph
            </button>
          </div>

          <button
            type="button"
            onClick={() => setLayoutSeed((s) => s + 1)}
            className="inline-flex min-h-8 items-center gap-1.5 border border-[#2b3968] bg-[#111834] px-2.5 text-xs text-slate-200 hover:border-cyan-400"
          >
            Auto Layout
          </button>

          <button
            type="button"
            onClick={() => void loadGraph()}
            disabled={loading}
            className="inline-flex min-h-8 items-center gap-1.5 border border-cyan-400/60 bg-cyan-500/15 px-2.5 text-xs text-cyan-200 hover:bg-cyan-500/25"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Sync
          </button>
        </div>
      </div>

      {/* Authoritative Cycle vs Deadlock Banner */}
      {graphData ? (
        <div
          className={`flex items-center justify-between border-b px-4 py-1.5 text-xs ${
            graphData.deadlock_detected
              ? 'border-rose-500/40 bg-rose-950/40 text-rose-200'
              : graphData.has_cycle
                ? 'border-amber-500/40 bg-amber-950/35 text-amber-200'
                : 'border-[#202a4d] bg-[#0a0f21] text-slate-300'
          }`}
        >
          <span className="flex items-center gap-2">
            {graphData.deadlock_detected ? (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
            ) : graphData.has_cycle ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            )}
            {graphData.deadlock_detected
              ? `Confirmed C++ Deadlock: ${graphData.deadlocked_processes.join(', ')}`
              : graphData.has_cycle
                ? 'Multi-Instance Cycle Present — NOT a Deadlock (extra instances allow completion)'
                : 'No cycles or deadlocks detected in current Resource Allocation Graph.'}
          </span>
          <span className="font-mono-tabular text-[11px] text-slate-400">
            {graphData.nodes.length} Nodes • {graphData.edges.length} Edges
          </span>
        </div>
      ) : null}

      {/* Main Graph Canvas + Right Legend / Edge Inspector */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative h-full flex-1 bg-[#080d1c]">
          {fetchError ? (
            <div className="flex h-full items-center justify-center p-6 text-xs text-rose-300">
              {fetchError}
            </div>
          ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              fitView
              onNodeClick={(_ev, node) => {
                setSelectedEdge(null)
                if (node.type === 'process') {
                  setSelectedEntity({ kind: 'process', id: node.id })
                } else {
                  setSelectedEntity({ kind: 'resource', id: node.id })
                }
              }}
              onEdgeClick={(_ev, edge) => {
                const ragEdge = (edge.data as FlowEdgeData | undefined)?.ragEdge
                if (ragEdge) setSelectedEdge(ragEdge)
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#1d2b4f" gap={24} />
              <Controls className="!border-[#28335c] !bg-[#0c1224] [&>button]:!border-[#253057] [&>button]:!bg-[#0e152b] [&>button]:!fill-slate-200 [&>button]:!text-slate-200 [&>button:hover]:!bg-cyan-500/20" />
              <MiniMap
                nodeColor={(n) => (n.type === 'process' ? '#22d3ee' : '#10b981')}
                nodeStrokeColor="#94a3b8"
                maskColor="rgba(8, 12, 24, 0.75)"
                style={{ backgroundColor: '#0c1224', border: '1px solid #28335c' }}
              />
            </ReactFlow>
          )}
        </div>

        {/* Right Side Legend & Edge Inspector */}
        <aside className="hidden xl:flex w-64 flex-col gap-3 border-l border-[#253057] bg-[#0b1022]/90 p-3 text-xs overflow-y-auto">
          <div>
            <h2 className="font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
              Graph Legend
            </h2>
            <ul className="mt-2 space-y-1.5 text-[11px] text-slate-300">
              <li className="flex items-center gap-2">
                <span className="h-0.5 w-6 bg-cyan-400" />
                <span>Allocation (Resource → Process)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-0.5 w-6 border-t-2 border-dashed border-amber-400" />
                <span>Pending Request (Process → Resource)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-6 bg-amber-400" />
                <span>Cycle (Multi-Instance, Safe)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-6 bg-rose-500" />
                <span>Confirmed Deadlock</span>
              </li>
            </ul>
          </div>

          <div className="border-t border-[#222d52] pt-3">
            <h2 className="font-display text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
              Edge / Cycle Inspector
            </h2>
            {selectedEdge ? (
              <div className="mt-2 space-y-1 border border-[#243056] bg-[#0f162e] p-2.5 font-mono-tabular text-[11px]">
                <div className="font-semibold text-slate-100">
                  {selectedEdge.source} → {selectedEdge.target}
                </div>
                <div className="text-slate-300">Type: {selectedEdge.kind.toUpperCase()}</div>
                <div className="text-slate-300">Units: {selectedEdge.units}</div>
                <div className={selectedEdge.is_deadlocked ? 'text-rose-300' : 'text-slate-400'}>
                  Deadlock Member: {selectedEdge.is_deadlocked ? 'YES' : 'NO'}
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Click any node to inspect in the Left Rail, or click an edge to inspect flow details.
              </p>
            )}
          </div>

          {graphData && graphData.cycles.length > 0 ? (
            <div className="border-t border-[#222d52] pt-3">
              <h2 className="font-display text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
                Detected Cycles ({graphData.cycles.length})
              </h2>
              <ul className="mt-1.5 space-y-1 font-mono-tabular text-[10px] text-slate-300">
                {graphData.cycles.map((c, idx) => (
                  <li key={idx} className="border border-[#263259] bg-[#0e152b] px-2 py-1">
                    {c.join(' → ')} → {c[0]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
