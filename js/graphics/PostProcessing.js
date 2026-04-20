import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Wraps EffectComposer with a selective Bloom pass.
 *
 * Bloom threshold is tuned high (0.85) so only emissive highlights (taillights,
 * sparks, sun glow) bloom — the road and sky stay grounded. The pass can be
 * bypassed on low-end hardware via setEnabled(false).
 */
export class PostProcessing {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.enabled = true;

        const { width, height } = this._getSize();

        this.composer = new EffectComposer(renderer);
        this.composer.setSize(width, height);

        this.renderPass = new RenderPass(scene, camera);
        this.composer.addPass(this.renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            0.18,
            0.3,
            0.95
        );
        this.composer.addPass(this.bloomPass);

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
    }

    setCamera(camera) {
        this.camera = camera;
        this.renderPass.camera = camera;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    setBloomIntensity(strength, radius, threshold) {
        if (strength !== undefined) this.bloomPass.strength = strength;
        if (radius !== undefined) this.bloomPass.radius = radius;
        if (threshold !== undefined) this.bloomPass.threshold = threshold;
    }

    render() {
        if (this.enabled) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    setSize(width, height) {
        this.composer.setSize(width, height);
        this.bloomPass.setSize(width, height);
    }

    dispose() {
        this.composer.passes.forEach((pass) => {
            if (typeof pass.dispose === 'function') pass.dispose();
        });
    }

    _getSize() {
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        return { width: size.x, height: size.y };
    }
}
