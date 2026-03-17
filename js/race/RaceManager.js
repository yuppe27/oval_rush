import { Timer }      from './Timer.js';
import { Checkpoint } from './Checkpoint.js';
import {
    RACE_COUNTDOWN_DURATION,
    ROLLING_START_GRID_INTRO_DURATION,
} from '../core/Constants.js';

/**
 * Race lifecycle manager:
 *   idle → grid_intro → countdown → racing → finish_celebration → finished | gameover
 *
 * Call update(dt, player) every physics tick.
 * Read `state`, `currentLap`, `timer`, `message`, `countdownDisplay` for HUD.
 *
 * Ranking principles:
 *  - Lap count = start/finish line crossings (validated by checkpoints for player)
 *  - Within-lap progress = normalised distance from start line [0,1)
 *  - Rank: completed (by finish order) > more laps > higher within-lap progress
 *  - Player progress clamped by checkpoint milestones to prevent jump exploits
 *  - Finish order recorded and used for final ranking
 */
export class RaceManager {
    constructor(courseBuilder, courseData) {
        this.courseBuilder        = courseBuilder;
        this.courseData           = courseData;
        this.mode                 = courseData.mode || 'arcade';
        this.timerEnabled         = courseData.timerEnabled !== false;
        this.checkpointsEnabled   = courseData.checkpointsEnabled !== false;
        this.rankingEnabled       = courseData.rankingEnabled !== false;

        this.totalLaps            = courseData.laps ?? 0;
        this.currentLap           = 1;
        this.state                = 'idle';     // 'idle'|'grid_intro'|'countdown'|'racing'|'finish_celebration'|'finished'|'gameover'
        this.finishTime           = 0;
        this.bestLapTime          = Infinity;
        this.playerPosition       = 1;
        this.totalRacers          = courseData.gridSize ?? 1;
        this.aiController         = null;
        this.gapAheadSec          = null;
        this.gapBehindSec         = null;
        this.debugEnabled         = false;
        this.aiDebugText          = '';

        this.timer                = new Timer(courseData.initialTime);
        this.checkpoint           = new Checkpoint(courseBuilder, courseData);

        // Start-line t for progress calculation
        this._startLineT          = courseBuilder.sampledPoints[courseBuilder.startLineIndex]?.t ?? 0;

        // Countdown
        this._countdownTimer      = 0;
        this._countdownDisplay    = '';
        this._gridIntroTimer      = 0;
        this._gridIntroDuration   = ROLLING_START_GRID_INTRO_DURATION;
        this._gridIntroCountdownOptions = {};
        this._rollingStartCountdown = false;
        this._justEnteredRacing   = false;

        // Finish order
        this._playerFinishPosition = 0;
        this._pendingPlayerFinish = false;

        // HUD overlay message (TIME EXTENDED!, FINAL LAP!, etc.)
        this.message              = null;  // { text, color, timer }

        // Finish celebration
        this._celebrationStartTime = 0;
        this._celebrationDuration  = 9000;  // real-time milliseconds
        this._lastRawFromStart     = 0;

        // Pre-compute checkpoint milestones (start-line-relative) for progress clamping
        this._cpMilestones = (courseData.checkpointPositions || []).map(
            cpT => ((cpT - this._startLineT) % 1 + 1) % 1
        );

        // Optional callbacks
        this.onCheckpoint         = null;  // (cpIndex) => void
        this.onLapComplete        = null;  // (lapNum, lapTimeSec) => void
        this.onFinalLap           = null;  // () => void
        this.onRaceFinish         = null;  // () => void  (fires at start of celebration)
        this.onCelebrationEnd     = null;  // () => void  (fires when result screen should appear)
        this.onTimeUp             = null;  // () => void
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    /** Begin the 3-second countdown then transition to racing. */
    startCountdown(options = {}) {
        const rollingStart = Boolean(options.rollingStart);
        const driveDuringIntro = Boolean(options.driveDuringIntro);
        this.state             = 'countdown';
        this._countdownTimer   = RACE_COUNTDOWN_DURATION;
        this._countdownDisplay = '3';
        this._rollingStartCountdown = rollingStart;
        this.currentLap        = 1;
        this.timer             = new Timer(this.courseData.initialTime);
        this.checkpoint.reset();
        this.message           = null;
        this.playerPosition    = this.totalRacers;
        this._justEnteredRacing = false;
        this._playerFinishPosition = 0;
        this._pendingPlayerFinish = false;
        this._lastRawFromStart = 0;
        if (driveDuringIntro && this.aiController?.primeRaceStartFromCurrentState) {
            this.aiController.primeRaceStartFromCurrentState();
        }
        if (this.aiController) this.aiController.setActive(rollingStart);
        if (rollingStart) {
            this._showMessage('ROLLING START', '#88d6ff', 1.2);
        }
    }

    /** Start cinematic grid-intro, then auto transition to countdown. */
    startGridIntro(duration = ROLLING_START_GRID_INTRO_DURATION, countdownOptions = {}) {
        const driveDuringIntro = Boolean(countdownOptions.driveDuringIntro);
        this.state = 'grid_intro';
        this._gridIntroDuration = duration;
        this._gridIntroTimer = duration;
        this._countdownDisplay = '';
        this._gridIntroCountdownOptions = { ...countdownOptions };
        this._rollingStartCountdown = false;
        this.timer = new Timer(this.courseData.initialTime);
        this.checkpoint.reset();
        this.message = {
            text: driveDuringIntro ? 'ROLLING FORMATION' : 'ON THE GRID',
            color: '#88d6ff',
            timer: duration,
        };
        this.currentLap = 1;
        this.playerPosition = this.totalRacers;
        this._justEnteredRacing = false;
        this._playerFinishPosition = 0;
        this._pendingPlayerFinish = false;
        this._lastRawFromStart = 0;
        if (this.aiController) this.aiController.setActive(driveDuringIntro);
    }

    reset() {
        this.state          = 'idle';
        this.currentLap     = 1;
        this.finishTime     = 0;
        this.bestLapTime    = Infinity;
        this.playerPosition = 1;
        this.gapAheadSec    = null;
        this.gapBehindSec   = null;
        this.aiDebugText    = '';
        this.timer          = new Timer(this.courseData.initialTime);
        this.checkpoint     = new Checkpoint(this.courseBuilder, this.courseData);
        this._countdownTimer   = 0;
        this._countdownDisplay = '';
        this._gridIntroTimer   = 0;
        this._gridIntroCountdownOptions = {};
        this._rollingStartCountdown = false;
        this._justEnteredRacing = false;
        this._playerFinishPosition = 0;
        this._pendingPlayerFinish = false;
        this._celebrationStartTime = 0;
        this.message           = null;
        this._lastRawFromStart = 0;
        if (this.aiController) this.aiController.setActive(false);
    }

    setAIController(aiController) {
        this.aiController = aiController;
        const aiCount = aiController?.vehicles?.length ?? 0;
        this.totalRacers = 1 + aiCount;
        this.playerPosition = this.totalRacers;
    }

    setDebugEnabled(enabled) {
        this.debugEnabled = Boolean(enabled);
        if (!this.debugEnabled) this.aiDebugText = '';
    }

    /**
     * Call every physics frame.
     * player must have .nearestIndex (updated by PlayerVehicle._updateSurfaceFriction)
     * and .controlsEnabled flag.
     */
    update(dt, player) {
        this._tickMessage(dt);

        switch (this.state) {
            case 'grid_intro':          this._updateGridIntro(dt, player);          break;
            case 'countdown':           this._updateCountdown(dt, player);          break;
            case 'racing':              this._updateRacing(dt, player);             break;
            case 'finish_celebration':  this._updateFinishCelebration(dt, player);  break;
            default:                                                                 break;
        }
    }

    /** Whether the player vehicle should accept throttle / steering input. */
    get inputEnabled() {
        return this.state === 'racing';
    }

    /** Countdown digit string '3'/'2'/'1', or null when not counting down. */
    get countdownDisplay() {
        return this.state === 'countdown' ? this._countdownDisplay : null;
    }
    get isRollingStartCountdown() {
        return this.state === 'countdown' && this._rollingStartCountdown;
    }

    get remainingTimeStr() { return this.timer.getRemainingTimeFormatted(); }
    get timerLow()         { return this.timer.hasLimit && this.timer.remainingTime < 10; }
    get gridIntroProgress() {
        if (this.state !== 'grid_intro' || this._gridIntroDuration <= 0) return 0;
        return 1 - (this._gridIntroTimer / this._gridIntroDuration);
    }
    get justEnteredRacing() {
        return this._justEnteredRacing;
    }
    get celebrationProgress() {
        if (this.state !== 'finish_celebration' || this._celebrationDuration <= 0) return 0;
        const elapsed = performance.now() - this._celebrationStartTime;
        return Math.min(1, elapsed / this._celebrationDuration);
    }
    get hasPendingFinishOrder() {
        return this._pendingPlayerFinish;
    }

    finalizeFinishOrder(player) {
        if (!this._pendingPlayerFinish) return false;

        if (this.aiController) {
            this._playerFinishPosition = this.aiController.assignFinishPosition();
        } else {
            this._playerFinishPosition = 1;
        }
        this._pendingPlayerFinish = false;
        if (player) {
            this._updateRanking(player, { playerFinished: true });
        }
        return true;
    }

    _updateGridIntro(dt, player) {
        this._rollingStartCountdown = false;
        player.controlsEnabled = false;
        this._updateRanking(player);
        this._gridIntroTimer -= dt;
        if (this._gridIntroTimer <= 0) {
            this.startCountdown(this._gridIntroCountdownOptions);
        }
    }

    // ─── Countdown ─────────────────────────────────────────────────────────────

    _updateCountdown(dt, player) {
        // Keep vehicle locked during countdown
        player.controlsEnabled = false;
        this._updateRanking(player);

        this._countdownTimer -= dt;

        if (this._countdownTimer > 2.5) {
            this._countdownDisplay = '3';
        } else if (this._countdownTimer > 1.5) {
            this._countdownDisplay = '2';
        } else if (this._countdownTimer > 0.5) {
            this._countdownDisplay = '1';
        } else if (this._countdownTimer > 0) {
            this._countdownDisplay = '';
        } else {
            // Transition to racing
            this._countdownDisplay = '';
            const startsOnOrPastStartLine = this._startsRaceAtStartLine(player);
            this._rollingStartCountdown = false;
            if (player.autoDrive && typeof player.stopAutoDrive === 'function') {
                player.stopAutoDrive(true);
            } else {
                player.controlsEnabled = true;
            }
            this.checkpoint.reset(player.nearestIndex, {
                ignoreNextStartCrossing: !startsOnOrPastStartLine,
            });
            this.state = 'racing';
            this.timer.start();
            if (this.aiController) this.aiController.setActive(true);
            this._justEnteredRacing = true;
            this._showMessage('GO!', '#ffff00', 0.9);
        }
    }

    // ─── Racing ────────────────────────────────────────────────────────────────

    _updateRacing(dt, player) {
        if (this._justEnteredRacing) this._justEnteredRacing = false;
        this.timer.update(dt);

        const result = this.checkpointsEnabled
            ? this.checkpoint.update(player.nearestIndex)
            : { crossedCheckpoints: [], crossedStart: this._checkStartCrossing(player) };

        for (const cpIdx of result.crossedCheckpoints) {
            const isFinalLap = this.currentLap === this.totalLaps;
            const isLastCheckpoint = cpIdx === this.checkpoint.checkpointIndices.length - 1;
            const shouldExtend = !(isFinalLap && isLastCheckpoint);

            if (shouldExtend && this.timerEnabled) {
                this.timer.extendTime(this.courseData.checkpointExtension);
                this._showMessage('TIME EXTENDED!', '#00ff99', 1.5);
            }
            if (this.onCheckpoint) this.onCheckpoint(cpIdx);
        }

        if (result.crossedStart) {
            const lapTime = this.timer.completeLap();
            if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
            if (this.onLapComplete) this.onLapComplete(this.currentLap, lapTime);

            if (this.mode === 'free_run') {
                this.currentLap++;
                this._showMessage('LAP CLEAR', '#7ce8ff', 1.1);
                this._updateRanking(player);
                return;
            }

            if (this.currentLap >= this.totalLaps) {
                player.controlsEnabled = false;
                this._finishRace(player);
                return;
            }
            this.currentLap++;
            if (this.currentLap === this.totalLaps) {
                this._showMessage('FINAL LAP!', '#ff6600', 2.0);
                if (this.onFinalLap) this.onFinalLap();
            }
        }

        if (this.timerEnabled && this.timer.expired) {
            this._updateRanking(player);
            player.controlsEnabled = false;
            this._gameOver(player);
            return;
        }

        this._updateRanking(player);
    }

    // ─── Transitions ───────────────────────────────────────────────────────────

    _finishRace(player) {
        this.finishTime = this.timer.totalElapsed;
        this.state = 'finish_celebration';
        this._celebrationStartTime = performance.now();
        this.timer.stop();
        this._pendingPlayerFinish = true;
        this._updateRanking(player);
        this._showMessage('FINISH!', '#ffff00', 99);
        player.startAutoDrive(0.55);
        if (this.onRaceFinish) this.onRaceFinish();
    }

    _updateFinishCelebration(dt, player) {
        player.controlsEnabled = false;
        if (!this._pendingPlayerFinish) {
            this._updateRanking(player, { playerFinished: true });
        }
        const elapsed = performance.now() - this._celebrationStartTime;
        if (elapsed >= this._celebrationDuration) {
            this.state = 'finished';
            if (this.onCelebrationEnd) this.onCelebrationEnd();
        }
    }

    _gameOver(player) {
        this.state = 'gameover';
        this.timer.stop();
        if (this.aiController) this.aiController.setActive(false);
        if (player) this._updateRanking(player);
        this._showMessage('TIME OVER', '#ff2200', 99);
        if (this.onTimeUp) this.onTimeUp();
    }

    // ─── Message ───────────────────────────────────────────────────────────────

    _showMessage(text, color, duration) {
        this.message = { text, color, timer: duration };
    }

    _tickMessage(dt) {
        if (this.message) {
            this.message.timer -= dt;
            if (this.message.timer <= 0) this.message = null;
        }
    }

    // ─── Ranking ───────────────────────────────────────────────────────────────

    _updateRanking(player, options = {}) {
        if (!this.aiController) {
            this.playerPosition = 1;
            this.totalRacers = 1;
            this.gapAheadSec = null;
            this.gapBehindSec = null;
            return;
        }

        const snapshots = this.aiController.getSnapshots();
        const playerState = this._getPlayerRaceState(player, options);
        let ahead = 0;

        const rivalStates = snapshots.map(r => {
            const progress = this._toRaceProgress(
                r.lap, r.t, Boolean(r.completed), r.startLinePassed
            );
            return {
                id: `ai-${r.id}`,
                completed: Boolean(r.completed),
                progress,
                finishPosition: r.finishPosition || 0,
                speed: Math.max(0, r.speed || 0),
            };
        });

        for (const rival of rivalStates) {
            if (this._compareRaceOrder(rival, playerState) < 0) {
                ahead++;
            }
        }

        this.totalRacers = snapshots.length + 1;
        this.playerPosition = ahead + 1;

        // Gap calculation
        const racers = [
            { id: 'player', ...playerState, speed: Math.max(0, player.speed || 0) },
            ...rivalStates,
        ].sort((a, b) => this._compareRaceOrder(a, b));

        const pIdx = racers.findIndex(r => r.id === 'player');
        const aheadRacer = pIdx > 0 ? racers[pIdx - 1] : null;
        const behindRacer = pIdx >= 0 && pIdx < racers.length - 1 ? racers[pIdx + 1] : null;

        this.gapAheadSec = aheadRacer
            ? this._estimateGapSeconds(aheadRacer.progress - playerState.progress, player.speed, aheadRacer.speed)
            : null;
        this.gapBehindSec = behindRacer
            ? this._estimateGapSeconds(playerState.progress - behindRacer.progress, player.speed, behindRacer.speed)
            : null;

        if (this.debugEnabled && this.aiController?.getDebugText) {
            this.aiDebugText = this.aiController.getDebugText(playerState.progress);
        } else {
            this.aiDebugText = '';
        }
    }

    /**
     * Compare two racers for ranking (sort comparator).
     * Returns negative if a ranks higher than b.
     */
    _compareRaceOrder(a, b) {
        // Both completed → earlier finisher wins
        if (a.completed && b.completed) {
            return (a.finishPosition || 999) - (b.finishPosition || 999);
        }
        // Completed beats not-completed
        if (a.completed !== b.completed) {
            return a.completed ? -1 : 1;
        }
        // Higher progress = further ahead
        const progressDelta = (b.progress || 0) - (a.progress || 0);
        if (Math.abs(progressDelta) > 1e-6) return progressDelta;
        return 0;
    }

    /**
     * Build player race state for ranking.
     */
    _getPlayerRaceState(player, options = {}) {
        const playerFinished = Boolean(options.playerFinished);
        if (playerFinished) {
            return {
                completed: true,
                progress: this.totalLaps,
                finishPosition: this._playerFinishPosition,
            };
        }

        const playerStartLinePassed = this.state === 'racing'
            ? !this.checkpoint.ignoreNextStartCrossing
            : false;
        const withinLap = (this.state === 'racing' && this.checkpointsEnabled && playerStartLinePassed)
            ? this._getPlayerWithinLapProgress(player)
            : this._rawFromStart(player.trackT || 0);
        const progress = (!playerStartLinePassed && withinLap > 0.5)
            ? (this.currentLap - 1) + withinLap - 1
            : (this.currentLap - 1) + withinLap;

        return {
            completed: false,
            progress,
            finishPosition: 0,
        };
    }

    /**
     * Compute total race progress for a racer.
     * progress = (lap - 1) + (normalised distance from start line)
     * Before first start-line crossing, cars behind the start get negative offset.
     */
    _toRaceProgress(lap, t, completed = false, startLinePassed = true) {
        if (completed) return this.totalLaps;
        let fromStart = this._rawFromStart(t);
        // Before first start-line crossing, if fromStart > 0.5 the car is
        // actually behind the start line (placed on the grid).
        if (!startLinePassed && fromStart > 0.5) {
            fromStart = fromStart - 1; // negative → behind start
        }
        return (lap - 1) + fromStart;
    }

    /**
     * Raw normalised distance from start line [0, 1).
     */
    _rawFromStart(t) {
        const tn = ((t ?? 0) % 1 + 1) % 1;
        return ((tn - this._startLineT) % 1 + 1) % 1;
    }

    _startsRaceAtStartLine(player) {
        const sampleT = this.courseBuilder.sampledPoints[player?.nearestIndex]?.t ?? 0;
        const trackT = Number.isFinite(player?.trackT) ? player.trackT : sampleT;
        const fromStart = this._rawFromStart(trackT);
        return fromStart <= 0.06 || fromStart >= 0.94;
    }

    /**
     * Player within-lap progress, clamped by checkpoint milestones.
     * If the player hasn't passed checkpoint N yet, progress can't exceed
     * that checkpoint's position + a small buffer. This prevents trackT
     * jumps (from spin recovery, wall pushback, etc.) from causing false
     * ranking changes.
     */
    _getPlayerWithinLapProgress(player) {
        let fromStart = this._rawFromStart(player.trackT || 0);

        // Clamp to the first un-passed checkpoint + buffer
        for (let i = 0; i < this._cpMilestones.length; i++) {
            if (!this.checkpoint.checkpointsPassed[i]) {
                fromStart = Math.min(fromStart, this._cpMilestones[i] + 0.03);
                break;
            }
        }

        return Math.max(0, fromStart);
    }

    _checkStartCrossing(player) {
        const current = this._rawFromStart(player.trackT || 0);
        const prev = this._lastRawFromStart ?? current;
        this._lastRawFromStart = current;
        return prev > 0.85 && current < 0.15;
    }

    _estimateGapSeconds(progressDelta, playerSpeed, otherSpeed) {
        const delta = Math.max(0, progressDelta);
        if (delta <= 0) return 0;
        const dist = delta * this.courseBuilder.courseLength;
        const refSpeed = Math.max(10, ((playerSpeed || 0) + (otherSpeed || 0)) * 0.5);
        return dist / refSpeed;
    }
}
