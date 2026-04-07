import * as THREE from 'three';

class TireSmokeSystem {
    constructor(scene, maxParticles = 420) {
        this.maxParticles = maxParticles;
        this.positions = new Float32Array(maxParticles * 3);
        this.colors = new Float32Array(maxParticles * 3);
        this.baseColors = new Float32Array(maxParticles * 3);
        this.velocities = Array.from({ length: maxParticles }, () => new THREE.Vector3());
        this.life = new Float32Array(maxParticles);
        this.maxLife = new Float32Array(maxParticles);
        this.cursor = 0;
        this._spawnCarry = 0;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.62,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            vertexColors: true,
        });

        this.points = new THREE.Points(geo, mat);
        this.points.frustumCulled = false;
        scene.add(this.points);
        this.geometry = geo;
    }

    emit(anchor, config = {}) {
        const idx = this.cursor;
        this.cursor = (this.cursor + 1) % this.maxParticles;
        const intensity = config.intensity ?? 1;
        const spread = config.spread ?? 0.2;
        const height = config.height ?? 0.05;
        const life = config.life ?? (0.85 + Math.random() * 0.4);
        const lateral = config.lateral ?? 0.8;
        const vertical = config.vertical ?? 0.9;
        const verticalJitter = config.verticalJitter ?? 0.8;
        const velocityScale = config.velocityScale ?? (0.75 + intensity * 0.65);
        const color = config.color ?? [0.38, 0.38, 0.38];

        const i3 = idx * 3;
        this.positions[i3] = anchor.x + (Math.random() - 0.5) * spread;
        this.positions[i3 + 1] = anchor.y + height;
        this.positions[i3 + 2] = anchor.z + (Math.random() - 0.5) * spread;
        const shade = 0.88 + Math.random() * 0.24;
        this.baseColors[i3] = THREE.MathUtils.clamp(color[0] * shade, 0, 1);
        this.baseColors[i3 + 1] = THREE.MathUtils.clamp(color[1] * shade, 0, 1);
        this.baseColors[i3 + 2] = THREE.MathUtils.clamp(color[2] * shade, 0, 1);
        this.colors[i3] = this.baseColors[i3];
        this.colors[i3 + 1] = this.baseColors[i3 + 1];
        this.colors[i3 + 2] = this.baseColors[i3 + 2];

        this.velocities[idx].set(
            (Math.random() - 0.5) * lateral,
            vertical + Math.random() * verticalJitter,
            (Math.random() - 0.5) * lateral
        ).multiplyScalar(velocityScale);

        this.life[idx] = life;
        this.maxLife[idx] = life;
    }

    update(dt, player) {
        const drifting = player.isDrifting && player.speed > 9;
        if (drifting) {
            const anchors = player.getRearEffectAnchors();
            const config = this._getSurfaceSmokeConfig(player);
            const rate = config.rate * (0.4 + Math.min(1, player.getSpeedKmh() / 220));
            this._spawnCarry += rate * dt;
            while (this._spawnCarry >= 1) {
                this.emit(anchors.left, config);
                this.emit(anchors.right, config);
                this._spawnCarry -= 1;
            }
        } else {
            this._spawnCarry = 0;
        }

        for (let i = 0; i < this.maxParticles; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;

            const i3 = i * 3;
            const v = this.velocities[i];
            this.positions[i3] += v.x * dt;
            this.positions[i3 + 1] += v.y * dt;
            this.positions[i3 + 2] += v.z * dt;
            v.multiplyScalar(0.985);
            v.y += 0.2 * dt;

            const fade = this.maxLife[i] > 0
                ? THREE.MathUtils.clamp(this.life[i] / this.maxLife[i], 0, 1)
                : 0;
            this.colors[i3] = this.baseColors[i3] * fade;
            this.colors[i3 + 1] = this.baseColors[i3 + 1] * fade;
            this.colors[i3 + 2] = this.baseColors[i3 + 2] * fade;
            if (fade <= 0) {
                this.positions[i3 + 1] = -9999;
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    reset() {
        this.life.fill(0);
        this.maxLife.fill(0);
        for (let i = 0; i < this.maxParticles; i++) {
            this.positions[i * 3 + 1] = -9999;
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    dispose() {
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.parent?.remove(this.points);
    }

    _getSurfaceSmokeConfig(player) {
        if (player.surfaceType === 'cobblestone') {
            return {
                rate: 18,
                intensity: 0.8,
                color: player.isInTunnel ? [0.40, 0.38, 0.36] : [0.54, 0.50, 0.44],
                spread: 0.26,
                height: 0.02,
                life: 0.62 + Math.random() * 0.24,
                lateral: 1.05,
                vertical: 0.42,
                verticalJitter: 0.42,
                velocityScale: 0.62 + Math.min(0.42, player.getSpeedKmh() / 420),
            };
        }
        return {
            rate: player.isInTunnel ? 24 : 34,
            intensity: 1,
            color: player.isInTunnel ? [0.27, 0.27, 0.28] : [0.36, 0.37, 0.38],
            spread: 0.2,
            height: 0.05,
            life: 0.85 + Math.random() * 0.4,
            lateral: 0.8,
            vertical: 0.9,
            verticalJitter: 0.8,
            velocityScale: 0.75 + Math.min(0.65, player.getSpeedKmh() / 240),
        };
    }
}

class SkidMarkSystem {
    constructor(scene, maxSegments = 2500) {
        this.maxSegments = maxSegments;
        this.positions = new Float32Array(maxSegments * 2 * 3);
        this.colors = new Float32Array(maxSegments * 2 * 3);
        this.cursor = 0;
        this.prevLeft = null;
        this.prevRight = null;

        this.positions.fill(0);
        this.colors.fill(0.1);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.5,
        });

        this.lines = new THREE.LineSegments(geo, mat);
        this.lines.frustumCulled = false;
        scene.add(this.lines);
        this.geometry = geo;
    }

    _pushSegment(a, b, darkness = 0.1) {
        const seg = this.cursor;
        this.cursor = (this.cursor + 1) % this.maxSegments;
        const i6 = seg * 6;
        this.positions[i6] = a.x;
        this.positions[i6 + 1] = a.y + 0.03;
        this.positions[i6 + 2] = a.z;
        this.positions[i6 + 3] = b.x;
        this.positions[i6 + 4] = b.y + 0.03;
        this.positions[i6 + 5] = b.z;

        const c = THREE.MathUtils.clamp(darkness, 0.04, 0.22);
        this.colors[i6] = c;
        this.colors[i6 + 1] = c;
        this.colors[i6 + 2] = c;
        this.colors[i6 + 3] = c;
        this.colors[i6 + 4] = c;
        this.colors[i6 + 5] = c;
    }

    update(player) {
        const draw = player.isDrifting && player.speed > 11 && player.onTrack;
        const anchors = player.getRearEffectAnchors();
        if (!draw) {
            this.prevLeft = null;
            this.prevRight = null;
            return;
        }

        if (this.prevLeft && this.prevRight) {
            const darkness = this._getSurfaceSkidDarkness(player);
            this._pushSegment(this.prevLeft, anchors.left, darkness);
            this._pushSegment(this.prevRight, anchors.right, darkness);
            this.geometry.attributes.position.needsUpdate = true;
            this.geometry.attributes.color.needsUpdate = true;
        }

        this.prevLeft = anchors.left.clone();
        this.prevRight = anchors.right.clone();
    }

    reset() {
        this.prevLeft = null;
        this.prevRight = null;
        this.positions.fill(0);
        this.colors.fill(0.1);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    dispose() {
        this.lines.geometry.dispose();
        this.lines.material.dispose();
        this.lines.parent?.remove(this.lines);
    }

    _getSurfaceSkidDarkness(player) {
        const quality = player.driftQuality || 0;
        if (player.surfaceType === 'cobblestone') {
            return 0.05 + Math.min(0.03, quality * 0.03);
        }
        return 0.10 + Math.min(0.08, quality * 0.08);
    }
}

class BurstParticleSystem {
    constructor(scene, {
        maxParticles = 160,
        size = 0.5,
        opacity = 0.7,
        gravity = -3.5,
        drag = 0.92,
        color = [1, 1, 1],
    } = {}) {
        this.maxParticles = maxParticles;
        this.gravity = gravity;
        this.drag = drag;
        this.defaultColor = color;
        this.positions = new Float32Array(maxParticles * 3);
        this.colors = new Float32Array(maxParticles * 3);
        this.baseColors = new Float32Array(maxParticles * 3);
        this.velocities = Array.from({ length: maxParticles }, () => new THREE.Vector3());
        this.life = new Float32Array(maxParticles);
        this.maxLife = new Float32Array(maxParticles);
        this.cursor = 0;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        const mat = new THREE.PointsMaterial({
            size,
            transparent: true,
            opacity,
            depthWrite: false,
            vertexColors: true,
        });

        this.points = new THREE.Points(geo, mat);
        this.points.frustumCulled = false;
        scene.add(this.points);
        this.geometry = geo;
    }

    emit(position, velocity, life, color = this.defaultColor) {
        const idx = this.cursor;
        this.cursor = (this.cursor + 1) % this.maxParticles;
        const i3 = idx * 3;
        this.positions[i3] = position.x;
        this.positions[i3 + 1] = position.y;
        this.positions[i3 + 2] = position.z;
        this.velocities[idx].copy(velocity);
        this.life[idx] = life;
        this.maxLife[idx] = life;
        this.baseColors[i3] = color[0];
        this.baseColors[i3 + 1] = color[1];
        this.baseColors[i3 + 2] = color[2];
        this.colors[i3] = color[0];
        this.colors[i3 + 1] = color[1];
        this.colors[i3 + 2] = color[2];
    }

    update(dt) {
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;

            const i3 = i * 3;
            const v = this.velocities[i];
            this.positions[i3] += v.x * dt;
            this.positions[i3 + 1] += v.y * dt;
            this.positions[i3 + 2] += v.z * dt;
            v.multiplyScalar(Math.pow(this.drag, dt * 60));
            v.y += this.gravity * dt;

            const fade = this.maxLife[i] > 0
                ? THREE.MathUtils.clamp(this.life[i] / this.maxLife[i], 0, 1)
                : 0;
            this.colors[i3] = this.baseColors[i3] * fade;
            this.colors[i3 + 1] = this.baseColors[i3 + 1] * fade;
            this.colors[i3 + 2] = this.baseColors[i3 + 2] * fade;
            if (fade <= 0) {
                this.positions[i3 + 1] = -9999;
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    reset() {
        this.life.fill(0);
        this.maxLife.fill(0);
        for (let i = 0; i < this.maxParticles; i++) {
            this.positions[i * 3 + 1] = -9999;
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    dispose() {
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.parent?.remove(this.points);
    }
}

export class TrackEffects {
    constructor(scene) {
        this.smoke = new TireSmokeSystem(scene);
        this.skid = new SkidMarkSystem(scene);
        this.landingDust = new BurstParticleSystem(scene, {
            maxParticles: 180,
            size: 0.9,
            opacity: 0.48,
            gravity: -2.2,
            drag: 0.9,
            color: [0.56, 0.54, 0.50],
        });
        this.wallSparks = new BurstParticleSystem(scene, {
            maxParticles: 96,
            size: 0.28,
            opacity: 0.85,
            gravity: -10.5,
            drag: 0.95,
            color: [1.0, 0.82, 0.30],
        });
        this._prevWallHitCount = 0;
        this._prevAirborne = false;
        this._prevAirborneTimer = 0;
    }

    update(dt, player, raceState) {
        this.smoke.update(dt, player);
        this._updateImpactBursts(player);
        this.landingDust.update(dt);
        this.wallSparks.update(dt);

        if (raceState === 'racing') {
            this.skid.update(player);
        } else {
            this.skid.prevLeft = null;
            this.skid.prevRight = null;
        }

        this._prevWallHitCount = player.wallHitCount || 0;
        this._prevAirborne = player.airborneTimer > 0.001;
        this._prevAirborneTimer = player.airborneTimer || 0;
    }

    reset() {
        this.smoke.reset();
        this.skid.reset();
        this.landingDust.reset();
        this.wallSparks.reset();
        this._prevWallHitCount = 0;
        this._prevAirborne = false;
        this._prevAirborneTimer = 0;
    }

    dispose() {
        this.smoke.dispose();
        this.skid.dispose();
        this.landingDust.dispose();
        this.wallSparks.dispose();
    }

    _updateImpactBursts(player) {
        const airborne = player.airborneTimer > 0.001;
        if (this._prevAirborne && !airborne && player.onTrack) {
            this._emitLandingDust(player, this._prevAirborneTimer);
        }

        const wallHitCount = player.wallHitCount || 0;
        if (wallHitCount > this._prevWallHitCount && player.onTrack) {
            this._emitWallSparks(player);
        }
    }

    _emitLandingDust(player, airborneTimer) {
        const anchors = player.getRearEffectAnchors();
        const forward = anchors.forward.clone().normalize();
        const right = player.surfaceRight.clone().normalize();
        const up = player.surfaceUp.clone().normalize();
        const speedN = THREE.MathUtils.clamp(player.getSpeedKmh() / 210, 0.35, 1.15);
        const airN = THREE.MathUtils.clamp((airborneTimer || 0.18) / 0.42, 0.45, 1.0);
        const intensity = speedN * airN;
        const count = Math.round(12 + intensity * 16);
        const color = player.surfaceType === 'cobblestone'
            ? [0.62, 0.58, 0.52]
            : [0.54, 0.53, 0.50];

        const spawnPoints = [
            anchors.left.clone(),
            anchors.right.clone(),
            player.position.clone().addScaledVector(up, 0.06),
        ];
        for (let i = 0; i < count; i++) {
            const origin = spawnPoints[i % spawnPoints.length].clone()
                .addScaledVector(right, (Math.random() - 0.5) * 0.65)
                .addScaledVector(forward, (Math.random() - 0.5) * 0.7)
                .addScaledVector(up, 0.03 + Math.random() * 0.05);
            const velocity = right.clone().multiplyScalar((Math.random() - 0.5) * (1.8 + intensity * 2.6))
                .addScaledVector(forward, (Math.random() - 0.3) * (1.2 + intensity * 2.2))
                .addScaledVector(up, 0.7 + Math.random() * (1.3 + intensity * 1.2));
            const life = 0.35 + Math.random() * 0.24 + intensity * 0.18;
            this.landingDust.emit(origin, velocity, life, color);
        }
    }

    _emitWallSparks(player) {
        const impact = THREE.MathUtils.clamp(player.lastWallImpact || 0.25, 0.2, 1.0);
        const side = player.lastWallSide || 1;
        const forward = new THREE.Vector3(Math.sin(player.rotation), 0, Math.cos(player.rotation))
            .projectOnPlane(player.surfaceUp)
            .normalize();
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);

        const right = player.surfaceRight.clone().normalize();
        const up = player.surfaceUp.clone().normalize();
        const sideDir = right.clone().multiplyScalar(side);
        const base = player.position.clone()
            .addScaledVector(sideDir, 1.02)
            .addScaledVector(forward, 0.7)
            .addScaledVector(up, 0.42);
        const tangent = forward.clone().multiplyScalar(Math.sign(player.speed || 1));
        const count = Math.round(8 + impact * 18);

        for (let i = 0; i < count; i++) {
            const origin = base.clone()
                .addScaledVector(up, (Math.random() - 0.5) * 0.24)
                .addScaledVector(tangent, (Math.random() - 0.5) * 0.32);
            const velocity = tangent.clone().multiplyScalar(1.8 + Math.random() * 4.2 + impact * 3.8)
                .addScaledVector(sideDir, -(0.6 + Math.random() * 1.6))
                .addScaledVector(up, 0.8 + Math.random() * 2.4);
            const hot = 0.7 + Math.random() * 0.3;
            const color = [1.0, 0.55 + hot * 0.25, 0.18 + hot * 0.16];
            const life = 0.12 + Math.random() * 0.12 + impact * 0.08;
            this.wallSparks.emit(origin, velocity, life, color);
        }
    }
}
