/**
 * Race timer: manages countdown time limit and lap time tracking.
 */
export class Timer {
    constructor(initialTime) {
        this.remainingTime = Number.isFinite(initialTime) ? initialTime : Infinity;  // seconds
        this.totalElapsed = 0;             // total race time
        this.lapStartTime = 0;             // elapsed time at current lap start
        this.currentLapTime = 0;
        this.bestLapTime = Infinity;
        this.lapTimes = [];                // completed lap times
        this.running = false;
        this.expired = false;
        this.hasLimit = Number.isFinite(initialTime);
    }

    start() {
        this.running = true;
        this.lapStartTime = 0;
        this.totalElapsed = 0;
    }

    update(dt) {
        if (!this.running) return;

        this.totalElapsed += dt;
        this.currentLapTime = this.totalElapsed - this.lapStartTime;
        if (this.hasLimit) {
            this.remainingTime -= dt;
        }

        if (this.hasLimit && this.remainingTime <= 0) {
            this.remainingTime = 0;
            this.expired = true;
            this.running = false;
        }
    }

    extendTime(seconds) {
        if (!this.hasLimit) return;
        this.remainingTime += seconds;
    }

    completeLap() {
        const lapTime = this.currentLapTime;
        this.lapTimes.push(lapTime);
        if (lapTime < this.bestLapTime) {
            this.bestLapTime = lapTime;
        }
        this.lapStartTime = this.totalElapsed;
        this.currentLapTime = 0;
        return lapTime;
    }

    stop() {
        this.running = false;
    }

    getRemainingTimeFormatted() {
        if (!this.hasLimit) return '--:--';
        const t = Math.max(0, Math.ceil(this.remainingTime));
        const min = Math.floor(t / 60);
        const sec = t % 60;
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    getTotalTimeFormatted() {
        return this._formatTime(this.totalElapsed);
    }

    getBestLapFormatted() {
        if (this.bestLapTime === Infinity) return '--:--.---';
        return this._formatTime(this.bestLapTime);
    }

    getCurrentLapFormatted() {
        return this._formatTime(this.currentLapTime);
    }

    _formatTime(seconds) {
        const totalMs = Math.floor(seconds * 1000);
        const min = Math.floor(totalMs / 60000);
        const sec = Math.floor((totalMs % 60000) / 1000);
        const ms = totalMs % 1000;
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
}
