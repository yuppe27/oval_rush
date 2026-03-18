/**
 * HUD overlay: speed, gear, lap, timer, countdown, notifications, result screen.
 * Reads state from RaceManager (which now owns countdown + messages).
 */
import { loadRanking, qualifiesForRanking } from '../race/Ranking.js';
import { formatMs } from '../core/Utils.js';

export class HUD {
    constructor() {
        // Speed / gear (bottom-left)
        this.speedEl = document.getElementById('hud-speed');
        this.gearEl = document.getElementById('hud-gear');
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

    update(vehicle, race, dt) {
        // ── Speed & Gear ──
        const speed = Math.round(vehicle.getSpeedKmh());
        this.speedEl.textContent = `${speed} km/h`;
        this.gearEl.textContent = `GEAR: ${vehicle.getGear()} ${vehicle.transmissionMode}`;

        if (vehicle.isBoosting) {
            this.speedEl.style.color = '#ff6600';
        } else if (vehicle.isDrifting) {
            this.speedEl.style.color = '#ffcc00';
        } else {
            this.speedEl.style.color = '#fff';
        }
        if (!race) return;

        // ── Countdown ──
        const cd = race.countdownDisplay;
        if (cd !== null) {
            if (cd !== this._prevCountdown) {
                this._prevCountdown = cd;
                if (cd !== '') {
                    this.countdownEl.textContent = cd;
                    this.countdownEl.style.display = 'flex';
                    this.countdownEl.style.color = '#ff6600';
                    this.countdownEl.classList.remove('countdown-animate');
                    void this.countdownEl.offsetWidth;
                    this.countdownEl.classList.add('countdown-animate');
                }
            }
        } else {
            if (this._prevCountdown !== null) {
                this.countdownEl.style.display = 'none';
                this._prevCountdown = null;
            }
        }

        // ── Lap ──
        if (race.state === 'racing' || race.state === 'finish_celebration' || race.state === 'finished') {
            const lap = race.totalLaps > 0 ? Math.min(race.currentLap, race.totalLaps) : race.currentLap;
            this.lapEl.textContent = race.mode === 'free_run'
                ? `FREE RUN LAP ${lap}`
                : `LAP ${lap} / ${race.totalLaps}`;
            this.lapEl.style.display = 'block';
            this.positionEl.textContent = `POS ${race.playerPosition} / ${race.totalRacers}`;
            this.positionEl.style.display = 'block';
            this._updateGapDisplay(race, race.state === 'racing');
        } else if (race.state === 'grid_intro' || race.state === 'countdown') {
            this.lapEl.textContent = race.mode === 'free_run'
                ? 'FREE RUN'
                : `LAP 1 / ${race.totalLaps}`;
            this.lapEl.style.display = 'block';
            this.positionEl.textContent = `POS ${race.playerPosition} / ${race.totalRacers}`;
            this.positionEl.style.display = 'block';
            this._updateGapDisplay(race, false);
        } else {
            this.lapEl.style.display = 'none';
            this.positionEl.style.display = 'none';
            this.gapEl.style.display = 'none';
        }

        // ── Timer ──
        const showTimer = race.timerEnabled && (race.state === 'countdown' || race.state === 'racing');
        if (showTimer) {
            this.timerEl.textContent = race.remainingTimeStr;
            this.timerEl.style.display = 'block';

            if (race.timerLow && race.state === 'racing') {
                this._blinkTimer += dt;
                if (this._blinkTimer > 0.3) {
                    this._blinkTimer = 0;
                    this._blinkOn = !this._blinkOn;
                }
                this.timerEl.style.color = this._blinkOn ? '#ff0000' : '#ff6666';
            } else {
                this.timerEl.style.color = '#fff';
                this._blinkOn = false;
                this._blinkTimer = 0;
            }
        } else {
            this.timerEl.style.display = 'none';
        }

        // ── Total time / best lap ──
        if (race.state === 'racing') {
            this.totalTimeEl.textContent = `TIME ${race.timer.getTotalTimeFormatted()}`;
            this.totalTimeEl.style.display = 'block';
            this.bestLapEl.textContent = `BEST ${race.timer.getBestLapFormatted()}`;
            this.bestLapEl.style.display = 'block';
        } else {
            this.totalTimeEl.style.display = 'none';
            this.bestLapEl.style.display = 'none';
        }

        // ── Centre message ──
        if (race.isRollingStartCountdown) {
            this.notifyEl.textContent = 'ROLLING START';
            this.notifyEl.style.color = '#ff6600';
            this.notifyEl.style.display = 'block';
            this.notifyEl.classList.add('notify-rolling-start');
        } else if (race.message) {
            this.notifyEl.textContent = race.message.text;
            this.notifyEl.style.color = race.message.color;
            this.notifyEl.style.display = 'block';
            this.notifyEl.classList.remove('notify-rolling-start');
        } else {
            this.notifyEl.style.display = 'none';
            this.notifyEl.classList.remove('notify-rolling-start');
        }

        // ── Result screen ──
        if ((race.state === 'finished' || race.state === 'gameover') && !this._resultShown) {
            this._showResult(race);
            this._resultShown = true;
        }

        if (race.aiDebugText) {
            this.aiDebugEl.textContent = race.aiDebugText;
            this.aiDebugEl.style.display = 'block';
        } else {
            this.aiDebugEl.style.display = 'none';
        }

        if (this.slipstreamEl) {
            const slip = vehicle.slipstreamFactor || 0;
            if (slip > 0.08 && race.state === 'racing') {
                this.slipstreamEl.textContent = `SLIPSTREAM ${(slip * 100).toFixed(0)}%`;
                this.slipstreamEl.style.display = 'block';
            } else {
                this.slipstreamEl.style.display = 'none';
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
            this.gapEl.textContent = 'AHEAD --.-s / BEHIND --.-s';
            this.gapEl.style.display = 'block';
            return;
        }
        const ahead = race.gapAheadSec === null ? '--.-' : race.gapAheadSec.toFixed(1);
        const behind = race.gapBehindSec === null ? '--.-' : race.gapBehindSec.toFixed(1);
        this.gapEl.textContent = `AHEAD ${ahead}s / BEHIND ${behind}s`;
        this.gapEl.style.display = 'block';
    }

    getRetryButton() {
        return document.getElementById('btn-retry');
    }

    reset() {
        this.lapEl.style.display = 'none';
        this.positionEl.style.display = 'none';
        this.gapEl.style.display = 'none';
        if (this.slipstreamEl) this.slipstreamEl.style.display = 'none';
        this.aiDebugEl.style.display = 'none';
        this.timerEl.style.display = 'none';
        this.totalTimeEl.style.display = 'none';
        this.bestLapEl.style.display = 'none';
        this.countdownEl.style.display = 'none';
        this.notifyEl.style.display = 'none';
        this.notifyEl.classList.remove('notify-rolling-start');
        this.hideResult();
        this._prevCountdown = null;
        this._blinkOn = false;
        this._blinkTimer = 0;
    }
}
