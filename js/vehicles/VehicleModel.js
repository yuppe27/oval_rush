import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Cached GLB scene template (loaded once, cloned per vehicle)
// Use globalThis to ensure single instance across module duplicates (cache-busting query params)
if (!globalThis.__vehicleModelGLBCache) {
    globalThis.__vehicleModelGLBCache = { scene: null, promise: null };
}
const _glbCache = globalThis.__vehicleModelGLBCache;

const CAR_GLB_PATH = 'assets/models/car.glb';

/**
 * Three-state taillight: 'off' (idle), 'coast' (engine braking, dim red),
 * 'brake' (active brake, bright red). The emissive values are chosen to exceed
 * the UnrealBloomPass threshold (0.85) so the rear lights bloom naturally.
 */
const TAILLIGHT_STATES = {
    off:   { intensity: 1.2,  color: 0x880808 },
    coast: { intensity: 5.0,  color: 0xd82020 },
    brake: { intensity: 14.0, color: 0xff3232 },
};

const BODY_MATERIAL_NAMES = new Set(['BodyBlue.001', 'RoofDark', 'RedAccent', 'GoldAccent']);

/**
 * Promote a MeshStandardMaterial to MeshPhysicalMaterial and enable clearcoat
 * for car-paint-like reflections. We transfer the well-known Standard fields
 * by hand because MeshPhysicalMaterial.copy() expects Vector2 fields
 * (clearcoatNormalScale, sheenColor, etc.) that a plain Standard material
 * does not carry, and would throw on undefined.
 * @param {THREE.Material} src
 * @returns {THREE.MeshPhysicalMaterial}
 */
function promoteToClearcoat(src) {
    if (src.isMeshPhysicalMaterial) {
        src.clearcoat = src.clearcoat || 0.6;
        src.clearcoatRoughness = src.clearcoatRoughness ?? 0.25;
        src.envMapIntensity = src.envMapIntensity ?? 0.9;
        return src;
    }
    const phys = new THREE.MeshPhysicalMaterial({
        color: src.color ? src.color.clone() : undefined,
        map: src.map ?? null,
        normalMap: src.normalMap ?? null,
        normalScale: src.normalScale ? src.normalScale.clone() : undefined,
        roughness: src.roughness ?? 0.5,
        roughnessMap: src.roughnessMap ?? null,
        metalness: src.metalness ?? 0.0,
        metalnessMap: src.metalnessMap ?? null,
        aoMap: src.aoMap ?? null,
        aoMapIntensity: src.aoMapIntensity ?? 1.0,
        emissive: src.emissive ? src.emissive.clone() : undefined,
        emissiveMap: src.emissiveMap ?? null,
        emissiveIntensity: src.emissiveIntensity ?? 1.0,
        envMapIntensity: src.envMapIntensity ?? 1.0,
        transparent: Boolean(src.transparent),
        opacity: src.opacity ?? 1.0,
        side: src.side ?? THREE.FrontSide,
        flatShading: Boolean(src.flatShading),
    });
    phys.name = src.name;
    phys.clearcoat = 0.6;
    phys.clearcoatRoughness = 0.25;
    phys.envMapIntensity = 0.9;
    src.dispose();
    return phys;
}

export class VehicleModel {
    constructor(options = {}) {
        this.group = new THREE.Group();
        this.wheels = [];
        this.taillightMat = null;
        this._taillightState = 'off';
        this.vehicleId = options.vehicleId || 'falcon';
        this.primaryColor = options.color ?? 0xcc0000;
        this.modelScale = options.modelScale ?? 1;

        // If GLB is already cached, build immediately
        if (_glbCache.scene) {
            this._buildFromGLB();
        }
        this.group.scale.setScalar(this.modelScale);
    }

    /**
     * Preload the car GLB model. Call once before creating any VehicleModel instances.
     * @returns {Promise<void>}
     */
    static preload() {
        if (_glbCache.scene) return Promise.resolve();
        if (_glbCache.promise) return _glbCache.promise;

        const loader = new GLTFLoader();
        _glbCache.promise = new Promise((resolve, reject) => {
            loader.load(
                CAR_GLB_PATH,
                (gltf) => {
                    _glbCache.scene = gltf.scene;
                    resolve();
                },
                undefined,
                (err) => {
                    console.error('Failed to load car.glb:', err);
                    reject(err);
                }
            );
        });
        return _glbCache.promise;
    }

    /**
     * Returns the cached GLB scene (for AIController cloning).
     */
    static getCachedScene() {
        return _glbCache.scene;
    }

    _buildFromGLB() {
        const clone = _glbCache.scene.clone(true);

        // Compute bounding box to determine model size and normalize
        const box = new THREE.Box3().setFromObject(clone);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Target dimensions: roughly match the original procedural car (~2m wide, ~4.8m long, ~1.3m tall)
        const targetLength = 4.8;
        const scaleFactor = targetLength / Math.max(size.x, size.y, size.z);

        clone.scale.setScalar(scaleFactor);
        // Rotate 90° so that the model's X-length axis aligns with Three.js Z-forward
        clone.rotation.y = -Math.PI / 2;

        // Re-center after scaling and rotation
        const scaledBox = new THREE.Box3().setFromObject(clone);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
        // Center horizontally/depth, place bottom at y=0 (wheel contact with ground)
        clone.position.set(
            clone.position.x - scaledCenter.x,
            clone.position.y - scaledBox.min.y,
            clone.position.z - scaledCenter.z
        );

        // Apply per-car color and shadow settings
        const bodyColor = new THREE.Color(this.primaryColor);
        // Roof is a darker shade of the body color
        const roofColor = bodyColor.clone().multiplyScalar(0.7);

        clone.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;

            // Clone material so each car instance has its own
            child.material = child.material.clone();
            const matName = child.material.name;

            if (matName === 'BodyBlue.001') {
                child.material = promoteToClearcoat(child.material);
                child.material.color.set(bodyColor);
            } else if (matName === 'RoofDark') {
                child.material = promoteToClearcoat(child.material);
                child.material.color.set(roofColor);
            } else if (BODY_MATERIAL_NAMES.has(matName)) {
                child.material = promoteToClearcoat(child.material);
            } else if (matName === 'Taillight') {
                // Share a single taillight material across L/R for unified brake control
                if (!this.taillightMat) {
                    this.taillightMat = child.material;
                    const off = TAILLIGHT_STATES.off;
                    this.taillightMat.emissive = new THREE.Color(off.color);
                    this.taillightMat.emissiveIntensity = off.intensity;
                    this.taillightMat.color.set(off.color);
                }
                child.material = this.taillightMat;
            }
        });

        this.group.add(clone);
        this._glbRoot = clone;
    }

    /**
     * Apply a full livery (body + accents) to the GLB model meshes.
     * @param {object} scheme - { body, accent1?, accent2? } as hex color values
     */
    applyLivery(scheme) {
        VehicleModel.applyLiveryToGroup(this.group, scheme);
        // Grab shared taillight material reference for brake effect
        // (applyLiveryToGroup ensures all Taillight meshes share one material)
        this.taillightMat = null;
        this.group.traverse((child) => {
            if (child.isMesh && child.material.name === 'Taillight' && !this.taillightMat) {
                this.taillightMat = child.material;
            }
        });
    }

    /**
     * Static helper: apply a full livery to any THREE.Group containing GLB car meshes.
     * @param {THREE.Group} group
     * @param {object} scheme - { body, accent1?, accent2? } as hex color values
     */
    static applyLiveryToGroup(group, scheme) {
        const bodyColor = new THREE.Color(scheme.body);
        const roofColor = bodyColor.clone().multiplyScalar(0.7);
        const accent1 = scheme.accent1 != null ? new THREE.Color(scheme.accent1) : null;
        const accent2 = scheme.accent2 != null ? new THREE.Color(scheme.accent2) : null;

        // Single shared taillight material for both L/R lights
        let sharedTaillightMat = null;

        group.traverse((child) => {
            if (!child.isMesh) return;
            const matName = child.material.name;
            if (matName === 'BodyBlue.001') {
                child.material = promoteToClearcoat(child.material.clone());
                child.material.color.set(bodyColor);
            } else if (matName === 'RoofDark') {
                child.material = promoteToClearcoat(child.material.clone());
                child.material.color.set(roofColor);
            } else if (matName === 'RedAccent' && accent1) {
                child.material = promoteToClearcoat(child.material.clone());
                child.material.color.set(accent1);
            } else if (matName === 'GoldAccent' && accent2) {
                child.material = promoteToClearcoat(child.material.clone());
                child.material.color.set(accent2);
            } else if (matName === 'Taillight') {
                if (!sharedTaillightMat) {
                    sharedTaillightMat = child.material.clone();
                    const off = TAILLIGHT_STATES.off;
                    sharedTaillightMat.emissive = new THREE.Color(off.color);
                    sharedTaillightMat.emissiveIntensity = off.intensity;
                    sharedTaillightMat.color.set(off.color);
                }
                child.material = sharedTaillightMat;
            }
        });
    }

    setBraking(active) {
        this.setTaillightState(active ? 'brake' : 'off');
    }

    /**
     * @param {'off'|'coast'|'brake'} state
     */
    setTaillightState(state) {
        const preset = TAILLIGHT_STATES[state] ?? TAILLIGHT_STATES.off;
        if (this._taillightState === state) return;
        this._taillightState = state;
        if (!this.taillightMat) return;
        this.taillightMat.emissiveIntensity = preset.intensity;
        this.taillightMat.emissive.setHex(preset.color);
        this.taillightMat.color.setHex(preset.color);
    }

    updateWheelRotation(speed) {
        const rotationSpeed = speed * 0.05;
        for (const pivot of this.wheels) {
            pivot.rotation.x += rotationSpeed;
        }
    }

    addToScene(scene) {
        scene.add(this.group);
    }

    setDebugWireframe(enabled) {
        this.group.traverse((obj) => {
            if (!obj.isMesh) return;
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const material of materials) {
                if (!material || !('wireframe' in material)) continue;
                if (enabled) {
                    if (!material.userData.__debugWireframeState) {
                        material.userData.__debugWireframeState = {
                            wireframe: material.wireframe,
                            transparent: material.transparent,
                            opacity: material.opacity,
                        };
                    }
                    material.wireframe = true;
                    material.transparent = true;
                    material.opacity = Math.min(material.opacity ?? 1, 0.92);
                } else if (material.userData.__debugWireframeState) {
                    const state = material.userData.__debugWireframeState;
                    material.wireframe = state.wireframe;
                    material.transparent = state.transparent;
                    material.opacity = state.opacity;
                    delete material.userData.__debugWireframeState;
                }
                material.needsUpdate = true;
            }
        });
    }
}
