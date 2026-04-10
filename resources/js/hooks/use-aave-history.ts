import { router, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useUserActivity } from '../contexts/user-activity-context';
import { useWeb3 } from '../contexts/web3-context';
import logger from '../utils/logger';

type PersistedHistoryItem = {
    id: number | string;
    tx_hash: string | null;
    tx_status: string;
    swap_type: string;
    chain_id: number | string;
    from_token_symbol?: string | null;
    to_token_symbol?: string | null;
    revert_reason?: string | null;
    created_at: string;
};

type HistoryPayload = {
    transactions: PersistedHistoryItem[];
    hasMore: boolean;
    offset: number;
    lastSyncTime: number | null;
    error?: string | null;
};

type HistoryPageProps = {
    historyWallet?: string | null;
    historyPayload?: HistoryPayload;
    [key: string]: unknown;
};

const HISTORY_KEYS = ['historyWallet', 'historyPayload'];
const HISTORY_KEY_SET = new Set(HISTORY_KEYS);

const normalizeWallet = (walletAddress: string | null | undefined) =>
    typeof walletAddress === 'string' && walletAddress !== '' ? walletAddress.toLowerCase() : null;

export const useAaveHistory = (walletAddress: string | null, opts: { refreshIntervalMs?: number } = {}) => {
    const page = usePage<HistoryPageProps>();
    const { isProxyReady } = useWeb3();
    const { isTabVisible, isUserActive } = useUserActivity();
    const { isSheetOpen, transactions: localTransactions } = useTransactionTracker();

    const normalizedWallet = normalizeWallet(walletAddress);
    const historyWallet = normalizeWallet(page.props.historyWallet);
    const isCurrentWalletPage = !!normalizedWallet && historyWallet === normalizedWallet;
    const historyPayload = isCurrentWalletPage ? (page.props.historyPayload as HistoryPayload | undefined) : undefined;
    const needsBootstrapReload = !!normalizedWallet && isProxyReady && historyWallet !== normalizedWallet;

    const [persistedHistory, setPersistedHistory] = useState<PersistedHistoryItem[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
    const [activeHistoryVisits, setActiveHistoryVisits] = useState(0);
    const [historyLoadedForWallet, setHistoryLoadedForWallet] = useState<string | null>(null);
    const requestedOffsetRef = useRef(0);
    const activeWalletRef = useRef<string | null>(normalizedWallet);

    useEffect(() => {
        if (activeWalletRef.current !== normalizedWallet) {
            activeWalletRef.current = normalizedWallet;
            setPersistedHistory([]);
            setHasMore(false);
            setError(null);
            setLastSyncTime(null);
            setHistoryLoadedForWallet(null);
            requestedOffsetRef.current = 0;
        }
    }, [normalizedWallet]);

    useEffect(() => {
        if (!normalizedWallet || !isCurrentWalletPage || historyPayload === undefined) {
            return;
        }

        setError(historyPayload.error ?? null);
        setHasMore(Boolean(historyPayload.hasMore));
        setLastSyncTime(historyPayload.lastSyncTime ?? null);
        setHistoryLoadedForWallet(normalizedWallet);

        setPersistedHistory((prev) => {
            if ((historyPayload.offset ?? 0) <= 0) {
                return historyPayload.transactions || [];
            }

            const existingKeys = new Set(
                prev.map((tx) => (tx.tx_hash || `backend-id-${tx.id}`).toLowerCase())
            );
            const appended = (historyPayload.transactions || []).filter((tx) => {
                const key = (tx.tx_hash || `backend-id-${tx.id}`).toLowerCase();
                return !existingKeys.has(key);
            });

            return [...prev, ...appended];
        });
    }, [historyPayload, isCurrentWalletPage, normalizedWallet]);

    const reloadHistory = useCallback((options?: { force?: boolean; includeWallet?: boolean; offset?: number; limit?: number }) => {
        return new Promise<void>((resolve) => {
            if (!walletAddress || !isProxyReady) {
                resolve();
                return;
            }

            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? 20;
            requestedOffsetRef.current = offset;
            setError(null);

            router.reload({
                only: options?.includeWallet ? HISTORY_KEYS : ['historyPayload'],
                headers: {
                    'X-History-Load': 'true',
                    'X-History-Offset': String(offset),
                    'X-History-Limit': String(limit),
                    ...(options?.force ? { 'X-History-Force': 'true' } : {}),
                },
                onFinish: () => resolve(),
                onError: () => {
                    setError('Failed to fetch history');
                    resolve();
                },
            });
        });
    }, [isProxyReady, walletAddress]);

    const refresh = useCallback((force = false) => {
        return reloadHistory({ force, offset: 0, limit: Math.max(persistedHistory.length, 20) });
    }, [persistedHistory.length, reloadHistory]);

    const loadMore = useCallback(() => {
        if (!hasMore || activeHistoryVisits > 0) {
            return Promise.resolve();
        }

        return reloadHistory({
            offset: persistedHistory.length,
            limit: 20,
        });
    }, [activeHistoryVisits, hasMore, persistedHistory.length, reloadHistory]);

    useEffect(() => {
        if (!isSheetOpen || !walletAddress || !isProxyReady) {
            return;
        }

        if (needsBootstrapReload) {
            void reloadHistory({ includeWallet: true, offset: 0, limit: 20 });
            return;
        }

        if (historyLoadedForWallet !== normalizedWallet) {
            void reloadHistory({ offset: 0, limit: 20 });
        }
    }, [historyLoadedForWallet, isProxyReady, isSheetOpen, needsBootstrapReload, normalizedWallet, reloadHistory, walletAddress]);

    useEffect(() => {
        const removeStart = router.on('start', (event) => {
            const only = event.detail.visit.only || [];
            const touchesHistory = only.length === 0 || only.some((key) => HISTORY_KEY_SET.has(key));

            if (!touchesHistory) {
                return;
            }

            setActiveHistoryVisits((count) => count + 1);
        });

        const removeFinish = router.on('finish', (event) => {
            const only = event.detail.visit.only || [];
            const touchesHistory = only.length === 0 || only.some((key) => HISTORY_KEY_SET.has(key));

            if (!touchesHistory) {
                return;
            }

            setActiveHistoryVisits((count) => Math.max(0, count - 1));
        });

        return () => {
            removeStart();
            removeFinish();
        };
    }, []);

    useEffect(() => {
        if (!isSheetOpen || !walletAddress) {
            return;
        }

        const refreshInterval = opts.refreshIntervalMs || 10000;
        const interval = window.setInterval(() => {
            if (isTabVisible && isUserActive) {
                void refresh(false);
            }
        }, refreshInterval);

        return () => window.clearInterval(interval);
    }, [isSheetOpen, isTabVisible, isUserActive, opts.refreshIntervalMs, refresh, walletAddress]);

    useEffect(() => {
        const handleRefresh = () => {
            if (isSheetOpen && isTabVisible && isUserActive) {
                logger.debug('[useAaveHistory] Global refresh event received, refreshing history');
                void refresh(true);
            }
        };

        window.addEventListener('lilswap:refresh-positions', handleRefresh);
        return () => window.removeEventListener('lilswap:refresh-positions', handleRefresh);
    }, [isSheetOpen, isTabVisible, isUserActive, refresh]);

    const isLoadingInitial = isSheetOpen && !!walletAddress && (
        !isProxyReady ||
        needsBootstrapReload ||
        (activeHistoryVisits > 0 && historyLoadedForWallet !== normalizedWallet) ||
        (isCurrentWalletPage && historyPayload === undefined && historyLoadedForWallet !== normalizedWallet)
    );
    const isLoadingMore = activeHistoryVisits > 0 && requestedOffsetRef.current > 0;
    const isSyncing = activeHistoryVisits > 0 && !isLoadingMore && !isLoadingInitial;

    const combinedHistory = useMemo(() => {
        const localHashes = new Set(localTransactions.map((tx) => tx.hash?.toLowerCase()).filter(Boolean));

        const mappedPersistedHistory = persistedHistory.map((tx) => {
            let mappedStatus: 'pending' | 'success' | 'error' = 'pending';
            if (tx.tx_status === 'CONFIRMED') mappedStatus = 'success';
            else if (['FAILED', 'REJECTED', 'EXPIRED', 'HASH_MISSING'].includes(tx.tx_status)) mappedStatus = 'error';

            return {
                hash: tx.tx_hash || `backend-id-${tx.id}`,
                chainId: Number(tx.chain_id || 1),
                description: tx.swap_type === 'debt' ? 'Debt Swap' : 'Collateral Swap',
                status: mappedStatus,
                timestamp: new Date(tx.created_at).getTime(),
                fromTokenSymbol: tx.from_token_symbol || undefined,
                toTokenSymbol: tx.to_token_symbol || undefined,
                isApi: true,
                revertReason: tx.revert_reason || undefined,
                txStatus: tx.tx_status,
            };
        });

        const filteredPersistedHistory = mappedPersistedHistory.filter((tx) => {
            if (!tx.hash.startsWith('backend-id-')) {
                return !localHashes.has(tx.hash.toLowerCase());
            }

            return true;
        });

        return [...localTransactions, ...filteredPersistedHistory].sort((a, b) => b.timestamp - a.timestamp);
    }, [localTransactions, persistedHistory]);

    return {
        combinedHistory,
        isLoadingHistory: isLoadingInitial,
        isSyncingHistory: isSyncing,
        isLoadingMore,
        hasMore,
        error,
        lastSyncTime,
        refresh,
        loadMore,
    };
};

export default useAaveHistory;
