import { CheckCircle2, History, ExternalLink, RefreshCw, AlertTriangle, Loader2, MoveRight, Clock, X, ListFilter, Check } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNetworkByChainId } from '../constants/networks';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useActivityHistory } from '../hooks/use-activity-history';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { useWeb3, wagmiConfig } from '../contexts/web3-context';
import { getConnectorClient } from 'wagmi/actions';
import { signTypedData, sendTransaction } from 'viem/actions';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { prepareCancelLimitOrder, postCancelLimitOrder } from '../services/api';
import type { ActivityItem, ActivityType } from '../types/activity';
import { getActivityLabel, getActivityColor } from '../types/activity';

const ALL_ACTIVITY_TYPES: ActivityType[] = ['spot-swap', 'aave-swap', 'limit-order'];

export const HistorySheet: React.FC = () => {
    const {
        isSheetOpen,
        setSheetOpen,
    } = useTransactionTracker();

    const { account: address, walletClient } = useWeb3();
    const {
        combinedHistory,
        isLoadingHistory,
        isSyncingHistory,
        isLoadingMore,
        hasMore,
        error,
        lastSyncTime,
        refresh,
        loadMore,
    } = useActivityHistory(address);
    const observerTarget = useRef<HTMLDivElement>(null);
    const [showAbsolute, setShowAbsolute] = useState(false);
    const [activeFilters, setActiveFilters] = useState<Set<ActivityType>>(
        new Set(ALL_ACTIVITY_TYPES)
    );
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);
    const [touchStart, setTouchStart] = React.useState({ x: 0, y: 0 });
    const [cancellingOrderUid, setCancellingOrderUid] = useState<string | null>(null);
    const [cancelError, setCancelError] = useState<string | null>(null);

    const handleCancelOrder = useCallback(async (orderUid: string, chainId: number) => {
        if (!address || cancellingOrderUid) return;
        setCancellingOrderUid(orderUid);
        setCancelError(null);
        try {
            const prepareResult = await prepareCancelLimitOrder({
                walletAddress: address,
                chainId,
                orderUid,
            });

            if (!walletClient) throw new Error('Wallet not connected');

            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            const activeWalletClient = await getConnectorClient(wagmiConfig, {
                account: address as `0x${string}`,
                chainId: chainId as any,
            });

            if (prepareResult.cancellationType === 'onchain') {
                if (!prepareResult.transactionRequest) {
                    throw new Error('On-chain cancellation transaction request was not returned');
                }

                const { to, data } = prepareResult.transactionRequest;
                const txHash = await sendTransaction(activeWalletClient, {
                    account: address as `0x${string}`,
                    to: to as `0x${string}`,
                    data: data as `0x${string}`,
                });

                await postCancelLimitOrder({
                    walletAddress: address,
                    chainId,
                    orderUid,
                    txHash,
                });
            } else {
                if (!prepareResult.signatureRequest) {
                    throw new Error('Signature request was not returned for off-chain cancellation');
                }

                const { domain, types, message, primaryType } = prepareResult.signatureRequest;
                const signature = await signTypedData(activeWalletClient, {
                    account: address as `0x${string}`,
                    domain: domain as any,
                    types: types as any,
                    primaryType: (primaryType || 'OrderCancellations') as any,
                    message: message as any,
                });

                await postCancelLimitOrder({
                    walletAddress: address,
                    chainId,
                    orderUid,
                    signature,
                });
            }

            void refresh();
        } catch (err: any) {
            if (err?.code !== 4001 && err?.code !== 'ACTION_REJECTED') {
                setCancelError(err?.message || 'Cancel failed');
            }
        } finally {
            setCancellingOrderUid(null);
        }
    }, [address, cancellingOrderUid, walletClient, refresh]);

    const toggleFilter = useCallback((type: ActivityType) => {
        setActiveFilters((prev) => {
            const next = new Set(prev);
            if (next.has(type)) {
                // Don't allow deselecting all
                if (next.size === 1) return prev;
                next.delete(type);
            } else {
                next.add(type);
            }
            return next;
        });
    }, []);

    const displayedHistory = useMemo(() => {
        if (activeFilters.size === ALL_ACTIVITY_TYPES.length) {
            return combinedHistory;
        }

        return combinedHistory.filter((item) => activeFilters.has(item.activityType));
    }, [activeFilters, combinedHistory]);

    // Close filter dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
                setIsFilterOpen(false);
            }
        };

        if (isFilterOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isFilterOpen]);

    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStart({
            x: e.targetTouches[0].clientX,
            y: e.targetTouches[0].clientY,
        });
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const deltaX = e.changedTouches[0].clientX - touchStart.x;
        const deltaY = e.changedTouches[0].clientY - touchStart.y;

        if (deltaX > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            setSheetOpen(false);
        }
    };

    useEffect(() => {
        const target = observerTarget.current;
        if (!target) return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !isLoadingHistory && address) {
                    void loadMore();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(target);
        return () => observer.unobserve(target);
    }, [address, hasMore, isLoadingHistory, loadMore]);

    const formatTimestamp = (timestamp: number) => {
        if (showAbsolute) {
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true,
            }).format(new Date(timestamp));
        }

        const now = Date.now();
        const diffInSeconds = Math.floor((now - timestamp) / 1000);

        if (diffInSeconds < 60) return 'Just now';

        const minutes = Math.floor(diffInSeconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;

        const months = Math.floor(days / 30);
        return `${months}mo ago`;
    };

    const getOrderExplorerUrl = (chainId: number, orderUid?: string) => {
        if (!orderUid) return '#';

        const chainSlugById: Record<number, string> = {
            1: 'eth',
            100: 'gno',
            137: 'pol',
            42161: 'arb1',
            8453: 'base',
            43114: 'avax',
        };
        const chainSlug = chainSlugById[chainId] || String(chainId);

        return `https://explorer.cow.fi/${chainSlug}/orders/${orderUid}`;
    };

    const filterCount = activeFilters.size;

    return (
        <Sheet open={isSheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent
                side="right"
                className="w-full sm:max-w-md bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 p-0 flex flex-col"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <SheetHeader className="p-6 pb-2">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="text-xl font-bold flex items-center gap-2">
                            <History className="w-5 h-5 text-primary" />
                            Recent Activity
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            Your recent transaction history and status updates.
                        </SheetDescription>
                    </div>
                    <div className="flex justify-end items-center gap-2 mt-1 -mr-1">
                        {/* Filter button */}
                        <div ref={filterRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsFilterOpen((prev) => !prev)}
                                className="flex items-center text-slate-400 hover:text-primary transition-colors focus:outline-hidden"
                                title="Filter by activity type"
                            >
                                <ListFilter className="w-3.5 h-3.5" />
                                {filterCount < ALL_ACTIVITY_TYPES.length && (
                                    <span className="ml-1 text-[10px] font-bold text-primary">{filterCount}</span>
                                )}
                            </button>

                            {isFilterOpen && (
                                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg p-1.5 z-50">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 pb-1 pt-0.5">
                                        Show
                                    </p>
                                    {ALL_ACTIVITY_TYPES.map((type) => {
                                        const isActive = activeFilters.has(type);
                                        return (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => toggleFilter(type)}
                                                className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${isActive
                                                    ? 'text-slate-900 dark:text-white'
                                                    : 'text-slate-400 dark:text-slate-500'
                                                    } hover:bg-slate-100 dark:hover:bg-slate-800`}
                                            >
                                                <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${isActive
                                                    ? 'bg-primary text-white'
                                                    : 'bg-slate-200 dark:bg-slate-700'
                                                    }`}>
                                                    {isActive && <Check className="w-3 h-3" />}
                                                </span>
                                                <span>{getActivityLabel(type)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Refresh button */}
                        <button
                            onClick={() => void refresh()}
                            disabled={isSyncingHistory || isLoadingHistory}
                            className="flex items-center group text-slate-400 hover:text-primary transition-colors focus:outline-hidden disabled:opacity-50"
                            title={lastSyncTime ? 'Refresh history' : 'Load history'}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingHistory || (isLoadingHistory && combinedHistory.length === 0) ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-800/60 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {error && combinedHistory.length === 0 && !isLoadingHistory && (
                        <div className="px-6 pt-4 text-sm text-red-500 dark:text-red-400">
                            {error}
                        </div>
                    )}
                    {displayedHistory.length === 0 && !isLoadingHistory ? (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-slate-500 dark:text-slate-400">
                            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                                <RefreshCw className="w-8 h-8 opacity-50" />
                            </div>
                            <div>
                                <p className="font-medium text-slate-700 dark:text-slate-300">
                                    {filterCount < ALL_ACTIVITY_TYPES.length
                                        ? 'No matching activity'
                                        : 'No recent transactions'}
                                </p>
                                <p className="text-sm mt-1">
                                    {filterCount < ALL_ACTIVITY_TYPES.length
                                        ? 'Try adjusting the filter to see more'
                                        : 'Your activity will appear here'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800/60">
                            {displayedHistory.map((tx: ActivityItem) => {
                                const network = getNetworkByChainId(tx.chainId);
                                const isMockHash = tx.hash.startsWith('backend-id-') || tx.hash.startsWith('limit-order-');
                                const isLimitOrder = tx.activityType === 'limit-order';
                                const explorerUrl = !isMockHash && network ? `${network.explorer}/tx/${tx.hash}` : '#';
                                const orderExplorerUrl = isLimitOrder ? getOrderExplorerUrl(tx.chainId, tx.orderUid) : '#';

                                return (
                                    <div
                                        key={tx.hash}
                                        className="px-4 py-4 sm:px-6 transition-all hover:bg-slate-50 dark:hover:bg-slate-900/40 group animate-in fade-in slide-in-from-top-4 duration-500 fill-mode-both"
                                    >
                                        <div className="flex items-start gap-2.5 sm:gap-3">
                                            <div className="hidden sm:block shrink-0 mt-1">
                                                {isLimitOrder && tx.txStatus === 'OPEN' ? (
                                                    <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                                                        <Clock className="w-4 h-4 text-blue-500" />
                                                    </div>
                                                ) : tx.status === 'pending' ? (
                                                    <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                                                        <RefreshCw className="w-4 h-4 text-amber-500 animate-spin" />
                                                    </div>
                                                ) : tx.status === 'success' ? (
                                                    <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                                    </div>
                                                ) : tx.status === 'error' ? (
                                                    <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                                                        <AlertTriangle className="w-5 h-5 text-red-500" />
                                                    </div>
                                                ) : null}
                                            </div>

                                            <div className="flex-1 min-w-0 space-y-2">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <p className="min-w-0 truncate font-semibold text-sm text-slate-900 dark:text-white">
                                                        {tx.description}
                                                    </p>

                                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${isLimitOrder
                                                        ? (tx.txStatus === 'OPEN'
                                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                                                            : tx.status === 'success'
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400')
                                                        : (tx.status === 'pending'
                                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                                                            : tx.status === 'success'
                                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400')
                                                        }`}>
                                                        {isLimitOrder
                                                            ? (tx.txStatus === 'OPEN' ? 'Open' : tx.txStatus)
                                                            : tx.status === 'pending'
                                                                ? 'Processing...'
                                                                : tx.status === 'success'
                                                                    ? 'Confirmed'
                                                                    : (tx.revertReason === 'reverted' ? 'Reverted' : 'Failed')}
                                                    </span>

                                                    <button
                                                        onClick={() => setShowAbsolute(!showAbsolute)}
                                                        className="ml-auto shrink-0 text-[10px] text-slate-400 hover:text-primary transition-colors whitespace-nowrap text-right focus:outline-hidden"
                                                        title={showAbsolute ? 'Show relative time' : 'Show full date'}
                                                    >
                                                        {formatTimestamp(tx.timestamp)}
                                                    </button>
                                                </div>

                                                <div className="flex min-w-0 items-center gap-4">
                                                    {(tx.fromTokenSymbol || tx.toTokenSymbol) ? (
                                                        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                                            <div className="flex min-w-0 items-center gap-1">
                                                                <div className="w-4 h-4 rounded-full overflow-hidden shrink-0">
                                                                    <img
                                                                        src={getTokenLogo(tx.fromTokenSymbol || '')}
                                                                        alt={tx.fromTokenSymbol}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => onTokenImgError(tx.fromTokenSymbol || '')(e as any)}
                                                                    />
                                                                </div>
                                                                <span className="truncate text-[11px] font-semibold text-slate-900 dark:text-white uppercase leading-none">{tx.fromTokenSymbol}</span>
                                                            </div>

                                                            <MoveRight className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500 opacity-60" strokeWidth={2.5} />

                                                            <div className="flex min-w-0 items-center gap-1">
                                                                <div className="w-4 h-4 rounded-full overflow-hidden shrink-0">
                                                                    <img
                                                                        src={getTokenLogo(tx.toTokenSymbol || '')}
                                                                        alt={tx.toTokenSymbol}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => onTokenImgError(tx.toTokenSymbol || '')(e as any)}
                                                                    />
                                                                </div>
                                                                <span className="truncate text-[11px] font-semibold text-slate-900 dark:text-white uppercase leading-none">{tx.toTokenSymbol}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="min-w-0" />
                                                    )}

                                                    {network && (
                                                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                                            {network.shortLabel}
                                                        </span>
                                                    )}

                                                    {isLimitOrder ? (
                                                        <a
                                                            href={orderExplorerUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 hover:text-primary dark:text-slate-400 dark:hover:text-primary transition-colors"
                                                        >
                                                            View order
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    ) : !isMockHash && (
                                                        <a
                                                            href={explorerUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 hover:text-primary dark:text-slate-400 dark:hover:text-primary transition-colors"
                                                        >
                                                            View tx
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                </div>

                                                {isLimitOrder && (
                                                    <div className="space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                        {(tx.fromAmount || tx.toAmount) && (
                                                            <p>
                                                                {[tx.fromAmount, tx.fromTokenSymbol].filter(Boolean).join(' ')}
                                                                {' -> '}
                                                                {[tx.toAmount, tx.toTokenSymbol].filter(Boolean).join(' ')}
                                                            </p>
                                                        )}
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                            {tx.limitPrice && (
                                                                <span>Limit price {tx.limitPrice}</span>
                                                            )}
                                                            {tx.validTo && tx.validTo > 0 && (
                                                                <span>
                                                                    Expires {new Intl.DateTimeFormat('en-US', {
                                                                        month: 'short',
                                                                        day: 'numeric',
                                                                        hour: 'numeric',
                                                                        minute: 'numeric',
                                                                    }).format(new Date(tx.validTo * 1000))}
                                                                </span>
                                                            )}
                                                            {tx.txStatus === 'OPEN' && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCancelOrder(tx.orderUid!, tx.chainId)}
                                                                    disabled={cancellingOrderUid === tx.orderUid}
                                                                    className="inline-flex items-center gap-0.5 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                                                                >
                                                                    {cancellingOrderUid === tx.orderUid ? (
                                                                        <><Loader2 className="w-3 h-3 animate-spin" /> Cancelling...</>
                                                                    ) : (
                                                                        <><X className="w-3 h-3" /> Cancel</>)}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {cancelError && cancellingOrderUid === null && tx.txStatus === 'OPEN' && (
                                                            <p className="text-[10px] text-red-500">{cancelError}</p>
                                                        )}
                                                    </div>
                                                )}

                                                {tx.status === 'error' && tx.revertReason && (
                                                    <p className="mt-2 text-xs text-red-500 dark:text-red-400">
                                                        {tx.revertReason}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <div ref={observerTarget} className="h-12 flex items-center justify-center">
                                {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                            </div>
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
};

export default HistorySheet;
