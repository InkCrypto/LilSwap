import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import logger from '../utils/logger';

/**
 * Hook to fetch user positions across all supported networks
 * @param {string} userAddress - User's wallet address
 * @param {Object} opts - Options: { refreshIntervalMs }
 * @returns {Object} { positionsByChain, loading, error, lastFetch, refresh }
 */
export const useAllPositions = (userAddress, opts = {}) => {
    const [data, setData] = useState(null); // object keyed by chainId
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const prevAddressRef = useRef(userAddress);

    const fetchPositions = useCallback(async (force = false) => {
        if (!userAddress) return;

        setLoading(true);
        setError(null);

        try {
            const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001/v1';
            const url = `${baseURL}/position`;

            logger.debug('Fetching all positions', { userAddress, url });

            const response = await axios.post(url, {
                userAddress,
                ...(force && { force: true })
            }, {
                timeout: 30000 // 30s timeout for multi-chain request
            });

            setData(response.data);
            setLastFetch(Date.now());

            logger.debug('All positions fetched successfully', {
                chains: Object.keys(response.data),
                hasPositions: Object.values(response.data).some(pos => pos.hasPositions)
            });
        } catch (err) {
            const errorMsg = err.response?.data?.message || err.message || 'Failed to fetch positions';
            logger.error('Error fetching all positions', { error: errorMsg });
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    }, [userAddress]);

    // Initial fetch and setup auto-refresh
    useEffect(() => {
        if (!userAddress) {
            setData(null);
            prevAddressRef.current = null;
            return;
        }

        // Only clear previous data if the actual wallet address changed
        // This prevents network switches from triggering the loading animation
        if (prevAddressRef.current !== userAddress) {
            setData(null);
            prevAddressRef.current = userAddress;
        }

        fetchPositions();

        // Auto refresh every 90s (configurable)
        const refreshInterval = opts.refreshIntervalMs || 90000;
        const interval = setInterval(() => {
            fetchPositions();
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [fetchPositions, userAddress, opts.refreshIntervalMs]);

    return {
        positionsByChain: data,
        loading,
        error,
        lastFetch,
        refresh: fetchPositions
    };
};

export default useAllPositions;
