import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SafetyStatus } from '../types/simulation'
import { getSafetyRingColor } from './citySceneUtils'

interface CityInfrastructureProps {
  safetyStatus: SafetyStatus
  blockCount: number
  receiveShadows: boolean
}

interface BlockSpec {
  x: number
  z: number
  w: number
  d: number
  h: number
}

function createUrbanBackdropBlocks(maxCount: number): BlockSpec[] {
  const blocks: BlockSpec[] = []
  // Deterministic perimeter industrial blocks outside the process & resource rings
  const ringCoords = [-22, -18, -14, -10, -6, 6, 10, 14, 18, 22]
  let idx = 0
  for (const x of ringCoords) {
    for (const z of ringCoords) {
      const dist = Math.hypot(x, z)
      // Exclude central process district and outer resource ring + camera approach clearance
      if (dist < 22.0 || dist > 32) continue
      if (blocks.length >= maxCount) break
      const pseudo = Math.abs(Math.sin(idx * 12.9898 + x * 4.1414 + z * 7.23))
      blocks.push({
        x: x + (pseudo - 0.5) * 0.9,
        z: z + (Math.cos(idx * 3.1) * 0.45),
        w: 1.6 + (pseudo % 0.6) * 2.2,
        d: 1.6 + ((pseudo * 1.7) % 0.6) * 2.2,
        h: 1.4 + pseudo * 5.2,
      })
      idx += 1
    }
    if (blocks.length >= maxCount) break
  }
  return blocks
}

export const CityInfrastructure: React.FC<CityInfrastructureProps> = ({
  safetyStatus,
  blockCount,
  receiveShadows,
}) => {
  const instancedRef = useRef<THREE.InstancedMesh>(null)
  const coreRingColor = getSafetyRingColor(safetyStatus)

  const blocks = useMemo(() => createUrbanBackdropBlocks(blockCount), [blockCount])

  const blockGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const blockMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#111d30',
        roughness: 0.85,
        metalness: 0.22,
      }),
    [],
  )

  useEffect(() => {
    return () => {
      blockGeometry.dispose()
      blockMaterial.dispose()
    }
  }, [blockGeometry, blockMaterial])

  useEffect(() => {
    const mesh = instancedRef.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    blocks.forEach((b, i) => {
      dummy.position.set(b.x, b.h * 0.5, b.z)
      dummy.scale.set(b.w, b.h, b.d)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [blocks])

  return (
    <group name="city-infrastructure">
      {/* Twilight Ground Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow={receiveShadows}>
        <planeGeometry args={[110, 110]} />
        <meshStandardMaterial color="#0b1525" roughness={0.95} metalness={0.1} />
      </mesh>

      {/* Orthogonal Urban Grid */}
      <gridHelper args={[64, 32, '#1e4263', '#132740']} position={[0, 0.01, 0]} />

      {/* Inner Process District Pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow={receiveShadows}>
        <ringGeometry args={[0.2, 10.6, 64]} />
        <meshStandardMaterial color="#0f1c31" roughness={0.9} metalness={0.2} />
      </mesh>

      {/* Process District Perimeter Conduit Track */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[10.5, 10.68, 64]} />
        <meshBasicMaterial color="#1d5f80" transparent opacity={0.65} />
      </mesh>

      {/* Resource Facility Ring Track */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[13.9, 14.1, 64]} />
        <meshBasicMaterial color="#164e63" transparent opacity={0.55} />
      </mesh>

      {/* Arterial Roads */}
      {[
        [0, 0.02, 0, 56, 0.65],
        [0, 0.02, 0, 0.65, 56],
      ].map(([x, y, z, w, d], idx) => (
        <mesh key={idx} position={[x!, y!, z!]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w!, d!]} />
          <meshStandardMaterial color="#0a1220" roughness={0.92} />
        </mesh>
      ))}

      {/* Central OS Resource Manager Core Hub */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[1.5, 1.8, 0.28, 8]} />
          <meshStandardMaterial color="#16223b" metalness={0.55} roughness={0.4} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.29, 0]}>
          <ringGeometry args={[1.05, 1.28, 32]} />
          <meshBasicMaterial color={coreRingColor} />
        </mesh>
      </group>

      {/* Instanced Twilight Background City Skyline */}
      {blocks.length > 0 ? (
        <instancedMesh
          ref={instancedRef}
          args={[blockGeometry, blockMaterial, blocks.length]}
          castShadow={false}
          receiveShadow={receiveShadows}
        />
      ) : null}
    </group>
  )
}
