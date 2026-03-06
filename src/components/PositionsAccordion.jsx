import React, { useState, useMemo, lazy, Suspense } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Network, ExternalLink } from 'lucide-react';
import { useAllPositions } from '../hooks/useAllPositions';
import { requestChainSwitch } from '../utils/wallet';
import { getNetworkByChainId } from '../constants/networks';
import logger from '../utils/logger';
import { InfoTooltip } from './InfoTooltip';
import { getTokenLogo, onTokenImgError } from '../utils/getTokenLogo';


// Lazy load Swap Modals
const DebtSwapModal = lazy(() => import('./DebtSwapModal.jsx').then(module => ({ default: module.DebtSwapModal })));
const CollateralSwapModal = lazy(() => import('./CollateralSwapModal.jsx').then(module => ({ default: module.CollateralSwapModal })));


// Formatting helpers
const formatUSD = (value) => {
    if (value === 0) return '$0.00';
    if (value < 0.01) return '< $0.01';
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatCompactUSD = (value) => {
    if (value === 0) return '$0';
    if (value < 1000) return formatUSD(value);

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

const formatTokenAmount = (amount, symbol) => {
    if (amount === 0) return `0 ${symbol}`;
    if (amount < 0.0000001) return `< 0.0000001 ${symbol}`;

    // For smaller values, show up to 7 decimals, otherwise 4 decimals or less based on float limits
    if (amount < 0.1) {
        return `${Number(amount.toFixed(7)).toString()} ${symbol}`;
    }

    return `${Number(amount.toFixed(4)).toString()} ${symbol}`;
};

/**
 * PositionsAccordion Component
 * Displays user positions across multiple networks in an accordion layout
 * @param {string} walletAddress - User wallet address
 */
export const PositionsAccordion = ({ walletAddress }) => {
    const { positionsByChain, donator, loading, error, lastFetch, refresh } = useAllPositions(walletAddress);
    const [openChain, setOpenChain] = useState(null);
    const [openEmptyChains, setOpenEmptyChains] = useState(false);
    const [modalState, setModalState] = useState({
        open: false,
        chainId: null,
        initialFromToken: null,
        marketAssets: [],
        borrows: [],
        supplies: [],
        isCollateral: false
    });

    // Handle opening swap modal and switching chain
    const handleOpenSwap = async (chainId, asset, marketAssets, borrows = [], supplies = [], isCollateral = false) => {
        logger.debug('Opening swap modal', { chainId, asset: asset.symbol, isCollateral });

        try {
            // Request wallet to switch to the correct chain
            await requestChainSwitch(chainId);

            logger.info('Chain switched successfully', { chainId });

            // Open modal with asset, chainId and marketAssets
            setModalState({
                open: true,
                chainId,
                initialFromToken: asset,
                marketAssets: marketAssets || [],
                borrows: borrows || [],
                supplies: supplies || [],
                isCollateral
            });
        } catch (err) {
            logger.error('Failed to switch chain', { chainId, error: err.message });

            // Show user-friendly error
            const network = getNetworkByChainId(chainId);
            const networkName = network?.shortLabel || network?.label || `Chain ${chainId}`;
            alert(
                `Please switch your wallet to ${networkName} and try again.\n\n` +
                `Error: ${err.message || err}`
            );
        }
    };

    const handleCloseModal = () => {
        setModalState({
            open: false,
            chainId: null,
            initialFromToken: null,
            marketAssets: [],
            borrows: [],
            supplies: [],
            isCollateral: false
        });
    };

    // Format last fetch time
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

    // Process positions data
    const chainEntries = useMemo(() => {
        if (!positionsByChain) return [];

        const entries = Object.entries(positionsByChain).map(([chainId, info]) => {
            const chainIdNum = parseInt(chainId);
            const network = getNetworkByChainId(chainIdNum);

            const suppliesCount = info?.supplies?.length || 0;
            const borrowsCount = info?.borrows?.length || 0;
            const hasPositions = info?.hasPositions || (suppliesCount + borrowsCount > 0);
            const hasError = !!info?.error;

            // Calculate totals (simplified, could be enhanced with USD values)
            const totalBorrowed = info?.borrows?.reduce((sum, b) => {
                return sum + parseFloat(b.formattedAmount || 0);
            }, 0) || 0;

            const totalSupplied = info?.supplies?.reduce((sum, s) => {
                return sum + parseFloat(s.formattedAmount || 0);
            }, 0) || 0;

            const totalPositions = suppliesCount + borrowsCount;

            // Extract health factor and net metrics if available
            const healthFactor = info?.summary?.healthFactor ? parseFloat(info.summary.healthFactor) : null;
            const netWorthUSD = info?.summary?.netWorthUSD ? parseFloat(info.summary.netWorthUSD) : 0;
            const netAPY = info?.summary?.netAPY ? parseFloat(info.summary.netAPY) : 0;

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
                supplies: (info?.supplies || []).slice().sort((a, b) => {
                    const valA = parseFloat(a.formattedAmount || 0) * parseFloat(a.priceInUSD || 0);
                    const valB = parseFloat(b.formattedAmount || 0) * parseFloat(b.priceInUSD || 0);
                    return valB - valA;
                }),
                borrows: (info?.borrows || []).slice().sort((a, b) => {
                    const valA = parseFloat(a.formattedAmount || 0) * parseFloat(a.priceInUSD || 0);
                    const valB = parseFloat(b.formattedAmount || 0) * parseFloat(b.priceInUSD || 0);
                    return valB - valA;
                }),
                marketAssets: info?.marketAssets || [],
                error: info?.error
            };
        });

        // Sort: networks with positions first, then by net worth (descending)
        return entries.sort((a, b) => {
            // First, compare hasPositions (true comes before false)
            if (a.hasPositions !== b.hasPositions) {
                return a.hasPositions ? -1 : 1;
            }

            // If both have positions (or both don't), sort by net worth
            return b.netWorthUSD - a.netWorthUSD;
        });
    }, [positionsByChain]);

    // Show loading state
    if (loading && !positionsByChain) {
        return (
            <div className="w-full bg-white dark:bg-card-dark rounded-2xl border border-border-light dark:border-border-dark p-6 text-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">Loading positions across networks...</p>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div className="w-full bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-700 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-600 dark:text-red-400">Error: {error}</p>
                <button
                    onClick={() => refresh(true)}
                    className="mt-3 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    // Show empty state
    if (!positionsByChain) {
        return null;
    }

    const activeChains = chainEntries.filter(c => c.hasPositions);
    const emptyChains = chainEntries.filter(c => !c.hasPositions);

    return (
        <div className="w-full space-y-4">
            {/* Header with refresh button */}
            <div className="flex flex-col w-full gap-1">
                {/* Mobile Badge Container */}
                {donator.isDonator && (
                    <div className="flex sm:hidden justify-center w-full -mt-1.5 mb-2 sm:mt-0 sm:mb-0">
                        <InfoTooltip
                            content={
                                <div className="flex flex-col gap-1">
                                    <span>You are enjoying a {donator.discountPercent}% discount on any fee in the app.</span>
                                    {donator.type === 'Donator' && (
                                        <span className="font-bold text-primary">Thank you for supporting LilSwap! 💜</span>
                                    )}
                                </div>
                            }
                        >
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-linear-to-r from-primary/20 to-fuchsia-500/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(168,85,247,0.2)] cursor-help hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                                </span>
                                {donator.type === 'Donator' ? 'DONATOR Detected!' : 'PARTNER Detected!'}
                            </span>
                        </InfoTooltip>
                    </div>
                )}

                {/* Main Row */}
                <div className="flex justify-between items-center w-full">
                    <div className="flex items-center gap-2">
                        <h2 className="text-[17px] sm:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-1.5 sm:gap-2">
                            <Network className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-primary shrink-0" />
                            <span className="whitespace-nowrap">Multi-Chain Positions</span>
                        </h2>

                        {/* Desktop Badge Container */}
                        {donator.isDonator && (
                            <div className="hidden sm:flex items-center">
                                <InfoTooltip
                                    content={
                                        <div className="flex flex-col gap-1">
                                            <span>You are enjoying a {donator.discountPercent}% discount on any fee in the app.</span>
                                            {donator.type === 'Donator' && (
                                                <span className="font-bold text-primary">Thank you for supporting LilSwap! 💜</span>
                                            )}
                                        </div>
                                    }
                                >
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-linear-to-r from-primary/20 to-fuchsia-500/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(168,85,247,0.2)] cursor-help hover:shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                        </span>
                                        {donator.type === 'Donator' ? 'DONATOR Detected!' : 'PARTNER Detected!'}
                                    </span>
                                </InfoTooltip>
                            </div>
                        )}
                    </div>

                    {/* Right Side: Updated + Refresh */}
                    <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                        {lastFetch && (
                            <span className="text-[10px] sm:text-xs text-slate-500 text-right whitespace-nowrap">
                                Updated {getLastFetchText()}
                            </span>
                        )}
                        <button
                            onClick={() => refresh(true)}
                            disabled={loading}
                            className="p-1 sm:p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            title="Refresh positions"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Active Network accordions */}
            {activeChains.map((chain) => (
                <div
                    key={chain.chainId}
                    className="bg-white dark:bg-card-dark rounded-2xl border border-border-light dark:border-border-dark overflow-hidden transition-all hover:border-slate-300 dark:hover:border-slate-600"
                >
                    {/* Accordion header */}
                    <div
                        className="flex flex-col sm:flex-row p-4 w-full sm:items-center cursor-pointer"
                        onClick={() => {
                            setOpenChain(openChain === chain.chainId ? null : chain.chainId);
                        }}
                    >
                        {/* Mobile Top Row / Desktop Logo Column */}
                        <div className="flex justify-between items-center w-full sm:w-36 shrink-0">
                            {/* Logo & Name */}
                            <div className="flex items-center gap-2">
                                {chain.icon && (
                                    <img
                                        src={chain.icon}
                                        alt={chain.label}
                                        className="w-5 h-5 rounded-full"
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                )}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-base font-bold text-slate-900 dark:text-white leading-none">{chain.label}</span>
                                    <a
                                        href={`https://app.aave.com/dashboard/?marketName=${({
                                            1: 'proto_mainnet_v3',
                                            8453: 'proto_base_v3',
                                            56: 'proto_bnb_v3',
                                            137: 'proto_polygon_v3',
                                            42161: 'proto_arbitrum_v3'
                                        })[chain.chainId] || 'proto_mainnet_v3'}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-slate-400 hover:text-primary transition-colors flex items-center"
                                        title={`View positions on Aave (${chain.label})`}
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                                {chain.hasError && (
                                    <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" title={chain.error} />
                                )}
                            </div>

                            {/* Mobile-Only Chevron */}
                            <div className="flex items-center sm:hidden">
                                <div className="text-slate-400 transition-transform duration-200 flex items-center">
                                    {openChain === chain.chainId ? (
                                        <ChevronUp className="w-5 h-5" />
                                    ) : (
                                        <ChevronDown className="w-5 h-5" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Metrics Grid (Wraps below on mobile, inline on desktop) */}
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
                                    <span className={`text-base font-mono font-bold leading-none mt-1 ${chain.healthFactor === -1 || chain.healthFactor >= 3 ? 'text-green-400' :
                                        chain.healthFactor >= 1.1 ? 'text-orange-400' :
                                            'text-red-500'
                                        }`}>
                                        {chain.healthFactor === -1 ? '∞' : chain.healthFactor.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Desktop-Only Chevron */}
                        <div className="hidden sm:flex items-center justify-end pl-4">
                            <div className="text-slate-400 transition-transform duration-200 flex items-center">
                                {openChain === chain.chainId ? (
                                    <ChevronUp className="w-5 h-5" />
                                ) : (
                                    <ChevronDown className="w-5 h-5" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Accordion content */}
                    {openChain === chain.chainId && (
                        <div className="border-t border-border-light dark:border-border-dark p-4 bg-slate-50 dark:bg-slate-900/30 flex flex-col md:flex-row gap-4">
                            {/* Always show both columns for a balanced layout */}
                            <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                                    Supplies
                                </h4>
                                <div className="space-y-2">
                                    {chain.supplies.map((supply) => (
                                        <div
                                            key={supply.underlyingAsset}
                                            className="flex items-center justify-between p-3 bg-white dark:bg-slate-800/50 rounded-lg border border-border-light dark:border-slate-700/50"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-border-light dark:border-slate-600/30">
                                                    <img
                                                        src={getTokenLogo(supply.symbol)}
                                                        alt={supply.symbol}
                                                        className="w-full h-full object-cover"
                                                        onError={onTokenImgError(supply.symbol)}
                                                    />
                                                    <span className="text-xs font-bold text-slate-500 uppercase" style={{ display: 'none' }}>
                                                        {supply.symbol?.[0] || '?'}
                                                    </span>
                                                </div>
                                                <div>
                                                    <div className="font-mono text-base font-bold text-slate-900 dark:text-white">
                                                        {formatUSD(parseFloat(supply.formattedAmount) * parseFloat(supply.priceInUSD || 0))}
                                                    </div>
                                                    <div className="text-xs text-slate-500 font-medium whitespace-pre">
                                                        {formatTokenAmount(parseFloat(supply.formattedAmount), supply.symbol)}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenSwap(chain.chainId, supply, chain.marketAssets, [], chain.supplies, true);
                                                }}
                                                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white flex items-center gap-2 transition-colors shrink-0"
                                            >
                                                <ArrowRightLeft className="w-4 h-4" />
                                                <span className="text-base font-semibold inline">Swap</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                                    Borrows
                                </h4>
                                <div className="space-y-2">
                                    {chain.borrows.length > 0 ? (
                                        chain.borrows.map((borrow) => (
                                            <div
                                                key={borrow.underlyingAsset}
                                                className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg border border-border-light dark:border-slate-700 hover:border-primary/30 dark:hover:border-primary/50 transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-border-light dark:border-slate-600/30">
                                                        <img
                                                            src={getTokenLogo(borrow.symbol)}
                                                            alt={borrow.symbol}
                                                            className="w-full h-full object-cover"
                                                            onError={onTokenImgError(borrow.symbol)}
                                                        />
                                                        <span className="text-xs font-bold text-slate-500 uppercase" style={{ display: 'none' }}>
                                                            {borrow.symbol?.[0] || '?'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="font-mono text-base font-bold text-slate-900 dark:text-white">
                                                            {formatUSD(parseFloat(borrow.formattedAmount) * parseFloat(borrow.priceInUSD || 0))}
                                                        </div>
                                                        <div className="text-xs text-slate-400 font-medium whitespace-pre">
                                                            {formatTokenAmount(parseFloat(borrow.formattedAmount), borrow.symbol)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenSwap(chain.chainId, borrow, chain.marketAssets, chain.borrows, [], false);
                                                    }}
                                                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white flex items-center gap-2 transition-colors shrink-0"
                                                >
                                                    <ArrowRightLeft className="w-4 h-4" />
                                                    <span className="text-base font-semibold inline">Swap</span>
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        /* Empty borrow state placeholder */
                                        <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-border-light dark:border-slate-700 select-none h-15.5">
                                            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700/30 flex items-center justify-center shrink-0">
                                                <ArrowRightLeft className="w-4 h-4 text-slate-400" />
                                            </div>
                                            <div className="flex flex-col justify-center">
                                                <div className="text-base font-semibold text-slate-400 leading-tight">No borrow positions</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {/* Empty Networks Grouped Accordion */}
            {emptyChains.length > 0 && (
                <div className="bg-white dark:bg-card-dark rounded-2xl border border-border-light dark:border-border-dark overflow-hidden transition-all text-slate-400">
                    <div
                        className="flex flex-col sm:flex-row p-4 w-full sm:items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
                        onClick={() => setOpenEmptyChains(!openEmptyChains)}
                    >
                        <div className="flex justify-between items-center w-full">
                            <div className="flex items-center gap-3">
                                <div className="flex -space-x-2">
                                    {emptyChains.slice(0, 5).map((chain, idx) => (
                                        chain.icon ? (
                                            <img
                                                key={chain.chainId}
                                                src={chain.icon}
                                                alt={chain.label}
                                                className="w-6 h-6 rounded-full border-2 border-white dark:border-card-dark opacity-60 saturate-50"
                                                style={{ zIndex: 5 - idx }}
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                        ) : null
                                    ))}
                                    {emptyChains.length > 5 && (
                                        <div className="w-6 h-6 rounded-full border-2 border-white dark:border-card-dark bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold z-0 text-slate-500 opacity-60 saturate-50">
                                            +{emptyChains.length - 5}
                                        </div>
                                    )}
                                </div>
                                <span className="text-base italic ml-1">No positions</span>
                            </div>

                            <div className="text-slate-400 transition-transform duration-200 flex items-center">
                                {openEmptyChains ? (
                                    <ChevronUp className="w-5 h-5" />
                                ) : (
                                    <ChevronDown className="w-5 h-5" />
                                )}
                            </div>
                        </div>
                    </div>

                    {openEmptyChains && (
                        <div className="border-t border-border-light dark:border-border-dark p-4 bg-slate-50 dark:bg-slate-900/30">
                            <div className="flex flex-wrap gap-x-6 gap-y-3">
                                {emptyChains.map((chain) => (
                                    <div key={chain.chainId} className="flex items-center gap-1.5">
                                        {chain.icon && (
                                            <img
                                                src={chain.icon}
                                                alt={chain.label}
                                                className="w-5 h-5 rounded-full"
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                        )}
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{chain.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Swap Modals */}
            <Suspense fallback={null}>
                {modalState.isCollateral ? (
                    <CollateralSwapModal
                        isOpen={modalState.open}
                        onClose={handleCloseModal}
                        initialFromToken={modalState.initialFromToken}
                        chainId={modalState.chainId}
                        marketAssets={modalState.marketAssets}
                        providedSupplies={modalState.supplies}
                        donator={donator}
                    />
                ) : (
                    <DebtSwapModal
                        isOpen={modalState.open}
                        onClose={handleCloseModal}
                        initialFromToken={modalState.initialFromToken}
                        chainId={modalState.chainId}
                        marketAssets={modalState.marketAssets}
                        providedBorrows={modalState.borrows}
                        donator={donator}
                    />
                )}
            </Suspense>
        </div>
    );
};

export default PositionsAccordion;
