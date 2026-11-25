import React, { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ProcessEntity } from '../types/simulation'
import { computeBuildingHeight, getProcessColorScheme } from './citySceneUtils'

interface ProcessBuildingProps {
  process: ProcessEntity
  isSelected: boolean
  isHovered: boolean
  isDeadlocked: boolean
  isCycleOnly: boolean
  showLabel: boolean
  reducedMotion: boolean
  castShadows: boolean
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onHover: (id: string | null) => void
}

export const ProcessBuilding: React.FC<ProcessBuildingProps> = React.memo(
  ({
    process,
    isSelected,
    isHovered,
    isDeadlocked,
    isCycleOnly,
    showLabel,
    reducedMotion,
    castShadows,
    onSelect,
    onFocus,
    onHover,
  }) => {
    const beaconRef = useRef<THREE.Mesh>(null)
    const ringRef = useRef<THREE.Mesh>(null)
    const scheme = getProcessColorScheme(process.state, isDeadlocked)
    const height = computeBuildingHeight(process.burst_time, process.state)
    const isTerminated = process.state === 'TERMINATED'
    const isBlueprint = process.state === 'NEW'

    const totalAlloc = Object.values(process.allocated).reduce((a, b) => a + b, 0)
    const totalPending = Object.values(process.pending_request).reduce((a, b) => a + b, 0)

    useFrame((_, delta) => {
      if (reducedMotion) return
      if (beaconRef.current) {
        if (process.state === 'RUNNING') {
          beaconRef.current.rotation.y += delta * 1.6
        } else if (isDeadlocked || process.state === 'BLOCKED') {
          beaconRef.current.rotation.y += delta * 2.4
        }
      }
      if (ringRef.current && (isDeadlocked || process.state === 'WAITING' || process.state === 'BLOCKED')) {
        const s = 1 + Math.sin(performance.now() * 0.004) * 0.08
        ringRef.current.scale.set(s, s, 1)
      }
    })

    return (
      <group
        position={[process.city_position.x, 0, process.city_position.z]}
        name={`process-${process.id}`}
      >
        {/* Base Foundation Plinth */}
        <mesh
          position={[0, 0.14, 0]}
          receiveShadow={castShadows}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(process.id)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onFocus(process.id)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'pointer'
            onHover(process.id)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'auto'
            onHover(null)
          }}
        >
          <boxGeometry args={[2.15, 0.28, 2.15]} />
          <meshStandardMaterial color="#0e1629" metalness={0.5} roughness={0.5} />
        </mesh>

        {/* Main Tapered Faceted Tower Hull (inspired by reference central towers) */}
        <mesh
          position={[0, 0.28 + height * 0.5, 0]}
          castShadow={castShadows}
          receiveShadow={castShadows}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(process.id)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onFocus(process.id)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'pointer'
            onHover(process.id)
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'auto'
            onHover(null)
          }}
        >
          <cylinderGeometry args={[0.66, 0.94, height, 6]} />
          <meshStandardMaterial
            color={scheme.body}
            emissive={isTerminated ? '#000000' : scheme.emissive}
            emissiveIntensity={
              isTerminated ? 0 : isDeadlocked ? 0.52 : process.state === 'RUNNING' ? 0.42 : 0.18
            }
            metalness={0.58}
            roughness={0.36}
            transparent={isBlueprint}
            opacity={isBlueprint ? 0.58 : 1}
            wireframe={isBlueprint}
          />
        </mesh>

        {/* Architectural Upper Crown / Tier */}
        {!isTerminated ? (
          <mesh position={[0, 0.28 + height + 0.24, 0]} castShadow={castShadows}>
            <cylinderGeometry args={[0.38, 0.58, 0.48, 6]} />
            <meshStandardMaterial
              color="#192642"
              emissive={scheme.primary}
              emissiveIntensity={0.45}
              metalness={0.65}
              roughness={0.3}
            />
          </mesh>
        ) : null}

        {/* Vertical Edge Accent Ribs */}
        {!isTerminated ? (
          <mesh position={[0, 0.28 + height * 0.5, 0]}>
            <cylinderGeometry args={[0.68, 0.96, height * 0.96, 6]} />
            <meshBasicMaterial color={scheme.primary} wireframe transparent opacity={isSelected ? 0.65 : 0.24} />
          </mesh>
        ) : null}

        {/* State-Specific Structural / Geometric Beacon Above Roof (beyond color) */}
        {process.state === 'RUNNING' && !isDeadlocked ? (
          <mesh ref={beaconRef} position={[0, height + 1.05, 0]}>
            <octahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial color="#00e5ff" emissive="#00e5ff" emissiveIntensity={0.9} />
          </mesh>
        ) : null}

        {(isDeadlocked || process.state === 'BLOCKED') ? (
          <group position={[0, height + 1.1, 0]}>
            <mesh ref={beaconRef}>
              <octahedronGeometry args={[0.32, 0]} />
              <meshStandardMaterial
                color={isDeadlocked ? '#ef4444' : '#fb7185'}
                emissive={isDeadlocked ? '#ef4444' : '#e11d48'}
                emissiveIntensity={1.0}
              />
            </mesh>
            {isDeadlocked ? (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.55, 0.04, 8, 24]} />
                <meshBasicMaterial color="#ef4444" />
              </mesh>
            ) : null}
          </group>
        ) : null}

        {process.state === 'WAITING' && !isDeadlocked ? (
          <mesh position={[0, height + 1.0, 0]}>
            <coneGeometry args={[0.24, 0.45, 4]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
          </mesh>
        ) : null}

        {/* Cycle-Only Amber Warning Halo (when multi-instance RAG has cycle without deadlock) */}
        {isCycleOnly ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <ringGeometry args={[1.3, 1.48, 32]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.85} />
          </mesh>
        ) : null}

        {/* Ground Status / Alert Ring */}
        {(isSelected || isDeadlocked || process.state === 'BLOCKED' || process.state === 'WAITING') ? (
          <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <ringGeometry args={[1.18, 1.36, 32]} />
            <meshBasicMaterial
              color={isSelected ? '#00e5ff' : scheme.primary}
              transparent
              opacity={isSelected ? 0.95 : 0.8}
            />
          </mesh>
        ) : null}

        {/* Holographic Cyan Selection Shell (matches reference cyan building) */}
        {isSelected ? (
          <mesh position={[0, 0.28 + height * 0.5, 0]}>
            <cylinderGeometry args={[0.84, 1.12, height + 0.35, 6]} />
            <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.55} />
          </mesh>
        ) : null}

        {/* Rooftop Label Badge */}
        {showLabel && !isHovered ? (
          <Html position={[0, height + 1.55, 0]} center distanceFactor={22} zIndexRange={[5, 0]}>
            <div
              className={`pointer-events-none select-none border px-1.5 py-0.5 text-[10px] font-mono-tabular whitespace-nowrap shadow ${
                isDeadlocked
                  ? 'border-rose-500 bg-rose-950/90 text-rose-200'
                  : isSelected
                    ? 'border-cyan-400 bg-[#0b1328]/95 text-cyan-200'
                    : isTerminated
                      ? 'border-slate-700 bg-slate-900/80 text-slate-400'
                      : 'border-[#2b3968] bg-[#0b1022]/85 text-slate-200'
              }`}
            >
              {process.id} • {scheme.badge}
            </div>
          </Html>
        ) : null}

        {/* Reference-Style Floating Hover Tooltip */}
        {isHovered ? (
          <Html position={[0, height + 1.85, 0]} center distanceFactor={18} zIndexRange={[15, 0]}>
            <div className="pointer-events-none w-52 border border-cyan-400/75 bg-[#0a1124]/95 px-2.5 py-2 text-left text-[11px] shadow-2xl">
              <div className="font-display font-semibold text-cyan-300">
                {process.id} • {process.name}
              </div>
              <div className="mt-0.5 font-mono-tabular text-[10px] text-slate-200">
                State: {scheme.badge} • Burst {process.remaining_time}/{process.burst_time}
              </div>
              <div className="font-mono-tabular text-[10px] text-slate-300">
                Held: {totalAlloc} units • Pending: {totalPending}
              </div>
              <div className="mt-1 text-[9px] text-slate-400">
                Click to inspect • Double-click to focus
              </div>
            </div>
          </Html>
        ) : null}
      </group>
    )
  },
)

ProcessBuilding.displayName = 'ProcessBuilding'
