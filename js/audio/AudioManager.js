import { EngineSound } from './EngineSound.js';

const MUSIC_TRACKS = {
    title:    'assets/audio/bgm/title.mp3',
    race1:    'assets/audio/bgm/race1.mp3',
    race2:    'assets/audio/bgm/race2.mp3',
    race3:    'assets/audio/bgm/race3.mp3',
    result:   'assets/audio/bgm/result.mp3',
    victory1: 'assets/audio/bgm/victory1.mp3',
    victory2: 'assets/audio/bgm/victory2.mp3',
    victory3: 'assets/audio/bgm/victory3.mp3',
};

const COURSE_RACE_TRACKS = {
    thunder: 'race1',
    seaside: 'race2',
    mountain: 'race3',
};

export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.musicGain = null;
        this.seGain = null;
        this.engineGain = null;
        this.engineSound = null;

        this.unlocked = false;
        this.currentMusic = null;
        this.musicTempoScale = 1;
        this.musicPlayers = {};
        this.activeMusicPlayer = null;
        this.pendingMusicTrack = null;
        this.raceMusicTrack = 'race1';

        this.prevRaceState = null;
        this.prevCountdown = null;
        this.prevDrifting = false;
        this.prevBoosting = false;
        this.prevWallHitCount = 0;
        this.prevSpinCount = 0;
        this.prevShiftEventId = 0;
        this.goalSE = null;
        this._finishPosition = 0;
        this._unlockEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown'];
        this._unlockAttached = false;
        this.unlockOverlayEl = document.getElementById('audio-unlock');
        this.unlockStatusEl = document.getElementById('audio-unlock-status');
        this.canvasEl = document.getElementById('gameCanvas');

        this._boundUnlock = () => this.ensureStarted();
        this._attachUnlockListeners();
        this._bindCanvasUnlock();
    }

    async ensureStarted() {
        return this._startAudio();
    }

    async _startAudio() {
        try {
            if (!this.audioContext) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return false;

                this.audioContext = new Ctx();
                this.masterGain = this.audioContext.createGain();
                this.masterGain.gain.value = 1.872;
                this.masterGain.connect(this.audioContext.destination);

                this.musicGain = this.audioContext.createGain();
                this.musicGain.gain.value = 0;   // Start muted; _playMusicTrack unmutes
                this.musicGain.connect(this.masterGain);
                this._musicGainLevel = 0.55692;  // Restored on first explicit play

                this.seGain = this.audioContext.createGain();
                this.seGain.gain.value = 2.2464;
                this.seGain.connect(this.masterGain);

                this.engineGain = this.audioContext.createGain();
                this.engineGain.gain.value = 2.1528;
                this.engineGain.connect(this.masterGain);

                this.engineSound = new EngineSound(this.audioContext, this.engineGain);
                this._initMusicPlayers();
                this._initGoalSE();
            }

            if (this.audioContext.state !== 'running') {
                await this.audioContext.resume();
            }

            this.unlocked = this.audioContext.state === 'running';
            if (this.unlocked) {
                this._flushPendingMusicTrack();
                this._detachUnlockListeners();
                this._setUnlockStatus('');
                this._hideUnlockOverlay();
            }
            return this.unlocked;
        } catch (err) {
            console.warn('AudioManager: failed to start audio context', err);
            this._setUnlockStatus('Sound is blocked. Allow audio for this site, then press the button again.');
            this.unlocked = false;
            return false;
        }
    }

    /**
     * Apply volume settings from options (0–100 normalized to 0–1).
     * @param {number} bgmNorm  0..1
     * @param {number} seNorm   0..1
     * @param {number} engineNorm 0..1
     */
    setVolumes(bgmNorm, seNorm, engineNorm) {
        this._musicGainLevel = 0.55692 * bgmNorm;
        if (this.musicGain && this.musicGain.gain.value > 0) {
            this.musicGain.gain.value = this._musicGainLevel;
        }
        if (this.seGain) this.seGain.gain.value = 2.2464 * seNorm;
        if (this.engineGain) this.engineGain.gain.value = 2.1528 * engineNorm;
    }

    update(dt, player, race) {
        if (!this.unlocked || !this.audioContext) return;

        this._syncMusic(race);

        if (this.engineSound) {
            const active = Boolean(race && (race.state === 'countdown' || race.state === 'racing' || race.state === 'finish_celebration' || race.state === 'finished'));
            this.engineSound.setActive(active);
            this.engineSound.update(player, dt);
        }

        this._handleRaceTransitions(race);
        this._handleVehicleTransitions(player);
    }

    setRaceMusicTrack(courseId = 'thunder') {
        const nextTrack = COURSE_RACE_TRACKS[courseId] || 'race1';
        if (nextTrack === this.raceMusicTrack) return;

        this.raceMusicTrack = nextTrack;
        if (this._isRaceTrack(this.currentMusic)) {
            this.currentMusic = nextTrack;
            this._playMusicTrack(nextTrack);
        } else if (this._isRaceTrack(this.pendingMusicTrack)) {
            this.pendingMusicTrack = nextTrack;
        }
    }

    playCheckpoint() {
        this._playTone(880, 0.09, 'triangle', 0.07);
        this._playTone(1174.66, 0.14, 'triangle', 0.05, 0.03);
    }

    playLapComplete() {
        this._playTone(523.25, 0.12, 'square', 0.06);
        this._playTone(659.25, 0.16, 'square', 0.055, 0.05);
        this._playTone(783.99, 0.18, 'square', 0.05, 0.1);
    }

    playFinalLap() {
        this._playTone(392.0, 0.22, 'sawtooth', 0.07);
        this._playTone(523.25, 0.24, 'sawtooth', 0.06, 0.08);
    }

    playFinish() {
        this.musicTempoScale = 1;
        this._applyMusicTempoScale();
        // Stop race BGM
        if (this.activeMusicPlayer) {
            this.activeMusicPlayer.pause();
            this.activeMusicPlayer.currentTime = 0;
            this.activeMusicPlayer = null;
        }
        this.currentMusic = '_goal';
        // Play goal jingle, then rank-appropriate fanfare, then result BGM
        if (this.goalSE) {
            this.goalSE.currentTime = 0;
            this.goalSE.onended = () => {
                this._playAfterGoal();
            };
            this.goalSE.play().catch(() => {});
        }
    }

    /** Called by main.js once the finish position is determined. */
    setFinishPosition(pos) {
        this._finishPosition = pos;
    }

    _playAfterGoal() {
        const pos = this._finishPosition;
        if (pos >= 1 && pos <= 3) {
            this._playVictoryTrack(pos);
        } else {
            this._playResultOnce();
        }
    }

    /**
     * Play the victory mp3 for the given finish position (1–3),
     * then automatically start result BGM when it ends.
     */
    _playVictoryTrack(pos) {
        const key    = `victory${pos}`;
        const player = this.musicPlayers[key];
        if (!player) {
            this._playResultOnce();
            return;
        }

        if (this.activeMusicPlayer && this.activeMusicPlayer !== player) {
            this.activeMusicPlayer.pause();
            this.activeMusicPlayer.currentTime = 0;
        }

        if (this.musicGain && this._musicGainLevel) {
            this.musicGain.gain.value = this._musicGainLevel;
        }

        player.loop         = false;
        player.currentTime  = 0;
        player.onended      = () => this._playResultOnce();
        this.activeMusicPlayer = player;
        this.currentMusic      = '_victory';
        player.play().catch(() => {});
    }

    playTimeUp() {
        this.musicTempoScale = 1;
        this._applyMusicTempoScale();
        this._playTone(220.0, 0.22, 'sawtooth', 0.09);
        this._playTone(164.81, 0.32, 'sawtooth', 0.08, 0.14);
    }

    playTitleScreenMusic() {
        const titlePlayer = this.musicPlayers['title'];
        const titleAlreadyActive = this.currentMusic === 'title'
            && this.activeMusicPlayer === titlePlayer
            && !titlePlayer.paused;
        const titleAlreadyQueued = this.currentMusic === 'title'
            && this.pendingMusicTrack === 'title';
        if (titleAlreadyActive || titleAlreadyQueued) {
            return;
        }
        this._queueOrPlayMusic('title');
    }

    stopMusic({ resetCurrent = false } = {}) {
        if (this.activeMusicPlayer) {
            this.activeMusicPlayer.pause();
            this.activeMusicPlayer.currentTime = 0;
            this.activeMusicPlayer = null;
        }
        if (this.goalSE) {
            this.goalSE.pause();
            this.goalSE.currentTime = 0;
            this.goalSE.onended = null;
        }
        if (this.engineSound) {
            this.engineSound.stop(true);
        }
        if (resetCurrent) {
            this.currentMusic = null;
            this.pendingMusicTrack = null;
            this.prevRaceState = null;
            this.prevCountdown = null;
        }
    }

    resetForRetry() {
        this.prevRaceState = null;
        this.prevCountdown = null;
        this.prevDrifting = false;
        this.prevBoosting = false;
        this.prevWallHitCount = 0;
        this.prevSpinCount = 0;
        this.prevShiftEventId = 0;
        this._finishPosition = 0;
        this.musicTempoScale = 1;
        this._applyMusicTempoScale();
        // Reset goal SE
        if (this.goalSE) {
            this.goalSE.pause();
            this.goalSE.currentTime = 0;
            this.goalSE.onended = null;
        }
        // Reset victory tracks
        for (let i = 1; i <= 3; i++) {
            const vp = this.musicPlayers[`victory${i}`];
            if (vp) { vp.pause(); vp.currentTime = 0; vp.onended = null; }
        }
        const resultPlayer = this.musicPlayers['result'];
        if (resultPlayer) resultPlayer.currentTime = 0;
        this.playTitleScreenMusic();
    }

    _attachUnlockListeners() {
        if (this._unlockAttached) return;
        for (const eventName of this._unlockEvents) {
            window.addEventListener(eventName, this._boundUnlock, { passive: true });
            document.addEventListener(eventName, this._boundUnlock, { passive: true });
        }
        this._unlockAttached = true;
    }

    _detachUnlockListeners() {
        if (!this._unlockAttached) return;
        for (const eventName of this._unlockEvents) {
            window.removeEventListener(eventName, this._boundUnlock);
            document.removeEventListener(eventName, this._boundUnlock);
        }
        this._unlockAttached = false;
    }

    _bindCanvasUnlock() {
        if (!this.canvasEl) return;

        const activateAudio = async () => {
            if (this.unlocked) return;
            this.canvasEl.focus({ preventScroll: true });
            this._setUnlockStatus('Starting audio...');
            const started = await this._startAudio();
            if (!started) {
                this._showUnlockOverlay();
                this._setUnlockStatus('Sound is still blocked. Activate the game screen again and check site sound permissions.');
            }
        };

        this.canvasEl.addEventListener('pointerdown', activateAudio, { passive: true });
        this.canvasEl.addEventListener('click', activateAudio, { passive: true });
        this.canvasEl.addEventListener('focus', activateAudio);
    }

    _showUnlockOverlay() {
        if (!this.unlockOverlayEl) return;
        this.unlockOverlayEl.classList.remove('hidden');
    }

    _hideUnlockOverlay() {
        if (!this.unlockOverlayEl) return;
        this.unlockOverlayEl.classList.add('hidden');
    }

    _setUnlockStatus(text) {
        if (this.unlockStatusEl) {
            this.unlockStatusEl.textContent = text;
        }
    }

    _initMusicPlayers() {
        // Tracks that should NOT loop (play once then stop)
        const noLoop = new Set(['result', 'victory1', 'victory2', 'victory3']);

        for (const [key, path] of Object.entries(MUSIC_TRACKS)) {
            const audio = new Audio(path);
            audio.preload = 'auto';
            audio.loop = !noLoop.has(key);
            audio.playsInline = true;

            const source = this.audioContext.createMediaElementSource(audio);
            source.connect(this.musicGain);

            this.musicPlayers[key] = audio;
        }
    }

    _initGoalSE() {
        const audio = new Audio('assets/audio/bgm/goal.mp3');
        audio.preload = 'auto';
        audio.playsInline = true;
        const source = this.audioContext.createMediaElementSource(audio);
        source.connect(this.musicGain);
        this.goalSE = audio;
    }

    _playResultOnce() {
        const player = this.musicPlayers['result'];
        if (!player) return;
        if (this.activeMusicPlayer && this.activeMusicPlayer !== player) {
            this.activeMusicPlayer.pause();
            this.activeMusicPlayer.currentTime = 0;
        }
        player.loop = false;
        player.currentTime = 0;
        this.activeMusicPlayer = player;
        this.currentMusic = '_result_once';
        player.play().catch(() => {});
    }

    _handleRaceTransitions(race) {
        if (!race) return;

        const countdown = race.countdownDisplay;
        if (countdown && countdown !== this.prevCountdown) {
            this._playCountdownBeep(countdown);
        } else if (race.state === 'racing' && this.prevRaceState === 'countdown') {
            this._playGo();
        }
        this.prevCountdown = countdown;
        this.prevRaceState = race.state;
    }

    _handleVehicleTransitions(player) {
        if (!player) return;

        if (player.isDrifting && !this.prevDrifting) {
            this._playDriftStart();
        }
        if (player.isBoosting && !this.prevBoosting) {
            this._playBoost();
        }
        if ((player.wallHitCount || 0) > this.prevWallHitCount) {
            this._playCollision(player.lastWallImpact || 0.4);
        }
        if ((player.spinOutCount || 0) > this.prevSpinCount) {
            this._playSpin();
        }
        const shiftEvent = player.consumeShiftEvent?.();
        if (shiftEvent && shiftEvent.id !== this.prevShiftEventId) {
            this._playShift(shiftEvent);
            this.prevShiftEventId = shiftEvent.id;
        }

        this.prevDrifting = player.isDrifting;
        this.prevBoosting = player.isBoosting;
        this.prevWallHitCount = player.wallHitCount || 0;
        this.prevSpinCount = player.spinOutCount || 0;
    }

    _syncMusic(race) {
        let nextMusic = 'title';
        if (race?.state === 'racing' || race?.state === 'countdown' || race?.state === 'grid_intro') {
            nextMusic = this.raceMusicTrack;
        } else if (race?.state === 'finish_celebration' || race?.state === 'finished') {
            const stable = ['_goal', '_victory', '_result_once'];
            nextMusic = stable.includes(this.currentMusic) ? this.currentMusic : '_goal';
        } else if (race?.state === 'gameover') {
            nextMusic = 'result';
        }

        // Don't auto-start title BGM on initial load (idle state before
        // grid_intro). Title BGM is explicitly started by the title UI or retry flow.
        if (nextMusic === 'title' && this.currentMusic === null) {
            return;
        }

        if (nextMusic !== this.currentMusic) {
            this.currentMusic = nextMusic;
            if (nextMusic !== 'race') {
                this.musicTempoScale = 1;
            }
            this._playMusicTrack(nextMusic);
        }
    }

    _playMusicTrack(trackName) {
        const nextPlayer = this.musicPlayers[trackName];
        if (!nextPlayer) return;

        if (this.activeMusicPlayer && this.activeMusicPlayer !== nextPlayer) {
            this.activeMusicPlayer.pause();
            this.activeMusicPlayer.currentTime = 0;
        }

        // Unmute music gain on first explicit play (was 0 during init to
        // prevent preloaded Audio elements from leaking sound).
        if (this.musicGain && this._musicGainLevel) {
            this.musicGain.gain.value = this._musicGainLevel;
        }

        nextPlayer.currentTime = 0;  // Always start from the beginning
        nextPlayer.playbackRate = this._isRaceTrack(trackName) ? this.musicTempoScale : 1;
        if (typeof nextPlayer.preservesPitch === 'boolean') {
            nextPlayer.preservesPitch = false;
        }

        this.activeMusicPlayer = nextPlayer;
        const playPromise = nextPlayer.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
                console.warn(`AudioManager: failed to play music track "${trackName}"`, err);
            });
        }
    }

    _queueOrPlayMusic(trackName) {
        this.pendingMusicTrack = trackName;
        if (!this.unlocked || !this.audioContext) return;

        if (!this._isRaceTrack(trackName)) {
            this.musicTempoScale = 1;
        }
        this.currentMusic = trackName;
        this.pendingMusicTrack = null;
        this._playMusicTrack(trackName);
    }

    _flushPendingMusicTrack() {
        if (!this.pendingMusicTrack) return;
        const trackName = this.pendingMusicTrack;
        this.pendingMusicTrack = null;
        this._queueOrPlayMusic(trackName);
    }

    _applyMusicTempoScale() {
        if (this.activeMusicPlayer && this._isRaceTrack(this.currentMusic)) {
            this.activeMusicPlayer.playbackRate = this.musicTempoScale;
        }
    }

    _isRaceTrack(trackName) {
        return trackName === 'race1' || trackName === 'race2' || trackName === 'race3';
    }

    _playCountdownBeep(countdown) {
        const freq = countdown === '1' ? 660 : 440;
        this._playTone(freq, 0.08, 'square', 0.06);
    }

    _playGo() {
        this._playTone(988.0, 0.12, 'square', 0.08);
        this._playTone(1318.51, 0.18, 'triangle', 0.06, 0.05);
    }

    _playDriftStart() {
        this._playNoise(0.16, 0.035, 1400);
    }

    _playBoost() {
        this._playTone(180, 0.2, 'sawtooth', 0.06);
        this._playNoise(0.22, 0.04, 2200);
    }

    _playCollision(intensity = 0.4) {
        const gain = Math.min(0.12, 0.04 + intensity * 0.09);
        this._playNoise(0.12, gain, 900);
    }

    _playSpin() {
        this._playTone(240, 0.18, 'square', 0.07);
        this._playTone(180, 0.24, 'square', 0.06, 0.06);
    }

    _playShift(shiftEvent) {
        const isUp = shiftEvent.type === 'up';
        if (isUp) {
            this._playTone(220, 0.06, 'square', 0.045);
            this._playTone(300, 0.06, 'triangle', 0.035, 0.04);
        } else {
            this._playTone(180, 0.07, 'square', 0.05);
            this._playTone(145, 0.08, 'triangle', 0.04, 0.03);
        }
        if (this.engineSound?.triggerShift) {
            this.engineSound.triggerShift({
                type: shiftEvent.type,
                gear: shiftEvent.gear,
                speedKmh: shiftEvent.speedKmh,
            });
        }
    }

    _playTone(freq, duration, type, gain, delay = 0, destination = null, when = null) {
        if (!this.audioContext || !this.seGain) return;

        const osc = this.audioContext.createOscillator();
        const amp = this.audioContext.createGain();
        const filter = this.audioContext.createBiquadFilter();
        const startAt = when ?? (this.audioContext.currentTime + delay);
        const out = destination ?? this.seGain;

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startAt);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.96), startAt + duration);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.max(700, freq * 4), startAt);

        amp.gain.setValueAtTime(0.0001, startAt);
        amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        osc.connect(filter);
        filter.connect(amp);
        amp.connect(out);

        osc.start(startAt);
        osc.stop(startAt + duration + 0.02);
    }

    _playNoise(duration, gain, filterFreq = 1200) {
        if (!this.audioContext || !this.seGain) return;

        const bufferSize = Math.max(1, Math.floor(this.audioContext.sampleRate * duration));
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }

        const src = this.audioContext.createBufferSource();
        const filter = this.audioContext.createBiquadFilter();
        const amp = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        src.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = filterFreq;
        filter.Q.value = 0.7;

        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.exponentialRampToValueAtTime(gain, now + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        src.connect(filter);
        filter.connect(amp);
        amp.connect(this.seGain);

        src.start(now);
    }
}
