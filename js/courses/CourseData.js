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
        { x: -160, y: 28, z: 170,  width: 16, bankAngle: -8 },  // first hilltop
        { x: -148, y: 28, z: 182,  width: 15, bankAngle:  4 },  // hairpin entry
        { x: -136, y: 28, z: 194,  width: 14, bankAngle:  9 },  // hairpin apex (drift corner 1)
        { x: -124, y: 27, z: 182,  width: 15, bankAngle:  4 },  // hairpin exit
        { x: -50,  y: 14, z: 180,  width: 16, bankAngle: -5 },  // descent
        { x: 60,   y: 3,  z: 150,  width: 16, bankAngle: -3 },  // valley near coast
        { x: 170,  y: 16, z: 160,  width: 16, bankAngle: -5 },  // second hill climb
        { x: 250,  y: 22, z: 95,   width: 16, bankAngle: -6 },  // second hilltop
        { x: 248,  y: 18, z: 62,   width: 15, bankAngle:  4 },  // hairpin entry
        { x: 260,  y: 18, z: 50,   width: 14, bankAngle:  9 },  // hairpin apex (drift corner 2)
        { x: 248,  y: 16, z: 38,   width: 15, bankAngle:  4 },  // hairpin exit
        { x: 240,  y: 10, z: -10,  width: 16, bankAngle: -4 },  // descent
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
        { x: -233, y: 46,  z: -56,  width: 12, bankAngle:  4 },  // hairpin entry
        { x: -245, y: 49,  z: -44,  width: 11, bankAngle:  9 },  // hairpin apex (drift corner 1)
        { x: -233, y: 47,  z: -32,  width: 12, bankAngle:  4 },  // hairpin exit
        { x: -250, y: 55,  z: 20,   width: 13, bankAngle: -8 },  // first ridge
        { x: -190, y: 38,  z: 130,  width: 13, bankAngle: -10 }, // valley dip
        { x: -157, y: 48,  z: 157,  width: 12, bankAngle:  4 },  // hairpin entry
        { x: -145, y: 50,  z: 169,  width: 11, bankAngle:  9 },  // hairpin apex (drift corner 2)
        { x: -157, y: 49,  z: 181,  width: 12, bankAngle:  4 },  // hairpin exit
        { x: -80,  y: 78,  z: 220,  width: 13, bankAngle: -7 },  // steep climb
        { x: 55,   y: 112, z: 240,  width: 13, bankAngle: -5 },  // summit peak
        { x: 93,   y: 100, z: 222,  width: 12, bankAngle:  4 },  // hairpin entry
        { x: 105,  y: 99,  z: 210,  width: 11, bankAngle:  9 },  // hairpin apex (drift corner 3)
        { x: 117,  y: 98,  z: 222,  width: 12, bankAngle:  4 },  // hairpin exit
        { x: 170,  y: 82,  z: 180,  width: 13, bankAngle: -4 },  // descent from summit
        { x: 240,  y: 55,  z: 70,   width: 13, bankAngle: -6 },  // saddle
        { x: 275,  y: 57,  z: 50,   width: 13, bankAngle: -3 },  // hairpin approach
        { x: 315,  y: 60,  z: 40,   width: 12, bankAngle: 5 },   // hairpin entry
        { x: 325,  y: 63,  z: 5,    width: 12, bankAngle: 8 },   // hairpin apex
        { x: 300,  y: 66,  z: -15,  width: 12, bankAngle: 5 },   // hairpin exit
        { x: 260,  y: 72,  z: -40,  width: 13, bankAngle: -7 },  // secondary ridge
        { x: 249,  y: 65,  z: -72,  width: 12, bankAngle:  4 },  // hairpin entry
        { x: 261,  y: 63,  z: -84,  width: 11, bankAngle:  9 },  // hairpin apex (drift corner 4)
        { x: 249,  y: 61,  z: -96,  width: 12, bankAngle:  4 },  // hairpin exit
        { x: 220,  y: 42,  z: -140, width: 13, bankAngle: -5 },  // descent
        { x: 110,  y: 25,  z: -220, width: 13, bankAngle: -4 },  // near base
        { x: -20,  y: 18,  z: -240, width: 13, bankAngle: -3 },  // approach to start
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
