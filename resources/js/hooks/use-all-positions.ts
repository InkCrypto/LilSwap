import { useState, useEffect, useCallback, useRef } from 'react';
import { useUserActivity } from '../contexts/user-activity-context';
import { useWeb3 } from '../contexts/web3-context';
import { apiClient } from '../services/api';
import logger from '../utils/logger';

export interface PositionInfo {
    formattedAmount: string;
    symbol: string;
    underlyingAsset: string;
    priceInUSD: string;
    [key: string]: any;
}

export interface ChainInfo {
    supplies: PositionInfo[];
    borrows: PositionInfo[];
    summary: {
        healthFactor: string;
        netWorthUSD: string;
        netAPY: string;
        [key: string]: any;
    };
    hasPositions: boolean;
    error?: string;
    marketAssets: any[];
}

export interface DonatorInfo {
    isDonator: boolean;
    discountPercent: number;
    type?: string;
}

export const useAllPositions = (walletAddress: string | null, opts: { refreshIntervalMs?: number } = {}) => {
    const [data, setData] = useState<Record<string, ChainInfo> | null>(null);
    const [donator, setDonator] = useState<DonatorInfo>({ isDonator: false, discountPercent: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetch, setLastFetch] = useState<number | null>(null);
    const { isTabVisible, isUserActive } = useUserActivity();
    const { isSettlingAccount } = useWeb3();
    const prevAddressRef = useRef<string | null>(walletAddress);

    const fetchPositions = useCallback(async (force = false) => {
        if (!walletAddress) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.post('/aave/v3/positions', {
                walletAddress,
                ...(force && { force: true })
            }, {
                timeout: 30000
            });

            const { _meta, ...positionsByChain } = response.data;
            setData(positionsByChain as Record<string, ChainInfo>);

            if (_meta?.donator) {
                setDonator(_meta.donator);
            }

            setLastFetch(Date.now());
        } catch (err: any) {
            const errorMsg = err.response?.data?.message || err.message || 'Failed to fetch positions';
            logger.error('Error fetching all positions', { error: errorMsg });
            setError(errorMsg);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [walletAddress]);

    useEffect(() => {
        if (!walletAddress) {
            setData(null);
            prevAddressRef.current = null;

            return;
        }

        if (prevAddressRef.current !== walletAddress) {
            setData(null);
            prevAddressRef.current = walletAddress;
        }

        fetchPositions();
    }, [fetchPositions, walletAddress]);

    useEffect(() => {
        if (!walletAddress) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 90000;
        const interval = setInterval(() => {
            if (isTabVisible && isUserActive) {
                fetchPositions();
            }
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [fetchPositions, walletAddress, opts.refreshIntervalMs, isTabVisible, isUserActive]);

    useEffect(() => {
        if (isTabVisible && isUserActive && lastFetch && !isSettlingAccount) {
            const refreshInterval = opts.refreshIntervalMs || 90000;
            const timeSinceLastFetch = Date.now() - lastFetch;

            if (timeSinceLastFetch > refreshInterval) {
                fetchPositions();
            }
        }
    }, [isTabVisible, isUserActive, lastFetch, fetchPositions, opts.refreshIntervalMs, isSettlingAccount]);

    // Handle global refresh events (e.g. from transaction tracker)
    useEffect(() => {
        const handleRefresh = () => {
            if (isTabVisible && isUserActive) {
                logger.debug('[useAllPositions] Global refresh event received, forcing fetch');
                fetchPositions(true);
            }
        };

        window.addEventListener('lilswap:refresh-positions', handleRefresh);

        return () => window.removeEventListener('lilswap:refresh-positions', handleRefresh);
    }, [fetchPositions, isTabVisible, isUserActive]);


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
