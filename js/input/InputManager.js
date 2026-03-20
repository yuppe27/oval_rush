import { OPTIONS_STORAGE_KEY } from '../core/Utils.js';

const OPTIONS_KEY = OPTIONS_STORAGE_KEY;

const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
    'KeyZ', 'KeyX', 'KeyC', 'Space',
]);

const DEBUG_KEYS = new Set(['F1', 'F2', 'F3', 'F4']);

export class InputManager {
    constructor() {
        this._listeners = [];
        this.keys = {};
        this.gamepad = null;
        this._cameraSwitchRequested = false;
        this._shiftUpRequested = false;
        this._shiftDownRequested = false;
        this._pauseRequested = false;
        this._debugToggleRequested = false;
        this._debugFocusRequested = false;
        this._debugWireframeRequested = false;
        this._debugResetRequested = false;

        this._gpPrevButtons = {};

        this._touchAccel = false;
        this._touchBrake = false;
        this._touchSteer = 0;

        this._steeringMode = this._loadSteeringMode();
        this._gyroSteer = 0;
        this._gyroPermissionPending = false;
        this._gyroEnabled = false;
        this._gyroBound = (event) => this._onDeviceOrientation(event);
        this._unlockGyroBound = () => this._unlockGyroOnce();
        this._handleKeyDown = (e) => {
            const wasDown = Boolean(this.keys[e.code]);
            this.keys[e.code] = true;
            if (!wasDown) {
                if (e.code === 'KeyC') this._cameraSwitchRequested = true;
                if (e.code === 'KeyZ') this._shiftUpRequested = true;
                if (e.code === 'KeyX') this._shiftDownRequested = true;
                if (e.code === 'F1') this._debugToggleRequested = true;
                if (e.code === 'F2') this._debugFocusRequested = true;
                if (e.code === 'F3') this._debugWireframeRequested = true;
                if (e.code === 'F4') this._debugResetRequested = true;
            }
            if (GAME_KEYS.has(e.code) || DEBUG_KEYS.has(e.code)) {
                e.preventDefault();
            }
        };
        this._handleKeyUp = (e) => {
            this.keys[e.code] = false;
        };
        this._handleBlur = () => {
            this.keys = {};
            this._cameraSwitchRequested = false;
            this._shiftUpRequested = false;
            this._shiftDownRequested = false;
            this._pauseRequested = false;
            this._debugToggleRequested = false;
            this._debugFocusRequested = false;
            this._debugWireframeRequested = false;
            this._debugResetRequested = false;
        };
        this._handleStorage = (e) => {
            if (e.key !== OPTIONS_KEY) return;
            this._steeringMode = this._loadSteeringMode();
            if (this._steeringMode === 'gyro') {
                this._tryEnableGyro();
            }
        };

        this._listen(window, 'keydown', this._handleKeyDown);
        this._listen(window, 'keyup', this._handleKeyUp);
        this._listen(window, 'blur', this._handleBlur);
        this._listen(window, 'storage', this._handleStorage);

        this._initTouch();
        if (this._steeringMode === 'gyro') {
            this._tryEnableGyro();
        }
    }

    update() {
        this._pollGamepad();
    }

    get accelerate() {
        if (this._touchAccel) return true;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) return true;
        if (this.gamepad?.buttons[7]?.pressed) return true;
        return false;
    }

    get brake() {
        if (this._touchBrake) return true;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) return true;
        if (this.gamepad?.buttons[6]?.pressed) return true;
        return false;
    }

    get steerLeft() {
        if (this._getTouchSteering() < -0.15) return true;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) return true;
        if (this.gamepad && this.gamepad.axes[0] < -0.15) return true;
        return false;
    }

    get steerRight() {
        if (this._getTouchSteering() > 0.15) return true;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) return true;
        if (this.gamepad && this.gamepad.axes[0] > 0.15) return true;
        return false;
    }

    consumeCameraSwitch() {
        if (this._gpConsumeButton(3)) return true;
        const value = this._cameraSwitchRequested;
        this._cameraSwitchRequested = false;
        return value;
    }

    consumeShiftUp() {
        if (this._gpConsumeButton(5)) return true;
        const value = this._shiftUpRequested;
        this._shiftUpRequested = false;
        return value;
    }

    consumeShiftDown() {
        if (this._gpConsumeButton(4)) return true;
        const value = this._shiftDownRequested;
        this._shiftDownRequested = false;
        return value;
    }

    consumePause() {
        if (this._gpConsumeButton(9)) return true;
        const value = this._pauseRequested;
        this._pauseRequested = false;
        return value;
    }

    consumeDebugToggle() {
        const value = this._debugToggleRequested;
        this._debugToggleRequested = false;
        return value;
    }

    consumeDebugFocus() {
        const value = this._debugFocusRequested;
        this._debugFocusRequested = false;
        return value;
    }

    consumeDebugWireframe() {
        const value = this._debugWireframeRequested;
        this._debugWireframeRequested = false;
        return value;
    }

    consumeDebugReset() {
        const value = this._debugResetRequested;
        this._debugResetRequested = false;
        return value;
    }

    getDebugCameraInput() {
        const forward = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
        const right = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
        const vertical = (this.keys['KeyE'] ? 1 : 0) - (this.keys['KeyQ'] ? 1 : 0);
        const fast = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
        return { forward, right, vertical, fast };
    }

    getSteeringInput() {
        if (this.gamepad && Math.abs(this.gamepad.axes[0]) > 0.15) {
            return this.gamepad.axes[0];
        }
        const touchOrGyro = this._getTouchSteering();
        if (Math.abs(touchOrGyro) > 0.05) {
            return touchOrGyro;
        }
        let input = 0;
        if (this.steerLeft) input -= 1;
        if (this.steerRight) input += 1;
        return input;
    }

    getThrottleInput() {
        let input = 0;
        if (this.accelerate) input += 1;
        if (this.brake) input -= 1;
        return input;
    }

    _pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        this.gamepad = gamepads[0] || null;
    }

    _gpConsumeButton(index) {
        if (!this.gamepad) return false;
        const pressed = this.gamepad.buttons[index]?.pressed;
        const wasPressed = this._gpPrevButtons[index];
        this._gpPrevButtons[index] = pressed;
        return pressed && !wasPressed;
    }

    _loadSteeringMode() {
        try {
            const options = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
            return options?.steeringMode === 'gyro' ? 'gyro' : 'touch';
        } catch {
            return 'touch';
        }
    }

    _getTouchSteering() {
        return this._steeringMode === 'gyro' ? this._gyroSteer : this._touchSteer;
    }

    _tryEnableGyro() {
        if (this._steeringMode !== 'gyro' || !window.DeviceOrientationEvent) return;
        if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
            if (this._gyroPermissionPending) return;
            this._gyroPermissionPending = true;
            this._listen(window, 'pointerdown', this._unlockGyroBound, { passive: true, once: true });
            return;
        }
        if (!this._gyroEnabled) {
            this._listen(window, 'deviceorientation', this._gyroBound, { passive: true });
            this._gyroEnabled = true;
        }
    }

    async _unlockGyroOnce() {
        try {
            const permission = await window.DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                if (!this._gyroEnabled) {
                    this._listen(window, 'deviceorientation', this._gyroBound, { passive: true });
                    this._gyroEnabled = true;
                }
            } else {
                this._steeringMode = 'touch';
            }
        } catch {
            this._steeringMode = 'touch';
        } finally {
            this._gyroPermissionPending = false;
        }
    }

    _onDeviceOrientation(event) {
        const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
        this._gyroSteer = Math.max(-1, Math.min(1, gamma / 28));
    }

    _initTouch() {
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const touchControls = document.getElementById('touch-controls');

        if (isMobile && touchControls) {
            touchControls.classList.add('active');
        }

        const steerZone = document.getElementById('touch-steer');
        const steerKnob = document.getElementById('touch-steer-knob');
        if (steerZone && steerKnob) {
            let steerTouch = null;
            let centerX = 0;
            const handleSteerStart = (e) => {
                if (this._steeringMode === 'gyro') return;
                e.preventDefault();
                steerTouch = e.changedTouches[0].identifier;
                const rect = steerZone.getBoundingClientRect();
                centerX = rect.left + rect.width / 2;
            };
            const handleSteerMove = (e) => {
                if (this._steeringMode === 'gyro' || steerTouch === null) return;
                for (const touch of e.changedTouches) {
                    if (touch.identifier === steerTouch) {
                        const rect = steerZone.getBoundingClientRect();
                        const dx = touch.clientX - centerX;
                        const maxDist = rect.width / 2;
                        this._touchSteer = Math.max(-1, Math.min(1, dx / maxDist));
                        const knobX = this._touchSteer * (maxDist - 24);
                        steerKnob.style.transform = `translateX(${knobX}px)`;
                        break;
                    }
                }
            };
            const endSteer = (e) => {
                if (this._steeringMode === 'gyro') return;
                for (const touch of e.changedTouches) {
                    if (touch.identifier === steerTouch) {
                        steerTouch = null;
                        this._touchSteer = 0;
                        steerKnob.style.transform = '';
                        break;
                    }
                }
            };

            this._listen(steerZone, 'touchstart', handleSteerStart, { passive: false });
            this._listen(window, 'touchmove', handleSteerMove, { passive: true });
            this._listen(window, 'touchend', endSteer, { passive: true });
            this._listen(window, 'touchcancel', endSteer, { passive: true });
        }

        const accelBtn = document.getElementById('touch-accel');
        const brakeBtn = document.getElementById('touch-brake');

        const bindPedal = (btn, prop) => {
            if (!btn) return;
            const handleTouchStart = (e) => {
                e.preventDefault();
                this[prop] = true;
                btn.classList.add('pressed');
                if (this._steeringMode === 'gyro') {
                    this._tryEnableGyro();
                }
            };
            const handleTouchEnd = () => {
                this[prop] = false;
                btn.classList.remove('pressed');
            };
            const handleTouchCancel = () => {
                this[prop] = false;
                btn.classList.remove('pressed');
            };
            this._listen(btn, 'touchstart', handleTouchStart, { passive: false });
            this._listen(btn, 'touchend', handleTouchEnd, { passive: true });
            this._listen(btn, 'touchcancel', handleTouchCancel, { passive: true });
        };

        bindPedal(accelBtn, '_touchAccel');
        bindPedal(brakeBtn, '_touchBrake');
    }

    destroy() {
        for (const { target, type, handler, options } of this._listeners) {
            target?.removeEventListener(type, handler, options);
        }
        this._listeners = [];
        this._gyroEnabled = false;
        this._gyroPermissionPending = false;
    }

    _listen(target, type, handler, options) {
        if (!target) return;
        target.addEventListener(type, handler, options);
        this._listeners.push({ target, type, handler, options });
    }
}
