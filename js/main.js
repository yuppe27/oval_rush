import * as THREE from 'three';
import { GameLoop } from './core/GameLoop.js';
import { Renderer } from './graphics/Renderer.js';
import { CameraController } from './graphics/CameraController.js';
import { HUD } from './graphics/HUD.js';
import { InputManager } from './input/InputManager.js';
import { PlayerVehicle } from './vehicles/PlayerVehicle.js';
import { CourseBuilder } from './courses/CourseBuilder.js';
import { resolveCourse } from './courses/CourseData.js';
import { RaceManager } from './race/RaceManager.js';
import { AIController } from './ai/AIController.js';
import { SlipstreamSystem } from './effects/SlipstreamSystem.js';
import { TrackEffects } from './effects/TrackEffects.js';
import { BoostFX } from './effects/BoostFX.js';
import { AudioManager } from './audio/AudioManager.js';
import { resolveVehiclePreset, toVehiclePhysics } from './vehicles/VehicleParams.js';
import { UIManager } from './ui/UIManager.js';
import { insertRanking } from './race/Ranking.js';
import {
    FIXED_TIMESTEP,
    RACE_COUNTDOWN_DURATION,
    ROLLING_START_GRID_INTRO_DURATION,
} from './core/Constants.js';

class Game {
    constructor(launchOptions = {}, audioManager = null) {
        const canvas = document.getElementById('gameCanvas');
        this.audio = audioManager || new AudioManager();
        this.mode = (launchOptions.mode || 'arcade').toLowerCase();
        this._courseId = (launchOptions.courseId || 'thunder').toLowerCase();
        this._difficulty = (launchOptions.difficulty || 'NORMAL').toUpperCase();
        this._quality = launchOptions.quality || 'auto';
        this._paused = false;
        this._retryListenerAdded = false;
        this._resultKeyHandler = null;
        this._pauseAvailability = true;
        this._pendingRollingStartLaunch = false;
        this.audio.setRaceMusicTrack(this._courseId);

        this.renderer = new Renderer(canvas, { quality: this._quality });
        this.cameraController = new CameraController();
        this.hud = new HUD();
        this.input = new InputManager();
        this.gameLoop = new GameLoop();

        const vehiclePreset = resolveVehiclePreset((launchOptions.vehicleId || 'falcon').toLowerCase());
        const transmission = (launchOptions.transmission || 'AT').toUpperCase() === 'MT' ? 'MT' : 'AT';
        this.player = new PlayerVehicle({
            ...toVehiclePhysics(vehiclePreset),
            transmission,
        });

        this.courseData = resolveCourse(this._courseId);
        this.courseBuilder = new CourseBuilder();
        this.courseBuilder.build(this.courseData);
        this.courseBuilder.addToScene(this.renderer.scene);

        this.raceCourseData = this._buildRaceCourseConfig(
            this.courseData,
            this._difficulty,
            this.courseBuilder.courseLength,
            this.player.maxSpeed,
            this.mode
        );

        this._applyCourseAtmosphere(this.courseData.id);
        this.player.setCourse(this.courseBuilder);

        this.raceManager = new RaceManager(this.courseBuilder, this.raceCourseData);
        this.raceManager.onCheckpoint = () => this.audio.playCheckpoint();
        this.raceManager.onLapComplete = () => this.audio.playLapComplete();
        this.raceManager.onFinalLap = () => this.audio.playFinalLap();
        this.raceManager.onRaceFinish = () => {
            this.audio.playFinish();
            this.gameLoop.setTimeScale(0.35, 0);
        };
        this.raceManager.onCelebrationEnd = () => {
            this.gameLoop.setTimeScale(1, 0);
        };
        this.raceManager.onTimeUp = () => this.audio.playTimeUp();

        const params = new URLSearchParams(window.location.search);
        const aiDebug = params.get('aiDebug') === '1';
        this._finishTest = params.get('finishTest') === '1' && this.mode === 'arcade';
        const aiCount = this.raceCourseData.aiEnabled ? Math.max(0, this.raceCourseData.gridSize - 1) : 0;
        this.aiController = new AIController(this.courseBuilder, this.raceCourseData, {
            aiCount,
            difficulty: this._difficulty,
            playerMaxSpeed: this.player.maxSpeed,
            playerAcceleration: this.player.acceleration,
            debug: aiDebug,
        });
        this.aiController.addToScene(this.renderer.scene);
        this.raceManager.setAIController(this.aiController);

        this.slipstreamSystem = new SlipstreamSystem(this.renderer.scene);
        this.trackEffects = new TrackEffects(this.renderer.scene);
        this.boostFX = new BoostFX();

        this._placePlayerAtStart();
        this.player.addToScene(this.renderer.scene);
        this.raceManager.setDebugEnabled(aiDebug);
        this.hud.setRaceContext(this._courseId, this._difficulty);

        this._setupLoop();

        if (this._finishTest) {
            setTimeout(() => this._startFinishTest(), 800);
        } else {
            setTimeout(() => this._startRaceSequence(), 500);
        }
    }

    _setupLoop() {
        this.gameLoop.onFixedUpdate((dt) => {
            if (this._paused) return;
            this.slipstreamSystem.update(dt, this.player, this.aiController, this.raceManager.state);
            this.player.fixedUpdate(dt, this.input);
            this.raceManager.update(dt, this.player);
            const aiRaceState = this.raceManager.isRollingStartCountdown ? 'racing' : this.raceManager.state;
            this.aiController.update(
                dt,
                this.player,
                aiRaceState,
                this.raceManager.currentLap,
                this.raceManager.justEnteredRacing
            );
            this._syncRollingStartAutoDrive();
            this.raceManager.finalizeFinishOrder(this.player);
            this._syncPauseAvailability();
            this.trackEffects.update(dt, this.player, this.raceManager.state);
        });

        this.gameLoop.onRender((dt, alpha, rawDt) => {
            this.input.update();
            this._syncPauseAvailability();
            if (this.input.consumePause() && this._pauseAvailability) {
                if (this._onPauseToggle) this._onPauseToggle();
            }

            if (this._paused) {
                this.renderer.render(this.cameraController.camera);
                return;
            }

            if (this.input.consumeCameraSwitch()) {
                this.cameraController.cycleMode();
            }

            const pPos = this.player.position;
            this.renderer.dirLight.position.set(pPos.x + 50, 80, pPos.z + 30);
            this.renderer.dirLight.target.position.copy(pPos);
            this.renderer.dirLight.target.updateMatrixWorld();

            this.cameraController.update(rawDt, this.player, this.raceManager);
            this._updateCourseEnvironment(rawDt);
            this.hud.update(this.player, this.raceManager, rawDt);
            this.boostFX.update(rawDt, this.player);
            this.audio.update(rawDt, this.player, this.raceManager);
            this.renderer.updateSky(this.cameraController.camera);
            this.renderer.render(this.cameraController.camera);

            if ((this.raceManager.state === 'finished' || this.raceManager.state === 'gameover')
                && !this._retryListenerAdded) {
                this._bindResultButtons();
                this._retryListenerAdded = true;
            }
        });

        this.gameLoop.start();
    }

    _syncPauseAvailability() {
        const pauseAvailable = this.raceManager.state !== 'finished' && this.raceManager.state !== 'gameover';
        if (pauseAvailable === this._pauseAvailability) return;
        this._pauseAvailability = pauseAvailable;
        if (this._onPauseAvailabilityChange) {
            this._onPauseAvailabilityChange(pauseAvailable);
        }
    }

    _bindResultButtons() {
        document.getElementById('btn-retry')?.addEventListener('click', () => this.retry());
        document.getElementById('btn-course-select')?.addEventListener('click', () => {
            if (this._onCourseSelect) this._onCourseSelect();
        });
        document.getElementById('btn-title')?.addEventListener('click', () => {
            if (this._onQuitToTitle) this._onQuitToTitle();
        });
        this._bindInitialsInput();
    }

    _bindInitialsInput() {
        const chars = document.querySelectorAll('.initial-char');
        if (!chars.length) return;

        let activeIdx = 0;
        chars[0]?.classList.add('active');
        const saveBtn = document.getElementById('btn-save-ranking');

        chars.forEach((el, index) => {
            el.addEventListener('click', () => {
                chars.forEach((charEl) => charEl.classList.remove('active'));
                activeIdx = index;
                el.classList.add('active');
            });
        });

        const cycleChar = (el, dir) => {
            const code = el.textContent.charCodeAt(0);
            let next = code + dir;
            if (next > 90) next = 65;
            if (next < 65) next = 90;
            el.textContent = String.fromCharCode(next);
        };

        this._resultKeyHandler = (e) => {
            if (!document.querySelector('.initial-char')) return;
            if (e.code === 'ArrowUp') {
                cycleChar(chars[activeIdx], 1);
                e.preventDefault();
            } else if (e.code === 'ArrowDown') {
                cycleChar(chars[activeIdx], -1);
                e.preventDefault();
            } else if (e.code === 'ArrowRight') {
                chars[activeIdx].classList.remove('active');
                activeIdx = Math.min(activeIdx + 1, chars.length - 1);
                chars[activeIdx].classList.add('active');
                e.preventDefault();
            } else if (e.code === 'ArrowLeft') {
                chars[activeIdx].classList.remove('active');
                activeIdx = Math.max(activeIdx - 1, 0);
                chars[activeIdx].classList.add('active');
                e.preventDefault();
            } else if (e.code === 'Enter' && saveBtn) {
                saveBtn.click();
            }
        };
        window.addEventListener('keydown', this._resultKeyHandler);

        saveBtn?.addEventListener('click', () => {
            const name = Array.from(chars).map((c) => c.textContent).join('');
            const totalTimeMs = Math.round((this.raceManager.timer?.totalElapsed || 0) * 1000);
            const rank = insertRanking(this._courseId, this._difficulty, {
                name,
                time: totalTimeMs,
                position: this.raceManager.playerPosition,
            });
            saveBtn.disabled = true;
            saveBtn.textContent = 'SAVED!';
            // rank is 1-based; pass 0-based index (-1 if not on the list)
            this.hud.refreshRankingDisplay(this._courseId, this._difficulty, rank - 1);
        });
    }

    setPaused(paused) {
        this._paused = paused;
    }

    applyRuntimeOptions(options) {
        if (options?.quality) {
            this.renderer.applyQualityProfile(options.quality);
        }
    }

    retry() {
        this._retryListenerAdded = false;
        this._pendingRollingStartLaunch = false;
        if (this._resultKeyHandler) {
            window.removeEventListener('keydown', this._resultKeyHandler);
            this._resultKeyHandler = null;
        }
        this.hud.reset();
        this.raceManager.reset();
        this.slipstreamSystem.reset(this.player);
        this.trackEffects.reset();
        this.boostFX.reset();
        this.audio.resetForRetry();
        this._placePlayerAtStart();
        this._pauseAvailability = true;
        if (this._onPauseAvailabilityChange) {
            this._onPauseAvailabilityChange(true);
        }
        setTimeout(() => this._startRaceSequence(), 250);
    }

    destroy() {
        this.gameLoop.stop();
        this.hud.reset();
        if (this._resultKeyHandler) {
            window.removeEventListener('keydown', this._resultKeyHandler);
            this._resultKeyHandler = null;
        }
        const resultEl = document.getElementById('hud-result');
        if (resultEl) resultEl.style.display = 'none';
        this.input.destroy();
        this.cameraController.dispose();
        this.renderer.dispose();
    }

    _getRollingStartFormation() {
        const N = this.courseBuilder.sampledPoints.length;
        const startIdx = this.courseBuilder.startLineIndex;
        const spacingSamples = Math.max(3, Math.floor(N * 0.007));
        const aiCount = this.aiController?.vehicles?.length ?? 0;
        const maxAiRow = Math.floor((Math.max(0, aiCount - 1)) / 2) + 1;
        const playerRow = maxAiRow + 1;

        let formationStartIdx = startIdx;
        if (this.courseData.id === 'thunder' && this._shouldUseRollingStart()) {
            const rollingStartSpeedRatio = this.raceCourseData.rollingStartSpeedRatio ?? 0.4;
            const totalAutoDriveDistance = this._estimateRollingStartAutoDriveDistance(
                rollingStartSpeedRatio,
                ROLLING_START_GRID_INTRO_DURATION + RACE_COUNTDOWN_DURATION
            );
            const totalAutoDriveSamples = Math.round(
                (totalAutoDriveDistance / Math.max(1e-3, this.courseBuilder.courseLength)) * N
            );
            formationStartIdx = (
                startIdx
                - totalAutoDriveSamples
                + playerRow * spacingSamples
            ) % N;
            if (formationStartIdx < 0) formationStartIdx += N;
        }

        return {
            formationStartIdx,
            playerRow,
            spacingSamples,
        };
    }

    _estimateRollingStartAutoDriveDistance(targetSpeedRatio, durationSec) {
        const targetSpeed = this.player.maxSpeed * targetSpeedRatio;
        let speed = targetSpeed * 0.94;
        let remaining = Math.max(0, durationSec);
        let distance = 0;

        while (remaining > 1e-6) {
            const dt = Math.min(FIXED_TIMESTEP, remaining);
            if (speed < targetSpeed) {
                speed += this.player.acceleration * 0.5 * dt;
                if (speed > targetSpeed) speed = targetSpeed;
            } else {
                speed *= Math.pow(0.97, dt * 60);
            }
            distance += speed * dt;
            remaining -= dt;
        }

        return distance;
    }

    _placePlayerAtStart() {
        const N = this.courseBuilder.sampledPoints.length;
        if (!N || !this.aiController || !this.raceCourseData.aiEnabled) {
            const startSp = this.courseBuilder.sampledPoints[this.courseBuilder.startLineIndex];
            this.player.resetToStart(
                this.courseData.startPosition,
                this.courseData.startRotation,
                startSp ? {
                    index: this.courseBuilder.startLineIndex,
                    t: startSp.t,
                    up: startSp.up,
                    right: startSp.right,
                } : null
            );
            this.player.controlsEnabled = false;
            return;
        }

        const { formationStartIdx, playerRow, spacingSamples } = this._getRollingStartFormation();
        this.aiController.resetToGrid(formationStartIdx);
        const idx = (formationStartIdx - playerRow * spacingSamples + N) % N;
        const sp = this.courseBuilder.sampledPoints[idx];
        this.player.resetToStart(
            { x: sp.position.x, y: sp.position.y + 0.05, z: sp.position.z },
            Math.atan2(sp.forward.x, sp.forward.z),
            { index: idx, t: sp.t, up: sp.up, right: sp.right }
        );
        this.player.controlsEnabled = false;
    }

    _startRaceSequence() {
        if (this._shouldUseRollingStart()) {
            const driveDuringIntro = this.raceCourseData.rollingStartIntroDrive === true;
            this._pendingRollingStartLaunch = !driveDuringIntro;
            if (driveDuringIntro) {
                this._beginRollingStartCountdown();
            }
            this.raceManager.startGridIntro(ROLLING_START_GRID_INTRO_DURATION, {
                rollingStart: true,
                driveDuringIntro,
            });
            return;
        }
        this._pendingRollingStartLaunch = false;
        this.raceManager.startGridIntro(this.mode === 'arcade' ? 3.5 : 1.4);
    }

    _shouldUseRollingStart() {
        return this.mode === 'arcade'
            && this.raceCourseData.aiEnabled
            && this.raceCourseData.rollingStart === true;
    }

    _beginRollingStartCountdown() {
        const startSpeedRatio = this.raceCourseData.rollingStartSpeedRatio ?? 0.4;
        this.player.startAutoDrive(startSpeedRatio);
        this.player.speed = Math.max(this.player.speed, this.player.maxSpeed * startSpeedRatio * 0.94);
    }

    _syncRollingStartAutoDrive() {
        if (!this._pendingRollingStartLaunch || !this.raceManager.isRollingStartCountdown) return;
        this._pendingRollingStartLaunch = false;
        this._beginRollingStartCountdown();
    }

    _startFinishTest() {
        const rm = this.raceManager;
        const cb = this.courseBuilder;
        const N = cb.sampledPoints.length;
        const startIdx = cb.startLineIndex;
        const offset = Math.max(4, Math.floor(N * 0.03));
        const idx = (startIdx - offset + N) % N;
        const sp = cb.sampledPoints[idx];
        this.player.resetToStart(
            { x: sp.position.x, y: sp.position.y + 0.05, z: sp.position.z },
            Math.atan2(sp.forward.x, sp.forward.z),
            { index: idx, t: sp.t, up: sp.up, right: sp.right }
        );
        rm.currentLap = rm.totalLaps;
        rm.state = 'racing';
        rm.timer.start();
        rm.checkpoint.reset(idx);
        rm.checkpoint.ignoreNextStartCrossing = false;
        rm.checkpoint.checkpointsPassed.fill(true);
        this.player.controlsEnabled = true;
        if (this.aiController) {
            this.aiController.setActive(true);
            for (const ai of this.aiController.vehicles) {
                ai.lap = Math.max(1, rm.totalLaps - 1 + Math.floor(Math.random() * 2));
                ai.progressT = Math.random();
                ai.speed = ai.maxSpeed * (0.7 + Math.random() * 0.25);
                ai.startLinePassed = true;
            }
        }
    }

    _applyCourseAtmosphere(courseId) {
        this.renderer.setSky(courseId);
        if (courseId === 'seaside') {
            this.renderer.scene.fog.near = 180;
            this.renderer.scene.fog.far = 760;
            return;
        }
        if (courseId === 'mountain') {
            this.renderer.scene.fog.near = 120;
            this.renderer.scene.fog.far = 620;
            return;
        }
        this.renderer.scene.fog.near = 200;
        this.renderer.scene.fog.far = 800;
    }

    _updateCourseEnvironment(dt) {
        const env = this.courseBuilder.getEnvironmentState(this.player.nearestIndex);
        const tunnelLight = env.tunnelLighting ?? 1;
        const mistDensity = env.mistDensity ?? 0;
        const ambientTarget = this.courseData.id === 'seaside'
            ? 0.32 + tunnelLight * 0.38
            : 0.56 - mistDensity * 0.12;
        const dirTarget = this.courseData.id === 'seaside'
            ? 0.42 + tunnelLight * 0.58
            : 0.88 - mistDensity * 0.18;
        const fogNearBase = this.courseData.id === 'mountain' ? 120 : 180;
        const fogFarBase = this.courseData.id === 'mountain' ? 620 : 760;
        const fogNearTarget = fogNearBase - mistDensity * 35;
        const fogFarTarget = fogFarBase - mistDensity * 150 - (1 - tunnelLight) * 120;

        this.renderer.ambientLight.intensity = THREE.MathUtils.lerp(
            this.renderer.ambientLight.intensity, ambientTarget, dt * 3
        );
        this.renderer.dirLight.intensity = THREE.MathUtils.lerp(
            this.renderer.dirLight.intensity, dirTarget, dt * 3
        );
        this.renderer.scene.fog.near = THREE.MathUtils.lerp(this.renderer.scene.fog.near, fogNearTarget, dt * 2.5);
        this.renderer.scene.fog.far = THREE.MathUtils.lerp(this.renderer.scene.fog.far, fogFarTarget, dt * 2.5);
    }

    _buildRaceCourseConfig(baseCourse, difficulty = 'NORMAL', courseLength = 2500, maxSpeedMs = 77.8, mode = 'arcade') {
        if (mode === 'time_attack') {
            return {
                ...baseCourse,
                mode,
                laps: 3,
                initialTime: Infinity,
                checkpointExtension: 0,
                gridSize: 1,
                timerEnabled: false,
                checkpointsEnabled: false,
                rankingEnabled: true,
                aiEnabled: false,
            };
        }

        if (mode === 'free_run') {
            return {
                ...baseCourse,
                mode,
                laps: 0,
                initialTime: Infinity,
                checkpointExtension: 0,
                gridSize: 1,
                timerEnabled: false,
                checkpointsEnabled: false,
                rankingEnabled: false,
                aiEnabled: false,
            };
        }

        const speedEfficiency = { thunder: 0.84, seaside: 0.76, mountain: 0.70 };
        const avgSpeedMs = maxSpeedMs * (speedEfficiency[baseCourse.id] || 0.78);
        const estimatedLapTime = courseLength / avgSpeedMs;
        const marginMap = { EASY: 1.35, NORMAL: 1.18, HARD: 1.05 };
        const margin = marginMap[difficulty] || 1.18;
        const numCheckpoints = baseCourse.checkpointPositions.length;
        const firstCpT = baseCourse.checkpointPositions[0] || 0.2;
        const initialTime = Math.ceil(estimatedLapTime * firstCpT * margin) + 6;
        const checkpointExtension = Math.ceil(estimatedLapTime / numCheckpoints * margin);
        return {
            ...baseCourse,
            mode,
            initialTime,
            checkpointExtension,
            timerEnabled: true,
            checkpointsEnabled: true,
            rankingEnabled: true,
            aiEnabled: true,
        };
    }
}

class TitleDemo {
    constructor(options = {}) {
        const canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(canvas, { quality: options.quality || 'low' });
        this.cameraController = new CameraController();
        this.gameLoop = new GameLoop();
        this.courseData = resolveCourse(options.courseId || 'thunder');
        this.courseBuilder = new CourseBuilder();
        this.courseBuilder.build(this.courseData);
        this.courseBuilder.addToScene(this.renderer.scene);

        const vehiclePreset = resolveVehiclePreset(options.vehicleId || 'falcon');
        this.player = new PlayerVehicle({
            ...toVehiclePhysics(vehiclePreset),
            transmission: 'AT',
        });
        this.player.setCourse(this.courseBuilder);
        this.player.addToScene(this.renderer.scene);

        this.aiController = new AIController(this.courseBuilder, {
            ...this.courseData,
            laps: 99,
            gridSize: 6,
        }, {
            aiCount: 0,
            difficulty: 'NORMAL',
            playerMaxSpeed: this.player.maxSpeed,
            playerAcceleration: this.player.acceleration,
        });
        this.aiController.addToScene(this.renderer.scene);
        this.aiController.setActive(true);

        this._applyCourseAtmosphere();
        this._placePlayer();
        this.player.startAutoDrive(0.66);

        this.gameLoop.onFixedUpdate((dt) => {
            this.player.fixedUpdate(dt, null);
            this.aiController.update(dt, this.player, 'racing', 1, false);
        });

        this.gameLoop.onRender((dt, alpha, rawDt) => {
            const pPos = this.player.position;
            this.renderer.dirLight.position.set(pPos.x + 50, 80, pPos.z + 30);
            this.renderer.dirLight.target.position.copy(pPos);
            this.renderer.dirLight.target.updateMatrixWorld();
            this.cameraController.update(rawDt, this.player, null);
            this.renderer.updateSky(this.cameraController.camera);
            this.renderer.render(this.cameraController.camera);
        });

        this.gameLoop.start();
    }

    _placePlayer() {
        const sp = this.courseBuilder.sampledPoints[this.courseBuilder.startLineIndex];
        this.player.resetToStart(
            { x: sp.position.x, y: sp.position.y + 0.05, z: sp.position.z },
            Math.atan2(sp.forward.x, sp.forward.z),
            { index: this.courseBuilder.startLineIndex, t: sp.t, up: sp.up, right: sp.right }
        );
    }

    _applyCourseAtmosphere() {
        this.renderer.setSky(this.courseData.id);
    }

    destroy() {
        this.gameLoop.stop();
        this.cameraController.dispose();
        this.renderer.dispose();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const audio = new AudioManager();
    const ui = new UIManager(audio);
    let currentGame = null;
    let currentDemo = null;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';

    const destroyDemo = () => {
        if (currentDemo) {
            currentDemo.destroy();
            currentDemo = null;
        }
    };

    const showTitleWithDemo = () => {
        destroyGame();
        destroyDemo();
        currentDemo = new TitleDemo({
            courseId: ui.getSelectedOptions().courseId,
            vehicleId: ui.getSelectedOptions().vehicleId,
            quality: ui.getOptions().quality,
        });
        ui.showTitle();
    };

    if (autostart) {
        const options = ui.getSelectedOptions();
        ui.hideBootLoading();
        ui.showLoading(() => {
            launchGame(options);
        });
        return;
    }

    ui.hideBootLoading();
    setTimeout(() => showTitleWithDemo(), 300);

    ui.onStartRace = (options) => {
        destroyDemo();
        launchGame(options);
    };

    ui.onShowPause = () => { if (currentGame) currentGame.setPaused(true); };
    ui.onHidePause = () => { if (currentGame) currentGame.setPaused(false); };

    ui.onResume = () => {
        if (currentGame) currentGame.setPaused(false);
    };

    ui.onRetry = () => {
        if (currentGame) {
            currentGame.setPaused(false);
            currentGame.retry();
        }
    };

    ui.onQuitToTitle = () => {
        showTitleWithDemo();
    };

    ui.onOptionsChanged = (options) => {
        if (currentGame) currentGame.applyRuntimeOptions(options);
    };

    function launchGame(options) {
        destroyGame();
        currentGame = new Game(options, audio);
        ui.setLastRaceContext(options.courseId, options.difficulty);
        ui.showGame();
        ui.setPauseAvailable(true);
        currentGame._onPauseToggle = () => {
            if (ui.isPaused) ui.hidePause();
            else ui.showPause();
        };
        currentGame._onPauseAvailabilityChange = (available) => {
            ui.setPauseAvailable(available);
        };
        currentGame._onCourseSelect = () => {
            destroyGame();
            ui.showSelect();
        };
        currentGame._onQuitToTitle = () => {
            showTitleWithDemo();
        };
    }

    function destroyGame() {
        if (currentGame) {
            currentGame.destroy();
            currentGame = null;
        }
        ui.setPauseAvailable(false);
        audio.stopMusic({ resetCurrent: true });
    }

});
