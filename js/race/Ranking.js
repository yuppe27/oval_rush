/**
 * Ranking: LocalStorage-based high score table.
 * Key format: "ovalrush_ranking_{courseId}_{difficulty}"
 * Stores top 10 entries per course+difficulty combination.
 */
const MAX_ENTRIES = 10;

function storageKey(courseId, difficulty) {
    return `ovalrush_ranking_${courseId}_${(difficulty || 'NORMAL').toUpperCase()}`;
}

export function loadRanking(courseId, difficulty) {
    try {
        const raw = localStorage.getItem(storageKey(courseId, difficulty));
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, MAX_ENTRIES);
    } catch {
        return [];
    }
}

/**
 * Insert a new score. Returns the 1-based rank if it made the list, or 0 if not.
 */
export function insertRanking(courseId, difficulty, entry) {
    const list = loadRanking(courseId, difficulty);
    const newEntry = {
        name: (entry.name || 'AAA').substring(0, 3).toUpperCase(),
        time: entry.time,          // ms
        position: entry.position,  // finishing position (1-based)
        date: new Date().toISOString().slice(0, 10),
    };

    // Find insertion point (sorted by time ascending)
    let rank = list.length;
    for (let i = 0; i < list.length; i++) {
        if (newEntry.time < list[i].time) {
            rank = i;
            break;
        }
    }

    list.splice(rank, 0, newEntry);
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;

    try {
        localStorage.setItem(storageKey(courseId, difficulty), JSON.stringify(list));
    } catch {
        // Ignore storage failures
    }

    return rank < MAX_ENTRIES ? rank + 1 : 0;
}

/**
 * Check if a time qualifies for the ranking without inserting.
 */
export function qualifiesForRanking(courseId, difficulty, timeMs) {
    const list = loadRanking(courseId, difficulty);
    if (list.length < MAX_ENTRIES) return true;
    return timeMs < list[list.length - 1].time;
}
