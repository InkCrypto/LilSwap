import { useState, useCallback, useEffect, useRef } from 'react';
import { useWeb3 } from '../context/web3Context';
import { getUserPosition } from '../services/api';
import logger from '../utils/logger.js';
/**
 * Hook to fetch and manage user's aggregated Aave position
 * @returns {Object} { supplies, borrows, summary, loading, error, refresh }
 */
export const useUserPosition = () => {
    const { account, selectedNetwork } = useWeb3();
    const [data, setData] = useState({ supplies: [], borrows: [], marketAssets: [], summary: null });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const cacheRef = useRef({ data: null, timestamp: 0, key: '' });
    const fetchTimeoutRef = useRef(null);

    const CACHE_TTL = 10000; // 10 seconds cache
    const DEBOUNCE_DELAY = 500; // 500ms debounce

    const refresh = useCallback(async (force = false) => {
        if (!account || !selectedNetwork?.chainId) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            return;
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
            const newData = {
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
        } catch (err) {
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
