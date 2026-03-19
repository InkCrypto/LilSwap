import React, { useState, useContext, useMemo, lazy, Suspense, useEffect } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Network, ExternalLink, Gift, Wallet } from 'lucide-react';
import { useAllPositions, ChainInfo, PositionInfo } from '../hooks/use-all-positions';
import { toHexChainId } from '../utils/wallet';
import { getNetworkByChainId } from '../constants/networks';
import { useWeb3 } from '@/contexts/web3-context';
import logger from '../utils/logger';
import { InfoTooltip } from './info-tooltip';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { DonateModal } from './donate-modal';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

// Lazy load Swap Modals - Note: We'll migrate these next
const DebtSwapModal = lazy(() => import('./debt-swap-modal').then(module => ({ default: module.DebtSwapModal })));
const CollateralSwapModal = lazy(() => import('./collateral-swap-modal').then(module => ({ default: module.CollateralSwapModal })));

// Formatting helpers
const formatUSD = (value: number) => {
    if (value === 0) return '$0.00';
    if (value < 0.01) return '< $0.01';
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCompactUSD = (value: number) => {
    if (value === 0) return '$0';
    if (value < 1000) return formatUSD(value);

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

const formatTokenAmount = (amount: number, symbol: string) => {
    if (amount === 0) return `0 ${symbol}`;
    if (amount < 0.0000001) return `< 0.0000001 ${symbol}`;

    if (amount < 0.1) {
        return `${Number(amount.toFixed(7)).toString()} ${symbol}`;
    }

    return `${Number(amount.toFixed(4)).toString()} ${symbol}`;
};

interface ModalState {
    open: boolean;
    chainId: number | null;
    initialFromToken: PositionInfo | null;
    marketAssets: any[];
    borrows: PositionInfo[];
    supplies: PositionInfo[];
    isCollateral: boolean;
}

interface PositionsAccordionProps {
    walletAddress: string;
}

/**
 * PositionsAccordion Component
 * Displays user positions across multiple networks in an accordion layout
 */
export const PositionsAccordion: React.FC<PositionsAccordionProps> = ({ walletAddress }) => {
    const { positionsByChain, donator, loading, error, lastFetch, refresh } = useAllPositions(walletAddress);
    const { provider, setSelectedNetwork } = useWeb3();

    const [openChain, setOpenChain] = useState<number | null>(null);
    const [openEmptyChains, setOpenEmptyChains] = useState(false);
    const [modalState, setModalState] = useState<ModalState>({
        open: false,
        chainId: null,
        initialFromToken: null,
        marketAssets: [],
        borrows: [],
        supplies: [],
        isCollateral: false
    });
    const [isDonateOpen, setIsDonateOpen] = useState(false);

    // Preload swap modal chunks so the first open feels instant.
    useEffect(() => {
        void import('./debt-swap-modal');
        void import('./collateral-swap-modal');
    }, []);

    const handleOpenSwap = (
        chainId: number,
        asset: PositionInfo,
        marketAssets: any[],
        borrows: PositionInfo[] = [],
        supplies: PositionInfo[] = [],
        isCollateral = false
    ) => {
        logger.debug('Opening swap modal', { chainId, asset: asset.symbol, isCollateral });

        setModalState({
            open: true,
            chainId,
            initialFromToken: asset,
            marketAssets: marketAssets || [],
            borrows: borrows || [],
            supplies: supplies || [],
            isCollateral
        });

        const network = getNetworkByChainId(chainId);
        if (network) setSelectedNetwork?.(network.key);

        void (async () => {
            try {
                if (provider) {
                    const currentChainId = (await provider.getNetwork()).chainId;
                    if (Number(currentChainId) !== chainId) {
                        const chainHex = toHexChainId(chainId);
                        logger.debug('Requesting chain switch', { chainId, chainHex });
                        await provider.send('wallet_switchEthereumChain', [{ chainId: chainHex }]);
                    }
                }
            } catch (err: any) {
                logger.error('Failed to switch chain', { chainId, error: err.message });

                const errorMessage = err?.message || String(err);
                const errorCode = err?.code;

                // Ethers may emit NETWORK_ERROR during the in-flight chainChanged event.
                // If we already reached the requested chain, suppress the false error.
                if (provider && errorCode === 'NETWORK_ERROR' && /network changed/i.test(errorMessage)) {
                    try {
                        const updatedChainId = (await provider.getNetwork()).chainId;
                        if (Number(updatedChainId) === chainId) {
                            logger.debug('Network switched successfully after transient NETWORK_ERROR', { chainId });
                            return;
                        }
                    } catch {
                        // Ignore follow-up network read errors and keep silent.
                    }
                }

                // Keep network switch feedback delegated to wallet UI.
                logger.debug('Chain switch did not complete during modal open', { chainId, errorCode, errorMessage });
            }
        })();
    };

    const handleCloseModal = () => {
        setModalState(prev => ({ ...prev, open: false }));
    };

    const getLastFetchText = () => {
        if (!lastFetch) return null;
        const now = Date.now();
        const diff = now - lastFetch;
        const seconds = Math.floor(diff / 1000);
        if (seconds < 10) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ago`;
    };

    const chainEntries = useMemo(() => {
        if (!positionsByChain) return [];

        const entries = Object.entries(positionsByChain).map(([chainId, info]) => {
            const chainIdNum = parseInt(chainId);
            const network = getNetworkByChainId(chainIdNum);

            const suppliesCount = info?.supplies?.length || 0;
            const borrowsCount = info?.borrows?.length || 0;
            const hasPositions = info?.hasPositions || (suppliesCount + borrowsCount > 0);
            const hasError = !!info?.error;

            const totalBorrowed = info?.borrows?.reduce((sum, b) => sum + parseFloat(b.formattedAmount || '0'), 0) || 0;
            const totalSupplied = info?.supplies?.reduce((sum, s) => sum + parseFloat(s.formattedAmount || '0'), 0) || 0;
            const totalPositions = suppliesCount + borrowsCount;

            const healthFactor = info?.summary?.healthFactor ? parseFloat(info.summary.healthFactor) : null;
            const netWorthUSD = info?.summary?.netWorthUSD ? parseFloat(info.summary.netWorthUSD) : 0;
            const netAPY = info?.summary?.netAPY ? parseFloat(info.summary.netAPY) : 0;

            const sortedSupplies = (info?.supplies || []).slice().sort((a, b) => {
                const valA = parseFloat(a.formattedAmount || '0') * parseFloat(a.priceInUSD || '0');
                const valB = parseFloat(b.formattedAmount || '0') * parseFloat(b.priceInUSD || '0');
                return valB - valA;
            });

            const sortedBorrows = (info?.borrows || []).slice().sort((a, b) => {
                const valA = parseFloat(a.formattedAmount || '0') * parseFloat(a.priceInUSD || '0');
                const valB = parseFloat(b.formattedAmount || '0') * parseFloat(b.priceInUSD || '0');
                return valB - valA;
            });

            return {
                chainId: chainIdNum,
                label: network?.shortLabel || network?.label || `Chain ${chainId}`,
                icon: network?.icon,
                suppliesCount,
                borrowsCount,
                hasPositions,
                hasError,
                totalBorrowed,
                totalSupplied,
                totalPositions,
                healthFactor,
                netWorthUSD,
                netAPY,
                supplies: sortedSupplies,
                borrows: sortedBorrows,
                marketAssets: info?.marketAssets || [],
                error: info?.error
            };
        });

        return entries.sort((a, b) => {
            if (a.hasPositions !== b.hasPositions) return a.hasPositions ? -1 : 1;
            return b.netWorthUSD - a.netWorthUSD;
        });
    }, [positionsByChain]);

    if (loading && !positionsByChain) {
        return (
            <Card className="w-full bg-white dark:bg-card-dark rounded-2xl border border-border-light dark:border-border-dark p-6 text-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">Loading positions across networks...</p>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="w-full bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-700 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-600 dark:text-red-400">Error: {error}</p>
                <Button variant="destructive" onClick={() => refresh(true)} className="mt-3">
                    Retry
                </Button>
            </Card>
        );
    }

    if (!positionsByChain) return null;

    const activeChains = chainEntries.filter(c => c.hasPositions);
    const emptyChains = chainEntries.filter(c => !c.hasPositions);

    return (
        <div className="w-full space-y-3 animate-in fade-in duration-500">
            <div className="flex flex-col w-full gap-1">
                {donator.isDonator && (
                    <div className="flex sm:hidden justify-center w-full -mt-1.5 mb-2">
                        <InfoTooltip message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-linear-to-r from-primary/20 to-fuchsia-500/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(168,85,247,0.2)] cursor-help hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                </span>
                                {donator.type?.toLowerCase().includes('partner') ? 'PARTNER Detected!' : 'DONATOR Detected!'}
                            </span>
                        </InfoTooltip>
                    </div>
                )}

                {!donator.isDonator && (
                    <div className="flex sm:hidden justify-center w-full -mt-1.5 mb-2">
                        <button
                            onClick={() => setIsDonateOpen(true)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-linear-to-r from-primary/20 via-purple-500/20 to-fuchsia-500/20 text-primary border border-primary/40 shadow-[0_0_10px_rgba(168,85,247,0.1)] hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] hover:scale-105 active:scale-95 transition-all group"
                        >
                            <Gift className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                            <span className="relative">
                                Get 10% Fee Discount
                                <span className="absolute -top-1 -right-2 flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                </span>
                            </span>
                        </button>
                    </div>
                )}

                <div className="flex justify-between items-center w-full">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Network className="w-5 h-5 text-primary shrink-0" />
                            <span>Multi-Chain Positions</span>
                        </h2>

                        {donator.isDonator && (
                            <div className="hidden sm:flex">
                                <InfoTooltip message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}>
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-linear-to-r from-primary/20 to-fuchsia-500/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(168,85,247,0.2)] cursor-help hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                        </span>
                                        {donator.type?.toLowerCase().includes('partner') ? 'PARTNER Detected!' : 'DONATOR Detected!'}
                                    </span>
                                </InfoTooltip>
                            </div>
                        )}

                        {!donator.isDonator && (
                            <div className="hidden sm:flex items-center">
                                <button
                                    onClick={() => setIsDonateOpen(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-linear-to-r from-primary/20 via-purple-500/20 to-fuchsia-500/20 text-primary border border-primary/40 shadow-[0_0_10px_rgba(168,85,247,0.1)] hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] hover:scale-105 active:scale-95 transition-all group"
                                >
                                    <Gift className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                                    <span className="relative">
                                        Get 10% Fee Discount
                                        <span className="absolute -top-1 -right-2 flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                        </span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                        {lastFetch && (
                            <span className="text-xs text-slate-500 whitespace-nowrap">
                                Updated {getLastFetchText()}
                            </span>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => refresh(true)} disabled={loading} className="h-8 w-8 text-slate-400 hover:text-white">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </div>

            {activeChains.map((chain) => (
                <Card key={chain.chainId} className="bg-white dark:bg-slate-800/60 border-border-light dark:border-border-dark overflow-hidden transition-all hover:border-slate-300 dark:hover:border-slate-600">
                    <div className="flex flex-col sm:flex-row p-4 w-full sm:items-center cursor-pointer" onClick={() => setOpenChain(openChain === chain.chainId ? null : chain.chainId)}>
                        <div className="flex justify-between items-center w-full sm:w-40 shrink-0">
                            <div className="flex items-center gap-2">
                                {chain.icon && (
                                    <img src={chain.icon} alt={chain.label} className="w-5 h-5 rounded-full" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                )}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-base font-bold text-slate-900 dark:text-white leading-none">{chain.label}</span>
                                    <a
                                        href={`https://app.aave.com/dashboard/?marketName=${({ 1: 'proto_mainnet_v3', 8453: 'proto_base_v3', 56: 'proto_bnb_v3', 137: 'proto_polygon_v3', 42161: 'proto_arbitrum_v3' } as any)[chain.chainId] || 'proto_mainnet_v3'}`}
                                        target="_blank" rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-slate-400 hover:text-primary transition-colors"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                                {chain.hasError && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                            </div>
                            <div className="flex sm:hidden">
                                {openChain === chain.chainId ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                            </div>
                        </div>

                        <div className="mt-4 sm:mt-0 flex-1 flex justify-start items-center">
                            <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-6 w-full">
                                <div className="flex flex-col items-start">
                                    <span className="text-[11px] sm:text-xs text-slate-400 mb-0.5">Net worth</span>
                                    <span className="text-base font-mono font-bold text-slate-900 dark:text-white leading-none mt-1">
                                        {formatCompactUSD(chain.netWorthUSD)}
                                    </span>
                                </div>
                                <div className="flex flex-col items-start">
                                    <span className="text-[11px] sm:text-xs text-slate-400 mb-0.5">Net APY</span>
                                    <span className="text-base font-mono font-bold text-slate-900 dark:text-white leading-none mt-1">
                                        {chain.netAPY.toFixed(2)}%
                                    </span>
                                </div>
                                <div className="flex flex-col items-start">
                                    <span className="text-[11px] sm:text-xs text-slate-400 mb-0.5">Health factor</span>
                                    <span className={`text-lg font-mono font-bold leading-none mt-1 ${(!chain.healthFactor || chain.healthFactor >= 3 || chain.healthFactor === -1) ? 'text-green-400' : chain.healthFactor >= 1.1 ? 'text-orange-400' : 'text-red-500'}`}>
                                        {(!chain.healthFactor || chain.healthFactor === -1) ? '∞' : chain.healthFactor.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="hidden sm:flex pl-4">
                            {openChain === chain.chainId ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                        </div>
                    </div>

                    {openChain === chain.chainId && (
                        <div className="border-t border-border-light dark:border-border-dark px-4 pt-4 pb-0 bg-slate-50 dark:bg-slate-900/15 flex flex-col md:flex-row gap-6">
                            <div className="w-full">
                                <div className="md:hidden space-y-4">
                                    <div>
                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Supplies</h4>
                                        <div className="-mx-4 border-x border-t border-slate-200 dark:border-slate-700/80 divide-y divide-slate-200 dark:divide-slate-700/80">
                                            {chain.supplies.map((supply) => (
                                                <div key={`mobile-supply-${supply.underlyingAsset}`} className="px-4 py-2.5 bg-white dark:bg-slate-800/60">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                <img src={getTokenLogo(supply.symbol)} alt={supply.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(supply.symbol)(e as any)} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(supply.formattedAmount) * parseFloat(supply.priceInUSD || '0'))}</div>
                                                                <div className="text-[10px] text-slate-500 font-medium truncate">{formatTokenAmount(parseFloat(supply.formattedAmount), supply.symbol)}</div>
                                                            </div>
                                                        </div>
                                                        <Button size="sm" onClick={() => handleOpenSwap(chain.chainId, supply, chain.marketAssets, [], chain.supplies, true)} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0">
                                                            <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {chain.borrows.length > 0 && (
                                        <div>
                                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Borrows</h4>
                                            <div className="-mx-4 border-x border-t border-slate-200 dark:border-slate-700/80 divide-y divide-slate-200 dark:divide-slate-700/80">
                                                {chain.borrows.map((borrow) => (
                                                    <div key={`mobile-borrow-${borrow.underlyingAsset}`} className="px-4 py-2.5 bg-white dark:bg-slate-800/60">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                    <img src={getTokenLogo(borrow.symbol)} alt={borrow.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(borrow.symbol)(e as any)} />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(borrow.formattedAmount) * parseFloat(borrow.priceInUSD || '0'))}</div>
                                                                    <div className="text-[10px] text-slate-500 font-medium truncate">{formatTokenAmount(parseFloat(borrow.formattedAmount), borrow.symbol)}</div>
                                                                </div>
                                                            </div>
                                                            <Button size="sm" onClick={() => handleOpenSwap(chain.chainId, borrow, chain.marketAssets, chain.borrows, [], false)} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0">
                                                                <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="hidden md:block">
                                    <div className="grid grid-cols-2 gap-6 mb-3 px-1">
                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supplies</h4>
                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Borrows</h4>
                                    </div>
                                    <div className="-mx-4 border-x border-slate-200 dark:border-slate-700/80">
                                        {Array.from({ length: Math.max(chain.supplies.length, chain.borrows.length, 1) }).map((_, index) => {
                                            const supply = chain.supplies[index] || null;
                                            const borrow = chain.borrows[index] || null;
                                            const isNoBorrowRow = chain.borrows.length === 0 && index === 0;
                                            const isFirstRow = index === 0;
                                            const isLastRow = index === Math.max(chain.supplies.length, chain.borrows.length, 1) - 1;

                                            return (
                                                <div key={`${chain.chainId}-position-row-${index}`} className={`grid grid-cols-[1fr_auto_1fr] items-stretch ${isFirstRow ? 'border-t border-slate-200 dark:border-slate-700/80' : ''}`}>
                                                    <div className={`px-4 py-2.5 transition-colors duration-300 ${supply ? 'bg-white dark:bg-slate-800/60' : ''} ${supply && !isLastRow ? 'border-b border-slate-200 dark:border-slate-700/80' : ''}`}>
                                                        {supply ? (
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                        <img src={getTokenLogo(supply.symbol)} alt={supply.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(supply.symbol)(e as any)} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(supply.formattedAmount) * parseFloat(supply.priceInUSD || '0'))}</div>
                                                                        <div className="text-[10px] text-slate-500 font-medium truncate">{formatTokenAmount(parseFloat(supply.formattedAmount), supply.symbol)}</div>
                                                                    </div>
                                                                </div>
                                                                <Button size="sm" onClick={() => handleOpenSwap(chain.chainId, supply, chain.marketAssets, [], chain.supplies, true)} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0">
                                                                    <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <div className="h-9" />
                                                        )}
                                                    </div>

                                                    <div className={`w-px self-stretch ${(supply || borrow) ? 'bg-slate-200/60 dark:bg-slate-600/40' : 'bg-transparent'}`} />

                                                    <div className={`px-4 py-2.5 transition-colors duration-300 ${borrow ? 'bg-white dark:bg-slate-800/60' : ''} ${borrow && !isLastRow ? 'border-b border-slate-200 dark:border-slate-700/80' : ''}`}>
                                                        {borrow ? (
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                        <img src={getTokenLogo(borrow.symbol)} alt={borrow.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(borrow.symbol)(e as any)} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(borrow.formattedAmount) * parseFloat(borrow.priceInUSD || '0'))}</div>
                                                                        <div className="text-[10px] text-slate-500 font-medium truncate">{formatTokenAmount(parseFloat(borrow.formattedAmount), borrow.symbol)}</div>
                                                                    </div>
                                                                </div>
                                                                <Button size="sm" onClick={() => handleOpenSwap(chain.chainId, borrow, chain.marketAssets, chain.borrows, [], false)} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0">
                                                                    <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                </Button>
                                                            </div>
                                                        ) : isNoBorrowRow ? (
                                                            <div className="flex items-center justify-center h-full min-h-[44px] text-sm text-slate-400 italic opacity-80 px-1 w-full">
                                                                No borrow positions
                                                            </div>
                                                        ) : (
                                                            <div className="h-9" />
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </Card>
            ))}

            {emptyChains.length > 0 && (
                <Card className="bg-white dark:bg-slate-800/30 border-border-light dark:border-border-dark/50 overflow-hidden">
                    <div className="flex p-4 w-full items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/30" onClick={() => setOpenEmptyChains(!openEmptyChains)}>
                        <div className="flex justify-between items-center w-full">
                            <div className="flex items-center gap-3">
                                <div className="flex -space-x-2">
                                    {emptyChains.slice(0, 5).map((chain) => (
                                        chain.icon && <img key={chain.chainId} src={chain.icon} alt={chain.label} className="w-6 h-6 rounded-full border-2 border-white dark:border-card-dark opacity-50 grayscale" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                    ))}
                                    {emptyChains.length > 5 && (
                                        <div className="w-6 h-6 rounded-full border-2 border-white dark:border-card-dark bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-500">+{emptyChains.length - 5}</div>
                                    )}
                                </div>
                                <span className="text-sm italic text-slate-400 ml-1">No positions</span>
                            </div>
                            {openEmptyChains ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                    </div>

                    {openEmptyChains && (
                        <div className="border-t border-border-light dark:border-border-dark p-4 flex flex-wrap gap-4">
                            {emptyChains.map((chain) => (
                                <div key={chain.chainId} className="flex items-center gap-1.5 opacity-60">
                                    {chain.icon && <img src={chain.icon} alt={chain.label} className="w-4 h-4 rounded-full" />}
                                    <span className="text-xs font-medium text-slate-500">{chain.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            <Suspense fallback={null}>
                {modalState.open && (
                    modalState.isCollateral ? (
                        <CollateralSwapModal
                            isOpen={modalState.open}
                            onClose={handleCloseModal}
                            initialFromToken={modalState.initialFromToken}
                            chainId={modalState.chainId!}
                            marketAssets={modalState.marketAssets}
                            providedSupplies={modalState.supplies}
                            donator={donator}
                        />
                    ) : (
                        <DebtSwapModal
                            isOpen={modalState.open}
                            onClose={handleCloseModal}
                            initialFromToken={modalState.initialFromToken}
                            chainId={modalState.chainId!}
                            marketAssets={modalState.marketAssets}
                            providedBorrows={modalState.borrows}
                            donator={donator}
                        />
                    )
                )}
            </Suspense>

            <DonateModal isOpen={isDonateOpen} onClose={() => setIsDonateOpen(false)} />
        </div>
    );
};

export default PositionsAccordion;
