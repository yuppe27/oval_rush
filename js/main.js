import * as THREE from 'three';
import { GameLoop } from './core/GameLoop.js';
import { Renderer } from './graphics/Renderer.js';
import { CameraController } from './graphics/CameraController.js?v=2';
import { HUD } from './graphics/HUD.js?v=2';
import { InputManager } from './input/InputManager.js?v=2';
import { PlayerVehicle } from './vehicles/PlayerVehicle.js?v=5';
import { CourseBuilder } from './courses/CourseBuilder.js?v=2';
import { resolveCourse } from './courses/CourseData.js';
import { RaceManager } from './race/RaceManager.js';
import { AIController } from './ai/AIController.js?v=4';
import { SlipstreamSystem } from './effects/SlipstreamSystem.js';
import { TrackEffects } from './effects/TrackEffects.js';
import { BoostFX } from './effects/BoostFX.js';
import { PodiumFX } from './effects/PodiumFX.js';
import { Minimap } from './graphics/Minimap.js';
import { AudioManager } from './audio/AudioManager.js';
import { resolveVehiclePreset, toVehiclePhysics } from './vehicles/VehicleParams.js';
import { VehicleModel } from './vehicles/VehicleModel.js?v=6';
import { UIManager } from './ui/UIManager.js?v=2';
import { insertRanking } from './race/Ranking.js';
import {
    FIXED_TIMESTEP,
    RACE_COUNTDOWN_DURATION,
    ROLLING_START_GRID_INTRO_DURATION,
} from './core/Constants.js';

class Game {
    constructor(launchOptions = {}, audioManager = null) {
        const canvas = document.getElementById('gameCanvas');
        const params = new URLSearchParams(window.location.search);
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
        this._debugUnlocked = Boolean(launchOptions.debugUnlocked || params.get('debug') === '1');
        this._debugActive = false;
        this._debugWireframe = false;
        this._debugFocus = 'vehicle';
        this._debugFocusOrder = ['vehicle', 'nearest_ai', 'course'];
        this._debugShowAI = false;
        this._debugSceneState = null;
        this._debugPreviousCameraMode = 'chase';
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
        this.cameraController.setOccluders(this.courseBuilder.cameraOccluders);

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

        this.minimap = new Minimap(this.courseBuilder, aiCount);

        this.slipstreamSystem = new SlipstreamSystem(this.renderer.scene);
        this.trackEffects = new TrackEffects(this.renderer.scene);
        this.boostFX = new BoostFX();
        this.podiumFX = new PodiumFX();

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
            if (this._paused || this._debugActive) return;
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
            if (this.raceManager.finalizeFinishOrder(this.player) && this.mode === 'arcade') {
                const pos = this.raceManager.playerPosition;
                this.audio.setFinishPosition(pos);
                this.podiumFX.show(pos);
            }
            this._syncPauseAvailability();
            this.trackEffects.update(dt, this.player, this.raceManager.state);
        });

        this.gameLoop.onRender((dt, alpha, rawDt) => {
            this.input.update();
            this._syncPauseAvailability();
            this._processDebugInput();

            if (!this._debugActive && this.input.consumePause() && this._pauseAvailability) {
                if (this._onPauseToggle) this._onPauseToggle();
            }

            if (this._paused) {
                this.renderer.render(this.cameraController.camera);
                return;
            }

            if (this._debugActive) {
                const pPos = this.player.position;
                this.renderer.dirLight.position.set(pPos.x + 50, 80, pPos.z + 30);
                this.renderer.dirLight.target.position.copy(pPos);
                this.renderer.dirLight.target.updateMatrixWorld();
                this.cameraController.updateDebug(rawDt, this.input);
                this._updateDebugPanel();
                this.renderer.updateSky(this.cameraController.camera);
                this.renderer.render(this.cameraController.camera);
                return;
            }

            this.hud.setDebugPanel(false);
            if (this.input.consumeCameraSwitch()) {
                this.cameraController.cycleMode();
            }

            const pPos = this.player.position;
            this.renderer.dirLight.position.set(pPos.x + 50, 80, pPos.z + 30);
            this.renderer.dirLight.target.position.copy(pPos);
            this.renderer.dirLight.target.updateMatrixWorld();

            this.cameraController.update(rawDt, this.player, this.raceManager);
            this._updateCourseEnvironment(rawDt);
            this._updateJumbotron();
            this.hud.update(this.player, this.raceManager, rawDt);
            this.minimap.update(this.player, this.aiController, this.raceManager.state);
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
        if (paused && this._debugActive) {
            this._setDebugMode(false);
        }
        this._paused = paused;
    }

    applyRuntimeOptions(options) {
        if (options?.quality) {
            this.renderer.applyQualityProfile(options.quality);
        }
    }

    retry() {
        this._setDebugMode(false);
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
        this.podiumFX.reset();
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
        this._setDebugMode(false);
        this.hud.reset();
        this.podiumFX.reset();
        if (this._resultKeyHandler) {
            window.removeEventListener('keydown', this._resultKeyHandler);
            this._resultKeyHandler = null;
        }
        const resultEl = document.getElementById('hud-result');
        if (resultEl) resultEl.style.display = 'none';
        this.minimap.dispose();
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

    _updateJumbotron() {
        const rm = this.raceManager;
        this.courseBuilder.updateJumbotron({
            position: rm.playerPosition,
            currentLap: rm.currentLap,
            totalLaps: rm.totalLaps,
            state: rm.state,
            timeStr: rm.timer.getTotalTimeFormatted(),
            message: rm.message?.text || '',
        });
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

    _processDebugInput() {
        if (!this._debugUnlocked || this._paused) {
            this.input.consumeDebugToggle();
            this.input.consumeDebugFocus();
            this.input.consumeDebugWireframe();
            this.input.consumeDebugReset();
            this.input.consumeDebugAIToggle();
            return;
        }

        if (this.input.consumeDebugToggle()) {
            this._setDebugMode(!this._debugActive);
        }

        if (!this._debugActive) {
            this.input.consumeDebugFocus();
            this.input.consumeDebugWireframe();
            this.input.consumeDebugReset();
            this.input.consumeDebugAIToggle();
            return;
        }

        if (this.input.consumeDebugFocus()) {
            this._debugFocus = this._getNextDebugFocus();
            this._resetDebugCamera();
            this._refreshDebugAIVisibility();
        }
        if (this.input.consumeDebugWireframe()) {
            this._debugWireframe = !this._debugWireframe;
            this._applyDebugWireframe();
        }
        if (this.input.consumeDebugReset()) {
            this._resetDebugCamera();
        }
        if (this.input.consumeDebugAIToggle()) {
            this._debugShowAI = !this._debugShowAI;
            this._refreshDebugAIVisibility();
        }
    }

    _setDebugMode(active) {
        if (active && !this._debugUnlocked) return;
        if (this._debugActive === active) return;

        this._debugActive = active;
        if (active) {
            this._debugPreviousCameraMode = this.cameraController.mode;
            this._debugFocus = 'vehicle';
            this._debugShowAI = false;
            this._debugWireframe = true;
            this._applyDebugSceneState(true);
            this._applyDebugWireframe();
            this._resetDebugCamera();
            return;
        }

        this._debugWireframe = false;
        this._applyDebugWireframe();
        this._applyDebugSceneState(false);
        this.cameraController.setDebugActive(false);
        this.cameraController.snapToMode(this.player, this._debugPreviousCameraMode || 'chase');
        this.hud.setDebugPanel(false);
    }

    _applyDebugSceneState(active) {
        if (active) {
            if (!this._debugSceneState) {
                this._debugSceneState = {
                    ambient: this.renderer.ambientLight.intensity,
                    directional: this.renderer.dirLight.intensity,
                    fogNear: this.renderer.scene.fog?.near ?? 0,
                    fogFar: this.renderer.scene.fog?.far ?? 0,
                    aiVisible: (this.aiController?._instanceLayers || []).some((layer) => layer.visible !== false),
                };
            }
            this.renderer.ambientLight.intensity = Math.max(this.renderer.ambientLight.intensity, 0.92);
            this.renderer.dirLight.intensity = Math.max(this.renderer.dirLight.intensity, 1.1);
            if (this.renderer.scene.fog) {
                this.renderer.scene.fog.near = 1400;
                this.renderer.scene.fog.far = 3200;
            }
            this._refreshDebugAIVisibility();
            return;
        }

        if (!this._debugSceneState) return;
        this.renderer.ambientLight.intensity = this._debugSceneState.ambient;
        this.renderer.dirLight.intensity = this._debugSceneState.directional;
        if (this.renderer.scene.fog) {
            this.renderer.scene.fog.near = this._debugSceneState.fogNear;
            this.renderer.scene.fog.far = this._debugSceneState.fogFar;
        }
        this._setAIVisible(this._debugSceneState.aiVisible);
        this._debugSceneState = null;
    }

    _setAIVisible(visible) {
        for (const layer of this.aiController?._instanceLayers || []) {
            layer.visible = visible;
        }
    }

    _refreshDebugAIVisibility() {
        if (!this._debugActive) return;
        const forceVisible = this._debugFocus === 'nearest_ai' && this._hasDebugAI();
        this._setAIVisible(this._debugShowAI || forceVisible);
    }

    _hasDebugAI() {
        return (this.aiController?.vehicles?.length ?? 0) > 0;
    }

    _getNextDebugFocus() {
        const currentIdx = this._debugFocusOrder.indexOf(this._debugFocus);
        for (let offset = 1; offset <= this._debugFocusOrder.length; offset++) {
            const next = this._debugFocusOrder[(Math.max(0, currentIdx) + offset) % this._debugFocusOrder.length];
            if (next !== 'nearest_ai' || this._hasDebugAI()) {
                return next;
            }
        }
        return 'vehicle';
    }

    _applyDebugWireframe() {
        this.courseBuilder.setDebugWireframe(this._debugWireframe);
        this.player.model.setDebugWireframe(this._debugWireframe);
    }

    _resetDebugCamera() {
        const target = this._getDebugFocusTarget();
        if (this._debugFocus === 'vehicle') {
            this.cameraController.setDebugActive(true, {
                target,
                distance: 8.5,
                yaw: this.player.rotation + Math.PI + 0.48,
                pitch: 0.3,
            });
            return;
        }

        if (this._debugFocus === 'nearest_ai') {
            const ai = this._getNearestAIForDebug();
            const yaw = ai?.forward?.lengthSq?.() > 0
                ? Math.atan2(ai.forward.x, ai.forward.z) + Math.PI + 0.45
                : this.player.rotation + Math.PI + 0.45;
            this.cameraController.setDebugActive(true, {
                target,
                distance: 9.5,
                yaw,
                pitch: 0.28,
            });
            return;
        }

        this.cameraController.setDebugActive(true, {
            target,
            distance: THREE.MathUtils.clamp(this.courseBuilder.courseLength * 0.035, 78, 190),
            yaw: -0.72,
            pitch: 0.6,
        });
    }

    _getDebugFocusTarget() {
        if (this._debugFocus === 'vehicle') {
            return this.player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
        }
        if (this._debugFocus === 'nearest_ai') {
            return this._getNearestAIForDebug()?.position?.clone()?.add(new THREE.Vector3(0, 1.05, 0))
                || this.player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
        }
        return this.courseBuilder.getDebugFocusPoint();
    }

    _getNearestAIForDebug() {
        if (!this.aiController?.vehicles?.length) return null;
        let nearest = null;
        let nearestDistSq = Infinity;
        for (const ai of this.aiController.vehicles) {
            if (!ai?.position) continue;
            const distSq = ai.position.distanceToSquared(this.player.position);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = ai;
            }
        }
        return nearest;
    }

    _updateDebugPanel() {
        const cam = this.cameraController.camera.position;
        const nearestAI = this._getNearestAIForDebug();
        const hasAI = this._hasDebugAI();
        const focusLabel = this._debugFocus === 'vehicle'
            ? 'PLAYER MODEL'
            : this._debugFocus === 'nearest_ai'
                ? `NEAREST AI${nearestAI ? ` #${nearestAI.id}` : ' (N/A)'}`
                : 'COURSE OVERVIEW';
        const aiVisible = hasAI && (this._debugFocus === 'nearest_ai' || this._debugShowAI);
        const raceState = this.raceManager?.state || 'idle';
        const playerSpeed = this.player.getSpeedKmh().toFixed(0);
        const playerTrack = (this.player.trackT || 0).toFixed(3);
        const aiLine = nearestAI
            ? `AI#${nearestAI.id} ${ (nearestAI.speed * 3.6).toFixed(0)}KMH LANE ${nearestAI.laneOffset.toFixed(2)} T ${nearestAI.progressT.toFixed(3)}`
            : `AI ${hasAI ? 'UNAVAILABLE' : 'DISABLED'}`;
        this.hud.setDebugPanel(true, [
            'DEBUG INSPECTOR',
            `FOCUS ${focusLabel}`,
            `WIREFRAME ${this._debugWireframe ? 'ON' : 'OFF'}`,
            `AI ${aiVisible ? 'VISIBLE' : 'HIDDEN'}`,
            `RACE ${raceState}  POS ${this.raceManager.playerPosition}/${this.raceManager.totalRacers}`,
            `PLAYER ${playerSpeed}KMH T ${playerTrack}`,
            aiLine,
            `CAM ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}`,
            'F1 EXIT  F2 FOCUS  F3 WIREFRAME  F4 RESET  F6 AI',
            'LMB ORBIT  W A S D PAN  Q/E UP-DOWN  WHEEL ZOOM',
        ]);
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
        this.cameraController.setOccluders(this.courseBuilder.cameraOccluders);

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

window.addEventListener('DOMContentLoaded', async () => {
    // Preload car GLB model before anything else
    try {
        await VehicleModel.preload();
    } catch (e) {
        console.warn('Car GLB preload failed, will use fallback:', e);
    }

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
        currentGame = new Game({ ...options, debugUnlocked: ui.isDebugUnlocked() }, audio);
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
