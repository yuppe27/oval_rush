import * as THREE from 'three';

/**
 * Lightweight AI racer state.
 * Physics is rail-based: progressT moves along course spline [0..1).
 */
export class AIVehicle {
    constructor(id, config = {}) {
        this.id = id;
        this.progressT = config.progressT ?? 0;
        this.lap = config.lap ?? 1;
        this.speed = config.speed ?? 0; // m/s along spline
        this.targetSpeed = config.targetSpeed ?? 45;
        this.maxSpeed = config.maxSpeed ?? 72;
        this.baseMaxSpeed = config.baseMaxSpeed ?? this.maxSpeed;
        this.baseAcceleration = config.baseAcceleration ?? (config.accel ?? 16);
        this.accel = config.accel ?? this.baseAcceleration;
        this.brake = config.brake ?? 26;
        this.vehicleId = config.vehicleId ?? 'falcon';
        this.transmissionFinalRatio = config.transmissionFinalRatio ?? 1.0;
        this.gearTable = config.gearTable ?? [];
        this.currentGear = config.currentGear ?? 1;
        this.shiftCooldownTimer = 0;
        this.launchTimer = 0;
        this.launchThrottle = 0;
        this.racingLineTarget = 0;
        this.laneOffset = config.laneOffset ?? 0; // meters from centerline
        this.laneTarget = this.laneOffset;
        this.aggression = THREE.MathUtils.clamp(config.aggression ?? 0.5, 0, 1);
        this.stability = THREE.MathUtils.clamp(config.stability ?? 0.5, 0, 1);
        this.linePrecision = THREE.MathUtils.clamp(config.linePrecision ?? 0.5, 0, 1);
        this.packAvoidance = THREE.MathUtils.clamp(config.packAvoidance ?? 0.5, 0, 1);
        this.spacingBias = THREE.MathUtils.clamp(config.spacingBias ?? 0.5, 0, 1);
        this.preferredLaneBias = THREE.MathUtils.clamp(config.preferredLaneBias ?? 0, -1, 1);
        this.preferredOvertakeSide = config.preferredOvertakeSide === -1 ? -1 : 1;
        this.completed = false;
        this.finishPosition = 0;
        this.currentWaypointIndex = 0;
        this.paceFactor = config.paceFactor ?? 1.0;
        this.lastRubberBand = 1.0;
        this.lastDesiredSpeed = 0;
        this.lastWaypointSpeed = 0;
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftStrength = 0;
        this.driftHoldTimer = 0;
        this.isCrashed = false;
        this.crashTimer = 0;
        this.crashSpinDir = 1;
        this.crashSpinSpeed = 0;
        this.crashYaw = 0;
        this.startLinePassed = false;
        this.postFinishCruiseSpeed = null;
        this.cruiseSpeedScale = 1.0;

        this.position = new THREE.Vector3();
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
    }

    setGridPosition(t, lap = 1) {
        this.progressT = ((t % 1) + 1) % 1;
        this.lap = lap;
        this.speed = 0;
        this.completed = false;
        this.finishPosition = 0;
        this.currentWaypointIndex = 0;
        this.currentGear = 1;
        this.shiftCooldownTimer = 0;
        this.launchTimer = 1.8;
        this.launchThrottle = 1.0;
        this.racingLineTarget = 0;
        this.lastRubberBand = 1.0;
        this.lastDesiredSpeed = 0;
        this.lastWaypointSpeed = 0;
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftStrength = 0;
        this.driftHoldTimer = 0;
        this.isCrashed = false;
        this.crashTimer = 0;
        this.crashSpinDir = 1;
        this.crashSpinSpeed = 0;
        this.crashYaw = 0;
        this.startLinePassed = false;
        this.postFinishCruiseSpeed = null;
        this.cruiseSpeedScale = 1.0;
    }
}
