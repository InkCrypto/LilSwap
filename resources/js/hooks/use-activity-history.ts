import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useUserActivity } from '../contexts/user-activity-context';
import { useWeb3 } from '../contexts/web3-context';
import { getUnifiedHistory, type LimitOrderHistoryItem, type UnifiedHistoryItem } from '../services/api';
import type { ActivityItem, ActivityType } from '../types/activity';
import logger from '../utils/logger';

const normalizeWallet = (walletAddress: string | null | undefined) =>
    typeof walletAddress === 'string' && walletAddress !== '' ? walletAddress.toLowerCase() : null;

const parseDbTimestampUtcToMillis = (raw: string): number => {
    if (!raw) return Date.now();

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const hasTimezone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized);
    if (hasTimezone) {
        const parsed = Date.parse(normalized);
        if (!Number.isNaN(parsed)) return parsed;
    }

    const localParsed = Date.parse(normalized);
    const utcParsed = Date.parse(`${normalized}Z`);

    const localValid = !Number.isNaN(localParsed);
    const utcValid = !Number.isNaN(utcParsed);

    if (!localValid && !utcValid) {
        const fallback = Date.parse(raw);
        return Number.isNaN(fallback) ? Date.now() : fallback;
    }

    if (!localValid) return utcParsed;
    if (!utcValid) return localParsed;

    const now = Date.now();
    const futureToleranceMs = 5 * 60 * 1000;

    const localIsFuture = localParsed - now > futureToleranceMs;
    const utcIsFuture = utcParsed - now > futureToleranceMs;

    if (localIsFuture && !utcIsFuture) return utcParsed;
    if (utcIsFuture && !localIsFuture) return localParsed;

    return Math.abs(now - localParsed) <= Math.abs(now - utcParsed) ? localParsed : utcParsed;
};

/**
 * Derive ActivityType from a DB swap_type string.
 */
function swapTypeToActivityType(swapType: string): ActivityType {
    if (swapType === 'spot') return 'spot-swap';
    // debt, collateral, withdraw-swap, repay-swap are all Aave operations
    return 'aave-swap';
}

/**
 * Derive a human-readable description from swap_type + token symbols.
 */
function swapTypeToDescription(swapType: string, fromSymbol?: string | null, toSymbol?: string | null): string {
    switch (swapType) {
        case 'debt':
            return 'Debt Swap';
        case 'collateral':
            return 'Collateral Swap';
        case 'withdraw-swap':
            return 'Withdraw Swap';
        case 'repay-swap':
            return 'Repay Swap';
        case 'spot':
            return fromSymbol && toSymbol ? `Swap ${fromSymbol} to ${toSymbol}` : 'Spot Swap';
        default:
            return 'Swap';
    }
}

export const useActivityHistory = (walletAddress: string | null, opts: { refreshIntervalMs?: number } = {}) => {
    const { isProxyReady } = useWeb3();
    const { isTabVisible, isUserActive } = useUserActivity();
    const { isSheetOpen, transactions: localTransactions } = useTransactionTracker();

    const [persistedHistory, setPersistedHistory] = useState<UnifiedHistoryItem[]>([]);
    const [limitOrders, setLimitOrders] = useState<LimitOrderHistoryItem[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [historyLoadedForWallet, setHistoryLoadedForWallet] = useState<string | null>(null);
    const activeWalletRef = useRef<string | null>(normalizeWallet(walletAddress));

    // Reset state when wallet changes
    useEffect(() => {
        const normalized = normalizeWallet(walletAddress);
        if (activeWalletRef.current !== normalized) {
            activeWalletRef.current = normalized;
            setPersistedHistory([]);
            setLimitOrders([]);
            setHasMore(false);
            setError(null);
            setLastSyncTime(null);
            setHistoryLoadedForWallet(null);
        }
    }, [walletAddress]);

    // Core fetch — single Axios call replacing Inertia reload + separate limit orders call
    const fetchHistory = useCallback(async (opts?: { append?: boolean }) => {
        const targetWallet = normalizeWallet(walletAddress);
        if (!targetWallet || !isProxyReady) return;

        setIsLoading(true);
        setError(null);

        try {
            const data = await getUnifiedHistory({
                walletAddress: targetWallet,
                limit: 20,
                offset: opts?.append ? persistedHistory.length : 0,
            });

            setError(data.error ?? null);
            setHasMore(Boolean(data.hasMore));
            setLastSyncTime(data.lastSyncTime ?? null);
            setHistoryLoadedForWallet(targetWallet);

            if (opts?.append) {
                const existingKeys = new Set(
                    persistedHistory.map((tx) => (tx.tx_hash || `backend-id-${tx.id}`).toLowerCase())
                );
                const appended = (data.transactions || []).filter((tx) => {
                    const key = (tx.tx_hash || `backend-id-${tx.id}`).toLowerCase();
                    return !existingKeys.has(key);
                });
                setPersistedHistory((prev) => [...prev, ...appended]);
            } else {
                setPersistedHistory(data.transactions || []);
            }

            setLimitOrders(data.limitOrders || []);
        } catch (err: any) {
            logger.error('[useActivityHistory] Fetch failed', err);
            if (!opts?.append) {
                setError('Failed to fetch history');
            }
        } finally {
            setIsLoading(false);
        }
    }, [walletAddress, isProxyReady, persistedHistory.length]);

    // Load on sheet open
    useEffect(() => {
        const normalized = normalizeWallet(walletAddress);
        if (!isSheetOpen || !normalized || !isProxyReady) return;
        if (historyLoadedForWallet === normalized) return;

        void fetchHistory();
    }, [isSheetOpen, isProxyReady, walletAddress, historyLoadedForWallet, fetchHistory]);

    // Periodic refresh
    useEffect(() => {
        if (!isSheetOpen || !walletAddress) return;

        const refreshInterval = opts.refreshIntervalMs || 10000;
        const interval = window.setInterval(() => {
            if (isTabVisible && isUserActive) {
                void fetchHistory();
            }
        }, refreshInterval);

        return () => window.clearInterval(interval);
    }, [isSheetOpen, isTabVisible, isUserActive, opts.refreshIntervalMs, fetchHistory, walletAddress]);

    // External refresh event
    useEffect(() => {
        const handleRefresh = () => {
            if (isSheetOpen && isTabVisible && isUserActive) {
                logger.debug('[useActivityHistory] Global refresh event received');
                void fetchHistory();
            }
        };

        window.addEventListener('lilswap:refresh-positions', handleRefresh);
        return () => window.removeEventListener('lilswap:refresh-positions', handleRefresh);
    }, [isSheetOpen, isTabVisible, isUserActive, fetchHistory]);

    const refresh = useCallback(() => {
        return fetchHistory();
    }, [fetchHistory]);

    const loadMore = useCallback(() => {
        if (!hasMore || isLoading) return;
        return fetchHistory({ append: true });
    }, [hasMore, isLoading, fetchHistory]);

    const combinedHistory: ActivityItem[] = useMemo(() => {
        const localHashes = new Set(localTransactions.map((tx) => tx.hash?.toLowerCase()).filter(Boolean));

        const mappedPersistedHistory: ActivityItem[] = (persistedHistory || []).map((tx) => {
            let mappedStatus: 'pending' | 'success' | 'error' = 'pending';
            if (tx.tx_status === 'CONFIRMED') mappedStatus = 'success';
            else if (['FAILED', 'REJECTED', 'EXPIRED'].includes(tx.tx_status)) mappedStatus = 'error';

            const excludedStatuses = ['HASH_MISSING', 'REJECTED', 'EXPIRED', 'INITIATED'];
            if (tx.tx_status && excludedStatuses.includes(tx.tx_status)) return null;

            const activityType = swapTypeToActivityType(tx.swap_type);
            const description = swapTypeToDescription(tx.swap_type, tx.from_token_symbol, tx.to_token_symbol);

            return {
                hash: tx.tx_hash || `backend-id-${tx.id}`,
                chainId: Number(tx.chain_id || 1),
                description,
                status: mappedStatus,
                timestamp: parseDbTimestampUtcToMillis(tx.created_at),
                activityType,
                fromTokenSymbol: tx.from_token_symbol || undefined,
                toTokenSymbol: tx.to_token_symbol || undefined,
                isApi: true,
                revertReason: tx.revert_reason || undefined,
                txStatus: tx.tx_status,
            } as ActivityItem;
        }).filter((item): item is ActivityItem => item !== null);

        const filteredPersistedHistory = mappedPersistedHistory.filter((tx) => {
            if (!tx.hash.startsWith('backend-id-')) {
                return !localHashes.has(tx.hash.toLowerCase());
            }
            return true;
        });

        const mappedLocal: ActivityItem[] = localTransactions
            .filter((tx) => tx.activityType)
            .map((tx) => ({
                hash: tx.hash,
                chainId: tx.chainId,
                description: tx.description,
                status: tx.status,
                timestamp: tx.timestamp,
                activityType: tx.activityType!,
                fromTokenSymbol: tx.fromTokenSymbol,
                toTokenSymbol: tx.toTokenSymbol,
                revertReason: tx.revertReason,
                txStatus: tx.txStatus,
            } as ActivityItem));

        const mappedLimitOrders: ActivityItem[] = (limitOrders || []).map((order) => {
            let mappedStatus: 'pending' | 'success' | 'error' = 'pending';
            const status = String(order.status || '').toUpperCase();
            if (status === 'FULFILLED') mappedStatus = 'success';
            else if (['EXPIRED', 'CANCELLED', 'INVALIDATED'].includes(status)) mappedStatus = 'error';

            return {
                hash: `limit-order-${order.order_uid}`,
                chainId: Number(order.chain_id || 1),
                description: 'Debt Limit Order',
                status: mappedStatus,
                timestamp: parseDbTimestampUtcToMillis(order.created_at),
                activityType: 'limit-order' as ActivityType,
                fromTokenSymbol: order.from_token_symbol || undefined,
                toTokenSymbol: order.to_token_symbol || undefined,
                isApi: true,
                txStatus: status,
                orderUid: order.order_uid,
                limitPrice: order.limit_price || undefined,
                validTo: Number(order.valid_to || 0),
                fromAmount: order.from_amount || undefined,
                toAmount: order.to_amount || undefined,
            } as ActivityItem;
        });

        return [...mappedLocal, ...filteredPersistedHistory, ...mappedLimitOrders].sort(
            (a, b) => b.timestamp - a.timestamp
        );
    }, [localTransactions, persistedHistory, limitOrders]);

    return {
        combinedHistory,
        isLoadingHistory: isLoading && combinedHistory.length === 0,
        isSyncingHistory: isLoading && combinedHistory.length > 0,
        isLoadingMore: false,
        hasMore,
        error,
        lastSyncTime,
        refresh,
        loadMore,
    };
};

export default useActivityHistory;
