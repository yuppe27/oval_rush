import * as THREE from 'three';

export class SlipstreamSystem {
    constructor(scene = null) {
        this.currentStrength = 0;
        this.minDistance = 3;
        this.maxDistance = 15;
        this.maxAngleDeg = 10;
        this.maxAngleDot = Math.cos(THREE.MathUtils.degToRad(this.maxAngleDeg));
        this.rampUpSec = 1.5;
        this.rampDownSec = 0.45;
        this.bestVehicle = null;

        this.scene = scene;
        this.airLine = null;
        this._streamOffsets = [-1.15, -0.58, 0, 0.58, 1.15];
        this._linePos = new Float32Array(this._streamOffsets.length * 6);
        this._time = 0;
        if (this.scene) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(this._linePos, 3));
            const mat = new THREE.LineBasicMaterial({
                color: 0x7ce8ff,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.airLine = new THREE.LineSegments(geo, mat);
            this.airLine.frustumCulled = false;
            this.scene.add(this.airLine);
        }
    }

    update(dt, player, aiController, raceState) {
        this._time += dt;
        if (raceState !== 'racing' || !aiController?.vehicles?.length) {
            this.bestVehicle = null;
            this._approachStrength(0, dt);
            this._updateAirLine(player);
            player.setSlipstreamFactor(this.currentStrength);
            return this.currentStrength;
        }

        const playerForward = new THREE.Vector3(Math.sin(player.rotation), 0, Math.cos(player.rotation)).normalize();
        let bestDist = Infinity;
        this.bestVehicle = null;

        for (const ai of aiController.vehicles) {
            const toAI = ai.position.clone().sub(player.position);
            const distance = toAI.length();
            if (distance < this.minDistance || distance > this.maxDistance) continue;

            const toAIDir = toAI.clone().normalize();
            const forwardDot = playerForward.dot(toAIDir);
            if (forwardDot < this.maxAngleDot) continue;

            const aiForward = ai.forward?.clone().setY(0).normalize();
            if (aiForward && aiForward.lengthSq() > 1e-6) {
                // Ensure player is in the wake behind the front car.
                const wakeDir = aiForward.clone().multiplyScalar(-1);
                const wakeDot = wakeDir.dot(toAIDir.clone().multiplyScalar(-1));
                if (wakeDot < this.maxAngleDot) continue;
            }

            if (distance < bestDist) {
                bestDist = distance;
                this.bestVehicle = ai;
            }
        }

        const target = this.bestVehicle ? 1 : 0;
        this._approachStrength(target, dt);
        this._updateAirLine(player);
        player.setSlipstreamFactor(this.currentStrength);
        return this.currentStrength;
    }

    _approachStrength(target, dt) {
        if (target > this.currentStrength) {
            const rise = dt / this.rampUpSec;
            this.currentStrength = Math.min(target, this.currentStrength + rise);
        } else {
            const fall = dt / this.rampDownSec;
            this.currentStrength = Math.max(target, this.currentStrength - fall);
        }
        this.currentStrength = THREE.MathUtils.clamp(this.currentStrength, 0, 1);
    }

    _updateAirLine(player) {
        if (!this.airLine) return;
        if (!this.bestVehicle || this.currentStrength <= 0.01) {
            this.airLine.visible = false;
            this.airLine.material.opacity = 0;
            return;
        }

        this.airLine.visible = true;
        const playerSpeedN = THREE.MathUtils.clamp(player.getSpeedKmh() / 260, 0.2, 1.0);
        this.airLine.material.opacity = 0.12 + this.currentStrength * 0.38 + playerSpeedN * 0.05;
        this.airLine.material.color.setRGB(
            0.42 + this.currentStrength * 0.22,
            0.82 + this.currentStrength * 0.12,
            1.0
        );

        const ai = this.bestVehicle;
        const aiForward = ai.forward?.clone().setY(0).normalize() ?? new THREE.Vector3(
            Math.sin(player.rotation),
            0,
            Math.cos(player.rotation)
        );
        if (aiForward.lengthSq() < 1e-6) aiForward.set(0, 0, 1);
        const aiRight = new THREE.Vector3(-aiForward.z, 0, aiForward.x).normalize();
        const rear = ai.position.clone().addScaledVector(aiForward, -1.4).setY(ai.position.y + 0.55);
        const toPlayer = player.position.clone().sub(rear).setY(0);
        const lineDir = toPlayer.lengthSq() > 1e-6 ? toPlayer.normalize() : aiForward.clone().multiplyScalar(-1);
        const len = THREE.MathUtils.clamp(rear.distanceTo(player.position), this.minDistance, this.maxDistance);
        const swayAmp = 0.14 + this.currentStrength * 0.22;

        for (let i = 0; i < this._streamOffsets.length; i++) {
            const offset = this._streamOffsets[i];
            const phase = this._time * (7 + this.currentStrength * 4) + i * 0.9;
            const sway = Math.sin(phase) * swayAmp * (1 - Math.abs(offset) * 0.28);
            const yLift = Math.cos(phase * 0.85) * 0.05;
            const a = rear.clone()
                .addScaledVector(aiRight, offset + sway)
                .add(new THREE.Vector3(0, yLift, 0));
            const b = a.clone()
                .addScaledVector(lineDir, len * (0.84 + this.currentStrength * 0.12))
                .addScaledVector(aiRight, sway * 1.4);
            const idx = i * 6;
            this._linePos[idx] = a.x;
            this._linePos[idx + 1] = a.y;
            this._linePos[idx + 2] = a.z;
            this._linePos[idx + 3] = b.x;
            this._linePos[idx + 4] = b.y;
            this._linePos[idx + 5] = b.z;
        }
        this.airLine.geometry.attributes.position.needsUpdate = true;
    }

    reset(player = null) {
        this.currentStrength = 0;
        this.bestVehicle = null;
        this._time = 0;
        if (player) player.setSlipstreamFactor(0);
        if (this.airLine) {
            this.airLine.visible = false;
            this.airLine.material.opacity = 0;
        }
    }

    dispose() {
        if (this.airLine) {
            this.airLine.geometry.dispose();
            this.airLine.material.dispose();
            this.airLine.parent?.remove(this.airLine);
            this.airLine = null;
        }
    }
}
