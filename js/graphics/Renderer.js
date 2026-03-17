import * as THREE from 'three';
import { GROUND_SIZE } from '../core/Constants.js';

export class Renderer {
    constructor(canvas, options = {}) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 200, 800);

        this._setupLights();
        this._setupGround();
        this.applyQualityProfile(options.quality ?? 'auto');

        this._handleResize = () => this._onResize();
        window.addEventListener('resize', this._handleResize);
    }

    applyQualityProfile(profile = 'auto') {
        const resolved = this._resolveQuality(profile);
        const pixelRatioCap = resolved === 'high' ? 2 : 1.2;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
        this.renderer.shadowMap.enabled = resolved !== 'low';
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if (this.dirLight) {
            const mapSize = resolved === 'high' ? 2048 : 1024;
            this.dirLight.shadow.mapSize.width = mapSize;
            this.dirLight.shadow.mapSize.height = mapSize;
        }
        this.qualityProfile = profile;
        this.resolvedQuality = resolved;
    }

    _resolveQuality(profile) {
        if (profile === 'high' || profile === 'low') return profile;
        const coarse = window.matchMedia?.('(pointer: coarse)').matches;
        const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 900;
        const lowCore = (navigator.hardwareConcurrency || 4) <= 4;
        return coarse || smallScreen || lowCore ? 'low' : 'high';
    }

    _setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        this.ambientLight = ambientLight;

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(50, 80, 30);
        dirLight.castShadow = true;
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 200;
        dirLight.shadow.camera.left = -60;
        dirLight.shadow.camera.right = 60;
        dirLight.shadow.camera.top = 60;
        dirLight.shadow.camera.bottom = -60;
        this.scene.add(dirLight);
        this.scene.add(dirLight.target);
        this.dirLight = dirLight;
    }

    _setupGround() {
        const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x3a7d44,
            roughness: 0.9,
            metalness: 0.0,
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -6;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    render(camera) {
        this.renderer.render(this.scene, camera);
    }

    dispose() {
        window.removeEventListener('resize', this._handleResize);
        this.scene.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => {
                    for (const value of Object.values(material)) {
                        if (value?.isTexture) value.dispose();
                    }
                    material.dispose();
                });
            }
        });
        this.scene.clear();
        this.renderer.dispose();
    }

    _onResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.applyQualityProfile(this.qualityProfile ?? 'auto');
    }
}
