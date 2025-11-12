export function clampPercentage(value, { min = 0, max = 100 } = {}) {
    const lowerBound = Number.isFinite(min) ? min : 0;
    const upperBound = Number.isFinite(max) ? max : 100;
    const numeric = typeof value === 'number' ? value : Number.parseFloat(value);

    if (!Number.isFinite(numeric)) {
        return lowerBound;
    }

    const clampedLower = Math.max(numeric, lowerBound);
    return Math.min(clampedLower, upperBound);
}
