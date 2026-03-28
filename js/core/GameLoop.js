import { FIXED_TIMESTEP, MAX_SUBSTEPS } from './Constants.js';

export class GameLoop {
    constructor() {
        this.lastTime = 0;
        this.accumulator = 0;
        this.running = false;
        this.timeScale = 1;
        this._timeScaleTimer = 0;
        this.debugPaused = false;
        this._debugStepOnce = false;
        this.fixedUpdateCallbacks = [];
        this.renderCallbacks = [];
        this._boundLoop = this._loop.bind(this);
        this._rafId = 0;
    }

    onFixedUpdate(callback) {
        this.fixedUpdateCallbacks.push(callback);
    }

    onRender(callback) {
        this.renderCallbacks.push(callback);
    }

    start() {
        this.running = true;
        this.lastTime = performance.now();
        this._rafId = requestAnimationFrame(this._boundLoop);
    }

    stop() {
        this.running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
    }

    setTimeScale(scale, duration = 0) {
        this.timeScale = Math.max(0.05, scale);
        this._timeScaleTimer = Math.max(0, duration);
    }

    setDebugPaused(paused) {
        this.debugPaused = paused;
        this._debugStepOnce = false;
    }

    debugStep() {
        if (this.debugPaused) {
            this._debugStepOnce = true;
        }
    }

    _loop(timestamp) {
        if (!this.running) return;

        const rawDeltaTime = Math.max(0, Math.min((timestamp - this.lastTime) / 1000, 0.1));
        this.lastTime = timestamp;

        // Debug pause: still run render callbacks (for camera/UI) but skip simulation
        if (this.debugPaused && !this._debugStepOnce) {
            for (const cb of this.renderCallbacks) {
                cb(0, 0, rawDeltaTime);
            }
            this._rafId = requestAnimationFrame(this._boundLoop);
            return;
        }

        // When stepping, advance exactly one fixed timestep
        const stepping = this.debugPaused && this._debugStepOnce;
        this._debugStepOnce = false;

        if (this._timeScaleTimer > 0) {
            this._timeScaleTimer -= rawDeltaTime;
            if (this._timeScaleTimer <= 0) {
                this.timeScale = 1;
                this._timeScaleTimer = 0;
            }
        }
        const scaledDeltaTime = stepping ? FIXED_TIMESTEP * this.timeScale : rawDeltaTime * this.timeScale;
        const scaledFixedTime = FIXED_TIMESTEP * this.timeScale;

        if (stepping) {
            for (const cb of this.fixedUpdateCallbacks) {
                cb(scaledFixedTime);
            }
        } else {
            this.accumulator += rawDeltaTime;
            let steps = 0;
            while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_SUBSTEPS) {
                for (const cb of this.fixedUpdateCallbacks) {
                    cb(scaledFixedTime);
                }
                this.accumulator -= FIXED_TIMESTEP;
                steps++;
            }
        }

        const alpha = stepping ? 1 : this.accumulator / FIXED_TIMESTEP;
        for (const cb of this.renderCallbacks) {
            cb(scaledDeltaTime, alpha, rawDeltaTime);
        }

        this._rafId = requestAnimationFrame(this._boundLoop);
    }
}
