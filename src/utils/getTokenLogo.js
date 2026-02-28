/**
 * Token icon resolver — single source of truth for all components.
 *
 * Icons live in public_assets/icons/tokens/ (committed to the repository).
 * To add/refresh icons, run the utility script from the workspace root:
 *   node sync-token-icons.js [--chain <id>] [--out <dir>] [--force]
 *
 * Fallback chain (applied via onTokenImgError):
 *   1. /icons/tokens/{symbol}.svg       — local, committed SVG (fastest)
 *   2. https://app.aave.com/icons/...   — Aave CDN (100% Aave token coverage)
 *   3. Text Label Fallback              — generic fallback showing symbol initials
 *
 * ─── TO USE AAVE CDN ONLY ────────────────────────────────────────────────────
 * Replace the getTokenLogo return with:
 *   return `https://app.aave.com/icons/tokens/${key}.svg`;
 * and remove onTokenImgError usage from components.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Aave symbol → icon filename (when they differ from lowercase symbol)
const ALIAS = {
    BTCB: 'btc',     // Binance BTC uses generic BTC icon
    'USD₮0': 'usdt0',   // Map unicode symbol to ASCII filename
    ONE_INCH: '1inch',   // Aave address book uses ONE_INCH
    MIMATIC: 'mai',     // miMATIC = MAI stablecoin
    USDCN: 'usdc',    // Circle's native USDC variant
    PT_EUSDE_14AUG2025: 'pteusde',
    PT_EUSDE_29MAY2025: 'pteusde',
    PT_SRUSDE_2APR2026: 'ptsusde',
    PT_SUSDE_25SEP2025: 'ptsusde',
    PT_SUSDE_27NOV2025: 'ptsusde',
    PT_SUSDE_31JUL2025: 'ptsusde',
    PT_SUSDE_5FEB2026: 'ptsusde',
    PT_SUSDE_7MAY2026: 'ptsusde',
    PT_USDE_25SEP2025: 'ptusde',
    PT_USDE_27NOV2025: 'ptusde',
    PT_USDE_31JUL2025: 'ptusde',
    PT_USDE_5FEB2026: 'ptusde',
    PT_USDE_7MAY2026: 'ptusde',
};

const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

/** Returns the local icon URL for a token symbol. */
export const getTokenLogo = (symbol) => {
    if (!symbol) return '';
    const key = ALIAS[symbol.toUpperCase()] ?? symbol.toLowerCase();
    return `/icons/tokens/${key}.svg`;
};

/**
 * onError handler for <img> tags showing token icons.
 * Implements the fallback chain: local → Aave CDN → default.svg
 *
 * Usage:
 *   <img src={getTokenLogo(symbol)} onError={onTokenImgError(symbol)} />
 */
export const onTokenImgError = (symbol) => (e) => {
    const src = e.target.src || '';
    const key = symbol ? (ALIAS[symbol.toUpperCase()] ?? symbol.toLowerCase()) : null;

    // Step 1: local icon failed → try Aave CDN
    if (key && !src.includes('app.aave.com')) {
        if (DEV) console.warn(`[token-icons] Local icon missing for "${symbol}" — trying Aave CDN`);
        e.target.src = `https://app.aave.com/icons/tokens/${key}.svg`;
        return;
    }

    // Step 2: Aave CDN failed → hide image and show text label (via sibling)
    if (key && src.includes('app.aave.com')) {
        if (DEV) console.warn(`[token-icons] No icon found for "${symbol}" — falling back to text label`);

        // Hide the image
        e.target.style.display = 'none';

        // If there's a sibling span (like in DebtSwapModal), make it visible
        if (e.target.nextSibling && e.target.nextSibling.tagName === 'SPAN') {
            e.target.nextSibling.style.display = 'block';
        }
    }
};
