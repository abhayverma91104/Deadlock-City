import React, { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CameraCommand } from '../stores/useSimulationStore'

interface CityCameraRigProps {
  cameraCommand: CameraCommand
  focusTarget: [number, number, number] | null
  reducedMotion: boolean
}

const DEFAULT_ISO_POS = new THREE.Vector3(21, 18.5, 24)
const DEFAULT_ISO_TARGET = new THREE.Vector3(0, 0.5, 1.2)
const TOP_POS = new THREE.Vector3(0.01, 32, 0.01)

export const CityCameraRig: React.FC<CityCameraRigProps> = ({
  cameraCommand,
  focusTarget,
  reducedMotion,
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()
  const desiredPos = useRef<THREE.Vector3 | null>(null)
  const desiredTarget = useRef<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (cameraCommand.nonce === 0) return
    if (cameraCommand.type === 'isometric') {
      desiredTarget.current = DEFAULT_ISO_TARGET.clone()
      desiredPos.current = DEFAULT_ISO_POS.clone()
    } else if (cameraCommand.type === 'top') {
      desiredTarget.current = new THREE.Vector3(0, 0, 0)
      desiredPos.current = TOP_POS.clone()
    } else if (cameraCommand.type === 'focus' && focusTarget) {
      desiredTarget.current = new THREE.Vector3(focusTarget[0], 1.1, focusTarget[2])
      desiredPos.current = new THREE.Vector3(focusTarget[0] + 6.0, 10.5, focusTarget[2] + 7.2)
    }
  }, [cameraCommand, focusTarget])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls) return

    // Clamp pan target inside city bounds
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -18, 18)
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -18, 18)
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 6)

    if (desiredPos.current && desiredTarget.current) {
      if (reducedMotion) {
        camera.position.copy(desiredPos.current)
        controls.target.copy(desiredTarget.current)
        desiredPos.current = null
        desiredTarget.current = null
      } else {
        const lambda = 6
        camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPos.current.x, lambda, delta)
        camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredPos.current.y, lambda, delta)
        camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPos.current.z, lambda, delta)
        controls.target.x = THREE.MathUtils.damp(controls.target.x, desiredTarget.current.x, lambda, delta)
        controls.target.y = THREE.MathUtils.damp(controls.target.y, desiredTarget.current.y, lambda, delta)
        controls.target.z = THREE.MathUtils.damp(controls.target.z, desiredTarget.current.z, lambda, delta)

        if (
          camera.position.distanceTo(desiredPos.current) < 0.08 &&
          controls.target.distanceTo(desiredTarget.current) < 0.08
        ) {
          desiredPos.current = null
          desiredTarget.current = null
        }
      }
      controls.update()
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={46}
      minPolarAngle={0.18}
      maxPolarAngle={Math.PI / 2 - 0.08}
      onStart={() => {
        // Yield immediately when user manually drags/zooms
        desiredPos.current = null
        desiredTarget.current = null
      }}
    />
  )
}
