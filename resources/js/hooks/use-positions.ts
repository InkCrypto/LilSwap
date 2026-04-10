import { router, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserActivity } from '../contexts/user-activity-context';
import { useWeb3 } from '../contexts/web3-context';
import logger from '../utils/logger';
import type { ChainInfo, DonatorInfo } from './use-all-positions';

type PositionsPayload = {
    positionsByChain: Record<string, ChainInfo> | null;
    donator: DonatorInfo;
    error?: string | null;
};

type PositionsPageProps = {
    positionsWallet?: string | null;
    positionsPayload?: PositionsPayload;
    [key: string]: unknown;
};

const EMPTY_DONATOR: DonatorInfo = {
    isDonator: false,
    discountPercent: 0,
};

const RELOAD_KEYS = ['positionsWallet', 'positionsPayload'];
const RELEVANT_KEYS = new Set(RELOAD_KEYS);

const normalizeWallet = (walletAddress: string | null | undefined) =>
    typeof walletAddress === 'string' && walletAddress !== '' ? walletAddress.toLowerCase() : null;

export const usePositions = (walletAddress: string | null, opts: { refreshIntervalMs?: number } = {}) => {
    const page = usePage<PositionsPageProps>();
    const { isProxyReady, isSettlingAccount } = useWeb3();
    const { isTabVisible, isUserActive } = useUserActivity();

    const normalizedWallet = normalizeWallet(walletAddress);
    const positionsWallet = normalizeWallet(page.props.positionsWallet);
    const isCurrentWalletPage = !!normalizedWallet && positionsWallet === normalizedWallet;

    const [positionsByChain, setPositionsByChain] = useState<Record<string, ChainInfo> | null>(null);
    const [donator, setDonator] = useState<DonatorInfo>(EMPTY_DONATOR);
    const [error, setError] = useState<string | null>(null);
    const [lastFetch, setLastFetch] = useState<number | null>(null);
    const [activePositionVisits, setActivePositionVisits] = useState(0);
    const activeWalletRef = useRef<string | null>(normalizedWallet);

    const positionsPayload = isCurrentWalletPage ? (page.props.positionsPayload as PositionsPayload | undefined) : undefined;
    const needsBootstrapReload = !!normalizedWallet && isProxyReady && positionsWallet !== normalizedWallet;
    const loading = !!walletAddress && (
        !isProxyReady ||
        needsBootstrapReload ||
        activePositionVisits > 0 ||
        (isCurrentWalletPage && positionsPayload === undefined && positionsByChain === null)
    );

    useEffect(() => {
        if (activeWalletRef.current !== normalizedWallet) {
            activeWalletRef.current = normalizedWallet;
            setPositionsByChain(null);
            setDonator(EMPTY_DONATOR);
            setError(null);
            setLastFetch(null);
        }
    }, [normalizedWallet]);

    useEffect(() => {
        if (!normalizedWallet || !isCurrentWalletPage || positionsPayload === undefined) {
            setPositionsByChain(null);
            setDonator(EMPTY_DONATOR);
            setError(null);

            return;
        }

        setDonator(positionsPayload.donator ?? EMPTY_DONATOR);
        setPositionsByChain(positionsPayload.positionsByChain);
        setError(positionsPayload.error ?? null);
        setLastFetch(Date.now());
    }, [isCurrentWalletPage, normalizedWallet, positionsPayload]);

    const reloadPositions = useCallback((force = false, includeWallet = false) => {
        return new Promise<void>((resolve) => {
            if (!walletAddress || !isProxyReady) {
                resolve();
                return;
            }

            setError(null);

            router.reload({
                only: includeWallet ? RELOAD_KEYS : ['positionsPayload'],
                headers: force ? { 'X-Positions-Force': 'true' } : undefined,
                onFinish: () => resolve(),
                onError: () => {
                    setError('Failed to fetch positions');
                    resolve();
                },
            });
        });
    }, [isProxyReady, walletAddress]);

    const refresh = useCallback((force = false) => {
        return reloadPositions(force, false);
    }, [reloadPositions]);

    useEffect(() => {
        if (!walletAddress || !isProxyReady || !needsBootstrapReload) {
            return;
        }

        void reloadPositions(false, true);
    }, [isProxyReady, needsBootstrapReload, reloadPositions, walletAddress]);

    useEffect(() => {
        const removeStart = router.on('start', (event) => {
            const only = event.detail.visit.only || [];
            const touchesPositions = only.length === 0 || only.some((key) => RELEVANT_KEYS.has(key));

            if (!touchesPositions) {
                return;
            }

            setActivePositionVisits((count) => count + 1);
        });

        const removeFinish = router.on('finish', (event) => {
            const only = event.detail.visit.only || [];
            const touchesPositions = only.length === 0 || only.some((key) => RELEVANT_KEYS.has(key));

            if (!touchesPositions) {
                return;
            }

            setActivePositionVisits((count) => Math.max(0, count - 1));
        });

        return () => {
            removeStart();
            removeFinish();
        };
    }, []);

    useEffect(() => {
        if (!walletAddress) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 90000;
        const interval = window.setInterval(() => {
            if (isTabVisible && isUserActive) {
                void refresh(false);
            }
        }, refreshInterval);

        return () => window.clearInterval(interval);
    }, [isTabVisible, isUserActive, opts.refreshIntervalMs, refresh, walletAddress]);

    useEffect(() => {
        if (!walletAddress || !lastFetch || isSettlingAccount) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 90000;

        if (isTabVisible && isUserActive && Date.now() - lastFetch > refreshInterval) {
            void refresh(false);
        }
    }, [isSettlingAccount, isTabVisible, isUserActive, lastFetch, opts.refreshIntervalMs, refresh, walletAddress]);

    useEffect(() => {
        const handleRefresh = () => {
            if (isTabVisible && isUserActive) {
                logger.debug('[usePositions] Global refresh event received, forcing reload');
                void refresh(true);
            }
        };

        window.addEventListener('lilswap:refresh-positions', handleRefresh);

        return () => window.removeEventListener('lilswap:refresh-positions', handleRefresh);
    }, [isTabVisible, isUserActive, refresh]);

    return {
        positionsByChain,
        donator,
        loading,
        error,
        lastFetch,
        refresh,
    };
};

export default usePositions;
