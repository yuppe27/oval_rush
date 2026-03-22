import * as THREE from 'three';

/**
 * Builds a 3D course from spline control points.
 * Generates: road surface, walls/guardrails, checkpoint markers, start line.
 * Also pre-samples the spline for per-frame collision detection.
 */
export class CourseBuilder {
    constructor() {
        this.group = new THREE.Group();
        this.spline = null;
        this.sampledPoints = [];   // [{position, forward, right, up, width, t}]
        this.sampleCount = 400;    // number of sample points along spline
        this.courseLength = 0;     // total arc length in meters
        this.checkpointIndices = [];
        this.startLineIndex = 0;
        this.courseData = null;
        this.environment = {
            tunnelLighting: 1,
            mistDensity: 0,
        };
        this._jumbotronCanvas = null;
        this._jumbotronCtx = null;
        this._jumbotronTexture = null;
        this._curveSignTextureCache = new Map();
        /** Meshes that can occlude the chase camera (tunnel ceilings, overburden, etc.) */
        this.cameraOccluders = [];
    }

    build(courseData) {
        this.group.clear();
        this.cameraOccluders = [];
        this.courseData = courseData;
        const points = courseData.controlPoints.map(
            cp => new THREE.Vector3(cp.x, cp.y, cp.z)
        );
        // Catmull-Rom, closed loop, Catmull-Rom tension 0.5
        this.spline = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
        this.courseLength = this.spline.getLength();

        this._sampleSpline(courseData);
        this._buildRoadSurface();
        this._buildWalls();
        this._buildStartLine(courseData);
        this._buildStartGate();
        this._buildCheckpointMarkers(courseData);
        this._buildScenery(courseData);

        return this.group;
    }

    /** Add mesh to scene and register it as a camera occluder */
    _addOccluder(mesh) {
        mesh.layers.enable(1);
        this.group.add(mesh);
        this.cameraOccluders.push(mesh);
    }

    // ─── Spline sampling ───────────────────────────────────────────────────────

    _sampleSpline(courseData) {
        const cps = courseData.controlPoints;
        const N = this.sampleCount;
        this.sampledPoints = [];

        for (let i = 0; i < N; i++) {
            const t = i / N;
            // getPointAt uses arc-length parameterisation → uniform spacing
            const position = this.spline.getPointAt(t);
            const tangent  = this.spline.getTangentAt(t).normalize();

            // Interpolate width and bankAngle from nearest control points
            const cpFrac  = t * cps.length;
            const cpLow   = Math.floor(cpFrac) % cps.length;
            const cpHigh  = (cpLow + 1) % cps.length;
            const frac    = cpFrac - Math.floor(cpFrac);

            const width     = THREE.MathUtils.lerp(cps[cpLow].width,     cps[cpHigh].width,     frac);
            const bankDeg   = THREE.MathUtils.lerp(cps[cpLow].bankAngle, cps[cpHigh].bankAngle, frac);
            const bankAngle = THREE.MathUtils.degToRad(bankDeg);

            const worldUp = new THREE.Vector3(0, 1, 0);
            const right   = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
            const up      = new THREE.Vector3().crossVectors(right, tangent).normalize();

            if (bankAngle !== 0) {
                const q = new THREE.Quaternion().setFromAxisAngle(tangent, bankAngle);
                right.applyQuaternion(q);
                up.applyQuaternion(q);
            }

            this.sampledPoints.push({
                position: position.clone(),
                forward: tangent.clone(),
                right:   right.clone(),
                up:      up.clone(),
                width,
                t,
                grip: this._resolveZoneValue(courseData.zones?.lowGrip, t, 'grip', 1),
                surfaceType: this._resolveZoneLabel(courseData.zones?.lowGrip, t, 'label', 'asphalt'),
                tunnelLighting: this._resolveZoneValue(courseData.zones?.tunnel, t, 'lighting', 1),
                mistDensity: this._resolveZoneValue(courseData.zones?.mist, t, 'density', 0),
                jump: this._resolveJumpZone(courseData.zones?.jump, t),
            });
        }

        // Map checkpoint t-values → nearest sample indices
        this.checkpointIndices = courseData.checkpointPositions.map(cpT => {
            let best = 0, bestDist = Infinity;
            for (let i = 0; i < N; i++) {
                const d = Math.abs(this.sampledPoints[i].t - cpT);
                if (d < bestDist) { bestDist = d; best = i; }
            }
            return best;
        });

        // Start line index
        this.startLineIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < N; i++) {
            const d = Math.abs(this.sampledPoints[i].t - courseData.startLinePosition);
            if (d < bestDist) { bestDist = d; this.startLineIndex = i; }
        }
    }

    _resolveZoneValue(zones = [], t, key, fallback) {
        for (const zone of zones || []) {
            if (this._isTInZone(t, zone.start, zone.end)) {
                return zone[key] ?? fallback;
            }
        }
        return fallback;
    }

    _resolveZoneLabel(zones = [], t, key, fallback) {
        for (const zone of zones || []) {
            if (this._isTInZone(t, zone.start, zone.end)) {
                return zone[key] || fallback;
            }
        }
        return fallback;
    }

    _resolveJumpZone(zones = [], t) {
        for (const zone of zones || []) {
            if (this._isTInZone(t, zone.start, zone.end)) {
                return { ...zone };
            }
        }
        return null;
    }

    _isTInZone(t, start, end) {
        if (start <= end) {
            return t >= start && t <= end;
        }
        return t >= start || t <= end;
    }

    // ─── Road surface ──────────────────────────────────────────────────────────

    _buildRoadSurface() {
        const N = this.sampledPoints.length;
        const vertices = [];
        const indices  = [];
        const uvs      = [];
        let accLen = 0;

        for (let i = 0; i <= N; i++) {
            const sp   = this.sampledPoints[i % N];
            const halfW = sp.width / 2;

            const left  = sp.position.clone().addScaledVector(sp.right, -halfW);
            const right = sp.position.clone().addScaledVector(sp.right,  halfW);

            left.y  += 0.04;
            right.y += 0.04;

            vertices.push(left.x,  left.y,  left.z);
            vertices.push(right.x, right.y, right.z);

            if (i > 0) {
                accLen += sp.position.distanceTo(this.sampledPoints[(i - 1) % N].position);
            }
            const v = accLen / sp.width; // tile UV along track
            uvs.push(0, v,  1, v);

            if (i < N) {
                const bl = i * 2, br = bl + 1;
                const tl = (i + 1) * 2, tr = tl + 1;
                indices.push(bl, tl, br,  br, tl, tr);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            color: 0x2d2d2d,
            roughness: 0.85,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });
        const road = new THREE.Mesh(geo, mat);
        road.receiveShadow = true;
        this.group.add(road);

        this._buildCenterLine();
        this._buildEdgeLines();
    }

    _buildCenterLine() {
        const pts = this.sampledPoints.map(sp =>
            new THREE.Vector3(sp.position.x, sp.position.y + 0.06, sp.position.z)
        );
        pts.push(pts[0].clone()); // close loop
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 4, gapSize: 3 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        this.group.add(line);
    }

    _buildEdgeLines() {
        for (const side of [-1, 1]) {
            const pts = this.sampledPoints.map(sp => {
                const p = sp.position.clone().addScaledVector(sp.right, side * (sp.width / 2 - 0.4));
                p.y += 0.06;
                return p;
            });
            pts.push(pts[0].clone());
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xffffff });
            this.group.add(new THREE.Line(geo, mat));
        }
    }

    // ─── Walls / guardrails ────────────────────────────────────────────────────

    _buildWalls() {
        const wallHeight = 1.0;
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0xbbbbbb,
            roughness: 0.6,
            metalness: 0.2,
        });

        for (const side of [-1, 1]) {
            const vertices = [];
            const indices  = [];
            const N = this.sampledPoints.length;

            for (let i = 0; i <= N; i++) {
                const sp    = this.sampledPoints[i % N];
                const halfW = sp.width / 2;
                const edge  = sp.position.clone().addScaledVector(sp.right, side * halfW);
                const baseY = sp.position.y + 0.05;

                vertices.push(edge.x, baseY,              edge.z);  // bottom
                vertices.push(edge.x, baseY + wallHeight, edge.z);  // top

                if (i < N) {
                    const bl = i * 2, br = bl + 1;
                    const tl = (i + 1) * 2, tr = tl + 1;
                    if (side === 1) {
                        indices.push(bl, br, tl,  tl, br, tr);
                    } else {
                        indices.push(bl, tl, br,  br, tl, tr);
                    }
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geo.setIndex(indices);
            geo.computeVertexNormals();

            const wall = new THREE.Mesh(geo, wallMat);
            wall.castShadow  = true;
            wall.receiveShadow = true;
            this.group.add(wall);
        }

        // Red / white striped rail caps on top of walls
        const capMat = new THREE.MeshStandardMaterial({ color: 0xdd3333, roughness: 0.5, metalness: 0.3 });
        for (const side of [-1, 1]) {
            const pts = this.sampledPoints.map(sp => {
                const p = sp.position.clone().addScaledVector(sp.right, side * sp.width / 2);
                p.y += 1.05 + 0.05;
                return p;
            });
            pts.push(pts[0].clone());
            const curve  = new THREE.CatmullRomCurve3(pts, false);
            const tubeGeo = new THREE.TubeGeometry(curve, pts.length - 1, 0.12, 4, false);
            this.group.add(new THREE.Mesh(tubeGeo, capMat));
        }
    }

    // ─── Start line ────────────────────────────────────────────────────────────

    _buildStartLine(courseData) {
        const sp = this.sampledPoints[this.startLineIndex];

        // Checkerboard canvas texture
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const sz = 16;
        for (let y = 0; y < canvas.height; y += sz) {
            for (let x = 0; x < canvas.width; x += sz) {
                ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ffffff' : '#111111';
                ctx.fillRect(x, y, sz, sz);
            }
        }
        const tex = new THREE.CanvasTexture(canvas);

        const geo = new THREE.PlaneGeometry(sp.width, 2.5);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);
        this._placeSurfacePlane(mesh, sp, 0.07);
        mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    // ─── Start gate ────────────────────────────────────────────────────────────

    _buildStartGate() {
        const sp = this.sampledPoints[this.startLineIndex];
        const pillarH = 9.0;
        const pillarR = 0.45;
        const barH = 0.7;
        const margin = 0.6;
        const halfWidth = sp.width * 0.5 + margin;

        // Road frame (right-handed): local X = sp.right, local Y = sp.up, local Z = -sp.forward
        // -sp.forward にすることで行列式=+1 の正則な回転行列となり、
        // バナー法線が接近方向（-sp.forward）を向く
        const basis = new THREE.Matrix4().makeBasis(
            sp.right.clone().normalize(),
            sp.up.clone().normalize(),
            sp.forward.clone().normalize().negate()
        );
        const q = new THREE.Quaternion().setFromRotationMatrix(basis);

        const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.15 });
        const barMat    = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.4, metalness: 0.25 });

        // Left pillar
        const pillarGeo = new THREE.CylinderGeometry(pillarR, pillarR, pillarH, 10);
        const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
        leftPillar.position.copy(sp.position)
            .addScaledVector(sp.right, -halfWidth)
            .addScaledVector(sp.up, pillarH * 0.5 + 0.05);
        leftPillar.quaternion.copy(q);
        leftPillar.castShadow = true;
        this.group.add(leftPillar);

        // Right pillar
        const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
        rightPillar.position.copy(sp.position)
            .addScaledVector(sp.right, halfWidth)
            .addScaledVector(sp.up, pillarH * 0.5 + 0.05);
        rightPillar.quaternion.copy(q);
        rightPillar.castShadow = true;
        this.group.add(rightPillar);

        // Crossbar
        const barLength = halfWidth * 2 + pillarR * 2;
        const barGeo = new THREE.BoxGeometry(barLength, barH, barH);
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.copy(sp.position)
            .addScaledVector(sp.up, pillarH + barH * 0.5 + 0.05);
        bar.quaternion.copy(q);
        bar.castShadow = true;
        this.group.add(bar);

        // Banner hanging below crossbar
        const bannerW = barLength - pillarR * 2 - 0.4;
        const bannerH = 2.2;
        const bannerCanvas = document.createElement('canvas');
        bannerCanvas.width = 512; bannerCanvas.height = 128;
        const ctx = bannerCanvas.getContext('2d');
        ctx.fillStyle = '#cc1111';
        ctx.fillRect(0, 0, 512, 128);
        // Checkered accent strips
        const sz = 16;
        for (let x = 0; x < 512; x += sz * 2) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, 0, sz, 20);
            ctx.fillRect(x + sz, 108, sz, 20);
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 54px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('START / FINISH', 256, 68);
        const bannerTex = new THREE.CanvasTexture(bannerCanvas);
        const bannerGeo = new THREE.PlaneGeometry(bannerW, bannerH);
        const bannerMat = new THREE.MeshStandardMaterial({
            map: bannerTex,
            emissive: new THREE.Color(0x330000),
            emissiveMap: bannerTex,
            side: THREE.DoubleSide,
            roughness: 0.9,
        });
        const banner = new THREE.Mesh(bannerGeo, bannerMat);
        banner.position.copy(sp.position)
            .addScaledVector(sp.up, pillarH - bannerH * 0.5 + 0.05);
        banner.quaternion.copy(q);
        this.group.add(banner);
    }

    // ─── Jumbotron display ─────────────────────────────────────────────────────

    _drawJumbotronIdle() {
        const ctx = this._jumbotronCtx;
        const w = 512, h = 224;
        ctx.fillStyle = '#080c1a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,204,0,0.3)';
        ctx.lineWidth = 3;
        ctx.strokeRect(4, 4, w - 8, h - 8);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('THUNDER OVAL SPEEDWAY', w / 2, 40);
        ctx.strokeStyle = '#1e2d44';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, 54);
        ctx.lineTo(w - 20, 54);
        ctx.stroke();
        ctx.fillStyle = '#1e2d44';
        ctx.font = 'bold 80px monospace';
        ctx.fillText('P--', w / 2, 152);
        this._jumbotronTexture.needsUpdate = true;
    }

    updateJumbotron({ position, currentLap, totalLaps, state, timeStr, message }) {
        if (!this._jumbotronCtx) return;
        const ctx = this._jumbotronCtx;
        const w = 512, h = 224;

        ctx.fillStyle = '#080c1a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,204,0,0.3)';
        ctx.lineWidth = 3;
        ctx.strokeRect(4, 4, w - 8, h - 8);

        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('THUNDER OVAL SPEEDWAY', w / 2, 40);
        ctx.strokeStyle = '#1e2d44';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, 54);
        ctx.lineTo(w - 20, 54);
        ctx.stroke();

        if (state === 'grid_intro' || state === 'countdown') {
            ctx.fillStyle = '#88d6ff';
            ctx.font = 'bold 64px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('READY', w / 2, 152);
        } else if (state === 'racing' || state === 'finish_celebration') {
            const posColor = position === 1 ? '#ffcc00' : position <= 3 ? '#88ddff' : '#ffffff';
            ctx.fillStyle = posColor;
            ctx.font = 'bold 80px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`P${position}`, w / 2, 152);
            ctx.fillStyle = '#7799bb';
            ctx.font = '22px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`LAP ${currentLap}/${totalLaps}`, 24, 200);
            ctx.textAlign = 'right';
            ctx.fillText(timeStr, w - 24, 200);
        } else if (state === 'finished' || state === 'gameover') {
            const posColor = position === 1 ? '#ffcc00' : '#ffffff';
            ctx.fillStyle = posColor;
            ctx.font = 'bold 60px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`P${position} FINISH`, w / 2, 138);
            ctx.fillStyle = '#7799bb';
            ctx.font = '24px monospace';
            ctx.fillText(timeStr, w / 2, 185);
        } else {
            ctx.fillStyle = '#1e2d44';
            ctx.font = 'bold 80px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('P--', w / 2, 152);
        }

        if (message) {
            ctx.fillStyle = '#ff7744';
            ctx.font = 'bold 20px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(message, w / 2, 216);
        }

        this._jumbotronTexture.needsUpdate = true;
    }

    // ─── Checkpoint markers ────────────────────────────────────────────────────

    _buildCheckpointMarkers(courseData) {
        const colors = [0xff8800, 0x00ccff];

        this.checkpointIndices.forEach((cpIdx, i) => {
            const sp  = this.sampledPoints[cpIdx];
            const col = colors[i % colors.length];
            const mat = new THREE.MeshStandardMaterial({
                color: col,
                emissive: col,
                emissiveIntensity: 0.3,
            });

            // Two vertical poles flanking the track
            const poleGeo = new THREE.BoxGeometry(0.5, 5, 0.5);
            const hw = sp.width / 2 + 0.5;
            for (const side of [-1, 1]) {
                const pole = new THREE.Mesh(poleGeo, mat);
                pole.position.copy(sp.position).addScaledVector(sp.right, side * hw);
                pole.position.y += 2.5;
                pole.castShadow = true;
                this.group.add(pole);
            }

            // Ground stripe
            const stripeGeo = new THREE.PlaneGeometry(sp.width, 1.5);
            const stripeMat = new THREE.MeshStandardMaterial({
                color: col, transparent: true, opacity: 0.55,
            });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            this._placeSurfacePlane(stripe, sp, 0.07);
            this.group.add(stripe);
        });
    }

    _buildScenery(courseData) {
        const scenery = courseData.scenery || 'stadium';
        if (scenery === 'seaside') {
            this._buildSeasideScenery();
            this._buildCurveWarningSigns();
            return;
        }
        if (scenery === 'mountain') {
            this._buildMountainScenery();
            this._buildCurveWarningSigns();
            return;
        }
        this._buildStadiumScenery();
        this._buildCurveWarningSigns();
    }

    _buildStadiumScenery() {
        // Compute track center and bounding radius from sampled points
        const N = this.sampledPoints.length;
        let cx = 0, cz = 0;
        for (const sp of this.sampledPoints) {
            cx += sp.position.x;
            cz += sp.position.z;
        }
        cx /= N;
        cz /= N;
        let maxR = 0;
        for (const sp of this.sampledPoints) {
            const dx = sp.position.x - cx;
            const dz = sp.position.z - cz;
            const r = Math.sqrt(dx * dx + dz * dz) + sp.width / 2;
            if (r > maxR) maxR = r;
        }

        const standInnerR = maxR + 40;
        const standOuterR = standInnerR + 55;
        const standHeight = 32;
        const wallTopHeight = standHeight + 18;
        const segments = 72;

        // Grandstand: angled surface sloping up (like bleacher seating)
        const standMat = new THREE.MeshStandardMaterial({
            color: 0x6b7d8e, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide,
        });
        const standVerts = [];
        const standIdx = [];
        for (let i = 0; i <= segments; i++) {
            const ang = (i / segments) * Math.PI * 2;
            const c = Math.cos(ang), s = Math.sin(ang);
            standVerts.push(cx + c * standInnerR, 0, cz + s * standInnerR);
            standVerts.push(cx + c * standOuterR, standHeight, cz + s * standOuterR);
            if (i < segments) {
                const bl = i * 2, br = bl + 1, tl = (i + 1) * 2, tr = tl + 1;
                standIdx.push(bl, tl, br, br, tl, tr);
            }
        }
        const standGeo = new THREE.BufferGeometry();
        standGeo.setAttribute('position', new THREE.Float32BufferAttribute(standVerts, 3));
        standGeo.setIndex(standIdx);
        standGeo.computeVertexNormals();
        const stands = new THREE.Mesh(standGeo, standMat);
        stands.receiveShadow = true;
        this.group.add(stands);

        // Back wall behind the stands
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x8899aa, roughness: 0.7, metalness: 0.15,
        });
        const wallVerts = [];
        const wallIdx = [];
        for (let i = 0; i <= segments; i++) {
            const ang = (i / segments) * Math.PI * 2;
            const c = Math.cos(ang), s = Math.sin(ang);
            wallVerts.push(cx + c * standOuterR, standHeight, cz + s * standOuterR);
            wallVerts.push(cx + c * standOuterR, wallTopHeight, cz + s * standOuterR);
            if (i < segments) {
                const bl = i * 2, br = bl + 1, tl = (i + 1) * 2, tr = tl + 1;
                wallIdx.push(bl, tl, br, br, tl, tr);
            }
        }
        const wallGeo = new THREE.BufferGeometry();
        wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
        wallGeo.setIndex(wallIdx);
        wallGeo.computeVertexNormals();
        this.group.add(new THREE.Mesh(wallGeo, wallMat));

        // Jumbotron screen above stands
        this._jumbotronCanvas = document.createElement('canvas');
        this._jumbotronCanvas.width = 512;
        this._jumbotronCanvas.height = 224;
        this._jumbotronCtx = this._jumbotronCanvas.getContext('2d');
        this._jumbotronTexture = new THREE.CanvasTexture(this._jumbotronCanvas);
        this._drawJumbotronIdle();

        const screenMat = new THREE.MeshStandardMaterial({
            map: this._jumbotronTexture,
            emissiveMap: this._jumbotronTexture,
            emissive: new THREE.Color(1, 1, 1),
            emissiveIntensity: 0.85,
            roughness: 0.45,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });
        const screenY = wallTopHeight + 9;
        const screen = new THREE.Mesh(new THREE.BoxGeometry(32, 14, 2), screenMat);
        screen.position.set(cx, screenY, cz);
        screen.castShadow = true;
        this.group.add(screen);

        // Metal frame around screen
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.4, metalness: 0.8 });
        const ft = 0.7;
        const frameparts = [
            { geo: new THREE.BoxGeometry(33.4, ft, 2.4), dx: 0, dy: 7.35 },
            { geo: new THREE.BoxGeometry(33.4, ft, 2.4), dx: 0, dy: -7.35 },
            { geo: new THREE.BoxGeometry(ft, 14, 2.4), dx: -16.35, dy: 0 },
            { geo: new THREE.BoxGeometry(ft, 14, 2.4), dx: 16.35, dy: 0 },
        ];
        for (const { geo, dx, dy } of frameparts) {
            const bar = new THREE.Mesh(geo, frameMat);
            bar.position.set(cx + dx, screenY + dy, cz);
            this.group.add(bar);
        }

        // Support pillars
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.5, metalness: 0.7 });
        const pillarH = screenY - 7;
        const pillarGeo = new THREE.BoxGeometry(1.2, pillarH, 1.2);
        for (const dx of [-14, 14]) {
            const pillar = new THREE.Mesh(pillarGeo, pillarMat);
            pillar.position.set(cx + dx, pillarH / 2, cz);
            this.group.add(pillar);
        }

        this._buildStadiumStartLineRoof(cx, cz, standInnerR, standOuterR, standHeight, wallTopHeight);
        this._buildStadiumSpectators(cx, cz, standInnerR, standOuterR, standHeight);
    }

    _buildStadiumStartLineRoof(cx, cz, standInnerR, standOuterR, standHeight, wallTopHeight) {
        const startSp = this.sampledPoints[this.startLineIndex];
        if (!startSp) return;

        const centerToStart = new THREE.Vector3(startSp.position.x - cx, 0, startSp.position.z - cz);
        const startAngle = Math.atan2(centerToStart.z, centerToStart.x);
        const halfSpan = Math.PI * 0.16;
        const roofStart = startAngle - halfSpan;
        const roofEnd = startAngle + halfSpan;
        const segments = 18;

        const roofInnerR = standInnerR + 12;
        const roofOuterR = standOuterR + 20;
        const frontY = standHeight + 11;
        const backY = wallTopHeight + 12;
        const crownLift = 2.5;
        const roofThickness = 1.6;

        const roofMat = new THREE.MeshStandardMaterial({
            color: 0xc8d2db,
            roughness: 0.42,
            metalness: 0.58,
            side: THREE.DoubleSide,
        });
        const trimMat = new THREE.MeshStandardMaterial({
            color: 0x51606f,
            roughness: 0.5,
            metalness: 0.72,
        });
        const supportMat = new THREE.MeshStandardMaterial({
            color: 0x627181,
            roughness: 0.54,
            metalness: 0.62,
        });

        const roofVerts = [];
        const roofIdx = [];
        for (let i = 0; i <= segments; i++) {
            const frac = i / segments;
            const ang = THREE.MathUtils.lerp(roofStart, roofEnd, frac);
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const arcLift = Math.sin(frac * Math.PI) * crownLift;
            const innerTopY = frontY + arcLift;
            const outerTopY = backY + arcLift;
            const innerBottomY = innerTopY - roofThickness;
            const outerBottomY = outerTopY - roofThickness;

            roofVerts.push(cx + c * roofInnerR, innerTopY, cz + s * roofInnerR);
            roofVerts.push(cx + c * roofOuterR, outerTopY, cz + s * roofOuterR);
            roofVerts.push(cx + c * roofInnerR, innerBottomY, cz + s * roofInnerR);
            roofVerts.push(cx + c * roofOuterR, outerBottomY, cz + s * roofOuterR);

            if (i < segments) {
                const base = i * 4;
                const next = base + 4;
                roofIdx.push(base, next, base + 1, base + 1, next, next + 1);
                roofIdx.push(base + 2, base + 3, next + 2, base + 3, next + 3, next + 2);
                roofIdx.push(base, base + 2, next, base + 2, next + 2, next);
                roofIdx.push(base + 1, next + 1, base + 3, base + 3, next + 1, next + 3);
            }
        }

        const roofGeo = new THREE.BufferGeometry();
        roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofVerts, 3));
        roofGeo.setIndex(roofIdx);
        roofGeo.computeVertexNormals();
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.castShadow = true;
        roof.receiveShadow = true;
        this.group.add(roof);

        const fasciaSegments = 12;
        for (let i = 0; i < fasciaSegments; i++) {
            const fracA = i / fasciaSegments;
            const fracB = (i + 1) / fasciaSegments;
            const angA = THREE.MathUtils.lerp(roofStart, roofEnd, fracA);
            const angB = THREE.MathUtils.lerp(roofStart, roofEnd, fracB);
            const midFrac = (i + 0.5) / fasciaSegments;
            const midAng = THREE.MathUtils.lerp(roofStart, roofEnd, midFrac);
            const arcLift = Math.sin(midFrac * Math.PI) * crownLift;
            const segLength = 2 * roofInnerR * Math.sin((angB - angA) * 0.5);
            const frontTrim = new THREE.Mesh(
                new THREE.BoxGeometry(2.4, 1.1, segLength + 0.4),
                trimMat
            );
            frontTrim.position.set(
                cx + Math.cos(midAng) * roofInnerR,
                frontY + arcLift - roofThickness * 0.5,
                cz + Math.sin(midAng) * roofInnerR
            );
            frontTrim.rotation.y = -midAng;
            frontTrim.castShadow = true;
            this.group.add(frontTrim);
        }

        const supportAngles = 5;
        const supportOuterR = standOuterR + 7;
        for (let i = 0; i < supportAngles; i++) {
            const frac = supportAngles === 1 ? 0.5 : i / (supportAngles - 1);
            const ang = THREE.MathUtils.lerp(roofStart + 0.03, roofEnd - 0.03, frac);
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const arcLift = Math.sin(frac * Math.PI) * crownLift;
            const topY = backY + arcLift - roofThickness * 0.5;

            const column = new THREE.Mesh(
                new THREE.BoxGeometry(1.6, topY, 1.6),
                supportMat
            );
            column.position.set(
                cx + c * supportOuterR,
                topY * 0.5,
                cz + s * supportOuterR
            );
            column.castShadow = true;
            this.group.add(column);

            const braceLength = roofOuterR - supportOuterR + 1.8;
            const brace = new THREE.Mesh(
                new THREE.BoxGeometry(1.1, 1.1, braceLength),
                supportMat
            );
            brace.position.set(
                cx + c * (supportOuterR + braceLength * 0.5),
                topY - 0.35,
                cz + s * (supportOuterR + braceLength * 0.5)
            );
            brace.rotation.y = Math.PI * 0.5 - ang;
            brace.castShadow = true;
            this.group.add(brace);
        }
    }

    _buildStadiumSpectators(cx, cz, standInnerR, standOuterR, standHeight) {
        const numRows = 8;
        const spacing = 2.0;
        const bodyW = 0.85;
        const bodyH = 1.5;
        const bodyD = 0.45;

        const startSp = this.sampledPoints[this.startLineIndex];
        if (!startSp) return;

        const startAngle = Math.atan2(startSp.position.z - cz, startSp.position.x - cx);
        const slopeAngle = Math.atan2(standHeight, standOuterR - standInnerR);
        const packedHalfSpan = Math.PI * 0.18;
        const grassSpans = [
            { center: startAngle + Math.PI, halfWidth: Math.PI * 0.12 },
            { center: startAngle + Math.PI * 0.63, halfWidth: Math.PI * 0.09 },
            { center: startAngle - Math.PI * 0.63, halfWidth: Math.PI * 0.09 },
        ];

        const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
        const isInSpan = (angle, center, halfWidth) => Math.abs(angleDelta(angle, center)) <= halfWidth;

        this._buildStadiumGrassSections(
            cx,
            cz,
            standInnerR,
            standOuterR,
            standHeight,
            slopeAngle,
            grassSpans
        );

        const rowData = [];
        for (let row = 0; row < numRows; row++) {
            const f = (row + 0.5) / numRows;
            const r = standInnerR + f * (standOuterR - standInnerR);
            const count = Math.floor((2 * Math.PI * r) / spacing);
            rowData.push({ row, f, r, count });
        }

        const colors = [0xcc2222, 0x2244cc, 0xddcc00, 0x22aa44, 0xffffff, 0xee6600, 0x9933cc, 0x44aacc, 0xee3388, 0x33ccaa];
        const geo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
        let seed = 12345;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) & 0xffffffff;
            return (seed >>> 0) / 0xffffffff;
        };
        const placements = [];

        for (const { row, f, r, count } of rowData) {
            const baseY = f * standHeight + bodyH * 0.5 * Math.cos(slopeAngle) + 0.1;
            for (let j = 0; j < count; j++) {
                const ang = (j / count) * Math.PI * 2;
                if (grassSpans.some(span => isInSpan(ang, span.center, span.halfWidth))) {
                    continue;
                }

                const isPacked = isInSpan(ang, startAngle, packedHalfSpan);
                const baseDensity = THREE.MathUtils.lerp(0.92, 0.68, row / Math.max(1, numRows - 1));
                if (!isPacked && rand() > baseDensity) {
                    continue;
                }

                placements.push({
                    x: cx + Math.cos(ang) * r,
                    y: baseY,
                    z: cz + Math.sin(ang) * r,
                    ang,
                    color: colors[Math.floor(rand() * colors.length)],
                });
            }
        }

        if (!placements.length) return;

        const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        placements.forEach((placement, idx) => {
            dummy.position.set(placement.x, placement.y, placement.z);
            dummy.rotation.set(0, placement.ang + Math.PI, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx, dummy.matrix);
            color.setHex(placement.color);
            mesh.setColorAt(idx, color);
        });

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.group.add(mesh);
    }

    _buildStadiumGrassSections(cx, cz, standInnerR, standOuterR, standHeight, slopeAngle, grassSpans) {
        const rowCount = 8;
        const rowDepth = (standOuterR - standInnerR) / rowCount;
        const slopeLength = (rowDepth - 0.5) / Math.max(0.35, Math.cos(slopeAngle));
        const grassMaterials = [
            new THREE.MeshStandardMaterial({ color: 0x5f8a43, roughness: 0.98, side: THREE.DoubleSide }),
            new THREE.MeshStandardMaterial({ color: 0x6c9650, roughness: 0.98, side: THREE.DoubleSide }),
        ];

        for (const span of grassSpans) {
            const segmentCount = Math.max(5, Math.round((span.halfWidth * 2) / 0.12));
            for (let row = 0; row < rowCount; row++) {
                const innerR = standInnerR + row * rowDepth + 0.4;
                const outerR = standInnerR + (row + 1) * rowDepth - 0.4;
                const centerR = (innerR + outerR) * 0.5;
                const surfaceY = (((centerR - standInnerR) / (standOuterR - standInnerR)) * standHeight) + 0.18;
                const grassMat = grassMaterials[row % grassMaterials.length];

                for (let i = 0; i < segmentCount; i++) {
                    const fracA = i / segmentCount;
                    const fracB = (i + 1) / segmentCount;
                    const angA = THREE.MathUtils.lerp(span.center - span.halfWidth, span.center + span.halfWidth, fracA);
                    const angB = THREE.MathUtils.lerp(span.center - span.halfWidth, span.center + span.halfWidth, fracB);
                    const midAng = (angA + angB) * 0.5;
                    const tangent = new THREE.Vector3(-Math.sin(midAng), 0, Math.cos(midAng)).normalize();
                    const outward = new THREE.Vector3(Math.cos(midAng), 0, Math.sin(midAng)).normalize();
                    const slopeDir = new THREE.Vector3(outward.x, Math.tan(slopeAngle), outward.z).normalize();
                    const normal = new THREE.Vector3().crossVectors(tangent, slopeDir).normalize();
                    const segWidth = 2 * centerR * Math.sin((angB - angA) * 0.5);
                    const patch = new THREE.Mesh(
                        new THREE.PlaneGeometry(segWidth + 0.7, slopeLength),
                        grassMat
                    );
                    patch.position.set(
                        cx + Math.cos(midAng) * centerR,
                        surfaceY,
                        cz + Math.sin(midAng) * centerR
                    );
                    patch.position.addScaledVector(normal, 0.12);
                    patch.quaternion.setFromRotationMatrix(
                        new THREE.Matrix4().makeBasis(tangent, slopeDir, normal)
                    );
                    patch.receiveShadow = true;
                    this.group.add(patch);
                }
            }
        }
    }

    _buildSeasideScenery() {
        this._buildSeasideTerrain();
        this._buildSeasideBeach();
        this._buildSeasideTown();
        this._buildSeasideCliffs();
        this._buildSeasideTunnel();
        this._buildLighthouse();
    }

    _buildSeasideTerrain() {
        const N = this.sampledPoints.length;
        const step = 2;
        const edgeOffset = 1.5;
        const LEVELS = 3;
        // Inside: grass terrain
        const innerSpread = [0, 10, 22];
        const innerColors = [
            [0.42, 0.55, 0.34], // grass green — road edge
            [0.38, 0.50, 0.30], // darker grass
            [0.34, 0.46, 0.28], // field green — ground level
        ];
        const innerBaseY = -1.3;
        // Outside: sandy beach descending to water
        const outerSpread = [0, 8, 18];
        const outerColors = [
            [0.42, 0.55, 0.34], // grass green — road edge
            [0.77, 0.65, 0.42], // sandy brown
            [0.12, 0.43, 0.59], // water blue
        ];
        const outerBaseY = -3.5;
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        // Calculate centroid to determine inside vs outside
        let cx = 0, cz = 0;
        for (let i = 0; i < N; i++) {
            cx += this.sampledPoints[i].position.x;
            cz += this.sampledPoints[i].position.z;
        }
        cx /= N;
        cz /= N;

        for (const side of [-1, 1]) {
            const vertices = [];
            const colors = [];
            const indices = [];
            let segCount = 0;

            // Determine inside/outside once per side using majority vote
            let dotSum = 0;
            for (let i = 0; i < N; i += step) {
                const sp = this.sampledPoints[i];
                const toCX = cx - sp.position.x;
                const toCZ = cz - sp.position.z;
                dotSum += toCX * sp.right.x + toCZ * sp.right.z;
            }
            const isInside = (side > 0) === (dotSum > 0);
            const spread = isInside ? innerSpread : outerSpread;
            const lvColors = isInside ? innerColors : outerColors;
            const baseY = isInside ? innerBaseY : outerBaseY;

            for (let i = 0; i <= N; i += step) {
                const sp = this.sampledPoints[i % N];
                const halfW = sp.width / 2;
                const edgeY = sp.position.y;

                for (let lv = 0; lv < LEVELS; lv++) {
                    const t = lv / (LEVELS - 1);
                    const y = THREE.MathUtils.lerp(edgeY, baseY, t);
                    const lateral = halfW + edgeOffset + spread[lv];
                    const pos = sp.position.clone()
                        .addScaledVector(sp.right, side * lateral);
                    pos.y = y;
                    vertices.push(pos.x, pos.y, pos.z);
                    const c = lvColors[lv];
                    colors.push(c[0], c[1], c[2]);
                }

                if (segCount > 0) {
                    const prev = (segCount - 1) * LEVELS;
                    const curr = segCount * LEVELS;
                    for (let lv = 0; lv < LEVELS - 1; lv++) {
                        const bl = prev + lv;
                        const br = prev + lv + 1;
                        const tl = curr + lv;
                        const tr = curr + lv + 1;
                        if (side > 0) {
                            indices.push(bl, tl, br, br, tl, tr);
                        } else {
                            indices.push(bl, br, tl, tl, br, tr);
                        }
                    }
                }
                segCount++;
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            geo.setIndex(indices);
            geo.computeVertexNormals();

            const mesh = new THREE.Mesh(geo, mat);
            mesh.receiveShadow = true;
            this.group.add(mesh);
        }
    }

    _buildSeasideBeach() {
        // Grass ground — fan triangulation from centroid using BufferGeometry
        const N = this.sampledPoints.length;
        const step = 4;
        // Calculate centroid
        let cx = 0, cz = 0, count = 0;
        for (let i = 0; i < N; i += step) {
            const sp = this.sampledPoints[i];
            cx += sp.position.x;
            cz += sp.position.z;
            count++;
        }
        cx /= count;
        cz /= count;
        // Collect edge points offset inward from road edge
        const edgePts = [];
        for (let i = 0; i < N; i += step) {
            const sp = this.sampledPoints[i];
            const halfW = sp.width / 2;
            const toCentroidX = cx - sp.position.x;
            const toCentroidZ = cz - sp.position.z;
            const inwardSign = Math.sign(toCentroidX * sp.right.x + toCentroidZ * sp.right.z);
            const offset = halfW + 1;
            edgePts.push(
                sp.position.x + sp.right.x * inwardSign * offset,
                sp.position.z + sp.right.z * inwardSign * offset,
            );
        }
        // Build fan triangles: centroid + consecutive edge pairs
        const groundY = -1.0;
        const verts = [];
        const idxs = [];
        // Vertex 0 = centroid
        verts.push(cx, groundY, cz);
        for (let i = 0; i < edgePts.length; i += 2) {
            verts.push(edgePts[i], groundY, edgePts[i + 1]);
        }
        const numEdge = edgePts.length / 2;
        for (let i = 0; i < numEdge; i++) {
            const a = 1 + i;
            const b = 1 + ((i + 1) % numEdge);
            idxs.push(0, a, b);
        }
        const groundGeo = new THREE.BufferGeometry();
        groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        groundGeo.setIndex(idxs);
        groundGeo.computeVertexNormals();
        const ground = new THREE.Mesh(
            groundGeo,
            new THREE.MeshStandardMaterial({
                color: 0x5a8a42,
                roughness: 0.95,
                metalness: 0.0,
                side: THREE.DoubleSide,
            })
        );
        ground.receiveShadow = true;
        this.group.add(ground);

        // Water plane covering the full area — seaside atmosphere
        const water = new THREE.Mesh(
            new THREE.CircleGeometry(1800, 80),
            new THREE.MeshStandardMaterial({
                color: 0x1e6d96,
                roughness: 0.35,
                metalness: 0.2,
            })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.y = -3.5;
        this.group.add(water);

        const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7b4c24, roughness: 0.8 });
        const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a4a, roughness: 0.9 });
        const palmPositions = [
            [-310, -160], [-330, 80], [-280, 250], [-120, 300], [210, 270], [330, 120], [320, -110], [120, -200],
        ];
        for (const [x, z] of palmPositions) {
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 12, 6), palmTrunkMat);
            trunk.position.set(x, 5.5, z);
            this.group.add(trunk);
            for (let i = 0; i < 5; i++) {
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 7.5), palmLeafMat);
                leaf.position.set(x, 11.5, z);
                leaf.rotation.y = (Math.PI * 2 * i) / 5;
                leaf.rotation.x = -0.4;
                this.group.add(leaf);
            }
        }
    }

    _buildSeasideTown() {
        const stuccoPalette = [0xf0d9b7, 0xd8b48d, 0xe4c8a8, 0xc76d4f];
        const roofPalette = [0x8d3f2a, 0xa84e2a, 0x6a3022];
        const housePositions = [
            [-520, 210, 24, 16, 18],
            [-500, 315, 22, 15, 16],
            [-410, 445, 28, 18, 20],
            [-205, 520, 26, 16, 16],
            [170, 485, 24, 15, 18],
            [390, 360, 30, 18, 20],
        ];
        housePositions.forEach(([x, z, h, w, d], idx) => {
            const wallMat = new THREE.MeshStandardMaterial({
                color: stuccoPalette[idx % stuccoPalette.length],
                roughness: 0.92,
            });
            const roofMat = new THREE.MeshStandardMaterial({
                color: roofPalette[idx % roofPalette.length],
                roughness: 0.88,
            });
            const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
            const safePos = this._getSafeSceneryPosition(
                new THREE.Vector3(x, h * 0.5, z),
                Math.max(w, d) * 1.6
            );
            body.position.copy(safePos);
            body.castShadow = true;
            body.receiveShadow = true;
            this.group.add(body);

            const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, 7, 4), roofMat);
            roof.position.set(safePos.x, safePos.y + h * 0.5 + 3, safePos.z);
            roof.rotation.y = Math.PI * 0.25;
            roof.castShadow = true;
            this.group.add(roof);
        });

        const plaza = new THREE.Mesh(
            new THREE.BoxGeometry(180, 0.2, 120),
            new THREE.MeshStandardMaterial({ color: 0xb69573, roughness: 0.95 })
        );
        plaza.position.copy(this._getSafeSceneryPosition(new THREE.Vector3(-310, 0.0, 470), 90));
        plaza.receiveShadow = true;
        this.group.add(plaza);
    }

    _buildSeasideCliffs() {
        const cliffMat = new THREE.MeshStandardMaterial({
            color: 0x877969,
            roughness: 0.98,
            metalness: 0.02,
        });
        const grassMat = new THREE.MeshStandardMaterial({
            color: 0x6d8c57,
            roughness: 0.92,
            metalness: 0.0,
        });
        const scenicRanges = [
            { start: 0.10, end: 0.26 },
            { start: 0.30, end: 0.46 },
            { start: 0.80, end: 0.92 },
        ];
        const side = -1;

        scenicRanges.forEach((range, rangeIdx) => {
            const startIdx = this._findSampleIndexAt(range.start);
            const endIdx = this._findSampleIndexAt(range.end);
            const indices = this._collectWrappedIndices(startIdx, endIdx);
            for (let i = 0; i < indices.length; i += 12) {
                const sp = this.sampledPoints[indices[i]];
                const nextSp = this.sampledPoints[indices[Math.min(i + 1, indices.length - 1)]];
                const height = 42 + ((i / 12 + rangeIdx) % 3) * 10;
                const depth = 26 + ((i / 12 + rangeIdx) % 2) * 6;
                const length = Math.max(28, sp.position.distanceTo(nextSp.position) * 4.8);
                const lateralOffset = sp.width * 0.5 + 28 + depth * 0.65;
                const center = sp.position.clone()
                    .addScaledVector(sp.right, side * lateralOffset);
                center.y = -2 + height * 0.5;
                const basis = new THREE.Matrix4().makeBasis(
                    sp.right.clone().multiplyScalar(side).normalize(),
                    sp.up.clone().normalize(),
                    sp.forward.clone().normalize()
                );
                const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

                const body = new THREE.Mesh(
                    new THREE.BoxGeometry(depth, height, length),
                    cliffMat
                );
                body.position.copy(center);
                body.quaternion.copy(quat);
                body.castShadow = true;
                body.receiveShadow = true;
                this.group.add(body);

                const cap = new THREE.Mesh(
                    new THREE.BoxGeometry(depth * 0.9, 6, length * 0.94),
                    grassMat
                );
                cap.position.copy(center);
                cap.position.y = -2 + height + 2;
                cap.quaternion.copy(quat);
                cap.receiveShadow = true;
                this.group.add(cap);
            }
        });
    }

    _buildLighthouse() {
        const towerMat = new THREE.MeshStandardMaterial({ color: 0xf5efe7, roughness: 0.82 });
        const stripeMat = new THREE.MeshStandardMaterial({ color: 0xbc3d30, roughness: 0.78 });
        const topMat = new THREE.MeshStandardMaterial({
            color: 0xddd5b5,
            emissive: 0xe7cf79,
            emissiveIntensity: 0.45,
            roughness: 0.4,
        });

        const safeBasePos = this._getSafeSceneryPosition(new THREE.Vector3(520, 21, -320), 72);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 9.5, 42, 10), towerMat);
        base.position.copy(safeBasePos);
        base.castShadow = true;
        this.group.add(base);

        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(7.1, 9.6, 9, 10), stripeMat);
        stripe.position.set(safeBasePos.x, safeBasePos.y - 3, safeBasePos.z);
        this.group.add(stripe);

        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 7, 8), topMat);
        lantern.position.set(safeBasePos.x, safeBasePos.y + 23, safeBasePos.z);
        this.group.add(lantern);
    }

    _buildTunnelMountain() {
        const tunnelZone = this.courseData?.zones?.tunnel?.[0];
        if (!tunnelZone) return;

        const startIdx = this._findSampleIndexAt(tunnelZone.start);
        const endIdx = this._findSampleIndexAt(tunnelZone.end);
        const indices = this._collectWrappedIndices(startIdx, endIdx);
        if (indices.length < 2) return;
        const mountainIndices = indices;

        const mountainMat = new THREE.MeshStandardMaterial({
            color: 0x6b6256, roughness: 0.96, metalness: 0.02,
        });
        const grassMat = new THREE.MeshStandardMaterial({
            color: 0x4a6a3a, roughness: 0.94, metalness: 0.0,
        });

        const midIdx = mountainIndices[Math.floor(mountainIndices.length / 2)];
        const midSp = this.sampledPoints[midIdx];
        const firstSp = this.sampledPoints[mountainIndices[0]];
        const lastSp = this.sampledPoints[mountainIndices[mountainIndices.length - 1]];
        const tunnelDir = new THREE.Vector3().subVectors(lastSp.position, firstSp.position);
        const tunnelLength = tunnelDir.length();
        tunnelDir.normalize();

        const maxHeight = 52;
        const baseRadius = 48;
        // Overburden top ≈ shoulderRise(4.4) + 7.2 + 11.5/2 = ~17.35
        // Place mountain body just above tunnel overburden to close the visual gap
        // Overburden top ≈ 17.35 — slight overlap is fine since slab is external
        const roofFloor = 17;
        const waterLevelY = -3.5; // seaside water level
        const baseY = waterLevelY - 1.8; // extend below water so visible skirt meets water line
        const mountainSides = [-1, 1];
        const slabRight = new THREE.Vector3().crossVectors(
            new THREE.Vector3(0, 1, 0),
            tunnelDir
        ).normalize();
        const slabProfiles = [];

        // ── Ridge slabs — full-width, placed ABOVE the tunnel structure ──
        // Keep slabs inside tunnel zone so they don't block portal openings
        const slabCount = 12;
        const extend = 0;
        const portalClearance = 22; // min distance from slab edge to portal plane
        for (let s = -1; s <= slabCount + 1; s++) {
            const t = s / slabCount;
            const posAlongTunnel = tunnelLength * t;
            const pos = firstSp.position.clone()
                .addScaledVector(tunnelDir, posAlongTunnel);

            const profileT = (s + 1) / (slabCount + 2);
            const pf = Math.sin(profileT * Math.PI);
            const slabH = Math.max(0, maxHeight * pf - roofFloor);
            // Cap width to prevent lateral intrusion on curved road sections
            const slabW = Math.min(baseRadius * (0.6 + 0.4 * pf) * 2, 56);

            if (slabH < 3) continue;

            const segDepth = tunnelLength / slabCount + 4;

            // Skip slabs whose geometry extends too close to portal openings
            const slabFront = posAlongTunnel - segDepth / 2;
            const slabBack = posAlongTunnel + segDepth / 2;
            if (slabFront < portalClearance || slabBack > tunnelLength - portalClearance) continue;

            // Main rock slab
            const slab = new THREE.Mesh(
                new THREE.BoxGeometry(slabW, slabH, segDepth),
                mountainMat
            );
            const slabY = midSp.position.y + roofFloor + slabH * 0.5;
            slab.position.set(pos.x, slabY, pos.z);
            slab.lookAt(pos.x + tunnelDir.x, slabY, pos.z + tunnelDir.z);
            slab.castShadow = true;
            slab.receiveShadow = true;
            this._addOccluder(slab);

            slabProfiles.push({
                pos: pos.clone(),
                pf,
                slabW,
                slabY,
                slabH,
                frameSp: this.sampledPoints[
                    mountainIndices[
                        Math.floor(profileT * (mountainIndices.length - 1))
                    ]
                ],
            });

            // Grass top
            const grassTop = new THREE.Mesh(
                new THREE.BoxGeometry(slabW * 0.95, 2.8, segDepth),
                grassMat
            );
            const grassY = slabY + slabH * 0.5 + 1.0;
            grassTop.position.set(pos.x, grassY, pos.z);
            grassTop.lookAt(pos.x + tunnelDir.x, grassY, pos.z + tunnelDir.z);
            grassTop.receiveShadow = true;
            this.group.add(grassTop);
        }

        for (const skirtSide of mountainSides) {
            this._buildTunnelMountainSkirt(slabProfiles, slabRight, mountainMat, {
                side: skirtSide,
                baseY,
            });
        }

        // ── Peaks — prominent cones above the ridge ──
        const peakHeight = 30;
        const peakCone = new THREE.Mesh(
            new THREE.ConeGeometry(34, peakHeight, 8),
            grassMat
        );
        peakCone.position.set(
            midSp.position.x,
            midSp.position.y + maxHeight * 0.6 + peakHeight * 0.35,
            midSp.position.z
        );
        peakCone.castShadow = true;
        peakCone.receiveShadow = true;
        this.group.add(peakCone);

        const ridgeOffsets = [-0.28, 0.32];
        for (const off of ridgeOffsets) {
            const rT = 0.5 + off;
            const rIdx = mountainIndices[Math.floor(THREE.MathUtils.clamp(rT, 0, 1) * (mountainIndices.length - 1))];
            const rSp = this.sampledPoints[rIdx];
            const rH = 20 + Math.abs(off) * 16;
            const rCone = new THREE.Mesh(
                new THREE.ConeGeometry(22, rH, 7),
                grassMat
            );
            rCone.position.set(
                rSp.position.x,
                rSp.position.y + maxHeight * 0.45 + rH * 0.35,
                rSp.position.z
            );
            rCone.castShadow = true;
            rCone.receiveShadow = true;
            this.group.add(rCone);
        }
    }

    _buildTunnelMountainSkirt(slabProfiles, slabRight, material, options = {}) {
        if (!slabProfiles?.length || !slabRight) return;

        const side = options.side ?? -1;
        const baseY = options.baseY ?? -5;
        const verts = [];
        const colors = [];
        const idx = [];

        for (let i = 0; i < slabProfiles.length; i++) {
            const { pos, pf, slabW, slabY, slabH, frameSp } = slabProfiles[i];
            const outerBias = 8 + pf * 6;
            const topOff = slabW * 0.5 + 2;
            const midOff = topOff + outerBias;
            const lowOff = midOff + 10 + pf * 6;
            const baseOff = lowOff + 14 + pf * 8;
            const shellHalf = (frameSp?.width ?? 0) * 0.5 + 16;

            const top = pos.clone().addScaledVector(slabRight, side * topOff);
            top.y = slabY - slabH * 0.5 + 1.0;
            const mid = pos.clone().addScaledVector(slabRight, side * midOff);
            mid.y = THREE.MathUtils.lerp(top.y, baseY, 0.28);
            const low = pos.clone().addScaledVector(slabRight, side * lowOff);
            low.y = THREE.MathUtils.lerp(top.y, baseY, 0.68);
            const bottom = pos.clone().addScaledVector(slabRight, side * baseOff);
            bottom.y = baseY;

            this._pushTunnelMountainVertexOutward(
                top,
                frameSp,
                side,
                Math.max(shellHalf + 6, topOff - 8)
            );
            this._pushTunnelMountainVertexOutward(
                mid,
                frameSp,
                side,
                Math.max(shellHalf + 18, midOff - 8)
            );
            this._pushTunnelMountainVertexOutward(
                low,
                frameSp,
                side,
                Math.max(shellHalf + 28, lowOff - 10)
            );
            this._pushTunnelMountainVertexOutward(
                bottom,
                frameSp,
                side,
                Math.max(shellHalf + 40, baseOff - 12)
            );

            verts.push(top.x, top.y, top.z);
            colors.push(0.36, 0.33, 0.28);
            verts.push(mid.x, mid.y, mid.z);
            colors.push(0.35, 0.32, 0.27);
            verts.push(low.x, low.y, low.z);
            colors.push(0.33, 0.30, 0.26);
            verts.push(bottom.x, bottom.y, bottom.z);
            colors.push(0.30, 0.27, 0.24);

            if (i > 0) {
                const prev = (i - 1) * 4;
                const cur = i * 4;
                for (let t = 0; t < 3; t++) {
                    const bl = prev + t;
                    const tl = prev + t + 1;
                    const br = cur + t;
                    const tr = cur + t + 1;
                    if (side > 0) {
                        idx.push(bl, br, tl, tl, br, tr);
                    } else {
                        idx.push(bl, br, tl, tl, br, tr);
                    }
                }
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.98,
            metalness: 0.01,
            side: THREE.FrontSide,
        }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    _pushTunnelMountainVertexOutward(point, frameSp, side, minOffset) {
        if (!point || !frameSp?.position || !frameSp?.right) return;

        const outwardSign = side >= 0 ? 1 : -1;
        const delta = point.clone().sub(frameSp.position);
        const lateral = delta.dot(frameSp.right);
        const target = outwardSign * minOffset;

        if (outwardSign * lateral >= minOffset) {
            return;
        }

        point.addScaledVector(frameSp.right, target - lateral);
    }

    _buildSeasideTunnel() {
        const tunnelZone = this.courseData?.zones?.tunnel?.[0];
        if (!tunnelZone) return;

        const startIdx = this._findSampleIndexAt(tunnelZone.start);
        const endIdx = this._findSampleIndexAt(tunnelZone.end);
        const indices = this._collectWrappedIndices(startIdx, endIdx);
        const shellMat = new THREE.MeshStandardMaterial({ color: 0x4f545a, roughness: 0.94 });
        const portalMat = new THREE.MeshStandardMaterial({ color: 0x6b625d, roughness: 0.96 });
        const lightMat = new THREE.MeshStandardMaterial({
            color: 0xf0cc78,
            emissive: 0xf0cc78,
            emissiveIntensity: 0.65,
            roughness: 0.45,
        });
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x756a5f, roughness: 0.98 });
        const grassMat = new THREE.MeshStandardMaterial({ color: 0x4d6f3c, roughness: 0.96 });
        const segmentStep = 1;

        if (indices.length) {
            const startSp = this.sampledPoints[indices[0]];
            const endSp = this.sampledPoints[indices[indices.length - 1]];
            this._buildTunnelPortal(startSp, portalMat);
            this._buildTunnelPortal(endSp, portalMat);
        }

        for (let i = 0; i < indices.length; i += segmentStep) {
            const sp = this.sampledPoints[indices[i]];
            const nextSp = this.sampledPoints[indices[Math.min(i + 1, indices.length - 1)]];
            const basis = new THREE.Matrix4().makeBasis(
                sp.right.clone().normalize(),
                sp.up.clone().normalize(),
                sp.forward.clone().normalize()
            );
            const archQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
            const clearanceMargin = 5.2;
            const sideOffset = sp.width * 0.5 + clearanceMargin;
            const lowerWallHeight = 2.8;
            const lowerWallThickness = 0.9;
            const shoulderWidth = 1.5;
            const shoulderHeight = 0.8;
            const shoulderRise = 4.4;
            const ceilingThickness = 1.45;
            const ceilingWidth = sp.width + clearanceMargin * 2 + 4.0;
            const sampleSpan = Math.max(2.8, sp.position.distanceTo(nextSp.position));
            const segmentLength = sampleSpan + 1.4;
            const outerRockWidth = sp.width + 30;
            const outerRockHeight = 16;

            // Skip heavy outer geometry near portal openings to keep entrances clear
            const portalMarginSamples = 4;
            const nearPortal = (i < portalMarginSamples || i > indices.length - 1 - portalMarginSamples);

            for (const side of [-1, 1]) {
                const lowerWall = new THREE.Mesh(
                    new THREE.BoxGeometry(lowerWallThickness, lowerWallHeight, segmentLength),
                    shellMat
                );
                lowerWall.position.copy(sp.position)
                    .addScaledVector(sp.right, side * sideOffset)
                    .addScaledVector(sp.up, lowerWallHeight * 0.5);
                lowerWall.quaternion.copy(archQuat);
                lowerWall.castShadow = true;
                this.group.add(lowerWall);

                const shoulder = new THREE.Mesh(
                    new THREE.BoxGeometry(shoulderWidth, shoulderHeight, segmentLength),
                    shellMat
                );
                shoulder.position.copy(sp.position)
                    .addScaledVector(sp.right, side * (sp.width * 0.5 + clearanceMargin + 0.4))
                    .addScaledVector(sp.up, shoulderRise);
                shoulder.quaternion.copy(archQuat);
                shoulder.rotateZ(side * -0.62);
                shoulder.castShadow = true;
                this.group.add(shoulder);

                if (!nearPortal) {
                    const sideRock = new THREE.Mesh(
                        new THREE.BoxGeometry(7.2, outerRockHeight, segmentLength + 1.2),
                        rockMat
                    );
                    sideRock.position.copy(sp.position)
                        .addScaledVector(sp.right, side * (sp.width * 0.5 + 15.5))
                        .addScaledVector(sp.up, 7.8);
                    sideRock.quaternion.copy(archQuat);
                    sideRock.castShadow = true;
                    sideRock.receiveShadow = true;
                    this.group.add(sideRock);
                }
            }

            const ceiling = new THREE.Mesh(
                new THREE.BoxGeometry(ceilingWidth, ceilingThickness, segmentLength),
                shellMat
            );
            ceiling.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 1.15);
            ceiling.quaternion.copy(archQuat);
            ceiling.castShadow = true;
            this._addOccluder(ceiling);

            if (!nearPortal) {
                const overburden = new THREE.Mesh(
                    new THREE.BoxGeometry(outerRockWidth, 11.5, segmentLength + 2.8),
                    rockMat
                );
                overburden.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 7.2);
                overburden.quaternion.copy(archQuat);
                overburden.castShadow = true;
                overburden.receiveShadow = true;
                this._addOccluder(overburden);

                const canopy = new THREE.Mesh(
                    new THREE.BoxGeometry(sp.width + 8, 3.4, segmentLength + 1.2),
                    rockMat
                );
                canopy.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 3.4);
                canopy.quaternion.copy(archQuat);
                canopy.castShadow = true;
                canopy.receiveShadow = true;
                this._addOccluder(canopy);
            }

            const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.1), lightMat);
            lamp.position.copy(sp.position).addScaledVector(sp.up, shoulderRise - 0.2);
            lamp.quaternion.copy(archQuat);
            lamp.renderOrder = 1;
            this.group.add(lamp);
        }
    }

    _buildTunnelPortal(sp, material) {
        const basis = new THREE.Matrix4().makeBasis(
            sp.right.clone().normalize(),
            sp.up.clone().normalize(),
            sp.forward.clone().normalize()
        );
        const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
        const portalClearance = 6.2;
        const pillarX = sp.width * 0.5 + portalClearance;

        // Portal frame: pillars + lintel (defines the opening)
        const pieces = [
            { x: -pillarX, y: 2.6, w: 2.4, h: 5.2 },
            { x: pillarX, y: 2.6, w: 2.4, h: 5.2 },
            { x: 0, y: 6.0, w: sp.width + portalClearance * 2 + 2.2, h: 2.2 },
        ];
        for (let pi = 0; pi < pieces.length; pi++) {
            const piece = pieces[pi];
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(piece.w, piece.h, 2.2),
                material
            );
            mesh.position.copy(sp.position)
                .addScaledVector(sp.right, piece.x)
                .addScaledVector(sp.up, piece.y);
            mesh.quaternion.copy(quat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (pi === 2) {
                this._addOccluder(mesh);
            } else {
                this.group.add(mesh);
            }
        }

        // ── Coastal cliff face ──
        // All elements placed ABOVE lintel top (y>7.1) or OUTSIDE pillars
        const cliffMat = new THREE.MeshStandardMaterial({ color: 0x6e6359, roughness: 0.98 });
        const grassMat = new THREE.MeshStandardMaterial({ color: 0x4d6f3c, roughness: 0.96 });
        const lintelTop = 7.1;
        const cliffDepth = 8;

        // Cliff face above the opening
        const cliffFaceH = 18;
        const cliffFaceY = lintelTop + cliffFaceH * 0.5;
        const cliffFace = new THREE.Mesh(
            new THREE.BoxGeometry(sp.width + 50, cliffFaceH, cliffDepth),
            cliffMat
        );
        cliffFace.position.copy(sp.position).addScaledVector(sp.up, cliffFaceY);
        cliffFace.quaternion.copy(quat);
        cliffFace.castShadow = true;
        cliffFace.receiveShadow = true;
        this.group.add(cliffFace);

        // Grass cap on top of cliff
        const grassCap = new THREE.Mesh(
            new THREE.BoxGeometry(sp.width + 54, 1.5, cliffDepth + 2),
            grassMat
        );
        grassCap.position.copy(sp.position).addScaledVector(sp.up, lintelTop + cliffFaceH + 0.5);
        grassCap.quaternion.copy(quat);
        grassCap.receiveShadow = true;
        this.group.add(grassCap);

        // Side buttresses: tall cliff walls flanking the portal (outside the opening)
        for (const side of [-1, 1]) {
            const buttressW = 14;
            const buttressH = 26;
            const buttressX = pillarX + buttressW * 0.5 + 1.0;
            const buttress = new THREE.Mesh(
                new THREE.BoxGeometry(buttressW, buttressH, cliffDepth),
                cliffMat
            );
            buttress.position.copy(sp.position)
                .addScaledVector(sp.right, side * buttressX)
                .addScaledVector(sp.up, buttressH * 0.5 - 2);
            buttress.quaternion.copy(quat);
            buttress.castShadow = true;
            buttress.receiveShadow = true;
            this.group.add(buttress);

            // Grass on top of buttress
            const bGrass = new THREE.Mesh(
                new THREE.BoxGeometry(buttressW + 2, 1.2, cliffDepth + 2),
                grassMat
            );
            bGrass.position.copy(sp.position)
                .addScaledVector(sp.right, side * buttressX)
                .addScaledVector(sp.up, buttressH - 2 + 0.6);
            bGrass.quaternion.copy(quat);
            bGrass.receiveShadow = true;
            this.group.add(bGrass);

            // Outer slope: wider, lower rock extending outward from buttress
            const slopeW = 18;
            const slopeH = 16;
            const slope = new THREE.Mesh(
                new THREE.BoxGeometry(slopeW, slopeH, cliffDepth - 1),
                cliffMat
            );
            slope.position.copy(sp.position)
                .addScaledVector(sp.right, side * (buttressX + buttressW * 0.5 + slopeW * 0.5 - 2))
                .addScaledVector(sp.up, slopeH * 0.5 - 3);
            slope.quaternion.copy(quat);
            slope.castShadow = true;
            slope.receiveShadow = true;
            this.group.add(slope);
        }
    }

    _buildTunnelPortalMountainExterior(sp, exteriorSign, rockMat, grassMat) {
        if (!sp || !exteriorSign) return;

        const portalHalfWidth = sp.width * 0.5 + 6.2;
        const portalPlaneGap = 18.0;
        const keepoutHalfWidth = portalHalfWidth + 8.5;
        const rings = [
            {
                z: portalPlaneGap,
                landToe: portalHalfWidth + 18,
                landShoulder: portalHalfWidth + 12,
                landBaseY: 14.0,
                landShoulderY: 23.5,
                leftOuterTop: portalHalfWidth + 10,
                leftOuterTopY: 27.2,
                leftKeepout: keepoutHalfWidth + 1.5,
                keepoutY: 28.4,
                apexX: -2.0,
                topY: 30.8,
                rightKeepout: keepoutHalfWidth + 1.0,
                rightOuterTop: portalHalfWidth + 7,
                rightOuterTopY: 26.6,
                seaShoulder: portalHalfWidth + 9,
                seaToe: portalHalfWidth + 14,
                seaShoulderY: 22.6,
                seaBaseY: 14.0,
            },
            {
                z: portalPlaneGap + 16,
                landToe: portalHalfWidth + 40,
                landShoulder: portalHalfWidth + 28,
                landBaseY: 0.0,
                landShoulderY: 26.0,
                leftOuterTop: portalHalfWidth + 18,
                leftOuterTopY: 29.4,
                leftKeepout: keepoutHalfWidth + 4.5,
                keepoutY: 29.8,
                apexX: -5.5,
                topY: 31.6,
                rightKeepout: keepoutHalfWidth + 3.0,
                rightOuterTop: portalHalfWidth + 11,
                rightOuterTopY: 27.8,
                seaShoulder: portalHalfWidth + 16,
                seaToe: portalHalfWidth + 24,
                seaShoulderY: 23.4,
                seaBaseY: 0.0,
            },
            {
                z: portalPlaneGap + 34,
                landToe: portalHalfWidth + 76,
                landShoulder: portalHalfWidth + 54,
                landBaseY: -3.5,
                landShoulderY: 28.8,
                leftOuterTop: portalHalfWidth + 30,
                leftOuterTopY: 31.6,
                leftKeepout: keepoutHalfWidth + 7.0,
                keepoutY: 29.0,
                apexX: -10.0,
                topY: 32.2,
                rightKeepout: keepoutHalfWidth + 5.0,
                rightOuterTop: portalHalfWidth + 18,
                rightOuterTopY: 27.6,
                seaShoulder: portalHalfWidth + 24,
                seaToe: portalHalfWidth + 38,
                seaShoulderY: 20.5,
                seaBaseY: -3.5,
            },
            {
                z: portalPlaneGap + 54,
                landToe: portalHalfWidth + 102,
                landShoulder: portalHalfWidth + 72,
                landBaseY: -5.0,
                landShoulderY: 31.2,
                leftOuterTop: portalHalfWidth + 36,
                leftOuterTopY: 34.0,
                leftKeepout: keepoutHalfWidth + 9.0,
                keepoutY: 31.0,
                apexX: -15.0,
                topY: 33.0,
                rightKeepout: keepoutHalfWidth + 7.0,
                rightOuterTop: portalHalfWidth + 22,
                rightOuterTopY: 29.0,
                seaShoulder: portalHalfWidth + 22,
                seaToe: portalHalfWidth + 38,
                seaShoulderY: 21.0,
                seaBaseY: -5.0,
            },
            {
                z: portalPlaneGap + 76,
                landToe: portalHalfWidth + 128,
                landShoulder: portalHalfWidth + 92,
                landBaseY: -5.0,
                landShoulderY: 34.0,
                leftOuterTop: portalHalfWidth + 42,
                leftOuterTopY: 36.4,
                leftKeepout: keepoutHalfWidth + 11.0,
                keepoutY: 33.2,
                apexX: -18.0,
                topY: 36.0,
                rightKeepout: keepoutHalfWidth + 9.0,
                rightOuterTop: portalHalfWidth + 26,
                rightOuterTopY: 31.2,
                seaShoulder: portalHalfWidth + 26,
                seaToe: portalHalfWidth + 46,
                seaShoulderY: 23.5,
                seaBaseY: -5.0,
            },
        ];
        const profilePointCount = 9;
        const rockVerts = [];
        const rockIdx = [];
        const grassVerts = [];
        const grassIdx = [];
        const topLift = 0.18;

        const toWorld = (x, y, z) => sp.position.clone()
            .addScaledVector(sp.right, x)
            .addScaledVector(sp.up, y)
            .addScaledVector(sp.forward, exteriorSign * z);
        const pushVertex = (target, vec) => {
            target.push(vec.x, vec.y, vec.z);
        };

        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            const profile = [
                { x: -ring.landToe,      y: ring.landBaseY },
                { x: -ring.landShoulder, y: ring.landShoulderY },
                { x: -ring.leftOuterTop, y: ring.leftOuterTopY },
                { x: -ring.leftKeepout,  y: ring.keepoutY },
                { x: ring.apexX,         y: ring.topY },
                { x: ring.rightKeepout,  y: ring.keepoutY - 0.4 },
                { x: ring.rightOuterTop, y: ring.rightOuterTopY },
                { x: ring.seaShoulder,   y: ring.seaShoulderY },
                { x: ring.seaToe,        y: ring.seaBaseY },
            ];

            for (const pt of profile) {
                pushVertex(rockVerts, toWorld(pt.x, pt.y, ring.z));
            }

            pushVertex(grassVerts, toWorld(-ring.leftKeepout, ring.keepoutY + topLift, ring.z));
            pushVertex(grassVerts, toWorld(ring.apexX, ring.topY + 0.55 + topLift, ring.z));
            pushVertex(grassVerts, toWorld(ring.rightKeepout, ring.keepoutY - 0.15 + topLift, ring.z));
        }

        for (let i = 0; i < rings.length - 1; i++) {
            const cur = i * profilePointCount;
            const next = (i + 1) * profilePointCount;
            for (let j = 0; j < profilePointCount - 1; j++) {
                const a = cur + j;
                const b = cur + j + 1;
                const c = next + j;
                const d = next + j + 1;
                rockIdx.push(a, c, b, b, c, d);
            }

            const gCur = i * 3;
            const gNext = (i + 1) * 3;
            rockIdx.push(cur, next, next + 6, cur, next + 6, cur + 6);
            for (let j = 0; j < 2; j++) {
                const a = gCur + j;
                const b = gCur + j + 1;
                const c = gNext + j;
                const d = gNext + j + 1;
                grassIdx.push(a, c, b, b, c, d);
            }
        }

        // Front face cap removed to keep portal opening clear

        const backBase = (rings.length - 1) * profilePointCount;
        for (let j = 1; j < profilePointCount - 1; j++) {
            rockIdx.push(backBase, backBase + j, backBase + j + 1);
        }

        const rockGeo = new THREE.BufferGeometry();
        rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(rockVerts, 3));
        rockGeo.setIndex(rockIdx);
        rockGeo.computeVertexNormals();

        const rockExteriorMat = rockMat.clone();
        rockExteriorMat.side = THREE.DoubleSide;
        const rockMesh = new THREE.Mesh(rockGeo, rockExteriorMat);
        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        // Exterior shell only: all vertices are placed outside the portal plane.
        this.group.add(rockMesh);

        const grassGeo = new THREE.BufferGeometry();
        grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(grassVerts, 3));
        grassGeo.setIndex(grassIdx);
        grassGeo.computeVertexNormals();

        const grassExteriorMat = grassMat.clone();
        grassExteriorMat.side = THREE.DoubleSide;
        const grassMesh = new THREE.Mesh(grassGeo, grassExteriorMat);
        grassMesh.castShadow = false;
        grassMesh.receiveShadow = true;
        this.group.add(grassMesh);
    }

    _getSafeSceneryPosition(position, clearance = 16) {
        if (!this.sampledPoints.length) {
            return position.clone();
        }

        const safePos = position.clone();
        for (let i = 0; i < 4; i++) {
            const nearest = this.getNearest(safePos, 0);
            const requiredOffset = nearest.halfWidth + clearance;
            const lateralAbs = Math.abs(nearest.lateralOffset);
            if (lateralAbs >= requiredOffset) {
                return safePos;
            }

            const side = nearest.lateralOffset >= 0 ? 1 : -1;
            const offsetDelta = requiredOffset - lateralAbs;
            safePos.addScaledVector(nearest.sp.right, side * (offsetDelta + clearance * 0.35));
        }
        return safePos;
    }

    _buildMountainScenery() {
        this._buildMountainTerrain();
        this._buildMountainPeaks();
        this._buildMountainForest();
        this._buildMountainBridge();
        this._buildMountainCastle();
        this._buildMountainWaterfall();
        this._buildMountainCloudSea();
        this._buildMountainJumpRamps();
    }

    _buildCurveWarningSigns() {
        const profile = {
            thunder: {
                threshold: 0.72,
                sCurveThreshold: 0.50,
                leadMeters: 52,
                sCurveLeadMeters: 60,
                signSpacingMeters: 24,
                minSpacingMeters: 200,
                maxZoneShiftMeters: 36,
                sCurveMaxGapMeters: 200,
                lateralOffset: 6.2,
                boardWidth: 10.0,
                boardHeight: 4.0,
                postHeight: 3.6,
                minSigns: 2,
                maxSigns: 3,
                sCurveMinSigns: 1,
                sCurveMaxSigns: 2,
                severityRef: 1.10,
                sCurveSeverityRef: 0.98,
                skipPeakZoneKeys: [],
                avoidSignZoneKeys: [],
            },
            seaside: {
                threshold: 0.9,
                sCurveThreshold: 0.59,
                leadMeters: 48,
                sCurveLeadMeters: 56,
                signSpacingMeters: 22,
                minSpacingMeters: 180,
                maxZoneShiftMeters: 32,
                sCurveMaxGapMeters: 180,
                lateralOffset: 5.8,
                boardWidth: 9.5,
                boardHeight: 3.9,
                postHeight: 3.5,
                minSigns: 2,
                maxSigns: 3,
                sCurveMinSigns: 1,
                sCurveMaxSigns: 2,
                severityRef: 1.14,
                sCurveSeverityRef: 1.02,
                skipPeakZoneKeys: ['tunnel'],
                avoidSignZoneKeys: ['tunnel'],
            },
            mountain: {
                threshold: 0.95,
                sCurveThreshold: 0.66,
                leadMeters: 44,
                sCurveLeadMeters: 48,
                signSpacingMeters: 18,
                minSpacingMeters: 165,
                maxZoneShiftMeters: 28,
                sCurveMaxGapMeters: 230,
                lateralOffset: 4.9,
                boardWidth: 8.8,
                boardHeight: 3.6,
                postHeight: 3.35,
                minSigns: 2,
                maxSigns: 4,
                sCurveMinSigns: 1,
                sCurveMaxSigns: 2,
                severityRef: 1.18,
                sCurveSeverityRef: 1.04,
                skipPeakZoneKeys: ['tunnel'],
                avoidSignZoneKeys: ['tunnel', 'mist'],
            },
        }[this.courseData?.id];

        if (!profile || this.sampledPoints.length < 8) return;

        const candidates = this._findCurveWarningCandidates(profile);
        for (const candidate of candidates) {
            const turnSign = candidate.turnSign ?? (Math.sign(candidate.signedCurve) || 1);
            const side = candidate.side ?? -turnSign;
            for (const signIndex of candidate.signIndices) {
                const sp = this.sampledPoints[signIndex];
                if (!sp) continue;
                this._createCurveWarningSign(sp, turnSign, side, profile, candidate.signType);
            }
        }
    }

    _findCurveWarningCandidates(profile) {
        const N = this.sampledPoints.length;
        const metersPerSample = this.courseLength / Math.max(1, N);
        const leadSamples = Math.max(10, Math.round(profile.leadMeters / Math.max(1e-3, metersPerSample)));
        const signSpacingSamples = Math.max(7, Math.round(profile.signSpacingMeters / Math.max(1e-3, metersPerSample)));
        const minSpacingSamples = Math.max(20, Math.round(profile.minSpacingMeters / Math.max(1e-3, metersPerSample)));
        const maxZoneShiftSamples = Math.max(
            2,
            Math.round((profile.maxZoneShiftMeters ?? (profile.signSpacingMeters * 1.5)) / Math.max(1e-3, metersPerSample))
        );
        const lookAheadOffsets = [4, 8, 14, 20];
        const peakWindow = 4;
        const skipPeakZones = this._collectCourseZones(profile.skipPeakZoneKeys);
        const avoidSignZones = this._collectCourseZones(profile.avoidSignZoneKeys);
        const curves = new Array(N).fill(0);
        const signedCurves = new Array(N).fill(0);
        const cross = new THREE.Vector3();

        for (let i = 0; i < N; i++) {
            const a = this.sampledPoints[i].forward;
            let curvePeak = 0;
            let weighted = 0;
            let signedWeighted = 0;
            let weightSum = 0;

            for (let k = 0; k < lookAheadOffsets.length; k++) {
                const off = lookAheadOffsets[k];
                const b = this.sampledPoints[(i + off) % N].forward;
                const c = a.angleTo(b);
                const w = 1 + k * 0.28;
                curvePeak = Math.max(curvePeak, c);
                weighted += c * w;
                weightSum += w;
                cross.crossVectors(a, b);
                signedWeighted += Math.sign(cross.y || 0) * c * w;
            }

            const curveAvg = weightSum > 0 ? weighted / weightSum : 0;
            curves[i] = curvePeak * 0.62 + curveAvg * 0.38;
            signedCurves[i] = weightSum > 0 ? signedWeighted / weightSum : 0;
        }

        const peakThreshold = Math.min(profile.threshold, profile.sCurveThreshold ?? profile.threshold);
        const peaks = this._collectCurveWarningPeaks(curves, signedCurves, peakThreshold, skipPeakZones, peakWindow);
        const sCurveCandidates = this._buildSCurveWarningCandidates(peaks, profile, {
            metersPerSample,
            signSpacingSamples,
            maxZoneShiftSamples,
            avoidSignZones,
        });
        const sCurvePeakIndices = new Set(
            sCurveCandidates.flatMap(candidate => candidate.componentPeakIndices || [])
        );
        const sharpCandidates = [];

        for (const peak of peaks) {
            if (peak.curvature < profile.threshold) continue;
            if (sCurvePeakIndices.has(peak.index)) continue;

            const signIndex = (peak.index - leadSamples + N) % N;
            const severityN = THREE.MathUtils.clamp(
                (peak.curvature - profile.threshold) / Math.max(1e-3, profile.severityRef - profile.threshold),
                0,
                1
            );
            const signCount = Math.max(
                profile.minSigns,
                Math.min(
                    profile.maxSigns,
                    Math.round(THREE.MathUtils.lerp(profile.minSigns, profile.maxSigns, severityN))
                )
            );
            const signIndices = [];
            for (let s = signCount - 1; s >= 0; s--) {
                signIndices.push((signIndex - s * signSpacingSamples + N) % N);
            }
            const shiftedSamples = this._shiftIndicesOutOfZones(signIndices, avoidSignZones, maxZoneShiftSamples);
            if (shiftedSamples == null) continue;

            const turnSign = Math.sign(peak.signedCurve) || 1;
            sharpCandidates.push({
                ...peak,
                signType: 'curve',
                turnSign,
                side: -turnSign,
                signIndex,
                signIndices,
                signCount,
                severityN,
                selectionScore: peak.curvature,
            });
        }

        const candidates = [...sharpCandidates, ...sCurveCandidates];
        candidates.sort((a, b) => (b.selectionScore ?? b.curvature) - (a.selectionScore ?? a.curvature));

        const selected = [];
        for (const candidate of candidates) {
            const tooClose = selected.some(item =>
                this._getWrappedSampleDistance(item.index, candidate.index) < minSpacingSamples
                || candidate.signIndices.some(signIdx =>
                    item.signIndices.some(otherSignIdx =>
                        this._getWrappedSampleDistance(otherSignIdx, signIdx) < Math.round(signSpacingSamples * 1.15)
                    )
                )
            );
            if (!tooClose) selected.push(candidate);
        }

        return selected.sort((a, b) => a.signIndex - b.signIndex);
    }

    _collectCurveWarningPeaks(curves, signedCurves, threshold, skipPeakZones, peakWindow) {
        const N = this.sampledPoints.length;
        const peaks = [];

        for (let i = 0; i < N; i++) {
            if (curves[i] < threshold) continue;
            if (this._isSampleIndexInZones(i, skipPeakZones)) continue;

            let isPeak = true;
            for (let j = 1; j <= peakWindow; j++) {
                if (curves[(i - j + N) % N] > curves[i] || curves[(i + j) % N] > curves[i]) {
                    isPeak = false;
                    break;
                }
            }
            if (!isPeak) continue;

            peaks.push({
                index: i,
                curvature: curves[i],
                signedCurve: signedCurves[i],
            });
        }

        return peaks.sort((a, b) => a.index - b.index);
    }

    _buildSCurveWarningCandidates(peaks, profile, options = {}) {
        if (!profile.sCurveThreshold) return [];

        const {
            metersPerSample = 1,
            signSpacingSamples = 7,
            maxZoneShiftSamples = Infinity,
            avoidSignZones = [],
        } = options;

        const N = this.sampledPoints.length;
        const gapSamples = Math.max(
            signSpacingSamples + 2,
            Math.round((profile.sCurveMaxGapMeters ?? (profile.signSpacingMeters * 6)) / Math.max(1e-3, metersPerSample))
        );
        const leadSamples = Math.max(
            10,
            Math.round((profile.sCurveLeadMeters ?? profile.leadMeters) / Math.max(1e-3, metersPerSample))
        );
        const eligible = peaks.filter(peak =>
            peak.curvature >= profile.sCurveThreshold && Math.sign(peak.signedCurve) !== 0
        );
        const pairCandidates = [];

        for (let i = 0; i < eligible.length; i++) {
            const first = eligible[i];

            for (let j = i + 1; j < eligible.length; j++) {
                const second = eligible[j];
                const sampleGap = second.index - first.index;
                if (sampleGap > gapSamples) break;
                if (Math.sign(first.signedCurve) === Math.sign(second.signedCurve)) continue;

                const signIndex = (first.index - leadSamples + N) % N;
                const severityCurve = Math.max(first.curvature, second.curvature);
                const severityN = THREE.MathUtils.clamp(
                    (severityCurve - profile.sCurveThreshold) / Math.max(1e-3, profile.sCurveSeverityRef - profile.sCurveThreshold),
                    0,
                    1
                );
                const signCount = Math.max(
                    profile.sCurveMinSigns,
                    Math.min(
                        profile.sCurveMaxSigns,
                        Math.round(THREE.MathUtils.lerp(profile.sCurveMinSigns, profile.sCurveMaxSigns, severityN))
                    )
                );
                const signIndices = [];
                for (let s = signCount - 1; s >= 0; s--) {
                    signIndices.push((signIndex - s * signSpacingSamples + N) % N);
                }
                const shiftedSamples = this._shiftIndicesOutOfZones(signIndices, avoidSignZones, maxZoneShiftSamples);
                if (shiftedSamples == null) continue;

                const turnSign = Math.sign(first.signedCurve) || 1;
                const gapPenalty = sampleGap / Math.max(1, gapSamples);
                const shiftPenalty = shiftedSamples / Math.max(1, maxZoneShiftSamples);
                pairCandidates.push({
                    index: first.index,
                    pairIndex: second.index,
                    curvature: severityCurve,
                    signedCurve: first.signedCurve,
                    signType: 'sCurve',
                    turnSign,
                    side: -turnSign,
                    signIndex,
                    signIndices,
                    signCount,
                    severityN,
                    componentPeakIndices: [first.index, second.index],
                    selectionScore: severityCurve * 1.32
                        + Math.min(first.curvature, second.curvature) * 0.74
                        - gapPenalty * 0.14
                        - shiftPenalty * 0.08,
                });
            }
        }

        pairCandidates.sort((a, b) => b.selectionScore - a.selectionScore);

        const selected = [];
        const usedPeakIndices = new Set();
        for (const candidate of pairCandidates) {
            if (candidate.componentPeakIndices.some(index => usedPeakIndices.has(index))) continue;
            selected.push(candidate);
            for (const index of candidate.componentPeakIndices) {
                usedPeakIndices.add(index);
            }
        }

        return selected;
    }

    _getWrappedSampleDistance(a, b) {
        const N = this.sampledPoints.length;
        const diff = Math.abs(a - b);
        return Math.min(diff, N - diff);
    }

    _collectCourseZones(zoneKeys = []) {
        const out = [];
        for (const key of zoneKeys || []) {
            const zones = this.courseData?.zones?.[key] || [];
            for (const zone of zones) {
                out.push(zone);
            }
        }
        return out;
    }

    _isSampleIndexInZones(index, zones = []) {
        const sp = this.sampledPoints[index];
        if (!sp) return false;
        return this._isTInAnyZone(sp.t, zones);
    }

    _isTInAnyZone(t, zones = []) {
        for (const zone of zones || []) {
            if (this._isTInZone(t, zone.start, zone.end)) {
                return true;
            }
        }
        return false;
    }

    _shiftIndicesOutOfZones(indices, zones = [], maxShiftSamples = Infinity) {
        if (!indices?.length || !zones?.length || !this.sampledPoints.length) return 0;

        const N = this.sampledPoints.length;
        let guard = 0;
        while (
            indices.some(index => this._isSampleIndexInZones(index, zones))
            && guard < N
            && guard < maxShiftSamples
        ) {
            for (let i = 0; i < indices.length; i++) {
                indices[i] = (indices[i] - 1 + N) % N;
            }
            guard++;
        }
        return indices.some(index => this._isSampleIndexInZones(index, zones)) ? null : guard;
    }

    _createCurveWarningSign(sp, turnSign, side, profile, signType = 'curve') {
        const signGroup = new THREE.Group();
        const boardTexture = this._getCurveWarningSignTexture(signType, turnSign);
        const postMat = new THREE.MeshStandardMaterial({
            color: 0x62686e,
            roughness: 0.54,
            metalness: 0.55,
        });
        const backMat = new THREE.MeshStandardMaterial({
            color: 0xcfd4d6,
            roughness: 0.72,
            metalness: 0.08,
        });
        const boardMat = new THREE.MeshStandardMaterial({
            map: boardTexture,
            roughness: 0.66,
            metalness: 0.02,
            transparent: true,
        });

        const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.14, profile.postHeight, 10),
            postMat
        );
        post.position.y = profile.postHeight * 0.5;
        post.castShadow = true;
        signGroup.add(post);

        const backPlate = new THREE.Mesh(
            new THREE.BoxGeometry(profile.boardWidth + 0.45, profile.boardHeight + 0.4, 0.18),
            backMat
        );
        backPlate.position.set(0, profile.postHeight + 0.4, -0.06);
        backPlate.castShadow = true;
        signGroup.add(backPlate);

        const board = new THREE.Mesh(
            new THREE.PlaneGeometry(profile.boardWidth, profile.boardHeight),
            boardMat
        );
        board.position.set(0, profile.postHeight + 0.4, 0.04);
        board.castShadow = true;
        signGroup.add(board);

        const targetPos = sp.position.clone()
            .addScaledVector(sp.right, side * (sp.width * 0.5 + profile.lateralOffset));
        targetPos.y += 0.1;
        signGroup.position.copy(targetPos);

        const worldUp = new THREE.Vector3(0, 1, 0);
        const facing = sp.forward.clone()
            .multiplyScalar(-1)
            .addScaledVector(sp.right, -side * 0.22)
            .normalize();
        const xAxis = new THREE.Vector3().crossVectors(worldUp, facing).normalize();
        const yAxis = new THREE.Vector3().crossVectors(facing, xAxis).normalize();
        signGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, facing));

        signGroup.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.receiveShadow = true;
        });

        this.group.add(signGroup);
    }

    _getCurveWarningSignTexture(signType, turnSign) {
        const key = `${signType}-${turnSign >= 0 ? 'right' : 'left'}`;
        if (this._curveSignTextureCache.has(key)) {
            return this._curveSignTextureCache.get(key);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 224;
        const ctx = canvas.getContext('2d');
        const dir = turnSign >= 0 ? -1 : 1;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f3d24f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 18;
        ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 26;

        if (signType === 'sCurve') {
            const start = { x: 256 - dir * 22, y: 34 };
            const cp1 = { x: 256 + dir * 124, y: 56 };
            const cp2 = { x: 256 + dir * 132, y: 88 };
            const mid = { x: 256 + dir * 10, y: 110 };
            const cp3 = { x: 256 - dir * 124, y: 134 };
            const cp4 = { x: 256 - dir * 132, y: 166 };
            const end = { x: 256 - dir * 18, y: 192 };

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, mid.x, mid.y);
            ctx.bezierCurveTo(cp3.x, cp3.y, cp4.x, cp4.y, end.x, end.y);
            ctx.stroke();

            const tail = this._sampleCubicBezierPoint(mid, cp3, cp4, end, 0.96);
            const prev = this._sampleCubicBezierPoint(mid, cp3, cp4, end, 0.82);
            const arrowDir = new THREE.Vector2(tail.x - prev.x, tail.y - prev.y).normalize();
            const arrowBase = new THREE.Vector2(end.x, end.y).addScaledVector(arrowDir, -8);
            const arrowSide = new THREE.Vector2(-arrowDir.y, arrowDir.x).multiplyScalar(16);

            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(arrowBase.x + arrowSide.x, arrowBase.y + arrowSide.y);
            ctx.lineTo(arrowBase.x - arrowSide.x, arrowBase.y - arrowSide.y);
            ctx.closePath();
            ctx.fillStyle = '#181818';
            ctx.fill();
        } else {
            const centers = [156, 256, 356];
            for (const cx of centers) {
                ctx.beginPath();
                ctx.moveTo(cx + dir * 42, 52);
                ctx.lineTo(cx - dir * 12, 112);
                ctx.lineTo(cx + dir * 42, 172);
                ctx.stroke();
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        this._curveSignTextureCache.set(key, texture);
        return texture;
    }

    _sampleCubicBezierPoint(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        const w0 = mt2 * mt;
        const w1 = 3 * mt2 * t;
        const w2 = 3 * mt * t2;
        const w3 = t2 * t;

        return {
            x: p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
            y: p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
        };
    }

    _buildMountainTerrain() {
        const N = this.sampledPoints.length;
        const step = 2;
        const baseY = -26;
        const edgeOffset = 1.5;
        const LEVELS = 4;
        const lateralSpread = [0, 8, 14, 18];
        // grass green → grey rock → dark rock
        const levelColors = [
            [0.29, 0.43, 0.23],
            [0.36, 0.40, 0.35],
            [0.42, 0.46, 0.41],
            [0.30, 0.33, 0.31],
        ];
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.94,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });

        for (const side of [-1, 1]) {
            const vertices = [];
            const colors = [];
            const indices = [];
            let segCount = 0;

            for (let i = 0; i <= N; i += step) {
                const sp = this.sampledPoints[i % N];
                const halfW = sp.width / 2;
                const edgeY = sp.position.y;

                for (let lv = 0; lv < LEVELS; lv++) {
                    const t = lv / (LEVELS - 1);
                    const y = THREE.MathUtils.lerp(edgeY, baseY, t);
                    const lateral = halfW + edgeOffset + lateralSpread[lv];
                    const pos = sp.position.clone()
                        .addScaledVector(sp.right, side * lateral);
                    pos.y = y;
                    vertices.push(pos.x, pos.y, pos.z);
                    const c = levelColors[lv];
                    colors.push(c[0], c[1], c[2]);
                }

                if (segCount > 0) {
                    const prev = (segCount - 1) * LEVELS;
                    const curr = segCount * LEVELS;
                    for (let lv = 0; lv < LEVELS - 1; lv++) {
                        const bl = prev + lv;
                        const br = prev + lv + 1;
                        const tl = curr + lv;
                        const tr = curr + lv + 1;
                        if (side > 0) {
                            indices.push(bl, tl, br, br, tl, tr);
                        } else {
                            indices.push(bl, br, tl, tl, br, tr);
                        }
                    }
                }
                segCount++;
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            geo.setIndex(indices);
            geo.computeVertexNormals();

            const mesh = new THREE.Mesh(geo, mat);
            mesh.receiveShadow = true;
            this.group.add(mesh);
        }
    }

    _buildMountainPeaks() {
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x768079, roughness: 0.95, metalness: 0.05 });
        const peakPositions = [
            [-420, -180, 150], [-360, 260, 190], [-120, 430, 170], [180, 420, 210], [430, 210, 165], [460, -100, 180], [120, -420, 140],
        ];
        for (const [x, z, h] of peakPositions) {
            const peak = new THREE.Mesh(new THREE.ConeGeometry(70, h, 7), rockMat);
            peak.position.set(x, h * 0.5 - 6, z);
            peak.castShadow = true;
            peak.receiveShadow = true;
            this.group.add(peak);
        }
    }

    _buildMountainForest() {
        const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5e3f23, roughness: 0.9 });
        const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x356a34, roughness: 0.95 });
        for (let i = 0; i < 42; i++) {
            const ang = (i / 42) * Math.PI * 2;
            const radius = 300 + (i % 6) * 30;
            const tx = Math.cos(ang) * radius;
            const tz = Math.sin(ang) * radius;
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9, 6), treeTrunkMat);
            trunk.position.set(tx, 0.5, tz);
            this.group.add(trunk);
            const crown = new THREE.Mesh(new THREE.ConeGeometry(4.5, 11, 6), treeLeafMat);
            crown.position.set(tx, 9.5, tz);
            this.group.add(crown);
        }
    }

    _buildMountainBridge() {
        const bridge = new THREE.Mesh(
            new THREE.BoxGeometry(120, 2.4, 24),
            new THREE.MeshStandardMaterial({ color: 0x91857a, roughness: 0.9 })
        );
        bridge.position.set(230, 38, 150);
        bridge.rotation.y = -0.52;
        bridge.castShadow = true;
        bridge.receiveShadow = true;
        this.group.add(bridge);

        for (const side of [-1, 1]) {
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(120, 2, 1.2),
                new THREE.MeshStandardMaterial({ color: 0x6c645d, roughness: 0.88 })
            );
            rail.position.set(230, 40, 150 + side * 10);
            rail.rotation.y = -0.52;
            this.group.add(rail);
        }
    }

    _buildMountainCastle() {
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8d8d88, roughness: 0.94 });
        const keep = new THREE.Mesh(new THREE.BoxGeometry(28, 34, 24), stoneMat);
        keep.position.set(30, 126, 360);
        keep.castShadow = true;
        keep.receiveShadow = true;
        this.group.add(keep);

        for (const [x, z] of [[-18, -14], [18, -14], [-18, 14], [18, 14]]) {
            const tower = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 42, 8), stoneMat);
            tower.position.set(30 + x, 130, 360 + z);
            tower.castShadow = true;
            this.group.add(tower);
        }
    }

    _buildMountainWaterfall() {
        const waterMat = new THREE.MeshStandardMaterial({
            color: 0x8cc3d9,
            emissive: 0x4c89a5,
            emissiveIntensity: 0.18,
            transparent: true,
            opacity: 0.8,
            roughness: 0.3,
        });
        const fall = new THREE.Mesh(new THREE.PlaneGeometry(34, 110), waterMat);
        fall.position.set(-365, 56, 238);
        fall.rotation.y = Math.PI * 0.2;
        this.group.add(fall);
    }

    _buildMountainCloudSea() {
        const cloudMat = new THREE.MeshStandardMaterial({
            color: 0xe3ecf2,
            transparent: true,
            opacity: 0.55,
            roughness: 1,
            depthWrite: false,
        });

        // large cloud base covering the course area
        const center = new THREE.Vector3();
        for (const sp of this.sampledPoints) {
            center.add(sp.position);
        }
        center.divideScalar(this.sampledPoints.length);
        const mainCloud = new THREE.Mesh(new THREE.CircleGeometry(350, 48), cloudMat);
        mainCloud.rotation.x = -Math.PI / 2;
        mainCloud.position.set(center.x, -26, center.z);
        this.group.add(mainCloud);

        // smaller accent clouds for layered depth
        const cloudPositions = [
            [-120, -320, 120, 40],
            [120, -360, 140, 44],
            [360, -180, 110, 34],
        ];
        for (const [x, z, w, h] of cloudPositions) {
            const cloud = new THREE.Mesh(new THREE.CircleGeometry(w, 20), cloudMat);
            cloud.rotation.x = -Math.PI / 2;
            cloud.position.set(x, -24, z);
            cloud.scale.set(1, h / w, 1);
            this.group.add(cloud);
        }
    }

    _buildMountainJumpRamps() {
        const jumpZones = this.courseData?.zones?.jump || [];
        const rampMat = new THREE.MeshStandardMaterial({ color: 0x695f57, roughness: 0.96 });
        jumpZones.forEach((zone) => {
            const idx = this._findSampleIndexAt((zone.start + zone.end) * 0.5);
            const sp = this.sampledPoints[idx];
            const ramp = new THREE.Mesh(new THREE.BoxGeometry(sp.width * 0.78, 0.7, 6.5), rampMat);
            ramp.position.copy(sp.position).addScaledVector(sp.up, 0.45);
            const basis = new THREE.Matrix4().makeBasis(
                sp.right.clone().normalize(),
                sp.up.clone().normalize(),
                sp.forward.clone().normalize()
            );
            ramp.quaternion.setFromRotationMatrix(basis);
            ramp.rotateX(-0.18);
            ramp.castShadow = true;
            ramp.receiveShadow = true;
            this.group.add(ramp);
        });
    }

    _findSampleIndexAt(t) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < this.sampledPoints.length; i++) {
            const d = Math.abs(this.sampledPoints[i].t - t);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        return best;
    }

    _collectWrappedIndices(startIdx, endIdx) {
        const indices = [];
        const N = this.sampledPoints.length;
        let idx = startIdx;
        indices.push(idx);
        while (idx !== endIdx) {
            idx = (idx + 1) % N;
            indices.push(idx);
            if (indices.length > N) break;
        }
        return indices;
    }

    _placeSurfacePlane(mesh, sp, lift = 0.07) {
        // PlaneGeometry local axes: X=width, Y=length, Z=normal.
        // Align to sampled road frame so the plane follows banking.
        const basis = new THREE.Matrix4().makeBasis(
            sp.right.clone().normalize(),
            sp.forward.clone().normalize(),
            sp.up.clone().normalize()
        );
        mesh.quaternion.setFromRotationMatrix(basis);
        mesh.position.copy(sp.position).addScaledVector(sp.up, lift);
    }

    // ─── Collision query ───────────────────────────────────────────────────────

    /**
     * Find the nearest sampled point to worldPos using a hint for efficiency.
     * Returns { index, lateralOffset, onTrack, sp, t }
     *
     * @param {THREE.Vector3} worldPos
     * @param {number} hintIndex  Previous frame's nearest index (speeds up search).
     */
    getNearest(worldPos, hintIndex = 0) {
        const N = this.sampledPoints.length;
        const searchRange = Math.floor(N * 0.12); // search ±12% of track

        let bestIdx  = hintIndex;
        let bestDist = Infinity;

        for (let di = -searchRange; di <= searchRange; di++) {
            const idx = ((hintIndex + di) % N + N) % N;
            const sp  = this.sampledPoints[idx];
            const dx  = worldPos.x - sp.position.x;
            const dz  = worldPos.z - sp.position.z;
            const d2  = dx * dx + dz * dz;
            if (d2 < bestDist) { bestDist = d2; bestIdx = idx; }
        }

        const sp = this.sampledPoints[bestIdx];
        const toPos = new THREE.Vector3(
            worldPos.x - sp.position.x,
            worldPos.y - sp.position.y,
            worldPos.z - sp.position.z,
        );
        const lateralOffset = toPos.dot(sp.right);
        const halfW = sp.width / 2;

        return {
            index: bestIdx,
            lateralOffset,
            halfWidth: halfW,
            onTrack: Math.abs(lateralOffset) <= halfW,
            sp,
            t: sp.t,
        };
    }

    /** Get gate data (position + forward direction) at a given arc-length t [0..1]. */
    getGateAt(t) {
        const pos     = this.spline.getPointAt(t);
        const forward = this.spline.getTangentAt(t).normalize();
        return { pos, forward };
    }

    getEnvironmentState(nearestIndex = 0) {
        const sp = this.sampledPoints[nearestIndex] || this.sampledPoints[0];
        if (!sp) {
            return { tunnelLighting: 1, mistDensity: 0, surfaceType: 'asphalt', grip: 1, jump: null };
        }
        return {
            tunnelLighting: sp.tunnelLighting ?? 1,
            mistDensity: sp.mistDensity ?? 0,
            surfaceType: sp.surfaceType ?? 'asphalt',
            grip: sp.grip ?? 1,
            jump: sp.jump ?? null,
        };
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
                    material.opacity = Math.min(material.opacity ?? 1, 0.88);
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

    getDebugFocusPoint() {
        if (!this.sampledPoints.length) {
            return new THREE.Vector3();
        }
        const center = new THREE.Vector3();
        for (const sp of this.sampledPoints) {
            center.add(sp.position);
        }
        center.multiplyScalar(1 / this.sampledPoints.length);
        return center;
    }
}
