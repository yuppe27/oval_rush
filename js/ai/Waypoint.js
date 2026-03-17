import * as THREE from 'three';

function wrap01(t) {
    return ((t % 1) + 1) % 1;
}

export class WaypointSystem {
    constructor(courseBuilder, options = {}) {
        this.courseBuilder = courseBuilder;
        this.step = options.step ?? 8;
        this.lookAheadT = options.lookAheadT ?? 0.012;
        // Stage-2 tuning: denser preview for smoother brake timing.
        this.lookAheadOffsets = options.lookAheadOffsets ?? [0.01, 0.02, 0.034, 0.05];
        this.maxSpeed = options.maxSpeed ?? 75;
        this.waypoints = [];
    }

    build() {
        this.waypoints.length = 0;
        const sampled = this.courseBuilder.sampledPoints;
        const N = sampled.length;
        if (!N) return this.waypoints;

        let id = 0;
        for (let i = 0; i < N; i += this.step) {
            const sp = sampled[i];
            const a = this.courseBuilder.spline.getTangentAt(sp.t).normalize();

            // Multi-point preview to trigger braking earlier on complex corners.
            let curvePeak = 0;
            let weighted = 0;
            let weightSum = 0;
            for (let k = 0; k < this.lookAheadOffsets.length; k++) {
                const off = this.lookAheadOffsets[k];
                const b = this.courseBuilder.spline
                    .getTangentAt(wrap01(sp.t + off))
                    .normalize();
                const c = a.angleTo(b);
                curvePeak = Math.max(curvePeak, c);
                const w = 1 + k * 0.28;
                weighted += c * w;
                weightSum += w;
            }
            const curveAvg = weightSum > 0 ? weighted / weightSum : 0;
            const curve = curvePeak * 0.62 + curveAvg * 0.38;
            const curveN = THREE.MathUtils.clamp(curve / 0.55, 0, 1);
            const suggestedSpeed = THREE.MathUtils.lerp(
                this.maxSpeed * 1.0,
                this.maxSpeed * 0.72,
                curveN
            );

            this.waypoints.push({
                id: id++,
                sampleIndex: i,
                t: sp.t,
                position: sp.position.clone(),
                forward: sp.forward.clone(),
                width: sp.width,
                curvature: curve,
                suggestedSpeed,
            });
        }

        return this.waypoints;
    }

    findNearestAhead(progressT, currentIndex = 0) {
        const N = this.waypoints.length;
        if (!N) return null;

        let idx = currentIndex % N;
        if (idx < 0) idx += N;

        for (let i = 0; i < N; i++) {
            const wp = this.waypoints[idx];
            const d = wrap01(wp.t - progressT);
            if (d < 0.08) return { waypoint: wp, index: idx, deltaT: d };
            idx = (idx + 1) % N;
        }

        const fallback = this.waypoints[currentIndex % N];
        return { waypoint: fallback, index: currentIndex % N, deltaT: 0 };
    }
}
