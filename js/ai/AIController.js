import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIVehicle } from '../vehicles/AIVehicle.js';
import { VEHICLE_PRESET_IDS, resolveVehiclePreset } from '../vehicles/VehicleParams.js';
import { WaypointSystem } from './Waypoint.js';
import { DEFAULT_MAX_SPEED, KMH_TO_MS } from '../core/Constants.js';

const DEFAULT_PLAYER_REFERENCE_MAX_SPEED = DEFAULT_MAX_SPEED * KMH_TO_MS;
const FASTEST_AI_SPEED_RATIO = 1.08;
const AI_AHEAD_PLAYER_SPEED_CAP_RATIO = 0.9;
const ROAD_SURFACE_OFFSET = 0.05;

function wrap01(t) {
    return ((t % 1) + 1) % 1;
}

const DEFAULT_TUNING = {
    waypoint: {
        step: 8,
        lookAheadT: 0.012,
        lookAheadOffsets: [0.01, 0.02, 0.034, 0.05],
    },
    speed: {
        targetSmoothing: 0.28,
        followResponse: 0.16,
        launchBoostSec: 2.5,
        launchAccelScale: 2.0,
        launchMinSpeedRatio: 0.45,
        launchTargetSpeedRatio: 0.96,
    },
    drift: {
        curvatureEnter: 0.16,
        curvatureExit: 0.10,
        minSpeedRatio: 0.52,
        holdSec: 0.28,
        strengthLerpIn: 0.17,
        strengthLerpOut: 0.10,
        maxAngle: 0.34,
        brakeScaleMin: 0.64,
        cornerSpeedPenalty: 0.985,
    },
    lane: {
        returnToCenter: 0.035,
        avoidCloseT: 0.012,
        avoidCloseLane: 3.0,
        avoidNudge: 0.85,
        crowdLookAheadT: 0.022,
        crowdLaneInfluence: 4.6,
        crowdNudge: 0.55,
        overtakeLookAheadT: 0.018,
        overtakeLaneThreat: 3.0,
        overtakeSideOffset: 2.8,
        overtakeCommit: 0.82,
        overtakeCurrentBias: 0.2,
        offsetLerp: 0.14,
        wallMargin: 1.2,
        racingLineLookAhead: 3,
        racingLineApproachT: 0.02,
        racingLineApexT: 0.008,
        racingLineOuterRatio: 0.34,
        racingLineInnerRatio: 0.22,
        racingLineExitRatio: 0.14,
        racingLineCurveRef: 0.32,
    },
    collision: {
        minDist: 3.3,
        minPlayerDist: 3.0,
        crashRelativeKmh: 100,
        aiAiPush: 0.28,
        aiAiTargetScale: 0.50,
        aiAiSpeedLoss: 0.998,
        aiPlayerPush: 0.30,
        aiPlayerTargetScale: 0.45,
        aiPlayerPosPush: 0.33,
        aiPlayerSpeedLoss: 0.982,
        playerSpeedLoss: 0.976,
        overlapSpeedCut: 0.97,
        sideBySideProgressT: 0.006,
        sideBySideLongitudinalDist: 2.0,
        sideBySideAvoidBoost: 1.15,
        sideBySidePushScale: 0.82,
        sideBySideLaneOffsetScale: 0.42,
        sideBySideLaneTargetScale: 1.2,
        sideSwipeLongitudinalDist: 1.45,
        sideSwipeAiLanePushScale: 0.72,
        sideSwipePosPushScale: 0.46,
        sideSwipeAiSpeedLoss: 0.995,
        sideSwipePlayerSpeedLoss: 0.997,
    },
    difficulty: {
        EASY: {
            speedScale: 1.00,
            rbBehindFar: 1.16,
            rbBehindNear: 1.08,
            rbAheadFar: 0.985,
            rbAheadNear: 0.995,
            rbBehindStart: 0.05,
            rbBehindRange: 0.20,
            rbAheadStart: 0.12,
            rbAheadRange: 0.30,
            rbAheadGraceSec: 8.0,
        },
        NORMAL: {
            speedScale: 1.09,
            rbBehindFar: 1.2,
            rbBehindNear: 1.1,
            rbAheadFar: 0.993,
            rbAheadNear: 0.999,
            rbBehindStart: 0.05,
            rbBehindRange: 0.20,
            rbAheadStart: 0.12,
            rbAheadRange: 0.30,
            rbAheadGraceSec: 10.0,
        },
        HARD: {
            speedScale: 1.13,
            rbBehindFar: 1.16,
            rbBehindNear: 1.08,
            rbAheadFar: 0.998,
            rbAheadNear: 1.0,
            rbBehindStart: 0.05,
            rbBehindRange: 0.20,
            rbAheadStart: 0.12,
            rbAheadRange: 0.30,
            rbAheadGraceSec: 12.0,
        },
    },
};

const COURSE_TUNING = {
    'Thunder Oval Speedway': {
        waypoint: {
            lookAheadOffsets: [0.01, 0.02, 0.034, 0.05],
        },
        lane: {
            avoidNudge: 0.70,
            offsetLerp: 0.10,
        },
    },
    'Seaside Grand Circuit': {
        waypoint: {
            lookAheadOffsets: [0.012, 0.026, 0.042, 0.062],
        },
        lane: {
            avoidCloseT: 0.010,
            avoidNudge: 0.75,
            offsetLerp: 0.10,
        },
        collision: {
            minDist: 2.5,
            aiAiPush: 0.24,
            aiAiSpeedLoss: 0.998,
            aiPlayerPush: 0.27,
        },
        difficulty: {
            NORMAL: {
                rbBehindFar: 1.035,
                rbAheadFar: 0.96,
            },
        },
    },
    'Mountain Apex Rally': {
        waypoint: {
            lookAheadOffsets: [0.016, 0.032, 0.052, 0.078],
        },
        lane: {
            avoidCloseT: 0.010,
            avoidCloseLane: 2.4,
            avoidNudge: 0.70,
            offsetLerp: 0.09,
            wallMargin: 1.35,
        },
        collision: {
            minDist: 2.45,
            minPlayerDist: 2.85,
            aiAiPush: 0.22,
            aiAiSpeedLoss: 0.998,
            aiPlayerPush: 0.24,
            aiPlayerPosPush: 0.28,
        },
        difficulty: {
            HARD: {
                rbBehindFar: 1.01,
                rbAheadFar: 0.988,
            },
        },
    },
};

function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const key of Object.keys(override || {})) {
        const b = out[key];
        const o = override[key];
        if (isObject(b) && isObject(o)) {
            out[key] = mergeDeep(b, o);
        } else if (Array.isArray(o)) {
            out[key] = o.slice();
        } else {
            out[key] = o;
        }
    }
    return out;
}

/**
 * AIController
 * - Rail-based AI movement on spline
 * - InstancedMesh rendering for all AI cars
 * - Basic curve braking + lane offset + rubber-band speed bias
 */
export class AIController {
    constructor(courseBuilder, courseData, options = {}) {
        this.courseBuilder = courseBuilder;
        this.courseData = courseData;

        this.aiCount = options.aiCount ?? Math.max(1, (courseData.gridSize ?? 12) - 1);
        this.totalLaps = courseData.laps;
        this.playerReferenceMaxSpeed = Math.max(
            1,
            options.playerMaxSpeed ?? DEFAULT_PLAYER_REFERENCE_MAX_SPEED
        );
        this.playerReferenceAcceleration = Math.max(
            1,
            options.playerAcceleration ?? (120 * KMH_TO_MS)
        );
        this.playerReferenceTimeToMax = this.playerReferenceMaxSpeed / this.playerReferenceAcceleration;
        // Make AI pace relative to the selected player car rather than a fixed global default.
        this.baseMaxSpeed = options.baseMaxSpeed ?? (this.playerReferenceMaxSpeed * 1.12);
        this.aiSpeedCap = this.playerReferenceMaxSpeed * FASTEST_AI_SPEED_RATIO;
        this.tuning = this._resolveTuning(courseData, options.tuning);
        this.difficulty = 'NORMAL';
        this.difficultyConfig = null;
        this.debugEnabled = Boolean(options.debug);
        this.isActive = false;
        this.startLineT = this.courseBuilder?.sampledPoints?.[this.courseBuilder.startLineIndex]?.t ?? 0;

        this.vehicles = [];
        this._instanceLayers = [];
        this._dummy = new THREE.Object3D();
        this._introAnimTime = 0;
        this._raceElapsed = 0;
        this._nextFinishPos = 1;
        this.waypointSystem = new WaypointSystem(courseBuilder, {
            step: this.tuning.waypoint.step,
            lookAheadT: this.tuning.waypoint.lookAheadT,
            lookAheadOffsets: this.tuning.waypoint.lookAheadOffsets,
            maxSpeed: this.baseMaxSpeed,
        });
        this.waypoints = this.waypointSystem.build();

        this._buildVehicles();
        this._buildInstancedMesh();
        this.setDifficulty(options.difficulty ?? 'NORMAL');
        this.resetToGrid();
    }

    _buildVehicles() {
        this.vehicles.length = 0;
        for (let i = 0; i < this.aiCount; i++) {
            const presetId = VEHICLE_PRESET_IDS[i % VEHICLE_PRESET_IDS.length];
            const preset = resolveVehiclePreset(presetId);
            const baseVehicleMaxSpeed = Math.min(this.aiSpeedCap, preset.maxSpeedKmh * KMH_TO_MS);
            const aggression = 0.2 + Math.random() * 0.8;
            const stability = 0.35 + Math.random() * 0.65;
            const linePrecision = 0.35 + Math.random() * 0.65;
            const packAvoidance = 0.3 + Math.random() * 0.7;
            const spacingBias = 0.25 + Math.random() * 0.75;
            const preferredLaneBias = (Math.random() - 0.5) * 1.2;
            const preferredOvertakeSide = Math.random() < 0.5 ? -1 : 1;
            // Distribute pace evenly across the grid so cars naturally spread out.
            // Index-based spacing ensures a wide, even spread (0.78–1.16).
            const paceBase = 0.78 + (i / Math.max(1, this.aiCount - 1)) * 0.36;
            const pace = THREE.MathUtils.clamp(paceBase + (Math.random() - 0.5) * 0.10, 0.76, 1.18);
            const lane = THREE.MathUtils.clamp(
                (Math.random() - 0.5) * 4.8 + preferredLaneBias * 1.2,
                -4.8,
                4.8
            );
            const aiMaxSpeed = Math.min(this.aiSpeedCap, baseVehicleMaxSpeed * pace);
            this.vehicles.push(new AIVehicle(i, {
                vehicleId: preset.id,
                maxSpeed: aiMaxSpeed,
                baseMaxSpeed: baseVehicleMaxSpeed,
                targetSpeed: aiMaxSpeed * 0.98,
                laneOffset: lane,
                paceFactor: pace,
                baseAcceleration: preset.accelerationKmh * KMH_TO_MS,
                accel: preset.accelerationKmh * KMH_TO_MS,
                brake: (preset.accelerationKmh * 1.28) * KMH_TO_MS,
                transmissionFinalRatio: preset.transmissionFinalRatio,
                gearTable: preset.gearTable,
                aggression,
                stability,
                linePrecision,
                packAvoidance,
                spacingBias,
                preferredLaneBias,
                preferredOvertakeSide,
            }));
        }
    }

    _buildInstancedMesh() {
        const n = this.aiCount;

        // Helper: prep geometry for merge (strip UV, convert to non-indexed)
        const prep = (g) => {
            g.deleteAttribute('uv');
            return g.index ? g.toNonIndexed() : g;
        };

        // --- Helper: create box geometry pre-offset to world-local position ---
        const offBox = (w, h, l, x, y, z, rx = 0, ry = 0, rz = 0) => {
            const g = new THREE.BoxGeometry(w, h, l);
            if (rx) g.rotateX(rx);
            if (ry) g.rotateY(ry);
            if (rz) g.rotateZ(rz);
            g.translate(x, y, z);
            return prep(g);
        };
        // Cylinder (for wheels/exhausts) rotated on Z axis
        const offCylZ = (r, t, x, y, z, segs = 10) => {
            const g = new THREE.CylinderGeometry(r, r, t, segs);
            g.rotateZ(Math.PI / 2);
            g.translate(x, y, z);
            return prep(g);
        };

        // ============================================================
        // LAYER 1: Body paint (uses instance colors for per-car color)
        // ============================================================
        const bodyParts = [
            // Main body
            offBox(1.98, 0.50, 3.50, 0, 0.52, -0.04),
            // Belt line (narrower upper body)
            offBox(1.78, 0.16, 2.70, 0, 0.80, -0.12),
            // Rear deck
            offBox(1.86, 0.22, 0.90, 0, 0.90, -1.55),
            // Nose (tilted box to approximate wedge)
            offBox(1.88, 0.40, 1.10, 0, 0.48, 1.96, -0.15),
            // Nose lower (fills gap under tilted nose)
            offBox(1.84, 0.18, 0.70, 0, 0.30, 2.20),
            // Tail (tilted box)
            offBox(1.88, 0.32, 0.86, 0, 0.78, -2.0, 0.12),
            // Front fenders
            offBox(0.42, 0.30, 0.80, 1.02, 0.56, 1.20),
            offBox(0.42, 0.30, 0.80, -1.02, 0.56, 1.20),
            // Rear fenders
            offBox(0.46, 0.34, 0.90, 1.04, 0.60, -1.24),
            offBox(0.46, 0.34, 0.90, -1.04, 0.60, -1.24),
        ];
        const bodyGeo = mergeGeometries(bodyParts);
        const bodyMat = new THREE.MeshStandardMaterial({
            roughness: 0.25,
            metalness: 0.7,
        });
        this.instanceMeshBody = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
        this.instanceMeshBody.castShadow = true;
        this.instanceMeshBody.receiveShadow = true;
        this.instanceMeshBody.frustumCulled = false;

        // Assign per-car racing colors
        const racingColors = [
            0x2255dd, 0xdd2222, 0x22aa44, 0xee8800,
            0x9933cc, 0x00bbcc, 0xcccc00, 0xff4488,
            0x4466ff, 0xaa5500, 0x228866, 0xcc3366,
        ];
        for (let i = 0; i < n; i++) {
            const c = new THREE.Color(racingColors[i % racingColors.length]);
            this.instanceMeshBody.setColorAt(i, c);
        }
        if (this.instanceMeshBody.instanceColor) {
            this.instanceMeshBody.instanceColor.needsUpdate = true;
        }

        // ============================================================
        // LAYER 2: Cabin / roof
        // ============================================================
        const roofParts = [
            offBox(1.58, 0.42, 2.00, 0, 1.02, -0.20),
        ];
        const roofGeo = mergeGeometries(roofParts);
        const roofMat = new THREE.MeshStandardMaterial({
            roughness: 0.25,
            metalness: 0.7,
        });
        this.instanceMeshRoof = new THREE.InstancedMesh(roofGeo, roofMat, n);
        this.instanceMeshRoof.castShadow = true;
        this.instanceMeshRoof.frustumCulled = false;
        // Roof inherits body color
        for (let i = 0; i < n; i++) {
            const c = new THREE.Color(racingColors[i % racingColors.length]);
            this.instanceMeshRoof.setColorAt(i, c);
        }
        if (this.instanceMeshRoof.instanceColor) {
            this.instanceMeshRoof.instanceColor.needsUpdate = true;
        }

        // ============================================================
        // LAYER 3: Dark trim (underbody, splitter, diffuser, spoiler, side skirts)
        // ============================================================
        const trimParts = [
            // Underbody / chassis
            offBox(2.06, 0.22, 4.50, 0, 0.25, 0),
            // Side pods
            offBox(0.30, 0.22, 2.00, 1.0, 0.37, 0.04),
            offBox(0.30, 0.22, 2.00, -1.0, 0.37, 0.04),
            // Front splitter
            offBox(1.96, 0.06, 0.44, 0, 0.12, 2.22),
            // Rear diffuser
            offBox(1.82, 0.08, 0.36, 0, 0.14, -2.20),
            // Side skirts
            offBox(0.07, 0.10, 2.90, 1.05, 0.28, 0),
            offBox(0.07, 0.10, 2.90, -1.05, 0.28, 0),
            // Spoiler blade
            offBox(1.82, 0.055, 0.30, 0, 1.16, -2.04),
            // Spoiler supports
            offBox(0.07, 0.30, 0.07, 0.70, 1.00, -2.04),
            offBox(0.07, 0.30, 0.07, -0.70, 1.00, -2.04),
            // Spoiler endplates
            offBox(0.03, 0.12, 0.34, 0.91, 1.16, -2.04),
            offBox(0.03, 0.12, 0.34, -0.91, 1.16, -2.04),
            // Door seam lines
            offBox(0.015, 0.50, 0.015, 1.0, 0.56, -0.0),
            offBox(0.015, 0.50, 0.015, -1.0, 0.56, -0.0),
            // Grille opening
            offBox(1.14, 0.18, 0.05, 0, 0.42, 2.36),
        ];
        const trimGeo = mergeGeometries(trimParts);
        const trimMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.65,
            metalness: 0.2,
        });
        this.instanceMeshTrim = new THREE.InstancedMesh(trimGeo, trimMat, n);
        this.instanceMeshTrim.castShadow = true;
        this.instanceMeshTrim.frustumCulled = false;

        // ============================================================
        // LAYER 4: Glass (windshields + side windows)
        // ============================================================
        const glassParts = [
            // Front windshield (tilted)
            (() => {
                const g = offBox(1.40, 0.26, 0.04, 0, 1.04, 0.68);
                g.rotateX(-0.28);
                return g;
            })(),
            // Rear glass (tilted)
            (() => {
                const g = offBox(1.34, 0.22, 0.04, 0, 0.98, -0.76);
                g.rotateX(0.22);
                return g;
            })(),
            // Side windows
            offBox(0.03, 0.28, 1.76, 0.80, 1.00, -0.20),
            offBox(0.03, 0.28, 1.76, -0.80, 1.00, -0.20),
        ];
        const glassGeo = mergeGeometries(glassParts);
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x8ab8d8,
            roughness: 0.08,
            metalness: 0.25,
            transparent: true,
            opacity: 0.55,
        });
        this.instanceMeshGlass = new THREE.InstancedMesh(glassGeo, glassMat, n);
        this.instanceMeshGlass.frustumCulled = false;

        // ============================================================
        // LAYER 5: Headlights (emissive)
        // ============================================================
        const headParts = [
            offBox(0.26, 0.14, 0.06, 0.72, 0.52, 2.18),
            offBox(0.26, 0.14, 0.06, -0.72, 0.52, 2.18),
            // Chrome grille bar
            offBox(1.20, 0.035, 0.06, 0, 0.54, 2.36),
        ];
        const headGeo = mergeGeometries(headParts);
        const headMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xf0e878,
            emissiveIntensity: 0.5,
            roughness: 0.15,
            metalness: 0.1,
        });
        this.instanceMeshHead = new THREE.InstancedMesh(headGeo, headMat, n);
        this.instanceMeshHead.frustumCulled = false;

        // ============================================================
        // LAYER 6: Taillights (emissive)
        // ============================================================
        const tailParts = [
            offBox(0.30, 0.10, 0.06, 0.68, 0.52, -2.14),
            offBox(0.30, 0.10, 0.06, -0.68, 0.52, -2.14),
            // Inner LED strip
            offBox(0.14, 0.04, 0.07, 0.64, 0.58, -2.14),
            offBox(0.14, 0.04, 0.07, -0.64, 0.58, -2.14),
        ];
        const tailGeo = mergeGeometries(tailParts);
        const tailMat = new THREE.MeshStandardMaterial({
            color: 0xdd2222,
            emissive: 0xdd2222,
            emissiveIntensity: 0.55,
            roughness: 0.2,
            metalness: 0.1,
        });
        this.instanceMeshTail = new THREE.InstancedMesh(tailGeo, tailMat, n);
        this.instanceMeshTail.frustumCulled = false;

        // ============================================================
        // LAYER 7: Wheels (tires + rims, 4 per car)
        // ============================================================
        const R = 0.30, T = 0.27;
        const wheelPositions = [
            [-1.02, 0.30, 1.30],  // FL
            [ 1.02, 0.30, 1.30],  // FR
            [-1.02, 0.30, -1.34], // RL
            [ 1.02, 0.30, -1.34], // RR
        ];
        const wheelParts = [];
        for (const [wx, wy, wz] of wheelPositions) {
            // Tire
            wheelParts.push(offCylZ(R, T, wx, wy, wz, 12));
            // Rim (slightly narrower, smaller radius)
            wheelParts.push(offCylZ(R * 0.75, T * 0.3, wx, wy, wz, 10));
        }
        const wheelGeo = mergeGeometries(wheelParts);
        const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.80,
            metalness: 0.12,
        });
        this.instanceMeshWheels = new THREE.InstancedMesh(wheelGeo, wheelMat, n);
        this.instanceMeshWheels.castShadow = true;
        this.instanceMeshWheels.frustumCulled = false;

        // ============================================================
        // LAYER 8: Chrome accents (mirrors, exhaust tips)
        // ============================================================
        const chromeParts = [
            // Mirror arms + housings
            offBox(0.18, 0.04, 0.05, 0.86, 0.96, 0.38),
            offBox(0.07, 0.10, 0.16, 0.94, 0.96, 0.38),
            offBox(0.18, 0.04, 0.05, -0.86, 0.96, 0.38),
            offBox(0.07, 0.10, 0.16, -0.94, 0.96, 0.38),
            // Exhaust tips
            offCylZ(0.05, 0.28, 0.34, 0.34, -2.30, 8),
            offCylZ(0.05, 0.28, -0.34, 0.34, -2.30, 8),
        ];
        const chromeGeo = mergeGeometries(chromeParts);
        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xd0d0d0,
            roughness: 0.12,
            metalness: 0.92,
        });
        this.instanceMeshChrome = new THREE.InstancedMesh(chromeGeo, chromeMat, n);
        this.instanceMeshChrome.frustumCulled = false;

        // Collect all layers for unified transform updates
        this._instanceLayers = [
            this.instanceMeshBody,
            this.instanceMeshRoof,
            this.instanceMeshTrim,
            this.instanceMeshGlass,
            this.instanceMeshHead,
            this.instanceMeshTail,
            this.instanceMeshWheels,
            this.instanceMeshChrome,
        ];
    }

    addToScene(scene) {
        for (const layer of this._instanceLayers) {
            scene.add(layer);
        }
    }

    /**
     * Place AI cars in a staggered start grid behind the player.
     */
    resetToGrid(startIndex = this.courseBuilder.startLineIndex) {
        const N = this.courseBuilder.sampledPoints.length;
        const startIdx = startIndex;
        const spacingSamples = Math.max(3, Math.floor(N * 0.007));

        this.vehicles.forEach((ai, i) => {
            const row = Math.floor(i / 2) + 1;
            const col = i % 2;
            const idx = (startIdx - row * spacingSamples + N) % N;
            const t = idx / N;
            const lane = col === 0 ? -2.2 : 2.2;
            ai.setGridPosition(t, 1);
            // 遅いAIにスタート加速ボーナスを付与して序盤の順位シャッフルを促進
            const paceNorm = THREE.MathUtils.clamp((ai.paceFactor - 0.76) / 0.42, 0, 1);
            const launchBonus = THREE.MathUtils.lerp(1.35, 1.0, paceNorm);
            ai.launchTimer = this.tuning.speed.launchBoostSec * launchBonus;
            ai.launchThrottle = 1.0;
            // 初速にランダム揺らぎを加え、同列の2台に差をつける
            const startJitter = 0.92 + Math.random() * 0.12;
            ai.speed = ai.maxSpeed * this.tuning.speed.launchMinSpeedRatio * startJitter;
            ai.targetSpeed = ai.maxSpeed * this.tuning.speed.launchTargetSpeedRatio;
            ai.laneOffset = lane;
            ai.laneTarget = lane;
            ai.currentWaypointIndex = this._findClosestWaypointIndex(t);
        });

        this._nextFinishPos = 1;
        this._raceElapsed = 0;
        this.isActive = false;
        this._updateTransforms();
    }

    setActive(active) {
        this.isActive = active;
    }

    primeRaceStartFromCurrentState() {
        for (const ai of this.vehicles) {
            ai.lap = 1;
            ai.completed = false;
            ai.finishPosition = 0;
            ai.startLinePassed = false;
            ai.postFinishCruiseSpeed = null;
        }
        this._nextFinishPos = 1;
        this._raceElapsed = 0;
    }

    setDifficulty(level = 'NORMAL') {
        const key = String(level).toUpperCase();
        const table = this.tuning.difficulty;
        this.difficulty = table[key] ? key : 'NORMAL';
        this.difficultyConfig = table[this.difficulty];

        for (const ai of this.vehicles) {
            ai.maxSpeed = Math.min(
                this.aiSpeedCap,
                ai.baseMaxSpeed * ai.paceFactor * this.difficultyConfig.speedScale
            );
            ai.accel = ai.maxSpeed / Math.max(0.1, this.playerReferenceTimeToMax);
        }
    }

    update(dt, player, raceState, playerLap = 1, justEnteredRacing = false) {
        this._introAnimTime += dt;

        const canRun = raceState === 'grid_intro'
            || raceState === 'racing'
            || raceState === 'finish_celebration'
            || raceState === 'finished';
        if (canRun && this.isActive) {
            this._raceElapsed += dt;
        }
        if (!canRun || !this.isActive) {
            this._updateTransforms(raceState);
            return;
        }
        const playerAbs = this._absProgress(playerLap, player ? player.trackT : 0);
        const introCruiseSpeed = raceState === 'grid_intro'
            ? Math.max(0, player?.autoDriveSpeed ?? Math.abs(player?.speed ?? 0))
            : null;
        const globalPostFinishCruiseSpeed = (raceState === 'finish_celebration' || raceState === 'finished')
            ? Math.max(0, player?.autoDriveSpeed ?? Math.abs(player?.speed ?? 0))
            : null;

        // ラバーバンドはプレイヤーに最も近い2台のみ適用し、終盤の集団化を防ぐ
        const RIVAL_RB_COUNT = 2;
        const _rbEligible = new Set(
            [...this.vehicles]
                .filter(v => !v.completed && !v.isCrashed)
                .sort((a, b) =>
                    Math.abs(this._absProgress(a.lap, a.progressT) - playerAbs) -
                    Math.abs(this._absProgress(b.lap, b.progressT) - playerAbs)
                )
                .slice(0, RIVAL_RB_COUNT)
        );

        // プレイヤーより後方のAIのうち、追い上げ上位2台以外は速度を緩める
        const CHASE_TOP_COUNT = 2;
        const behindChasers = [...this.vehicles]
            .filter(v => !v.completed && !v.isCrashed
                && this._absProgress(v.lap, v.progressT) < playerAbs)
            .sort((a, b) => {
                // playerAbs に近い順（差が小さい＝上位チェイサー）
                const distA = playerAbs - this._absProgress(a.lap, a.progressT);
                const distB = playerAbs - this._absProgress(b.lap, b.progressT);
                return distA - distB;
            });
        const _chaseThrottled = new Set(behindChasers.slice(CHASE_TOP_COUNT));

        for (const ai of this.vehicles) {
            if (ai.shiftCooldownTimer > 0) {
                ai.shiftCooldownTimer = Math.max(0, ai.shiftCooldownTimer - dt);
            }
            if (ai.launchTimer > 0) {
                ai.launchTimer = Math.max(0, ai.launchTimer - dt);
            }
            if (ai.crashTimer > 0) {
                ai.isCrashed = true;
                ai.crashTimer -= dt;
                ai.speed *= Math.pow(0.9, dt * 60);
                ai.targetSpeed = 0;
                ai.isDrifting = false;
                ai.driftStrength = 0;
                ai.driftAngle *= Math.pow(0.25, dt);
                ai.crashYaw += ai.crashSpinDir * ai.crashSpinSpeed * dt;
                ai.crashSpinSpeed = Math.max(0, ai.crashSpinSpeed - 8.5 * dt);
                if (ai.crashTimer <= 0) {
                    ai.crashTimer = 0;
                    ai.isCrashed = false;
                    ai.crashSpinSpeed = 0;
                    ai.crashYaw = 0;
                }
                continue;
            }

            const postFinishCruiseSpeed = this._getPostFinishCruiseSpeed(ai, globalPostFinishCruiseSpeed);
            const isPostFinish = postFinishCruiseSpeed !== null;
            const wpInfo = isPostFinish
                ? null
                : this.waypointSystem.findNearestAhead(ai.progressT, ai.currentWaypointIndex);
            if (wpInfo) {
                ai.currentWaypointIndex = wpInfo.index;
            }
            const wp = wpInfo ? wpInfo.waypoint : null;
            if (!isPostFinish) {
                this._updateRacingLineTarget(ai, wpInfo);
            }
            if (isPostFinish) {
                ai.isDrifting = false;
                ai.driftStrength = 0;
                ai.driftAngle *= Math.pow(0.1, dt);
                ai.driftHoldTimer = 0;
            } else {
                try {
                    this._updateAIDrift(ai, wp, dt);
                } catch {
                    ai.isDrifting = false;
                    ai.driftAngle = 0;
                    ai.driftStrength = 0;
                    ai.driftHoldTimer = 0;
                }
            }
            if (introCruiseSpeed !== null) {
                ai.isDrifting = false;
                ai.driftStrength = 0;
                ai.driftAngle = 0;
                ai.driftHoldTimer = 0;
                ai.targetSpeed = THREE.MathUtils.lerp(
                    ai.targetSpeed,
                    introCruiseSpeed,
                    0.18
                );
                ai.lastWaypointSpeed = introCruiseSpeed;
                ai.lastRubberBand = 1.0;
                ai.lastDesiredSpeed = ai.targetSpeed;
            } else if (postFinishCruiseSpeed !== null) {
                // drift state already decayed in the block above (line 708-712);
                // do NOT reset driftAngle to 0 here — let the exponential decay run
                // Smooth dt-dependent damping — bypass gear/brake/accel system
                const cruiseLerp = 1 - Math.exp(-2.5 * dt);
                ai.speed = THREE.MathUtils.lerp(ai.speed, postFinishCruiseSpeed, cruiseLerp);
                ai.targetSpeed = ai.speed;
                ai.lastWaypointSpeed = postFinishCruiseSpeed;
                ai.lastRubberBand = 1.0;
                ai.lastDesiredSpeed = ai.speed;
                // Gradually return lane offset to a natural cruise position.
                // _applyCruiseAvoidance (called later) may override laneOffset
                // when the car needs to dodge the player or other AI.
                ai._cruiseNeutralLane = ai.preferredLaneBias * 1.2;
                const laneLerp = 1 - Math.exp(-1.5 * dt);
                ai.laneOffset = THREE.MathUtils.lerp(ai.laneOffset, ai._cruiseNeutralLane, laneLerp);
                ai.laneTarget = ai.laneOffset;
            } else {
                const driftPenalty = ai.isDrifting
                    ? THREE.MathUtils.lerp(1.0, this.tuning.drift.cornerSpeedPenalty, ai.driftStrength)
                    : 1.0;
                const aiAbs = this._absProgress(ai.lap, ai.progressT);
                const behindPlayer = aiAbs < playerAbs;
                const aheadPlayerMaxSpeedCap = this.playerReferenceMaxSpeed * AI_AHEAD_PLAYER_SPEED_CAP_RATIO;
                const effectiveMaxSpeed = behindPlayer
                    ? Math.min(ai.maxSpeed * 1.02, this.aiSpeedCap)
                    : Math.min(ai.maxSpeed, aheadPlayerMaxSpeedCap);
                const wpSpeed = wp ? wp.suggestedSpeed * ai.paceFactor * driftPenalty : effectiveMaxSpeed;
                // ラバーバンドはプレイヤーに近い2台のみ適用。他の車は自然なペースを維持
                const rbRaw = _rbEligible.has(ai) ? this._getRubberBandFactor(aiAbs, playerAbs) : 1.0;
                // Dampen rubber-band for slower cars so pace differences survive.
                // Fast cars (pace ~1.16) get full rubber-band; slow cars (pace ~0.78) get ~40%.
                const rbDampen = THREE.MathUtils.lerp(0.4, 1.0, THREE.MathUtils.clamp((ai.paceFactor - 0.76) / 0.42, 0, 1));
                const rb = 1.0 + (rbRaw - 1.0) * rbDampen;
                let desired = Math.min(effectiveMaxSpeed, wpSpeed * rb);
                // 後方AIのうち上位2台以外は追い上げを抑制（0.92倍）
                if (_chaseThrottled.has(ai)) {
                    desired *= 0.92;
                }
                ai.targetSpeed = THREE.MathUtils.lerp(
                    ai.targetSpeed,
                    desired,
                    this.tuning.speed.targetSmoothing
                );
                ai.lastWaypointSpeed = wpSpeed;
                ai.lastRubberBand = rb;
                ai.lastDesiredSpeed = ai.targetSpeed;
            }

            // Post-race: speed already set via smooth damping, skip gear/accel/brake
            if (!isPostFinish) {
                this._updateAITransmission(ai);
                const driveForce = this._getAIDriveForce(ai);
                if (ai.speed < ai.targetSpeed) {
                    const catchUpGap = Math.max(0, ai.targetSpeed - ai.speed);
                    const catchUpBoost = THREE.MathUtils.clamp(catchUpGap / 20, 0, 0.30);
                    const launchBoost = ai.launchTimer > 0
                        ? THREE.MathUtils.lerp(1.0, this.tuning.speed.launchAccelScale, ai.launchTimer / this.tuning.speed.launchBoostSec)
                        : 1.0;
                    ai.speed = Math.min(
                        ai.targetSpeed,
                        ai.speed + ai.accel * driveForce * (1 + catchUpBoost) * launchBoost * dt
                    );
                } else {
                    const driftBrakeScale = ai.isDrifting
                        ? THREE.MathUtils.lerp(1.0, this.tuning.drift.brakeScaleMin, ai.driftStrength)
                        : 1.0;
                    ai.speed = Math.max(ai.targetSpeed, ai.speed - (ai.brake * driftBrakeScale) * dt);
                }
            }

            const deltaT = (ai.speed * dt) / this.courseBuilder.courseLength;
            const prevT = ai.progressT;
            ai.progressT = wrap01(ai.progressT + deltaT);
            if (this._crossedStartLine(prevT, ai.progressT)) {
                if (!ai.startLinePassed) {
                    ai.startLinePassed = true;
                } else if (!ai.completed) {
                    ai.lap += 1;
                    if (ai.lap > this.totalLaps) {
                        ai.lap = this.totalLaps;
                        ai.completed = true;
                        ai.finishPosition = this._nextFinishPos++;
                        this._enterPostFinishCruise(ai, globalPostFinishCruiseSpeed);
                    }
                }
            }
        }

        const isPostRace = raceState === 'finish_celebration' || raceState === 'finished';
        if (!isPostRace) {
            this._applyLaneAvoidance();
            this._breakSideBySideFormations(dt, player);
            this._applyTrafficSpacing(dt);
            this._resolveAICollisions(player, dt);
        } else {
            this._applyCruiseAvoidance(dt, player);
        }
        this._updateTransforms(raceState);
    }

    _crossedStartLine(prevT, currT) {
        const eps = 1e-6;
        const startT = wrap01(this.startLineT);
        const p = wrap01(prevT);
        const c = wrap01(currT);
        if (p <= c) {
            return (p + eps) < startT && startT <= (c + eps);
        }
        return startT > (p + eps) || startT <= (c + eps);
    }

    /** Start-line-relative absolute progress for rubber banding. */
    _absProgress(lap, t) {
        const fromStart = ((wrap01(t) - this.startLineT) % 1 + 1) % 1;
        return (lap - 1) + fromStart;
    }

    _enterPostFinishCruise(ai, globalCruiseSpeed = null) {
        ai.postFinishCruiseSpeed = this._computePostFinishCruiseSpeed(ai, globalCruiseSpeed);
    }

    _getPostFinishCruiseSpeed(ai, globalCruiseSpeed = null) {
        if (globalCruiseSpeed == null && !ai.completed) {
            return null;
        }
        // Once the AI has its own stored cruise speed, use it — do NOT
        // recompute from the player's current speed every frame, as
        // player speed fluctuations cause AI speed oscillation.
        if (ai.completed && Number.isFinite(ai.postFinishCruiseSpeed) && ai.postFinishCruiseSpeed > 0) {
            return ai.postFinishCruiseSpeed;
        }
        if (globalCruiseSpeed != null) {
            // AI hasn't finished yet but race is in post-finish state
            // (e.g. player finished first) — compute from global speed
            const speed = this._computePostFinishCruiseSpeed(ai, globalCruiseSpeed);
            // Store it so subsequent frames use the stable value
            ai.postFinishCruiseSpeed = speed;
            return speed;
        }
        if (!Number.isFinite(ai.postFinishCruiseSpeed) || ai.postFinishCruiseSpeed <= 0) {
            this._enterPostFinishCruise(ai, null);
        }
        return ai.postFinishCruiseSpeed;
    }

    _computePostFinishCruiseSpeed(ai, globalCruiseSpeed = null) {
        const paceNorm = THREE.MathUtils.clamp((ai.paceFactor - 0.76) / 0.42, 0, 1);
        const minCruise = ai.maxSpeed * THREE.MathUtils.lerp(0.42, 0.48, paceNorm);
        const maxCruise = ai.maxSpeed * THREE.MathUtils.lerp(0.60, 0.68, paceNorm);
        if (globalCruiseSpeed != null) {
            const scaledGlobal = globalCruiseSpeed * THREE.MathUtils.lerp(0.88, 1.06, paceNorm);
            return THREE.MathUtils.clamp(scaledGlobal, minCruise, maxCruise);
        }

        const referenceSpeed = Math.max(ai.speed, ai.maxSpeed * 0.36);
        return THREE.MathUtils.clamp(referenceSpeed, minCruise, maxCruise);
    }

    /** Assign the next finish position (called by RaceManager for the player). */
    assignFinishPosition() {
        return this._nextFinishPos++;
    }

    _getRubberBandFactor(aiAbs, playerAbs) {
        const c = this.difficultyConfig;
        // positive means AI ahead; negative means AI behind
        const delta = aiAbs - playerAbs;
        if (delta < -c.rbBehindStart) {
            const t = THREE.MathUtils.clamp(
                (Math.abs(delta) - c.rbBehindStart) / c.rbBehindRange,
                0,
                1
            );
            return THREE.MathUtils.lerp(c.rbBehindNear, c.rbBehindFar, t);
        }
        if (delta > c.rbAheadStart) {
            // Grace period: don't penalize AI that are ahead during initial seconds
            const graceSec = c.rbAheadGraceSec ?? 0;
            if (graceSec > 0 && this._raceElapsed < graceSec) {
                // 二乗カーブで徐々にペナルティを適用（序盤はほぼ無効、終盤で強まる）
                const graceLinear = THREE.MathUtils.clamp(this._raceElapsed / graceSec, 0, 1);
                const graceRatio = graceLinear * graceLinear;
                const t = THREE.MathUtils.clamp(
                    (delta - c.rbAheadStart) / c.rbAheadRange,
                    0,
                    1
                );
                const fullPenalty = THREE.MathUtils.lerp(c.rbAheadNear, c.rbAheadFar, t);
                return THREE.MathUtils.lerp(1.0, fullPenalty, graceRatio);
            }
            const t = THREE.MathUtils.clamp(
                (delta - c.rbAheadStart) / c.rbAheadRange,
                0,
                1
            );
            return THREE.MathUtils.lerp(c.rbAheadNear, c.rbAheadFar, t);
        }
        return 1.0;
    }

    _getAIGearData(ai, gear = ai.currentGear) {
        const table = ai.gearTable?.length ? ai.gearTable : [{ ratio: 1.0, speedRangeKmh: [0, ai.maxSpeed * 3.6] }];
        const idx = THREE.MathUtils.clamp((gear | 0) - 1, 0, table.length - 1);
        return table[idx];
    }

    _getAIGearBoundsKmh(ai, gear = ai.currentGear) {
        const data = this._getAIGearData(ai, gear);
        if (Array.isArray(data?.speedRangeKmh) && data.speedRangeKmh.length >= 2) {
            return data.speedRangeKmh;
        }
        return [data?.min ?? 0, data?.max ?? (ai.maxSpeed * 3.6)];
    }

    _updateAITransmission(ai) {
        if (!ai.gearTable?.length || ai.shiftCooldownTimer > 0) return;
        const kmh = ai.speed * 3.6;
        const cur = this._getAIGearData(ai);
        const [minKmh, maxKmh] = this._getAIGearBoundsKmh(ai, ai.currentGear);
        const upThreshold = cur.upshiftKmh ?? (maxKmh - 6);
        const downThreshold = cur.downshiftKmh ?? Math.max(0, minKmh + 8);
        const highDemand = ai.targetSpeed > ai.speed + 8;

        if (ai.currentGear < ai.gearTable.length && kmh > upThreshold + (highDemand ? 5 : 0)) {
            ai.currentGear += 1;
            ai.shiftCooldownTimer = 0.18;
        } else if (ai.currentGear > 1 && kmh < downThreshold - (highDemand ? 4 : 0)) {
            ai.currentGear -= 1;
            ai.shiftCooldownTimer = 0.16;
        }
    }

    _getAIDriveForce(ai) {
        const gear = this._getAIGearData(ai);
        const [minKmh, maxKmh] = this._getAIGearBoundsKmh(ai, ai.currentGear);
        const span = Math.max(1, maxKmh - minKmh);
        const kmh = ai.speed * 3.6;
        const progress = (kmh - minKmh) / span;
        const gearRatio = gear?.ratio ?? gear?.accel ?? 1;
        let torqueBand = 0.92;
        if (progress < 0.28) {
            torqueBand = THREE.MathUtils.lerp(0.9, 1.16, THREE.MathUtils.clamp(progress / 0.28, 0, 1));
        } else if (progress < 0.8) {
            torqueBand = 1.14;
        } else {
            torqueBand = THREE.MathUtils.lerp(1.14, 0.84, THREE.MathUtils.clamp((progress - 0.8) / 0.32, 0, 1));
        }
        const overRev = Math.max(0, kmh - maxKmh);
        const limiter = THREE.MathUtils.clamp(1 - (overRev / 20), 0.2, 1);
        const speedFalloff = THREE.MathUtils.clamp(1 - (ai.speed / Math.max(1, ai.maxSpeed)) * 0.12, 0.84, 1);
        return gearRatio * ai.transmissionFinalRatio * torqueBand * limiter * speedFalloff;
    }

    _findClosestWaypointIndex(t, hint = -1) {
        const wps = this.waypoints;
        if (!wps.length) return 0;

        // ヒントが有効な場合は ±3 の範囲で探索（ほぼ O(1)）
        if (hint >= 0 && hint < wps.length) {
            const searchRadius = 3;
            let best = hint;
            let bestD = Infinity;
            for (let offset = -searchRadius; offset <= searchRadius; offset++) {
                const idx = ((hint + offset) % wps.length + wps.length) % wps.length;
                const d = Math.abs(wps[idx].t - t);
                const dist = Math.min(d, 1 - d);
                if (dist < bestD) {
                    bestD = dist;
                    best = idx;
                }
            }
            // ヒントが大きくずれていなければ近傍結果を返す
            if (bestD < 0.05) return best;
        }

        // フォールバック: フル探索
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < wps.length; i++) {
            const d = Math.abs(wps[i].t - t);
            const dist = Math.min(d, 1 - d);
            if (dist < bestD) {
                best = i;
                bestD = dist;
            }
        }
        return best;
    }

    _updateAIDrift(ai, waypoint, dt) {
        const td = this.tuning.drift;
        if (!waypoint || this.waypoints.length < 2) {
            ai.isDrifting = false;
            ai.driftStrength = Math.max(0, ai.driftStrength - td.strengthLerpOut * (dt * 60));
            ai.driftAngle *= Math.pow(0.3, dt);
            ai.driftHoldTimer = 0;
            return;
        }

        const aggression = ai.aggression ?? 0.5;
        const stability = ai.stability ?? 0.5;
        const enterThreshold = THREE.MathUtils.lerp(td.curvatureEnter + 0.03, td.curvatureEnter - 0.025, aggression);
        const exitThreshold = THREE.MathUtils.lerp(td.curvatureExit + 0.02, td.curvatureExit - 0.015, stability);
        const minSpeedRatio = THREE.MathUtils.lerp(td.minSpeedRatio + 0.04, td.minSpeedRatio - 0.02, aggression);
        const speedOk = ai.speed > ai.maxSpeed * minSpeedRatio;
        const curve = waypoint.curvature ?? 0;
        const wantEnter = speedOk && curve >= enterThreshold;
        if (wantEnter) {
            ai.isDrifting = true;
            ai.driftHoldTimer = td.holdSec;
        } else if (ai.isDrifting) {
            ai.driftHoldTimer = Math.max(0, ai.driftHoldTimer - dt);
            // 曲率回復 OR 速度低下 でドリフト終了（ホールドタイマーは曲率回復時のみ必要）
            const tooSlow = ai.speed < ai.maxSpeed * (minSpeedRatio * 0.85);
            if (tooSlow || (curve <= exitThreshold && ai.driftHoldTimer <= 0)) {
                ai.isDrifting = false;
            }
        }

        const nextWp = this.waypoints[(ai.currentWaypointIndex + 1) % this.waypoints.length];
        let turnSign = 0;
        if (nextWp && waypoint?.forward && nextWp?.forward) {
            const c = new THREE.Vector3().crossVectors(waypoint.forward, nextWp.forward);
            turnSign = Math.sign(c.y);
        }

        const curveN = THREE.MathUtils.clamp((curve - exitThreshold) / 0.45, 0, 1);
        const targetStrength = ai.isDrifting ? curveN : 0;
        const strengthLerp = ai.isDrifting ? td.strengthLerpIn : td.strengthLerpOut;
        ai.driftStrength = THREE.MathUtils.lerp(
            ai.driftStrength,
            targetStrength,
            strengthLerp * (dt * 60)
        );

        const driftAngleScale = THREE.MathUtils.lerp(0.7, 1.08, aggression) * THREE.MathUtils.lerp(1.05, 0.88, stability);
        const targetAngle = ai.isDrifting ? (turnSign * td.maxAngle * ai.driftStrength * driftAngleScale) : 0;
        ai.driftAngle = THREE.MathUtils.lerp(ai.driftAngle, targetAngle, 0.16 * (dt * 60));
        if (!Number.isFinite(ai.driftAngle)) ai.driftAngle = 0;
        if (!Number.isFinite(ai.driftStrength)) ai.driftStrength = 0;
        if (!ai.isDrifting && Math.abs(ai.driftAngle) < 1e-3) ai.driftAngle = 0;
    }

    _updateRacingLineTarget(ai, wpInfo) {
        const tc = this.tuning.lane;
        const N = this.courseBuilder.sampledPoints.length;
        if (!N || !this.waypoints.length || !wpInfo?.waypoint) {
            ai.racingLineTarget = 0;
            return;
        }

        const wp = wpInfo.waypoint;
        const sampleIdx = Math.floor(ai.progressT * N) % N;
        const sp = this.courseBuilder.sampledPoints[sampleIdx];
        const laneLimit = Math.max(0.8, (sp.width * 0.5) - tc.wallMargin);
        const preferredLane = THREE.MathUtils.clamp(
            laneLimit * ai.preferredLaneBias * 0.55,
            -laneLimit * 0.9,
            laneLimit * 0.9
        );
        const cruiseLane = THREE.MathUtils.lerp(preferredLane, 0, ai.linePrecision ?? 0.5);

        let signedCurve = 0;
        let weightSum = 0;
        const lookAheadCount = Math.max(1, tc.racingLineLookAhead);
        for (let i = 0; i < lookAheadCount; i++) {
            const a = this.waypoints[(wpInfo.index + i) % this.waypoints.length];
            const b = this.waypoints[(wpInfo.index + i + 1) % this.waypoints.length];
            if (!a?.forward || !b?.forward) continue;
            const cross = new THREE.Vector3().crossVectors(a.forward, b.forward);
            const turnSign = Math.sign(cross.y);
            const curvature = Math.max(a.curvature ?? 0, b.curvature ?? 0);
            const weight = 1 + i * 0.45;
            signedCurve += turnSign * curvature * weight;
            weightSum += weight;
        }

        if (weightSum <= 0) {
            ai.racingLineTarget = cruiseLane;
            return;
        }

        const avgSignedCurve = signedCurve / weightSum;
        const turnSign = Math.sign(avgSignedCurve);
        const lineStrength = THREE.MathUtils.clamp(
            Math.abs(avgSignedCurve) / tc.racingLineCurveRef,
            0,
            1
        );

        if (turnSign === 0 || lineStrength < 0.08) {
            ai.racingLineTarget = cruiseLane;
            return;
        }

        let ratio = 0;
        if (wpInfo.deltaT > tc.racingLineApproachT) {
            ratio = -turnSign * tc.racingLineOuterRatio;
        } else if (wpInfo.deltaT > tc.racingLineApexT) {
            ratio = turnSign * tc.racingLineInnerRatio;
        } else {
            ratio = -turnSign * tc.racingLineExitRatio;
        }

        const idealLine = THREE.MathUtils.clamp(
            laneLimit * ratio * lineStrength,
            -laneLimit,
            laneLimit
        );
        ai.racingLineTarget = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(cruiseLane, idealLine, ai.linePrecision ?? 0.5),
            -laneLimit,
            laneLimit
        );
    }

    _applyLaneAvoidance() {
        const N = this.courseBuilder.sampledPoints.length;
        const tc = this.tuning.lane;

        for (let i = 0; i < this.vehicles.length; i++) {
            const a = this.vehicles[i];
            if (a.completed) continue;
            const sampleIdx = Math.floor(a.progressT * N) % N;
            const sp = this.courseBuilder.sampledPoints[sampleIdx];
            const laneLimit = Math.max(0.8, (sp.width * 0.5) - tc.wallMargin); // keep car body inside road edges
            const baseTarget = THREE.MathUtils.clamp(a.racingLineTarget ?? 0, -laneLimit, laneLimit);
            const returnBlend = THREE.MathUtils.lerp(tc.returnToCenter * 0.6, tc.returnToCenter * 1.3, a.linePrecision ?? 0.5);
            let desired = THREE.MathUtils.lerp(a.laneTarget, baseTarget, returnBlend);
            let bestAhead = null;
            let bestAheadDelta = Infinity;
            let bestAheadRelSpeed = 0;
            let hasSideBySide = false;

            for (let j = 0; j < this.vehicles.length; j++) {
                if (i === j) continue;
                const b = this.vehicles[j];
                if (b.completed) continue;
                const d = Math.abs(a.progressT - b.progressT);
                const closeT = Math.min(d, 1 - d);
                const closeLane = Math.abs(a.laneOffset - b.laneOffset);
                const aheadDelta = wrap01(b.progressT - a.progressT);

                if (closeT < tc.avoidCloseT && closeLane < tc.avoidCloseLane) {
                    // Stronger nudge when very close, proportional to overlap
                    const proximity = 1 - (closeT / tc.avoidCloseT);
                    const laneProximity = 1 - (closeLane / tc.avoidCloseLane);
                    const side = this._getAvoidanceSide(a, b);
                    // 横並び（closeT が非常に小さい）のとき横押しを強化
                    const isSideBySide = closeT < (this.tuning.collision.sideBySideProgressT ?? 0.0035);
                    if (isSideBySide) hasSideBySide = true;
                    const sideBySideBoost = isSideBySide ? (this.tuning.collision.sideBySideAvoidBoost ?? 1.15) : 1.0;
                    const nudgeStrength = tc.avoidNudge
                        * (0.5 + 0.5 * proximity)
                        * laneProximity
                        * THREE.MathUtils.lerp(0.7, 1.25, a.packAvoidance ?? 0.5)
                        * this._getAvoidancePreferenceScale(a, side)
                        * sideBySideBoost;
                    desired += side * nudgeStrength;
                }

                if (closeT < tc.crowdLookAheadT && closeLane < tc.crowdLaneInfluence) {
                    const proximity = 1 - (closeT / tc.crowdLookAheadT);
                    const laneProximity = 1 - (closeLane / tc.crowdLaneInfluence);
                    const side = this._getAvoidanceSide(a, b);
                    desired += side
                        * tc.crowdNudge
                        * proximity
                        * laneProximity
                        * THREE.MathUtils.lerp(0.45, 1.1, a.packAvoidance ?? 0.5)
                        * this._getAvoidancePreferenceScale(a, side);
                }
                if (aheadDelta > 1e-4
                    && aheadDelta < tc.overtakeLookAheadT
                    && closeLane < tc.overtakeLaneThreat
                    && aheadDelta < bestAheadDelta) {
                    bestAhead = b;
                    bestAheadDelta = aheadDelta;
                    bestAheadRelSpeed = Math.max(0, a.speed - b.speed);
                }
            }

            if (bestAhead) {
                const leftCandidate = THREE.MathUtils.clamp(
                    bestAhead.laneOffset - tc.overtakeSideOffset,
                    -laneLimit,
                    laneLimit
                );
                const rightCandidate = THREE.MathUtils.clamp(
                    bestAhead.laneOffset + tc.overtakeSideOffset,
                    -laneLimit,
                    laneLimit
                );
                const leftScore = this._scoreOvertakeLane(a, leftCandidate, laneLimit, tc);
                const rightScore = this._scoreOvertakeLane(a, rightCandidate, laneLimit, tc);
                const targetLane = leftScore >= rightScore ? leftCandidate : rightCandidate;
                // 相対速度 + 距離近接度の両方でコミット強化
                const urgency = THREE.MathUtils.clamp(bestAheadRelSpeed / 12, 0, 1);
                const proximityUrgency = THREE.MathUtils.clamp(1.0 - bestAheadDelta / tc.overtakeLookAheadT, 0, 1);
                const combinedUrgency = Math.max(urgency, proximityUrgency * 0.7);
                const baseCommit = THREE.MathUtils.lerp(tc.overtakeCommit * 0.60, tc.overtakeCommit * 1.12, a.aggression ?? 0.5);
                const commit = Math.min(baseCommit * THREE.MathUtils.lerp(1.0, 1.5, combinedUrgency), 0.95);
                desired = THREE.MathUtils.lerp(desired, targetLane, commit);
            }

            a.laneTarget = THREE.MathUtils.clamp(desired, -laneLimit, laneLimit);
            // 前方車との相対速度・横並び状態に応じて車線移動速度を上げる
            const laneUrgency = THREE.MathUtils.clamp(bestAheadRelSpeed / 12, 0, 1);
            const sideBySideLerpBoost = hasSideBySide ? 1.8 : 1.0;
            const effectiveLerp = Math.min(
                THREE.MathUtils.lerp(tc.offsetLerp, Math.min(tc.offsetLerp * 2.5, 0.30), laneUrgency) * sideBySideLerpBoost,
                0.40
            );
            a.laneOffset = THREE.MathUtils.lerp(a.laneOffset, a.laneTarget, effectiveLerp);
        }
    }

    _getAvoidanceSide(ai, other) {
        const laneDelta = ai.laneOffset - other.laneOffset;
        if (Math.abs(laneDelta) > 0.12) {
            return Math.sign(laneDelta);
        }
        return ai.id < other.id ? -1 : 1;
    }

    _getAvoidancePreferenceScale(ai, direction) {
        const lanePreference = Math.sign(ai.preferredLaneBias);
        const preferredSide = lanePreference || ai.preferredOvertakeSide || 1;
        return direction === preferredSide
            ? THREE.MathUtils.lerp(1.0, 1.16, ai.packAvoidance ?? 0.5)
            : THREE.MathUtils.lerp(0.84, 1.0, ai.packAvoidance ?? 0.5);
    }

    _scoreOvertakeLane(ai, candidateLane, laneLimit, tc) {
        let nearestPenalty = 0;
        for (const other of this.vehicles) {
            if (other === ai) continue;
            if (other.completed) continue;
            const aheadDelta = wrap01(other.progressT - ai.progressT);
            const closeAhead = aheadDelta < tc.overtakeLookAheadT * 1.35 || aheadDelta > 0.985;
            if (!closeAhead) continue;

            const laneGap = Math.abs(candidateLane - other.laneOffset);
            if (laneGap < tc.overtakeLaneThreat) {
                nearestPenalty += (tc.overtakeLaneThreat - laneGap);
            }
        }

        const edgePenalty = Math.max(0, Math.abs(candidateLane) - laneLimit * 0.72);
        const currentBias = -Math.abs(candidateLane - ai.laneOffset) * tc.overtakeCurrentBias;
        const candidateSide = Math.sign(candidateLane - ai.laneOffset) || ai.preferredOvertakeSide;
        const sideBias = candidateSide === ai.preferredOvertakeSide
            ? THREE.MathUtils.lerp(0.08, 0.7, ai.aggression ?? 0.5)
            : -0.12;
        const preferredLaneBias = -Math.abs(candidateLane - (laneLimit * ai.preferredLaneBias * 0.45)) * 0.05;
        return -nearestPenalty - edgePenalty + currentBias + sideBias + preferredLaneBias;
    }

    /**
     * 3台以上（自車含む）が横並び状態のとき、packAvoidance が最も高いAI 1台の
     * 速度を落として横並びフォーメーションを自然に解消する。
     */
    _breakSideBySideFormations(dt, player) {
        // 横並び判定: 車の全長(~3.5m) × 2 の範囲をコース進行率に変換
        const carLength = 3.5;
        const sideBySideT = (carLength * 2) / Math.max(1, this.courseBuilder.courseLength);
        const sideBySideLane = this.tuning.collision.sideBySideLongitudinalDist ?? 2.0;
        const active = this.vehicles.filter(v => !v.completed && !v.isCrashed);
        if (active.length < 2) return;

        // プレイヤーを横並び判定の候補に含める（統一フォーマット）
        const candidates = active.map(v => ({
            progressT: v.progressT,
            laneOffset: v.laneOffset,
            ai: v,
            isPlayer: false,
        }));
        if (player && player.position) {
            // プレイヤーの横位置をトラックフレームから算出
            const playerT = wrap01(player.trackT ?? 0);
            const frame = this._sampleTrackFrame(playerT);
            const toPlayer = new THREE.Vector3().subVectors(player.position, frame.position);
            const playerLaneOffset = toPlayer.dot(frame.right);
            candidates.push({
                progressT: playerT,
                laneOffset: playerLaneOffset,
                ai: null,
                isPlayer: true,
            });
        }
        if (candidates.length < 3) return;

        // progressT が近い車をグループ化
        const sorted = [...candidates].sort((a, b) => a.progressT - b.progressT);
        const visited = new Set();

        for (let i = 0; i < sorted.length; i++) {
            if (visited.has(i)) continue;
            const group = [sorted[i]];
            visited.add(i);

            for (let j = i + 1; j < sorted.length; j++) {
                if (visited.has(j)) continue;
                // グループ内の全メンバーと横並び判定
                const isAligned = group.some(member => {
                    const dProg = Math.abs(member.progressT - sorted[j].progressT);
                    const closeT = Math.min(dProg, 1 - dProg);
                    const closeLane = Math.abs(member.laneOffset - sorted[j].laneOffset);
                    return closeT < sideBySideT && closeLane > sideBySideLane * 0.3;
                });
                if (isAligned) {
                    group.push(sorted[j]);
                    visited.add(j);
                }
            }

            // 3台以上横並び（自車含む）なら AI の中で packAvoidance が最も高い1台を減速
            if (group.length >= 3) {
                const aiInGroup = group.filter(c => !c.isPlayer);
                if (aiInGroup.length === 0) continue;
                const retreater = aiInGroup.reduce((best, cur) =>
                    (cur.ai.packAvoidance ?? 0.5) > (best.ai.packAvoidance ?? 0.5) ? cur : best
                );
                // 速度を徐々に落として後退させる（0.92倍に収束）
                const brakeFactor = 1 - 0.08 * THREE.MathUtils.clamp(dt * 4, 0, 1);
                retreater.ai.targetSpeed *= brakeFactor;
                retreater.ai.speed = Math.min(retreater.ai.speed, retreater.ai.targetSpeed);
            }
        }
    }

    _applyTrafficSpacing(dt) {
        for (const ai of this.vehicles) {
            if (ai.completed) continue;
            const aggression = ai.aggression ?? 0.5;
            const spacingBias = ai.spacingBias ?? 0.5;
            const followLookAheadT = THREE.MathUtils.lerp(0.008, 0.014, spacingBias);
            // 緊急ブレーキを従来の約3倍の距離（15〜30m相当）で発動させる
            const criticalLookAheadT = THREE.MathUtils.lerp(0.007, 0.012, spacingBias);
            const laneThreatFull = THREE.MathUtils.lerp(1.2, 1.8, spacingBias);
            const laneThreatPartial = THREE.MathUtils.lerp(2.2, 3.0, spacingBias);
            let nearestAhead = null;
            let nearestAheadDelta = Infinity;
            let nearestLaneGap = 0;

            for (const other of this.vehicles) {
                if (other === ai) continue;
                if (other.completed) continue;
                const aheadDelta = wrap01(other.progressT - ai.progressT);
                if (aheadDelta <= 1e-4 || aheadDelta >= followLookAheadT) continue;

                const laneGap = Math.abs(ai.laneOffset - other.laneOffset);
                if (laneGap >= laneThreatPartial) continue;

                if (aheadDelta < nearestAheadDelta) {
                    nearestAhead = other;
                    nearestAheadDelta = aheadDelta;
                    nearestLaneGap = laneGap;
                }
            }

            if (!nearestAhead) continue;

            // Scale braking by how much lanes overlap — wide gap = barely slow down
            const laneOverlap = nearestLaneGap < laneThreatFull
                ? 1.0
                : 1.0 - THREE.MathUtils.clamp(
                    (nearestLaneGap - laneThreatFull) / (laneThreatPartial - laneThreatFull), 0, 1);

            if (laneOverlap < 0.05) continue; // lanes are far enough apart, no braking needed

            const closeN = 1 - THREE.MathUtils.clamp(nearestAheadDelta / followLookAheadT, 0, 1);
            const relativeSpeed = Math.max(0, ai.speed - nearestAhead.speed);
            // spacingBias で追従応答を大きく個性化
            // 高 spacingBias（車間保持型）: 早めに減速して安全な車間を維持
            // 低 spacingBias（接近走行型）: ギリギリまで減速しない攻撃的な走行
            const baseResponse = THREE.MathUtils.lerp(
                this.tuning.speed.followResponse * 0.35,
                this.tuning.speed.followResponse * 1.2,
                spacingBias
            );
            const aggressionScale = THREE.MathUtils.lerp(0.82, 1.08, aggression);
            const response = THREE.MathUtils.lerp(baseResponse * 0.82, baseResponse, closeN)
                * aggressionScale
                * laneOverlap;
            ai.targetSpeed = Math.min(
                ai.targetSpeed,
                nearestAhead.speed + Math.max(0, 6 - relativeSpeed) * response
            );

            // ソフトブレーキゾーン: 相対速度が高く接近中は targetSpeed だけでなく実速度も直接削る
            if (relativeSpeed > 2 && laneOverlap > 0.3) {
                const softBrake = relativeSpeed * 0.06 * closeN * laneOverlap * (dt * 60);
                ai.speed = Math.max(nearestAhead.speed, ai.speed - softBrake);
            }

            // 緊急ブレーキ: より早く・より強く・近づくほど強度増加
            if (nearestAheadDelta < criticalLookAheadT && nearestLaneGap < laneThreatFull) {
                const dangerN = 1 - THREE.MathUtils.clamp(nearestAheadDelta / criticalLookAheadT, 0, 1);
                const emergencyBrake = THREE.MathUtils.lerp(0.32, 0.60, spacingBias)
                    * THREE.MathUtils.lerp(1.0, 0.80, aggression)
                    * THREE.MathUtils.lerp(0.5, 1.5, dangerN);
                ai.speed = Math.max(nearestAhead.speed * 0.90, ai.speed - relativeSpeed * emergencyBrake);
            }
        }
    }

    /**
     * 巡航モード（ポストレース）用の間隔制御とプレイヤー回避。
     * レース中の複雑なロジックと異なり、穏やかな速度・車線調整のみ行う。
     */
    _applyCruiseAvoidance(dt, player) {
        const N = this.courseBuilder.sampledPoints.length;
        const tc = this.tuning.collision;
        const cruiseSpacingT = 0.012;     // AI同士の前方監視距離（トラック進行率）
        const cruiseLaneThreat = 2.8;     // 車線が脅威とみなされる幅
        const playerDetectT = 0.018;      // プレイヤー検知距離
        const playerLaneThreat = 3.5;     // プレイヤーに対する車線脅威幅
        const playerAvoidLaneShift = 2.2; // プレイヤー回避時の車線移動量
        const playerSlowFactor = 0.92;    // プレイヤー接近時の減速率

        // プレイヤーのトラック位置
        const playerT = player ? (player.trackT ?? 0) : 0;
        // プレイヤーの車線オフセット推定（中央基準: 0）
        const playerLaneEstimate = 0;

        for (const ai of this.vehicles) {
            if (ai.crashTimer > 0) continue;

            const sampleIdx = Math.floor(wrap01(ai.progressT) * N) % N;
            const sp = this.courseBuilder.sampledPoints[sampleIdx];
            const laneLimit = Math.max(0.8, (sp.width * 0.5) - this.tuning.lane.wallMargin);

            // ── AI同士の間隔制御 ──
            let nearestAheadAI = null;
            let nearestAheadDelta = Infinity;

            for (const other of this.vehicles) {
                if (other === ai || other.crashTimer > 0) continue;
                const aheadDelta = wrap01(other.progressT - ai.progressT);
                if (aheadDelta <= 1e-4 || aheadDelta >= cruiseSpacingT) continue;
                const laneGap = Math.abs(ai.laneOffset - other.laneOffset);
                if (laneGap >= cruiseLaneThreat) continue;
                if (aheadDelta < nearestAheadDelta) {
                    nearestAheadAI = other;
                    nearestAheadDelta = aheadDelta;
                }
            }

            if (nearestAheadAI) {
                // 前方AIに追いつきそうなら穏やかに減速
                const relSpeed = ai.speed - nearestAheadAI.speed;
                if (relSpeed > 0) {
                    const closeN = 1 - THREE.MathUtils.clamp(nearestAheadDelta / cruiseSpacingT, 0, 1);
                    const brake = relSpeed * 0.08 * closeN * (dt * 60);
                    ai.speed = Math.max(nearestAheadAI.speed, ai.speed - brake);
                }
                // 車線分離: 近い側と逆方向へ穏やかに移動
                const laneDelta = ai.laneOffset - nearestAheadAI.laneOffset;
                const side = Math.abs(laneDelta) > 0.1 ? Math.sign(laneDelta) : (ai.id % 2 === 0 ? 1 : -1);
                const separateTarget = THREE.MathUtils.clamp(
                    nearestAheadAI.laneOffset + side * 2.0,
                    -laneLimit, laneLimit
                );
                const sepLerp = 1 - Math.exp(-1.0 * dt);
                ai.laneOffset = THREE.MathUtils.lerp(ai.laneOffset, separateTarget, sepLerp);
                ai.laneTarget = ai.laneOffset;
            }

            // ── プレイヤー回避 ──
            if (!player) continue;

            const aheadOfPlayer = wrap01(ai.progressT - playerT);
            const behindPlayer = wrap01(playerT - ai.progressT);
            const distToPlayer = Math.min(aheadOfPlayer, behindPlayer);

            if (distToPlayer >= playerDetectT) continue;

            const laneGapToPlayer = Math.abs(ai.laneOffset - playerLaneEstimate);
            if (laneGapToPlayer >= playerLaneThreat) continue;

            // プレイヤーの近くにいる → 車線を変えて回避
            const laneDir = ai.laneOffset >= playerLaneEstimate ? 1 : -1;
            const avoidTarget = THREE.MathUtils.clamp(
                playerLaneEstimate + laneDir * playerAvoidLaneShift,
                -laneLimit, laneLimit
            );
            const avoidLerp = 1 - Math.exp(-2.0 * dt);
            ai.laneOffset = THREE.MathUtils.lerp(ai.laneOffset, avoidTarget, avoidLerp);
            ai.laneTarget = ai.laneOffset;

            // AIがプレイヤーのすぐ前にいる場合は少し加速して離れる
            if (aheadOfPlayer < behindPlayer && aheadOfPlayer < 0.006) {
                const boostLerp = 1 - Math.exp(-1.5 * dt);
                const boostedSpeed = (ai.postFinishCruiseSpeed || ai.speed) * 1.08;
                ai.speed = THREE.MathUtils.lerp(ai.speed, boostedSpeed, boostLerp);
            }
            // AIがプレイヤーのすぐ後ろにいて追いつきそうなら減速
            else if (behindPlayer < aheadOfPlayer && behindPlayer < 0.008 && ai.speed > player.speed) {
                ai.speed *= THREE.MathUtils.lerp(1.0, playerSlowFactor, (dt * 60) * 0.5);
            }
        }
    }

    _getAIPose(ai) {
        const frame = this._sampleTrackFrame(ai.progressT);
        const N = this.courseBuilder.sampledPoints.length;
        const sampleIdx = Math.floor(wrap01(ai.progressT) * N) % N;
        const sp = this.courseBuilder.sampledPoints[sampleIdx];
        const laneLimit = Math.max(0.8, (sp.width * 0.5) - this.tuning.lane.wallMargin);
        const laneOffset = THREE.MathUtils.clamp(ai.laneOffset, -laneLimit, laneLimit);
        const position = frame.position.clone().addScaledVector(frame.right, laneOffset);
        position.addScaledVector(frame.up, ROAD_SURFACE_OFFSET);
        return { position, frame, laneLimit };
    }

    _updateTransforms(raceState = 'idle') {
        this.vehicles.forEach((ai, idx) => {
            const pose = this._getAIPose(ai);
            const frame = pose.frame;
            const pos = pose.position.clone();
            let y = 0;
            if (raceState === 'grid_intro') {
                y += Math.sin(this._introAnimTime * 6 + idx * 0.7) * 0.015;
            }
            pos.y += y;

            ai.position.copy(pos);
            ai.forward.copy(frame.forward);
            ai.up.copy(frame.up);

            this._dummy.position.copy(pos);
            this._dummy.up.copy(frame.up);
            this._dummy.lookAt(pos.clone().add(frame.forward));
            if (ai.isCrashed || ai.crashTimer > 0) {
                this._dummy.rotateY(ai.crashYaw);
            }
            if (Number.isFinite(ai.driftAngle) && (ai.isDrifting || Math.abs(ai.driftAngle) > 1e-3)) {
                this._dummy.rotateY(ai.driftAngle * 0.7);
            }
            this._dummy.updateMatrix();
            for (const layer of this._instanceLayers) {
                layer.setMatrixAt(idx, this._dummy.matrix);
            }
        });

        for (const layer of this._instanceLayers) {
            layer.instanceMatrix.needsUpdate = true;
        }
    }

    _sampleTrackFrame(progressT) {
        const sampled = this.courseBuilder.sampledPoints;
        const N = sampled.length;
        if (!N) {
            return {
                position: new THREE.Vector3(),
                forward: new THREE.Vector3(0, 0, 1),
                right: new THREE.Vector3(1, 0, 0),
                up: new THREE.Vector3(0, 1, 0),
            };
        }

        const raw = wrap01(progressT) * N;
        const i0 = Math.floor(raw) % N;
        const i1 = (i0 + 1) % N;
        const a = raw - Math.floor(raw);
        const sp0 = sampled[i0];
        const sp1 = sampled[i1];

        const position = sp0.position.clone().lerp(sp1.position, a);
        const forward = sp0.forward.clone().lerp(sp1.forward, a).normalize();
        const rightLerp = sp0.right.clone().lerp(sp1.right, a).normalize();
        const upLerp = sp0.up.clone().lerp(sp1.up, a).normalize();

        // Re-orthonormalize to avoid tiny basis drift from interpolation.
        const up = new THREE.Vector3().crossVectors(rightLerp, forward).normalize();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();

        if (up.lengthSq() < 1e-6 || right.lengthSq() < 1e-6) {
            return {
                position,
                forward,
                right: rightLerp,
                up: upLerp,
            };
        }

        return { position, forward, right, up };
    }

    _resolveAICollisions(player, dt) {
        // AI <-> AI (simple circle overlap resolution)
        const tc = this.tuning.collision;
        const minDist = tc.minDist;
        const N = this.courseBuilder.sampledPoints.length;
        for (let i = 0; i < this.vehicles.length; i++) {
            const a = this.vehicles[i];
            if (a.completed) continue;
            const aPose = this._getAIPose(a);
            for (let j = i + 1; j < this.vehicles.length; j++) {
                const b = this.vehicles[j];
                if (b.completed) continue;
                const bPose = this._getAIPose(b);
                const dx = bPose.position.x - aPose.position.x;
                const dz = bPose.position.z - aPose.position.z;
                const d2 = dx * dx + dz * dz;
                if (d2 <= 1e-6 || d2 >= minDist * minDist) continue;

                const d = Math.sqrt(d2);
                const overlap = minDist - d;
                const nx = dx / d;
                const nz = dz / d;
                const aheadAB = wrap01(b.progressT - a.progressT);
                const aheadBA = wrap01(a.progressT - b.progressT);
                const relative = new THREE.Vector3(dx, 0, dz);
                const avgForward = aPose.frame.forward.clone().add(bPose.frame.forward).setY(0);
                if (avgForward.lengthSq() < 1e-6) {
                    avgForward.set(-nz, 0, nx);
                } else {
                    avgForward.normalize();
                }
                const avgRight = aPose.frame.right.clone().add(bPose.frame.right).setY(0);
                if (avgRight.lengthSq() < 1e-6) {
                    avgRight.set(nx, 0, nz);
                } else {
                    avgRight.normalize();
                }

                // 横並び判定: トラック進行方向の差が車体1台分以内なら横並びとみなす
                const sideDelta = Math.min(aheadAB, aheadBA);
                const longitudinalGap = Math.abs(relative.dot(avgForward));
                const isSideBySide = sideDelta < (tc.sideBySideProgressT ?? 0.0035)
                    || longitudinalGap < (tc.sideBySideLongitudinalDist ?? 1.35);

                const lateralSign = Math.sign(relative.dot(avgRight)) || Math.sign(nx || 1) || 1;
                const lanePush = overlap * tc.aiAiPush * (isSideBySide ? (tc.sideBySidePushScale ?? 0.82) : 1.0);
                const laneOffsetScale = isSideBySide ? (tc.sideBySideLaneOffsetScale ?? 0.42) : 1.0;
                const laneTargetScale = tc.aiAiTargetScale * (isSideBySide ? (tc.sideBySideLaneTargetScale ?? 1.2) : 1.0);
                const aLanePush = -lateralSign * lanePush;
                const bLanePush = lateralSign * lanePush;
                a.laneOffset += aLanePush * laneOffsetScale;
                b.laneOffset += bLanePush * laneOffsetScale;
                a.laneTarget += aLanePush * laneTargetScale;
                b.laneTarget += bLanePush * laneTargetScale;

                const aSp = this.courseBuilder.sampledPoints[Math.floor(a.progressT * N) % N];
                const bSp = this.courseBuilder.sampledPoints[Math.floor(b.progressT * N) % N];
                const aLimit = Math.max(0.8, (aSp.width * 0.5) - this.tuning.lane.wallMargin);
                const bLimit = Math.max(0.8, (bSp.width * 0.5) - this.tuning.lane.wallMargin);
                a.laneOffset = THREE.MathUtils.clamp(a.laneOffset, -aLimit, aLimit);
                b.laneOffset = THREE.MathUtils.clamp(b.laneOffset, -bLimit, bLimit);
                a.laneTarget = THREE.MathUtils.clamp(a.laneTarget, -aLimit, aLimit);
                b.laneTarget = THREE.MathUtils.clamp(b.laneTarget, -bLimit, bLimit);

                if (isSideBySide) {
                    // 横並び: 速度ロスなし。横への分離のみ行う
                } else {
                    // 追突: 後ろの車の速度だけを抑制（前の車は巻き込まない）
                    const rear = aheadAB < aheadBA ? a : b;
                    const front = aheadAB < aheadBA ? b : a;
                    rear.speed = Math.min(rear.speed, front.speed * tc.overlapSpeedCut);
                    // dt スケールで速度ロスを適用（フレームレートに依存しない）
                    // 最低速度を前方車の85%に制限して連鎖衝突での過剰減速を防止
                    const loss = Math.pow(tc.aiAiSpeedLoss, dt * 60);
                    const minCollisionSpeed = front.speed * 0.85;
                    a.speed = Math.max(minCollisionSpeed, a.speed * loss);
                    b.speed = Math.max(minCollisionSpeed, b.speed * loss);

                    // 後方車が左右の空いている方へ回避する
                    const tl = this.tuning.lane;
                    const rearLimit = rear === a ? aLimit : bLimit;
                    const leftCandidate = THREE.MathUtils.clamp(
                        front.laneOffset - tl.overtakeSideOffset,
                        -rearLimit, rearLimit
                    );
                    const rightCandidate = THREE.MathUtils.clamp(
                        front.laneOffset + tl.overtakeSideOffset,
                        -rearLimit, rearLimit
                    );
                    const leftScore = this._scoreOvertakeLane(rear, leftCandidate, rearLimit, tl);
                    const rightScore = this._scoreOvertakeLane(rear, rightCandidate, rearLimit, tl);
                    const avoidTarget = leftScore >= rightScore ? leftCandidate : rightCandidate;
                    rear.laneTarget = THREE.MathUtils.lerp(rear.laneTarget, avoidTarget, 0.7);
                    rear.laneTarget = THREE.MathUtils.clamp(rear.laneTarget, -rearLimit, rearLimit);
                }
            }
        }

        // AI <-> Player (lightweight bump, no full rigid-body physics)
        if (player && !(player.collisionImmunityTimer > 0)) {
            const minPlayerDist = tc.minPlayerDist;
            const playerForward = new THREE.Vector3(Math.sin(player.rotation), 0, Math.cos(player.rotation)).normalize();
            for (const ai of this.vehicles) {
                if (ai.completed) continue;
                if (ai.isCrashed || ai.crashTimer > 0) continue;
                const aiPose = this._getAIPose(ai);
                const dx = aiPose.position.x - player.position.x;
                const dz = aiPose.position.z - player.position.z;
                const d2 = dx * dx + dz * dz;
                if (d2 <= 1e-6 || d2 >= minPlayerDist * minPlayerDist) continue;

                const d = Math.sqrt(d2);
                const overlap = minPlayerDist - d;
                const nx = dx / d;
                const nz = dz / d;
                const relative = new THREE.Vector3(dx, 0, dz);
                const playerRight = (player.surfaceRight?.clone?.() || new THREE.Vector3(1, 0, 0))
                    .projectOnPlane(player.surfaceUp || new THREE.Vector3(0, 1, 0));
                if (playerRight.lengthSq() < 1e-6) {
                    playerRight.set(Math.cos(player.rotation), 0, -Math.sin(player.rotation));
                } else {
                    playerRight.normalize();
                }
                const playerLongitudinalGap = Math.abs(relative.dot(playerForward));
                const lateralSign = Math.sign(relative.dot(playerRight)) || Math.sign(nx || 1) || 1;

                const isSideSwipe = playerLongitudinalGap < (tc.sideSwipeLongitudinalDist ?? 1.45);
                const aiLanePush = lateralSign * overlap * tc.aiPlayerPush
                    * (isSideSwipe ? (tc.sideSwipeAiLanePushScale ?? 0.72) : 1.0);
                ai.laneOffset += aiLanePush;
                ai.laneTarget += aiLanePush * tc.aiPlayerTargetScale;
                const aiSp = this.courseBuilder.sampledPoints[Math.floor(ai.progressT * N) % N];
                const aiLimit = Math.max(0.8, (aiSp.width * 0.5) - this.tuning.lane.wallMargin);
                ai.laneOffset = THREE.MathUtils.clamp(ai.laneOffset, -aiLimit, aiLimit);
                ai.laneTarget = THREE.MathUtils.clamp(ai.laneTarget, -aiLimit, aiLimit);

                const toAIFromPlayer = new THREE.Vector3(dx, 0, dz).normalize();
                const rearDot = toAIFromPlayer.dot(playerForward);
                const speedDelta = ai.speed - player.speed;
                const isRearHit = rearDot < -0.15 && speedDelta > 0.5;
                const relSpeedKmh = Math.abs(ai.speed - player.speed) * 3.6;

                if (relSpeedKmh >= tc.crashRelativeKmh && !isRearHit) {
                    const impactDir = Math.sign(nx || 1);
                    if (!player.isSpinning && typeof player._triggerSpin === 'function') {
                        player._triggerSpin(-impactDir);
                    }
                    player.speed *= 0.42;
                    player.wallStunTimer = Math.max(player.wallStunTimer || 0, 0.55);

                    ai.isCrashed = true;
                    ai.crashTimer = Math.max(ai.crashTimer, 1.0);
                    ai.crashSpinDir = impactDir === 0 ? 1 : impactDir;
                    ai.crashSpinSpeed = Math.max(ai.crashSpinSpeed, 10.5);
                    ai.speed *= 0.35;
                    ai.targetSpeed = 0;
                    ai.isDrifting = false;
                    ai.driftStrength = 0;
                    ai.driftAngle = 0;
                    continue;
                }

                if (isRearHit) {
                    const forwardPush = overlap * (tc.aiPlayerPosPush * 0.4);
                    player.position.addScaledVector(playerForward, forwardPush);
                    const bumpGain = THREE.MathUtils.clamp(0.18 + speedDelta * 0.025, 0.18, 0.75);
                    player.speed = Math.min(player.currentMaxSpeed(), player.speed + bumpGain);
                    if (relSpeedKmh >= tc.crashRelativeKmh) {
                        ai.isCrashed = true;
                        ai.crashTimer = Math.max(ai.crashTimer, 0.85);
                        ai.crashSpinDir = Math.sign(nx || 1) || 1;
                        ai.crashSpinSpeed = Math.max(ai.crashSpinSpeed, 8.5);
                        ai.speed *= 0.3;
                        ai.targetSpeed = 0;
                        ai.isDrifting = false;
                        ai.driftStrength = 0;
                        ai.driftAngle = 0;
                    } else {
                        ai.speed *= 0.94;
                    }
                } else if (isSideSwipe) {
                    const lateralPush = overlap * tc.aiPlayerPosPush * (tc.sideSwipePosPushScale ?? 0.46);
                    player.position.addScaledVector(playerRight, -lateralSign * lateralPush);
                    const forwardCarry = THREE.MathUtils.clamp((ai.speed - player.speed) * 0.01, -0.015, 0.03);
                    if (forwardCarry > 0) {
                        player.position.addScaledVector(playerForward, forwardCarry);
                    }
                    ai.speed *= tc.sideSwipeAiSpeedLoss ?? 0.995;
                    player.speed *= tc.sideSwipePlayerSpeedLoss ?? 0.997;
                } else {
                    player.position.x -= nx * overlap * tc.aiPlayerPosPush;
                    player.position.z -= nz * overlap * tc.aiPlayerPosPush;
                    ai.speed *= 0.988;
                    player.speed *= 0.986;
                }
            }
        }
    }

    getSnapshots() {
        return this.vehicles.map(ai => ({
            id: ai.id,
            lap: ai.lap,
            t: ai.progressT,
            completed: ai.completed,
            speed: ai.speed,
            finishPosition: ai.finishPosition,
            startLinePassed: ai.startLinePassed,
        }));
    }

    getDebugText(playerProgress) {
        if (!this.debugEnabled || !this.vehicles.length) return '';

        let nearest = this.vehicles[0];
        let nearestDelta = Math.abs(this._absProgress(nearest.lap, nearest.progressT) - playerProgress);
        for (let i = 1; i < this.vehicles.length; i++) {
            const ai = this.vehicles[i];
            const d = Math.abs(this._absProgress(ai.lap, ai.progressT) - playerProgress);
            if (d < nearestDelta) {
                nearest = ai;
                nearestDelta = d;
            }
        }

        const kmh = (nearest.speed * 3.6).toFixed(0);
        const dKmh = (nearest.lastDesiredSpeed * 3.6).toFixed(0);
        const wpKmh = (nearest.lastWaypointSpeed * 3.6).toFixed(0);
        const rb = nearest.lastRubberBand.toFixed(3);
        const delta = nearestDelta.toFixed(3);
        return `AI DBG ${this.courseData.name} ${this.difficulty} | near#${nearest.id} d=${delta}lap v=${kmh} tgt=${dKmh} wp=${wpKmh} rb=${rb} wpIdx=${nearest.currentWaypointIndex}`;
    }

    _resolveTuning(courseData, override) {
        const coursePreset = COURSE_TUNING[courseData?.name] || null;
        let merged = mergeDeep(DEFAULT_TUNING, coursePreset || {});
        if (override && isObject(override)) {
            merged = mergeDeep(merged, override);
        }
        return merged;
    }
}
