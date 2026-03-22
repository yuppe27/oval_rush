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
        // Front splitter (NASCAR: wide, thick, extends beyond nose)
        this._addMesh(new THREE.BoxGeometry(profile.splitterW, 0.04, profile.splitterL), trimMat, {
            y: profile.splitterY, z: profile.splitterZ,
        });
        // Splitter endplates (vertical fins at splitter edges)
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(0.04, 0.12, profile.splitterL * 0.6), trimMat, {
                x: side * (profile.splitterW / 2),
                y: profile.splitterY + 0.04,
                z: profile.splitterZ - profile.splitterL * 0.1,
            });
        }
        // Rear diffuser (flat panel under rear)
        this._addMesh(new THREE.BoxGeometry(profile.diffuserW, 0.06, profile.diffuserL), trimMat, {
            y: profile.diffuserY, z: profile.diffuserZ,
        });

        // --- Structure ---
        this._addPillars(profile, bodyMat);
        this._addBumpers(profile, bodyMat, trimMat, chromeMat);
        this._addWheelArches(profile, bodyMat);

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

    // --- A/B/C pillars (NASCAR: strong pillars bridging wide body to narrow roof) ---
    _addPillars(profile, bodyMat) {
        const pillarW = 0.14;
        // Pillars start at belt line and go up to roof, but also flare outward
        const beltTop = profile.beltY + profile.beltH / 2;
        const roofBottom = profile.roofY - profile.roofH / 2;
        const pillarH = Math.max(0.18, roofBottom - beltTop + profile.roofH * 0.35);
        const pillarCenterY = beltTop + pillarH * 0.5;
        // Outer edge aligned with body, inner with roof
        const pillarX = (profile.roofW / 2 + profile.bodyW / 2) * 0.5;

        // A-pillar (steep windshield angle, wide base)
        const aPillarZ = profile.windowZ + profile.windowL * 0.28;
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(pillarW, pillarH, 0.14), bodyMat, {
                x: side * pillarX,
                y: pillarCenterY,
                z: aPillarZ,
                tiltX: profile.windowTilt * 0.50,
            });
        }
        // B-pillar (strong center post)
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(pillarW, pillarH * 0.90, 0.10), bodyMat, {
                x: side * pillarX,
                y: pillarCenterY - pillarH * 0.02,
                z: profile.roofZ + 0.04,
            });
        }
        // C-pillar (wide, wrapping rear for stock car look)
        const cPillarZ = profile.rearGlassZ - profile.rearGlassL * 0.15;
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(pillarW + 0.06, pillarH * 0.88, 0.22), bodyMat, {
                x: side * pillarX,
                y: pillarCenterY - pillarH * 0.03,
                z: cPillarZ,
                tiltX: profile.rearGlassTilt * 0.40,
            });
        }
        // Roof-to-body transition filler (covers the gap between narrow roof and wide body)
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(
                (profile.bodyW - profile.roofW) / 2 + 0.06,
                0.06,
                profile.roofL * 0.85
            ), bodyMat, {
                x: side * ((profile.roofW + profile.bodyW) / 4),
                y: beltTop + 0.02,
                z: profile.roofZ,
            });
        }
    }

    // --- Bumpers (NASCAR: body-integrated, no chrome bumpers) ---
    _addBumpers(profile, bodyMat, trimMat, chromeMat) {
        const tailEnd = profile.tailZ - profile.tailL * 0.42;
        const noseBottom = profile.noseY - profile.noseH / 2;
        const floorTop = profile.floorY + profile.floorH / 2;
        const frontBumperH = Math.max(0.08, noseBottom - floorTop + 0.06);
        const frontBumperY = floorTop + frontBumperH / 2;

        // Hood panel: long flat surface from body to nose tip
        const bodyTop = profile.bodyY + profile.bodyH / 2;
        const hoodStart = profile.bodyZ + profile.bodyL / 2 - 0.12;
        const hoodEnd = profile.noseZ + profile.noseL * 0.40;
        const hoodLength = hoodEnd - hoodStart;
        const hoodZ = hoodStart + hoodLength / 2;
        this._addMesh(
            new THREE.BoxGeometry(profile.noseW * 0.94, 0.05, hoodLength),
            bodyMat,
            {
                y: bodyTop + 0.01,
                z: hoodZ,
                tiltX: -0.03,
            }
        );

        // Front fascia (body-color, flush with nose)
        const fasciaH = profile.noseH * 0.35;
        this._addMesh(
            new THREE.BoxGeometry(profile.bodyW * 0.92, fasciaH, profile.noseL * 0.55),
            bodyMat,
            {
                y: noseBottom + fasciaH * 0.3,
                z: profile.noseZ + profile.noseL * 0.18,
            }
        );
        // Front bumper cover (body-color, stock car style)
        this._addMesh(new THREE.BoxGeometry(profile.bodyW * 0.96, frontBumperH, 0.10), bodyMat, {
            y: frontBumperY,
            z: profile.noseZ + profile.noseL * 0.42,
        });
        // Front lower valance (dark, aggressive)
        this._addMesh(new THREE.BoxGeometry(profile.bodyW * 0.90, 0.06, 0.14), trimMat, {
            y: floorTop + 0.02,
            z: profile.noseZ + profile.noseL * 0.36,
        });
        // Rear bumper cover (body-color, flat panel)
        const rearBumperY = floorTop + 0.10;
        this._addMesh(new THREE.BoxGeometry(profile.bodyW * 0.94, 0.16, 0.10), bodyMat, {
            y: rearBumperY,
            z: tailEnd,
        });
        // Rear valance (dark lower panel)
        this._addMesh(new THREE.BoxGeometry(profile.bodyW * 0.88, 0.06, 0.12), trimMat, {
            y: floorTop + 0.02,
            z: tailEnd + 0.04,
        });
    }

    // --- Wheel arch trim (3-piece: top + front lip + rear lip) ---
    _addWheelArches(profile, bodyMat) {
        const R = profile.wheelR;
        const T = profile.wheelT;
        const archThick = 0.10;
        const archDepth = T + 0.18;
        const topY = profile.wheelY + R + 0.02;
        const positions = [
            { x: profile.wheelX, z: profile.wheelFrontZ },
            { x: -profile.wheelX, z: profile.wheelFrontZ },
            { x: profile.wheelX, z: profile.wheelRearZ },
            { x: -profile.wheelX, z: profile.wheelRearZ },
        ];
        for (const pos of positions) {
            // Top arch
            this._addMesh(new THREE.BoxGeometry(archThick, 0.07, archDepth), bodyMat, {
                x: pos.x,
                y: topY,
                z: pos.z,
            });
            // Front lip (vertical, wrapping forward)
            this._addMesh(new THREE.BoxGeometry(archThick, R * 0.5, 0.06), bodyMat, {
                x: pos.x,
                y: topY - R * 0.22,
                z: pos.z + archDepth * 0.45,
            });
            // Rear lip (vertical, wrapping rearward)
            this._addMesh(new THREE.BoxGeometry(archThick, R * 0.5, 0.06), bodyMat, {
                x: pos.x,
                y: topY - R * 0.22,
                z: pos.z - archDepth * 0.45,
            });
        }
    }

    // --- Front grille (NASCAR: wide air intake opening) ---
    _addGrille(profile, grilleMat, chromeMat) {
        const grilleW = profile.bodyW * 0.72;
        const grilleH = profile.bodyH * 0.42;
        const grilleZ = profile.noseZ + profile.noseL * 0.42;
        // Wide grille opening
        this._addMesh(new THREE.BoxGeometry(grilleW, grilleH, 0.05), grilleMat, {
            y: profile.bodyY - profile.bodyH * 0.12,
            z: grilleZ,
        });
        // Upper grille bar (body color frame, not chrome)
        this._addMesh(new THREE.BoxGeometry(grilleW + 0.04, 0.03, 0.05), chromeMat, {
            y: profile.bodyY + profile.bodyH * 0.10,
            z: grilleZ,
        });
    }

    // --- Door panel seam lines (NASCAR: single door line per side) ---
    _addDoorLines(profile, trimMat) {
        const lineH = profile.bodyH + profile.beltH * 0.5;
        const lineY = profile.bodyY + profile.bodyH * 0.06;
        for (const side of [-1, 1]) {
            // Single door seam (stock car: one door panel)
            this._addMesh(new THREE.BoxGeometry(0.012, lineH, 0.012), trimMat, {
                x: side * (profile.bodyW / 2 + 0.006),
                y: lineY,
                z: profile.roofZ + 0.10,
            });
            // Rear quarter panel seam
            this._addMesh(new THREE.BoxGeometry(0.012, lineH * 0.80, 0.012), trimMat, {
                x: side * (profile.bodyW / 2 + 0.006),
                y: lineY - 0.02,
                z: profile.roofZ - 0.60,
            });
        }
    }

    // --- Side skirts (NASCAR: full-length, flush to ground) ---
    _addSideSkirts(profile, trimMat) {
        const skirtL = profile.floorL * 0.82;
        for (const side of [-1, 1]) {
            // Main skirt panel
            this._addMesh(new THREE.BoxGeometry(0.08, 0.14, skirtL), trimMat, {
                x: side * (profile.bodyW / 2 + 0.02),
                y: profile.floorY + 0.05,
                z: -0.1,
            });
            // Lower lip (extends slightly outward)
            this._addMesh(new THREE.BoxGeometry(0.12, 0.03, skirtL * 0.9), trimMat, {
                x: side * (profile.bodyW / 2 + 0.04),
                y: profile.floorY - 0.02,
                z: -0.1,
            });
        }
    }

    // --- Hood detail (NASCAR: long flat hood with subtle details) ---
    _addHoodDetail(profile, bodyMat, trimMat, chromeMat) {
        // Twin hood creases (NASCAR style parallel lines)
        for (const side of [-1, 1]) {
            this._addMesh(new THREE.BoxGeometry(0.03, 0.02, profile.noseL * 0.9), bodyMat, {
                x: side * 0.28,
                y: profile.noseY + profile.noseH * 0.35,
                z: profile.noseZ - profile.noseL * 0.02,
            });
        }

        // Vehicle-specific hood accents
        if (this.vehicleId === 'falcon') {
            // Falcon: center hood vent
            this._addMesh(new THREE.BoxGeometry(0.30, 0.05, 0.40), trimMat, {
                y: profile.bodyY + profile.bodyH * 0.5 + 0.01,
                z: profile.bodyZ + profile.bodyL * 0.24,
            });
        } else if (this.vehicleId === 'bolt') {
            // Bolt: twin NACA ducts
            for (const side of [-1, 1]) {
                this._addMesh(new THREE.BoxGeometry(0.16, 0.04, 0.30), trimMat, {
                    x: side * 0.34,
                    y: profile.bodyY + profile.bodyH * 0.5 + 0.01,
                    z: profile.bodyZ + profile.bodyL * 0.22,
                });
            }
        } else if (this.vehicleId === 'ironclad') {
            // Ironclad: wide power bulge
            this._addMesh(new THREE.BoxGeometry(0.60, 0.05, 0.70), bodyMat, {
                y: profile.bodyY + profile.bodyH * 0.5 + 0.02,
                z: profile.bodyZ + profile.bodyL * 0.20,
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

    // --- Spoiler (NASCAR: large blade with tall vertical supports) ---
    _addSpoiler(profile, material, chromeMat) {
        // Main blade (wide, tall)
        this._addMesh(new THREE.BoxGeometry(profile.spoilerW, 0.07, profile.spoilerL), material, {
            y: profile.spoilerY, z: profile.spoilerZ,
        });
        // Blade upper edge strip
        this._addMesh(new THREE.BoxGeometry(profile.spoilerW - 0.02, 0.025, 0.04), chromeMat, {
            y: profile.spoilerY + 0.045,
            z: profile.spoilerZ - profile.spoilerL * 0.38,
        });
        // Blade lip (slight angle for downforce look)
        this._addMesh(new THREE.BoxGeometry(profile.spoilerW, 0.20, 0.04), material, {
            y: profile.spoilerY + 0.13,
            z: profile.spoilerZ - profile.spoilerL * 0.42,
            tiltX: 0.18,
        });
        for (const side of [-1, 1]) {
            // Tall vertical supports (NASCAR style)
            this._addMesh(new THREE.BoxGeometry(0.08, profile.spoilerSupportH, 0.10), material, {
                x: side * profile.spoilerSupportX,
                y: profile.spoilerSupportY,
                z: profile.spoilerZ,
            });
            // Large endplates (taller than before)
            this._addMesh(new THREE.BoxGeometry(0.03, 0.28, profile.spoilerL + 0.08), material, {
                x: side * (profile.spoilerW / 2 + 0.01),
                y: profile.spoilerY + 0.04,
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
        // NASCAR stock car inspired profiles — low, wide, aggressive
        switch (vehicleId) {
            case 'bolt':
                // Bolt: lightweight stock car, slightly narrower / lower
                return {
                    accentColor: 0x222200,
                    // Flat floor / chassis
                    floorW: 2.14, floorH: 0.10, floorL: 5.2, floorY: 0.18,
                    // Side pods: subtle body extensions near doors
                    sidePodW: 0.18, sidePodH: 0.18, sidePodL: 2.6, sidePodX: 1.08, sidePodY: 0.32, sidePodZ: -0.1,
                    // Main body: wide, low slab
                    bodyW: 2.10, bodyH: 0.38, bodyL: 4.0, bodyY: 0.42, bodyZ: -0.06,
                    // Belt line: shoulder crease
                    beltW: 2.04, beltH: 0.10, beltL: 3.4, beltY: 0.64, beltZ: -0.12,
                    // Roof: narrow greenhouse, very low
                    roofW: 1.32, roofH: 0.30, roofL: 1.6, roofY: 0.88, roofZ: -0.30,
                    // Rear deck: short trunk lid
                    rearDeckW: 2.00, rearDeckH: 0.14, rearDeckL: 0.80, rearDeckY: 0.72, rearDeckZ: -1.80,
                    // Nose: long, low slope
                    noseW: 2.04, noseH: 0.36, noseL: 1.50, noseY: 0.42, noseZ: 2.30, noseTilt: -0.10,
                    // Tail: short, steep rise
                    tailW: 2.06, tailH: 0.30, tailL: 0.70, tailY: 0.68, tailZ: -2.20, tailTilt: 0.06,
                    // Windows: steep windshield
                    windowW: 1.18, windowH: 0.22, windowL: 0.70, windowY: 0.90, windowZ: 0.58, windowTilt: -0.42,
                    rearGlassW: 1.14, rearGlassH: 0.18, rearGlassL: 0.60, rearGlassY: 0.86, rearGlassZ: -0.82, rearGlassTilt: 0.32,
                    // Aero: wide splitter, diffuser
                    splitterW: 2.24, splitterL: 0.60, splitterY: 0.10, splitterZ: 2.72,
                    diffuserW: 2.10, diffuserL: 0.44, diffuserY: 0.10, diffuserZ: -2.56,
                    // Mirrors
                    mirrorX: 0.80, mirrorY: 0.84, mirrorZ: 0.34,
                    // Fenders: wide, bulging over wheels
                    frontFenderW: 0.52, frontFenderH: 0.28, frontFenderL: 1.00, frontFenderX: 1.10, frontFenderY: 0.46, frontFenderZ: 1.40,
                    rearFenderW: 0.56, rearFenderH: 0.32, rearFenderL: 1.10, rearFenderX: 1.12, rearFenderY: 0.48, rearFenderZ: -1.44,
                    fenderAccent: true, rearFenderAccent: true,
                    // Spoiler: large NASCAR blade
                    spoilerW: 2.10, spoilerL: 0.42, spoilerY: 1.08, spoilerZ: -2.34,
                    spoilerSupportX: 0.82, spoilerSupportY: 0.86, spoilerSupportH: 0.40,
                    // Exhaust
                    exhaustX: 0.34, exhaustY: 0.24, exhaustZ: -2.60,
                    // Wheels: lower, wider track
                    wheelR: 0.30, wheelT: 0.30, wheelX: 1.08, wheelY: 0.28,
                    wheelFrontZ: 1.50, wheelRearZ: -1.56,
                    // Lights
                    lightY: 0.40, lightFrontX: 0.74, lightFrontZ: 3.02, lightRearX: 0.72, lightRearZ: -2.44,
                };
            case 'ironclad':
                // Ironclad: heaviest stock car, widest/most muscular
                return {
                    accentColor: 0x004433,
                    floorW: 2.28, floorH: 0.12, floorL: 5.1, floorY: 0.20,
                    sidePodW: 0.22, sidePodH: 0.22, sidePodL: 2.8, sidePodX: 1.14, sidePodY: 0.36, sidePodZ: -0.08,
                    bodyW: 2.22, bodyH: 0.44, bodyL: 3.8, bodyY: 0.46, bodyZ: -0.10,
                    beltW: 2.16, beltH: 0.12, beltL: 3.2, beltY: 0.70, beltZ: -0.16,
                    roofW: 1.42, roofH: 0.34, roofL: 1.70, roofY: 0.92, roofZ: -0.34,
                    rearDeckW: 2.14, rearDeckH: 0.16, rearDeckL: 0.86, rearDeckY: 0.78, rearDeckZ: -1.76,
                    noseW: 2.18, noseH: 0.42, noseL: 1.40, noseY: 0.46, noseZ: 2.20, noseTilt: -0.08,
                    tailW: 2.18, tailH: 0.34, tailL: 0.72, tailY: 0.74, tailZ: -2.16, tailTilt: 0.05,
                    windowW: 1.28, windowH: 0.24, windowL: 0.74, windowY: 0.96, windowZ: 0.50, windowTilt: -0.38,
                    rearGlassW: 1.24, rearGlassH: 0.20, rearGlassL: 0.64, rearGlassY: 0.90, rearGlassZ: -0.86, rearGlassTilt: 0.28,
                    splitterW: 2.36, splitterL: 0.58, splitterY: 0.10, splitterZ: 2.58,
                    diffuserW: 2.20, diffuserL: 0.46, diffuserY: 0.10, diffuserZ: -2.48,
                    mirrorX: 0.84, mirrorY: 0.88, mirrorZ: 0.28,
                    frontFenderW: 0.58, frontFenderH: 0.34, frontFenderL: 1.04, frontFenderX: 1.16, frontFenderY: 0.50, frontFenderZ: 1.34,
                    rearFenderW: 0.62, rearFenderH: 0.38, rearFenderL: 1.14, rearFenderX: 1.18, rearFenderY: 0.54, rearFenderZ: -1.38,
                    fenderAccent: false, rearFenderAccent: false,
                    spoilerW: 2.20, spoilerL: 0.44, spoilerY: 1.14, spoilerZ: -2.28,
                    spoilerSupportX: 0.86, spoilerSupportY: 0.90, spoilerSupportH: 0.44,
                    exhaustX: 0.40, exhaustY: 0.26, exhaustZ: -2.54,
                    wheelR: 0.34, wheelT: 0.32, wheelX: 1.14, wheelY: 0.32,
                    wheelFrontZ: 1.44, wheelRearZ: -1.48,
                    lightY: 0.44, lightFrontX: 0.80, lightFrontZ: 2.86, lightRearX: 0.76, lightRearZ: -2.36,
                };
            default:
                // Falcon (default): balanced NASCAR stock car
                return {
                    accentColor: 0x330022,
                    floorW: 2.20, floorH: 0.10, floorL: 5.16, floorY: 0.18,
                    sidePodW: 0.20, sidePodH: 0.20, sidePodL: 2.7, sidePodX: 1.10, sidePodY: 0.34, sidePodZ: -0.06,
                    bodyW: 2.16, bodyH: 0.40, bodyL: 3.9, bodyY: 0.44, bodyZ: -0.08,
                    beltW: 2.10, beltH: 0.10, beltL: 3.3, beltY: 0.66, beltZ: -0.14,
                    roofW: 1.36, roofH: 0.32, roofL: 1.64, roofY: 0.90, roofZ: -0.32,
                    rearDeckW: 2.06, rearDeckH: 0.14, rearDeckL: 0.82, rearDeckY: 0.74, rearDeckZ: -1.78,
                    noseW: 2.10, noseH: 0.38, noseL: 1.46, noseY: 0.44, noseZ: 2.26, noseTilt: -0.09,
                    tailW: 2.12, tailH: 0.32, tailL: 0.70, tailY: 0.70, tailZ: -2.18, tailTilt: 0.05,
                    windowW: 1.22, windowH: 0.22, windowL: 0.72, windowY: 0.92, windowZ: 0.54, windowTilt: -0.40,
                    rearGlassW: 1.18, rearGlassH: 0.18, rearGlassL: 0.62, rearGlassY: 0.88, rearGlassZ: -0.84, rearGlassTilt: 0.30,
                    splitterW: 2.30, splitterL: 0.58, splitterY: 0.10, splitterZ: 2.66,
                    diffuserW: 2.14, diffuserL: 0.44, diffuserY: 0.10, diffuserZ: -2.52,
                    mirrorX: 0.82, mirrorY: 0.86, mirrorZ: 0.32,
                    frontFenderW: 0.54, frontFenderH: 0.30, frontFenderL: 1.02, frontFenderX: 1.12, frontFenderY: 0.48, frontFenderZ: 1.38,
                    rearFenderW: 0.58, rearFenderH: 0.34, rearFenderL: 1.12, rearFenderX: 1.14, rearFenderY: 0.52, rearFenderZ: -1.40,
                    fenderAccent: false, rearFenderAccent: true,
                    spoilerW: 2.14, spoilerL: 0.44, spoilerY: 1.10, spoilerZ: -2.30,
                    spoilerSupportX: 0.84, spoilerSupportY: 0.88, spoilerSupportH: 0.42,
                    exhaustX: 0.36, exhaustY: 0.24, exhaustZ: -2.56,
                    wheelR: 0.32, wheelT: 0.30, wheelX: 1.10, wheelY: 0.30,
                    wheelFrontZ: 1.46, wheelRearZ: -1.52,
                    lightY: 0.42, lightFrontX: 0.76, lightFrontZ: 2.96, lightRearX: 0.74, lightRearZ: -2.40,
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
