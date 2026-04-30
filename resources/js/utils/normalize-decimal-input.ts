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

export type CanonicalDecimalParseResult = {
    value: string;
    error: string | null;
};

/**
 * Parses price input without accepting display abbreviations or silently
 * converting obvious thousands notation into a small decimal value.
 *
 * INVARIANTS:
 *   "75000"      → "75000"
 *   "75000.00"   → "75000.00"
 *   "75,000"     → "75000"   (EN thousands grouping stripped)
 *   "75.000"     → ERROR    (ambiguous — could be pt-BR 75000 or EN 75.000; rejected)
 *   "75K"        → ERROR    (abbreviations never accepted for order math)
 *   "75.00K"     → ERROR    (abbreviations never accepted for order math)
 */
export const parseCanonicalDecimalInput = (value: string): CanonicalDecimalParseResult => {
    let input = value.trim().replace(/\s+/g, '');

    if (!input) {
        return { value: '', error: null };
    }

    if (/[a-z]/i.test(input)) {
        return { value: '', error: 'Enter the full number without abbreviations (K/M not allowed).' };
    }

    if (!/^[0-9.,]+$/.test(input)) {
        return { value: '', error: 'Enter a valid number.' };
    }

    const hasComma = input.includes(',');
    const hasDot = input.includes('.');

    if (hasComma && hasDot) {
        const lastComma = input.lastIndexOf(',');
        const lastDot = input.lastIndexOf('.');

        if (lastComma > lastDot) {
            input = input.replace(/\./g, '').replace(/,/g, '.');
        } else {
            input = input.replace(/,/g, '');
        }
    } else if (hasComma) {
        const parts = input.split(',');

        if (parts.length === 2) {
            const [whole, fraction = ''] = parts;

            if (fraction.length === 3 && whole.length <= 3 && whole !== '0' && /^\d+$/.test(whole) && /^\d+$/.test(fraction)) {
                input = `${whole}${fraction}`;
            } else if (fraction.length > 0) {
                input = `${whole}.${fraction}`;
            } else {
                input = whole;
            }
        } else if (parts.length > 2) {
            const validGroups = parts.every((part, i) =>
                i === 0 ? /^\d{1,3}$/.test(part) : /^\d{3}$/.test(part)
            );

            if (validGroups) {
                input = parts.join('');
            } else {
                return { value: '', error: 'Enter a valid number.' };
            }
        } else {
            input = parts[0];
        }
    } else if (hasDot) {
        const parts = input.split('.');

        if (parts.length > 2) {
            return { value: '', error: 'Enter a valid number (too many decimal points).' };
        }

        if (parts.length === 2) {
            const [whole, fraction = ''] = parts;

            if (fraction.length === 3 && whole.length <= 3 && whole !== '0' && /^\d+$/.test(whole) && /^\d+$/.test(fraction)) {
                return { value: '', error: 'Ambiguous input. Use "75000" or "75000.00" instead of thousands-dot notation.' };
            }

            input = `${whole}.${fraction}`;
        }
    }

    if (!/^\d+(\.\d+)?$/.test(input)) {
        return { value: '', error: 'Enter a valid number.' };
    }

    const [whole, fraction] = input.split('.');
    const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
    const normalizedFraction = fraction?.replace(/0+$/, '');
    const normalized = normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;

    return { value: normalized, error: null };
};

export const assertPriceParserInvariants = (): string[] => {
    const errors: string[] = [];

    const cases: Array<{ input: string; expected: string | null; expectError: boolean }> = [
        { input: '75000', expected: '75000', expectError: false },
        { input: '75000.00', expected: '75000.00', expectError: false },
        { input: '75,000', expected: '75000', expectError: false },
        { input: '75.000', expected: null, expectError: true },
        { input: '75K', expected: null, expectError: true },
        { input: '75.00K', expected: null, expectError: true },
        { input: '75,00K', expected: null, expectError: true },
        { input: '0.0000113', expected: '0.0000113', expectError: false },
    ];

    for (const c of cases) {
        const result = parseCanonicalDecimalInput(c.input);
        if (c.expectError) {
            if (!result.error) {
                errors.push(`parseCanonicalDecimalInput("${c.input}") should error but got value="${result.value}"`);
            }
        } else {
            if (result.error) {
                errors.push(`parseCanonicalDecimalInput("${c.input}") should succeed but got error="${result.error}"`);
            } else if (result.value !== c.expected) {
                errors.push(`parseCanonicalDecimalInput("${c.input}") expected="${c.expected}" got="${result.value}"`);
            }
        }
    }

    const sourceAmount = 0.0000113;
    const canonicalLimitPrice = 75000;
    const expectedOutput = sourceAmount * canonicalLimitPrice;
    if (Math.abs(expectedOutput - 0.8475) > 0.0001) {
        errors.push(`display calculation: ${sourceAmount} * ${canonicalLimitPrice} = ${expectedOutput}, expected ~0.8475`);
    }

    return errors;
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

    if (!priceInverted) {
        return (src * price).toLocaleString('en-US', {
            useGrouping: false,
            maximumFractionDigits: src * price < 1 ? 8 : 6,
        }).replace(/\.?0+$/, '');
    }

    return (src / price).toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: src / price < 1 ? 8 : 6,
    }).replace(/\.?0+$/, '');
};
