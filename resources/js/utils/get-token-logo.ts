/**
 * Token icon resolver — single source of truth for all components.
 */

// Aave symbol → icon filename (when they differ from lowercase symbol)
const ALIAS: Record<string, string> = {
    BTCB: 'btc',
    'USD₮0': 'usdt0',
    ONE_INCH: '1inch',
    MIMATIC: 'mai',
    USDCN: 'usdc',
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
    'BTC.B': 'btc',
    'WETH.E': 'weth',
    'DAI.E': 'dai',
    'LINK.E': 'link',
    WAVAX: 'wavax',
    AUSD: 'ausd'
};

const DEV = (import.meta as any).env?.DEV;

export const getTokenLogo = (symbol: string): string => {
    if (!symbol) return '';
    const key = ALIAS[symbol.toUpperCase()] ?? symbol.toLowerCase();
    return `/icons/tokens/${key}.svg`;
};

export const onTokenImgError = (symbol: string) => (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.target as HTMLImageElement;
    const src = target.src || '';
    const key = symbol ? (ALIAS[symbol.toUpperCase()] ?? symbol.toLowerCase()) : null;

    if (key && !src.includes('app.aave.com')) {
        if (DEV) console.warn(`[token-icons] Local icon missing for "${symbol}" — trying Aave CDN`);
        target.src = `https://app.aave.com/icons/tokens/${key}.svg`;
        return;
    }

    if (key && src.includes('app.aave.com')) {
        if (DEV) console.warn(`[token-icons] No icon found for "${symbol}" — falling back to text label`);
        target.style.display = 'none';
        if (target.nextSibling && (target.nextSibling as HTMLElement).tagName === 'SPAN') {
            (target.nextSibling as HTMLElement).style.display = 'block';
        }
    }
};
