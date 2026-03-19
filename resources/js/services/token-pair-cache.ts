import logger from '../utils/logger';

const CACHE_KEY_PREFIX = 'lilswap_token_pair_cache_';
const CACHE_TTL_TRUE_MS = 3600000;  // 1 hour — keep confirmed-swappable pairs cached
const CACHE_TTL_FALSE_MS = 300000;  // 5 minutes — re-validate non-swappable pairs quickly

interface CacheEntry {
    swappable: boolean;
    timestamp: number;
}

/**
 * Generate cache key from token pair and chain ID
 */
function getCacheKey(fromAddress: string, toAddress: string, chainId: number): string {
    return `${CACHE_KEY_PREFIX}${chainId}:${fromAddress.toLowerCase()}:${toAddress.toLowerCase()}`;
}

/**
 * Get cached pair status without validation
 */
export function getPairStatus(fromAddress: string | undefined, toAddress: string | undefined, chainId: number): { swappable: boolean, timestamp: number } | null {
    if (!fromAddress || !toAddress) {
        return null;
    }

    try {
        const key = getCacheKey(fromAddress, toAddress, chainId);
        const cached = localStorage.getItem(key);

        if (!cached) {
            return null;
        }

        const entry: CacheEntry = JSON.parse(cached);
        const now = Date.now();

        // Expiry check — false entries expire faster to recover from transient errors
        const ttl = entry.swappable ? CACHE_TTL_TRUE_MS : CACHE_TTL_FALSE_MS;

        if (now - entry.timestamp > ttl) {
            localStorage.removeItem(key);
            logger.debug('[tokenPairCache] Cache expired for:', { fromAddress, toAddress, chainId });

            return null;
        }

        return entry;
    } catch (error) {
        logger.warn('[tokenPairCache] Error reading cache:', error);

        return null;
    }
}

/**
 * Set pair swappability status in cache
 */
function setPairStatus(fromAddress: string, toAddress: string, chainId: number, swappable: boolean): CacheEntry | null {
    try {
        const key = getCacheKey(fromAddress, toAddress, chainId);
        const entry: CacheEntry = {
            swappable,
            timestamp: Date.now()
        };

        localStorage.setItem(key, JSON.stringify(entry));
        logger.debug('[tokenPairCache] Cached pair status:', {
            fromAddress,
            toAddress,
            chainId,
            swappable
        });

        return entry;
    } catch (error) {
        logger.warn('[tokenPairCache] Error writing cache:', error);

        return null;
    }
}

/**
 * Check if a token pair is swappable by validating with ParaSwap API
 * Uses cached result if available and not expired
 */
export async function checkPairSwappable(
    fromToken: any,
    toToken: any,
    chainId: number,
    quoteFunction: (params: any) => Promise<any>,
    validationParams: any = {}
): Promise<boolean> {
    const fromAddress = fromToken?.address || fromToken?.underlyingAsset;
    const toAddress = toToken?.address || toToken?.underlyingAsset;

    if (!fromAddress || !toAddress) {
        logger.warn('[tokenPairCache] Missing token addresses');

        return false;
    }

    const {
        amountField = 'destAmount',
        amount = '1',
        ...extraParams
    } = validationParams;

    // Check cache first
    const cached = getPairStatus(fromAddress, toAddress, chainId);

    if (cached !== null) {
        return cached.swappable;
    }

    // Not in cache, need to validate
    logger.debug('[tokenPairCache] Validating token pair:', {
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        chainId
    });

    try {
        // Use minimal amount (1 wei) for validation
        const minimalAmount = '1';

        await quoteFunction({
            fromToken: {
                address: fromAddress,
                decimals: fromToken.decimals,
                symbol: fromToken.symbol
            },
            toToken: {
                address: toAddress,
                decimals: toToken.decimals,
                symbol: toToken.symbol
            },
            [amountField]: amount || minimalAmount,
            ...extraParams
        });

        // If we get here, there's a route available
        setPairStatus(fromAddress, toAddress, chainId, true);

        return true;
    } catch {
        // Quote failed: not swappable
        setPairStatus(fromAddress, toAddress, chainId, false);

        return false;
    }
}

/**
 * Clear all cached token pair data
 */
export function clearAllCache(): void {
    try {
        const keys = Object.keys(localStorage);
        const cacheKeys = keys.filter(k => k.startsWith(CACHE_KEY_PREFIX));

        cacheKeys.forEach(key => {
            localStorage.removeItem(key);
        });

        logger.debug('[tokenPairCache] Cleared entries', { count: cacheKeys.length });
    } catch (error) {
        logger.warn('[tokenPairCache] Error clearing cache:', error);
    }
}
