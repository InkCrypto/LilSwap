import { AlertCircle, ArrowDownRight, ArrowUpRight, CircleDashed, ArrowLeftRight, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react';
import React, { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useWeb3 } from '@/contexts/web3-context';
import { getMarketByKey } from '../constants/networks';
import type { DonatorInfo, ChainInfo, PositionInfo } from '../hooks/use-all-positions';
import { formatUSD, formatCompactToken, formatAPY, formatHF } from '../utils/formatters';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import logger from '../utils/logger';
import { InfoTooltip } from './info-tooltip';
import { PortfolioOverviewCard } from './portfolio-overview-card';
import type { PortfolioOverview } from './portfolio-overview-card';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Switch } from './ui/switch';

// Lazy load Swap Modals - Note: We'll migrate these next
const DebtSwapModal = lazy(() => import('./debt-swap-modal').then(module => ({ default: module.DebtSwapModal })));
const CollateralSwapModal = lazy(() => import('./collateral-swap-modal').then(module => ({ default: module.CollateralSwapModal })));
const CollateralToggleModal = lazy(() => import('./collateral-toggle-modal').then(module => ({ default: module.CollateralToggleModal })));

// Formatting helpers removed in favor of centralized ones in ../utils/formatters.ts

interface ModalState {
    open: boolean;
    chainId: number | null;
    initialFromToken: PositionInfo | null;
    marketAssets: any[];
    borrows: PositionInfo[];
    supplies: PositionInfo[];
    marketKey: string | null;
    isCollateral: boolean;
}

interface ToggleModalState {
    open: boolean;
    asset: PositionInfo | null;
    marketKey: string | null;
    summary: any;
    supplies?: PositionInfo[];
    marketAssets?: any[];
}

interface PositionsAccordionProps {
    walletAddress: string;
    positionsByChain: Record<string, ChainInfo> | null;
    donator: DonatorInfo;
    loading: boolean;
    error: string | null;
    lastFetch: number | null;
    refresh: (force?: boolean) => Promise<void>;
}

const parseAmount = (value: string | number | null | undefined): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(value || '');

    return Number.isFinite(parsed) ? parsed : 0;
};

const getEmptyChainIconClass = (marketKey: string, variant: 'summary' | 'list' = 'summary') => {
    const baseSize = variant === 'summary' ? 'w-5 h-5' : 'w-4 h-4';
    const gnosisAdjustment = marketKey === 'AaveV3Gnosis' ? 'scale-110' : '';

    return `${baseSize} object-contain shrink-0 saturate-75 brightness-90 opacity-90 ${gnosisAdjustment}`.trim();
};

/**
 * PositionsAccordion Component
 * Displays user positions across multiple networks in an accordion layout
 */
export const PositionsAccordion: React.FC<PositionsAccordionProps> = ({
    walletAddress,
    positionsByChain,
    donator,
    loading,
    error,
    lastFetch,
    refresh,
}) => {
    const { setSelectedNetwork } = useWeb3();

    const [openMarket, setOpenMarket] = useState<string | null>(null);
    const [openEmptyChains, setOpenEmptyChains] = useState(false);
    const [modalState, setModalState] = useState<ModalState>({
        open: false,
        chainId: null,
        marketKey: null,
        initialFromToken: null,
        marketAssets: [],
        borrows: [],
        supplies: [],
        isCollateral: false
    });
    const [toggleModal, setToggleModal] = useState<ToggleModalState>({
        open: false,
        asset: null,
        marketKey: null,
        summary: null
    });
    const [timeTick, setTimeTick] = useState(() => Date.now());

    useEffect(() => {
        void import('./debt-swap-modal');
        void import('./collateral-swap-modal');
        void import('./collateral-toggle-modal');
    }, []);

    useEffect(() => {
        if (!lastFetch) {
            return;
        }

        const interval = window.setInterval(() => {
            setTimeTick(Date.now());
        }, 1000);

        return () => window.clearInterval(interval);
    }, [lastFetch]);

    // Reset accordion state when walletAddress changes
    useEffect(() => {
        setOpenMarket(null);
        setOpenEmptyChains(false);
        setModalState(prev => ({ ...prev, open: false }));
    }, [walletAddress]);

    const handleOpenSwap = (
        marketKey: string,
        asset: PositionInfo,
        marketAssets: any[],
        borrows: PositionInfo[] = [],
        supplies: PositionInfo[] = [],
        isCollateral = false
    ) => {
        const market = getMarketByKey(marketKey);
        const chainIdNum = market?.chainId || 0;

        logger.debug('Opening swap modal', { chainId: chainIdNum, asset: asset.symbol, isCollateral });

        setModalState({
            open: true,
            chainId: chainIdNum,
            marketKey,
            initialFromToken: asset,
            marketAssets: marketAssets || [],
            borrows: borrows || [],
            supplies: supplies || [],
            isCollateral
        });

        if (market) {
            void setSelectedNetwork(market.key).catch((err: any) => {
                logger.debug('Chain switch did not complete during modal open', {
                    chainId: chainIdNum,
                    errorCode: err?.code,
                    errorMessage: err?.message || String(err),
                });
            });
        }
    };

    const handleCloseModal = () => {
        setModalState(prev => ({ ...prev, open: false }));
    };

    const handleOpenToggleCollateral = (marketKey: string, asset: PositionInfo, summary: any, supplies?: PositionInfo[], marketAssets?: any[]) => {
        setToggleModal({
            open: true,
            asset,
            marketKey,
            summary,
            supplies,
            marketAssets
        });

        const market = getMarketByKey(marketKey);
        if (market) {
            void setSelectedNetwork(market.key).catch((err: any) => {
                logger.debug('Chain switch did not complete during collateral toggle open', {
                    marketKey,
                    errorCode: err?.code,
                    errorMessage: err?.message || String(err),
                });
            });
        }
    };

    const handleCloseToggleModal = () => {
        setToggleModal(prev => ({ ...prev, open: false }));
    };

    const getLastFetchText = () => {
        if (!lastFetch) {
            return null;
        }

        const now = timeTick;
        const diff = now - lastFetch;
        const seconds = Math.floor(diff / 1000);

        if (seconds < 10) {
            return 'just now';
        }

        if (seconds < 60) {
            return `${seconds}s ago`;
        }

        const minutes = Math.floor(seconds / 60);

        return `${minutes}m ago`;
    };

    const chainEntries = useMemo(() => {
        if (!positionsByChain) {
            return [];
        }

        const entries = Object.entries(positionsByChain).map(([marketKey, info]) => {
            const network = getMarketByKey(marketKey);
            const chainIdNum = network?.chainId || (isNaN(parseInt(marketKey)) ? 0 : parseInt(marketKey));

            const suppliesCount = info?.supplies?.length || 0;
            const borrowsCount = info?.borrows?.length || 0;
            const hasPositions = info?.hasPositions || (suppliesCount + borrowsCount > 0);
            const hasError = !!info?.error;
            const totalSuppliedUSDFromAssets = info?.supplies?.reduce(
                (sum, supply) => sum + (parseAmount(supply.formattedAmount) * parseAmount(supply.priceInUSD)),
                0,
            ) || 0;
            const totalBorrowedUSDFromAssets = info?.borrows?.reduce(
                (sum, borrow) => sum + (parseAmount(borrow.formattedAmount) * parseAmount(borrow.priceInUSD)),
                0,
            ) || 0;
            const totalPositions = suppliesCount + borrowsCount;
            const totalSuppliedUSDFromSummary = parseAmount(info?.summary?.totalCollateralUSD);
            const totalBorrowedUSDFromSummary = parseAmount(info?.summary?.totalBorrowsUSD);
            const totalSuppliedUSD = totalSuppliedUSDFromSummary > 0 || totalSuppliedUSDFromAssets === 0
                ? totalSuppliedUSDFromSummary
                : totalSuppliedUSDFromAssets;
            const totalBorrowedUSD = totalBorrowedUSDFromSummary > 0 || totalBorrowedUSDFromAssets === 0
                ? totalBorrowedUSDFromSummary
                : totalBorrowedUSDFromAssets;
            const healthFactorValue = info?.summary?.healthFactor != null
                ? parseFloat(info.summary.healthFactor)
                : null;
            const healthFactor = healthFactorValue != null && Number.isFinite(healthFactorValue)
                ? healthFactorValue
                : null;
            const netWorthUSD = info?.summary?.netWorthUSD ? parseAmount(info.summary.netWorthUSD) : 0;
            const netAPY = info?.summary?.netAPY ? parseAmount(info.summary.netAPY) : 0;
            const currentLiquidationThreshold = info?.summary?.currentLiquidationThreshold != null
                ? parseAmount(info.summary.currentLiquidationThreshold)
                : null;

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
                marketKey,
                chainId: chainIdNum,
                label: network?.shortLabel || network?.label || `Chain ${chainIdNum}`,
                icon: network?.icon,
                suppliesCount,
                borrowsCount,
                hasPositions,
                hasError,
                totalBorrowedUSD,
                totalSuppliedUSD,
                totalPositions,
                healthFactor,
                netWorthUSD,
                netAPY,
                currentLiquidationThreshold,
                supplies: sortedSupplies,
                borrows: sortedBorrows,
                marketAssets: info?.marketAssets || [],
                eModeCategoryId: info?.summary?.eModeCategoryId,
                eModes: info?.summary?.eModes,
                error: info?.error
            };
        });

        return entries.sort((a, b) => {
            if (a.hasPositions !== b.hasPositions) {
                return a.hasPositions ? -1 : 1;
            }

            return b.netWorthUSD - a.netWorthUSD;
        });
    }, [positionsByChain]);

    const activeChains = chainEntries.filter(c => c.hasPositions);
    const emptyChains = chainEntries.filter(c => !c.hasPositions);

    const portfolioOverview = useMemo<PortfolioOverview | null>(() => {
        if (activeChains.length < 2) {
            return null;
        }

        const totalNetWorthUSD = activeChains.reduce((sum, chain) => sum + chain.netWorthUSD, 0);
        const totalSuppliedUSD = activeChains.reduce((sum, chain) => sum + chain.totalSuppliedUSD, 0);
        const totalBorrowedUSD = activeChains.reduce((sum, chain) => sum + chain.totalBorrowedUSD, 0);

        if (totalBorrowedUSD <= 0.01) {
            return {
                totalNetWorthUSD,
                totalSuppliedUSD,
                totalBorrowedUSD,
                activeMarkets: activeChains.length,
                approxHealthFactor: null,
                approxHealthFactorStatus: 'no-debt',
                borrowPowerUsedPct: 0,
                borrowPowerUsedStatus: 'no-debt',
            };
        }

        const hasIncompleteThresholdData = activeChains.some(
            (chain) => (chain.totalSuppliedUSD > 0 || chain.totalBorrowedUSD > 0) && chain.currentLiquidationThreshold == null,
        );

        if (hasIncompleteThresholdData) {
            return {
                totalNetWorthUSD,
                totalSuppliedUSD,
                totalBorrowedUSD,
                activeMarkets: activeChains.length,
                approxHealthFactor: null,
                approxHealthFactorStatus: 'unavailable',
                borrowPowerUsedPct: null,
                borrowPowerUsedStatus: 'unavailable',
            };
        }

        const collateralPower = activeChains.reduce(
            (sum, chain) => sum + (chain.totalSuppliedUSD * (chain.currentLiquidationThreshold || 0)),
            0,
        );

        return {
            totalNetWorthUSD,
            totalSuppliedUSD,
            totalBorrowedUSD,
            activeMarkets: activeChains.length,
            approxHealthFactor: collateralPower / totalBorrowedUSD,
            approxHealthFactorStatus: 'value',
            borrowPowerUsedPct: collateralPower > 0 ? (totalBorrowedUSD / collateralPower) * 100 : null,
            borrowPowerUsedStatus: collateralPower > 0 ? 'value' : 'unavailable',
        };
    }, [activeChains]);

    if (loading && !positionsByChain) {
        return (
            <div className="flex min-h-36 w-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-3 h-9 w-9 rounded-full border-[3px] border-primary/20 border-t-primary animate-spin" />
                <p className="text-slate-500 dark:text-slate-400">Loading positions across networks...</p>
            </div>
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

    if (!positionsByChain) {
        return null;
    }

    const statusActions = (
        <div className="flex items-end gap-3 shrink-0">
            {lastFetch && (
                <span className="hidden sm:inline text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400 whitespace-nowrap">
                    Updated {getLastFetchText()}
                </span>
            )}
            <button
                onClick={() => refresh(true)}
                disabled={loading}
                className="flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-all group rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <RefreshCw className={`w-5 h-5 translate-y-1 ${loading ? 'animate-spin' : ''}`} />
            </button>
        </div>
    );

    const hasOverview = !!portfolioOverview;

    const positionsHeader = (
        <div className="flex justify-between items-end w-full px-2">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80 sm:text-xs">
                Aave Positions
            </div>
            {!hasOverview && statusActions}
        </div>
    );

    return (
        <div className="w-full space-y-3 animate-in fade-in duration-500">
            {hasOverview && (
                <>
                    <div className="flex justify-between items-end w-full px-2">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80 sm:text-xs">
                            Portfolio Overview
                        </div>
                        {statusActions}
                    </div>

                    <PortfolioOverviewCard overview={portfolioOverview} />

                    {positionsHeader}
                </>
            )}

            {!hasOverview && positionsHeader}

            {activeChains.map((chain) => (
                <Card key={chain.marketKey} className="bg-white dark:bg-slate-800/60 border-border-light dark:border-border-dark overflow-hidden transition-all hover:border-slate-300 dark:hover:border-slate-600">
                    <div className="flex w-full cursor-pointer flex-col px-2 py-2.5 sm:flex-row sm:items-center sm:p-4" onClick={() => setOpenMarket(openMarket === chain.marketKey ? null : chain.marketKey)}>
                        <div className="flex justify-between items-center pb-1 w-full sm:w-40 shrink-0 sm:pr-3">
                            <div className="flex items-center gap-2">
                                {chain.icon && (
                                    <img src={chain.icon} alt={chain.label} className="w-5 h-5 rounded-full" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                )}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-base font-bold text-slate-900 dark:text-white leading-none">{chain.label}</span>
                                    <a
                                        href={`https://app.aave.com/dashboard/?marketName=${({
                                            'AaveV3Ethereum': 'proto_mainnet_v3',
                                            'AaveV3EthereumLido': 'proto_lido_v3',
                                            'AaveV3Base': 'proto_base_v3',
                                            'AaveV3BNB': 'proto_bnb_v3',
                                            'AaveV3Polygon': 'proto_polygon_v3',
                                            'AaveV3Arbitrum': 'proto_arbitrum_v3',
                                            'AaveV3Optimism': 'proto_optimism_v3',
                                            'AaveV3Avalanche': 'proto_avalanche_v3',
                                            'AaveV3Gnosis': 'proto_gnosis_v3',
                                            'AaveV3Sonic': 'proto_sonic_v3'
                                        } as any)[chain.marketKey] || 'proto_mainnet_v3'}`}
                                        target="_blank" rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-slate-400 hover:text-primary transition-colors"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                                {chain.hasError && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                            </div>
                            <div className="flex items-center sm:hidden">
                                {openMarket === chain.marketKey ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                            </div>
                        </div>

                        <div className="mt-1.5 sm:mt-0 flex-1 px-0 sm:px-0 sm:border-l sm:border-slate-200/80 sm:pl-3 dark:sm:border-slate-700/80">
                            <div className="flex items-start justify-between gap-2 sm:hidden">
                                <div className="flex min-w-0 flex-col items-start">
                                    <span className="mb-1 whitespace-nowrap text-[9px] leading-[1.05] font-bold uppercase tracking-[0.12em] text-slate-400">Net worth</span>
                                    <span className="whitespace-nowrap text-sm font-mono font-bold text-slate-900 dark:text-white leading-none">
                                        {formatUSD(chain.netWorthUSD)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/20 pl-2 dark:border-slate-700/40">
                                    <span className="mb-1 whitespace-nowrap text-[9px] leading-[1.05] font-bold uppercase tracking-[0.12em] text-slate-400">HF</span>
                                    <span className={`whitespace-nowrap text-sm font-mono font-bold leading-none ${(!chain.healthFactor || chain.healthFactor >= 3 || chain.healthFactor === -1) ? 'text-green-400' : chain.healthFactor >= 1.1 ? 'text-orange-400' : 'text-red-500'}`}>
                                        {formatHF(chain.healthFactor)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/20 pl-2 dark:border-slate-700/40">
                                    <span className="mb-1 whitespace-nowrap text-[9px] leading-[1.05] font-bold uppercase tracking-[0.12em] text-slate-400">Supplied</span>
                                    <span className="whitespace-nowrap text-sm font-mono font-bold leading-none text-emerald-500 dark:text-emerald-400">
                                        {formatUSD(chain.totalSuppliedUSD)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/20 pl-2 dark:border-slate-700/40">
                                    <span className="mb-1 whitespace-nowrap text-[9px] leading-[1.05] font-bold uppercase tracking-[0.12em] text-slate-400">Borrowed</span>
                                    <span className="whitespace-nowrap text-sm font-mono font-bold leading-none text-primary">
                                        {formatUSD(chain.totalBorrowedUSD)}
                                    </span>
                                </div>
                            </div>

                            <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-5">
                                <div className="flex min-w-0 flex-col items-start">
                                    <span className="mb-1 whitespace-nowrap text-[9px] sm:text-[10px] leading-[1.05] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-slate-400">Net worth</span>
                                    <span className="whitespace-nowrap text-[13px] sm:text-base font-mono font-bold text-slate-900 dark:text-white leading-none">
                                        {formatUSD(chain.netWorthUSD)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/80 pl-5 dark:border-slate-700/80">
                                    <span className="mb-1 whitespace-nowrap text-[9px] sm:text-[10px] leading-[1.05] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-slate-400">
                                        HF
                                    </span>
                                    <div className="flex items-center gap-1.5 sm:gap-3">
                                        <span className={`whitespace-nowrap text-[13px] sm:text-lg font-mono font-bold leading-none ${(!chain.healthFactor || chain.healthFactor >= 3 || chain.healthFactor === -1) ? 'text-green-400' : chain.healthFactor >= 1.1 ? 'text-orange-400' : 'text-red-500'}`}>
                                            {formatHF(chain.healthFactor)}
                                        </span>
                                        {!!chain.eModeCategoryId && chain.eModeCategoryId !== 0 && (
                                            <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/5 dark:bg-sky-400/5 border border-sky-500/20 dark:border-sky-400/20 shrink-0">
                                                <div className="w-1 h-1 rounded-full bg-sky-500/60 dark:bg-sky-400/60 shadow-[0_0_5px_rgba(14,165,233,0.3)] animate-pulse" />
                                                <span className="text-[10px] font-bold text-sky-600/80 dark:text-sky-400/80 uppercase tracking-wide leading-none">
                                                    E-Mode
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/80 pl-5 dark:border-slate-700/80">
                                    <span className="mb-1 whitespace-nowrap text-[9px] sm:text-[10px] leading-[1.05] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-slate-400">Net APY</span>
                                    <span className="whitespace-nowrap text-[13px] sm:text-base font-mono font-bold text-slate-900 dark:text-white leading-none">
                                        {formatAPY(chain.netAPY)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/80 pl-5 dark:border-slate-700/80">
                                    <span className="mb-1 whitespace-nowrap text-[9px] sm:text-[10px] leading-[1.05] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-slate-400">Supplied</span>
                                    <span className="whitespace-nowrap text-[13px] sm:text-base font-mono font-bold leading-none text-emerald-500 dark:text-emerald-400">
                                        {formatUSD(chain.totalSuppliedUSD)}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-col items-start border-l border-slate-200/80 pl-5 dark:border-slate-700/80">
                                    <span className="mb-1 whitespace-nowrap text-[9px] sm:text-[10px] leading-[1.05] font-bold uppercase tracking-[0.12em] sm:tracking-[0.16em] text-slate-400">Borrowed</span>
                                    <span className="whitespace-nowrap text-[13px] sm:text-base font-mono font-bold leading-none text-primary">
                                        {formatUSD(chain.totalBorrowedUSD)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="hidden sm:flex pl-4">
                            {openMarket === chain.marketKey ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                        </div>
                    </div>

                    {openMarket === chain.marketKey && (
                        <div className="border-t border-border-light dark:border-border-dark bg-slate-50/80 px-0 pt-3 pb-0 dark:bg-slate-950/40 flex flex-col gap-6 transition-colors duration-300 md:flex-row md:px-4">
                            <div className="w-full">
                                <div className="md:hidden space-y-4">
                                    <div>
                                        <div className="mb-2 flex items-center gap-2 px-3">
                                            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                                            <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none">Supplies</h4>
                                        </div>
                                        <div className="border-t border-slate-200 divide-y divide-slate-200 dark:border-slate-700/80 dark:divide-slate-700/80 md:-mx-4 md:border-x">
                                            {chain.supplies.map((supply) => (
                                                <div key={`mobile-supply-${supply.underlyingAsset}`} className="bg-white px-3 py-2.5 transition-colors duration-200 hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                <img src={getTokenLogo(supply.symbol)} alt={supply.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(supply.symbol)(e as any)} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(supply.formattedAmount) * parseFloat(supply.priceInUSD || '0'))}</div>
                                                                <div className="text-[10px] text-slate-500 font-medium truncate">{formatCompactToken(supply.formattedAmount, supply.symbol)}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-4 shrink-0 px-2">
                                                            {/* Shadcn Switch */}
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="text-[7px] font-black uppercase tracking-widest text-slate-500/80">Collateral</span>
                                                                <Switch
                                                                    checked={supply.usageAsCollateralEnabledOnUser}
                                                                    onCheckedChange={() => handleOpenToggleCollateral(chain.marketKey, supply, {
                                                                        healthFactor: chain.healthFactor?.toString(),
                                                                        totalCollateralUSD: chain.totalSuppliedUSD.toString(),
                                                                        totalBorrowsUSD: chain.totalBorrowedUSD.toString(),
                                                                        currentLiquidationThreshold: chain.currentLiquidationThreshold?.toString()
                                                                    }, chain.supplies, chain.marketAssets)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </div>
                                                            <Button size="sm" onClick={(e) => { e.stopPropagation(); handleOpenSwap(chain.marketKey, supply, chain.marketAssets, [], chain.supplies, true); }} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0 h-8 px-3 text-xs">
                                                                <ArrowLeftRight className="w-3 h-3" /> Swap
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {chain.borrows.length > 0 && (
                                        <div>
                                            <div className="mb-2 flex items-center gap-2 px-3">
                                                <ArrowDownRight className="w-3 h-3 text-primary" />
                                                <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none">Borrows</h4>
                                                {!!chain.eModeCategoryId && chain.eModeCategoryId !== 0 && (
                                                    <div className="flex items-center gap-1 px-1.5 py-0 rounded bg-sky-100 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800">
                                                        <div className="w-1 h-1 rounded-full bg-sky-500 animate-pulse" />
                                                        <span className="text-[9px] font-black text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                                                            E-Mode: {chain.eModes?.find((m: any) => m.id === chain.eModeCategoryId)?.label || 'Active'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border-t border-slate-200 divide-y divide-slate-200 dark:border-slate-700/80 dark:divide-slate-700/80 md:-mx-4 md:border-x">
                                                {chain.borrows.map((borrow) => {
                                                    const borrowAddr = borrow.underlyingAsset.toLowerCase();
                                                    const hasAlternatives = (chain.marketAssets || []).some(
                                                        (a: any) => a.canBeDebtSwapDestination &&
                                                            (a.address || a.underlyingAsset || '').toLowerCase() !== borrowAddr
                                                    );

                                                    return (
                                                        <div key={`mobile-borrow-${borrow.underlyingAsset}`} className="bg-white px-3 py-2.5 transition-colors duration-200 hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                        <img src={getTokenLogo(borrow.symbol)} alt={borrow.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(borrow.symbol)(e as any)} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(borrow.formattedAmount) * parseFloat(borrow.priceInUSD || '0'))}</div>
                                                                        <div className="text-[10px] text-slate-500 font-medium truncate">{formatCompactToken(borrow.formattedAmount, borrow.symbol)}</div>
                                                                    </div>
                                                                </div>
                                                                {hasAlternatives ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="default"
                                                                        onClick={() => handleOpenSwap(chain.marketKey, borrow, chain.marketAssets, chain.borrows, [], false)}
                                                                        className="gap-2 rounded-lg shrink-0 transition-all duration-200 bg-primary hover:bg-primary/90 text-white shadow-sm"
                                                                    >
                                                                        <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                    </Button>
                                                                ) : (
                                                                    <InfoTooltip message="No alternative tokens available in your E-Mode category" disableClick={true}>
                                                                        <div className="cursor-not-allowed flex">
                                                                            <Button
                                                                                size="sm"
                                                                                variant="secondary"
                                                                                tabIndex={-1}
                                                                                className="gap-2 rounded-lg shrink-0 transition-all duration-200 cursor-not-allowed bg-slate-100/80 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 shadow-none pointer-events-none"
                                                                            >
                                                                                <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                            </Button>
                                                                        </div>
                                                                    </InfoTooltip>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="hidden md:block">
                                    <div className="grid grid-cols-2 gap-6 mb-2">
                                        <div className="flex items-center gap-2 px-1">
                                            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                                            <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Supplies</h4>
                                        </div>
                                        <div className="flex items-center gap-2 px-1">
                                            <ArrowDownRight className="w-3 h-3 text-primary" />
                                            <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Borrows</h4>
                                            {!!chain.eModeCategoryId && chain.eModeCategoryId !== 0 && (
                                                <div className="flex items-center gap-1 px-1.5 py-0 rounded bg-sky-100 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800">
                                                    <div className="w-1 h-1 rounded-full bg-sky-500 animate-pulse" />
                                                    <span className="text-[9px] font-black text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                                                        E-Mode: {chain.eModes?.find((m: any) => m.id === chain.eModeCategoryId)?.label || 'Active'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {(() => {
                                        const maxLen = Math.max(chain.supplies.length, chain.borrows.length, 1);

                                        return (
                                            <div className="grid grid-cols-[1fr_auto_1fr] -mx-4 border-x border-t border-b border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#131d2f] transition-colors duration-200">
                                                {/* Supplies Column */}
                                                <div className="flex flex-col">
                                                    {chain.supplies.map((supply, index) => {
                                                        const isAtBottom = index === maxLen - 1;

                                                        return (
                                                            <div key={`${chain.marketKey}-supply-${index}`} className={`px-4 py-2.5 transition-colors duration-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${!isAtBottom ? 'border-b border-slate-200 dark:border-slate-700/80' : ''}`}>
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="flex items-center gap-3 min-w-0">
                                                                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                            <img src={getTokenLogo(supply.symbol)} alt={supply.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(supply.symbol)(e as any)} />
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(supply.formattedAmount) * parseFloat(supply.priceInUSD || '0'))}</div>
                                                                            <div className="text-[10px] text-slate-500 font-medium truncate">{formatCompactToken(parseFloat(supply.formattedAmount), supply.symbol)}</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-5 shrink-0">
                                                                        {/* Shadcn Switch */}
                                                                        <div className="flex flex-col items-center gap-1">
                                                                            <span className="text-[7px] font-black uppercase tracking-widest text-slate-500/80">Collateral</span>
                                                                            <Switch
                                                                                checked={supply.usageAsCollateralEnabledOnUser}
                                                                                onCheckedChange={() => handleOpenToggleCollateral(chain.marketKey, supply, {
                                                                                    healthFactor: chain.healthFactor?.toString(),
                                                                                    totalCollateralUSD: chain.totalSuppliedUSD.toString(),
                                                                                    totalBorrowsUSD: chain.totalBorrowedUSD.toString(),
                                                                                    currentLiquidationThreshold: chain.currentLiquidationThreshold?.toString()
                                                                                }, chain.supplies, chain.marketAssets)}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            />
                                                                        </div>
                                                                        <Button size="sm" onClick={(e) => { e.stopPropagation(); handleOpenSwap(chain.marketKey, supply, chain.marketAssets, [], chain.supplies, true); }} className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-lg shrink-0 h-8 px-3 text-xs">
                                                                            <ArrowLeftRight className="w-3 h-3" /> Swap
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    {/* Fill space if borrows column is taller */}
                                                    {chain.supplies.length < chain.borrows.length && (
                                                        <div className="flex-1" />
                                                    )}
                                                </div>

                                                {/* Row Divider */}
                                                <div className="w-px self-stretch bg-slate-200/60 dark:bg-slate-600/40" />

                                                {/* Borrows Column */}
                                                <div className="flex flex-col">
                                                    {chain.borrows.length > 0 ? (
                                                        chain.borrows.map((borrow, index) => {
                                                            const isAtBottom = index === maxLen - 1;
                                                            const borrowAddr = borrow.underlyingAsset.toLowerCase();
                                                            const hasAlternatives = (chain.marketAssets || []).some(
                                                                (a: any) => a.canBeDebtSwapDestination &&
                                                                    (a.address || a.underlyingAsset || '').toLowerCase() !== borrowAddr
                                                            );

                                                            return (
                                                                <div key={`${chain.marketKey}-borrow-${index}`} className={`px-4 py-2.5 transition-colors duration-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${!isAtBottom ? 'border-b border-slate-200 dark:border-slate-700/80' : ''}`}>
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-3 min-w-0">
                                                                            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600/30">
                                                                                <img src={getTokenLogo(borrow.symbol)} alt={borrow.symbol} className="w-full h-full object-cover" onError={(e) => onTokenImgError(borrow.symbol)(e as any)} />
                                                                            </div>
                                                                            <div className="min-w-0">
                                                                                <div className="font-mono text-base font-bold text-slate-900 dark:text-white truncate">{formatUSD(parseFloat(borrow.formattedAmount) * parseFloat(borrow.priceInUSD || '0'))}</div>
                                                                                <div className="text-[10px] text-slate-500 font-medium truncate">{formatCompactToken(parseFloat(borrow.formattedAmount), borrow.symbol)}</div>
                                                                            </div>
                                                                        </div>
                                                                        {hasAlternatives ? (
                                                                            <Button
                                                                                size="sm"
                                                                                variant="default"
                                                                                onClick={() => handleOpenSwap(chain.marketKey, borrow, chain.marketAssets, chain.borrows, [], false)}
                                                                                className="gap-2 rounded-lg shrink-0 transition-all duration-200 bg-primary hover:bg-primary/90 text-white shadow-sm"
                                                                            >
                                                                                <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                            </Button>
                                                                        ) : (
                                                                            <InfoTooltip message="No alternative tokens available in your E-Mode category" disableClick={true}>
                                                                                <div className="cursor-not-allowed flex">
                                                                                    <Button
                                                                                        size="sm"
                                                                                        variant="secondary"
                                                                                        tabIndex={-1}
                                                                                        className="gap-2 rounded-lg shrink-0 transition-all duration-200 cursor-not-allowed bg-slate-100/80 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 shadow-none pointer-events-none"
                                                                                    >
                                                                                        <ArrowLeftRight className="w-3.5 h-3.5" /> Swap
                                                                                    </Button>
                                                                                </div>
                                                                            </InfoTooltip>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        chain.supplies.length <= 2 ? (
                                                            <div className="flex items-center gap-3 px-6 h-full min-h-13.5 opacity-60">
                                                                <CircleDashed className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                                                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-tight">No active borrows</div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex-1 flex flex-col items-center pt-10 text-center px-6">
                                                                <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center mb-4">
                                                                    <CircleDashed className="w-5 h-5 text-slate-300 dark:text-slate-500" />
                                                                </div>
                                                                <div className="text-sm font-bold text-slate-900 dark:text-white mb-1.5 leading-none">No active borrows</div>
                                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-45 leading-tight">Assets you borrow on this network will appear here.</div>
                                                            </div>
                                                        )
                                                    )}
                                                    {/* Fill space if supplies column is taller */}
                                                    {chain.borrows.length > 0 && chain.borrows.length < chain.supplies.length && (
                                                        <div className="flex-1" />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
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
                                        chain.icon && (
                                            <img
                                                key={chain.marketKey}
                                                src={chain.icon}
                                                alt={chain.label}
                                                className={getEmptyChainIconClass(chain.marketKey, 'summary')}
                                                onError={(e) => (e.currentTarget.style.display = 'none')}
                                            />
                                        )
                                    ))}
                                    {emptyChains.length > 5 && (
                                        <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-500 dark:text-slate-300">+{emptyChains.length - 5}</div>
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
                                <div key={chain.marketKey} className="flex items-center gap-2">
                                    {chain.icon && (
                                        <img
                                            src={chain.icon}
                                            alt={chain.label}
                                            className={getEmptyChainIconClass(chain.marketKey, 'list')}
                                        />
                                    )}
                                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{chain.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            <Suspense fallback={null}>
                {modalState.open && (() => {
                    const currentChain = positionsByChain && modalState.marketKey ? positionsByChain[modalState.marketKey] : null;

                    return modalState.isCollateral ? (
                        <CollateralSwapModal
                            isOpen={modalState.open}
                            onClose={handleCloseModal}
                            initialFromToken={modalState.initialFromToken}
                            marketKey={modalState.marketKey}
                            chainId={modalState.chainId!}
                            marketAssets={currentChain?.marketAssets || modalState.marketAssets}
                            providedSupplies={currentChain?.supplies || modalState.supplies}
                            donator={donator}
                            onOpenToggleCollateral={(asset, summary, supplies, marketAssets) => {
                                handleCloseModal();
                                handleOpenToggleCollateral(modalState.marketKey!, asset, summary, supplies, marketAssets);
                            }}
                        />
                    ) : (
                        <DebtSwapModal
                            isOpen={modalState.open}
                            onClose={handleCloseModal}
                            initialFromToken={modalState.initialFromToken}
                            marketKey={modalState.marketKey}
                            chainId={modalState.chainId!}
                            marketAssets={currentChain?.marketAssets || modalState.marketAssets}
                            providedBorrows={currentChain?.borrows || modalState.borrows}
                            providedSupplies={currentChain?.supplies || modalState.supplies}
                            donator={donator}
                            onOpenToggleCollateral={(asset, summary, supplies, marketAssets) => {
                                handleCloseModal();
                                handleOpenToggleCollateral(modalState.marketKey!, asset, summary, supplies, marketAssets);
                            }}
                        />
                    );
                })()}

                {toggleModal.open && toggleModal.asset && (
                    <CollateralToggleModal
                        isOpen={toggleModal.open}
                        onClose={handleCloseToggleModal}
                        asset={toggleModal.asset}
                        account={walletAddress}
                        selectedNetwork={getMarketByKey(toggleModal.marketKey || '')}
                        summary={toggleModal.summary}
                        supplies={toggleModal.supplies}
                        marketAssets={toggleModal.marketAssets}
                        onSuccess={() => refresh(true)}
                        onSwitchAsset={(newAsset) => {
                            handleOpenToggleCollateral(toggleModal.marketKey!, newAsset, toggleModal.summary, toggleModal.supplies, toggleModal.marketAssets);
                        }}
                    />
                )}
            </Suspense>

        </div>
    );
};

export default PositionsAccordion;
