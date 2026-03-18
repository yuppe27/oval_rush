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
    }

    build(courseData) {
        this.group.clear();
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
            return;
        }
        if (scenery === 'mountain') {
            this._buildMountainScenery();
            return;
        }
        this._buildStadiumScenery();
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

        this._buildStadiumSpectators(cx, cz, standInnerR, standOuterR, standHeight);
    }

    _buildStadiumSpectators(cx, cz, standInnerR, standOuterR, standHeight) {
        const numRows = 8;
        const spacing = 2.0;
        const bodyW = 0.85;
        const bodyH = 1.5;
        const bodyD = 0.45;

        const slopeAngle = Math.atan2(standHeight, standOuterR - standInnerR);

        let total = 0;
        const rowData = [];
        for (let row = 0; row < numRows; row++) {
            const f = (row + 0.5) / numRows;
            const r = standInnerR + f * (standOuterR - standInnerR);
            const count = Math.floor((2 * Math.PI * r) / spacing);
            rowData.push({ f, r, count });
            total += count;
        }

        const colors = [0xcc2222, 0x2244cc, 0xddcc00, 0x22aa44, 0xffffff, 0xee6600, 0x9933cc, 0x44aacc, 0xee3388, 0x33ccaa];
        const geo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
        const mesh = new THREE.InstancedMesh(geo, mat, total);
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        let idx = 0;
        let seed = 12345;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) & 0xffffffff;
            return (seed >>> 0) / 0xffffffff;
        };

        for (const { f, r, count } of rowData) {
            const baseY = f * standHeight + bodyH * 0.5 * Math.cos(slopeAngle) + 0.1;
            for (let j = 0; j < count; j++) {
                const ang = (j / count) * Math.PI * 2;
                dummy.position.set(
                    cx + Math.cos(ang) * r,
                    baseY,
                    cz + Math.sin(ang) * r
                );
                dummy.rotation.set(0, ang + Math.PI, 0);
                dummy.updateMatrix();
                mesh.setMatrixAt(idx, dummy.matrix);
                color.setHex(colors[Math.floor(rand() * colors.length)]);
                mesh.setColorAt(idx, color);
                idx++;
            }
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.group.add(mesh);
    }

    _buildSeasideScenery() {
        this._buildSeasideBeach();
        this._buildSeasideTown();
        this._buildSeasideCliffs();
        this._buildSeasideTunnel();
        this._buildLighthouse();
    }

    _buildSeasideBeach() {
        const water = new THREE.Mesh(
            new THREE.CircleGeometry(1200, 80),
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
            trunk.position.set(x, 2.5, z);
            this.group.add(trunk);
            for (let i = 0; i < 5; i++) {
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 7.5), palmLeafMat);
                leaf.position.set(x, 8.5, z);
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
        plaza.position.copy(this._getSafeSceneryPosition(new THREE.Vector3(-310, -0.5, 470), 90));
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
                center.y = -6 + height * 0.5;
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
                cap.position.y = -6 + height + 2;
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
        const segmentStep = 1;

        if (indices.length) {
            this._buildTunnelPortal(this.sampledPoints[indices[0]], portalMat);
            this._buildTunnelPortal(this.sampledPoints[indices[indices.length - 1]], portalMat);
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

            const ceiling = new THREE.Mesh(
                new THREE.BoxGeometry(ceilingWidth, ceilingThickness, segmentLength),
                shellMat
            );
            ceiling.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 1.15);
            ceiling.quaternion.copy(archQuat);
            ceiling.castShadow = true;
            this.group.add(ceiling);

            const overburden = new THREE.Mesh(
                new THREE.BoxGeometry(outerRockWidth, 11.5, segmentLength + 2.8),
                rockMat
            );
            overburden.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 7.2);
            overburden.quaternion.copy(archQuat);
            overburden.castShadow = true;
            overburden.receiveShadow = true;
            this.group.add(overburden);

            const canopy = new THREE.Mesh(
                new THREE.BoxGeometry(sp.width + 8, 3.4, segmentLength + 1.2),
                rockMat
            );
            canopy.position.copy(sp.position).addScaledVector(sp.up, shoulderRise + 3.4);
            canopy.quaternion.copy(archQuat);
            canopy.castShadow = true;
            canopy.receiveShadow = true;
            this.group.add(canopy);

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
        const pieces = [
            { x: -(sp.width * 0.5 + portalClearance), y: 2.6, w: 2.4, h: 5.2 },
            { x: sp.width * 0.5 + portalClearance, y: 2.6, w: 2.4, h: 5.2 },
            { x: 0, y: 6.0, w: sp.width + portalClearance * 2 + 2.2, h: 2.2 },
        ];

        for (const piece of pieces) {
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
            this.group.add(mesh);
        }

        const portalRockMat = new THREE.MeshStandardMaterial({ color: 0x776b60, roughness: 0.98 });
        const crown = new THREE.Mesh(
            new THREE.BoxGeometry(sp.width + 22, 10, 7.5),
            portalRockMat
        );
        crown.position.copy(sp.position).addScaledVector(sp.up, 8.8);
        crown.quaternion.copy(quat);
        crown.castShadow = true;
        crown.receiveShadow = true;
        this.group.add(crown);

        for (const side of [-1, 1]) {
            const embankment = new THREE.Mesh(
                new THREE.BoxGeometry(12, 14, 7.5),
                portalRockMat
            );
            embankment.position.copy(sp.position)
                .addScaledVector(sp.right, side * (sp.width * 0.5 + portalClearance + 4.8))
                .addScaledVector(sp.up, 6.8);
            embankment.quaternion.copy(quat);
            embankment.castShadow = true;
            embankment.receiveShadow = true;
            this.group.add(embankment);
        }
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
        this._buildMountainPeaks();
        this._buildMountainForest();
        this._buildMountainBridge();
        this._buildMountainCastle();
        this._buildMountainWaterfall();
        this._buildMountainCloudSea();
        this._buildMountainJumpRamps();
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
        const cloudPositions = [
            [-120, -320, 120, 40],
            [120, -360, 140, 44],
            [360, -180, 110, 34],
        ];
        for (const [x, z, w, h] of cloudPositions) {
            const cloud = new THREE.Mesh(new THREE.CircleGeometry(w, 20), cloudMat);
            cloud.rotation.x = -Math.PI / 2;
            cloud.position.set(x, -26, z);
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
}
