export class BoostFX {
    constructor() {
        this.root = document.getElementById('boost-fx');
        this.lines = document.getElementById('boost-lines');
        this.blur = document.getElementById('boost-blur');
        this._lineShift = 0;
        this._opacity = 0;
    }

    update(dt, player) {
        const boost = player.isBoosting ? 1 : 0;
        const target = boost;

        const rise = target > this._opacity ? 0.22 : 0.08;
        this._opacity += (target - this._opacity) * rise * (dt * 60);
        if (this._opacity < 0.003) this._opacity = 0;

        const o = this._opacity.toFixed(3);
        this.root.style.opacity = o;

        this._lineShift += (360 + player.getSpeedKmh() * 6) * dt;
        this.lines.style.backgroundPosition = `0 ${this._lineShift.toFixed(1)}px`;
        this.lines.style.opacity = Math.min(0.85, this._opacity * 1.25).toFixed(3);
        this.blur.style.opacity = Math.min(0.78, this._opacity * 0.9).toFixed(3);

    }

    reset() {
        this._lineShift = 0;
        this._opacity = 0;
        if (this.root) this.root.style.opacity = '0';
        if (this.lines) this.lines.style.opacity = '0';
        if (this.blur) this.blur.style.opacity = '0';
    }
}
