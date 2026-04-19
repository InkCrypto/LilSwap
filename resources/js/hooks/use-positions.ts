import { router, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserActivity } from '../contexts/user-activity-context';
import { useWeb3 } from '../contexts/web3-context';
import { bootstrapProxySession } from '../services/api';
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
    const needsBootstrapReload =
        !!normalizedWallet &&
        isProxyReady &&
        activePositionVisits === 0 &&
        positionsWallet !== normalizedWallet;
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
        if (!normalizedWallet || !isCurrentWalletPage) {
            setPositionsByChain(null);
            setDonator(EMPTY_DONATOR);
            setError(null);

            return;
        }

        if (positionsPayload === undefined) {
            return;
        }

        setDonator(positionsPayload.donator ?? EMPTY_DONATOR);
        setError(positionsPayload.error ?? null);

        if (positionsPayload.positionsByChain !== null) {
            setPositionsByChain(positionsPayload.positionsByChain);
            setLastFetch(Date.now());
        }
    }, [isCurrentWalletPage, normalizedWallet, positionsPayload]);

    const reloadPositions = useCallback((force = false, includeWallet = false) => {
        return new Promise<void>((resolve) => {
            if (!walletAddress || !isProxyReady) {
                resolve();
                return;
            }

            // Strict guard: Do not allow partial data refreshes (includeWallet=false)
            // if the server is out of sync with the client wallet. This prevents
            // rogue GET requests from locking onto the old session and overwriting
            // the new session via cookie driver race conditions.
            const targetWallet = normalizeWallet(walletAddress);
            const serverWallet = positionsWallet;
            if (!includeWallet && targetWallet !== serverWallet) {
                resolve();
                return;
            }

            setError(null);

            router.reload({
                only: includeWallet ? RELOAD_KEYS : ['positionsPayload'],
                headers: {
                    ...(force ? { 'X-Positions-Force': 'true' } : {}),
                    'X-Target-Wallet': targetWallet || '',
                },
                onFinish: () => resolve(),
                onError: () => {
                    setError('Failed to fetch positions');
                    resolve();
                },
            });
        });
    }, [isProxyReady, positionsWallet, walletAddress]);

    const refresh = useCallback((force = false) => {
        return reloadPositions(force, false);
    }, [reloadPositions]);

    useEffect(() => {
        if (!walletAddress || !isProxyReady || !needsBootstrapReload) {
            return;
        }

        void (async () => {
            await bootstrapProxySession({
                walletAddress,
            });

            await reloadPositions(false, true);
        })();
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
        if (!walletAddress || !isCurrentWalletPage) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 90000;
        const interval = window.setInterval(() => {
            if (isTabVisible && isUserActive) {
                void refresh(false);
            }
        }, refreshInterval);

        return () => window.clearInterval(interval);
    }, [isTabVisible, isUserActive, opts.refreshIntervalMs, refresh, walletAddress, isCurrentWalletPage]);

    useEffect(() => {
        if (!walletAddress || !lastFetch || isSettlingAccount || !isCurrentWalletPage) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 90000;

        if (isTabVisible && isUserActive && Date.now() - lastFetch > refreshInterval) {
            void refresh(false);
        }
    }, [isCurrentWalletPage, isSettlingAccount, isTabVisible, isUserActive, lastFetch, opts.refreshIntervalMs, refresh, walletAddress]);

    useEffect(() => {
        let debounceTimer: ReturnType<typeof setTimeout>;

        const handleRefresh = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                logger.debug('[usePositions] Global refresh event received, forcing reload');
                void refresh(true);
            }, 300);
        };

        window.addEventListener('lilswap:refresh-positions', handleRefresh);

        return () => {
            clearTimeout(debounceTimer);
            window.removeEventListener('lilswap:refresh-positions', handleRefresh);
        };
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
