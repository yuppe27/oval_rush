import * as THREE from 'three';
import { VehicleModel } from './VehicleModel.js?v=6';
import {
    DEFAULT_MAX_SPEED,
    DEFAULT_ACCELERATION,
    DEFAULT_BRAKE_FORCE,
    DEFAULT_STEERING_SPEED,
    DEFAULT_STEERING_RETURN,
    DEFAULT_MAX_STEERING,
    DEFAULT_TURN_BASE_RATE,
    DEFAULT_TURN_SPEED_RATE,
    DEFAULT_FRICTION,
    DEFAULT_DRAG,
    KMH_TO_MS,
    MS_TO_KMH,
} from '../core/Constants.js';

const ROAD_SURFACE_OFFSET = 0.05; // road mesh (~0.04) + tiny clearance
const TERRAIN_SPEED_TUNING = {
    uphillGradeRef: 0.18,
    downhillGradeRef: 0.14,
    uphillPenaltyMax: 0.12,
    downhillBonusMax: 0.06,
    smoothLerp: 0.12,
};
const DRIFT_TUNING = {
    entrySpeedRatio: 0.30,
    entrySteerMin: 0.78,
    entryBrakeWindowSec: 0.2,
    entryBrakeNeutralSteerMax: 0.12,
    angleBase: 0.34,
    angleSteerScale: 0.92,
    angleLerp: 5.0,
    slipMin: 0.3,
    slipMax: 0.4,
    speedLossPerSec: 0.012,
    holdFullSec: 0.75,
    noseHoldGain: 0.82,
    noseLerp: 5.2,
    noseDriftAngleBias: 0.38,
    spinThreshold: 1.45,
    spinGainBase: 0.8,
    spinGainSpeed: 1.0,
    qualityAngleMin: 0.26,
    qualityAngleMax: 0.72,
    qualityBuildRate: 4.5,
    qualityDecayRate: 2.2,
    speedLossPerSecMin: 0.003,
    overAngleStart: 0.68,
    overAngleMax: 1.02,
    overAngleSpeedLossMax: 0.11,
    driftDriveMin: 0.2,
    driftDriveMax: 0.52,
    coastSpeedLossPerSec: 0.038,
    curveAssistLookAhead: 0.038,
    curveAssistLookAheadScale: 1.35,
    curveAssistYawRate: 8.8,
    curveAssistMaxAngle: 0.96,
    curveAssistSlipRef: 0.24,
    curveAssistSharpCurveRef: 0.44,
    curveAssistSharpYawGain: 0.75,
    centerAssistOffsetGain: 3.6,
    centerAssistMaxRatio: 1.25,
    centerAssistSlipMin: 0.0,
    moveTrackBlendMin: 0.8,
    moveTrackBlendMax: 0.992,
    centerLinePullMin: 2.1,
    centerLinePullMax: 4.6,
    exitAngleThreshold: 0.12,
    exitSpeedRatio: 0.16,
    exitAlignAngle: 0.42,
    exitCounterSteerMin: 0.22,
    exitCounterSteerAngle: 0.26,
    counterSteerAngleScaleMin: 0.42,
    counterSteerAngleScaleMax: 0.62,
    counterSteerExitHoldSec: 0.08,
    counterSteerExitSharpHoldSec: 0.22,
    exitNeutralSteerMax: 0.06,
    maxDurationSec: 3.0,
    minDurationSec: 1.6,
    maxDurationSpeedRatio: 0.95,
    cornerTurnBonusMax: 0.34,
    cornerTurnBonusSharp: 0.16,
    sharpCurveExtraDurationSec: 0.55,
    exitBoostMinSec: 0.08,
    exitBoostMaxSec: 0.18,
    exitTractionAccelLow: 0.05,
    exitTractionAccelHigh: 0.09,
};

export class PlayerVehicle {
    constructor(config = {}) {
        this.vehicleId = config.vehicleId || 'falcon';
        this.model = new VehicleModel({
            vehicleId: this.vehicleId,
            color: config.color,
            modelScale: config.modelScale,
        });
        // Apply car-specific livery (body + accent colors) to GLB model
        if (config.color != null) {
            this.model.applyLivery({
                body: config.color,
                accent1: config.accent1,
                accent2: config.accent2,
            });
        }

        // Position & orientation
        this.position = new THREE.Vector3(0, 0, 0);
        this.rotation = 0; // Y-axis rotation in radians (heading)

        // Physics state
        this.speed = 0;           // m/s (forward speed)
        this.steering = 0;        // current steering angle
        this.lateralVelocity = 0; // sideways velocity for drift

        // Drift state
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftNoseYaw = 0;    // visual-only nose assist during drift
        this.driftStability = 0;  // accumulated instability during over-steer
        this.driftQuality = 0;    // 0..1, rewards clean high-angle drift control
        this.driftEntrySpeed = 0; // speed cap while drifting (prevents unnatural acceleration)
        this.driftTimer = 0;
        this.driftMaxDuration = DRIFT_TUNING.maxDurationSec;
        this.driftCounterSteerExitTimer = 0;
        this.driftEntryBrakeWindow = 0;
        this.prevBrakePressed = false;
        this.steerHoldTime = 0;   // how long the current steer direction is held
        this.steerHoldDir = 0;
        this.prevSteerInput = 0;

        // Parameters (can be overridden per vehicle type)
        this.maxSpeed = config.maxSpeed ?? (DEFAULT_MAX_SPEED * KMH_TO_MS);
        this.acceleration = config.acceleration ?? (DEFAULT_ACCELERATION * KMH_TO_MS);
        this.brakeForce = DEFAULT_BRAKE_FORCE * KMH_TO_MS;
        this.steeringSpeed = DEFAULT_STEERING_SPEED * (config.handling ?? 1.0);
        this.steeringReturn = DEFAULT_STEERING_RETURN;
        this.maxSteering = DEFAULT_MAX_STEERING * (0.95 + (config.handling ?? 1.0) * 0.08);
        this.turnBaseRate = DEFAULT_TURN_BASE_RATE * (config.handling ?? 1.0);
        this.turnSpeedRate = DEFAULT_TURN_SPEED_RATE * (0.96 + (config.handling ?? 1.0) * 0.08);
        this.friction = DEFAULT_FRICTION;
        this.dragFactor = DEFAULT_DRAG;
        this.driftBias = config.driftBias ?? 1.0;
        this.transmissionMode = config.transmission === 'MT' ? 'MT' : 'AT';
        this.currentGear = 1;
        this.transmissionFinalRatio = config.transmissionFinalRatio ?? 1.0;
        this.jumpTuning = {
            launchLift: config.jumpTuning?.launchLift ?? 0.88,
            airtimeScale: config.jumpTuning?.airtimeScale ?? 0.88,
            gravityScale: config.jumpTuning?.gravityScale ?? 1.04,
            throttleKick: config.jumpTuning?.throttleKick ?? 0.02,
        };
        this.gearTable = config.gearTable || [
            { ratio: 1.0, speedRangeKmh: [0, 82], upshiftKmh: 76, downshiftKmh: 0 },
            { ratio: 0.78, speedRangeKmh: [56, 160], upshiftKmh: 152, downshiftKmh: 66 },
            { ratio: 0.58, speedRangeKmh: [124, 246], upshiftKmh: 236, downshiftKmh: 134 },
            { ratio: 0.44, speedRangeKmh: [188, 280], upshiftKmh: 999, downshiftKmh: 198 },
        ];
        this.shiftCutTimer = 0;
        this.shiftCooldownTimer = 0;
        this._shiftEventCounter = 0;
        this._lastShiftEvent = null;

        // Boost state
        this.isBoosting = false;
        this.boostTimer = 0;
        this.boostMaxSpeed = this.maxSpeed * 1.2;
        this.slipstreamFactor = 0; // 0..1

        // Wall collision state
        this.wallStunTimer = 0;  // 0.3s stun after wall hit
        this.wallCounterSteerTimer = 0;
        this.wallCounterSteerDir = 0;
        this.isSpinning = false;
        this.spinTimer = 0;
        this.spinAngularVelocity = 0;
        this.spinDirection = 1;
        this.driftExitTractionTimer = 0;
        this.wallHitCount = 0;
        this.lastWallImpact = 0;
        this.spinOutCount = 0;
        this.collisionImmunityTimer = 0;

        // Course reference for collision
        this.courseBuilder = null;

        // Track position (for lap/checkpoint tracking)
        this.trackT = 0;           // normalized position on spline [0..1]
        this.nearestIndex = 0;     // nearest sampled point index
        this.onTrack = true;
        this.surfaceUp = new THREE.Vector3(0, 1, 0);
        this.surfaceRight = new THREE.Vector3(1, 0, 0);
        this.terrainSpeedFactor = 1.0;
        this.surfaceGrip = 1.0;
        this.surfaceType = 'asphalt';
        this.isInTunnel = false;

        // Controls enabled flag (disabled during countdown)
        this.controlsEnabled = true;

        // Auto-drive mode (used after finish)
        this.autoDrive = false;
        this.autoDriveSpeed = 0; // target speed for auto-drive
        this._autoDriveIdx = 0;  // fractional spline index accumulator
        this.airborneTimer = 0;
        this.verticalVelocity = 0;
        this.landingBoostWindow = 0;
        this._activeJumpZoneKey = null;
    }

    setCourse(courseBuilder) {
        this.courseBuilder = courseBuilder;
    }

    fixedUpdate(dt, input) {
        if (this.autoDrive) {
            this._updateAutoDrive(dt);
            return;
        }

        // Wall stun timer
        if (this.wallStunTimer > 0) {
            this.wallStunTimer -= dt;
        }
        if (this.collisionImmunityTimer > 0) {
            this.collisionImmunityTimer -= dt;
        }

        const controlActive = this.controlsEnabled && this.wallStunTimer <= 0 && !this.isSpinning;
        let steerInput = controlActive ? input.getSteeringInput() : 0;
        const throttle = controlActive ? input.getThrottleInput() : 0;
        const brakePressed = controlActive ? Boolean(input?.brake) : false;
        const airborne = this.airborneTimer > 0;
        if (this.shiftCutTimer > 0) {
            this.shiftCutTimer = Math.max(0, this.shiftCutTimer - dt);
        }
        if (this.shiftCooldownTimer > 0) {
            this.shiftCooldownTimer = Math.max(0, this.shiftCooldownTimer - dt);
        }
        this._updateTransmission(input, throttle);

        if (this.wallCounterSteerTimer > 0 && controlActive) {
            const steerAssist = THREE.MathUtils.clamp(this.wallCounterSteerTimer / 0.22, 0, 1);
            steerInput = THREE.MathUtils.clamp(
                steerInput + this.wallCounterSteerDir * (0.55 + 0.35 * steerAssist),
                -1,
                1
            );
            this.wallCounterSteerTimer -= dt;
        }

        // Stun: reduce steering responsiveness
        const stunFactor = this.wallStunTimer > 0 ? 0.3 : 1.0;

        // -- Steering --
        if (steerInput !== 0) {
            const speedFactor = 1.0 - (Math.abs(this.speed) / this.maxSpeed) * 0.4;
            const steeringAuthority = airborne ? 0.35 : this.surfaceGrip;
            const maxSteering = this.maxSteering * (airborne ? 0.7 : THREE.MathUtils.lerp(0.86, 1.0, this.surfaceGrip));
            this.steering += steerInput * this.steeringSpeed * speedFactor * stunFactor * steeringAuthority * dt;
            this.steering = THREE.MathUtils.clamp(this.steering, -maxSteering, maxSteering);
        } else {
            const returnAmount = this.steeringReturn * dt;
            if (Math.abs(this.steering) <= returnAmount) {
                this.steering = 0;
            } else {
                this.steering -= Math.sign(this.steering) * returnAmount;
            }
        }

        // -- Throttle / Brake --
        const driveAssist = this._getDriveAssistState(throttle);
        const effectiveThrottle = throttle < 0 ? 0 : Math.max(0, Math.max(throttle, driveAssist.minThrottle));
        if (effectiveThrottle > 0) {
            const driveFactor = this._getDriveForceFactor();
            this.speed += this.acceleration
                * driveFactor
                * driveAssist.driveMultiplier
                * this._getShiftCutMultiplier()
                * (airborne ? 0.82 : THREE.MathUtils.lerp(0.9, 1.0, this.surfaceGrip))
                * effectiveThrottle
                * dt;
        } else if (throttle < 0) {
            const driftEntryPrep = brakePressed
                && Math.abs(steerInput) >= DRIFT_TUNING.entrySteerMin
                && Math.abs(this.speed) > this.maxSpeed * DRIFT_TUNING.entrySpeedRatio
                && !this.isDrifting;
            const brakeForce = driftEntryPrep ? this.brakeForce * 0.45 : this.brakeForce;
            if (this.speed > 0.5) {
                this.speed -= brakeForce * dt;
                if (this.speed < 0) this.speed = 0;
            } else {
                this.speed -= this.acceleration * 0.3 * dt;
            }
        }

        // -- Drag & Friction --
        if (Math.abs(this.speed) > 0.1) {
            const drag = this.speed * this.speed * this.dragFactor * 0.001 * Math.sign(this.speed);
            this.speed -= drag * dt;
            const frictionFactor = airborne
                ? 0.9985
                : THREE.MathUtils.lerp(this.friction * 0.993, this.friction, this.surfaceGrip);
            this.speed *= Math.pow(frictionFactor, dt * 60);
        } else if (throttle === 0) {
            this.speed *= 0.9;
            if (Math.abs(this.speed) < 0.05) this.speed = 0;
        }

        // Clamp speed
        const maxSpd = this.currentMaxSpeed();
        this.speed = THREE.MathUtils.clamp(this.speed, -maxSpd * 0.3, maxSpd);

        // -- Drift --
        this._updateDrift(dt, steerInput, throttle, brakePressed);

        // -- Boost --
        this._updateBoost(dt);
        this._updateSpin(dt);

        // -- Apply movement --
        const absSpeed = Math.abs(this.speed);
        const driftSlipFactor = this._getDriftSlipFactor(absSpeed);
        const minTurnSpeed = 1.0;
        const turnSpeedFactor = Math.min(1.0, absSpeed / minTurnSpeed);
        const speedSign = this.speed >= 0 ? 1 : -1;
        const speedRatio = absSpeed / this.maxSpeed;
        const highSpeedDamping = 1.0 - speedRatio * 0.5;
        const turnRate = this.steering * turnSpeedFactor * (
            this.turnBaseRate * highSpeedDamping * speedSign +
            this.turnSpeedRate * (this.speed / this.maxSpeed)
        );
        const driftAssistState = this.isDrifting
            ? this._getDriftTrackAssistState(absSpeed)
            : null;
        const driftTurnMul = this.isDrifting
            ? 1
                + DRIFT_TUNING.cornerTurnBonusMax * this.driftQuality
                + (driftAssistState?.curveN ?? 0) * DRIFT_TUNING.cornerTurnBonusSharp
            : 1;
        this.rotation -= turnRate * driftTurnMul * dt;
        this.rotation += this._getDriftCurveAssist(absSpeed, driftAssistState) * dt;
        const effectiveAngle = this.rotation - this.driftAngle * driftSlipFactor;

        // Forward movement
        const moveDir = this.isDrifting
            ? this._getDriftMoveDirection(effectiveAngle, absSpeed, driftAssistState)
            : this.rotation;
        this.position.x += Math.sin(moveDir) * this.speed * dt;
        this.position.z += Math.cos(moveDir) * this.speed * dt;
        this._applyDriftCenterLineTracking(dt, absSpeed, driftAssistState);

        // Resolve wall collision and snap to banked surface using final position.
        this._updateSurfaceFriction(throttle);
        this._updateAirborneState(dt, throttle);

        // -- Update visual model --
        this.model.group.position.copy(this.position);
        this._updateModelOrientation();
        this.model.updateWheelRotation(this.speed);
        this.model.setBraking(throttle < 0 && this.speed > 0.5);
    }

    _updateTransmission(input, throttle) {
        if (this.transmissionMode === 'AT') {
            this._updateAutoGear(throttle);
            return;
        }
        if (!this.controlsEnabled) return;

        if (input?.consumeShiftUp?.()) {
            const prev = this.currentGear;
            this.currentGear = Math.min(this.gearTable.length, this.currentGear + 1);
            if (this.currentGear > prev) {
                this.shiftCutTimer = 0.12;
                this.shiftCooldownTimer = 0.18;
                this._registerShiftEvent('up');
            }
        }
        if (input?.consumeShiftDown?.()) {
            const prev = this.currentGear;
            this.currentGear = Math.max(1, this.currentGear - 1);
            if (this.currentGear < prev && this.speed > 0.5 && throttle >= 0) {
                this._applyDownshiftEngineBraking(prev, this.currentGear);
                this.shiftCutTimer = 0.08;
                this.shiftCooldownTimer = 0.16;
                this._registerShiftEvent('down');
            }
        }
    }

    _updateAutoGear(throttle = 0) {
        if (this.shiftCooldownTimer > 0) return;

        const kmh = this.getSpeedKmh();
        const cur = this._getGearData(this.currentGear);
        if (!cur) return;
        const [minKmh, maxKmh] = this._getGearSpeedBoundsKmh(cur);
        const throttleN = THREE.MathUtils.clamp(Math.max(0, throttle), 0, 1);
        const upThreshold = cur.upshiftKmh ?? (maxKmh - 6);
        const downThreshold = cur.downshiftKmh ?? Math.max(0, minKmh + 8);
        const adjustedUp = upThreshold + THREE.MathUtils.lerp(-4, 8, throttleN);
        const adjustedDown = downThreshold - THREE.MathUtils.lerp(0, 6, throttleN);

        if (this.currentGear < this.gearTable.length && kmh > adjustedUp) {
            this.currentGear += 1;
            this.shiftCutTimer = 0.08;
            this.shiftCooldownTimer = 0.18;
            this._registerShiftEvent('up');
        } else if (this.currentGear > 1 && kmh < adjustedDown) {
            this.currentGear -= 1;
            this.shiftCutTimer = 0.05;
            this.shiftCooldownTimer = 0.16;
            this._registerShiftEvent('down');
        }
    }

    _getGearData(gear = this.currentGear) {
        const idx = THREE.MathUtils.clamp((gear | 0) - 1, 0, this.gearTable.length - 1);
        return this.gearTable[idx];
    }

    _getGearSpeedBoundsKmh(gear = this._getGearData()) {
        if (!gear) return [0, this.maxSpeed * MS_TO_KMH];
        if (Array.isArray(gear.speedRangeKmh) && gear.speedRangeKmh.length >= 2) {
            return gear.speedRangeKmh;
        }
        return [gear.min ?? 0, gear.max ?? (this.maxSpeed * MS_TO_KMH)];
    }

    _getDriveForceFactor() {
        const gear = this._getGearData();
        const [minKmh, maxKmh] = this._getGearSpeedBoundsKmh(gear);
        const gearRatio = gear?.ratio ?? gear?.accel ?? 1.0;
        const kmh = this.getSpeedKmh();
        const span = Math.max(1, maxKmh - minKmh);
        const gearProgress = (kmh - minKmh) / span;
        let torqueBand = 0.72;
        if (gearProgress < 0.32) {
            torqueBand = THREE.MathUtils.lerp(0.7, 1.03, THREE.MathUtils.clamp(gearProgress / 0.32, 0, 1));
        } else if (gearProgress < 0.78) {
            torqueBand = 1.03;
        } else {
            torqueBand = THREE.MathUtils.lerp(1.03, 0.68, THREE.MathUtils.clamp((gearProgress - 0.78) / 0.34, 0, 1));
        }
        const overRev = Math.max(0, kmh - maxKmh);
        const softLimiter = THREE.MathUtils.clamp(1 - (overRev / 14), 0.08, 1);
        const speedFalloff = THREE.MathUtils.clamp(1 - (Math.abs(this.speed) / Math.max(1, this.maxSpeed)) * 0.2, 0.74, 1);
        return gearRatio * this.transmissionFinalRatio * torqueBand * softLimiter * speedFalloff;
    }

    _applyDownshiftEngineBraking(prevGear, nextGear) {
        const prev = this._getGearData(prevGear);
        const next = this._getGearData(nextGear);
        const prevRatio = prev?.ratio ?? prev?.accel ?? 1;
        const nextRatio = next?.ratio ?? next?.accel ?? 1;
        const ratioDelta = Math.max(0, nextRatio - prevRatio);
        const speedDrop = this.brakeForce * THREE.MathUtils.clamp(0.05 + ratioDelta * 0.08, 0.04, 0.14);
        this.speed = Math.max(0, this.speed - speedDrop);
    }

    _getDriveAssistState(throttle = 0) {
        let driveMultiplier = 1;
        let minThrottle = 0;

        if (this.driftExitTractionTimer > 0) {
            const t = THREE.MathUtils.clamp(
                this.driftExitTractionTimer / DRIFT_TUNING.exitBoostMaxSec,
                0,
                1
            );
            driveMultiplier += DRIFT_TUNING.exitTractionAccelLow + DRIFT_TUNING.exitTractionAccelHigh * t;
        }

        if (this.isDrifting) {
            driveMultiplier += THREE.MathUtils.lerp(0.04, 0.16, this.driftQuality);
        }

        if (this.isBoosting) {
            driveMultiplier += 0.42;
            minThrottle = Math.max(minThrottle, 0.35);
        }

        if (this.slipstreamFactor > 0) {
            driveMultiplier += this.slipstreamFactor * 0.05;
            if (throttle > 0.2) {
                minThrottle = Math.max(minThrottle, throttle);
            }
        }

        return { driveMultiplier, minThrottle };
    }

    _getDriftSlipFactor(speedAbs = Math.abs(this.speed)) {
        if (!this.isDrifting) return 0.3;
        return THREE.MathUtils.lerp(
            DRIFT_TUNING.slipMin,
            DRIFT_TUNING.slipMax,
            THREE.MathUtils.clamp(speedAbs / (this.maxSpeed * 0.85), 0, 1)
        );
    }

    _getDriftDurationFromEntrySpeed(speedAbs) {
        const minEntrySpeed = this.maxSpeed * DRIFT_TUNING.entrySpeedRatio;
        const maxEntrySpeed = this.maxSpeed * DRIFT_TUNING.maxDurationSpeedRatio;
        const speedN = THREE.MathUtils.clamp(
            (speedAbs - minEntrySpeed) / Math.max(1e-3, maxEntrySpeed - minEntrySpeed),
            0,
            1
        );
        return THREE.MathUtils.lerp(
            DRIFT_TUNING.minDurationSec,
            DRIFT_TUNING.maxDurationSec,
            speedN
        );
    }

    _getShiftCutMultiplier() {
        if (this.shiftCutTimer <= 0) return 1;
        const t = THREE.MathUtils.clamp(this.shiftCutTimer / 0.12, 0, 1);
        return 0.38 + (1 - t) * 0.62;
    }

    _registerShiftEvent(type) {
        this._shiftEventCounter += 1;
        this._lastShiftEvent = {
            id: this._shiftEventCounter,
            type,
            gear: this.currentGear,
            speedKmh: this.getSpeedKmh(),
        };
    }

    consumeShiftEvent() {
        const ev = this._lastShiftEvent;
        this._lastShiftEvent = null;
        return ev;
    }

    _updateDrift(dt, steerInput, throttle, brakePressed = false) {
        const speedAbs = Math.abs(this.speed);
        const steerSign = Math.sign(steerInput);
        const steerAmount = Math.abs(steerInput);
        const brakeJustPressed = brakePressed && !this.prevBrakePressed;
        if (brakeJustPressed) {
            this.driftEntryBrakeWindow = steerAmount <= DRIFT_TUNING.entryBrakeNeutralSteerMax
                ? DRIFT_TUNING.entryBrakeWindowSec
                : 0;
        } else if (this.driftEntryBrakeWindow > 0) {
            this.driftEntryBrakeWindow = Math.max(0, this.driftEntryBrakeWindow - dt);
        }

        const canEnterDrift = !this.isDrifting
            && this.onTrack
            && !this.isSpinning
            && speedAbs > this.maxSpeed * DRIFT_TUNING.entrySpeedRatio
            && brakePressed
            && this.driftEntryBrakeWindow > 0
            && steerAmount >= DRIFT_TUNING.entrySteerMin
            && steerSign !== 0;

        if (canEnterDrift) {
            const steerBasis = steerInput || this.steering || this.prevSteerInput;
            this.isDrifting = true;
            this.driftAngle = steerBasis * DRIFT_TUNING.angleBase * this.driftBias;
            this.driftStability = Math.max(0, this.driftStability * 0.4);
            this.driftEntrySpeed = speedAbs;
            this.driftTimer = 0;
            this.driftMaxDuration = this._getDriftDurationFromEntrySpeed(speedAbs);
            this.driftCounterSteerExitTimer = 0;
            this.driftEntryBrakeWindow = 0;
        }

        if (this.isDrifting) {
            this.driftTimer += dt;
            const assistState = this._getDriftTrackAssistState(speedAbs);
            const curveN = assistState?.curveN ?? 0;
            const driftSign = Math.sign(this.driftAngle);
            const counterSteering = driftSign !== 0
                && Math.sign(steerInput) === -driftSign
                && Math.abs(steerInput) >= DRIFT_TUNING.exitCounterSteerMin;
            const steerBasis = steerInput !== 0
                ? steerInput
                : (Math.abs(this.steering) > 0.02 ? this.steering / this.maxSteering : Math.sign(this.driftAngle));
            const driftControlBasis = counterSteering
                ? (driftSign || Math.sign(this.steering) || Math.sign(this.prevSteerInput) || 1)
                : steerBasis;
            const counterSteerAngleScale = counterSteering
                ? THREE.MathUtils.lerp(
                    DRIFT_TUNING.counterSteerAngleScaleMin,
                    DRIFT_TUNING.counterSteerAngleScaleMax,
                    curveN
                )
                : 1;
            const steerMagContrib = counterSteering
                ? 0
                : Math.abs(this.steering) / this.maxSteering * DRIFT_TUNING.angleSteerScale;
            const targetDriftAngle = driftControlBasis * (
                DRIFT_TUNING.angleBase + steerMagContrib
            ) * this.driftBias * counterSteerAngleScale;
            this.driftAngle = THREE.MathUtils.lerp(
                this.driftAngle,
                targetDriftAngle,
                dt * DRIFT_TUNING.angleLerp
            );

            const speedN = THREE.MathUtils.clamp(speedAbs / (this.maxSpeed * 0.8), 0, 1);
            const steerDir = Math.sign(driftControlBasis);
            if (steerDir !== 0) {
                if (this.steerHoldDir === steerDir) {
                    this.steerHoldTime += dt;
                } else {
                    this.steerHoldDir = steerDir;
                    this.steerHoldTime = dt;
                }
            } else {
                this.steerHoldTime = Math.max(0, this.steerHoldTime - dt * 2.5);
            }

            const holdN = THREE.MathUtils.clamp(this.steerHoldTime / DRIFT_TUNING.holdFullSec, 0, 1);
            const noseBase = THREE.MathUtils.lerp(0.05, 0.11, speedN);
            const noseTarget = (
                steerBasis * noseBase * (1 + holdN * DRIFT_TUNING.noseHoldGain)
                + this.driftAngle * DRIFT_TUNING.noseDriftAngleBias
            );
            this.driftNoseYaw = THREE.MathUtils.lerp(
                this.driftNoseYaw,
                noseTarget,
                dt * DRIFT_TUNING.noseLerp
            );

            const throttleN = THREE.MathUtils.clamp(Math.max(0, throttle), 0, 1);
            const angleAbs = Math.abs(this.driftAngle);
            const angleN = THREE.MathUtils.clamp(
                (angleAbs - DRIFT_TUNING.qualityAngleMin)
                / (DRIFT_TUNING.qualityAngleMax - DRIFT_TUNING.qualityAngleMin),
                0,
                1
            );
            const signMatch = Math.sign(driftControlBasis || this.steering) === Math.sign(this.driftAngle) ? 1 : 0.35;
            const speedFit = THREE.MathUtils.clamp(speedAbs / (this.maxSpeed * 0.75), 0, 1);
            const throttleControl = throttle > 0
                ? THREE.MathUtils.lerp(0.78, 1.0, throttleN)
                : 0.8;
            const qualityTarget = angleN * signMatch * throttleControl * (0.55 + 0.45 * speedFit);
            this.driftQuality = THREE.MathUtils.lerp(
                this.driftQuality,
                qualityTarget,
                dt * DRIFT_TUNING.qualityBuildRate
            );

            const overAngleN = THREE.MathUtils.clamp(
                (angleAbs - DRIFT_TUNING.overAngleStart)
                / (DRIFT_TUNING.overAngleMax - DRIFT_TUNING.overAngleStart),
                0,
                1
            );
            const throttleRelief = THREE.MathUtils.lerp(1.0, 0.72, throttleN);
            const speedLossPerSec = THREE.MathUtils.lerp(
                DRIFT_TUNING.speedLossPerSec,
                DRIFT_TUNING.speedLossPerSecMin,
                this.driftQuality
            ) * throttleRelief + overAngleN * DRIFT_TUNING.overAngleSpeedLossMax;
            this.speed *= (1.0 - speedLossPerSec * dt);
            if (throttle <= 0) {
                const coastLoss = DRIFT_TUNING.coastSpeedLossPerSec;
                this.speed *= (1.0 - coastLoss * dt);
            }

            const driftDrive = THREE.MathUtils.lerp(
                DRIFT_TUNING.driftDriveMin,
                DRIFT_TUNING.driftDriveMax,
                this.driftQuality
            ) * throttleN * (1 - overAngleN);
            const driftSpeedCap = Math.min(
                this.currentMaxSpeed(),
                this.driftEntrySpeed * (1.04 + throttleN * 0.03 + this.driftQuality * 0.09)
            );
            if (driftDrive > 0 && speedAbs < driftSpeedCap) {
                this.speed += this.acceleration * this._getDriveForceFactor() * driftDrive * dt;
            }

            const speedCap = this.driftEntrySpeed * (1.02 + throttleN * 0.03 + this.driftQuality * 0.07);
            if (speedCap > 0 && Math.abs(this.speed) > speedCap) {
                this.speed = Math.sign(this.speed || 1) * speedCap;
            }

            const steerRatio = Math.abs(this.steering) / this.maxSteering;
            const excessive = Math.max(0, Math.max(steerRatio - 0.9, overAngleN - 0.28));
            if (excessive > 0) {
                const gain = excessive * (
                    DRIFT_TUNING.spinGainBase + speedN * DRIFT_TUNING.spinGainSpeed
                );
                this.driftStability += gain * dt;
            } else {
                this.driftStability = Math.max(0, this.driftStability - dt * 0.45);
            }

            if (!this.isSpinning && this.driftStability > DRIFT_TUNING.spinThreshold) {
                this._triggerSpin(Math.sign(driftControlBasis || this.steering));
            }

            const counterSteerReady = counterSteering
                && Math.abs(this.driftAngle) <= DRIFT_TUNING.exitCounterSteerAngle;
            if (counterSteerReady) {
                this.driftCounterSteerExitTimer = Math.min(
                    DRIFT_TUNING.counterSteerExitSharpHoldSec,
                    this.driftCounterSteerExitTimer + dt
                );
            } else {
                this.driftCounterSteerExitTimer = Math.max(0, this.driftCounterSteerExitTimer - dt * 4);
            }
            const counterSteerExitHold = THREE.MathUtils.lerp(
                DRIFT_TUNING.counterSteerExitHoldSec,
                DRIFT_TUNING.counterSteerExitSharpHoldSec,
                curveN
            );
            const alignedForCounterExit = this.driftCounterSteerExitTimer >= counterSteerExitHold;
            const neutralExit = Math.abs(this.driftAngle) < DRIFT_TUNING.exitAngleThreshold
                && Math.abs(steerInput) < DRIFT_TUNING.exitNeutralSteerMax;
            const driftDurationLimit = this.driftMaxDuration + curveN * DRIFT_TUNING.sharpCurveExtraDurationSec;
            const shouldExit = speedAbs < this.maxSpeed * DRIFT_TUNING.exitSpeedRatio
                || this.driftTimer >= driftDurationLimit
                || alignedForCounterExit
                || neutralExit;
            if (shouldExit) {
                const timeN = THREE.MathUtils.clamp(this.driftTimer / Math.max(1e-3, driftDurationLimit), 0, 1);
                const driftPerformance = THREE.MathUtils.clamp(
                    timeN * 0.55 + this.driftQuality * 0.65,
                    0,
                    1
                );
                const exitAlignment = 1 - THREE.MathUtils.clamp(
                    Math.abs(this.driftAngle) / DRIFT_TUNING.exitAlignAngle,
                    0,
                    1
                );
                const throttleNExit = THREE.MathUtils.clamp(Math.max(0, throttle), 0, 1);
                this._triggerDriftBoost(driftPerformance, exitAlignment, throttleNExit);
                this.isDrifting = false;
                this.driftEntrySpeed = 0;
                this.driftTimer = 0;
                this.driftMaxDuration = DRIFT_TUNING.maxDurationSec;
                this.driftCounterSteerExitTimer = 0;
                this.driftAngle *= 0.82;
                this.driftStability = Math.max(0, this.driftStability - 0.25);
                this.driftQuality *= 0.8;
                this.driftEntryBrakeWindow = 0;
                this.steerHoldTime = 0;
                this.steerHoldDir = 0;
                this.driftExitTractionTimer = THREE.MathUtils.lerp(
                    DRIFT_TUNING.exitBoostMinSec,
                    DRIFT_TUNING.exitBoostMaxSec,
                    THREE.MathUtils.clamp(driftPerformance * (0.45 + exitAlignment * 0.55), 0, 1)
                );
            }
        }

        if (!this.isDrifting && Math.abs(this.driftAngle) > 0.01) {
            this.driftAngle *= Math.pow(0.55, dt);
        }
        if (!this.isDrifting) {
            this.driftNoseYaw = THREE.MathUtils.lerp(this.driftNoseYaw, 0, dt * 6);
            this.driftStability = Math.max(0, this.driftStability - dt * 0.35);
            this.driftQuality = Math.max(0, this.driftQuality - dt * DRIFT_TUNING.qualityDecayRate);
            this.driftCounterSteerExitTimer = Math.max(0, this.driftCounterSteerExitTimer - dt * 5);
            this.steerHoldTime = Math.max(0, this.steerHoldTime - dt * 3);
            if (this.steerHoldTime <= 0) this.steerHoldDir = 0;
        }

        this.prevSteerInput = steerInput;
        this.prevBrakePressed = brakePressed;
    }

    _triggerSpin(direction = 1) {
        const speedN = THREE.MathUtils.clamp(Math.abs(this.speed) / this.maxSpeed, 0, 1);
        this.isSpinning = true;
        this.spinOutCount += 1;
        this.spinDirection = direction === 0 ? 1 : direction;
        this.spinTimer = THREE.MathUtils.lerp(0.55, 1.0, speedN);
        this.spinAngularVelocity = THREE.MathUtils.lerp(7.5, 12.0, speedN);

        // Lose drift/boost state when spin starts.
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftNoseYaw = 0;
        this.isBoosting = false;
        this.boostTimer = 0;
        this.driftExitTractionTimer = 0;
        this.driftStability = 0;
        this.driftQuality = 0;
        this.driftEntrySpeed = 0;
        this.driftTimer = 0;
        this.driftMaxDuration = DRIFT_TUNING.maxDurationSec;
        this.driftCounterSteerExitTimer = 0;
        this.driftEntryBrakeWindow = 0;
        this.prevBrakePressed = false;
        this.prevSteerInput = 0;
    }

    _getDriftTrackAssistState(speedAbs = Math.abs(this.speed)) {
        if (!this.isDrifting || !this.courseBuilder?.sampledPoints?.length) {
            return null;
        }

        const nearest = this.courseBuilder.getNearest(this.position, this.nearestIndex);
        const samples = this.courseBuilder.sampledPoints;
        const sampleCount = samples.length;
        const baseIndex = THREE.MathUtils.clamp((nearest?.index ?? this.nearestIndex) | 0, 0, sampleCount - 1);
        const speedN = THREE.MathUtils.clamp(speedAbs / (this.maxSpeed * 0.8), 0, 1);
        const lookAheadFactor = THREE.MathUtils.lerp(1, DRIFT_TUNING.curveAssistLookAheadScale, speedN);
        const lookAhead = Math.max(2, Math.floor(sampleCount * DRIFT_TUNING.curveAssistLookAhead * lookAheadFactor));
        const ahead = samples[(baseIndex + lookAhead) % sampleCount];
        const current = nearest?.sp;
        if (!current || !ahead) {
            return null;
        }

        const halfWidth = Math.max(1e-3, nearest.halfWidth ?? (current.width * 0.5));
        const lateralRatio = THREE.MathUtils.clamp(
            (nearest.lateralOffset ?? 0) / halfWidth,
            -DRIFT_TUNING.centerAssistMaxRatio,
            DRIFT_TUNING.centerAssistMaxRatio
        );
        const currentForward = current.forward.clone().projectOnPlane(current.up).normalize();
        const aheadForward = ahead.forward.clone().projectOnPlane(current.up).normalize();
        let signedCurve = 0;
        if (currentForward.lengthSq() > 1e-6 && aheadForward.lengthSq() > 1e-6) {
            const cross = currentForward.clone().cross(aheadForward);
            signedCurve = Math.atan2(
                cross.dot(current.up),
                THREE.MathUtils.clamp(currentForward.dot(aheadForward), -1, 1)
            );
        }
        const curveN = THREE.MathUtils.clamp(
            Math.abs(signedCurve) / DRIFT_TUNING.curveAssistSharpCurveRef,
            0,
            1
        );
        const slipN = THREE.MathUtils.clamp(
            Math.abs(this.driftAngle) / DRIFT_TUNING.curveAssistSlipRef,
            0,
            1
        );

        return {
            nearest,
            current,
            ahead,
            halfWidth,
            lateralRatio,
            absLateralRatio: Math.abs(lateralRatio),
            speedN,
            slipN,
            curveN,
        };
    }

    _getDriftCurveAssist(speedAbs, assistState = null) {
        const state = assistState ?? this._getDriftTrackAssistState(speedAbs);
        if (!state) {
            return 0;
        }

        const {
            nearest,
            current,
            ahead,
            halfWidth,
            lateralRatio,
            absLateralRatio,
            speedN,
            slipN,
            curveN,
        } = state;
        const centerGain = Math.max(0, slipN - DRIFT_TUNING.centerAssistSlipMin)
            / Math.max(1e-3, 1 - DRIFT_TUNING.centerAssistSlipMin);
        const centerOffset = THREE.MathUtils.clamp(
            -nearest.lateralOffset
            * DRIFT_TUNING.centerAssistOffsetGain
            * (0.28 + centerGain * 0.36 + curveN * 0.16),
            -halfWidth * (0.32 + curveN * 0.06),
            halfWidth * (0.32 + curveN * 0.06)
        );
        const trackForward = ahead.forward.clone().projectOnPlane(current.up).normalize();
        if (trackForward.lengthSq() < 1e-6) {
            trackForward.set(
                ahead.position.x - current.position.x,
                0,
                ahead.position.z - current.position.z
            ).normalize();
        }
        const laneBiasMax = 0.3 + curveN * 0.08;
        const laneBias = THREE.MathUtils.clamp(centerOffset / halfWidth, -laneBiasMax, laneBiasMax);
        const desiredForward = trackForward
            .addScaledVector(ahead.right, laneBias * (0.12 + centerGain * 0.08 + curveN * 0.06))
            .normalize();
        const targetYaw = Math.atan2(desiredForward.x, desiredForward.z);
        let diff = targetYaw - this.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const assistAngle = THREE.MathUtils.clamp(
            diff,
            -DRIFT_TUNING.curveAssistMaxAngle,
            DRIFT_TUNING.curveAssistMaxAngle
        );
        const yawAssist = assistAngle
            * DRIFT_TUNING.curveAssistYawRate
            * (0.6 + speedN * 0.85)
            * (0.65 + slipN * 0.35)
            * (0.95 + absLateralRatio * 0.45)
            * (1 + curveN * DRIFT_TUNING.curveAssistSharpYawGain);
        const laneRecovery = -lateralRatio
            * (0.22 + centerGain * 0.32)
            * (0.3 + speedN * 0.28 + curveN * 0.22);
        return yawAssist + laneRecovery;
    }

    _getDriftMoveDirection(effectiveAngle, speedAbs, assistState = null) {
        const state = assistState ?? this._getDriftTrackAssistState(speedAbs);
        if (!state) {
            return effectiveAngle;
        }

        const { current, ahead, absLateralRatio, speedN, curveN } = state;
        const driftForward = new THREE.Vector3(Math.sin(effectiveAngle), 0, Math.cos(effectiveAngle))
            .projectOnPlane(current.up)
            .normalize();
        const centerLineForward = ahead.position.clone()
            .sub(current.position)
            .projectOnPlane(current.up)
            .normalize();
        if (driftForward.lengthSq() < 1e-6 || centerLineForward.lengthSq() < 1e-6) {
            return effectiveAngle;
        }

        const qualityN = THREE.MathUtils.clamp(this.driftQuality, 0, 1);
        const blend = THREE.MathUtils.clamp(
            DRIFT_TUNING.moveTrackBlendMin
            + speedN * 0.08
            + qualityN * 0.06
            + absLateralRatio * 0.12
            + curveN * 0.1,
            0,
            DRIFT_TUNING.moveTrackBlendMax
        );
        const moveForward = driftForward.lerp(centerLineForward, blend).normalize();
        return Math.atan2(moveForward.x, moveForward.z);
    }

    _applyDriftCenterLineTracking(dt, speedAbs, assistState = null) {
        const state = assistState ?? this._getDriftTrackAssistState(speedAbs);
        if (!state) {
            return;
        }

        const { nearest, current, halfWidth, absLateralRatio, speedN, curveN } = state;
        const qualityN = THREE.MathUtils.clamp(this.driftQuality, 0, 1);
        const pull = THREE.MathUtils.lerp(
            DRIFT_TUNING.centerLinePullMin,
            DRIFT_TUNING.centerLinePullMax,
            THREE.MathUtils.clamp(
                0.32 + speedN * 0.28 + qualityN * 0.15 + absLateralRatio * 0.1 + curveN * 0.25,
                0,
                1
            )
        );
        const centerStep = THREE.MathUtils.clamp(
            -nearest.lateralOffset * pull * dt,
            -halfWidth * (0.18 + curveN * 0.05),
            halfWidth * (0.18 + curveN * 0.05)
        );
        this.position.addScaledVector(current.right, centerStep);
    }

    _updateSpin(dt) {
        if (!this.isSpinning) return;

        this.spinTimer -= dt;
        this.rotation += this.spinDirection * this.spinAngularVelocity * dt;
        this.spinAngularVelocity = Math.max(1.2, this.spinAngularVelocity - 9.5 * dt);
        this.steering *= Math.pow(0.02, dt);
        this.speed *= Math.pow(0.955, dt * 60);

        if (this.spinTimer <= 0) {
            this.isSpinning = false;
            this.spinTimer = 0;
            this.spinAngularVelocity = 0;
            this.driftStability = 0;
            this._recoverFromSpin();
        }
    }

    _recoverFromSpin() {
        if (!this.courseBuilder || !this.courseBuilder.sampledPoints.length) return;

        const nearest = this.courseBuilder.getNearest(this.position, this.nearestIndex);
        const sp = nearest.sp;
        this.nearestIndex = nearest.index;
        this.trackT = nearest.t;
        this.onTrack = true;
        this.surfaceUp.copy(sp.up);
        this.surfaceRight.copy(sp.right);
        this.position.copy(sp.position).addScaledVector(sp.up, ROAD_SURFACE_OFFSET);
        this.rotation = Math.atan2(sp.forward.x, sp.forward.z);
        this.speed = Math.min(this.speed, this.maxSpeed * 0.18);
        this.steering = 0;
        this.driftAngle = 0;
        this.driftNoseYaw = 0;
        this.driftTimer = 0;
        this.driftCounterSteerExitTimer = 0;
        this.wallCounterSteerTimer = 0;
        this.wallCounterSteerDir = 0;
        this.collisionImmunityTimer = 3.0;
        this.prevSteerInput = 0;
        this.driftEntryBrakeWindow = 0;
        this.prevBrakePressed = false;
    }

    _correctHeadingAfterWallHit(sp) {
        const trackYaw = Math.atan2(sp.forward.x, sp.forward.z);
        let diff = this.rotation - trackYaw;
        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const absDiff = Math.abs(diff);
        if (absDiff > Math.PI * 0.5) {
            // Facing mostly backward — snap strongly toward track forward
            this.rotation = trackYaw;
            // Also kill any backward speed
            if (this.speed < 0) this.speed = 0;
        } else if (absDiff > Math.PI * 0.3) {
            // Significantly off — lerp aggressively toward track forward
            this.rotation = trackYaw + diff * 0.3;
        }
    }

    _triggerDriftBoost(driftPerformance = 0, exitAlignment = 0, throttleOnExit = 0) {
        if (driftPerformance < 0.08) {
            return;
        }

        const alignmentBonus = THREE.MathUtils.clamp(exitAlignment, 0, 1);
        const throttleBonus = THREE.MathUtils.clamp(throttleOnExit, 0, 1);
        const boostScale = 0.45 + alignmentBonus * 0.2 + throttleBonus * 0.15;

        if (driftPerformance >= 0.8) {
            this.boostTimer = 1.0 * boostScale;
        } else if (driftPerformance >= 0.42) {
            this.boostTimer = 0.55 * boostScale;
        } else {
            this.boostTimer = 0.22 * boostScale;
        }

        this.isBoosting = true;
    }

    _updateBoost(dt) {
        if (this.driftExitTractionTimer > 0) {
            this.driftExitTractionTimer -= dt;
        }

        if (this.isBoosting) {
            this.boostTimer -= dt;
            if (this.boostTimer <= 0) {
                this.isBoosting = false;
                this.boostTimer = 0;
            }
        }
    }

    _updateSurfaceFriction(throttle = 0) {
        if (!this.courseBuilder) {
            this.onTrack = true;
            this.terrainSpeedFactor = 1.0;
            this.surfaceGrip = 1.0;
            this.surfaceType = 'asphalt';
            this.isInTunnel = false;
            return;
        }

        let nearest = this.courseBuilder.getNearest(this.position, this.nearestIndex);
        this.nearestIndex = nearest.index;
        this.trackT = nearest.t;
        this.onTrack = nearest.onTrack;
        this.surfaceUp.copy(nearest.sp.up);
        this.surfaceRight.copy(nearest.sp.right);
        this._updateTerrainSpeedFactor(nearest.sp);
        this._applyTrackEnvironment(nearest.sp);

        if (this.airborneTimer > 0) {
            this._tryTriggerJump(nearest.sp, throttle);
            return;
        }

        // Snap to the banked surface plane (not just Y), preserving tangential movement.
        this._snapToSurfacePlane(nearest);

        const halfW = nearest.sp.width / 2;
        const lateralAbs = Math.abs(nearest.lateralOffset);

        if (lateralAbs > halfW) {
            // Wall collision
            const penetration = lateralAbs - halfW;

            // Push player back onto track
            const pushDir = nearest.lateralOffset > 0 ? -1 : 1;
            const wallNormal = nearest.sp.right.clone().multiplyScalar(pushDir).normalize();
            const speedSign = this.speed >= 0 ? 1 : -1;
            const moveDir = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation))
                .projectOnPlane(nearest.sp.up)
                .normalize()
                .multiplyScalar(speedSign);
            const towardWall = THREE.MathUtils.clamp(-moveDir.dot(wallNormal), 0, 1);
            const pushOut = penetration + THREE.MathUtils.lerp(0.06, 0.28, towardWall);
            const pushVec = nearest.sp.right.clone().multiplyScalar(pushDir * pushOut);
            this.position.x += pushVec.x;
            this.position.z += pushVec.z;

            // Angle-aware wall response:
            // - shallow hit: mild slowdown + bounce to center
            // - deep hit: heavy slowdown
            // - deep & high-speed hit: crash (spin)
            const impactSpeed = Math.abs(this.speed);
            const speedN = THREE.MathUtils.clamp(impactSpeed / this.maxSpeed, 0, 1);
            const impactSpeedKmh = impactSpeed * 3.6;
            const shallowThreshold = 0.42;
            const crashAngleThreshold = 0.88;
            const crashSpeedThresholdN = 0.82;
            const crashMinSpeedKmh = 155;
            const isShallowHit = towardWall < shallowThreshold;
            const isCrashHit = towardWall >= crashAngleThreshold
                && speedN >= crashSpeedThresholdN
                && impactSpeedKmh >= crashMinSpeedKmh;

            if (isCrashHit && !this.isSpinning) {
                this.wallHitCount += 1;
                this.lastWallImpact = 0.95;
                this._triggerSpin(pushDir);
                this.spinTimer = Math.max(this.spinTimer, 1.0 + speedN * 0.55);
                this.spinAngularVelocity = Math.max(this.spinAngularVelocity, 10.0 + speedN * 5.0);
                this.speed *= 0.32;
                this.wallStunTimer = Math.max(this.wallStunTimer, 0.55);
                this.wallCounterSteerDir = pushDir;
                this.wallCounterSteerTimer = Math.max(this.wallCounterSteerTimer, 0.2);
            } else if (isShallowHit) {
                this.wallHitCount += 1;
                this.lastWallImpact = THREE.MathUtils.lerp(0.2, 0.45, speedN);
                const speedKeep = THREE.MathUtils.lerp(0.98, 0.94, speedN);
                this.speed *= speedKeep;
                // Extra centerward kick for visible "bounce" on shallow wall touches.
                const centerKick = THREE.MathUtils.lerp(0.16, 0.34, speedN);
                this.position.addScaledVector(wallNormal, centerKick);
                // Preserve forward progress by steering heading toward wall tangent, not away from travel.
                const tangent = moveDir.clone().projectOnPlane(wallNormal).normalize();
                if (tangent.lengthSq() > 1e-6) {
                    const tangentYaw = Math.atan2(tangent.x, tangent.z);
                    this.rotation = THREE.MathUtils.lerp(this.rotation, tangentYaw, 0.16);
                }
                this.wallStunTimer = Math.max(this.wallStunTimer, THREE.MathUtils.lerp(0.05, 0.14, speedN));
                this.wallCounterSteerDir = pushDir;
                this.wallCounterSteerTimer = Math.max(
                    this.wallCounterSteerTimer,
                    THREE.MathUtils.lerp(0.08, 0.18, speedN)
                );
            } else {
                const deepN = THREE.MathUtils.clamp(
                    (towardWall - shallowThreshold) / (crashAngleThreshold - shallowThreshold),
                    0,
                    1
                );
                const severity = THREE.MathUtils.clamp(deepN * (0.72 + 0.28 * speedN), 0, 1);
                this.wallHitCount += 1;
                this.lastWallImpact = THREE.MathUtils.lerp(0.45, 0.85, severity);
                const speedKeep = THREE.MathUtils.lerp(0.86, 0.66, severity);
                this.speed *= speedKeep;
                const tangent = moveDir.clone().projectOnPlane(wallNormal).normalize();
                if (tangent.lengthSq() > 1e-6) {
                    const tangentYaw = Math.atan2(tangent.x, tangent.z);
                    this.rotation = THREE.MathUtils.lerp(this.rotation, tangentYaw, 0.12);
                }
                const extraCenterKick = THREE.MathUtils.lerp(0.08, 0.2, severity);
                this.position.addScaledVector(wallNormal, extraCenterKick);
                this.wallStunTimer = Math.max(this.wallStunTimer, THREE.MathUtils.lerp(0.16, 0.34, severity));
                this.wallCounterSteerDir = pushDir;
                this.wallCounterSteerTimer = Math.max(
                    this.wallCounterSteerTimer,
                    THREE.MathUtils.lerp(0.14, 0.24, severity)
                );
            }

            // Re-sample after pushback so contact and orientation match corrected position.
            nearest = this.courseBuilder.getNearest(this.position, nearest.index);
            this.nearestIndex = nearest.index;
            this.trackT = nearest.t;
            this.onTrack = nearest.onTrack;
            this.surfaceUp.copy(nearest.sp.up);
            this.surfaceRight.copy(nearest.sp.right);
            this._updateTerrainSpeedFactor(nearest.sp);
            this._applyTrackEnvironment(nearest.sp);
            this._snapToSurfacePlane(nearest);

            // Ensure car faces track forward direction after wall hit.
            // If heading deviates too much, correct it to prevent reverse-facing.
            this._correctHeadingAfterWallHit(nearest.sp);
        } else if (lateralAbs > halfW - 1) {
            // Near wall: slight friction warning zone
            this.speed *= 0.995;
        }

        // Off-track (shouldn't happen with walls, but as fallback)
        if (!nearest.onTrack && Math.abs(this.speed) > 1) {
            this.speed *= 0.97;
        }

        this._tryTriggerJump(nearest.sp, throttle);
    }

    currentMaxSpeed() {
        const base = this.isBoosting ? this.boostMaxSpeed : this.maxSpeed;
        return base * this.terrainSpeedFactor * (1 + this.slipstreamFactor * 0.03);
    }

    getSpeedKmh() {
        return Math.abs(this.speed * MS_TO_KMH);
    }

    getGear() {
        return this.currentGear;
    }

    setSlipstreamFactor(factor) {
        this.slipstreamFactor = THREE.MathUtils.clamp(factor, 0, 1);
    }

    getRearEffectAnchors() {
        const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation))
            .projectOnPlane(this.surfaceUp)
            .normalize();
        if (forward.lengthSq() < 1e-6) {
            forward.set(0, 0, 1);
        }
        const right = this.surfaceRight.clone().normalize();
        const rearCenter = this.position.clone().addScaledVector(forward, -1.7).addScaledVector(this.surfaceUp, 0.15);
        return {
            left: rearCenter.clone().addScaledVector(right, -0.9),
            right: rearCenter.clone().addScaledVector(right, 0.9),
            forward,
            up: this.surfaceUp.clone(),
        };
    }

    addToScene(scene) {
        this.model.addToScene(scene);
    }

    _updateModelOrientation() {
        // During drift, the body follows the flow direction while the nose is
        // rotated inward for the classic arcade drift look.
        const speedAbs = Math.abs(this.speed);
        const flowYaw = this.isDrifting
            ? this.rotation - this.driftAngle * this._getDriftSlipFactor(speedAbs)
            : this.rotation;
        const visualYaw = this.isDrifting ? -this.driftNoseYaw : 0;
        const desiredForward = new THREE.Vector3(
            Math.sin(flowYaw + visualYaw),
            0,
            Math.cos(flowYaw + visualYaw)
        );
        const forward = desiredForward.projectOnPlane(this.surfaceUp).normalize();
        if (forward.lengthSq() < 1e-5) {
            forward.set(0, 0, 1);
        }

        // Right-handed basis: right = up x forward
        const right = new THREE.Vector3().crossVectors(this.surfaceUp, forward).normalize();
        const up = new THREE.Vector3().crossVectors(forward, right).normalize();

        const basis = new THREE.Matrix4().makeBasis(right, up, forward);
        this.model.group.quaternion.setFromRotationMatrix(basis);

        // Keep a small arcade-style steering roll on top of bank alignment.
        const steerRoll = this.steering * 0.08 * Math.min(1, Math.abs(this.speed) / 10);
        if (Math.abs(steerRoll) > 1e-4) {
            const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), steerRoll);
            this.model.group.quaternion.multiply(rollQ);
        }
    }

    _snapToSurfacePlane(nearest) {
        const rel = this.position.clone().sub(nearest.sp.position);
        const normalDist = rel.dot(nearest.sp.up);
        this.position.addScaledVector(nearest.sp.up, -normalDist + ROAD_SURFACE_OFFSET);
    }

    _updateTerrainSpeedFactor(samplePoint) {
        const travelSign = this.speed >= 0 ? 1 : -1;
        const forward = samplePoint.forward.clone().normalize().multiplyScalar(travelSign);
        const grade = THREE.MathUtils.clamp(forward.y, -0.35, 0.35);

        let target = 1.0;
        if (grade > 0) {
            const uphillN = THREE.MathUtils.clamp(grade / TERRAIN_SPEED_TUNING.uphillGradeRef, 0, 1);
            target -= TERRAIN_SPEED_TUNING.uphillPenaltyMax * uphillN;
        } else if (grade < 0) {
            const downhillN = THREE.MathUtils.clamp((-grade) / TERRAIN_SPEED_TUNING.downhillGradeRef, 0, 1);
            target += TERRAIN_SPEED_TUNING.downhillBonusMax * downhillN;
        }

        this.terrainSpeedFactor = THREE.MathUtils.lerp(
            this.terrainSpeedFactor,
            THREE.MathUtils.clamp(target, 0.84, 1.08),
            TERRAIN_SPEED_TUNING.smoothLerp
        );
    }

    _applyTrackEnvironment(samplePoint) {
        this.surfaceGrip = samplePoint.grip ?? 1.0;
        this.surfaceType = samplePoint.surfaceType ?? 'asphalt';
        this.isInTunnel = (samplePoint.tunnelLighting ?? 1) < 0.99;
    }

    _tryTriggerJump(samplePoint, throttle) {
        const jump = samplePoint.jump;
        if (!jump) {
            this._activeJumpZoneKey = null;
            return;
        }

        const zoneKey = `${jump.start}:${jump.end}`;
        if (this._activeJumpZoneKey === zoneKey) {
            return;
        }
        if (Math.abs(this.speed) < this.maxSpeed * 0.42) {
            return;
        }

        const speedAbs = Math.abs(this.speed);
        const speedN = THREE.MathUtils.clamp(speedAbs / this.maxSpeed, 0, 1.08);
        const uphillN = THREE.MathUtils.clamp(samplePoint.forward.y / 0.18, 0, 1);
        const baseImpulse = jump.impulse ?? 8;
        const targetImpulse = (
            baseImpulse * THREE.MathUtils.lerp(0.82, 1.0, speedN)
            + uphillN * 1.1
        ) * this.jumpTuning.launchLift;
        const airtime = (0.24 + Math.max(0, targetImpulse - 5.8) * 0.05) * this.jumpTuning.airtimeScale;

        this._activeJumpZoneKey = zoneKey;
        this.airborneTimer = Math.max(this.airborneTimer, THREE.MathUtils.clamp(airtime, 0.22, 0.44));
        this.verticalVelocity = Math.max(this.verticalVelocity, targetImpulse);
        this.landingBoostWindow = Math.max(this.landingBoostWindow, jump.boostWindow ?? 0.3);
        if (throttle > 0.2) {
            this.speed = Math.min(
                this.speed + this.acceleration * this.jumpTuning.throttleKick,
                this.currentMaxSpeed() * 1.02
            );
        }
    }

    _updateAirborneState(dt, throttle) {
        if (this.landingBoostWindow > 0) {
            this.landingBoostWindow = Math.max(0, this.landingBoostWindow - dt);
        }
        if (this.airborneTimer <= 0) {
            return;
        }

        this.airborneTimer = Math.max(0, this.airborneTimer - dt);
        this.verticalVelocity -= 23 * this.jumpTuning.gravityScale * dt;
        this.position.y += this.verticalVelocity * dt;

        const nearest = this.courseBuilder?.getNearest?.(this.position, this.nearestIndex);
        if (!nearest) {
            return;
        }

        const rel = this.position.clone().sub(nearest.sp.position);
        const surfaceY = nearest.sp.position.clone()
            .addScaledVector(nearest.sp.up, ROAD_SURFACE_OFFSET)
            .dot(new THREE.Vector3(0, 1, 0));

        if (this.airborneTimer <= 0 || this.position.y <= surfaceY) {
            this.position.copy(nearest.sp.position).addScaledVector(nearest.sp.up, ROAD_SURFACE_OFFSET);
            this.surfaceUp.copy(nearest.sp.up);
            this.surfaceRight.copy(nearest.sp.right);
            this.verticalVelocity = 0;
            this.airborneTimer = 0;
            if (this.landingBoostWindow > 0 && throttle > 0.25) {
                this.boostTimer = Math.max(this.boostTimer, 0.3);
                this.isBoosting = true;
            }
            this.landingBoostWindow = 0;
            if (rel.lengthSq() > 0) {
                this.speed = Math.min(this.speed * 1.01, this.currentMaxSpeed() * 1.06);
            }
        }
    }

    startAutoDrive(targetSpeedRatio = 0.55) {
        this.autoDrive = true;
        this.autoDriveSpeed = this.maxSpeed * targetSpeedRatio;
        this.currentGear = 3;
        this._autoDriveIdx = this.nearestIndex;
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftNoseYaw = 0;
        this.driftTimer = 0;
        this.driftMaxDuration = DRIFT_TUNING.maxDurationSec;
        this.driftCounterSteerExitTimer = 0;
        this.isBoosting = false;
        this.boostTimer = 0;
        this.controlsEnabled = false;
        this.prevSteerInput = 0;
        this.driftEntryBrakeWindow = 0;
        this.prevBrakePressed = false;
    }

    stopAutoDrive(enableControls = true) {
        this.autoDrive = false;
        this.autoDriveSpeed = 0;
        this._autoDriveIdx = this.nearestIndex;
        if (enableControls) {
            this.controlsEnabled = true;
        }
    }

    _updateAutoDrive(dt) {
        if (!this.courseBuilder || !this.courseBuilder.sampledPoints.length) return;

        const N = this.courseBuilder.sampledPoints.length;

        // Smoothly converge toward target speed without oscillation.
        // Using exponential lerp avoids the overshoot/undershoot cycle
        // that occurs with separate accel/decel branches.
        const targetSpeed = this.autoDriveSpeed;
        const speedLerp = 1 - Math.exp(-3.0 * dt);
        this.speed = this.speed + (targetSpeed - this.speed) * speedLerp;
        this._updateAutoGear();

        // Advance fractional spline index by distance travelled
        const dist = this.speed * dt;
        const samplesPerMeter = N / this.courseBuilder.courseLength;
        this._autoDriveIdx = (this._autoDriveIdx + dist * samplesPerMeter + N) % N;
        const rawIdx = (this._autoDriveIdx + N) % N;
        const i0 = Math.floor(rawIdx) % N;
        const i1 = (i0 + 1) % N;
        const sampleAlpha = rawIdx - Math.floor(rawIdx);
        const sp0 = this.courseBuilder.sampledPoints[i0];
        const sp1 = this.courseBuilder.sampledPoints[i1];
        const interpPos = sp0.position.clone().lerp(sp1.position, sampleAlpha);
        const interpUp = sp0.up.clone().lerp(sp1.up, sampleAlpha).normalize();
        const interpRight = sp0.right.clone().lerp(sp1.right, sampleAlpha).normalize();
        const newIdx = Math.round(rawIdx) % N;

        // Look ahead for smooth heading
        const lookAhead = Math.max(3, Math.floor(N * 0.012));
        const aheadRaw = (rawIdx + lookAhead) % N;
        const aheadI0 = Math.floor(aheadRaw) % N;
        const aheadI1 = (aheadI0 + 1) % N;
        const aheadAlpha = aheadRaw - Math.floor(aheadRaw);
        const aheadPos = this.courseBuilder.sampledPoints[aheadI0].position
            .clone()
            .lerp(this.courseBuilder.sampledPoints[aheadI1].position, aheadAlpha);

        // Position: follow the interpolated spline position to keep
        // track progress continuous for nearby AI post-finish logic.
        const lerpRate = 1 - Math.exp(-8.0 * dt);
        this.position.lerp(
            interpPos.clone().addScaledVector(interpUp, ROAD_SURFACE_OFFSET),
            lerpRate
        );

        // Heading: face toward the look-ahead point
        const targetAngle = Math.atan2(aheadPos.x - interpPos.x, aheadPos.z - interpPos.z);
        let angleDiff = targetAngle - this.rotation;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.rotation += angleDiff * Math.min(1, dt * 8);

        // Small visual steering for natural look
        this.steering = THREE.MathUtils.lerp(this.steering, THREE.MathUtils.clamp(angleDiff * 1.5, -0.3, 0.3), dt * 6);

        // Update tracking state
        this.nearestIndex = newIdx;
        this.trackT = rawIdx / N;
        this.onTrack = true;
        this.surfaceUp.copy(interpUp);
        this.surfaceRight.copy(interpRight);

        // Decay drift visuals
        this.driftAngle *= Math.pow(0.1, dt);
        this.driftNoseYaw *= Math.pow(0.1, dt);

        // Update visual model
        this.model.group.position.copy(this.position);
        this._updateModelOrientation();
        this.model.updateWheelRotation(this.speed);
    }

    resetToStart(startPos, startRot, startSample = null) {
        this.position.set(startPos.x, startPos.y, startPos.z);
        this.rotation = startRot;
        this.speed = 0;
        this.steering = 0;
        this.isDrifting = false;
        this.driftAngle = 0;
        this.driftNoseYaw = 0;
        this.driftStability = 0;
        this.driftQuality = 0;
        this.driftEntrySpeed = 0;
        this.driftTimer = 0;
        this.driftMaxDuration = DRIFT_TUNING.maxDurationSec;
        this.driftCounterSteerExitTimer = 0;
        this.driftEntryBrakeWindow = 0;
        this.prevBrakePressed = false;
        this.steerHoldTime = 0;
        this.steerHoldDir = 0;
        this.prevSteerInput = 0;
        this.isBoosting = false;
        this.boostTimer = 0;
        this.slipstreamFactor = 0;
        this.wallStunTimer = 0;
        this.wallCounterSteerTimer = 0;
        this.wallCounterSteerDir = 0;
        this.isSpinning = false;
        this.spinTimer = 0;
        this.spinAngularVelocity = 0;
        this.spinDirection = 1;
        this.driftExitTractionTimer = 0;
        this.terrainSpeedFactor = 1.0;
        this.wallHitCount = 0;
        this.lastWallImpact = 0;
        this.spinOutCount = 0;
        this.collisionImmunityTimer = 0;
        this.autoDrive = false;
        this.autoDriveSpeed = 0;
        this._autoDriveIdx = 0;
        this.currentGear = 1;
        this.surfaceGrip = 1.0;
        this.surfaceType = 'asphalt';
        this.isInTunnel = false;
        this.airborneTimer = 0;
        this.verticalVelocity = 0;
        this.landingBoostWindow = 0;
        this._activeJumpZoneKey = null;
        if (startSample) {
            this.nearestIndex = startSample.index ?? this.nearestIndex;
            this.trackT = startSample.t ?? this.trackT;
            if (startSample.up) this.surfaceUp.copy(startSample.up);
            else this.surfaceUp.set(0, 1, 0);
            if (startSample.right) this.surfaceRight.copy(startSample.right);
            else this.surfaceRight.set(1, 0, 0);
            this.onTrack = true;
        } else {
            this.nearestIndex = 0;
            this.trackT = 0;
            this.surfaceUp.set(0, 1, 0);
            this.surfaceRight.set(1, 0, 0);
            this.onTrack = true;
        }
        this.model.group.position.copy(this.position);
        this._updateModelOrientation();
    }
}
