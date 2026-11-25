import React, { useEffect, useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ConduitLink } from './citySceneUtils'

interface ResourceConduitsProps {
  links: ConduitLink[]
  animatePackets: boolean
  reducedMotion: boolean
}

const ConduitPacket: React.FC<{
  geometry: THREE.SphereGeometry
  from: [number, number, number]
  to: [number, number, number]
  color: string
  phase: number
  speed: number
}> = ({ geometry, from, to, color, phase, speed }) => {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = (clock.getElapsedTime() * speed + phase) % 1
    const midY = Math.max(from[1], to[1]) + 0.9
    // Quadratic Bezier interpolation matching curved conduit arc
    const inv = 1 - t
    const midX = (from[0] + to[0]) * 0.5
    const midZ = (from[2] + to[2]) * 0.5
    const x = inv * inv * from[0] + 2 * inv * t * midX + t * t * to[0]
    const y = inv * inv * from[1] + 2 * inv * t * midY + t * t * to[1]
    const z = inv * inv * from[2] + 2 * inv * t * midZ + t * t * to[2]
    meshRef.current.position.set(x, y, z)
  })

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

export const ResourceConduits: React.FC<ResourceConduitsProps> = ({
  links,
  animatePackets,
  reducedMotion,
}) => {
  const sharedPacketGeometry = useMemo(() => new THREE.SphereGeometry(0.13, 8, 8), [])

  useEffect(() => {
    return () => {
      sharedPacketGeometry.dispose()
    }
  }, [sharedPacketGeometry])
  const curves = useMemo(() => {
    return links.map((link) => {
      const mid: [number, number, number] = [
        (link.from[0] + link.to[0]) * 0.5,
        Math.max(link.from[1], link.to[1]) + 0.9,
        (link.from[2] + link.to[2]) * 0.5,
      ]
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(...link.from),
        new THREE.Vector3(...mid),
        new THREE.Vector3(...link.to),
      )
      const points = curve.getPoints(18).map((v) => [v.x, v.y, v.z] as [number, number, number])
      return { link, points }
    })
  }, [links])

  return (
    <group name="resource-conduits">
      {curves.map(({ link, points }, idx) => {
        const color = link.isDeadlocked
          ? '#ef4444'
          : link.isCycleOnly
            ? '#f59e0b'
            : link.kind === 'allocation'
              ? '#00e5ff'
              : '#f59e0b'

        const isDashed = link.kind === 'request' || link.isCycleOnly
        const lineWidth = link.isDeadlocked ? 3.0 : link.kind === 'allocation' ? 2.0 : 1.7

        return (
          <group key={link.id}>
            <Line
              points={points}
              color={color}
              lineWidth={lineWidth}
              dashed={isDashed}
              dashSize={0.45}
              gapSize={0.28}
              transparent
              opacity={link.isDeadlocked ? 0.98 : 0.82}
            />
            {animatePackets && !reducedMotion ? (
              <ConduitPacket
                geometry={sharedPacketGeometry}
                from={link.from}
                to={link.to}
                color={color}
                phase={(idx * 0.27) % 1}
                speed={link.isDeadlocked ? 0.25 : 0.55}
              />
            ) : null}
          </group>
        )
      })}
    </group>
  )
}
