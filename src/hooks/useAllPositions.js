import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../services/api';
import { useUserActivity } from '../context/UserActivityContext';
import logger from '../utils/logger';

/**
 * Hook to fetch user positions across all supported networks
 * @param {string} walletAddress - User's wallet address
 * @param {Object} opts - Options: { refreshIntervalMs }
 * @returns {Object} { positionsByChain, loading, error, lastFetch, refresh }
 */
export const useAllPositions = (walletAddress, opts = {}) => {
    const [data, setData] = useState(null); // object keyed by chainId
    const [donator, setDonator] = useState({ isDonator: false, discountPercent: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const { isTabVisible, isUserActive } = useUserActivity();
    const prevAddressRef = useRef(walletAddress);

    const fetchPositions = useCallback(async (force = false) => {
        if (!walletAddress) return;

        setLoading(true);
        setError(null);

        try {
            logger.debug('Fetching all positions', { walletAddress });

            const response = await apiClient.post('/position', {
                walletAddress,
                ...(force && { force: true })
            }, {
                timeout: 30000 // 30s timeout for multi-chain request
            });

            const { _meta, ...positionsByChain } = response.data;
            setData(positionsByChain);
            if (_meta?.donator) {
                setDonator(_meta.donator);
            }
            setLastFetch(Date.now());

            logger.debug('All positions fetched successfully', {
                chains: Object.keys(response.data),
                hasPositions: Object.values(response.data).some(pos => pos.hasPositions)
            });
        } catch (err) {
            const errorMsg = err.response?.data?.message || err.message || 'Failed to fetch positions';
            logger.error('Error fetching all positions', { error: errorMsg });
            setError(errorMsg);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [walletAddress]);

    // Initial fetch and setup auto-refresh
    useEffect(() => {
        if (!walletAddress) {
            setData(null);
            prevAddressRef.current = null;
            return;
        }

        // Only clear previous data if the actual wallet address changed
        // This prevents network switches from triggering the loading animation
        if (prevAddressRef.current !== walletAddress) {
            setData(null);
            prevAddressRef.current = walletAddress;
        }

        fetchPositions();

        // Auto refresh every 90s (configurable)
        const refreshInterval = opts.refreshIntervalMs || 90000;
        const interval = setInterval(() => {
            if (isTabVisible && isUserActive) {
                fetchPositions();
            } else {
                logger.debug('Skipping auto-refresh: User inactive or tab hidden');
            }
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [fetchPositions, walletAddress, opts.refreshIntervalMs, isTabVisible, isUserActive]);

    // Trigger refresh when user becomes active/tab visible if data is stale (> refreshInterval)
    useEffect(() => {
        if (isTabVisible && isUserActive && lastFetch) {
            const refreshInterval = opts.refreshIntervalMs || 90000;
            if (Date.now() - lastFetch > refreshInterval) {
                logger.debug('User returned and data is stale, refreshing...');
                fetchPositions();
            }
        }
    }, [isTabVisible, isUserActive, lastFetch, fetchPositions, opts.refreshIntervalMs]);

    return {
        positionsByChain: data,
        donator,
        loading,
        error,
        lastFetch,
        refresh: fetchPositions
    };
};

export default useAllPositions;
