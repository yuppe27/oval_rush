import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Cached GLB scene template (loaded once, cloned per vehicle)
// Use globalThis to ensure single instance across module duplicates (cache-busting query params)
if (!globalThis.__vehicleModelGLBCache) {
    globalThis.__vehicleModelGLBCache = { scene: null, promise: null };
}
const _glbCache = globalThis.__vehicleModelGLBCache;

const CAR_GLB_PATH = 'assets/models/car.glb';

export class VehicleModel {
    constructor(options = {}) {
        this.group = new THREE.Group();
        this.wheels = [];
        this.taillightMat = null;
        this._braking = false;
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
                child.material.color.set(bodyColor);
            } else if (matName === 'RoofDark') {
                child.material.color.set(roofColor);
            } else if (matName === 'Taillight') {
                // Share a single taillight material across L/R for unified brake control
                if (!this.taillightMat) {
                    this.taillightMat = child.material;
                    this.taillightMat.emissive = new THREE.Color(0xff2222);
                    this.taillightMat.emissiveIntensity = 2.0;
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
                child.material = child.material.clone();
                child.material.color.set(bodyColor);
            } else if (matName === 'RoofDark') {
                child.material = child.material.clone();
                child.material.color.set(roofColor);
            } else if (matName === 'RedAccent' && accent1) {
                child.material = child.material.clone();
                child.material.color.set(accent1);
            } else if (matName === 'GoldAccent' && accent2) {
                child.material = child.material.clone();
                child.material.color.set(accent2);
            } else if (matName === 'Taillight') {
                if (!sharedTaillightMat) {
                    sharedTaillightMat = child.material.clone();
                    sharedTaillightMat.emissive = new THREE.Color(0xff2222);
                    sharedTaillightMat.emissiveIntensity = 2.0;
                }
                child.material = sharedTaillightMat;
            }
        });
    }

    setBraking(active) {
        if (this._braking === active) return;
        this._braking = active;
        if (this.taillightMat) {
            this.taillightMat.emissiveIntensity = active ? 8.0 : 2.0;
            this.taillightMat.color.set(active ? 0xff4444 : 0xda2727);
        }
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
