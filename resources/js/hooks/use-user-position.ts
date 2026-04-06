import { useState, useCallback, useEffect, useRef } from 'react';
import { useWeb3 } from '@/contexts/web3-context';
import { getUserPosition } from '../services/api';
import { getPublicApiErrorMessage } from '../utils/api-error';
import logger from '../utils/logger';

export interface UserPositionData {
    supplies: any[];
    borrows: any[];
    marketAssets: any[];
    summary: any | null;
}

const CACHE_TTL = 60000; // 60 seconds cache
const DEBOUNCE_DELAY = 150; // shorter debounce for snappier modal interactions

const cacheRef = {
    current: {
        data: null as UserPositionData | null,
        timestamp: 0,
        key: ''
    }
};

/**
 * Hook to fetch and manage user's aggregated Aave position
 * @param {string} [overrideMarketKey] - Optional market key to override the globally selected network
 * @returns {Object} { supplies, borrows, summary, marketAssets, loading, error, refresh }
 */
export const useUserPosition = (overrideMarketKey?: string) => {
    const { account, selectedNetwork, isProxyReady } = useWeb3();

    const effectiveMarketKey = overrideMarketKey || selectedNetwork?.key;
    const cacheKey = account && effectiveMarketKey ? `${account}-${effectiveMarketKey}` : '';

    const getInitialData = () => {
        if (cacheKey && cacheRef.current.key === cacheKey && cacheRef.current.data) {
            return cacheRef.current.data;
        }
        return { supplies: [], borrows: [], marketAssets: [], summary: null };
    };

    const [data, setData] = useState<UserPositionData>(getInitialData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetch, setLastFetch] = useState<number | null>(null);

    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevAddressRef = useRef<string | null>(account);
    const prevMarketRef = useRef<string | undefined>(effectiveMarketKey);

    const refresh = useCallback(async (force = false) => {
        if (!account || !effectiveMarketKey || !isProxyReady) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            prevAddressRef.current = null;
            prevMarketRef.current = undefined;

            return;
        }

        // Clear data if wallet OR market changed
        if (prevAddressRef.current !== account || prevMarketRef.current !== effectiveMarketKey) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            prevAddressRef.current = account;
            prevMarketRef.current = effectiveMarketKey;
        }

        const currentCacheKey = `${account}-${effectiveMarketKey}`;
        const now = Date.now();

        // Check cache first
        if (!force &&
            cacheRef.current.key === currentCacheKey &&
            cacheRef.current.data &&
            (now - cacheRef.current.timestamp) < CACHE_TTL) {
            logger.debug(`[useUserPosition] Using cached data for ${effectiveMarketKey}`);
            setData(cacheRef.current.data);

            return;
        }

        setLoading(true);
        setError(null);

        try {
            const position = await getUserPosition(account, effectiveMarketKey, selectedNetwork?.chainId || 1);
            const newData: UserPositionData = {
                supplies: position.supplies || [],
                borrows: position.borrows || [],
                marketAssets: position.marketAssets || [],
                summary: position.summary || null
            };

            // Update cache
            cacheRef.current = {
                data: newData,
                timestamp: Date.now(),
                key: currentCacheKey
            };

            setData(newData);
            setLastFetch(Date.now());
        } catch (err: any) {
            logger.error(`Error fetching user position for ${effectiveMarketKey}:`, err);
            setError(getPublicApiErrorMessage(err, 'Failed to load Aave positions'));
        } finally {
            setLoading(false);
        }
    }, [account, effectiveMarketKey, selectedNetwork?.chainId, isProxyReady]);

    // Automatic refresh with debounce when account or network changes
    useEffect(() => {
        if (fetchTimeoutRef.current) {
            clearTimeout(fetchTimeoutRef.current);
        }

        fetchTimeoutRef.current = setTimeout(() => {
            refresh();
        }, DEBOUNCE_DELAY);

        return () => {
            if (fetchTimeoutRef.current) {
                clearTimeout(fetchTimeoutRef.current);
            }
        };
    }, [refresh, isProxyReady]);

    return {
        ...data,
        loading: loading || (!!account && !isProxyReady),
        error,
        lastFetch,
        refresh
    };
};
