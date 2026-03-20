// Physics constants
export const FIXED_TIMESTEP = 1 / 60;
export const MAX_SUBSTEPS = 5;
export const RACE_COUNTDOWN_DURATION = 3.5;
export const ROLLING_START_GRID_INTRO_DURATION = 2.8;

// Vehicle defaults
export const DEFAULT_MAX_SPEED = 280;       // km/h
export const DEFAULT_ACCELERATION = 120;    // km/h per second
export const DEFAULT_BRAKE_FORCE = 200;     // km/h per second
export const DEFAULT_STEERING_SPEED = 2.5;  // radians per second
export const DEFAULT_STEERING_RETURN = 5.0; // steering return to center speed
export const DEFAULT_MAX_STEERING = 0.6;    // max steering angle (radians)
export const DEFAULT_TURN_BASE_RATE = 1.8;  // base turn rate at low speed (rad/s at full steer)
export const DEFAULT_TURN_SPEED_RATE = 1.0; // additional turn rate scaled by speed
export const DEFAULT_FRICTION = 0.999;      // per-frame velocity retention (≈6% loss/sec)
export const DEFAULT_DRAG = 0.35;           // air resistance factor

// Speed conversion
export const KMH_TO_MS = 1 / 3.6;          // km/h -> m/s
export const MS_TO_KMH = 3.6;              // m/s -> km/h

// Camera
export const CAMERA_CHASE_DISTANCE = 6.5;   // meters behind vehicle
export const CAMERA_CHASE_HEIGHT = 3.5;     // meters above vehicle
export const CAMERA_CHASE_LOOK_AHEAD = 10;  // look ahead distance
export const CAMERA_SMOOTHING = 5.0;        // camera lerp speed
export const CAMERA_BASE_FOV = 75;
export const CAMERA_MAX_FOV_BOOST = 10;     // extra FOV at max speed

// World
export const GROUND_SIZE = 2400;            // ground plane size for the expanded mid/high-tier tracks
export const GRID_DIVISIONS = 50;
