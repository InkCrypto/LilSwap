import { CheckCircle2, History, ExternalLink, RefreshCw, Trash2, X, AlertTriangle, Loader2, MoveRight } from 'lucide-react';
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { getNetworkByChainId } from '../constants/networks';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { useWeb3 } from '../contexts/web3-context';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';

const LastSyncIndicator: React.FC<{ lastSyncTime: number }> = ({ lastSyncTime }) => {
    const [, setTick] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setTick(t => t + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [lastSyncTime]); // Reset interval if lastSyncTime changes

    const now = Date.now();
    const diff = now - lastSyncTime;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 10) {
        return <span>just now</span>;
    }

    if (seconds < 60) {
        return <span>{seconds}s ago</span>;
    }

    const minutes = Math.floor(seconds / 60);
    return <span>{minutes}m ago</span>;
};

export const TransactionHistorySheet: React.FC = () => {
    const {
        transactions,
        isSheetOpen,
        setSheetOpen,
        apiHistory,
        isLoadingHistory,
        hasMore,
        loadHistory,
        isSyncingHistory,
        lastSyncTime
    } = useTransactionTracker();

    const { account: address } = useWeb3();
    const observerTarget = useRef<HTMLDivElement>(null);
    const hasInitialLoaded = useRef(false);
    const prevAccountRef = useRef(address);
    const [showAbsolute, setShowAbsolute] = useState(false);
    const [touchStart, setTouchStart] = React.useState({ x: 0, y: 0 });


    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStart({
            x: e.targetTouches[0].clientX,
            y: e.targetTouches[0].clientY
        });
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const deltaX = e.changedTouches[0].clientX - touchStart.x;
        const deltaY = e.changedTouches[0].clientY - touchStart.y;

        // Requirement: Horizontal swipe to the right > 80px and predominantly horizontal
        if (deltaX > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            setSheetOpen(false);
        }
    };

    // Initial load - Run only once when sheet opens or address changes
    useEffect(() => {
        if (isSheetOpen && address && (!hasInitialLoaded.current || prevAccountRef.current !== address)) {
            hasInitialLoaded.current = true;
            prevAccountRef.current = address;
            loadHistory(address, false);
        }
    }, [isSheetOpen, address, loadHistory]);

    // Reset initial load state when sheet closes
    useEffect(() => {
        if (!isSheetOpen) {
            hasInitialLoaded.current = false;
        }
    }, [isSheetOpen]);

    // Infinite scroll observer
    useEffect(() => {
        const target = observerTarget.current;
        if (!target) return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !isLoadingHistory && address) {
                    loadHistory(address, true);
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(target);
        return () => observer.unobserve(target);
    }, [hasMore, isLoadingHistory, loadHistory, address]);

    // Merge and deduplicate
    const combinedHistory = useMemo(() => {
        const localHashes = new Set(transactions.map(t => t.hash?.toLowerCase()).filter(Boolean));

        const mappedApiHistory = apiHistory.map(tx => {
            let mappedStatus: 'pending' | 'success' | 'error' = 'pending';
            if (tx.tx_status === 'CONFIRMED') mappedStatus = 'success';
            else if (['FAILED', 'REJECTED', 'EXPIRED', 'HASH_MISSING'].includes(tx.tx_status)) mappedStatus = 'error';

            const isDebt = tx.swap_type === 'debt';
            const desc = isDebt ? 'Debt Swap' : 'Collateral Swap';

            return {
                hash: tx.tx_hash || `backend-id-${tx.id}`,
                chainId: Number(tx.chain_id || 1),
                description: desc,
                status: mappedStatus,
                timestamp: new Date(tx.created_at).getTime(),
                fromTokenSymbol: tx.from_token_symbol,
                toTokenSymbol: tx.to_token_symbol,
                isApi: true,
                revertReason: tx.revert_reason,
                txStatus: tx.tx_status,
            };
        });

        const filteredApiHistory = mappedApiHistory.filter(tx => {
            if (!tx.hash.startsWith('backend-id-')) {
                return !localHashes.has(tx.hash.toLowerCase());
            }
            return true;
        });

        // Ensure sorted by timestamp descending
        return [...transactions, ...filteredApiHistory].sort((a, b) => b.timestamp - a.timestamp);
    }, [transactions, apiHistory]);

    const formatTimestamp = (timestamp: number) => {
        if (showAbsolute) {
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
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
                    </div>
                    {lastSyncTime && (
                        <div className="flex justify-end mt-1 -mr-1">
                            <button
                                onClick={() => address && loadHistory(address, false, true)}
                                disabled={isSyncingHistory || isLoadingHistory}
                                className="flex items-center gap-2 group text-slate-400 hover:text-primary transition-colors focus:outline-hidden disabled:opacity-50"
                                title="Refresh history"
                            >
                                <span className="text-xs text-slate-500 whitespace-nowrap select-none">
                                    Updated <LastSyncIndicator lastSyncTime={lastSyncTime} />
                                </span>
                                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingHistory || (isLoadingHistory && !transactions.length) ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    )}
                </SheetHeader>

                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-800/60 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {combinedHistory.length === 0 && !isLoadingHistory ? (
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
                            {combinedHistory.map((tx) => {
                                const network = getNetworkByChainId(tx.chainId);
                                const isMockHash = tx.hash.startsWith('backend-id-');
                                const explorerUrl = !isMockHash && network ? `${network.explorer}/tx/${tx.hash}` : '#';

                                return (
                                    <div
                                        key={tx.hash}
                                        className="p-4 px-6 transition-all hover:bg-slate-50 dark:hover:bg-slate-900/40 group animate-in fade-in slide-in-from-top-4 duration-500 fill-mode-both"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="shrink-0 mt-1">
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

                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center gap-3">
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        <p className="font-semibold text-sm text-slate-900 dark:text-white truncate shrink-0">
                                                            {tx.description}
                                                        </p>

                                                        {/* Token Flow with Icons - Single Line version */}
                                                        {(tx.fromTokenSymbol || tx.toTokenSymbol) && (
                                                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                                                <div className="flex items-center gap-1">
                                                                    <div className="w-4 h-4 rounded-full overflow-hidden shrink-0">
                                                                        <img
                                                                            src={getTokenLogo(tx.fromTokenSymbol || '')}
                                                                            alt={tx.fromTokenSymbol}
                                                                            className="w-full h-full object-cover"
                                                                            onError={(e) => onTokenImgError(tx.fromTokenSymbol || '')(e as any)}
                                                                        />
                                                                    </div>
                                                                    <span className="text-[11px] font-semibold text-slate-900 dark:text-white uppercase">{tx.fromTokenSymbol}</span>
                                                                </div>

                                                                <MoveRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 opacity-60" strokeWidth={2.5} />

                                                                <div className="flex items-center gap-1">
                                                                    <div className="w-4 h-4 rounded-full overflow-hidden shrink-0">
                                                                        <img
                                                                            src={getTokenLogo(tx.toTokenSymbol || '')}
                                                                            alt={tx.toTokenSymbol}
                                                                            className="w-full h-full object-cover"
                                                                            onError={(e) => onTokenImgError(tx.toTokenSymbol || '')(e as any)}
                                                                        />
                                                                    </div>
                                                                    <span className="text-[11px] font-semibold text-slate-900 dark:text-white uppercase">{tx.toTokenSymbol}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={() => setShowAbsolute(!showAbsolute)}
                                                        className="text-[10px] text-slate-400 hover:text-primary transition-colors whitespace-nowrap shrink-0 focus:outline-hidden"
                                                        title={showAbsolute ? "Show relative time" : "Show full date"}
                                                    >
                                                        {formatTimestamp(tx.timestamp)}
                                                    </button>
                                                </div>

                                                <div className="flex items-center gap-3 mt-2">
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${tx.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                                                        tx.status === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                                            'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                                                        }`}>
                                                        {tx.status === 'pending' ? 'Processing...' :
                                                            tx.status === 'success' ? 'Confirmed' :
                                                                tx.revertReason === 'hash_missing' || tx.revertReason === 'hash_sync_failed' || tx.txStatus === 'HASH_MISSING' ? 'Hash Missing' :
                                                                (tx.revertReason === 'reverted' ? 'Reverted' :
                                                                    tx.revertReason === 'ghost_timeout' ? 'Timed Out (Not Found)' :
                                                                        tx.revertReason === 'drop_timeout' ? 'Dropped' : 'Failed')}
                                                    </span>

                                                    {tx.status === 'error' && tx.revertReason && (
                                                        <span className="text-[10px] text-red-400 capitalize bg-red-900/10 px-1.5 py-0.5 rounded border border-red-900/20">
                                                            {tx.revertReason.replace('_', ' ')}
                                                        </span>
                                                    )}

                                                    {network && !isMockHash && (
                                                        <a
                                                            href={explorerUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="text-xs flex items-center gap-1 text-slate-500 hover:text-primary transition-colors ml-auto"
                                                        >
                                                            <span>{network.shortLabel} Explorer</span>
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Infinite Scroll Target */}
                            {hasMore && (
                                <div ref={observerTarget} className="py-4 flex justify-center">
                                    {isLoadingHistory && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
};
