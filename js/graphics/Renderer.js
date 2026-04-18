import * as THREE from 'three';
import { GROUND_SIZE } from '../core/Constants.js';
import { SkyDome } from './SkyDome.js';
import { PostProcessing } from './PostProcessing.js';

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
        this.scene.background = null;
        this.scene.fog = new THREE.Fog(0x87ceeb, 200, 800);

        this._setupLights();
        this._setupGround();
        this.skyDome = new SkyDome(this.scene);
        this._pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this._pmremGenerator.compileEquirectangularShader();
        this._envMap = null;
        this._envScene = null;
        this._postProcessing = null;
        this._activeCamera = null;
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
        if (this._postProcessing) {
            this._postProcessing.setEnabled(resolved !== 'low');
        }
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

    setSky(courseId) {
        this.skyDome.applyPreset(courseId);
        this.scene.fog.color.setHex(this.skyDome.fogHex);
        this._refreshEnvironmentMap();
    }

    updateSky(camera) {
        this.skyDome.followCamera(camera);
    }

    render(camera) {
        if (camera !== this._activeCamera) {
            this._activeCamera = camera;
            if (this._postProcessing) this._postProcessing.setCamera(camera);
        }
        if (!this._postProcessing) {
            this._postProcessing = new PostProcessing(this.renderer, this.scene, camera);
            this._postProcessing.setEnabled(this.resolvedQuality !== 'low');
        }
        this._postProcessing.render();
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
        this.skyDome.dispose();
        if (this._postProcessing) this._postProcessing.dispose();
        if (this._envMap) this._envMap.dispose();
        if (this._pmremGenerator) this._pmremGenerator.dispose();
        this.scene.clear();
        this.renderer.dispose();
    }

    _onResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.applyQualityProfile(this.qualityProfile ?? 'auto');
        if (this._postProcessing) {
            this._postProcessing.setSize(window.innerWidth, window.innerHeight);
        }
    }

    /**
     * Rebuild the scene environment map from the current sky preset. Called on
     * course change so reflections on car bodies match the sky gradient/sun.
     */
    _refreshEnvironmentMap() {
        if (!this._pmremGenerator) return;
        if (this._envMap) {
            this._envMap.dispose();
            this._envMap = null;
        }
        const envScene = this._buildEnvironmentScene();
        const rt = this._pmremGenerator.fromScene(envScene, 0.04);
        this._envMap = rt.texture;
        this.scene.environment = this._envMap;
        envScene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }

    /**
     * Lightweight gradient dome used purely as a source for PMREM. Keeping this
     * separate from the real SkyDome avoids needing the shader uniforms to be
     * readable from a render target.
     */
    _buildEnvironmentScene() {
        const scene = new THREE.Scene();
        const zenith = this.skyDome?._mat?.uniforms?.uZenith?.value ?? new THREE.Color(0x4a88c8);
        const horizon = this.skyDome?._mat?.uniforms?.uHorizon?.value ?? new THREE.Color(0xbcdcee);
        const ground = this.skyDome?._mat?.uniforms?.uGround?.value ?? new THREE.Color(0x8aa0ac);
        const sunColor = this.skyDome?._mat?.uniforms?.uSunColor?.value ?? new THREE.Color(1.4, 1.35, 1.0);
        const sunDir = this.skyDome?._mat?.uniforms?.uSunDir?.value ?? new THREE.Vector3(0.4, 0.7, 0.4);

        const geo = new THREE.SphereGeometry(50, 32, 16);
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                uZenith:   { value: new THREE.Color().copy(zenith) },
                uHorizon:  { value: new THREE.Color().copy(horizon) },
                uGround:   { value: new THREE.Color().copy(ground) },
                uSunColor: { value: new THREE.Color().copy(sunColor) },
                uSunDir:   { value: new THREE.Vector3().copy(sunDir).normalize() },
            },
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uZenith;
                uniform vec3 uHorizon;
                uniform vec3 uGround;
                uniform vec3 uSunColor;
                uniform vec3 uSunDir;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    float y = d.y;
                    vec3 sky = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
                    vec3 below = mix(uHorizon, uGround, clamp(-y * 3.0, 0.0, 1.0));
                    vec3 color = y >= 0.0 ? sky : below;
                    float sun = pow(max(dot(d, normalize(uSunDir)), 0.0), 24.0);
                    color += uSunColor * sun * 0.55;
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });
        scene.add(new THREE.Mesh(geo, mat));
        return scene;
    }
}
