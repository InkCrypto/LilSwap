/**
 * Normalizes decimal input from a string, 
 * ensuring it only contains numbers and a single decimal point.
 */
export const normalizeDecimalInput = (value: string): string => {
    let normalized = value.trim();

    // Check if it has both , and .
    if (normalized.includes(',') && normalized.includes('.')) {
        const lastComma = normalized.lastIndexOf(',');
        const lastDot = normalized.lastIndexOf('.');
        if (lastComma < lastDot) {
            // US format 1,234.56 -> remove ,
            normalized = normalized.replace(/,/g, '');
        } else {
            // Euro format 1.234,56 -> remove . and replace , with .
            normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
        }
    } else {
        // Only one separator type or none - replace comma for Euro/others 
        // to handle "1,5" -> "1.5"
        normalized = normalized.replace(/,/g, '.');
    }

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
