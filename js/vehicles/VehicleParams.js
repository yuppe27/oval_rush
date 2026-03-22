import { KMH_TO_MS } from '../core/Constants.js';

export const VEHICLE_PRESETS = {
    falcon: {
        id: 'falcon',
        name: 'Falcon MK-I',
        color: 0xff2266,
        maxSpeedKmh: 286,
        accelerationKmh: 126,
        handling: 1.0,
        driftBias: 1.0,
        modelScale: 1.0,
        transmissionFinalRatio: 1.0,
        jumpTuning: {
            launchLift: 0.9,
            airtimeScale: 0.92,
            gravityScale: 1.0,
            throttleKick: 0.025,
        },
        gearTable: [
            { ratio: 1.0, speedRangeKmh: [0, 84], upshiftKmh: 78, downshiftKmh: 0 },
            { ratio: 0.78, speedRangeKmh: [56, 162], upshiftKmh: 154, downshiftKmh: 66 },
            { ratio: 0.58, speedRangeKmh: [124, 244], upshiftKmh: 234, downshiftKmh: 134 },
            { ratio: 0.44, speedRangeKmh: [188, 286], upshiftKmh: 999, downshiftKmh: 198 },
        ],
    },
    bolt: {
        id: 'bolt',
        name: 'Bolt RS',
        color: 0xeeff22,
        maxSpeedKmh: 326,
        accelerationKmh: 98,
        handling: 0.84,
        driftBias: 1.2,
        modelScale: 0.98,
        transmissionFinalRatio: 1.05,
        jumpTuning: {
            launchLift: 0.78,
            airtimeScale: 0.8,
            gravityScale: 1.12,
            throttleKick: 0.015,
        },
        gearTable: [
            { ratio: 0.94, speedRangeKmh: [0, 94], upshiftKmh: 88, downshiftKmh: 0 },
            { ratio: 0.73, speedRangeKmh: [66, 188], upshiftKmh: 178, downshiftKmh: 76 },
            { ratio: 0.56, speedRangeKmh: [140, 284], upshiftKmh: 270, downshiftKmh: 150 },
            { ratio: 0.43, speedRangeKmh: [214, 326], upshiftKmh: 999, downshiftKmh: 224 },
        ],
    },
    ironclad: {
        id: 'ironclad',
        name: 'Ironclad GT',
        color: 0x33ffdd,
        maxSpeedKmh: 270,
        accelerationKmh: 148,
        handling: 1.22,
        driftBias: 0.82,
        modelScale: 1.05,
        transmissionFinalRatio: 0.93,
        jumpTuning: {
            launchLift: 0.84,
            airtimeScale: 0.86,
            gravityScale: 1.06,
            throttleKick: 0.02,
        },
        gearTable: [
            { ratio: 1.1, speedRangeKmh: [0, 74], upshiftKmh: 68, downshiftKmh: 0 },
            { ratio: 0.88, speedRangeKmh: [48, 144], upshiftKmh: 136, downshiftKmh: 58 },
            { ratio: 0.66, speedRangeKmh: [108, 220], upshiftKmh: 210, downshiftKmh: 118 },
            { ratio: 0.5, speedRangeKmh: [176, 270], upshiftKmh: 999, downshiftKmh: 186 },
        ],
    },
};

export const VEHICLE_PRESET_IDS = Object.keys(VEHICLE_PRESETS);

export function resolveVehiclePreset(vehicleId = 'falcon') {
    return VEHICLE_PRESETS[vehicleId] || VEHICLE_PRESETS.falcon;
}

export function toVehiclePhysics(preset) {
    return {
        vehicleId: preset.id,
        color: preset.color,
        maxSpeed: preset.maxSpeedKmh * KMH_TO_MS,
        acceleration: preset.accelerationKmh * KMH_TO_MS,
        handling: preset.handling,
        driftBias: preset.driftBias,
        modelScale: preset.modelScale,
        transmissionFinalRatio: preset.transmissionFinalRatio,
        jumpTuning: preset.jumpTuning,
        gearTable: preset.gearTable,
    };
}
