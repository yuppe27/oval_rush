import * as THREE from 'three';

class TireSmokeSystem {
    constructor(scene, maxParticles = 420) {
        this.maxParticles = maxParticles;
        this.positions = new Float32Array(maxParticles * 3);
        this.colors = new Float32Array(maxParticles * 3);
        this.velocities = Array.from({ length: maxParticles }, () => new THREE.Vector3());
        this.life = new Float32Array(maxParticles);
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

    emit(anchor, intensity = 1) {
        const idx = this.cursor;
        this.cursor = (this.cursor + 1) % this.maxParticles;

        const i3 = idx * 3;
        this.positions[i3] = anchor.x + (Math.random() - 0.5) * 0.2;
        this.positions[i3 + 1] = anchor.y + 0.05;
        this.positions[i3 + 2] = anchor.z + (Math.random() - 0.5) * 0.2;
        const c = 0.30 + Math.random() * 0.2;
        this.colors[i3] = c;
        this.colors[i3 + 1] = c;
        this.colors[i3 + 2] = c;

        this.velocities[idx].set(
            (Math.random() - 0.5) * 0.8,
            0.9 + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.8
        ).multiplyScalar(0.75 + intensity * 0.65);

        this.life[idx] = 0.85 + Math.random() * 0.4;
    }

    update(dt, player) {
        const drifting = player.isDrifting && player.speed > 9;
        if (drifting) {
            const anchors = player.getRearEffectAnchors();
            const rate = 34 * (0.4 + Math.min(1, player.getSpeedKmh() / 220));
            this._spawnCarry += rate * dt;
            while (this._spawnCarry >= 1) {
                this.emit(anchors.left, 1);
                this.emit(anchors.right, 1);
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

            const fade = Math.max(0, this.life[i] * 1.1);
            this.colors[i3] *= 0.995;
            this.colors[i3 + 1] *= 0.995;
            this.colors[i3 + 2] *= 0.995;
            if (fade <= 0) {
                this.positions[i3 + 1] = -9999;
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    reset() {
        this.life.fill(0);
        for (let i = 0; i < this.maxParticles; i++) {
            this.positions[i * 3 + 1] = -9999;
        }
        this.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.parent?.remove(this.points);
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

        const c = THREE.MathUtils.clamp(darkness, 0.05, 0.22);
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
            const darkness = 0.10 + Math.min(0.08, (player.driftQuality || 0) * 0.08);
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
}

export class TrackEffects {
    constructor(scene) {
        this.smoke = new TireSmokeSystem(scene);
        this.skid = new SkidMarkSystem(scene);
    }

    update(dt, player, raceState) {
        this.smoke.update(dt, player);
        if (raceState === 'racing') {
            this.skid.update(player);
        } else {
            this.skid.prevLeft = null;
            this.skid.prevRight = null;
        }
    }

    reset() {
        this.smoke.reset();
        this.skid.reset();
    }

    dispose() {
        this.smoke.dispose();
        this.skid.dispose();
    }
}
