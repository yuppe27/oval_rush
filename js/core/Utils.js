/** Shared storage key for user options (used by UIManager and InputManager). */
export const OPTIONS_STORAGE_KEY = 'ovalrush_options';

/**
 * Format milliseconds as MM:SS.mmm
 * @param {number} ms
 * @returns {string}
 */
export function formatMs(ms) {
    const total = Math.max(0, ms);
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const f = total % 1000;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(3, '0')}`;
}
