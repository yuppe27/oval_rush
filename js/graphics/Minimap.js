/**
 * Minimap overlay: shows a top-down outline of the course with
 * real-time positions of the player and all AI cars.
 */
export class Minimap {
    /**
     * @param {import('../courses/CourseBuilder.js').CourseBuilder} courseBuilder
     * @param {number} aiCount
     */
    constructor(courseBuilder, aiCount) {
        this._courseBuilder = courseBuilder;
        this._aiCount = aiCount;

        // Canvas setup
        this._canvas = document.createElement('canvas');
        this._canvas.id = 'minimap-canvas';
        this._canvas.style.cssText =
            'position:fixed;bottom:12px;right:12px;z-index:100;' +
            'pointer-events:none;opacity:0.85;';
        document.body.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        // Sizing
        this._size = 140;
        this._padding = 10;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this._canvas.width = this._size * dpr;
        this._canvas.height = this._size * dpr;
        this._canvas.style.width = this._size + 'px';
        this._canvas.style.height = this._size + 'px';
        this._ctx.scale(dpr, dpr);

        // Precompute course outline in 2D (top-down: x, z)
        this._coursePoints = this._buildCoursePoints();
        this._bounds = this._computeBounds(this._coursePoints);

        // Pre-render course outline to offscreen canvas
        this._bgCanvas = document.createElement('canvas');
        this._bgCanvas.width = this._canvas.width;
        this._bgCanvas.height = this._canvas.height;
        const bgCtx = this._bgCanvas.getContext('2d');
        bgCtx.scale(dpr, dpr);
        this._drawBackground(bgCtx);
    }

    _buildCoursePoints() {
        const points = this._courseBuilder.sampledPoints;
        const step = Math.max(1, Math.floor(points.length / 200));
        const result = [];
        for (let i = 0; i < points.length; i += step) {
            const p = points[i].position;
            result.push({ x: p.x, z: p.z, t: points[i].t });
        }
        return result;
    }

    _computeBounds(pts) {
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }
        return { minX, maxX, minZ, maxZ };
    }

    /** Convert world x,z to canvas x,y */
    _toCanvas(worldX, worldZ) {
        const b = this._bounds;
        const rangeX = b.maxX - b.minX || 1;
        const rangeZ = b.maxZ - b.minZ || 1;
        const scale = (this._size - this._padding * 2) / Math.max(rangeX, rangeZ);
        const cx = this._size / 2;
        const cy = this._size / 2;
        const midX = (b.minX + b.maxX) / 2;
        const midZ = (b.minZ + b.maxZ) / 2;
        return {
            x: cx + (worldX - midX) * scale,
            y: cy + (worldZ - midZ) * scale,
        };
    }

    _drawBackground(ctx) {
        const s = this._size;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, 0, s, s);

        // Course outline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < this._coursePoints.length; i++) {
            const p = this._toCanvas(this._coursePoints[i].x, this._coursePoints[i].z);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();

        // Start/finish line marker
        const slIdx = this._courseBuilder.startLineIndex;
        if (slIdx >= 0 && slIdx < this._courseBuilder.sampledPoints.length) {
            const sp = this._courseBuilder.sampledPoints[slIdx].position;
            const sl = this._toCanvas(sp.x, sp.z);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sl.x - 3, sl.y - 1, 6, 2);
        }
    }

    /**
     * @param {import('../vehicles/PlayerVehicle.js').PlayerVehicle} player
     * @param {import('../ai/AIController.js').AIController} aiController
     */
    /**
     * @param {import('../vehicles/PlayerVehicle.js').PlayerVehicle} player
     * @param {import('../ai/AIController.js').AIController} aiController
     * @param {string} [raceState]
     */
    update(player, aiController, raceState) {
        // Hide during result screens
        const hidden = raceState === 'gameover' || raceState === 'result';
        this._canvas.style.display = hidden ? 'none' : '';

        if (hidden) return;

        const ctx = this._ctx;
        const s = this._size;

        // Draw cached background
        ctx.clearRect(0, 0, s, s);
        ctx.drawImage(this._bgCanvas, 0, 0, s, s);

        // AI car dots
        const vehicles = aiController.vehicles;
        for (let i = 0; i < vehicles.length; i++) {
            const ai = vehicles[i];
            const pos = this._toCanvas(ai.position.x, ai.position.z);
            ctx.fillStyle = ai.completed ? 'rgba(100,100,100,0.6)' : '#4a9eff';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Player dot (on top, larger, distinct color)
        const pp = this._toCanvas(player.position.x, player.position.z);
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
        ctx.fill();
        // White border for visibility
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    dispose() {
        if (this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
        }
    }
}
