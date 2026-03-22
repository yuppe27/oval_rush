import * as THREE from 'three';
import {
    CAMERA_CHASE_DISTANCE,
    CAMERA_CHASE_HEIGHT,
    CAMERA_CHASE_LOOK_AHEAD,
    CAMERA_SMOOTHING,
    CAMERA_BASE_FOV,
    CAMERA_MAX_FOV_BOOST,
} from '../core/Constants.js';

export class CameraController {
    constructor() {
        this.camera = new THREE.PerspectiveCamera(
            CAMERA_BASE_FOV,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, CAMERA_CHASE_HEIGHT + 5, -CAMERA_CHASE_DISTANCE - 5);

        // Smoothed position and lookAt targets
        this._smoothPosition = new THREE.Vector3();
        this._smoothLookAt = new THREE.Vector3();
        this._lateralOffset = 0;
        this._initialized = false;
        this._prevRaceState = null;
        this.mode = 'chase'; // chase | bumper | overhead
        this.modeOrder = ['chase', 'bumper', 'overhead'];

        // Obstacle avoidance via raycasting (layer 1 = camera-occluding structures)
        this._occluders = [];
        this._raycaster = new THREE.Raycaster();
        this._raycaster.near = 0.5;
        this._raycaster.layers.set(1);
        this._rayDir = new THREE.Vector3();

        this.debugActive = false;
        this._debugTarget = new THREE.Vector3();
        this._debugPanForward = new THREE.Vector3();
        this._debugPanRight = new THREE.Vector3();
        this._debugOffset = new THREE.Vector3();
        this._debugYaw = 0;
        this._debugPitch = 0.35;
        this._debugDistance = 18;
        this._debugDragActive = false;
        this._debugPointerDelta = new THREE.Vector2();
        this._debugWheelDelta = 0;
        this._canvas = document.getElementById('gameCanvas');

        this._handleResize = () => this._onResize();
        this._handlePointerDown = (event) => this._onPointerDown(event);
        this._handlePointerMove = (event) => this._onPointerMove(event);
        this._handlePointerUp = () => this._onPointerUp();
        this._handleWheel = (event) => this._onWheel(event);
        window.addEventListener('resize', this._handleResize);
        window.addEventListener('pointerdown', this._handlePointerDown);
        window.addEventListener('pointermove', this._handlePointerMove);
        window.addEventListener('pointerup', this._handlePointerUp);
        window.addEventListener('wheel', this._handleWheel, { passive: false });
    }

    /**
     * Register meshes that can occlude the camera (tunnels, mountains, etc.).
     * These must have layers.enable(1) set.
     */
    setOccluders(meshes) {
        this._occluders = meshes;
    }

    cycleMode() {
        const idx = this.modeOrder.indexOf(this.mode);
        const nextIdx = idx >= 0 ? (idx + 1) % this.modeOrder.length : 0;
        this.mode = this.modeOrder[nextIdx];
        this._initialized = false;
    }

    resetToChase(vehicle) {
        this.mode = 'chase';
        this._snapToChase(vehicle);
    }

    snapToMode(vehicle, mode = this.mode) {
        this.mode = mode;
        const { targetPos, targetLookAt } = this._getModeTargets(vehicle, 0);
        this._smoothPosition.copy(targetPos);
        this._smoothLookAt.copy(targetLookAt);
        this._lateralOffset = 0;
        this._initialized = true;
        this.camera.position.copy(targetPos);
        this.camera.lookAt(targetLookAt);
        this.camera.fov = mode === 'bumper' ? 90 : (mode === 'overhead' ? 60 : CAMERA_BASE_FOV);
        this.camera.updateProjectionMatrix();
    }

    setDebugActive(active, options = {}) {
        this.debugActive = active;
        this._debugDragActive = false;
        this._debugPointerDelta.set(0, 0);
        this._debugWheelDelta = 0;

        if (!this._canvas) return;

        if (!active) {
            this._canvas.style.cursor = '';
            return;
        }

        const target = options.target || this._debugTarget;
        this._syncDebugOrbitFromCamera(target);
        this._debugTarget.copy(target);
        if (Number.isFinite(options.distance)) this._debugDistance = options.distance;
        if (Number.isFinite(options.yaw)) this._debugYaw = options.yaw;
        if (Number.isFinite(options.pitch)) this._debugPitch = options.pitch;
        this._debugPitch = THREE.MathUtils.clamp(this._debugPitch, -1.35, 1.35);
        this._debugDistance = THREE.MathUtils.clamp(this._debugDistance, 2.5, 480);
        this._canvas.style.cursor = 'grab';
    }

    updateDebug(dt, input) {
        const move = input?.getDebugCameraInput?.() || { forward: 0, right: 0, vertical: 0, fast: false };
        const panSpeed = move.fast ? 48 : 22;

        if (move.forward || move.right || move.vertical) {
            this._debugPanForward.copy(this._debugTarget).sub(this.camera.position);
            this._debugPanForward.y = 0;
            if (this._debugPanForward.lengthSq() < 1e-6) {
                this._debugPanForward.set(Math.sin(this._debugYaw), 0, Math.cos(this._debugYaw));
            }
            this._debugPanForward.normalize();
            this._debugPanRight.crossVectors(new THREE.Vector3(0, 1, 0), this._debugPanForward);
            this._debugPanRight.normalize();

            this._debugTarget.addScaledVector(this._debugPanForward, move.forward * panSpeed * dt);
            this._debugTarget.addScaledVector(this._debugPanRight, move.right * panSpeed * dt);
            this._debugTarget.y += move.vertical * panSpeed * dt;
        }

        if (this._debugPointerDelta.lengthSq() > 0) {
            this._debugYaw -= this._debugPointerDelta.x * 0.0055;
            this._debugPitch = THREE.MathUtils.clamp(
                this._debugPitch - this._debugPointerDelta.y * 0.0045,
                -1.35,
                1.35
            );
            this._debugPointerDelta.set(0, 0);
        }

        if (this._debugWheelDelta !== 0) {
            this._debugDistance = THREE.MathUtils.clamp(
                this._debugDistance * Math.exp(this._debugWheelDelta * 0.0011),
                2.5,
                480
            );
            this._debugWheelDelta = 0;
        }

        const horizontal = Math.cos(this._debugPitch) * this._debugDistance;
        this._debugOffset.set(
            Math.sin(this._debugYaw) * horizontal,
            Math.sin(this._debugPitch) * this._debugDistance,
            Math.cos(this._debugYaw) * horizontal
        );

        this.camera.position.copy(this._debugTarget).add(this._debugOffset);
        this.camera.lookAt(this._debugTarget);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 68, Math.min(1, dt * 8));
        this.camera.updateProjectionMatrix();
    }

    update(dt, vehicle, race = null) {
        const raceState = race?.state ?? null;
        const introToCountdown = this._prevRaceState === 'grid_intro' && raceState === 'countdown';
        if (introToCountdown) {
            this._snapToChase(vehicle);
        }

        if (race && raceState === 'grid_intro') {
            this._updateGridIntroCamera(dt, vehicle, race);
            this._prevRaceState = raceState;
            return;
        }

        if (race && raceState === 'finish_celebration') {
            this._updateFinishCelebrationCamera(dt, vehicle, race);
            this._prevRaceState = raceState;
            return;
        }

        if (race && raceState === 'finished') {
            this._updatePostFinishCruiseCamera(dt, vehicle);
            this._prevRaceState = raceState;
            return;
        }

        const vPos = vehicle.position;
        const vRot = vehicle.rotation;

        // Drift camera offset: shift camera to the outside of the drift
        // driftAngle is negated in PlayerVehicle (screen-correct), so negate here too
        let lateralOffset = 0;
        if (vehicle.isDrifting) {
            lateralOffset = vehicle.driftAngle * 2.8;
        }
        this._lateralOffset = THREE.MathUtils.lerp(this._lateralOffset, lateralOffset, dt * 4.5);

        const { targetPos, targetLookAt } = this._getModeTargets(vehicle, this._lateralOffset);

        // Obstacle avoidance: cast ray from car to ideal camera position.
        // If blocked, pull camera closer to car.
        const adjustedPos = this._avoidObstacles(vehicle.position, targetPos);

        this._smoothPosition.copy(adjustedPos);
        this._smoothLookAt.copy(targetLookAt);
        this._initialized = true;

        this.camera.position.copy(this._smoothPosition);
        this.camera.lookAt(this._smoothLookAt);

        const speedFov = THREE.MathUtils.clamp(
            (Math.abs(vehicle.speed) / Math.max(1e-3, vehicle.maxSpeed)) * CAMERA_MAX_FOV_BOOST,
            0,
            CAMERA_MAX_FOV_BOOST
        );
        const driftFov = vehicle.isDrifting ? Math.min(4, Math.abs(vehicle.driftAngle) * 6) : 0;
        const boostFov = vehicle.isBoosting ? 8 : 0;
        const slipFov = (vehicle.slipstreamFactor || 0) * 3;
        const modeBaseFov = this.mode === 'bumper' ? 90 : (this.mode === 'overhead' ? 60 : CAMERA_BASE_FOV);
        this.camera.fov = THREE.MathUtils.lerp(
            this.camera.fov,
            modeBaseFov + speedFov + driftFov + boostFov + slipFov,
            dt * 6
        );

        this.camera.updateProjectionMatrix();

        // Camera shake during boost
        if (vehicle.isBoosting) {
            const shakeIntensity = 0.05;
            this.camera.position.x += (Math.random() - 0.5) * shakeIntensity;
            this.camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        }

        this._prevRaceState = raceState;
    }

    _updateFinishCelebrationCamera(dt, vehicle, race) {
        const p = Math.min(1, Math.max(0, race.celebrationProgress ?? 0));
        const vPos = vehicle.position;
        const vRot = vehicle.rotation;

        // Front-zoom cinematic camera
        // Phase A (0..0.3): transition from chase to front position
        // Phase B (0.3..1): front tracking with slow orbit and zoom-in
        const a = THREE.MathUtils.smoothstep(p, 0, 0.3);
        const b = THREE.MathUtils.clamp((p - 0.3) / 0.7, 0, 1);

        // Forward direction of the car
        const fwdX = Math.sin(vRot);
        const fwdZ = Math.cos(vRot);
        // Right direction (perpendicular)
        const rightX = Math.cos(vRot);
        const rightZ = -Math.sin(vRot);

        // Phase A: move from behind to front
        // Start: chase position (behind the car)
        // End: front-right position (ahead of the car, slightly to the right, low angle)
        const frontDist = THREE.MathUtils.lerp(-CAMERA_CHASE_DISTANCE, 8, a);
        const lateralDist = THREE.MathUtils.lerp(0, 2.5, a);
        const height = THREE.MathUtils.lerp(CAMERA_CHASE_HEIGHT, 1.8, a);

        // Phase B: gentle orbit to add cinematic motion (subtle side-to-side)
        const orbitAngle = b * Math.PI * 0.15;
        const orbitLateral = lateralDist + Math.sin(orbitAngle) * 0.8;

        // Zoom-in: gradually reduce distance to the car
        const zoomFrontDist = THREE.MathUtils.lerp(frontDist, 5.0, b * 0.4);

        const camPos = new THREE.Vector3(
            vPos.x + fwdX * zoomFrontDist + rightX * orbitLateral,
            vPos.y + height,
            vPos.z + fwdZ * zoomFrontDist + rightZ * orbitLateral
        );
        // Look at slightly above center of the car for a heroic framing
        const lookAt = new THREE.Vector3(vPos.x, vPos.y + 0.6, vPos.z);

        this._smoothPosition.copy(camPos);
        this._smoothLookAt.copy(lookAt);

        this.camera.position.copy(camPos);
        this.camera.lookAt(lookAt);

        // FOV: start wide, then zoom in for telephoto close-up from front
        const targetFov = THREE.MathUtils.lerp(CAMERA_BASE_FOV + 5, 32, b);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 3 + p * 0.5));
        this.camera.updateProjectionMatrix();
    }

    /**
     * Post-finish cruise camera: front-diagonal overhead tracking shot.
     * Continues the cinematic feel from the celebration camera into the
     * cruising phase, keeping the player car framed from the front-right.
     */
    _updatePostFinishCruiseCamera(dt, vehicle) {
        const vPos = vehicle.position;
        const vRot = vehicle.rotation;

        // Forward / right directions of the car
        const fwdX = Math.sin(vRot);
        const fwdZ = Math.cos(vRot);
        const rightX = Math.cos(vRot);
        const rightZ = -Math.sin(vRot);

        // Camera placement: ahead + right + elevated
        const frontDist = 6.0;   // meters ahead of the car
        const lateralDist = 2.8; // meters to the right
        const height = 2.5;      // meters above the car

        const camPos = new THREE.Vector3(
            vPos.x + fwdX * frontDist + rightX * lateralDist,
            vPos.y + height,
            vPos.z + fwdZ * frontDist + rightZ * lateralDist
        );
        // Look at slightly above centre of the car for heroic framing
        const lookAt = new THREE.Vector3(vPos.x, vPos.y + 0.6, vPos.z);

        // Smooth transition (especially for the first frame after celebration)
        const lerpFactor = 1 - Math.exp(-4.0 * dt);
        this._smoothPosition.lerp(camPos, lerpFactor);
        this._smoothLookAt.lerp(lookAt, lerpFactor);

        this.camera.position.copy(this._smoothPosition);
        this.camera.lookAt(this._smoothLookAt);

        // Telephoto-ish FOV for a cinematic close-up feel
        const targetFov = 38;
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 3));
        this.camera.updateProjectionMatrix();
    }

    _updateGridIntroCamera(dt, vehicle, race) {
        const p = Math.min(1, Math.max(0, race.gridIntroProgress ?? 0));
        const { center, focus } = this._getGridTargets(vehicle, race);
        const vRot = vehicle.rotation;

        // Phase A (0..0.45): high orbit over full grid
        // Phase B (0.45..0.75): low sweep toward front rows
        // Phase C (0.75..1.0): blend into chase camera
        const a = Math.min(1, p / 0.45);
        const b = p > 0.45 ? Math.min(1, (p - 0.45) / 0.30) : 0;
        const c = p > 0.75 ? (p - 0.75) / 0.25 : 0;

        const orbitAngle = -Math.PI * 0.55 + a * Math.PI * 0.9;
        const radius = 30 - a * 8;
        const orbitPos = new THREE.Vector3(
            center.x + Math.cos(orbitAngle) * radius,
            center.y + 14 - a * 4,
            center.z + Math.sin(orbitAngle) * radius
        );
        const orbitLook = new THREE.Vector3(center.x, center.y + 1.2, center.z);

        const sweepPos = new THREE.Vector3(
            focus.x + Math.cos(0.3) * 12,
            focus.y + 6.5,
            focus.z - 10 + Math.sin(this._smoothPosition.x * 0.01) * 0.5
        );
        const sweepLook = new THREE.Vector3(focus.x, focus.y + 1.0, focus.z);
        const introPos = orbitPos.clone().lerp(sweepPos, b);
        const introLook = orbitLook.clone().lerp(sweepLook, b);

        const chasePos = new THREE.Vector3(
            vehicle.position.x - Math.sin(vRot) * (CAMERA_CHASE_DISTANCE + 1.2),
            vehicle.position.y + CAMERA_CHASE_HEIGHT + 0.4,
            vehicle.position.z - Math.cos(vRot) * (CAMERA_CHASE_DISTANCE + 1.2)
        );
        const chaseLook = new THREE.Vector3(
            vehicle.position.x + Math.sin(vRot) * CAMERA_CHASE_LOOK_AHEAD,
            vehicle.position.y + 0.8,
            vehicle.position.z + Math.cos(vRot) * CAMERA_CHASE_LOOK_AHEAD
        );

        const targetPos = introPos.clone().lerp(chasePos, c);
        const targetLook = introLook.clone().lerp(chaseLook, c);

        if (!this._initialized) {
            this._smoothPosition.copy(targetPos);
            this._smoothLookAt.copy(targetLook);
            this._initialized = true;
        } else {
            const lerpFactor = 1 - Math.exp(-CAMERA_SMOOTHING * dt * 0.8);
            this._smoothPosition.lerp(targetPos, lerpFactor);
            this._smoothLookAt.lerp(targetLook, lerpFactor);
        }

        this.camera.position.copy(this._smoothPosition);
        this.camera.lookAt(this._smoothLookAt);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, CAMERA_BASE_FOV + 4, dt * 2);
        this.camera.updateProjectionMatrix();
    }

    _getGridTargets(vehicle, race) {
        const points = [vehicle.position.clone()];
        if (race?.aiController?.vehicles?.length) {
            for (const ai of race.aiController.vehicles) {
                points.push(ai.position.clone());
            }
        }

        const center = new THREE.Vector3();
        for (const p of points) center.add(p);
        center.multiplyScalar(1 / points.length);

        // front-most by z in this course orientation is good enough for intro focus
        let focus = points[0];
        for (const p of points) {
            if (p.z > focus.z) focus = p;
        }
        return { center, focus };
    }

    _getChaseTargets(vehicle, lateralOffset = 0) {
        const vPos = vehicle.position;
        const vRot = vehicle.rotation;
        const dist = CAMERA_CHASE_DISTANCE;
        const height = CAMERA_CHASE_HEIGHT;
        const lookAhead = CAMERA_CHASE_LOOK_AHEAD;

        const targetPos = new THREE.Vector3(
            vPos.x - Math.sin(vRot) * dist + Math.cos(vRot) * lateralOffset,
            vPos.y + height,
            vPos.z - Math.cos(vRot) * dist - Math.sin(vRot) * lateralOffset
        );
        const targetLookAt = new THREE.Vector3(
            vPos.x + Math.sin(vRot) * lookAhead,
            vPos.y + 0.8,
            vPos.z + Math.cos(vRot) * lookAhead
        );

        return { targetPos, targetLookAt };
    }

    _getModeTargets(vehicle, lateralOffset = 0) {
        if (this.mode === 'bumper') {
            return this._getBumperTargets(vehicle);
        }
        if (this.mode === 'overhead') {
            return this._getOverheadTargets(vehicle);
        }
        return this._getChaseTargets(vehicle, lateralOffset);
    }

    _getBumperTargets(vehicle) {
        const vPos = vehicle.position;
        const vRot = vehicle.rotation;
        const base = new THREE.Vector3(
            vPos.x + Math.sin(vRot) * 1.2,
            vPos.y + 0.95,
            vPos.z + Math.cos(vRot) * 1.2
        );
        const lookAt = new THREE.Vector3(
            vPos.x + Math.sin(vRot) * 14,
            vPos.y + 1.0,
            vPos.z + Math.cos(vRot) * 14
        );
        return { targetPos: base, targetLookAt: lookAt };
    }

    _getOverheadTargets(vehicle) {
        const vPos = vehicle.position;
        const vRot = vehicle.rotation;
        const targetPos = new THREE.Vector3(
            vPos.x - Math.sin(vRot) * 1.5,
            vPos.y + 8.5,
            vPos.z - Math.cos(vRot) * 1.5
        );
        const targetLookAt = new THREE.Vector3(vPos.x, vPos.y + 0.4, vPos.z);
        return { targetPos, targetLookAt };
    }

    _snapToChase(vehicle) {
        const { targetPos, targetLookAt } = this._getChaseTargets(vehicle, 0);
        this._smoothPosition.copy(targetPos);
        this._smoothLookAt.copy(targetLookAt);
        this._lateralOffset = 0;
        this._initialized = true;
        this.camera.position.copy(targetPos);
        this.camera.lookAt(targetLookAt);
        this.camera.fov = CAMERA_BASE_FOV;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Cast a ray from the vehicle toward the ideal camera position.
     * If a registered occluder is hit, pull the camera closer to the car.
     */
    _avoidObstacles(vehiclePos, idealCamPos) {
        if (!this._occluders || this._occluders.length === 0) return idealCamPos;

        const origin = new THREE.Vector3(vehiclePos.x, vehiclePos.y + 1.2, vehiclePos.z);
        this._rayDir.subVectors(idealCamPos, origin);
        const fullDist = this._rayDir.length();
        if (fullDist < 0.1) return idealCamPos;
        this._rayDir.normalize();

        this._raycaster.set(origin, this._rayDir);
        this._raycaster.far = fullDist;

        const hits = this._raycaster.intersectObjects(this._occluders, false);
        if (hits.length > 0) {
            const safeDist = Math.max(1.5, hits[0].distance - 0.5);
            return origin.clone().addScaledVector(this._rayDir, safeDist);
        }
        return idealCamPos;
    }

    _syncDebugOrbitFromCamera(target) {
        this._debugOffset.copy(this.camera.position).sub(target);
        const distance = this._debugOffset.length();
        const horizontal = Math.hypot(this._debugOffset.x, this._debugOffset.z);
        this._debugDistance = Math.max(2.5, distance);
        this._debugYaw = Math.atan2(this._debugOffset.x, this._debugOffset.z);
        this._debugPitch = Math.atan2(this._debugOffset.y, Math.max(1e-3, horizontal));
    }

    _onPointerDown(event) {
        if (!this.debugActive || event.button !== 0) return;
        if (this._canvas && event.target !== this._canvas) return;
        this._debugDragActive = true;
        this._debugPointerDelta.set(0, 0);
        if (this._canvas) this._canvas.style.cursor = 'grabbing';
        event.preventDefault();
    }

    _onPointerMove(event) {
        if (!this.debugActive || !this._debugDragActive) return;
        this._debugPointerDelta.x += event.movementX || 0;
        this._debugPointerDelta.y += event.movementY || 0;
    }

    _onPointerUp() {
        if (!this.debugActive) return;
        this._debugDragActive = false;
        if (this._canvas) this._canvas.style.cursor = 'grab';
    }

    _onWheel(event) {
        if (!this.debugActive) return;
        if (this._canvas && event.target !== this._canvas) return;
        this._debugWheelDelta += event.deltaY;
        event.preventDefault();
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        window.removeEventListener('resize', this._handleResize);
        window.removeEventListener('pointerdown', this._handlePointerDown);
        window.removeEventListener('pointermove', this._handlePointerMove);
        window.removeEventListener('pointerup', this._handlePointerUp);
        window.removeEventListener('wheel', this._handleWheel, { passive: false });
        if (this._canvas) this._canvas.style.cursor = '';
    }
}
