import { CheckCircle2, History, ExternalLink, RefreshCw, AlertTriangle, Loader2, MoveRight } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getNetworkByChainId } from '../constants/networks';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useAaveHistory } from '../hooks/use-aave-history';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { useWeb3 } from '../contexts/web3-context';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';

export const AaveHistorySheet: React.FC = () => {
    const {
        isSheetOpen,
        setSheetOpen,
    } = useTransactionTracker();

    const { account: address } = useWeb3();
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
    } = useAaveHistory(address);
    const observerTarget = useRef<HTMLDivElement>(null);
    const [showAbsolute, setShowAbsolute] = useState(false);
    const [activityFilter, setActivityFilter] = useState<'all' | 'swaps' | 'limit-orders'>('all');
    const [touchStart, setTouchStart] = React.useState({ x: 0, y: 0 });

    const displayedHistory = useMemo(() => {
        if (activityFilter === 'swaps') {
            return combinedHistory.filter((item: any) => item.itemType !== 'limit-order');
        }

        if (activityFilter === 'limit-orders') {
            return combinedHistory.filter((item: any) => item.itemType === 'limit-order');
        }

        return combinedHistory;
    }, [activityFilter, combinedHistory]);

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
                            Your recent Aave transaction history and status updates.
                        </SheetDescription>
                    </div>
                    <div className="flex justify-end mt-1 -mr-1">
                        <button
                            onClick={() => void refresh(true)}
                            disabled={isSyncingHistory || isLoadingHistory}
                            className="flex items-center group text-slate-400 hover:text-primary transition-colors focus:outline-hidden disabled:opacity-50"
                            title={lastSyncTime ? 'Refresh history' : 'Load history'}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingHistory || (isLoadingHistory && combinedHistory.length === 0) ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                    <div className="mt-3 flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
                        {[
                            { key: 'all', label: 'All' },
                            { key: 'swaps', label: 'Swaps' },
                            { key: 'limit-orders', label: 'Limit Orders' },
                        ].map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setActivityFilter(option.key as typeof activityFilter)}
                                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
                                    activityFilter === option.key
                                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
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
                                <p className="font-medium text-slate-700 dark:text-slate-300">No recent transactions</p>
                                <p className="text-sm mt-1">Your swap activity will appear here</p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800/60">
                            {displayedHistory.map((tx: any) => {
                                const network = getNetworkByChainId(tx.chainId);
                                const isMockHash = tx.hash.startsWith('backend-id-');
                                const isLimitOrder = tx.itemType === 'limit-order';
                                const explorerUrl = !isMockHash && network ? `${network.explorer}/tx/${tx.hash}` : '#';
                                const orderExplorerUrl = isLimitOrder ? getOrderExplorerUrl(tx.chainId, tx.orderUid) : '#';

                                return (
                                    <div
                                        key={tx.hash}
                                        className="px-4 py-4 sm:px-6 transition-all hover:bg-slate-50 dark:hover:bg-slate-900/40 group animate-in fade-in slide-in-from-top-4 duration-500 fill-mode-both"
                                    >
                                        <div className="flex items-start gap-2.5 sm:gap-3">
                                            <div className="hidden sm:block shrink-0 mt-1">
                                                {tx.status === 'pending' && (
                                                    <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                                                        <RefreshCw className="w-4 h-4 text-amber-500 animate-spin" />
                                                    </div>
                                                )}
                                                {tx.status === 'success' && (
                                                    <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                                    </div>
                                                )}
                                                {tx.status === 'error' && (
                                                    <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                                                        <AlertTriangle className="w-5 h-5 text-red-500" />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0 space-y-2">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <p className="min-w-0 truncate font-semibold text-sm text-slate-900 dark:text-white">
                                                        {tx.description}
                                                    </p>

                                                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${tx.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                                                        tx.status === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                            'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                                                    }`}>
                                                        {isLimitOrder ? (tx.txStatus === 'OPEN' ? 'Open' : tx.txStatus) :
                                                        tx.status === 'pending' ? 'Processing...' :
                                                            tx.status === 'success' ? 'Confirmed' :
                                                                (tx.revertReason === 'reverted' ? 'Reverted' : 'Failed')}
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
                                                            {tx.validTo > 0 && (
                                                                <span>
                                                                    Expires {new Intl.DateTimeFormat('en-US', {
                                                                        month: 'short',
                                                                        day: 'numeric',
                                                                        hour: 'numeric',
                                                                        minute: 'numeric',
                                                                    }).format(new Date(tx.validTo * 1000))}
                                                                </span>
                                                            )}
                                                        </div>
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

export default AaveHistorySheet;
