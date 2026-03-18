/**
 * Course data definitions using Catmull-Rom spline control points.
 * Each control point: { x, y, z, width, bankAngle }
 */

function approxLoopLength(controlPoints) {
    let total = 0;

    for (let i = 0; i < controlPoints.length; i++) {
        const a = controlPoints[i];
        const b = controlPoints[(i + 1) % controlPoints.length];
        total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }

    return total;
}

function scaleCourseGeometry(course, scale) {
    return {
        ...course,
        controlPoints: course.controlPoints.map(cp => ({
            ...cp,
            x: cp.x * scale,
            y: cp.y * scale,
            z: cp.z * scale,
        })),
        startPosition: {
            ...course.startPosition,
            x: course.startPosition.x * scale,
            y: course.startPosition.y * scale,
            z: course.startPosition.z * scale,
        },
    };
}

export const THUNDER_OVAL = {
    id: 'thunder',
    name: 'Thunder Oval Speedway',
    scenery: 'stadium',
    rollingStart: true,
    rollingStartSpeedRatio: 0.56,
    rollingStartIntroDrive: true,
    laps: 8,
    initialTime: 40,
    checkpointExtension: 12,
    gridSize: 12,
    controlPoints: [
        { x: 0, y: 0, z: -512, width: 20, bankAngle: -5 },
        { x: -64, y: 0, z: -504, width: 20, bankAngle: -5 },
        { x: -160, y: 0, z: -456, width: 20, bankAngle: -20 },
        { x: -232, y: 0, z: -352, width: 20, bankAngle: -30 },
        { x: -260, y: 0, z: -208, width: 20, bankAngle: -30 },
        { x: -260, y: 0, z: -48, width: 20, bankAngle: -30 },
        { x: -236, y: 0, z: 128, width: 20, bankAngle: -25 },
        { x: -160, y: 0, z: 248, width: 20, bankAngle: -15 },
        { x: -64, y: 0, z: 344, width: 20, bankAngle: -5 },
        { x: 0, y: 0, z: 392, width: 20, bankAngle: -8 },
        { x: 64, y: 0, z: 344, width: 20, bankAngle: -5 },
        { x: 160, y: 0, z: 248, width: 20, bankAngle: -15 },
        { x: 236, y: 0, z: 128, width: 20, bankAngle: -25 },
        { x: 260, y: 0, z: -48, width: 20, bankAngle: -30 },
        { x: 260, y: 0, z: -208, width: 20, bankAngle: -30 },
        { x: 232, y: 0, z: -352, width: 20, bankAngle: -30 },
        { x: 160, y: 0, z: -456, width: 20, bankAngle: -20 },
        { x: 64, y: 0, z: -504, width: 20, bankAngle: -5 },
    ],
    checkpointPositions: [0.18, 0.62],
    startLinePosition: 0.0,
    startPosition: { x: -20, y: 0, z: -512 },
    startRotation: -Math.PI / 2,
};

const SEASIDE_GRAND_BASE = {
    id: 'seaside',
    name: 'Seaside Grand Circuit',
    scenery: 'seaside',
    laps: 4,
    initialTime: 45,
    checkpointExtension: 14,
    gridSize: 10,
    controlPoints: [
        { x: -140, y: 0,  z: -100, width: 16, bankAngle: -3 },  // coastal flat
        { x: -210, y: 8,  z: -20,  width: 16, bankAngle: -4 },  // gentle climb
        { x: -230, y: 22, z: 90,   width: 16, bankAngle: -6 },  // hillside climb
        { x: -170, y: 26, z: 155,  width: 16, bankAngle: -5 },  // first hilltop
        { x: -150, y: 26, z: 182,  width: 16, bankAngle:  1 },  // sweeping right entry
        { x: -98,  y: 27, z: 205,  width: 16, bankAngle:  4 },  // broad apex
        { x: -28,  y: 22, z: 188,  width: 16, bankAngle:  2 },  // opening exit
        { x: 30,   y: 14, z: 170,  width: 16, bankAngle: -4 },  // descent
        { x: 60,   y: 3,  z: 150,  width: 16, bankAngle: -3 },  // valley near coast
        { x: 170,  y: 16, z: 160,  width: 16, bankAngle: -5 },  // second hill climb
        { x: 250,  y: 22, z: 95,   width: 16, bankAngle: -5 },  // second hilltop
        { x: 272,  y: 20, z: 76,   width: 16, bankAngle: -1 },  // sweeping left entry
        { x: 312,  y: 18, z: 44,   width: 16, bankAngle:  3 },  // broad apex
        { x: 322,  y: 15, z: -6,   width: 16, bankAngle:  1 },  // opening exit
        { x: 300,  y: 10, z: -60,  width: 16, bankAngle: -4 },  // descent
        { x: 170,  y: 2,  z: -90,  width: 16, bankAngle: -2 },  // back near coast
        { x: 60,   y: 0,  z: -120, width: 16, bankAngle: -2 },  // coastal flat
        { x: -40,  y: 0,  z: -140, width: 16, bankAngle: -2 },  // coastal flat
    ],
    checkpointPositions: [0.13, 0.38, 0.62, 0.86],
    startLinePosition: 0.02,
    startPosition: { x: -130, y: 0, z: -95 },
    startRotation: -0.95,
    zones: {
        tunnel: [
            { start: 0.63, end: 0.76, lighting: 0.48 },
        ],
        lowGrip: [
            { start: 0.79, end: 0.93, grip: 0.84, label: 'cobblestone' },
        ],
    },
};

const MOUNTAIN_APEX_BASE = {
    id: 'mountain',
    name: 'Mountain Apex Rally',
    scenery: 'mountain',
    laps: 2,
    initialTime: 50,
    checkpointExtension: 16,
    gridSize: 8,
    controlPoints: [
        { x: -110, y: 20,  z: -200, width: 13, bankAngle: -2 },  // base camp
        { x: -220, y: 42,  z: -110, width: 13, bankAngle: -5 },  // first climb
        { x: -238, y: 45,  z: -72,  width: 13, bankAngle: -2 },  // uphill bend
        { x: -246, y: 49,  z: -28,  width: 13, bankAngle:  1 },  // ridge apex
        { x: -238, y: 52,  z: 20,   width: 13, bankAngle:  2 },  // opening exit
        { x: -220, y: 55,  z: 68,   width: 13, bankAngle: -5 },  // first ridge
        { x: -190, y: 38,  z: 130,  width: 13, bankAngle: -10 }, // valley dip
        { x: -158, y: 46,  z: 154,  width: 13, bankAngle: -2 },  // climbing sweep
        { x: -112, y: 50,  z: 184,  width: 13, bankAngle:  1 },  // mid apex
        { x: -52,  y: 58,  z: 210,  width: 13, bankAngle:  3 },  // opening exit
        { x: 20,   y: 78,  z: 228,  width: 13, bankAngle: -5 },  // steep climb
        { x: 55,   y: 112, z: 240,  width: 13, bankAngle: -5 },  // summit peak
        { x: 88,   y: 108, z: 236,  width: 13, bankAngle: -1 },  // summit sweep entry
        { x: 124,  y: 102, z: 220,  width: 13, bankAngle:  1 },  // summit apex
        { x: 160,  y: 94,  z: 198,  width: 13, bankAngle:  2 },  // summit exit
        { x: 192,  y: 82,  z: 162,  width: 13, bankAngle: -3 },  // descent from summit
        { x: 240,  y: 55,  z: 70,   width: 13, bankAngle: -6 },  // saddle
        { x: 280,  y: 57,  z: 58,   width: 13, bankAngle: -2 },  // outer ridge
        { x: 320,  y: 60,  z: 42,   width: 13, bankAngle:  1 },  // descending sweep
        { x: 350,  y: 63,  z: 8,    width: 13, bankAngle:  3 },  // broad apex
        { x: 344,  y: 67,  z: -36,  width: 13, bankAngle:  1 },  // opening exit
        { x: 316,  y: 69,  z: -76,  width: 13, bankAngle: -3 },  // secondary ridge
        { x: 274,  y: 66,  z: -112, width: 13, bankAngle: -2 },  // downhill sweep
        { x: 220,  y: 61,  z: -145, width: 13, bankAngle: -1 },  // valley approach
        { x: 156,  y: 52,  z: -176, width: 13, bankAngle: -2 },  // lower descent
        { x: 84,   y: 42,  z: -206, width: 13, bankAngle: -4 },  // descent
        { x: 10,   y: 25,  z: -228, width: 13, bankAngle: -4 },  // near base
        { x: -60,  y: 18,  z: -232, width: 13, bankAngle: -3 },  // approach to start
    ],
    checkpointPositions: [0.10, 0.25, 0.42, 0.58, 0.75, 0.9],
    startLinePosition: 0.97,
    startPosition: { x: -100, y: 20, z: -198 },
    startRotation: -0.9,
    zones: {
        jump: [
            { start: 0.18, end: 0.205, impulse: 8.2, boostWindow: 0.34 },
            { start: 0.69, end: 0.715, impulse: 9.0, boostWindow: 0.38 },
        ],
        mist: [
            { start: 0.05, end: 0.18, density: 0.45 },
            { start: 0.52, end: 0.68, density: 0.62 },
        ],
    },
};

const THUNDER_REFERENCE_LENGTH = approxLoopLength(THUNDER_OVAL.controlPoints);
const SEASIDE_SCALE = (THUNDER_REFERENCE_LENGTH * 1.5) / approxLoopLength(SEASIDE_GRAND_BASE.controlPoints);
const MOUNTAIN_SCALE = (THUNDER_REFERENCE_LENGTH * 2.0) / approxLoopLength(MOUNTAIN_APEX_BASE.controlPoints);

export const SEASIDE_GRAND = scaleCourseGeometry(SEASIDE_GRAND_BASE, SEASIDE_SCALE);
export const MOUNTAIN_APEX = scaleCourseGeometry(MOUNTAIN_APEX_BASE, MOUNTAIN_SCALE);

export const COURSE_MAP = {
    thunder: THUNDER_OVAL,
    seaside: SEASIDE_GRAND,
    mountain: MOUNTAIN_APEX,
};

export const ALL_COURSES = [THUNDER_OVAL, SEASIDE_GRAND, MOUNTAIN_APEX];

export function resolveCourse(courseId = 'thunder') {
    return COURSE_MAP[courseId] || THUNDER_OVAL;
}
