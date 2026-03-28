---
name: game-debug
description: Debug and tune OVAL RUSH racing game - vehicle physics, AI behavior, course parameters, and race logic. Use when adjusting drift, speed, handling, AI difficulty, rubber-banding, course layout, collision, slipstream, or any gameplay tuning. Also use when investigating bugs in car behavior, race progression, checkpoint detection, or visual effects.
---

# OVAL RUSH Debug & Tuning Skill

You are debugging and tuning a 3D arcade racing game (Three.js). Follow this guide to efficiently locate, understand, and modify game parameters.

## Debug Mode Activation

- URL: `?debug=1` or set `launchOptions.debugUnlocked = true`
- In-game: F1 toggles debug mode (only during racing)

### Debug Hotkeys (debug mode active)

| Key | Action |
|-----|--------|
| F1  | Exit debug mode |
| F2  | Cycle focus: PLAYER → NEAREST_AI → COURSE |
| F3  | Toggle wireframe |
| F4  | Reset debug camera |
| F6  | Toggle AI visibility |
| F8  | Cycle time scale: 1x → 0.5x → 0.25x → 0.1x (also unpauses) |
| F9  | Pause / Step one frame |

Camera: LMB drag = yaw/pitch, WASD = pan, Q/E = vertical, Scroll = zoom.

## Architecture Quick Reference

```
js/
├── main.js                    # Game class, debug orchestration, race setup
├── core/
│   ├── GameLoop.js            # Fixed timestep loop, timeScale, debugPaused
│   └── Constants.js           # Physics/camera/race constants
├── vehicles/
│   ├── PlayerVehicle.js       # Player physics, drift, terrain, gears
│   ├── AIVehicle.js           # AI vehicle state and properties
│   ├── VehicleModel.js        # 3D model, wheels, lights
│   └── VehicleParams.js       # Vehicle presets (Falcon/Bolt/Ironclad)
├── ai/
│   ├── AIController.js        # AI tuning, rubber-banding, difficulty
│   └── Waypoint.js            # Waypoint generation, curvature, suggested speed
├── courses/
│   ├── CourseBuilder.js        # 3D course, collision, getNearest()
│   └── CourseData.js           # Course definitions (Thunder/Seaside/Mountain)
├── race/
│   ├── RaceManager.js          # State machine, lap/checkpoint validation
│   ├── Timer.js                # Countdown and lap timing
│   └── Checkpoint.js           # Checkpoint crossing detection
├── effects/
│   ├── SlipstreamSystem.js     # Slipstream detection (3-15m, 10deg cone)
│   ├── TrackEffects.js         # Tire smoke, skid marks
│   └── BoostFX.js              # Boost visual overlay
├── graphics/
│   ├── Renderer.js             # Scene, fog, lighting, shadows
│   ├── CameraController.js     # Chase/bumper/overhead/debug cameras
│   ├── HUD.js                  # Speed, gear, debug panel
│   └── Minimap.js              # Course minimap
├── audio/
│   └── AudioManager.js         # BGM, SFX, engine sound synthesis
├── input/
│   └── InputManager.js         # Keyboard, gamepad, touch, gyro, debug keys
└── ui/
    └── UIManager.js            # Title/select/options screens
```

## Tuning Parameter Map

### Player Vehicle Physics

**File: `js/vehicles/PlayerVehicle.js`**

#### Core Physics (set in constructor from VehicleParams)
- `maxSpeed` — Top speed in m/s (from preset maxSpeedKmh / 3.6)
- `acceleration` — Acceleration in m/s² (from preset accelerationKmh / 3.6)
- `brakeForce` — Brake deceleration (DEFAULT_BRAKE_FORCE = 55.6 m/s²)
- `steeringSpeed` — Steering input rate (2.5 * handling)
- `maxSteering` — Max steer angle (0.6 * (0.95 + handling * 0.08))
- `turnBaseRate` — Low-speed turn rate (1.8 * handling)
- `turnSpeedRate` — Speed-dependent turn rate
- `friction` — Per-frame velocity retention (0.999 ≈ 6%/s loss)
- `dragFactor` — Aerodynamic drag (0.35)
- `driftBias` — Drift propensity multiplier (Falcon=1.0, Bolt=1.2, Ironclad=0.82)

#### Drift Tuning (DRIFT_TUNING object, ~60 params)

**Entry conditions:**
- `entrySpeedRatio: 0.30` — Min speed ratio to start drift
- `entrySteerMin: 0.78` — Min steering input
- `entryBrakeWindowSec: 0.2` — Brake-trigger window

**Drift angle & feel:**
- `angleBase: 0.34` — Base drift angle (rad)
- `angleSteerScale: 0.92` — Steering influence on angle
- `angleLerp: 5.0` — Angle interpolation speed
- `slipMin/slipMax: 0.3/0.4` — Slip range

**Quality scoring:**
- `qualityAngleMin/Max: 0.26/0.72` — Sweet spot angle range
- `qualityBuildRate: 4.5` — Quality buildup speed
- `qualityDecayRate: 2.2` — Quality decay speed

**Spin protection:**
- `spinThreshold: 1.45` — Angle threshold for spin-out
- `maxDurationSec: 3.0` — Max drift duration before forced exit

**Curve assist (keeps car on track during drift):**
- `curveAssistYawRate: 8.8` — Auto-yaw correction strength
- `curveAssistMaxAngle: 0.96` — Max assist angle
- `centerAssistOffsetGain: 3.6` — Center-line pull strength

**Boost on exit:**
- `exitBoostMinSec/MaxSec: 0.08/0.18` — Boost duration range
- `exitTractionAccelLow/High: 0.05/0.09` — Post-drift acceleration bonus

#### Terrain Speed (TERRAIN_SPEED_TUNING)
- `uphillPenaltyMax: 0.12` — Max uphill speed reduction (12%)
- `downhillBonusMax: 0.06` — Max downhill speed bonus (6%)

#### Jump Tuning (per vehicle preset)
- `launchLift` — Jump impulse multiplier (0.78-0.9)
- `airtimeScale` — Airtime physics scale
- `gravityScale` — Gravity multiplier (1.0-1.12)
- `throttleKick` — Throttle bonus in air

#### Gear Table (per vehicle preset)
Each gear: `{ ratio, speedRange: [min, max] kmh, upShift, downShift }`
4 gears, ratio affects torque curve via `_getDriveForceFactor()`.

### Vehicle Presets

**File: `js/vehicles/VehicleParams.js`**

| Param | Falcon MK-I | Bolt RS | Ironclad GT |
|-------|------------|---------|-------------|
| maxSpeedKmh | 286 | 326 | 270 |
| accelerationKmh | 126 | 98 | 148 |
| handling | 1.0 | 0.84 | 1.22 |
| driftBias | 1.0 | 1.2 | 0.82 |
| modelScale | 1.0 | 0.98 | 1.05 |

Falcon = balanced, Bolt = top speed + drift-prone, Ironclad = acceleration + grip.

### AI System

**File: `js/ai/AIController.js`**

#### DEFAULT_TUNING sections:

**Waypoint navigation:**
- `waypoint.step: 8` — Sample interval
- `waypoint.lookAheadT: 0.012` — Look-ahead distance (normalized)
- `waypoint.lookAheadOffsets: [0.01, 0.02, 0.034, 0.05]` — Multi-point preview

**Speed control:**
- `speed.targetSmoothing: 0.28` — Target speed smoothing
- `speed.launchBoostSec: 2.5` — Start boost duration
- `speed.launchAccelScale: 2.0` — Start boost multiplier

**AI drift:**
- `drift.curvatureEnter: 0.16` — Curvature threshold to start drift
- `drift.maxAngle: 0.34` — Max AI drift angle
- `drift.cornerSpeedPenalty: 0.985` — Speed loss in corners

**Lane control (14 params):**
- `lane.returnToCenter: 0.035` — Center-seeking strength
- `lane.overtakeSideOffset: 2.8` — Overtake lateral distance
- `lane.wallMargin: 1.2` — Wall avoidance margin
- Racing line params: `lookAhead`, `outerRatio`, `innerRatio`, `curveRef`

**Collision (24 params):**
- `collision.minDist: 3.3` — AI-AI min distance
- `collision.minPlayerDist: 3.0` — AI-player min distance
- `collision.playerSpeedLoss: 0.976` — Player speed loss on AI collision

#### Difficulty Presets

| Param | EASY | NORMAL | HARD |
|-------|------|--------|------|
| speedScale | 1.00 | 1.09 | 1.13 |
| rbBehindFar | 1.20 | 1.24 | 1.20 |
| rbAheadFar | 0.985 | 0.993 | 0.998 |
| rbAheadGraceSec | 8.0 | 10.0 | 12.0 |

Rubber-banding: AI behind player speeds up (rbBehind*), AI ahead slows down (rbAhead*).

#### Course-Specific AI Overrides (COURSE_TUNING)
- Thunder: wider lookAhead, lower avoidNudge (0.70)
- Seaside: tighter collision (minDist=2.5), weaker rubber-band
- Mountain: widest lookAhead, smallest collision dist (2.45), stronger wallMargin (1.35)

### AI Vehicle Properties

**File: `js/vehicles/AIVehicle.js`**

Per-vehicle personality traits (0-1 range):
- `aggression` — Overtake aggressiveness
- `stability` — Line-holding tendency
- `linePrecision` — Racing line accuracy
- `packAvoidance` — Tendency to avoid clusters
- `spacingBias` — Preferred inter-car spacing
- `preferredLaneBias` — Left/right lane preference (-1..1)

### Course Definitions

**File: `js/courses/CourseData.js`**

| Param | Thunder | Seaside | Mountain |
|-------|---------|---------|----------|
| laps | 8 | 4 | 2 |
| initialTime | 40s | 45s | 50s |
| checkpointExt | 12s | 14s | 16s |
| gridSize | 12 | 10 | 8 |
| roadWidth | 20m | 16m | 13m |
| rollingStart | yes | no | no |
| scale | 1x | 1.5x | 2x |

Special zones defined via `specialZones` array:
- `tunnel` — Reduced lighting (Seaside t=0.63-0.76)
- `lowGrip` — Reduced traction (Seaside t=0.79-0.93, grip=0.84)
- `jump` — Launch ramp (Mountain t=0.18-0.205, t=0.69-0.715)
- `mist` — Fog effect (Mountain t=0.05-0.18, t=0.30-0.47)
- `cloudBreak` — Cloud breakthrough (Mountain t=0.30-0.47)

### Slipstream

**File: `js/effects/SlipstreamSystem.js`**

- Detection: 3-15m range, 10-degree forward cone
- `rampUpSec: 1.5` — Time to full effect
- `rampDownSec: 0.45` — Time to decay
- Visual: cyan lines (#7ce8ff)

### Race State Machine

**File: `js/race/RaceManager.js`**

```
idle → grid_intro → countdown → racing → finish_celebration → finished | gameover
```

- Lap validation: requires all checkpoints passed before start-line crossing counts
- Player progress clamped by checkpoint milestones (anti-exploit)
- `debugEnabled` flag enables AI debug text in HUD

### Physics Constants

**File: `js/core/Constants.js`**

```
FIXED_TIMESTEP: 1/60
MAX_SUBSTEPS: 5
DEFAULT_MAX_SPEED: 280 km/h (77.8 m/s)
DEFAULT_ACCELERATION: 120 km/h/s (33.3 m/s²)
DEFAULT_BRAKE_FORCE: 200 km/h/s (55.6 m/s²)
CAMERA_CHASE_DISTANCE: 6.5m
CAMERA_CHASE_HEIGHT: 3.5m
CAMERA_BASE_FOV: 75
RACE_COUNTDOWN_DURATION: 3.5s
```

## Common Debugging Workflows

### 1. Drift Feel Adjustment
1. Open `js/vehicles/PlayerVehicle.js`, locate `DRIFT_TUNING`
2. Use debug mode (F1) + time scale (F8 to 0.25x) to observe drift frame-by-frame
3. Key params to adjust:
   - Too hard to start drift → lower `entrySpeedRatio` or `entrySteerMin`
   - Drift too snappy → increase `angleLerp`
   - Spins out too easily → raise `spinThreshold` or lower `angleBase`
   - Drift exits poorly → tune `exitAlignAngle`, `exitBoostMinSec`
   - Car leaves track → increase `curveAssistYawRate` or `centerAssistOffsetGain`
4. Test with all 3 vehicles — `driftBias` in VehicleParams scales many drift params

### 2. AI Difficulty Balance
1. Open `js/ai/AIController.js`, locate difficulty presets (~line 91)
2. Use debug mode (F2 to focus NEAREST_AI, F6 to show AI)
3. Key adjustments:
   - AI too fast/slow → adjust `speedScale`
   - AI catches up too aggressively → lower `rbBehindFar`/`rbBehindNear`
   - AI leader never slows → lower `rbAheadFar` (values < 1.0 slow AI)
   - Grace period too long → reduce `rbAheadGraceSec`
4. Check course-specific overrides in `COURSE_TUNING` (~line 131)

### 3. Course Collision Issues
1. Open `js/courses/CourseBuilder.js`, check `getNearest()` (~line 3452)
2. Use debug wireframe (F3) to see road mesh boundaries
3. Common issues:
   - Car clips through wall → check wall height (1.0m default) or collision search range
   - Car stuck on surface → check `ROAD_SURFACE_OFFSET` (0.05m)
   - Wrong surface type → check `getEnvironmentState()` and special zone t-ranges

### 4. Race Progression Bugs
1. Set `?debug=1&aiDebug=1` in URL for full debug output
2. Check `RaceManager.state` in debug panel
3. Common issues:
   - Lap not counting → verify checkpoints passed (Checkpoint.js `_crossed()`)
   - Timer not extending → check `checkpointExtension` in CourseData
   - Wrong finish position → check `_finishOrder` array in RaceManager

### 5. AI Pathfinding Issues
1. Open `js/ai/Waypoint.js` to check waypoint generation
2. Focus on nearest AI (F2), show AI (F6), slow time (F8)
3. Key params:
   - AI cuts corners → increase `lane.wallMargin`
   - AI bunches up → increase `collision.minDist` or `lane.avoidCloseT`
   - AI doesn't overtake → increase `lane.overtakeCommit` or `aggression`
   - AI wobbles → increase `lane.offsetLerp` (smoother lane changes)

### 6. Slipstream Tuning
1. Open `js/effects/SlipstreamSystem.js`
2. Visual feedback: cyan lines appear when active
3. Adjustments:
   - Too easy to get → decrease `maxDistance` or `maxAngleDeg`
   - Effect too weak → handled in PlayerVehicle (speed bonus application)
   - Ramp feels wrong → adjust `rampUpSec`/`rampDownSec`

## Important Relationships

- `VehicleParams.handling` multiplies into `steeringSpeed`, `maxSteering`, `turnBaseRate`
- `VehicleParams.driftBias` scales drift entry/hold thresholds
- AI `speedScale` multiplies base `maxSpeed` for all AI vehicles
- Rubber-band values are speed multipliers: >1.0 speeds up, <1.0 slows down
- Course scale (1x/1.5x/2x) affects track length and thus AI lookAhead effectiveness
- `FIXED_TIMESTEP` (1/60) is the simulation tick — all per-second rates use this as base

## Debug Panel Fields

When debug mode is active, the HUD shows:
```
DEBUG INSPECTOR
FOCUS [PLAYER MODEL | NEAREST AI #N | COURSE OVERVIEW]
WIREFRAME [ON | OFF]
AI [VISIBLE | HIDDEN]
TIME [1x | 0.5x | 0.25x | 0.1x | PAUSED (F9 STEP)]
RACE [state]  POS [position]/[total]
PLAYER [speed]KMH T [trackT]
AI#[id] [speed]KMH LANE [offset] T [progressT]
CAM [x], [y], [z]
```
