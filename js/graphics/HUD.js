/**
 * HUD overlay: speed, gear, lap, timer, countdown, notifications, result screen.
 * Reads state from RaceManager (which now owns countdown + messages).
 */
import { loadRanking, qualifiesForRanking } from '../race/Ranking.js';
import { formatMs } from '../core/Utils.js';

const COMFORT_FRAME_STORAGE_KEY = 'ovalrush_comfort_frame';

export class HUD {
    constructor() {
        // Speed / gear (bottom-left)
        this.speedEl = document.getElementById('hud-speed');
        this.gearEl = document.getElementById('hud-gear');
        this.debugEl = document.getElementById('hud-debug-panel');
        // Lap (top-left)
        this.lapEl = document.getElementById('hud-lap');
        this.positionEl = document.getElementById('hud-position');
        this.gapEl = document.getElementById('hud-gap');
        this.slipstreamEl = document.getElementById('hud-slipstream');
        this.aiDebugEl = document.getElementById('hud-ai-debug');

        // Timer (top-right)
        this.timerEl = document.getElementById('hud-timer');
        this.totalTimeEl = document.getElementById('hud-total-time');
        this.bestLapEl = document.getElementById('hud-best-lap');

        // Center notifications
        this.countdownEl = document.getElementById('hud-countdown');
        this.notifyEl = document.getElementById('hud-notify');

        // Result screen
        this.resultEl = document.getElementById('hud-result');
        this.resultContent = document.getElementById('hud-result-content');

        // Comfort frame (3D motion sickness mitigation overlay)
        this.comfortFrameEl = document.getElementById('hud-comfort-frame');
        this.comfortToastEl = document.getElementById('hud-comfort-toast');
        this._comfortFrameEnabled = this._loadComfortFramePref();
        this._comfortToastTimer = null;
        this._applyComfortFrame();

        // Countdown tracking
        this._prevCountdown = null;

        // Timer blink
        this._blinkOn = false;
        this._blinkTimer = 0;

        // Result shown flag
        this._resultShown = false;

        // Race context for ranking
        this._courseId = '';
        this._difficulty = '';
    }

    setRaceContext(courseId, difficulty) {
        this._courseId = courseId;
        this._difficulty = difficulty;
    }

    /**
     * Toggle the fixed on-screen reference frame (3D motion sickness mitigation).
     * The frame draws a stationary cockpit-style border, a horizon bar, a central
     * reticle, and a soft peripheral vignette so the eyes have a fixed anchor
     * while the world camera pitches, rolls and accelerates. State is persisted
     * in localStorage so the user only has to enable it once.
     * @returns {boolean} new enabled state
     */
    toggleComfortFrame() {
        this._comfortFrameEnabled = !this._comfortFrameEnabled;
        this._applyComfortFrame();
        this._saveComfortFramePref();
        this._showComfortToast(this._comfortFrameEnabled);
        return this._comfortFrameEnabled;
    }

    isComfortFrameEnabled() {
        return this._comfortFrameEnabled;
    }

    _applyComfortFrame() {
        if (!this.comfortFrameEl) return;
        this.comfortFrameEl.classList.toggle('active', this._comfortFrameEnabled);
    }

    _loadComfortFramePref() {
        try {
            return localStorage.getItem(COMFORT_FRAME_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    }

    _saveComfortFramePref() {
        try {
            localStorage.setItem(
                COMFORT_FRAME_STORAGE_KEY,
                this._comfortFrameEnabled ? '1' : '0'
            );
        } catch {
            // localStorage unavailable (private mode, sandbox) — silently ignore
        }
    }

    _showComfortToast(enabled) {
        if (!this.comfortToastEl) return;
        this.comfortToastEl.textContent = enabled
            ? 'COMFORT FRAME: ON'
            : 'COMFORT FRAME: OFF';
        this.comfortToastEl.classList.add('show');
        if (this._comfortToastTimer !== null) {
            clearTimeout(this._comfortToastTimer);
        }
        this._comfortToastTimer = setTimeout(() => {
            this.comfortToastEl?.classList.remove('show');
            this._comfortToastTimer = null;
        }, 1400);
    }

    // ── Cached DOM writers ──
    // The HUD is updated every rendered frame; most values only change a few
    // times per second. Skipping identical writes avoids needless style/layout
    // work in the browser.
    _setText(el, value) {
        if (!el || el.__hudText === value) return;
        el.__hudText = value;
        el.textContent = value;
    }

    _setDisplay(el, value) {
        if (!el || el.__hudDisplay === value) return;
        el.__hudDisplay = value;
        el.style.display = value;
    }

    _setColor(el, value) {
        if (!el || el.__hudColor === value) return;
        el.__hudColor = value;
        el.style.color = value;
    }

    update(vehicle, race, dt) {
        // ── Speed & Gear ──
        const speed = Math.round(vehicle.getSpeedKmh());
        this._setText(this.speedEl, `${speed} km/h`);
        this._setText(this.gearEl, `GEAR: ${vehicle.getGear()} ${vehicle.transmissionMode}`);

        if (vehicle.isBoosting) {
            this._setColor(this.speedEl, '#ff6600');
        } else if (vehicle.isDrifting) {
            this._setColor(this.speedEl, '#ffcc00');
        } else {
            this._setColor(this.speedEl, '#fff');
        }
        if (!race) return;

        // ── Countdown ──
        const cd = race.countdownDisplay;
        if (cd !== null) {
            if (cd !== this._prevCountdown) {
                this._prevCountdown = cd;
                if (cd !== '') {
                    this._setText(this.countdownEl, cd);
                    this._setDisplay(this.countdownEl, 'flex');
                    this._setColor(this.countdownEl, '#ff6600');
                    this.countdownEl.classList.remove('countdown-animate');
                    void this.countdownEl.offsetWidth;
                    this.countdownEl.classList.add('countdown-animate');
                }
            }
        } else {
            if (this._prevCountdown !== null) {
                this._setDisplay(this.countdownEl, 'none');
                this._prevCountdown = null;
            }
        }

        // ── Lap ──
        if (race.state === 'racing' || race.state === 'finish_celebration' || race.state === 'finished') {
            const lap = race.totalLaps > 0 ? Math.min(race.currentLap, race.totalLaps) : race.currentLap;
            this._setText(this.lapEl, race.mode === 'free_run'
                ? `FREE RUN LAP ${lap}`
                : `LAP ${lap} / ${race.totalLaps}`);
            this._setDisplay(this.lapEl, 'block');
            this._setText(this.positionEl, `POS ${race.playerPosition} / ${race.totalRacers}`);
            this._setDisplay(this.positionEl, 'block');
            this._updateGapDisplay(race, race.state === 'racing');
        } else if (race.state === 'grid_intro' || race.state === 'countdown') {
            this._setText(this.lapEl, race.mode === 'free_run'
                ? 'FREE RUN'
                : `LAP 1 / ${race.totalLaps}`);
            this._setDisplay(this.lapEl, 'block');
            this._setText(this.positionEl, `POS ${race.playerPosition} / ${race.totalRacers}`);
            this._setDisplay(this.positionEl, 'block');
            this._updateGapDisplay(race, false);
        } else {
            this._setDisplay(this.lapEl, 'none');
            this._setDisplay(this.positionEl, 'none');
            this._setDisplay(this.gapEl, 'none');
        }

        // ── Timer ──
        const showTimer = race.timerEnabled && (race.state === 'countdown' || race.state === 'racing');
        if (showTimer) {
            this._setText(this.timerEl, race.remainingTimeStr);
            this._setDisplay(this.timerEl, 'block');

            if (race.timerLow && race.state === 'racing') {
                this._blinkTimer += dt;
                if (this._blinkTimer > 0.3) {
                    this._blinkTimer = 0;
                    this._blinkOn = !this._blinkOn;
                }
                this._setColor(this.timerEl, this._blinkOn ? '#ff0000' : '#ff6666');
            } else {
                this._setColor(this.timerEl, '#fff');
                this._blinkOn = false;
                this._blinkTimer = 0;
            }
        } else {
            this._setDisplay(this.timerEl, 'none');
        }

        // ── Total time / best lap ──
        if (race.state === 'racing') {
            this._setText(this.totalTimeEl, `TIME ${race.timer.getTotalTimeFormatted()}`);
            this._setDisplay(this.totalTimeEl, 'block');
            this._setText(this.bestLapEl, `BEST ${race.timer.getBestLapFormatted()}`);
            this._setDisplay(this.bestLapEl, 'block');
        } else {
            this._setDisplay(this.totalTimeEl, 'none');
            this._setDisplay(this.bestLapEl, 'none');
        }

        // ── Centre message ──
        if (race.isRollingStartCountdown) {
            this._setText(this.notifyEl, 'ROLLING START');
            this._setColor(this.notifyEl, '#ff6600');
            this._setDisplay(this.notifyEl, 'block');
            this.notifyEl.classList.add('notify-rolling-start');
        } else if (race.message) {
            this._setText(this.notifyEl, race.message.text);
            this._setColor(this.notifyEl, race.message.color);
            this._setDisplay(this.notifyEl, 'block');
            this.notifyEl.classList.remove('notify-rolling-start');
        } else {
            this._setDisplay(this.notifyEl, 'none');
            this.notifyEl.classList.remove('notify-rolling-start');
        }

        // ── Result screen ──
        if ((race.state === 'finished' || race.state === 'gameover') && !this._resultShown) {
            this._showResult(race);
            this._resultShown = true;
        }

        if (race.aiDebugText) {
            this._setText(this.aiDebugEl, race.aiDebugText);
            this._setDisplay(this.aiDebugEl, 'block');
        } else {
            this._setDisplay(this.aiDebugEl, 'none');
        }

        if (this.slipstreamEl) {
            const slip = vehicle.slipstreamFactor || 0;
            if (slip > 0.08 && race.state === 'racing') {
                this._setText(this.slipstreamEl, `SLIPSTREAM ${(slip * 100).toFixed(0)}%`);
                this._setDisplay(this.slipstreamEl, 'block');
            } else {
                this._setDisplay(this.slipstreamEl, 'none');
            }
        }
    }

    _showResult(race) {
        const isFinished = race.state === 'finished';
        const totalTimeMs = Math.round((race.timer?.totalElapsed || 0) * 1000);
        const bestLap = race.timer?.getBestLapFormatted() || '--:--.---';
        const totalTime = race.timer?.getTotalTimeFormatted() || '00:00.000';
        const pos = race.playerPosition;
        const total = race.totalRacers;
        const laps = race.totalLaps;
        const curLap = race.currentLap;

        // Ranking
        const ranking = race.rankingEnabled ? loadRanking(this._courseId, this._difficulty) : [];
        const showInitials = race.rankingEnabled
            && isFinished
            && qualifiesForRanking(this._courseId, this._difficulty, totalTimeMs);

        let rankingHtml = '';
        if (ranking.length > 0) {
            const rows = ranking.map((r, i) =>
                `<div>${(i + 1).toString().padStart(2, ' ')}. ${r.name}  ${formatMs(r.time)}</div>`
            ).join('');
            rankingHtml = `
                <div class="result-ranking">
                    <div class="result-ranking-title">HIGH SCORES</div>
                    <div class="result-ranking-list" id="ranking-list">${rows}</div>
                </div>
            `;
        }

        let initialsHtml = '';
        if (showInitials) {
            initialsHtml = `
                <div class="result-initials">
                    <div class="result-initials-label">ENTER YOUR NAME</div>
                    <div class="result-initials-input">
                        <div class="initial-char active">A</div>
                        <div class="initial-char">A</div>
                        <div class="initial-char">A</div>
                    </div>
                    <button id="btn-save-ranking" class="result-btn" style="margin-top:12px;font-size:14px;padding:8px 24px;">SAVE</button>
                </div>
            `;
        }

        // Determine title text and CSS class based on mode and position
        let titleText, titleCls;
        if (!isFinished) {
            titleText = '';
            titleCls  = '';
        } else if (race.mode === 'time_attack') {
            titleText = 'TIME ATTACK CLEAR!';
            titleCls  = 'result-title';
        } else if (race.mode === 'free_run') {
            titleText = 'FREE RUN COMPLETE';
            titleCls  = 'result-title';
        } else if (race.mode === 'arcade' && pos === 1) {
            titleText = '1ST PLACE  WINNER!';
            titleCls  = 'result-title podium-1st';
            this.resultEl.className = 'podium-result-1';
        } else if (race.mode === 'arcade' && pos === 2) {
            titleText = '2ND PLACE';
            titleCls  = 'result-title podium-2nd';
            this.resultEl.className = 'podium-result-2';
        } else if (race.mode === 'arcade' && pos === 3) {
            titleText = '3RD PLACE';
            titleCls  = 'result-title podium-3rd';
            this.resultEl.className = 'podium-result-3';
        } else {
            titleText = 'RACE COMPLETE!';
            titleCls  = 'result-title';
        }

        let html = '';
        if (isFinished) {
            html = `
                <div class="${titleCls}">${titleText}</div>
                <div class="result-stats">
                    <div>POSITION: ${pos} / ${total}</div>
                    <div>TOTAL TIME: ${totalTime}</div>
                    <div>BEST LAP: ${bestLap}</div>
                    <div>LAPS: ${laps}</div>
                </div>
                ${rankingHtml}
                ${initialsHtml}
                <div class="result-actions">
                    <button id="btn-retry" class="result-btn primary">RETRY</button>
                    <button id="btn-course-select" class="result-btn">COURSE SELECT</button>
                    <button id="btn-title" class="result-btn">TITLE</button>
                </div>
            `;
        } else {
            html = `
                <div class="result-title gameover">TIME OVER</div>
                <div class="result-stats">
                    <div>LAP: ${curLap} / ${laps}</div>
                    <div>POSITION: ${pos} / ${total}</div>
                    <div>TIME: ${totalTime}</div>
                    <div>BEST LAP: ${bestLap}</div>
                </div>
                ${rankingHtml}
                <div class="result-actions">
                    <button id="btn-retry" class="result-btn primary">RETRY</button>
                    <button id="btn-course-select" class="result-btn">COURSE SELECT</button>
                    <button id="btn-title" class="result-btn">TITLE</button>
                </div>
            `;
        }

        this.resultContent.innerHTML = html;
        this.resultEl.style.display = 'flex';
    }

    /**
     * Re-render the ranking list after saving. Name content is A-Z initials (safe).
     * @param {string} courseId
     * @param {string} difficulty
     * @param {number} highlightIndex  0-based rank index of the new entry, or -1 for none
     */
    refreshRankingDisplay(courseId, difficulty, highlightIndex) {
        const listEl = document.getElementById('ranking-list');
        if (!listEl) return;
        const ranking = loadRanking(courseId, difficulty);
        // Names are validated to 3 uppercase A-Z chars in insertRanking – safe for innerHTML
        listEl.innerHTML = ranking.map((r, i) => { // nosec
            const isYou = i === highlightIndex;
            const cls = isYou ? ' class="you"' : '';
            return `<div${cls}>${(i + 1).toString().padStart(2, ' ')}. ${r.name}  ${formatMs(r.time)}${isYou ? ' ← NEW!' : ''}</div>`;
        }).join('');
    }

    hideResult() {
        this.resultEl.style.display = 'none';
        this.resultEl.className = '';
        this._resultShown = false;
    }

    _updateGapDisplay(race, showLive) {
        if (!showLive) {
            this._setText(this.gapEl, 'AHEAD --.-s / BEHIND --.-s');
            this._setDisplay(this.gapEl, 'block');
            return;
        }
        const ahead = race.gapAheadSec === null ? '--.-' : race.gapAheadSec.toFixed(1);
        const behind = race.gapBehindSec === null ? '--.-' : race.gapBehindSec.toFixed(1);
        this._setText(this.gapEl, `AHEAD ${ahead}s / BEHIND ${behind}s`);
        this._setDisplay(this.gapEl, 'block');
    }

    getRetryButton() {
        return document.getElementById('btn-retry');
    }

    setDebugPanel(active, lines = []) {
        if (!this.debugEl) return;
        const raceEls = [this.lapEl, this.positionEl, this.gapEl, this.timerEl,
            this.totalTimeEl, this.bestLapEl, this.speedEl, this.gearEl,
            this.slipstreamEl, this.countdownEl];
        if (!active) {
            this.debugEl.style.display = 'none';
            this.debugEl.textContent = '';
            for (const el of raceEls) {
                if (el) el.style.removeProperty('visibility');
            }
            return;
        }
        for (const el of raceEls) {
            if (el) el.style.visibility = 'hidden';
        }
        this.debugEl.textContent = lines.join('\n');
        this.debugEl.style.display = 'block';
    }

    reset() {
        this._setDisplay(this.lapEl, 'none');
        this._setDisplay(this.positionEl, 'none');
        this._setDisplay(this.gapEl, 'none');
        this._setDisplay(this.slipstreamEl, 'none');
        this._setDisplay(this.aiDebugEl, 'none');
        this._setDisplay(this.timerEl, 'none');
        this._setDisplay(this.totalTimeEl, 'none');
        this._setDisplay(this.bestLapEl, 'none');
        this._setDisplay(this.countdownEl, 'none');
        this._setDisplay(this.notifyEl, 'none');
        this.notifyEl.classList.remove('notify-rolling-start');
        this.hideResult();
        this.setDebugPanel(false);
        this._prevCountdown = null;
        this._blinkOn = false;
        this._blinkTimer = 0;
    }
}
