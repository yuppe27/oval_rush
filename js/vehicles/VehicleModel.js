import * as THREE from 'three';

export class VehicleModel {
    constructor(options = {}) {
        this.group = new THREE.Group();
        this.wheels = [];
        this.taillightMat = null;
        this._braking = false;
        this.vehicleId = options.vehicleId || 'falcon';
        this.primaryColor = options.color ?? 0xcc0000;
        this.modelScale = options.modelScale ?? 1;
        this._build();
        this.group.scale.setScalar(this.modelScale);
    }

    _build() {
        const profile = this._getProfile(this.vehicleId);

        // --- Materials ---
        const bodyMat = new THREE.MeshStandardMaterial({
            color: this.primaryColor,
            roughness: 0.18,
            metalness: 0.45,
            emissive: this.primaryColor,
            emissiveIntensity: 0.12,
        });
        const accentMat = new THREE.MeshStandardMaterial({
            color: profile.accentColor,
            roughness: 0.38,
            metalness: 0.32,
            flatShading: true,
        });
        const trimMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.45,
            metalness: 0.4,
            flatShading: true,
        });
        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xd0d0d0,
            roughness: 0.12,
            metalness: 0.92,
        });
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x8ab8d8,
            roughness: 0.08,
            metalness: 0.25,
            transparent: true,
            opacity: 0.55,
        });
        const grilleMat = new THREE.MeshStandardMaterial({
            color: 0x080808,
            roughness: 0.85,
            metalness: 0.15,
        });
        const underbodyMat = new THREE.MeshStandardMaterial({
            color: 0x141414,
            roughness: 0.92,
            metalness: 0.08,
            flatShading: true,
        });

        // --- Main body ---
        // Floor / chassis (dark underbody)
        this._addMesh(new THREE.BoxGeometry(profile.floorW, profile.floorH, profile.floorL), underbodyMat, {
            y: profile.floorY,
        });
        // Side pods
        this._addMesh(new THREE.BoxGeometry(profile.sidePodW, profile.sidePodH, profile.sidePodL), accentMat, {
            x: profile.sidePodX, y: profile.sidePodY, z: profile.sidePodZ,
        });
        this._addMesh(new THREE.BoxGeometry(profile.sidePodW, profile.sidePodH, profile.sidePodL), accentMat, {
            x: -profile.sidePodX, y: profile.sidePodY, z: profile.sidePodZ,
        });
        // Main body
        this._addMesh(new THREE.BoxGeometry(profile.bodyW, profile.bodyH, profile.bodyL), bodyMat, {
            y: profile.bodyY, z: profile.bodyZ,
        });
        // Belt line
        this._addMesh(new THREE.BoxGeometry(profile.beltW, profile.beltH, profile.beltL), bodyMat, {
            y: profile.beltY, z: profile.beltZ,
        });
        // Roof
        this._addMesh(new THREE.BoxGeometry(profile.roofW, profile.roofH, profile.roofL), bodyMat, {
            y: profile.roofY, z: profile.roofZ,
        });
        // Rear deck
        this._addMesh(new THREE.BoxGeometry(profile.rearDeckW, profile.rearDeckH, profile.rearDeckL), bodyMat, {
            y: profile.rearDeckY, z: profile.rearDeckZ,
        });

        // Nose wedge
        this._addWedge(profile.noseW, profile.noseH, profile.noseL, bodyMat, {
            y: profile.noseY, z: profile.noseZ, tiltX: profile.noseTilt,
        });
        // Tail wedge
        this._addWedge(profile.tailW, profile.tailH, profile.tailL, accentMat, {
            y: profile.tailY, z: profile.tailZ, tiltX: profile.tailTilt, invert: true,
        });

        // --- Windows ---
        // Front windshield
        this._addMesh(new THREE.BoxGeometry(profile.windowW, profile.windowH, profile.windowL), glassMat, {
            y: profile.windowY, z: profile.windowZ, tiltX: profile.windowTilt,
        });
        // Rear glass
        this._addMesh(new THREE.BoxGeometry(profile.rearGlassW, profile.rearGlassH, profile.rearGlassL), glassMat, {
            y: profile.rearGlassY, z: profile.rearGlassZ, tiltX: profile.rearGlassTilt,
        });
        // Side windows
        this._addSideWindows(profile, glassMat);

        // --- Aero ---
        // Front splitter
        this._addMesh(new THREE.BoxGeometry(profile.splitterW, 0.06, profile.splitterL), trimMat, {
            y: profile.splitterY, z: profile.splitterZ,
        });
        // Rear diffuser
        this._addMesh(new THREE.BoxGeometry(profile.diffuserW, 0.08, profile.diffuserL), trimMat, {
            y: profile.diffuserY, z: profile.diffuserZ,
        });

        // --- Details ---
        this._addMirrorPair(profile, chromeMat);
        this._addFenders(profile, bodyMat, accentMat);
        this._addSpoiler(profile, trimMat, chromeMat);
        this._addExhausts(profile, chromeMat);
        this._addGrille(profile, grilleMat, chromeMat);
        this._addDoorLines(profile, trimMat);
        this._addSideSkirts(profile, trimMat);
        this._addHoodDetail(profile, bodyMat, trimMat, chromeMat);
        this._addLights(profile);
        this._addWheels(profile);
    }

    _addMesh(geometry, material, options = {}) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(options.x || 0, options.y || 0, options.z || 0);
        if (options.tiltX) mesh.rotation.x = options.tiltX;
        if (options.tiltY) mesh.rotation.y = options.tiltY;
        if (options.tiltZ) mesh.rotation.z = options.tiltZ;
        mesh.castShadow = options.castShadow ?? true;
        mesh.receiveShadow = options.receiveShadow ?? true;
        this.group.add(mesh);
        return mesh;
    }

    _createWedgeGeometry(width, height, length, invert = false) {
        const hw = width / 2;
        const hh = height / 2;
        const hl = length / 2;
        const frontTopZ = invert ? -hl : hl;
        const rearTopZ = invert ? hl : -hl;
        const positions = [
            -hw, -hh, -hl,
             hw, -hh, -hl,
             hw, -hh,  hl,
            -hw, -hh,  hl,
            -hw, -hh, rearTopZ,
             hw, -hh, rearTopZ,
             hw,  hh, frontTopZ,
            -hw,  hh, frontTopZ,
        ];
        const indices = [
            0, 1, 2, 0, 2, 3,
            4, 5, 6, 4, 6, 7,
            0, 4, 7, 0, 7, 3,
            1, 2, 6, 1, 6, 5,
            3, 2, 6, 3, 6, 7,
            0, 1, 5, 0, 5, 4,
        ];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    _addWedge(width, height, length, material, options = {}) {
        return this._addMesh(
            this._createWedgeGeometry(width, height, length, Boolean(options.invert)),
            material,
            options
        );
    }

    // --- Side windows ---
    _addSideWindows(profile, glassMat) {
        const sideH = profile.roofH * 0.65;
        const sideL = profile.roofL * 0.88;
        const sideY = profile.roofY - profile.roofH * 0.12;
        const sideZ = profile.roofZ;
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(0.03, sideH, sideL), glassMat, {
                x: side * (profile.roofW / 2 + 0.015),
                y: sideY,
                z: sideZ,
            });
        }
    }

    // --- Front grille ---
    _addGrille(profile, grilleMat, chromeMat) {
        const grilleW = profile.bodyW * 0.58;
        const grilleH = profile.bodyH * 0.32;
        const grilleZ = profile.noseZ + profile.noseL * 0.38;
        // Grille opening
        this._addMesh(new THREE.BoxGeometry(grilleW, grilleH, 0.05), grilleMat, {
            y: profile.bodyY - profile.bodyH * 0.18,
            z: grilleZ,
        });
        // Chrome surround bar
        this._addMesh(new THREE.BoxGeometry(grilleW + 0.06, 0.035, 0.06), chromeMat, {
            y: profile.bodyY + profile.bodyH * 0.01,
            z: grilleZ,
        });
        // Lower chrome bar
        this._addMesh(new THREE.BoxGeometry(grilleW * 0.7, 0.03, 0.05), chromeMat, {
            y: profile.bodyY - profile.bodyH * 0.34,
            z: grilleZ + 0.02,
        });
    }

    // --- Door panel seam lines ---
    _addDoorLines(profile, trimMat) {
        const lineH = profile.bodyH + profile.beltH * 0.4;
        const lineY = profile.bodyY + profile.bodyH * 0.08;
        for (const side of [-1, 1]) {
            // Front door seam
            this._addMesh(new THREE.BoxGeometry(0.015, lineH, 0.015), trimMat, {
                x: side * (profile.bodyW / 2 + 0.008),
                y: lineY,
                z: profile.roofZ + 0.25,
            });
            // Rear door seam
            this._addMesh(new THREE.BoxGeometry(0.015, lineH * 0.85, 0.015), trimMat, {
                x: side * (profile.bodyW / 2 + 0.008),
                y: lineY - 0.03,
                z: profile.roofZ - 0.5,
            });
        }
    }

    // --- Side skirts ---
    _addSideSkirts(profile, trimMat) {
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(0.07, 0.1, profile.floorL * 0.65), trimMat, {
                x: side * (profile.floorW / 2 + 0.015),
                y: profile.floorY + 0.03,
                z: 0,
            });
        }
    }

    // --- Hood detail (scoop / crease / vent) ---
    _addHoodDetail(profile, bodyMat, trimMat, chromeMat) {
        // Hood crease line (center ridge)
        this._addMesh(new THREE.BoxGeometry(0.04, 0.025, profile.noseL * 0.8), bodyMat, {
            y: profile.noseY + profile.noseH * 0.3,
            z: profile.noseZ - profile.noseL * 0.08,
        });

        // Vehicle-specific hood details
        if (this.vehicleId === 'falcon') {
            // Falcon: hood scoop
            this._addMesh(new THREE.BoxGeometry(0.38, 0.08, 0.52), trimMat, {
                y: profile.bodyY + profile.bodyH * 0.5 + 0.02,
                z: profile.bodyZ + profile.bodyL * 0.22,
            });
        } else if (this.vehicleId === 'bolt') {
            // Bolt: twin air vents
            for (const side of [-1, 1]) {
                this._addMesh(new THREE.BoxGeometry(0.2, 0.05, 0.36), trimMat, {
                    x: side * 0.32,
                    y: profile.bodyY + profile.bodyH * 0.5 + 0.01,
                    z: profile.bodyZ + profile.bodyL * 0.2,
                });
            }
        } else if (this.vehicleId === 'ironclad') {
            // Ironclad: power bulge
            this._addMesh(new THREE.BoxGeometry(0.72, 0.06, 0.82), bodyMat, {
                y: profile.bodyY + profile.bodyH * 0.5 + 0.02,
                z: profile.bodyZ + profile.bodyL * 0.18,
            });
            // Chrome badge
            this._addMesh(new THREE.BoxGeometry(0.14, 0.03, 0.08), chromeMat, {
                y: profile.bodyY + profile.bodyH * 0.5 + 0.06,
                z: profile.bodyZ + profile.bodyL * 0.18,
            });
        }
    }

    // --- Mirrors (chrome housing + arm) ---
    _addMirrorPair(profile, material) {
        for (const side of [-1, 1]) {
            // Mirror arm
            this._addMesh(new THREE.BoxGeometry(0.18, 0.04, 0.05), material, {
                x: side * (profile.mirrorX - 0.08),
                y: profile.mirrorY,
                z: profile.mirrorZ,
            });
            // Mirror housing
            this._addMesh(new THREE.BoxGeometry(0.07, 0.1, 0.18), material, {
                x: side * profile.mirrorX,
                y: profile.mirrorY,
                z: profile.mirrorZ,
                tiltY: side * 0.2,
            });
        }
    }

    _addFenders(profile, bodyMat, accentMat) {
        const frontMat = profile.fenderAccent ? accentMat : bodyMat;
        const rearMat = profile.rearFenderAccent ? accentMat : bodyMat;
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(profile.frontFenderW, profile.frontFenderH, profile.frontFenderL), frontMat, {
                x: side * profile.frontFenderX,
                y: profile.frontFenderY,
                z: profile.frontFenderZ,
            });
            this._addMesh(new THREE.BoxGeometry(profile.rearFenderW, profile.rearFenderH, profile.rearFenderL), rearMat, {
                x: side * profile.rearFenderX,
                y: profile.rearFenderY,
                z: profile.rearFenderZ,
            });
        }
    }

    // --- Spoiler with chrome endplates ---
    _addSpoiler(profile, material, chromeMat) {
        // Main blade
        this._addMesh(new THREE.BoxGeometry(profile.spoilerW, 0.055, profile.spoilerL), material, {
            y: profile.spoilerY, z: profile.spoilerZ,
        });
        // Lip edge (chrome strip on top)
        this._addMesh(new THREE.BoxGeometry(profile.spoilerW - 0.04, 0.02, 0.03), chromeMat, {
            y: profile.spoilerY + 0.035,
            z: profile.spoilerZ - profile.spoilerL * 0.35,
        });
        for (const side of [-1, 1]) {
            // Supports
            this._addMesh(new THREE.BoxGeometry(0.07, profile.spoilerSupportH, 0.07), material, {
                x: side * profile.spoilerSupportX,
                y: profile.spoilerSupportY,
                z: profile.spoilerZ,
            });
            // Endplates
            this._addMesh(new THREE.BoxGeometry(0.03, 0.12, profile.spoilerL + 0.04), chromeMat, {
                x: side * (profile.spoilerW / 2),
                y: profile.spoilerY,
                z: profile.spoilerZ,
            });
        }
    }

    // --- Exhaust tips (chrome, conical) ---
    _addExhausts(profile, material) {
        const pipeGeo = new THREE.CylinderGeometry(0.05, 0.075, 0.3, 8);
        for (const side of [-1, 1]) {
            const pipe = new THREE.Mesh(pipeGeo, material);
            pipe.rotation.x = Math.PI / 2;
            pipe.position.set(side * profile.exhaustX, profile.exhaustY, profile.exhaustZ);
            pipe.castShadow = true;
            this.group.add(pipe);
        }
    }

    // --- Lights (detailed multi-element design) ---
    _addLights(profile) {
        // --- Materials ---
        const housingMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.7,
            metalness: 0.3,
        });
        const reflectorMat = new THREE.MeshStandardMaterial({
            color: 0xd8d8d8,
            roughness: 0.05,
            metalness: 0.95,
        });
        const headlightCoreMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xeeeeff,
            emissiveIntensity: 1.2,
            roughness: 0.05,
            metalness: 0.0,
        });
        const drlMat = new THREE.MeshStandardMaterial({
            color: 0xd0e8ff,
            emissive: 0xc0dfff,
            emissiveIntensity: 0.9,
            roughness: 0.1,
            metalness: 0.0,
        });
        const lensMat = new THREE.MeshStandardMaterial({
            color: 0xd0e0f0,
            roughness: 0.02,
            metalness: 0.05,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
        });
        this.taillightMat = new THREE.MeshStandardMaterial({
            color: 0xff2222,
            emissive: 0xff0000,
            emissiveIntensity: 1.8,
            roughness: 0.1,
            metalness: 0.0,
        });
        const taillightMat = this.taillightMat;
        const tailLensMat = new THREE.MeshStandardMaterial({
            color: 0xaa0000,
            roughness: 0.05,
            metalness: 0.1,
            transparent: true,
            opacity: 0.5,
        });
        const tailHousingMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.6,
            metalness: 0.4,
        });
        const turnMat = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: 0xffaa00,
            emissiveIntensity: 0.6,
            roughness: 0.2,
            metalness: 0.05,
        });
        const reverseMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.3,
            roughness: 0.15,
            metalness: 0.05,
            transparent: true,
            opacity: 0.8,
        });
        const chromeTrimMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,
            roughness: 0.08,
            metalness: 0.95,
        });

        const fX = profile.lightFrontX;
        const fZ = profile.lightFrontZ;
        const fY = profile.lightY;
        const rX = profile.lightRearX;
        const rZ = profile.lightRearZ;

        for (const side of [-1, 1]) {
            // ========== HEADLIGHTS ==========

            // Headlight housing (dark bezel)
            this._addMesh(new THREE.BoxGeometry(0.36, 0.22, 0.12), housingMat, {
                x: side * fX, y: fY, z: fZ,
            });

            // Inner reflector bowl
            this._addMesh(new THREE.BoxGeometry(0.30, 0.16, 0.08), reflectorMat, {
                x: side * fX, y: fY, z: fZ + 0.01,
            });

            // Main projector (bright core)
            this._addMesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 12), headlightCoreMat, {
                x: side * (fX - 0.03), y: fY + 0.01, z: fZ + 0.08,
                tiltX: Math.PI / 2,
            });

            // Secondary projector (inner)
            this._addMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 10), headlightCoreMat, {
                x: side * (fX + 0.08), y: fY + 0.01, z: fZ + 0.08,
                tiltX: Math.PI / 2,
            });

            // Projector ring (chrome)
            this._addMesh(new THREE.TorusGeometry(0.06, 0.008, 8, 16), chromeTrimMat, {
                x: side * (fX - 0.03), y: fY + 0.01, z: fZ + 0.09,
            });

            // DRL strip (L-shaped: horizontal bar under headlight)
            this._addMesh(new THREE.BoxGeometry(0.28, 0.025, 0.04), drlMat, {
                x: side * fX, y: fY - 0.085, z: fZ + 0.08,
            });
            // DRL strip vertical segment (outer edge)
            this._addMesh(new THREE.BoxGeometry(0.025, 0.12, 0.04), drlMat, {
                x: side * (fX + side * 0.14), y: fY - 0.02, z: fZ + 0.08,
            });

            // Lens cover (transparent, slightly protruding)
            this._addMesh(new THREE.BoxGeometry(0.34, 0.20, 0.02), lensMat, {
                x: side * fX, y: fY, z: fZ + 0.06,
            });

            // Chrome trim surround
            // Top edge
            this._addMesh(new THREE.BoxGeometry(0.36, 0.015, 0.04), chromeTrimMat, {
                x: side * fX, y: fY + 0.11, z: fZ + 0.04,
            });
            // Bottom edge
            this._addMesh(new THREE.BoxGeometry(0.36, 0.015, 0.04), chromeTrimMat, {
                x: side * fX, y: fY - 0.11, z: fZ + 0.04,
            });

            // Front turn signal (amber, below headlight)
            this._addMesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), turnMat, {
                x: side * (fX + side * 0.1),
                y: fY - 0.14,
                z: fZ + 0.02,
            });

            // ========== TAILLIGHTS ==========
            // Push taillights to protrude beyond the body rear surface
            const tZ = rZ - 0.18;

            // Taillight housing (dark surround)
            this._addMesh(new THREE.BoxGeometry(0.42, 0.22, 0.14), tailHousingMat, {
                x: side * rX, y: fY, z: tZ,
            });

            // Inner reflector
            this._addMesh(new THREE.BoxGeometry(0.38, 0.18, 0.06), reflectorMat, {
                x: side * rX, y: fY, z: tZ - 0.02,
            });

            // LED bar segments (3 horizontal strips, large and bright)
            for (let i = 0; i < 3; i++) {
                const segY = fY + 0.05 - i * 0.05;
                const segW = 0.34 - i * 0.02;
                this._addMesh(new THREE.BoxGeometry(segW, 0.032, 0.08), taillightMat, {
                    x: side * rX, y: segY, z: tZ - 0.04,
                });
            }

            // Inner accent strip (bright center line)
            this._addMesh(new THREE.BoxGeometry(0.30, 0.018, 0.08), taillightMat, {
                x: side * rX, y: fY, z: tZ - 0.04,
            });

            // Tail lens cover (red tinted, transparent)
            this._addMesh(new THREE.BoxGeometry(0.40, 0.20, 0.02), tailLensMat, {
                x: side * rX, y: fY, z: tZ - 0.08,
            });

            // Chrome trim surround
            // Top
            this._addMesh(new THREE.BoxGeometry(0.44, 0.014, 0.04), chromeTrimMat, {
                x: side * rX, y: fY + 0.11, z: tZ - 0.06,
            });
            // Bottom
            this._addMesh(new THREE.BoxGeometry(0.44, 0.014, 0.04), chromeTrimMat, {
                x: side * rX, y: fY - 0.11, z: tZ - 0.06,
            });
            // Outer vertical edge
            this._addMesh(new THREE.BoxGeometry(0.014, 0.22, 0.04), chromeTrimMat, {
                x: side * (rX + side * 0.22),
                y: fY, z: tZ - 0.06,
            });
            // Inner vertical edge
            this._addMesh(new THREE.BoxGeometry(0.014, 0.22, 0.04), chromeTrimMat, {
                x: side * (rX - side * 0.22),
                y: fY, z: tZ - 0.06,
            });

            // Reverse light (small white, bottom outer corner)
            this._addMesh(new THREE.BoxGeometry(0.08, 0.045, 0.05), reverseMat, {
                x: side * (rX + side * 0.14),
                y: fY - 0.14,
                z: tZ - 0.05,
            });

            // Rear turn signal (amber, below taillight)
            this._addMesh(new THREE.BoxGeometry(0.10, 0.04, 0.05), turnMat, {
                x: side * (rX - side * 0.08),
                y: fY - 0.14,
                z: tZ - 0.05,
            });
        }

    }

    // --- Wheels (detailed with spokes, hub, brake disc) ---
    _addWheels(profile) {
        const tireMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.88,
            metalness: 0.08,
        });
        const sidewallMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.75,
            metalness: 0.12,
        });
        const rimMat = new THREE.MeshStandardMaterial({
            color: 0xc0c8d0,
            roughness: 0.18,
            metalness: 0.88,
        });
        const hubMat = new THREE.MeshStandardMaterial({
            color: 0x999999,
            roughness: 0.25,
            metalness: 0.8,
        });
        const brakeMat = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.55,
            metalness: 0.45,
        });

        const R = profile.wheelR;
        const T = profile.wheelT;
        // Rounder tire with more segments
        const tireGeo = new THREE.CylinderGeometry(R, R, T, 20);
        // Sidewall ring (slightly wider profile)
        const sidewallGeo = new THREE.CylinderGeometry(R + 0.005, R - 0.025, T - 0.06, 20);
        // Rim disc
        const rimGeo = new THREE.CylinderGeometry(R * 0.8, R * 0.8, T * 0.28, 14);
        // Hub cap
        const hubGeo = new THREE.CylinderGeometry(R * 0.18, R * 0.18, T * 0.32, 10);
        // Brake disc
        const brakeGeo = new THREE.CylinderGeometry(R * 0.58, R * 0.58, T * 0.07, 14);
        // Spoke geometry: Y is the radial (long) direction
        const spokeGeo = new THREE.BoxGeometry(T * 0.2, R * 0.55, R * 0.11);

        const wheelPositions = [
            { x: -profile.wheelX, y: profile.wheelY, z: profile.wheelFrontZ },
            { x: profile.wheelX, y: profile.wheelY, z: profile.wheelFrontZ },
            { x: -profile.wheelX, y: profile.wheelY, z: profile.wheelRearZ },
            { x: profile.wheelX, y: profile.wheelY, z: profile.wheelRearZ },
        ];

        for (const pos of wheelPositions) {
            const pivot = new THREE.Group();
            pivot.position.set(pos.x, pos.y, pos.z);

            // Tire
            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.rotation.z = Math.PI / 2;
            tire.castShadow = true;
            pivot.add(tire);

            // Sidewall detail
            const sidewall = new THREE.Mesh(sidewallGeo, sidewallMat);
            sidewall.rotation.z = Math.PI / 2;
            pivot.add(sidewall);

            // Rim disc
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.rotation.z = Math.PI / 2;
            pivot.add(rim);

            // Hub center
            const hub = new THREE.Mesh(hubGeo, hubMat);
            hub.rotation.z = Math.PI / 2;
            pivot.add(hub);

            // 5 spokes radiating from center
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const dist = R * 0.28;
                const spoke = new THREE.Mesh(spokeGeo, rimMat);
                spoke.position.set(0, Math.cos(angle) * dist, Math.sin(angle) * dist);
                spoke.rotation.x = angle;
                pivot.add(spoke);
            }

            // Brake disc (visible behind spokes)
            const brake = new THREE.Mesh(brakeGeo, brakeMat);
            brake.rotation.z = Math.PI / 2;
            pivot.add(brake);

            this.group.add(pivot);
            this.wheels.push(pivot);
        }
    }

    _getProfile(vehicleId) {
        switch (vehicleId) {
            case 'bolt':
                return {
                    accentColor: 0x222200,
                    floorW: 2.08, floorH: 0.22, floorL: 4.7, floorY: 0.25,
                    sidePodW: 0.32, sidePodH: 0.22, sidePodL: 2.1, sidePodX: 1.0, sidePodY: 0.36, sidePodZ: 0.1,
                    bodyW: 1.98, bodyH: 0.48, bodyL: 3.62, bodyY: 0.52, bodyZ: -0.02,
                    beltW: 1.76, beltH: 0.16, beltL: 2.72, beltY: 0.78, beltZ: -0.1,
                    roofW: 1.52, roofH: 0.38, roofL: 1.95, roofY: 1.04, roofZ: -0.18,
                    rearDeckW: 1.84, rearDeckH: 0.22, rearDeckL: 0.92, rearDeckY: 0.88, rearDeckZ: -1.62,
                    noseW: 1.84, noseH: 0.5, noseL: 1.18, noseY: 0.54, noseZ: 2.02, noseTilt: -0.06,
                    tailW: 1.9, tailH: 0.42, tailL: 0.94, tailY: 0.8, tailZ: -2.05, tailTilt: 0.04,
                    windowW: 1.36, windowH: 0.24, windowL: 0.98, windowY: 1.06, windowZ: 0.72, windowTilt: -0.34,
                    rearGlassW: 1.3, rearGlassH: 0.22, rearGlassL: 0.8, rearGlassY: 1.0, rearGlassZ: -0.7, rearGlassTilt: 0.26,
                    splitterW: 1.98, splitterL: 0.48, splitterY: 0.12, splitterZ: 2.36,
                    diffuserW: 1.78, diffuserL: 0.38, diffuserY: 0.14, diffuserZ: -2.34,
                    mirrorX: 0.96, mirrorY: 0.95, mirrorZ: 0.44,
                    frontFenderW: 0.42, frontFenderH: 0.3, frontFenderL: 0.82, frontFenderX: 1.02, frontFenderY: 0.55, frontFenderZ: 1.22,
                    rearFenderW: 0.48, rearFenderH: 0.34, rearFenderL: 0.92, rearFenderX: 1.04, rearFenderY: 0.58, rearFenderZ: -1.28,
                    fenderAccent: true, rearFenderAccent: true,
                    spoilerW: 1.96, spoilerL: 0.34, spoilerY: 1.16, spoilerZ: -2.16,
                    spoilerSupportX: 0.78, spoilerSupportY: 0.98, spoilerSupportH: 0.32,
                    exhaustX: 0.34, exhaustY: 0.34, exhaustZ: -2.38,
                    wheelR: 0.3, wheelT: 0.28, wheelX: 1.04, wheelY: 0.3,
                    wheelFrontZ: 1.36, wheelRearZ: -1.42,
                    lightY: 0.5, lightFrontX: 0.72, lightFrontZ: 2.67, lightRearX: 0.68, lightRearZ: -2.28,
                };
            case 'ironclad':
                return {
                    accentColor: 0x004433,
                    floorW: 2.2, floorH: 0.25, floorL: 4.45, floorY: 0.27,
                    sidePodW: 0.38, sidePodH: 0.28, sidePodL: 2.32, sidePodX: 1.04, sidePodY: 0.4, sidePodZ: -0.02,
                    bodyW: 2.08, bodyH: 0.6, bodyL: 3.35, bodyY: 0.58, bodyZ: -0.1,
                    beltW: 1.94, beltH: 0.2, beltL: 2.76, beltY: 0.88, beltZ: -0.18,
                    roofW: 1.78, roofH: 0.52, roofL: 2.16, roofY: 1.14, roofZ: -0.3,
                    rearDeckW: 1.96, rearDeckH: 0.28, rearDeckL: 1.0, rearDeckY: 1.0, rearDeckZ: -1.56,
                    noseW: 2.0, noseH: 0.62, noseL: 1.0, noseY: 0.58, noseZ: 1.84, noseTilt: -0.03,
                    tailW: 1.98, tailH: 0.46, tailL: 0.82, tailY: 0.92, tailZ: -2.0, tailTilt: 0.02,
                    windowW: 1.55, windowH: 0.3, windowL: 1.02, windowY: 1.14, windowZ: 0.56, windowTilt: -0.22,
                    rearGlassW: 1.52, rearGlassH: 0.24, rearGlassL: 0.84, rearGlassY: 1.08, rearGlassZ: -0.78, rearGlassTilt: 0.18,
                    splitterW: 2.04, splitterL: 0.42, splitterY: 0.12, splitterZ: 2.14,
                    diffuserW: 1.92, diffuserL: 0.36, diffuserY: 0.14, diffuserZ: -2.18,
                    mirrorX: 1.02, mirrorY: 1.04, mirrorZ: 0.32,
                    frontFenderW: 0.5, frontFenderH: 0.38, frontFenderL: 0.78, frontFenderX: 1.06, frontFenderY: 0.62, frontFenderZ: 1.1,
                    rearFenderW: 0.54, rearFenderH: 0.44, rearFenderL: 0.96, rearFenderX: 1.08, rearFenderY: 0.68, rearFenderZ: -1.18,
                    fenderAccent: false, rearFenderAccent: false,
                    spoilerW: 1.72, spoilerL: 0.26, spoilerY: 1.22, spoilerZ: -1.96,
                    spoilerSupportX: 0.66, spoilerSupportY: 1.06, spoilerSupportH: 0.28,
                    exhaustX: 0.38, exhaustY: 0.38, exhaustZ: -2.24,
                    wheelR: 0.34, wheelT: 0.3, wheelX: 1.08, wheelY: 0.33,
                    wheelFrontZ: 1.24, wheelRearZ: -1.24,
                    lightY: 0.58, lightFrontX: 0.76, lightFrontZ: 2.40, lightRearX: 0.72, lightRearZ: -2.0,
                };
            default:
                return {
                    accentColor: 0x330022,
                    floorW: 2.06, floorH: 0.22, floorL: 4.48, floorY: 0.25,
                    sidePodW: 0.3, sidePodH: 0.22, sidePodL: 2.04, sidePodX: 0.98, sidePodY: 0.37, sidePodZ: 0.04,
                    bodyW: 1.98, bodyH: 0.52, bodyL: 3.48, bodyY: 0.53, bodyZ: -0.06,
                    beltW: 1.8, beltH: 0.16, beltL: 2.74, beltY: 0.8, beltZ: -0.14,
                    roofW: 1.62, roofH: 0.44, roofL: 2.08, roofY: 1.02, roofZ: -0.18,
                    rearDeckW: 1.88, rearDeckH: 0.22, rearDeckL: 0.88, rearDeckY: 0.92, rearDeckZ: -1.52,
                    noseW: 1.9, noseH: 0.54, noseL: 1.08, noseY: 0.55, noseZ: 1.94, noseTilt: -0.05,
                    tailW: 1.9, tailH: 0.42, tailL: 0.86, tailY: 0.84, tailZ: -1.98, tailTilt: 0.03,
                    windowW: 1.42, windowH: 0.26, windowL: 1.02, windowY: 1.03, windowZ: 0.64, windowTilt: -0.28,
                    rearGlassW: 1.36, rearGlassH: 0.22, rearGlassL: 0.82, rearGlassY: 0.98, rearGlassZ: -0.74, rearGlassTilt: 0.22,
                    splitterW: 1.96, splitterL: 0.44, splitterY: 0.12, splitterZ: 2.2,
                    diffuserW: 1.82, diffuserL: 0.36, diffuserY: 0.14, diffuserZ: -2.18,
                    mirrorX: 0.94, mirrorY: 0.97, mirrorZ: 0.38,
                    frontFenderW: 0.4, frontFenderH: 0.32, frontFenderL: 0.8, frontFenderX: 1.0, frontFenderY: 0.58, frontFenderZ: 1.18,
                    rearFenderW: 0.46, rearFenderH: 0.36, rearFenderL: 0.9, rearFenderX: 1.02, rearFenderY: 0.6, rearFenderZ: -1.22,
                    fenderAccent: false, rearFenderAccent: true,
                    spoilerW: 1.82, spoilerL: 0.3, spoilerY: 1.16, spoilerZ: -2.02,
                    spoilerSupportX: 0.7, spoilerSupportY: 0.99, spoilerSupportH: 0.3,
                    exhaustX: 0.34, exhaustY: 0.34, exhaustZ: -2.24,
                    wheelR: 0.31, wheelT: 0.27, wheelX: 1.01, wheelY: 0.31,
                    wheelFrontZ: 1.3, wheelRearZ: -1.32,
                    lightY: 0.54, lightFrontX: 0.72, lightFrontZ: 2.54, lightRearX: 0.68, lightRearZ: -2.12,
                };
        }
    }

    setBraking(active) {
        if (this._braking === active) return;
        this._braking = active;
        if (this.taillightMat) {
            this.taillightMat.emissiveIntensity = active ? 3.5 : 1.8;
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
