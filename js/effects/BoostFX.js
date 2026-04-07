export class BoostFX {
    constructor() {
        this.root = document.getElementById('boost-fx');
        this.lines = document.getElementById('boost-lines');
        this.blur = document.getElementById('boost-blur');
        this.vignette = document.getElementById('boost-vignette');
        this.flash = document.getElementById('boost-flash');
        this._lineShift = 0;
        this._opacity = 0;
        this._flash = 0;
        this._time = 0;
        this._prevBoosting = false;
    }

    update(dt, player) {
        this._time += dt;
        const speed = player.getSpeedKmh();
        const boost = player.isBoosting ? 1 : 0;
        const highSpeed = Math.max(0, Math.min(1, (speed - 110) / 135));
        const drift = player.isDrifting ? Math.min(1, Math.abs(player.driftAngle || 0) / 0.72) : 0;
        const slip = Math.min(1, player.slipstreamFactor || 0);
        const target = Math.max(boost, highSpeed * 0.52 + slip * 0.28 + drift * 0.12);

        if (player.isBoosting && !this._prevBoosting) {
            this._flash = 1;
        }
        this._prevBoosting = player.isBoosting;

        const rise = target > this._opacity ? 0.22 : 0.08;
        this._opacity += (target - this._opacity) * rise * (dt * 60);
        if (this._opacity < 0.003) this._opacity = 0;
        this._flash = Math.max(0, this._flash - dt * 4.8);

        const o = this._opacity.toFixed(3);
        this.root.style.opacity = o;
        const driftDir = player.isDrifting ? Math.sign(player.driftAngle || 0) : 0;
        const driftShift = driftDir * (6 + drift * 10);
        const driftRot = driftDir * drift * 1.8;
        this.root.style.setProperty('--boost-drift-x', `${driftShift.toFixed(1)}px`);
        this.root.style.setProperty('--boost-drift-rot', `${driftRot.toFixed(2)}deg`);

        this._lineShift += (180 + speed * 5.8 + boost * 380 + slip * 120) * dt;
        const lateralPhase = Math.sin(this._time * (4 + highSpeed * 4)) * (1.5 + slip * 2.5 + drift * 5);
        this.lines.style.backgroundPosition = `${lateralPhase.toFixed(1)}px ${this._lineShift.toFixed(1)}px`;
        this.lines.style.opacity = Math.min(0.92, highSpeed * 0.24 + slip * 0.22 + drift * 0.18 + boost * 0.64).toFixed(3);
        this.blur.style.opacity = Math.min(0.84, highSpeed * 0.12 + slip * 0.16 + boost * 0.62 + drift * 0.10).toFixed(3);
        if (this.vignette) {
            this.vignette.style.opacity = Math.min(0.58, highSpeed * 0.16 + slip * 0.22 + boost * 0.26).toFixed(3);
        }
        if (this.flash) {
            this.flash.style.opacity = Math.min(0.9, this._flash * (0.55 + boost * 0.2)).toFixed(3);
        }
    }

    reset() {
        this._lineShift = 0;
        this._opacity = 0;
        this._flash = 0;
        this._time = 0;
        this._prevBoosting = false;
        if (this.root) this.root.style.opacity = '0';
        if (this.lines) this.lines.style.opacity = '0';
        if (this.blur) this.blur.style.opacity = '0';
        if (this.vignette) this.vignette.style.opacity = '0';
        if (this.flash) this.flash.style.opacity = '0';
    }
}
