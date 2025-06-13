import { useRef, useState, useEffect } from 'react'
import * as React from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

interface Keys {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

function useKeyboardControls() {
  const [keys, setKeys] = useState<Keys>({
    forward: false,
    backward: false,
    left: false,
    right: false
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
          setKeys(prev => ({ ...prev, forward: true }))
          break
        case 'ArrowDown':
          setKeys(prev => ({ ...prev, backward: true }))
          break
        case 'ArrowLeft':
          setKeys(prev => ({ ...prev, left: true }))
          break
        case 'ArrowRight':
          setKeys(prev => ({ ...prev, right: true }))
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
          setKeys(prev => ({ ...prev, forward: false }))
          break
        case 'ArrowDown':
          setKeys(prev => ({ ...prev, backward: false }))
          break
        case 'ArrowLeft':
          setKeys(prev => ({ ...prev, left: false }))
          break
        case 'ArrowRight':
          setKeys(prev => ({ ...prev, right: false }))
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return keys
}

function GoCart({ onPositionChange, trackPoints, isPlayer = true, aiStyle = 'normal', cartId, allCartPositions, onCartCollision, startPosition }: { 
  onPositionChange?: (position: THREE.Vector3, rotation: number) => void, 
  trackPoints: THREE.Vector3[],
  isPlayer?: boolean,
  aiStyle?: 'aggressive' | 'normal' | 'cautious',
  cartId: string,
  allCartPositions: Map<string, THREE.Vector3>,
  onCartCollision?: (cartId: string) => void,
  startPosition: THREE.Vector3
}) {
  const groupRef = useRef<THREE.Group>(null)
  const keys = useKeyboardControls()
  
  const [position, setPosition] = useState<THREE.Vector3>(startPosition.clone())
  const [rotation, setRotation] = useState<number>(Math.PI / 2)
  const [velocity, setVelocity] = useState<number>(0)
  const [angularVelocity, setAngularVelocity] = useState<number>(0)
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [, setPauseTimeLeft] = useState<number>(0)
  const [hitPoints, setHitPoints] = useState<number>(10)
  const [isStunned, setIsStunned] = useState<boolean>(false)
  const [, setStunTimeLeft] = useState<number>(0)
  
  const getTrackHeightAt = (x: number, z: number): number => {
    // Find the closest track point to get height
    let closestDistance = Infinity
    let closestHeight = 0
    
    for (const point of trackPoints) {
      const distance = Math.sqrt((point.x - x) ** 2 + (point.z - z) ** 2)
      if (distance < closestDistance) {
        closestDistance = distance
        closestHeight = point.y
      }
    }
    
    return closestHeight
  }
  
  const getTrackSlope = (x: number, z: number, direction: THREE.Vector3): { pitchX: number, pitchZ: number } => {
    const sampleDistance = 1.0
    
    // Normalize direction vector
    const normalizedDirection = direction.clone().normalize()
    
    // Sample points to the left and right (perpendicular to driving direction)
    const perpendicular = new THREE.Vector3(-normalizedDirection.z, 0, normalizedDirection.x)
    const leftX = x + perpendicular.x * sampleDistance
    const leftZ = z + perpendicular.z * sampleDistance
    const rightX = x - perpendicular.x * sampleDistance
    const rightZ = z - perpendicular.z * sampleDistance
    
    const leftHeight = getTrackHeightAt(leftX, leftZ)
    const rightHeight = getTrackHeightAt(rightX, rightZ)
    
    // Calculate roll (left/right tilt) - limit the angle
    const bankDiff = rightHeight - leftHeight
    const roll = Math.atan2(bankDiff, sampleDistance * 2)
    const clampedRoll = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, roll))
    
    // No pitch tilt - cart stays level in driving direction
    return { pitchX: 0, pitchZ: clampedRoll }
  }
  
  const isPositionValid = (x: number, z: number): boolean => {
    const cartRadius = 0.8
    const trackWidth = 12
    
    // Find the closest track centerline point
    let closestTrackPoint = trackPoints[0]
    let closestDistance = Infinity
    let closestIndex = 0
    
    for (let i = 0; i < trackPoints.length; i++) {
      const point = trackPoints[i]
      const distance = Math.sqrt((point.x - x) ** 2 + (point.z - z) ** 2)
      if (distance < closestDistance) {
        closestDistance = distance
        closestTrackPoint = point
        closestIndex = i
      }
    }
    
    // Get the direction and perpendicular for this track segment
    const nextIndex = (closestIndex + 1) % trackPoints.length
    const nextPoint = trackPoints[nextIndex]
    const direction = new THREE.Vector3().subVectors(nextPoint, closestTrackPoint).normalize()
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
    
    // Calculate the inner and outer boundaries at this point
    const innerPoint = closestTrackPoint.clone().add(perpendicular.clone().multiplyScalar(-trackWidth / 2))
    const outerPoint = closestTrackPoint.clone().add(perpendicular.clone().multiplyScalar(trackWidth / 2))
    
    // Check if the cart position is within the track boundaries
    const distanceFromCenter = Math.sqrt((closestTrackPoint.x - x) ** 2 + (closestTrackPoint.z - z) ** 2)
    const maxDistanceFromCenter = (trackWidth / 2) - cartRadius
    
    // Alternative check: ensure we're not too close to walls
    const distToInner = Math.sqrt((innerPoint.x - x) ** 2 + (innerPoint.z - z) ** 2)
    const distToOuter = Math.sqrt((outerPoint.x - x) ** 2 + (outerPoint.z - z) ** 2)
    
    return distanceFromCenter <= maxDistanceFromCenter && distToInner > cartRadius && distToOuter > cartRadius
  }
  
  const resetToTrackCenter = () => {
    // Find closest track point
    let closestTrackPoint = trackPoints[0]
    let closestDistance = Infinity
    let closestIndex = 0
    
    for (let i = 0; i < trackPoints.length; i++) {
      const point = trackPoints[i]
      const distance = Math.sqrt((point.x - position.x) ** 2 + (point.z - position.z) ** 2)
      if (distance < closestDistance) {
        closestDistance = distance
        closestTrackPoint = point
        closestIndex = i
      }
    }
    
    // Reset position to track center
    const trackHeight = getTrackHeightAt(closestTrackPoint.x, closestTrackPoint.z)
    const newPosition = new THREE.Vector3(closestTrackPoint.x, trackHeight + 0.5, closestTrackPoint.z)
    
    // Calculate proper rotation for track direction
    const nextIndex = (closestIndex + 1) % trackPoints.length
    const nextPoint = trackPoints[nextIndex]
    const newRotation = Math.atan2(
      nextPoint.x - closestTrackPoint.x,
      nextPoint.z - closestTrackPoint.z
    )
    
    setPosition(newPosition)
    setRotation(newRotation)
    setVelocity(0)
    setAngularVelocity(0)
    setCurrentTrackIndex(closestIndex)
    setIsPaused(true)
    setPauseTimeLeft(3.0)
  }
  
  const resetToStart = () => {
    // Reset to this cart's starting position
    const startRotation = Math.PI / 2
    
    setPosition(startPosition.clone())
    setRotation(startRotation)
    setVelocity(0)
    setAngularVelocity(0)
    setCurrentTrackIndex(0)
    setHitPoints(10)
    setIsPaused(false)
    setPauseTimeLeft(0)
    setIsStunned(false)
    setStunTimeLeft(0)
  }
  
  const takeDamage = () => {
    const newHitPoints = hitPoints - 1
    setHitPoints(newHitPoints)
    setIsStunned(true)
    setStunTimeLeft(0.1) // 100ms
    setVelocity(0)
    setAngularVelocity(0)
    
    if (newHitPoints <= 0) {
      resetToStart()
    }
  }
  
  const checkCartCollisions = (newPos: THREE.Vector3): boolean => {
    const collisionRadius = 1.5
    
    for (const [otherId, otherPos] of allCartPositions) {
      if (otherId !== cartId) {
        const distance = Math.sqrt(
          (newPos.x - otherPos.x) ** 2 + (newPos.z - otherPos.z) ** 2
        )
        
        if (distance < collisionRadius) {
          // Collision detected - notify the other cart
          if (onCartCollision) {
            onCartCollision(otherId)
          }
          return true
        }
      }
    }
    return false
  }
  
  const getAIControls = () => {
    if (isPlayer) return { forward: false, backward: false, left: false, right: false }
    
    // Find next target point on track
    const lookaheadDistance = aiStyle === 'aggressive' ? 8 : aiStyle === 'cautious' ? 12 : 10
    let targetPoint = trackPoints[currentTrackIndex]
    
    // Look ahead for smoother driving
    const distanceToTarget = Math.sqrt(
      (targetPoint.x - position.x) ** 2 + (targetPoint.z - position.z) ** 2
    )
    
    if (distanceToTarget < 3) {
      setCurrentTrackIndex((currentTrackIndex + 1) % trackPoints.length)
      targetPoint = trackPoints[(currentTrackIndex + Math.floor(lookaheadDistance / 3)) % trackPoints.length]
    } else {
      targetPoint = trackPoints[(currentTrackIndex + Math.floor(lookaheadDistance / 3)) % trackPoints.length]
    }
    
    // Calculate desired direction
    const targetDirection = Math.atan2(
      targetPoint.x - position.x,
      targetPoint.z - position.z
    )
    
    let angleDiff = targetDirection - rotation
    
    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
    
    // AI driving style parameters
    const speedTarget = aiStyle === 'aggressive' ? 0.35 : aiStyle === 'cautious' ? 0.25 : 0.3
    const turnThreshold = aiStyle === 'aggressive' ? 0.1 : aiStyle === 'cautious' ? 0.05 : 0.08
    
    // Decide controls
    const needsForward = velocity < speedTarget
    const needsLeft = angleDiff > turnThreshold
    const needsRight = angleDiff < -turnThreshold
    
    return {
      forward: needsForward,
      backward: false,
      left: needsLeft,
      right: needsRight
    }
  }
  
  useFrame((_state, delta) => {
    if (!groupRef.current) return
    
    // Handle pause countdown
    if (isPaused) {
      setPauseTimeLeft(prev => {
        const newTime = Math.max(0, prev - delta)
        if (newTime <= 0) {
          setIsPaused(false)
        }
        return newTime
      })
      
      // Don't process movement while paused
      if (groupRef.current) {
        groupRef.current.position.copy(position)
        groupRef.current.rotation.y = rotation
      }
      return
    }
    
    // Handle stun countdown
    if (isStunned) {
      setStunTimeLeft(prev => {
        const newTime = Math.max(0, prev - delta)
        if (newTime <= 0) {
          setIsStunned(false)
        }
        return newTime
      })
      
      // Don't process movement while stunned
      if (groupRef.current) {
        groupRef.current.position.copy(position)
        groupRef.current.rotation.y = rotation
      }
      return
    }
    
    // Physics constants
    const maxSpeed = 0.4
    const acceleration = 0.8
    const deceleration = 1.2
    const friction = 0.96
    const maxTurnSpeed = 0.08
    const turnAcceleration = 0.15
    const turnFriction = 0.9
    
    let newVelocity = velocity
    let newAngularVelocity = angularVelocity
    let newRotation = rotation
    let newPosition = position.clone()
    
    // Get controls (either from player input or AI)
    const controls = isPlayer ? keys : getAIControls()
    
    // Handle acceleration/deceleration
    if (controls.forward) {
      newVelocity = Math.min(maxSpeed, newVelocity + acceleration * delta)
    } else if (controls.backward) {
      newVelocity = Math.max(-maxSpeed * 0.6, newVelocity - deceleration * delta)
    } else {
      // Natural deceleration when no input
      if (newVelocity > 0) {
        newVelocity = Math.max(0, newVelocity - deceleration * delta)
      } else {
        newVelocity = Math.min(0, newVelocity + deceleration * delta)
      }
    }
    
    // Apply friction
    newVelocity *= friction
    
    // Handle turning with speed-dependent responsiveness
    const speedFactor = Math.abs(newVelocity) / maxSpeed
    const effectiveTurnSpeed = maxTurnSpeed * speedFactor
    
    if (controls.left) {
      newAngularVelocity = Math.min(effectiveTurnSpeed, newAngularVelocity + turnAcceleration * delta)
    } else if (controls.right) {
      newAngularVelocity = Math.max(-effectiveTurnSpeed, newAngularVelocity - turnAcceleration * delta)
    } else {
      // Turn friction
      newAngularVelocity *= turnFriction
    }
    
    // Apply rotational velocity
    newRotation += newAngularVelocity
    
    // Calculate movement based on velocity
    let tentativePosition = newPosition.clone()
    tentativePosition.x += Math.sin(newRotation) * newVelocity
    tentativePosition.z += Math.cos(newRotation) * newVelocity
    
    // Check wall collision
    if (!isPositionValid(tentativePosition.x, tentativePosition.z)) {
      // Wall collision - reset to track center
      resetToTrackCenter()
      return
    }
    
    // Check cart collision
    if (checkCartCollisions(tentativePosition)) {
      // Don't move if we would hit another cart
      tentativePosition = newPosition
    }
    
    newPosition = tentativePosition
    
    // Adjust height to follow track elevation
    const trackHeight = getTrackHeightAt(newPosition.x, newPosition.z)
    newPosition.y = trackHeight + 0.5
    
    // Calculate track slope and adjust cart orientation
    const forwardDirection = new THREE.Vector3(
      Math.sin(newRotation),
      0,
      Math.cos(newRotation)
    )
    
    const slope = getTrackSlope(newPosition.x, newPosition.z, forwardDirection)
    
    setPosition(newPosition)
    setRotation(newRotation)
    setVelocity(newVelocity)
    setAngularVelocity(newAngularVelocity)
    
    groupRef.current.position.copy(newPosition)
    groupRef.current.rotation.set(slope.pitchX, newRotation, slope.pitchZ)
    
    if (onPositionChange) {
      onPositionChange(newPosition, newRotation)
    }
    
    // Update cart position in global map
    allCartPositions.set(cartId, newPosition)
  })

  const cartColor = isPlayer ? "#ff4444" : (aiStyle === 'aggressive' ? "#ff8800" : "#0088ff")
  const cartOpacity = isPaused ? 0.5 : isStunned ? 0.7 : 1.0
  
  // Expose takeDamage function for collision handling
  React.useEffect(() => {
    // Register this cart's takeDamage function for collision handling
    const cartRef = { takeDamage }
    // Note: In a real implementation, you'd register this with a collision system
    console.log('Cart registered:', cartId, cartRef)
  }, [cartId, onCartCollision, takeDamage])
  
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.2, 0.4, 2]} />
        <meshStandardMaterial color={cartColor} transparent opacity={cartOpacity} />
      </mesh>
      
      {/* Health indicator */}
      <mesh position={[0, 1.2, 0]}>
        <planeGeometry args={[1, 0.2]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[-0.4 + (hitPoints / 10) * 0.4, 1.21, 0]}>
        <planeGeometry args={[hitPoints / 10 * 0.8, 0.15]} />
        <meshBasicMaterial color={hitPoints > 5 ? "#00ff00" : hitPoints > 2 ? "#ffff00" : "#ff0000"} />
      </mesh>
      
      {isPaused && (
        <mesh position={[0, 1.5, 0]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color="#ffff00" />
        </mesh>
      )}
      
      {isStunned && (
        <mesh position={[0, 1.5, 0]}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#ff0000" />
        </mesh>
      )}
      
      <mesh position={[-0.5, 0.1, 0.8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh position={[0.5, 0.1, 0.8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh position={[-0.5, 0.1, -0.8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh position={[0.5, 0.1, -0.8]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      
      <mesh position={[0, 0.6, -0.3]}>
        <boxGeometry args={[0.8, 0.4, 0.6]} />
        <meshStandardMaterial color="#4444ff" />
      </mesh>
    </group>
  )
}

function Track({ onCartPositionChange }: { onCartPositionChange?: (position: THREE.Vector3, rotation: number) => void }) {
  const trackRef = useRef<THREE.Group>(null)
  const [allCartPositions] = useState<Map<string, THREE.Vector3>>(new Map())
  const cartRefs = useRef<Map<string, any>>(new Map())
  
  const handleCartCollision = (targetCartId: string) => {
    const targetCart = cartRefs.current.get(targetCartId)
    if (targetCart && targetCart.takeDamage) {
      targetCart.takeDamage()
    }
  }

  const createTrackPath = () => {
    const radiusX = 45
    const radiusZ = 30
    const points: [number, number, number][] = []
    const numPoints = 32
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2
      const x = Math.cos(angle) * radiusX
      const z = Math.sin(angle) * radiusZ
      
      // Add elevation variation using sine waves
      const heightVariation1 = Math.sin(angle * 2) * 2
      const heightVariation2 = Math.cos(angle * 3) * 1.5
      const heightVariation3 = Math.sin(angle * 5) * 0.8
      const totalHeight = Math.max(0, heightVariation1 + heightVariation2 + heightVariation3)
      
      points.push([x, totalHeight, z])
    }
    
    return points
  }

  const trackPoints = createTrackPath().map(point => new THREE.Vector3(point[0], point[1], point[2]))

  const createTrackGeometry = () => {
    const trackWidth = 12
    const innerPoints: THREE.Vector3[] = []
    const outerPoints: THREE.Vector3[] = []

    trackPoints.forEach((point, index) => {
      const nextIndex = (index + 1) % trackPoints.length
      const direction = new THREE.Vector3()
        .subVectors(trackPoints[nextIndex], point)
        .normalize()
      
      const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
      
      const innerPoint = point.clone().add(perpendicular.clone().multiplyScalar(-trackWidth / 2))
      const outerPoint = point.clone().add(perpendicular.clone().multiplyScalar(trackWidth / 2))
      
      innerPoints.push(innerPoint)
      outerPoints.push(outerPoint)
    })

    return { innerPoints, outerPoints }
  }

  const { innerPoints, outerPoints } = createTrackGeometry()

  const getStartLinePosition = () => {
    const startPoint = trackPoints[0]
    const nextPoint = trackPoints[1]
    const direction = new THREE.Vector3().subVectors(nextPoint, startPoint).normalize()
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
    return { point: startPoint, perpendicular }
  }

  const { point: startPoint, perpendicular: startLinePerpendicular } = getStartLinePosition()


  return (
    <group ref={trackRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
        <planeGeometry args={[150, 100]} />
        <meshStandardMaterial color="#2d5a2d" />
      </mesh>

      <mesh position={[0, 0.01, 0]}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array((() => {
              const vertices: number[] = []
              const trackWidth = 12
              
              // Calculate all inner and outer edge points
              const innerPoints: THREE.Vector3[] = []
              const outerPoints: THREE.Vector3[] = []
              
              for (let i = 0; i < trackPoints.length; i++) {
                const current = trackPoints[i]
                const next = trackPoints[(i + 1) % trackPoints.length]
                const direction = new THREE.Vector3().subVectors(next, current).normalize()
                const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
                
                innerPoints.push(current.clone().add(perpendicular.clone().multiplyScalar(-trackWidth / 2)))
                outerPoints.push(current.clone().add(perpendicular.clone().multiplyScalar(trackWidth / 2)))
              }
              
              // Add all vertices first (inner loop, then outer loop)
              for (let i = 0; i < trackPoints.length; i++) {
                vertices.push(innerPoints[i].x, innerPoints[i].y, innerPoints[i].z)
              }
              for (let i = 0; i < trackPoints.length; i++) {
                vertices.push(outerPoints[i].x, outerPoints[i].y, outerPoints[i].z)
              }
              
              // Create triangles using indices for a proper strip
              const triangleVertices: number[] = []
              for (let i = 0; i < trackPoints.length; i++) {
                const nextIndex = (i + 1) % trackPoints.length
                const innerIndex = i
                const outerIndex = i + trackPoints.length
                const innerNextIndex = nextIndex
                const outerNextIndex = nextIndex + trackPoints.length
                
                // Triangle 1: inner[i], outer[i], inner[i+1]
                triangleVertices.push(
                  vertices[innerIndex * 3], vertices[innerIndex * 3 + 1], vertices[innerIndex * 3 + 2],
                  vertices[outerIndex * 3], vertices[outerIndex * 3 + 1], vertices[outerIndex * 3 + 2],
                  vertices[innerNextIndex * 3], vertices[innerNextIndex * 3 + 1], vertices[innerNextIndex * 3 + 2]
                )
                
                // Triangle 2: outer[i], outer[i+1], inner[i+1]
                triangleVertices.push(
                  vertices[outerIndex * 3], vertices[outerIndex * 3 + 1], vertices[outerIndex * 3 + 2],
                  vertices[outerNextIndex * 3], vertices[outerNextIndex * 3 + 1], vertices[outerNextIndex * 3 + 2],
                  vertices[innerNextIndex * 3], vertices[innerNextIndex * 3 + 1], vertices[innerNextIndex * 3 + 2]
                )
              }
              
              return new Float32Array(triangleVertices)
            })()), 3]}
          />
          <bufferAttribute
            attach="attributes-normal"
            args={[new Float32Array((() => {
              const normals: number[] = []
              
              for (let i = 0; i < trackPoints.length * 6; i++) {
                normals.push(0, 1, 0)
              }
              
              return normals
            })()), 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[new Float32Array((() => {
              const colors: number[] = []
              
              for (let i = 0; i < trackPoints.length; i++) {
                const t = i / trackPoints.length
                const hue = t * Math.PI * 4
                const isBlue = Math.sin(hue) > 0
                
                for (let j = 0; j < 6; j++) {
                  if (isBlue) {
                    colors.push(0, 0, 1)
                  } else {
                    colors.push(1, 1, 0)
                  }
                }
              }
              
              return colors
            })()), 3]}
          />
        </bufferGeometry>
      </mesh>

      <mesh>
        <meshStandardMaterial color="#ff0000" side={THREE.DoubleSide} />
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array((() => {
              const wallVertices: number[] = []
              const wallHeight = 2
              
              for (let i = 0; i < outerPoints.length; i++) {
                const current = outerPoints[i]
                const next = outerPoints[(i + 1) % outerPoints.length]
                
                wallVertices.push(
                  current.x, current.y, current.z,
                  next.x, next.y, next.z,
                  current.x, current.y + wallHeight, current.z,
                  
                  next.x, next.y, next.z,
                  next.x, next.y + wallHeight, next.z,
                  current.x, current.y + wallHeight, current.z
                )
              }
              
              return wallVertices
            })()), 3]}
          />
          <bufferAttribute
            attach="attributes-normal"
            args={[new Float32Array((() => {
              const normals: number[] = []
              
              for (let i = 0; i < outerPoints.length; i++) {
                const current = outerPoints[i]
                const next = outerPoints[(i + 1) % outerPoints.length]
                const direction = new THREE.Vector3().subVectors(next, current).normalize()
                const normal = new THREE.Vector3(-direction.z, 0, direction.x)
                
                for (let j = 0; j < 6; j++) {
                  normals.push(normal.x, normal.y, normal.z)
                }
              }
              
              return normals
            })()), 3]}
          />
        </bufferGeometry>
      </mesh>

      <mesh>
        <meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} />
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array((() => {
              const wallVertices: number[] = []
              const wallHeight = 2
              
              for (let i = 0; i < innerPoints.length; i++) {
                const current = innerPoints[i]
                const next = innerPoints[(i + 1) % innerPoints.length]
                
                wallVertices.push(
                  current.x, current.y, current.z,
                  current.x, current.y + wallHeight, current.z,
                  next.x, next.y, next.z,
                  
                  next.x, next.y, next.z,
                  current.x, current.y + wallHeight, current.z,
                  next.x, next.y + wallHeight, next.z
                )
              }
              
              return wallVertices
            })()), 3]}
          />
          <bufferAttribute
            attach="attributes-normal"
            args={[new Float32Array((() => {
              const normals: number[] = []
              
              for (let i = 0; i < innerPoints.length; i++) {
                const current = innerPoints[i]
                const next = innerPoints[(i + 1) % innerPoints.length]
                const direction = new THREE.Vector3().subVectors(next, current).normalize()
                const normal = new THREE.Vector3(direction.z, 0, -direction.x)
                
                for (let j = 0; j < 6; j++) {
                  normals.push(normal.x, normal.y, normal.z)
                }
              }
              
              return normals
            })()), 3]}
          />
        </bufferGeometry>
      </mesh>

      <mesh position={[
        startPoint.x + startLinePerpendicular.x * 1.5,
        0.1,
        startPoint.z + startLinePerpendicular.z * 1.5
      ]}>
        <boxGeometry args={[12, 0.1, 0.6]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      <mesh position={[
        startPoint.x + startLinePerpendicular.x * -1.5,
        0.1,
        startPoint.z + startLinePerpendicular.z * -1.5
      ]}>
        <boxGeometry args={[12, 0.1, 0.6]} />
        <meshStandardMaterial color="#000000" />
      </mesh>

      <GoCart 
        onPositionChange={onCartPositionChange} 
        trackPoints={trackPoints} 
        isPlayer={true}
        cartId="player"
        allCartPositions={allCartPositions}
        onCartCollision={handleCartCollision}
        startPosition={new THREE.Vector3(45, 1.0, 0)}
      />
      
      <GoCart 
        trackPoints={trackPoints} 
        isPlayer={false}
        aiStyle="aggressive"
        cartId="ai1"
        allCartPositions={allCartPositions}
        onCartCollision={handleCartCollision}
        startPosition={new THREE.Vector3(45, 1.0, -4.95)}
      />
      
      <GoCart 
        trackPoints={trackPoints} 
        isPlayer={false}
        aiStyle="cautious"
        cartId="ai2"
        allCartPositions={allCartPositions}
        onCartCollision={handleCartCollision}
        startPosition={new THREE.Vector3(45, 1.0, 4.95)}
      />
    </group>
  )
}

function CameraController({ cartPosition, cartRotation }: { cartPosition: THREE.Vector3, cartRotation: number }) {
  const { camera } = useThree()
  
  useFrame(() => {
    const cameraDistance = 8
    const cameraHeight = 4
    
    const cameraX = cartPosition.x - Math.sin(cartRotation) * cameraDistance
    const cameraZ = cartPosition.z - Math.cos(cartRotation) * cameraDistance
    
    camera.position.set(cameraX, cartPosition.y + cameraHeight, cameraZ)
    camera.lookAt(cartPosition.x, cartPosition.y, cartPosition.z)
  })
  
  return null
}

export default function RaceTrack() {
  const [cartPosition, setCartPosition] = useState<THREE.Vector3>(new THREE.Vector3(45, 1.0, 0))
  const [cartRotation, setCartRotation] = useState<number>(Math.PI / 2)
  
  const handleCartPositionChange = (position: THREE.Vector3, rotation: number) => {
    setCartPosition(position)
    setCartRotation(rotation)
  }

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <Canvas
        camera={{
          position: [0, 20, 20],
          fov: 60,
        }}
        style={{ width: '100%', height: '100%', background: '#87CEEB' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Track onCartPositionChange={handleCartPositionChange} />
        <CameraController cartPosition={cartPosition} cartRotation={cartRotation} />
        <Text
          position={[0, 8, 0]}
          fontSize={2}
          color="white"
          anchorX="center"
          anchorY="middle"
        >
          Go-Kart Race Track
        </Text>
      </Canvas>
    </div>
  )
}