/**
 * Helper to format a number into a USD currency string with compact notation for large values.
 */
export const formatUSD = (value: number | null | undefined): string => {
    if (value == null || isNaN(value)) {
        return '$0.00';
    }

    if (value === 0) {
        return '$0.00';
    }

    if (value > 0 && value < 0.01) {
        return '< $0.01';
    }

    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
    }

    if (value >= 1_000) {
        return `$${(value / 1_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}K`;
    }

    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/**
 * Helper to format extremely small numbers cleanly using subscript zero notation (DeFi standard).
 * Example: 0.00003024 -> 0.0₄3024
 */
const formatTiny = (num: number): string => {
    if (num <= 0) return '0';
    
    // For scientific notation request (e.g. 0.0e-245)
    if (num < 1e-10) {
        return num.toExponential(2).replace('e', 'e'); // Ensure 'e' is lowercase
    }

    const str = num.toFixed(20);
    const match = str.match(/^0\.0(0+)/);
    
    if (match) {
        const zeros = match[1].length + 1;
        // Subscript notation for 4-10 zeros
        if (zeros >= 4 && zeros <= 10) {
            const remaining = str.slice(match[0].length).replace(/0+$/, '');
            if (remaining.length > 0) {
                const subscriptCount = zeros.toString().split('').map(d => subscripts[parseInt(d)]).join('');
                return `0.0${subscriptCount}${remaining.slice(0, 4)}`;
            }
        }
    }

    return num.toLocaleString('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 8 
    });
};

/**
 * Internal helper to format a number with compact notation (K/M) or tiny precision.
 * Does NOT include the currency/symbol.
 */
export const formatCompactNumber = (value: number | string | null | undefined): string => {
    const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
    
    if (num == null || isNaN(num) || num === 0) {
        return '0';
    }

    if (num >= 1_000_000) {
        return (num / 1_000_000).toLocaleString('en-US', { 
            minimumFractionDigits: 0, 
            maximumFractionDigits: 4 
        }) + 'M';
    }

    if (num >= 1_000) {
        return (num / 1_000).toLocaleString('en-US', { 
            minimumFractionDigits: 0, 
            maximumFractionDigits: 4 
        }) + 'K';
    }

    if (num < 0.0001) {
        return formatTiny(num);
    }

    return num.toLocaleString('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: num < 1 ? 6 : 4 
    });
};

/**
 * Helper to format a token amount with compact notation (K/M) for large values,
 * and smart precision for tiny values.
 */
export const formatCompactToken = (value: number | string | null | undefined, symbol: string): string => {
    return `${formatCompactNumber(value)} ${symbol}`;
};

/**
 * Disambiguates token symbols, specifically for Arbitrum USDC vs USDC.e
 */
export const getDisplaySymbol = (token: any, allTokens: any[] = []): string => {
    if (!token) return '';
    const addr = (token.address || token.underlyingAsset || '').toLowerCase();

    // Arbitrum Specifics - Explicitly disambiguate USDC
    if (addr === '0xaf88d065e77c8cc2239327c5edb3a432268e5831') return 'USDC';
    if (addr === '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8') return 'USDC.e';

    const hasCollision = allTokens.some(t =>
        t.symbol === token.symbol &&
        (t.address || t.underlyingAsset || '').toLowerCase() !== addr
    );

    if (hasCollision) {
        const name = (token.name || '').toLowerCase();
        const symbol = (token.symbol || '').toLowerCase();
        // Aave-style: .e for bridged/pos, plain for native
        const isBridged = name.includes('bridged') || name.includes('(pos)') || name.includes('(e)') || name.includes('polygon') || symbol.endsWith('.e');
        if (isBridged) {
            return `${token.symbol.replace(/\.e$/i, '')}.e`;
        }
    }
    return token.symbol;
};

/**
 * Formats APY with < 0.01% fallback for positive tiny values
 */
export const formatAPY = (value: number | string | null | undefined): string => {
    const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
    
    if (num === 0) return '0%';
    if (num > 0 && num < 0.01) return '< 0.01%';
    
    return `${num.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2,
        useGrouping: true
    })}%`;
};

/**
 * Formats Health Factor with infinity support, flooring to 2 decimals (Aave style)
 */
export const formatHF = (hf: number | string | null | undefined): string => {
    const num = typeof hf === 'string' ? parseFloat(hf) : (hf ?? -1);
    if (num === -1 || num > 100) return '∞';
    
    // Aave floors the health factor to 2 decimals for a more conservative display
    const floored = Math.floor(num * 100) / 100;
    return floored.toFixed(2);
};
