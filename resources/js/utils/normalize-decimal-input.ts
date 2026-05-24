/**
 * Normalizes decimal input from a string, ensuring it only contains numbers
 * and a single decimal point.
 */
export const normalizeDecimalInput = (value: string): string => {
    let normalized = value.trim();

    if (normalized.includes(',') && normalized.includes('.')) {
        const lastComma = normalized.lastIndexOf(',');
        const lastDot = normalized.lastIndexOf('.');

        if (lastComma < lastDot) {
            normalized = normalized.replace(/,/g, '');
        } else {
            normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
        }
    } else {
        normalized = normalized.replace(/,/g, '.');
    }

    normalized = normalized.replace(/[^0-9.]/g, '');

    const parts = normalized.split('.');

    if (parts.length > 2) {
        normalized = parts[0] + '.' + parts.slice(1).join('');
    }

    if (normalized.startsWith('.')) {
        normalized = '0' + normalized;
    }

    if (normalized.length > 1 && normalized.startsWith('0') && !normalized.startsWith('0.')) {
        normalized = normalized.substring(1);
    }

    return normalized;
};

export const computeLimitOutputDisplay = (
    sourceAmountHuman: string,
    canonicalLimitPrice: string,
    priceBaseTokenSymbol: string,
    priceQuoteTokenSymbol: string,
    priceInverted: boolean,
): string => {
    const src = parseFloat(sourceAmountHuman || '0');
    const price = parseFloat(canonicalLimitPrice || '0');

    if (!Number.isFinite(src) || !Number.isFinite(price) || src <= 0 || price <= 0) {
        return '';
    }

    const output = priceInverted ? src / price : src * price;

    return output.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: output < 1 ? 8 : 6,
    }).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
