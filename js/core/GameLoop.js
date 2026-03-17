import { FIXED_TIMESTEP, MAX_SUBSTEPS } from './Constants.js';

export class GameLoop {
    constructor() {
        this.lastTime = 0;
        this.accumulator = 0;
        this.running = false;
        this.timeScale = 1;
        this._timeScaleTimer = 0;
        this.fixedUpdateCallbacks = [];
        this.renderCallbacks = [];
        this._boundLoop = this._loop.bind(this);
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
        requestAnimationFrame(this._boundLoop);
    }

    stop() {
        this.running = false;
    }

    setTimeScale(scale, duration = 0) {
        this.timeScale = Math.max(0.05, scale);
        this._timeScaleTimer = Math.max(0, duration);
    }

    _loop(timestamp) {
        if (!this.running) return;

        const rawDeltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
        this.lastTime = timestamp;
        if (this._timeScaleTimer > 0) {
            this._timeScaleTimer -= rawDeltaTime;
            if (this._timeScaleTimer <= 0) {
                this.timeScale = 1;
                this._timeScaleTimer = 0;
            }
        }
        const scaledDeltaTime = rawDeltaTime * this.timeScale;
        const scaledFixedTime = FIXED_TIMESTEP * this.timeScale;
        this.accumulator += rawDeltaTime;

        let steps = 0;
        while (this.accumulator >= FIXED_TIMESTEP && steps < MAX_SUBSTEPS) {
            for (const cb of this.fixedUpdateCallbacks) {
                cb(scaledFixedTime);
            }
            this.accumulator -= FIXED_TIMESTEP;
            steps++;
        }

        const alpha = this.accumulator / FIXED_TIMESTEP;
        for (const cb of this.renderCallbacks) {
            cb(scaledDeltaTime, alpha, rawDeltaTime);
        }

        requestAnimationFrame(this._boundLoop);
    }
}
