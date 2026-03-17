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

        this._handleResize = () => this._onResize();
        window.addEventListener('resize', this._handleResize);
    }

    cycleMode() {
        const idx = this.modeOrder.indexOf(this.mode);
        const nextIdx = idx >= 0 ? (idx + 1) % this.modeOrder.length : 0;
        this.mode = this.modeOrder[nextIdx];
        this._initialized = false;
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

        // Keep a fixed camera distance to avoid the car appearing smaller at high speed.
        this._smoothPosition.copy(targetPos);
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

        // Camera overtakes the car and films from the front
        // Phase A (0..0.4): camera accelerates past the car (behind → ahead)
        // Phase B (0.4..1): settled in front, slightly off-center, looking back
        const a = THREE.MathUtils.smoothstep(p, 0, 0.4);
        const b = THREE.MathUtils.clamp((p - 0.4) / 0.6, 0, 1);

        // Forward direction of the car
        const fwdX = Math.sin(vRot);
        const fwdZ = Math.cos(vRot);
        // Right direction (perpendicular)
        const rightX = Math.cos(vRot);
        const rightZ = -Math.sin(vRot);

        // Longitudinal offset: start behind (-CHASE_DIST), overtake to ahead (+10)
        const alongDist = THREE.MathUtils.lerp(-CAMERA_CHASE_DISTANCE, 10, a);
        // Lateral offset: drift slightly to the right for a dynamic angle
        const lateralDist = THREE.MathUtils.lerp(0, 3.0, a);
        // Height: start at chase height, drop low for dramatic front shot
        const height = THREE.MathUtils.lerp(CAMERA_CHASE_HEIGHT, 1.6, a);

        const camPos = new THREE.Vector3(
            vPos.x + fwdX * alongDist + rightX * lateralDist,
            vPos.y + height,
            vPos.z + fwdZ * alongDist + rightZ * lateralDist
        );
        const lookAt = new THREE.Vector3(vPos.x, vPos.y + 0.7, vPos.z);

        // Directly place camera based on p — no dt-dependent lerp
        this._smoothPosition.copy(camPos);
        this._smoothLookAt.copy(lookAt);

        this.camera.position.copy(camPos);
        this.camera.lookAt(lookAt);

        // Narrow FOV once settled in front for telephoto close-up
        const targetFov = THREE.MathUtils.lerp(CAMERA_BASE_FOV + 5, 36, b);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, targetFov < this.camera.fov ? 1 : p);
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

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }

    dispose() {
        window.removeEventListener('resize', this._handleResize);
    }
}
