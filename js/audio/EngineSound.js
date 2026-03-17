export class EngineSound {
    constructor(audioContext, destination) {
        this.audioContext = audioContext;
        this.output = audioContext.createGain();
        this.output.gain.value = 0;
        this.output.connect(destination);

        this.filter = audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 800;
        this.filter.Q.value = 0.6;
        this.filter.connect(this.output);

        this.mainOsc = audioContext.createOscillator();
        this.mainOsc.type = 'sawtooth';
        this.mainOsc.frequency.value = 80;

        this.subOsc = audioContext.createOscillator();
        this.subOsc.type = 'triangle';
        this.subOsc.frequency.value = 40;

        this.mainGain = audioContext.createGain();
        this.mainGain.gain.value = 0.16;
        this.subGain = audioContext.createGain();
        this.subGain.gain.value = 0.08;

        this.mainOsc.connect(this.mainGain);
        this.subOsc.connect(this.subGain);
        this.mainGain.connect(this.filter);
        this.subGain.connect(this.filter);

        this.mainOsc.start();
        this.subOsc.start();
        this.started = false;
        this.shiftKickTimer = 0;
        this.shiftKickType = 'up';
    }

    triggerShift(event = {}) {
        this.shiftKickType = event.type === 'down' ? 'down' : 'up';
        this.shiftKickTimer = this.shiftKickType === 'down' ? 0.09 : 0.13;
    }

    setActive(active) {
        const now = this.audioContext.currentTime;
        this.output.gain.cancelScheduledValues(now);
        this.output.gain.linearRampToValueAtTime(active ? 0.45 : 0.0, now + 0.08);
        this.started = active;
    }

    stop(immediate = false) {
        const now = this.audioContext.currentTime;
        this.started = false;
        this.shiftKickTimer = 0;
        this.output.gain.cancelScheduledValues(now);
        if (immediate) {
            this.output.gain.setValueAtTime(0, now);
            return;
        }
        this.output.gain.linearRampToValueAtTime(0, now + 0.08);
    }

    update(vehicle, dt = 1 / 60) {
        if (!vehicle) return;

        const speedRatio = Math.min(1.25, Math.abs(vehicle.speed) / Math.max(1e-3, vehicle.maxSpeed));
        const gear = Math.max(1, vehicle.getGear?.() ?? 1);
        const rpmShape = Math.min(1, speedRatio * (0.75 + gear * 0.08));
        const throttlePulse = vehicle.controlsEnabled ? 1 : 0.85;
        const boostMul = vehicle.isBoosting ? 1.08 : 1.0;
        let shiftDrop = 1.0;
        if (this.shiftKickTimer > 0) {
            this.shiftKickTimer = Math.max(0, this.shiftKickTimer - dt);
            const full = this.shiftKickType === 'down' ? 0.09 : 0.13;
            const t = Math.max(0, Math.min(1, this.shiftKickTimer / full));
            if (this.shiftKickType === 'up') {
                shiftDrop = 0.72 + (1 - t) * 0.28;
            } else {
                shiftDrop = 0.84 + (1 - t) * 0.16;
            }
        }

        const baseFreq = (80 + rpmShape * 320 * boostMul) * shiftDrop;
        const subFreq = baseFreq * 0.5;
        const filterFreq = 520 + rpmShape * 900 + (vehicle.isBoosting ? 200 : 0);
        const gain = 0.12 + rpmShape * 0.2 * throttlePulse;

        const smooth = Math.min(0.12, Math.max(0.02, dt * 3));
        this.mainOsc.frequency.linearRampToValueAtTime(baseFreq, this.audioContext.currentTime + smooth);
        this.subOsc.frequency.linearRampToValueAtTime(subFreq, this.audioContext.currentTime + smooth);
        this.filter.frequency.linearRampToValueAtTime(filterFreq, this.audioContext.currentTime + smooth);
        this.output.gain.linearRampToValueAtTime(
            this.started ? gain : 0,
            this.audioContext.currentTime + smooth
        );
    }

    dispose() {
        this.mainOsc.stop();
        this.subOsc.stop();
        this.output.disconnect();
        this.filter.disconnect();
    }
}
