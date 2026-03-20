/**
 * UIManager: Controls all screen transitions and UI interactions.
 * Screens: title → select → loading → (game) → result → title/select
 * Also handles: pause, options, ranking
 */
import { ALL_COURSES } from '../courses/CourseData.js';
import { VEHICLE_PRESETS } from '../vehicles/VehicleParams.js';
import { loadRanking } from '../race/Ranking.js';
import { OPTIONS_STORAGE_KEY, formatMs } from '../core/Utils.js';

const STORAGE_KEY = 'ovalrush_launch_options';
const OPTIONS_KEY = OPTIONS_STORAGE_KEY;

const TIPS = [
    'Drift through corners and release for a speed boost!',
    'Use slipstream behind rivals to gain extra speed.',
    'Manual transmission (MT) gives you more control over acceleration.',
    'Press C to switch between camera views.',
    'The Bolt RS has the highest top speed but is tricky in corners.',
    'The Ironclad GT excels on technical courses.',
    'Checkpoints extend your remaining time.',
    'Stay close behind rivals to activate slipstream.',
];

const COURSE_INFO = {
    thunder: 'Tri-oval / 2.5km / 8 laps / Beginner friendly',
    seaside: 'Technical circuit / 3.75km / 4 laps / Tunnel & cobblestone',
    mountain: 'Mountain road / 5.0km / 2 laps / Steep elevation & jumps',
};

const VEHICLE_INFO = {
    falcon: 'Balanced / 286km/h / All-rounder',
    bolt: 'Top speed 326km/h / Low grip / Drift specialist',
    ironclad: 'Best accel & grip / 270km/h / Corner master',
};

const MODE_INFO = {
    arcade: 'Checkpoint timer + rivals + ranking',
    time_attack: '3 laps / no rivals / pure lap time',
    free_run: 'Unlimited practice / no timer / no rivals',
};

export class UIManager {
    constructor(audioManager) {
        this.audio = audioManager;

        this._courses = ALL_COURSES;
        this._vehicles = Object.values(VEHICLE_PRESETS);
        this._modes = ['arcade', 'time_attack', 'free_run'];
        this._difficulties = ['EASY', 'NORMAL', 'HARD'];
        this._transmissions = ['AT', 'MT'];
        this._steeringModes = ['touch', 'gyro'];

        this._sel = {
            mode: 0,
            course: 0,
            vehicle: 0,
            difficulty: 1,
            transmission: 0,
        };
        this._hasExplicitTransmissionSelection = false;
        this._rankingSel = { course: 0, difficulty: 1 };

        this.onStartRace = null;
        this.onRetry = null;
        this.onQuitToTitle = null;
        this.onResume = null;
        this.onOptionsChanged = null;
        this.onShowPause = null;
        this.onHidePause = null;

        this._titleScreen = document.getElementById('title-screen');
        this._selectScreen = document.getElementById('select-screen');
        this._optionsScreen = document.getElementById('options-screen');
        this._pauseScreen = document.getElementById('pause-screen');
        this._loadingScreen = document.getElementById('loading');
        this._rankingScreen = document.getElementById('ranking-screen');
        this._loadingBar = document.getElementById('loading-bar');
        this._loadingText = document.getElementById('loading-text');
        this._loadingTip = document.getElementById('loading-tip');
        this._gameCurtain = document.getElementById('game-curtain');

        this._currentScreen = 'loading';
        this._gameActive = false;
        this._pauseActive = false;
        this._pauseAvailable = false;
        this._previousScreen = 'title';
        this._lastCourseId = '';
        this._lastDifficulty = '';

        this._loadSavedSelections();
        this._loadOptions();
        this._bindEvents();
    }

    showTitle() {
        this._hideAll();
        this._titleScreen.style.display = 'flex';
        this._titleScreen.classList.remove('hidden');
        this._currentScreen = 'title';
        this._previousScreen = 'title';
        this._gameActive = false;
        this._pauseActive = false;
        this._pauseAvailable = false;
        if (this.audio) {
            this.audio.ensureStarted().then(() => {
                this.audio.playTitleScreenMusic();
            });
        }
    }

    showSelect() {
        this._hideAll();
        this._updateSelectionDisplay();
        this._selectScreen.style.display = 'flex';
        this._currentScreen = 'select';
        this._previousScreen = 'title';
        this._pauseAvailable = false;
    }

    showOptions() {
        this._previousScreen = this._currentScreen === 'select' ? 'select' : 'title';
        this._hideAll();
        this._applyOptionsToUI();
        this._optionsScreen.style.display = 'flex';
        this._currentScreen = 'options';
        this._pauseAvailable = false;
    }

    showRanking() {
        this._hideAll();
        this._updateRankingScreen();
        this._rankingScreen.style.display = 'flex';
        this._currentScreen = 'ranking';
        this._previousScreen = 'title';
        this._pauseAvailable = false;
    }

    showLoading(callback) {
        this._hideAll();
        this._loadingScreen.style.display = 'flex';
        this._loadingScreen.classList.remove('hidden');
        this._loadingBar.style.width = '0%';
        this._loadingText.textContent = 'Initializing...';
        this._loadingTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
        this._currentScreen = 'loading';
        this._pauseAvailable = false;

        const steps = [
            { pct: 18, text: 'Loading course data...' },
            { pct: 40, text: 'Building track mesh...' },
            { pct: 62, text: 'Preparing vehicles...' },
            { pct: 82, text: 'Configuring race mode...' },
            { pct: 100, text: 'Ready!' },
        ];
        let step = 0;
        const advance = () => {
            if (step >= steps.length) {
                setTimeout(() => {
                    // 1. 黒幕を即座に不透明で表示（ローディング画面の下に敷く）
                    this._gameCurtain.classList.remove('fade-out');
                    this._gameCurtain.style.display = 'block';
                    this._gameCurtain.style.opacity = '1';
                    this._currentScreen = 'game';
                    this._gameActive = true;

                    // 2. ローディング画面を即座に非表示（黒幕が背後にあるので安全）
                    this._loadingScreen.style.display = 'none';
                    this._loadingScreen.classList.add('hidden');

                    // 3. ゲーム初期化（黒幕の裏で実行）
                    if (callback) callback();

                    // 4. 数フレーム待ってレンダリングを安定させてから黒幕をフェードアウト
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                this._gameCurtain.style.opacity = '0';
                                setTimeout(() => {
                                    this._gameCurtain.style.display = 'none';
                                }, 700);
                            });
                        });
                    });
                }, 200);
                return;
            }
            const current = steps[step++];
            this._loadingBar.style.width = `${current.pct}%`;
            this._loadingText.textContent = current.text;
            setTimeout(advance, 120 + Math.random() * 80);
        };
        setTimeout(advance, 100);
    }

    showGame() {
        this._hideAll();
        this._currentScreen = 'game';
        this._gameActive = true;
        this._pauseAvailable = true;
    }

    get isPaused() { return this._pauseActive; }

    setPauseAvailable(available) {
        this._pauseAvailable = Boolean(available) && this._gameActive;
        if (!this._pauseAvailable && this._pauseActive) {
            this.hidePause();
        }
    }

    showPause() {
        if (!this._gameActive || !this._pauseAvailable || this._pauseActive) return;
        this._pauseScreen.style.display = 'flex';
        this._pauseActive = true;
        this._currentScreen = 'pause';
        if (this.onShowPause) this.onShowPause();
    }

    hidePause() {
        this._pauseScreen.style.display = 'none';
        this._pauseActive = false;
        if (this._gameActive) this._currentScreen = 'game';
        if (this.onHidePause) this.onHidePause();
    }

    hideBootLoading() {
        const loading = this._loadingScreen;
        if (!loading) return;
        loading.classList.add('hidden');
        setTimeout(() => {
            loading.style.display = 'none';
        }, 400);
    }

    getSelectedOptions() {
        return {
            mode: this._modes[this._sel.mode],
            courseId: this._courses[this._sel.course].id,
            vehicleId: this._vehicles[this._sel.vehicle].id,
            difficulty: this._difficulties[this._sel.difficulty],
            transmission: this._transmissions[this._sel.transmission],
            quality: this._options.quality,
            steeringMode: this._options.steeringMode,
        };
    }

    getOptions() {
        return { ...this._options };
    }

    setLastRaceContext(courseId, difficulty) {
        this._lastCourseId = courseId;
        this._lastDifficulty = difficulty;
        const ci = this._courses.findIndex(c => c.id === courseId);
        if (ci >= 0) this._rankingSel.course = ci;
        const di = this._difficulties.indexOf((difficulty || '').toUpperCase());
        if (di >= 0) this._rankingSel.difficulty = di;
    }

    _hideAll() {
        this._titleScreen.style.display = 'none';
        this._titleScreen.classList.add('hidden');
        this._selectScreen.style.display = 'none';
        this._optionsScreen.style.display = 'none';
        this._pauseScreen.style.display = 'none';
        if (this._rankingScreen) this._rankingScreen.style.display = 'none';
        this._pauseActive = false;
        this._pauseAvailable = false;
    }

    _loadSavedSelections() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved) {
                const mi = this._modes.indexOf(saved.mode);
                if (mi >= 0) this._sel.mode = mi;
                const ci = this._courses.findIndex(c => c.id === saved.courseId);
                if (ci >= 0) this._sel.course = ci;
                const vi = this._vehicles.findIndex(v => v.id === saved.vehicleId);
                if (vi >= 0) this._sel.vehicle = vi;
                const di = this._difficulties.indexOf(saved.difficulty);
                if (di >= 0) this._sel.difficulty = di;
                const ti = this._transmissions.indexOf(saved.transmission);
                if (ti >= 0) {
                    this._sel.transmission = ti;
                    this._hasExplicitTransmissionSelection = true;
                }
            }
        } catch {
            // Ignore corrupt persisted launch options.
        }

        const params = new URLSearchParams(window.location.search);
        const qMode = (params.get('mode') || '').toLowerCase();
        const qCourse = (params.get('course') || '').toLowerCase();
        const qVehicle = (params.get('vehicle') || '').toLowerCase();
        const qDifficulty = (params.get('difficulty') || '').toUpperCase();
        const qTransmission = (params.get('transmission') || '').toUpperCase();

        if (qMode) {
            const mi = this._modes.indexOf(qMode);
            if (mi >= 0) this._sel.mode = mi;
        }
        if (qCourse) {
            const ci = this._courses.findIndex(c => c.id === qCourse);
            if (ci >= 0) this._sel.course = ci;
        }
        if (qVehicle) {
            const vi = this._vehicles.findIndex(v => v.id === qVehicle);
            if (vi >= 0) this._sel.vehicle = vi;
        }
        if (qDifficulty) {
            const di = this._difficulties.indexOf(qDifficulty);
            if (di >= 0) this._sel.difficulty = di;
        }
        if (qTransmission) {
            const ti = this._transmissions.indexOf(qTransmission);
            if (ti >= 0) {
                this._sel.transmission = ti;
                this._hasExplicitTransmissionSelection = true;
            }
        }

        this._rankingSel.course = this._sel.course;
        this._rankingSel.difficulty = this._sel.difficulty;
    }

    _saveSelections() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getSelectedOptions()));
        } catch {
            // Ignore localStorage errors.
        }
    }

    _loadOptions() {
        this._options = {
            bgmVolume: 70,
            seVolume: 80,
            engineVolume: 60,
            quality: 'auto',
            transmission: 'AT',
            steeringMode: 'touch',
        };
        try {
            const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
            if (saved) Object.assign(this._options, saved);
        } catch {
            // Ignore corrupt options.
        }
        this._syncSelectionsWithOptions();
        this._applyOptionsToUI();
        this._applyOptionsToAudio();
    }

    _saveOptions() {
        try {
            localStorage.setItem(OPTIONS_KEY, JSON.stringify(this._options));
        } catch {
            // Ignore localStorage errors.
        }
    }

    _syncSelectionsWithOptions() {
        if (this._hasExplicitTransmissionSelection) return;
        const ti = this._transmissions.indexOf(this._options.transmission || 'AT');
        if (ti >= 0) this._sel.transmission = ti;
    }

    _applyOptionsToUI() {
        const bgm = document.getElementById('opt-bgm');
        const se = document.getElementById('opt-se');
        const engine = document.getElementById('opt-engine');
        if (bgm) bgm.value = this._options.bgmVolume;
        if (se) se.value = this._options.seVolume;
        if (engine) engine.value = this._options.engineVolume;
        this._updateOptVal('opt-bgm-val', this._options.bgmVolume);
        this._updateOptVal('opt-se-val', this._options.seVolume);
        this._updateOptVal('opt-engine-val', this._options.engineVolume);
        this._setToggleValue('opt-quality', this._options.quality);
        this._setToggleValue('opt-transmission', this._options.transmission);
        this._setToggleValue('opt-steering', this._options.steeringMode);
    }

    _applyOptionsToAudio() {
        if (!this.audio) return;
        this.audio.setVolumes(
            this._options.bgmVolume / 100,
            this._options.seVolume / 100,
            this._options.engineVolume / 100,
        );
    }

    _updateOptVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    _setToggleValue(rootId, value) {
        document.querySelectorAll(`#${rootId} .opt-choice`).forEach((button) => {
            button.classList.toggle('active', button.dataset.val === value);
        });
    }

    _updateSelectionDisplay() {
        const mode = this._modes[this._sel.mode];
        const course = this._courses[this._sel.course];
        const vehicle = this._vehicles[this._sel.vehicle];

        document.getElementById('sel-mode-name').textContent = mode.replace('_', ' ').toUpperCase();
        document.getElementById('sel-course-name').textContent = course.name;
        document.getElementById('sel-vehicle-name').textContent = vehicle.name;
        document.getElementById('sel-difficulty-name').textContent = this._difficulties[this._sel.difficulty];
        document.getElementById('sel-transmission-name').textContent = this._transmissions[this._sel.transmission];

        const modeInfo = document.getElementById('sel-mode-info');
        if (modeInfo) modeInfo.textContent = MODE_INFO[mode] || '';
        const courseInfo = document.getElementById('sel-course-info');
        if (courseInfo) courseInfo.textContent = COURSE_INFO[course.id] || '';
        const vehicleInfo = document.getElementById('sel-vehicle-info');
        if (vehicleInfo) vehicleInfo.textContent = VEHICLE_INFO[vehicle.id] || '';

        const difficultySection = document.getElementById('select-difficulty')?.closest('.select-col');
        if (difficultySection) {
            difficultySection.style.opacity = mode === 'free_run' ? '0.55' : '1';
        }
    }

    _updateRankingScreen() {
        const course = this._courses[this._rankingSel.course];
        const difficulty = this._difficulties[this._rankingSel.difficulty];
        const courseNameEl = document.getElementById('ranking-course-name');
        const difficultyNameEl = document.getElementById('ranking-difficulty-name');
        const listPanel = document.getElementById('ranking-list-panel');
        if (courseNameEl) courseNameEl.textContent = course.name;
        if (difficultyNameEl) difficultyNameEl.textContent = difficulty;
        if (!listPanel) return;

        const ranking = loadRanking(course.id, difficulty);
        if (!ranking.length) {
            listPanel.innerHTML = `<div class="ranking-empty">NO SCORES YET<br>Finish a race to register a time.</div>`;
            return;
        }

        listPanel.innerHTML = ranking.map((entry, index) => `
            <div class="ranking-row">
                <div>${String(index + 1).padStart(2, '0')}. ${entry.name}</div>
                <div>${formatMs(entry.time)}</div>
            </div>
        `).join('');
    }

    _cycleSelection(key, direction, target = this._sel) {
        const source = {
            mode: this._modes,
            course: this._courses,
            vehicle: this._vehicles,
            difficulty: this._difficulties,
            transmission: this._transmissions,
        };
        const list = source[key];
        if (!list) return;
        target[key] = ((target[key] + direction) % list.length + list.length) % list.length;
        if (key === 'transmission' && target === this._sel) {
            this._hasExplicitTransmissionSelection = true;
        }
        this._updateSelectionDisplay();
    }

    _cycleRankingSelection(key, direction) {
        const source = {
            course: this._courses,
            difficulty: this._difficulties,
        };
        const list = source[key];
        if (!list) return;
        this._rankingSel[key] = ((this._rankingSel[key] + direction) % list.length + list.length) % list.length;
        this._updateRankingScreen();
    }

    _startRace() {
        this._saveSelections();
        const options = this.getSelectedOptions();
        if (this.audio) {
            this.audio.stopMusic({ resetCurrent: true });
        }
        if (this.onStartRace) {
            this.showLoading(() => {
                this.onStartRace(options);
            });
        }
    }


    _bindEvents() {
        this._titleScreen.addEventListener('click', (e) => {
            const btn = e.target.closest('.title-btn');
            if (btn) {
                const action = btn.dataset.action;
                if (action === 'start') this.showSelect();
                else if (action === 'options') this.showOptions();
                else if (action === 'ranking') this.showRanking();
                return;
            }
            if (e.target.id === 'title-press-start' || !e.target.closest('.title-btn')) {
                if (e.target.closest('#title-nav')) return;
                this.showSelect();
            }
        });

        this._selectScreen.addEventListener('click', (e) => {
            const arrow = e.target.closest('.carousel-arrow');
            if (!arrow) return;
            const carousel = arrow.closest('.select-carousel');
            const key = carousel?.dataset.key;
            const dir = parseInt(arrow.dataset.dir, 10);
            if (key && !Number.isNaN(dir)) {
                this._cycleSelection(key, dir);
            }
        });

        this._rankingScreen?.addEventListener('click', (e) => {
            const arrow = e.target.closest('.carousel-arrow');
            if (arrow) {
                const carousel = arrow.closest('.select-carousel');
                const key = carousel?.dataset.key;
                const dir = parseInt(arrow.dataset.dir, 10);
                if (key && !Number.isNaN(dir)) {
                    this._cycleRankingSelection(key, dir);
                }
                return;
            }
        });

        document.getElementById('select-start')?.addEventListener('click', () => this._startRace());
        document.getElementById('select-back')?.addEventListener('click', () => this.showTitle());
        document.getElementById('ranking-close')?.addEventListener('click', () => this.showTitle());

        const bindSlider = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                this._options[key] = parseInt(el.value, 10);
                this._updateOptVal(`${id}-val`, this._options[key]);
                this._applyOptionsToAudio();
                this._saveOptions();
                if (this.onOptionsChanged) this.onOptionsChanged(this.getOptions());
            });
        };
        bindSlider('opt-bgm', 'bgmVolume');
        bindSlider('opt-se', 'seVolume');
        bindSlider('opt-engine', 'engineVolume');

        const bindToggle = (rootId, key) => {
            document.querySelectorAll(`#${rootId} .opt-choice`).forEach((button) => {
                button.addEventListener('click', () => {
                    this._options[key] = button.dataset.val;
                    this._setToggleValue(rootId, button.dataset.val);
                    if (key === 'transmission') {
                        const ti = this._transmissions.indexOf(button.dataset.val);
                        if (ti >= 0) this._sel.transmission = ti;
                        this._hasExplicitTransmissionSelection = false;
                        this._updateSelectionDisplay();
                    }
                    this._saveOptions();
                    if (this.onOptionsChanged) this.onOptionsChanged(this.getOptions());
                });
            });
        };

        bindToggle('opt-quality', 'quality');
        bindToggle('opt-transmission', 'transmission');
        bindToggle('opt-steering', 'steeringMode');

        document.getElementById('options-close')?.addEventListener('click', () => {
            if (this._previousScreen === 'select') this.showSelect();
            else this.showTitle();
        });

        this._pauseScreen.addEventListener('click', (e) => {
            const btn = e.target.closest('.pause-btn');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'resume') {
                this.hidePause();
                if (this.onResume) this.onResume();
            } else if (action === 'retry') {
                this.hidePause();
                if (this.onRetry) this.onRetry();
            } else if (action === 'quit') {
                this.hidePause();
                this._gameActive = false;
                if (this.onQuitToTitle) this.onQuitToTitle();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Escape') return;
            if (this._pauseActive) {
                this.hidePause();
                if (this.onResume) this.onResume();
            } else if (this._gameActive && this._currentScreen === 'game' && this._pauseAvailable) {
                this.showPause();
            }
        });
    }
}
