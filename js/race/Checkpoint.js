/**
 * Checkpoint system: detects when the player crosses checkpoint lines
 * and the start/finish line along the spline.
 */
export class Checkpoint {
    constructor(courseBuilder, courseData) {
        this.courseBuilder = courseBuilder;
        this.courseData = courseData;

        // Track checkpoint indices from course builder
        this.checkpointIndices = courseBuilder.checkpointIndices;
        this.startLineIndex = courseBuilder.startLineIndex;
        this.totalSamples = courseBuilder.sampledPoints.length - 1;

        // State per checkpoint: has it been passed this lap?
        this.checkpointsPassed = new Array(this.checkpointIndices.length).fill(false);

        // Previous frame's nearest index (for crossing detection)
        // Initialize at start line to avoid false crossings on courses whose
        // start line is not sample index 0.
        this.prevIndex = this.startLineIndex;

        // Lap crossing detection
        this.crossedStartLine = false;
        this.ignoreNextStartCrossing = true;
    }

    /**
     * Update checkpoint tracking. Call each physics frame.
     * Returns { crossedStart, crossedCheckpoints: [index, ...] }
     */
    update(playerNearestIndex) {
        const result = {
            crossedStart: false,
            crossedCheckpoints: [],
        };

        const prev = this.prevIndex;
        const curr = playerNearestIndex;

        // Check if player crossed any checkpoint
        for (let i = 0; i < this.checkpointIndices.length; i++) {
            if (this.checkpointsPassed[i]) continue;

            const cpIdx = this.checkpointIndices[i];
            if (this._crossed(prev, curr, cpIdx)) {
                this.checkpointsPassed[i] = true;
                result.crossedCheckpoints.push(i);
            }
        }

        // Check if player crossed start/finish line
        if (this._crossed(prev, curr, this.startLineIndex)) {
            if (this.ignoreNextStartCrossing) {
                this.ignoreNextStartCrossing = false;
            } else {
            // Count lap only after all checkpoints are passed this lap.
            // This prevents lap-count exploits by skipping checkpoint order.
                const allPassed = this.checkpointsPassed.length > 0
                    && this.checkpointsPassed.every(Boolean);
                if (allPassed) {
                    result.crossedStart = true;
                    // Reset checkpoints for next lap
                    this.checkpointsPassed.fill(false);
                }
            }
        }

        this.prevIndex = curr;
        return result;
    }

    /**
     * Check if a sample index was crossed between prev and curr.
     * Handles wraparound at the spline loop boundary.
     */
    _crossed(prev, curr, target) {
        // Normal forward crossing
        if (prev < target && curr >= target) return true;
        // Wraparound crossing (passing through index 0)
        if (prev > this.totalSamples * 0.8 && curr < this.totalSamples * 0.2) {
            // Wrapped around - check if target is near 0
            if (target <= curr || target >= prev) return true;
        }
        return false;
    }

    /**
     * Reset checkpoint state for a new race.
     */
    reset(startIndex = this.startLineIndex, options = {}) {
        this.checkpointsPassed.fill(false);
        this.prevIndex = startIndex;
        this.ignoreNextStartCrossing = options.ignoreNextStartCrossing ?? true;
    }
}
