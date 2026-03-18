import * as THREE from 'three';

const VERT = `
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = pos.xyww;
}
`;

const FRAG = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uHazeExp;

varying vec3 vDir;

void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;

    float t = pow(clamp(y, 0.0, 1.0), uHazeExp);
    vec3 color = mix(uHorizon, uZenith, t);

    float scatter = pow(1.0 - abs(y), 5.0);
    color += uHorizon * scatter * 0.22;

    float cosAngle = dot(dir, uSunDir);
    float disc = smoothstep(1.0 - uSunSize * 0.0022, 1.0 - uSunSize * 0.0005, cosAngle);
    float glow = pow(max(cosAngle, 0.0), 80.0) * 0.9;
    float outerGlow = pow(max(cosAngle, 0.0), 14.0) * 0.18;
    color += uSunColor * (disc + glow + outerGlow);

    if (y < 0.0) {
        float g = clamp(-y * 5.0, 0.0, 1.0);
        color = mix(color, uGround, g);
    }

    gl_FragColor = vec4(color, 1.0);
}
`;

const PRESETS = {
    thunder: {
        zenith:   new THREE.Color(0x0d5db5),
        horizon:  new THREE.Color(0x82c8ef),
        ground:   new THREE.Color(0x6da8b8),
        sunDir:   new THREE.Vector3(0.5, 0.72, 0.4).normalize(),
        sunColor: new THREE.Color(1.5, 1.4, 1.0),
        sunSize:  1.0,
        hazeExp:  0.5,
        fogHex:   0x87ceeb,
    },
    seaside: {
        zenith:   new THREE.Color(0x0b57a8),
        horizon:  new THREE.Color(0x78c2e8),
        ground:   new THREE.Color(0x60acc8),
        sunDir:   new THREE.Vector3(0.3, 0.65, 0.6).normalize(),
        sunColor: new THREE.Color(1.6, 1.45, 1.0),
        sunSize:  0.9,
        hazeExp:  0.45,
        fogHex:   0x8dc8e8,
    },
    mountain: {
        zenith:   new THREE.Color(0x3a5568),
        horizon:  new THREE.Color(0xa4b8c4),
        ground:   new THREE.Color(0xb4c6ce),
        sunDir:   new THREE.Vector3(0.2, 0.5, 0.7).normalize(),
        sunColor: new THREE.Color(0.9, 0.9, 0.96),
        sunSize:  0.65,
        hazeExp:  0.72,
        fogHex:   0xb6c2cc,
    },
};

export class SkyDome {
    constructor(scene) {
        const geo = new THREE.SphereGeometry(1100, 32, 16);
        this._mat = new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uZenith:   { value: new THREE.Color() },
                uHorizon:  { value: new THREE.Color() },
                uGround:   { value: new THREE.Color() },
                uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
                uSunColor: { value: new THREE.Color() },
                uSunSize:  { value: 1.0 },
                uHazeExp:  { value: 0.5 },
            },
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
        });
        this._mesh = new THREE.Mesh(geo, this._mat);
        this._mesh.renderOrder = -1000;
        scene.add(this._mesh);
        this.applyPreset('thunder');
    }

    applyPreset(courseId) {
        const p = PRESETS[courseId] ?? PRESETS.thunder;
        const u = this._mat.uniforms;
        u.uZenith.value.copy(p.zenith);
        u.uHorizon.value.copy(p.horizon);
        u.uGround.value.copy(p.ground);
        u.uSunDir.value.copy(p.sunDir);
        u.uSunColor.value.copy(p.sunColor);
        u.uSunSize.value = p.sunSize;
        u.uHazeExp.value = p.hazeExp;
        this.fogHex = p.fogHex;
    }

    followCamera(camera) {
        this._mesh.position.copy(camera.position);
    }

    dispose() {
        this._mesh.geometry.dispose();
        this._mat.dispose();
    }
}
