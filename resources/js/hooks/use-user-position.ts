import { useState, useCallback, useEffect, useRef } from 'react';
import { useWeb3 } from '@/contexts/web3-context';
import { getUserPosition } from '../services/api';
import logger from '../utils/logger';

export interface UserPositionData {
    supplies: any[];
    borrows: any[];
    marketAssets: any[];
    summary: any | null;
}

/**
 * Hook to fetch and manage user's aggregated Aave position
 * @returns {Object} { supplies, borrows, summary, marketAssets, loading, error, refresh }
 */
export const useUserPosition = () => {
    const { account, selectedNetwork } = useWeb3();
    const [data, setData] = useState<UserPositionData>({ supplies: [], borrows: [], marketAssets: [], summary: null });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetch, setLastFetch] = useState<number | null>(null);

    const cacheRef = useRef<{ data: UserPositionData | null; timestamp: number; key: string }>({
        data: null,
        timestamp: 0,
        key: ''
    });
    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevAddressRef = useRef<string | null>(account);

    const CACHE_TTL = 60000; // 60 seconds cache
    const DEBOUNCE_DELAY = 150; // shorter debounce for snappier modal interactions

    const refresh = useCallback(async (force = false) => {
        if (!account || !selectedNetwork?.chainId) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            prevAddressRef.current = null;

            return;
        }

        // Only clear data completely if the user actually changed their wallet
        if (prevAddressRef.current !== account) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            prevAddressRef.current = account;
        }

        const cacheKey = `${account}-${selectedNetwork.chainId}`;
        const now = Date.now();

        // Check cache first
        if (!force &&
            cacheRef.current.key === cacheKey &&
            cacheRef.current.data &&
            (now - cacheRef.current.timestamp) < CACHE_TTL) {
            logger.debug('[useUserPosition] Using cached data');
            setData(cacheRef.current.data);

            return;
        }

        setLoading(true);
        setError(null);

        try {
            const position = await getUserPosition(account, selectedNetwork.chainId);
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
                key: cacheKey
            };

            setData(newData);
            setLastFetch(Date.now());
        } catch (err: any) {
            logger.error('Error fetching user position:', err);
            const errorMsg = err.message || 'Failed to load Aave positions';

            // Provide more specific error messages
            if (errorMsg.includes('rate limit')) {
                setError('RPC rate limit reached. Please wait a few seconds and try again.');
            } else if (errorMsg.includes('CALL_EXCEPTION')) {
                setError('Error querying Aave. Please try again in a few seconds.');
            } else {
                setError(errorMsg);
            }
        } finally {
            setLoading(false);
        }
    }, [account, selectedNetwork?.chainId]);

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
    }, [refresh]);

    return {
        ...data,
        loading,
        error,
        lastFetch,
        refresh
    };
};
