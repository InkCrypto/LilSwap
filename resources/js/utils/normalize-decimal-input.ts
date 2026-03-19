/**
 * Normalizes decimal input from a string, 
 * ensuring it only contains numbers and a single decimal point.
 */
export const normalizeDecimalInput = (value: string): string => {
    // Replace all commas with dots
    let normalized = value.replace(/,/g, '.');

    // Remove anything that's not a digit or a dot
    normalized = normalized.replace(/[^0-9.]/g, '');

    // Ensure there's only one dot
    const parts = normalized.split('.');
    if (parts.length > 2) {
        normalized = parts[0] + '.' + parts.slice(1).join('');
    }

    // If it starts with a dot, prepend a zero
    if (normalized.startsWith('.')) {
        normalized = '0' + normalized;
    }

    // If it's just '0' followed by digits (and no dot), remove the leading zero
    if (normalized.length > 1 && normalized.startsWith('0') && !normalized.startsWith('0.')) {
        normalized = normalized.substring(1);
    }

    return normalized;
};
