/**
 * PodiumFX – DOM overlay for top-3 finish celebration.
 * Confetti rain, screen edge glow, rank badge zoom-in animation, camera shake.
 * All DOM nodes are self-contained and removed on reset().
 */
export class PodiumFX {
    constructor() {
        this._glowEl        = null;
        this._containerEl   = null;
        this._confettiTimer = null;
        this._shakeTimeout  = null;
        this._active        = false;
    }

    /** Trigger effects for finishing position 1, 2 or 3. No-op otherwise. */
    show(position) {
        if (position < 1 || position > 3 || this._active) return;
        this._active = true;
        this._buildGlow(position);
        this._buildBadge(position);
        if (position === 1) {
            this._startConfetti(60);
            this._triggerCameraShake();
        } else if (position === 2) {
            this._startConfetti(30);
        }
    }

    /** Remove all effects and reset state. Safe to call multiple times. */
    reset() {
        this._active = false;
        this._stopConfetti();

        if (this._shakeTimeout !== null) {
            clearTimeout(this._shakeTimeout);
            this._shakeTimeout = null;
        }
        document.getElementById('gameCanvas')?.classList.remove('camera-shake');

        // Remove tracked containers
        this._glowEl?.remove();      this._glowEl = null;
        this._containerEl?.remove(); this._containerEl = null;

        // Remove any confetti pieces still in flight
        document.querySelectorAll('.confetti-piece').forEach(el => el.remove());
    }

    // ─── DOM builders ──────────────────────────────────────────────────────────

    _buildGlow(pos) {
        const shadows = {
            1: 'inset 0 0 100px 40px rgba(255,215,0,0.45)',
            2: 'inset 0 0  80px 30px rgba(192,192,220,0.36)',
            3: 'inset 0 0  70px 25px rgba(205,127,50,0.38)',
        };
        this._glowEl = document.createElement('div');
        Object.assign(this._glowEl.style, {
            position:      'fixed',
            inset:         '0',
            zIndex:        '25',
            pointerEvents: 'none',
            boxShadow:     shadows[pos],
            animation:     'podium-glow-pulse 1.4s ease-in-out infinite alternate',
        });
        document.body.appendChild(this._glowEl);
    }

    _buildBadge(pos) {
        const cfg = {
            1: { color: '#FFD700', shadow: 'rgba(255,215,0,0.9)',   text: '1ST PLACE', sub: 'WINNER!' },
            2: { color: '#C8C8D8', shadow: 'rgba(200,200,220,0.8)', text: '2ND PLACE', sub: '' },
            3: { color: '#CD7F32', shadow: 'rgba(205,127,50,0.8)',  text: '3RD PLACE', sub: '' },
        }[pos];

        this._containerEl = document.createElement('div');
        Object.assign(this._containerEl.style, {
            position:       'fixed',
            inset:          '0',
            zIndex:         '26',
            pointerEvents:  'none',
            display:        'flex',
            justifyContent: 'center',
            alignItems:     'flex-start',
            paddingTop:     '13vh',
        });

        const badge = document.createElement('div');
        badge.style.cssText = 'text-align:center;animation:podium-badge-in 0.65s cubic-bezier(0.175,0.885,0.32,1.275) forwards;';
        badge.style.setProperty('--podium-color',  cfg.color);
        badge.style.setProperty('--podium-shadow', cfg.shadow);

        const rankEl = document.createElement('div');
        rankEl.className   = 'podium-rank-text';
        rankEl.textContent = cfg.text;
        badge.appendChild(rankEl);

        if (cfg.sub) {
            const subEl = document.createElement('div');
            subEl.className   = 'podium-winner-label';
            subEl.textContent = cfg.sub;
            badge.appendChild(subEl);
        }

        this._containerEl.appendChild(badge);
        document.body.appendChild(this._containerEl);
    }

    // ─── Confetti ──────────────────────────────────────────────────────────────

    _startConfetti(total) {
        const goldPalette   = ['#FFD700','#FFA500','#FF6347','#87CEEB','#FF69B4','#98FB98','#DDA0DD','#ffffff'];
        const silverPalette = ['#C8C8D8','#A0A0B8','#E8E8F0','#8888A8','#ffffff'];
        const palette = total > 40 ? goldPalette : silverPalette;
        let spawned = 0;
        this._confettiTimer = setInterval(() => {
            if (!this._active || spawned >= total) { this._stopConfetti(); return; }
            this._spawnPiece(palette);
            spawned++;
        }, 60);
    }

    _spawnPiece(palette) {
        const el      = document.createElement('div');
        const color   = palette[Math.floor(Math.random() * palette.length)];
        const x       = (Math.random() * 110 - 5).toFixed(1);
        const w       = (6 + Math.random() * 9).toFixed(1);
        const h       = (parseFloat(w) * 0.45).toFixed(1);
        const dur     = (2.4 + Math.random() * 2.0).toFixed(2);
        const drift   = ((Math.random() - 0.5) * 220).toFixed(0);
        const initRot = Math.floor(Math.random() * 360);

        el.className = 'confetti-piece';
        el.style.cssText = [
            'position:fixed',
            'top:-22px',
            `left:${x}vw`,
            `width:${w}px`,
            `height:${h}px`,
            `background:${color}`,
            'z-index:27',
            'pointer-events:none',
            'border-radius:2px',
            `animation:confetti-fall ${dur}s ease-in forwards`,
            `transform:rotate(${initRot}deg)`,
            `--drift:${drift}px`,
        ].join(';');

        document.body.appendChild(el);
        setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 300);
    }

    _stopConfetti() {
        if (this._confettiTimer !== null) {
            clearInterval(this._confettiTimer);
            this._confettiTimer = null;
        }
    }

    // ─── Camera shake ──────────────────────────────────────────────────────────

    _triggerCameraShake() {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;
        canvas.classList.remove('camera-shake');
        void canvas.offsetWidth;            // force reflow to restart animation
        canvas.classList.add('camera-shake');
        this._shakeTimeout = setTimeout(() => {
            canvas.classList.remove('camera-shake');
            this._shakeTimeout = null;
        }, 640);
    }
}
