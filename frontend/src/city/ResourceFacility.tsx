import React, { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ResourceEntity } from '../types/simulation'
import { getResourceColorScheme } from './citySceneUtils'

interface ResourceFacilityProps {
  resource: ResourceEntity
  isSelected: boolean
  isHovered: boolean
  isInvolvedInDeadlock: boolean
  showLabel: boolean
  reducedMotion: boolean
  castShadows: boolean
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onHover: (id: string | null) => void
}

export const ResourceFacility: React.FC<ResourceFacilityProps> = React.memo(
  ({
    resource,
    isSelected,
    isHovered,
    isInvolvedInDeadlock,
    showLabel,
    reducedMotion,
    castShadows,
    onSelect,
    onFocus,
    onHover,
  }) => {
    const rotorRef = useRef<THREE.Mesh>(null)
    const scheme = getResourceColorScheme(resource.status, isInvolvedInDeadlock)

    useFrame((_, delta) => {
      if (reducedMotion || !rotorRef.current) return
      rotorRef.current.rotation.y += delta * 0.75
    })

    const visibleSlots = Math.min(8, resource.total_instances)
    const filledAllocSlots = Math.round(
      (resource.allocated_instances / Math.max(1, resource.total_instances)) * visibleSlots,
    )

    const interactProps = {
      onClick: (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        onSelect(resource.id)
      },
      onDoubleClick: (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        onFocus(resource.id)
      },
      onPointerOver: (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
        onHover(resource.id)
      },
      onPointerOut: (e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        document.body.style.cursor = 'auto'
        onHover(null)
      },
    }

    return (
      <group
        position={[resource.city_position.x, 0, resource.city_position.z]}
        name={`resource-${resource.id}`}
      >
        {/* Heavy Industrial Facility Deck */}
        <mesh position={[0, 0.15, 0]} receiveShadow={castShadows} {...interactProps}>
          <cylinderGeometry args={[1.65, 1.85, 0.3, 8]} />
          <meshStandardMaterial color="#101b30" metalness={0.55} roughness={0.45} />
        </mesh>

        {/* Category-Specific Recognizable Facility Architecture */}
        {resource.category === 'COMPUTE' ? (
          <group {...interactProps}>
            <mesh position={[0, 0.95, 0]} castShadow={castShadows}>
              <cylinderGeometry args={[0.72, 0.95, 1.35, 8]} />
              <meshStandardMaterial
                color="#142642"
                emissive={scheme.emissive}
                emissiveIntensity={0.35}
                metalness={0.65}
                roughness={0.28}
              />
            </mesh>
            <mesh ref={rotorRef} position={[0, 1.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[1.05, 0.08, 10, 24]} />
              <meshStandardMaterial color={scheme.accent} emissive={scheme.accent} emissiveIntensity={0.75} />
            </mesh>
          </group>
        ) : resource.category === 'MEMORY' ? (
          <group {...interactProps}>
            {[-0.45, 0.45].map((xOff, idx) => (
              <mesh key={idx} position={[xOff, 0.95, 0]} castShadow={castShadows}>
                <boxGeometry args={[0.58, 1.35, 1.25]} />
                <meshStandardMaterial
                  color="#16233d"
                  emissive={scheme.emissive}
                  emissiveIntensity={0.3}
                  metalness={0.6}
                  roughness={0.32}
                />
              </mesh>
            ))}
            <mesh position={[0, 1.68, 0]}>
              <boxGeometry args={[1.5, 0.14, 0.8]} />
              <meshBasicMaterial color={scheme.accent} />
            </mesh>
          </group>
        ) : resource.category === 'STORAGE' ? (
          <group {...interactProps}>
            {[-0.62, 0, 0.62].map((xOff, idx) => (
              <mesh key={idx} position={[xOff, 0.85, 0]} castShadow={castShadows}>
                <cylinderGeometry args={[0.32, 0.34, 1.15, 12]} />
                <meshStandardMaterial
                  color="#18253f"
                  emissive={scheme.emissive}
                  emissiveIntensity={0.25}
                  metalness={0.5}
                  roughness={0.4}
                />
              </mesh>
            ))}
          </group>
        ) : resource.category === 'IO' ? (
          <group {...interactProps}>
            <mesh position={[0, 0.9, 0]} castShadow={castShadows}>
              <boxGeometry args={[0.85, 1.2, 0.85]} />
              <meshStandardMaterial color="#162440" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh ref={rotorRef} position={[0, 1.75, 0]} rotation={[0.45, 0, 0]}>
              <coneGeometry args={[0.78, 0.45, 12, 1, true]} />
              <meshStandardMaterial
                color={scheme.accent}
                emissive={scheme.emissive}
                emissiveIntensity={0.5}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ) : (
          /* LOCK: Hexagonal Vault Gate with Interlocking Barrier Ring */
          <group {...interactProps}>
            <mesh position={[0, 0.95, 0]} castShadow={castShadows}>
              <cylinderGeometry args={[0.75, 0.82, 1.3, 6]} />
              <meshStandardMaterial
                color="#201833"
                emissive={scheme.emissive}
                emissiveIntensity={0.38}
                metalness={0.7}
                roughness={0.28}
              />
            </mesh>
            <mesh ref={rotorRef} position={[0, 1.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[1.05, 0.09, 6, 6]} />
              <meshStandardMaterial color={scheme.accent} emissive={scheme.accent} emissiveIntensity={0.7} />
            </mesh>
          </group>
        )}

        {/* Capacity Instance Bars Around Facility Front */}
        <group position={[0, 0.36, 1.25]}>
          {Array.from({ length: visibleSlots }).map((_, idx) => {
            const x = (idx - (visibleSlots - 1) / 2) * 0.24
            const isAllocated = idx < filledAllocSlots
            return (
              <mesh key={idx} position={[x, 0.2, 0]}>
                <boxGeometry args={[0.14, 0.38, 0.14]} />
                <meshBasicMaterial
                  color={
                    isInvolvedInDeadlock
                      ? '#ef4444'
                      : isAllocated
                        ? '#22d3ee'
                        : '#10b981'
                  }
                />
              </mesh>
            )
          })}
        </group>

        {/* Selection Ring */}
        {isSelected || isInvolvedInDeadlock ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <ringGeometry args={[1.75, 1.98, 24]} />
            <meshBasicMaterial color={isSelected ? '#00e5ff' : '#ef4444'} />
          </mesh>
        ) : null}

        {/* Rooftop Facility Badge */}
        {showLabel && !isHovered ? (
          <Html position={[0, 2.35, 0]} center distanceFactor={24} zIndexRange={[5, 0]}>
            <div
              className={`pointer-events-none select-none border px-1.5 py-0.5 text-[10px] font-mono-tabular whitespace-nowrap shadow ${
                isInvolvedInDeadlock
                  ? 'border-rose-500 bg-rose-950/90 text-rose-200'
                  : isSelected
                    ? 'border-cyan-400 bg-[#0b1328]/95 text-cyan-200'
                    : 'border-emerald-500/45 bg-[#091521]/88 text-emerald-200'
              }`}
            >
              {resource.id} • {resource.available_instances}/{resource.total_instances}
            </div>
          </Html>
        ) : null}

        {/* Hover Tooltip */}
        {isHovered ? (
          <Html position={[0, 2.6, 0]} center distanceFactor={18} zIndexRange={[15, 0]}>
            <div className="pointer-events-none w-52 border border-emerald-400/75 bg-[#0a1124]/95 px-2.5 py-2 text-left text-[11px] shadow-2xl">
              <div className="font-display font-semibold text-emerald-300">
                {resource.id} • {resource.name}
              </div>
              <div className="mt-0.5 font-mono-tabular text-[10px] text-slate-200">
                {resource.category} • {resource.status}
              </div>
              <div className="font-mono-tabular text-[10px] text-slate-300">
                Avail: {resource.available_instances}/{resource.total_instances} • Alloc: {resource.allocated_instances}
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

ResourceFacility.displayName = 'ResourceFacility'
