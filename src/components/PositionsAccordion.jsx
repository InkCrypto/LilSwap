import React, { useState, useMemo, lazy, Suspense } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronUp, RefreshCw, AlertCircle } from 'lucide-react';
import { useAllPositions } from '../hooks/useAllPositions';
import { requestChainSwitch } from '../utils/wallet';
import { getNetworkByChainId } from '../constants/networks';
import logger from '../utils/logger';

// Lazy load DebtSwapModal
const DebtSwapModal = lazy(() => import('./DebtSwapModal.jsx').then(module => ({ default: module.DebtSwapModal })));

// Helper to get token logo URL from Aave CDN
const getTokenLogo = (symbol) => {
    if (!symbol) return null;
    const normalizedSymbol = symbol.toLowerCase();
    return `https://app.aave.com/icons/tokens/${normalizedSymbol}.svg`;
};

/**
 * PositionsAccordion Component
 * Displays user positions across multiple networks in an accordion layout
 * @param {string} userAddress - User wallet address
 */
export const PositionsAccordion = ({ userAddress }) => {
    const { positionsByChain, loading, error, lastFetch, refresh } = useAllPositions(userAddress);
    const [openChain, setOpenChain] = useState(null);
    const [modalState, setModalState] = useState({
        open: false,
        chainId: null,
        initialFromToken: null,
        marketAssets: [],
        borrows: []
    });
    const [switchingChain, setSwitchingChain] = useState(null);

    // Handle opening swap modal and switching chain
    const handleOpenSwap = async (chainId, asset, marketAssets, borrows = []) => {
        logger.debug('Opening swap modal', { chainId, asset: asset.symbol });
        setSwitchingChain(chainId);

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
                borrows: borrows || []
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
        } finally {
            setSwitchingChain(null);
        }
    };

    const handleCloseModal = () => {
        setModalState({
            open: false,
            chainId: null,
            initialFromToken: null,
            marketAssets: [],
            borrows: []
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

            // Extract health factor if available
            const healthFactor = info?.summary?.healthFactor ? parseFloat(info.summary.healthFactor) : null;

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
                supplies: info?.supplies || [],
                borrows: info?.borrows || [],
                marketAssets: info?.marketAssets || [],
                error: info?.error
            };
        });

        // Sort: networks with positions first, then by total positions (descending)
        return entries.sort((a, b) => {
            // First, compare hasPositions (true comes before false)
            if (a.hasPositions !== b.hasPositions) {
                return a.hasPositions ? -1 : 1;
            }

            // If both have positions (or both don't), sort by total positions
            return b.totalPositions - a.totalPositions;
        });
    }, [positionsByChain]);

    // Show loading state
    if (loading && !positionsByChain) {
        return (
            <div className="w-full bg-slate-800/50 rounded-2xl border border-slate-700 p-6 text-center">
                <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-2" />
                <p className="text-slate-400">Loading positions across networks...</p>
            </div>
        );
    }

    // Show error state
    if (error && !positionsByChain) {
        return (
            <div className="w-full bg-red-900/20 rounded-2xl border border-red-700 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <p className="text-red-400">Error: {error}</p>
                <button
                    onClick={() => refresh(true)}
                    className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
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

    return (
        <div className="w-full space-y-4">
            {/* Header with refresh button */}
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-white">Positions by Network</h2>
                <div className="flex items-center gap-3">
                    {lastFetch && (
                        <span className="text-xs text-slate-500">
                            Updated {getLastFetchText()}
                        </span>
                    )}
                    <button
                        onClick={() => refresh(true)}
                        disabled={loading}
                        className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Refresh positions"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Network accordion */}
            {chainEntries.map((chain) => (
                <div
                    key={chain.chainId}
                    className="bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden transition-all hover:border-slate-600"
                >
                    {/* Accordion header */}
                    <div
                        className="flex items-center justify-between p-4 cursor-pointer"
                        onClick={() => setOpenChain(openChain === chain.chainId ? null : chain.chainId)}
                    >
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                {chain.icon && (
                                    <img
                                        src={chain.icon}
                                        alt={chain.label}
                                        className="w-5 h-5 rounded-full"
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                )}
                                <div className="text-sm font-bold text-white">{chain.label}</div>
                                {chain.hasError && (
                                    <AlertCircle className="w-4 h-4 text-yellow-500" title={chain.error} />
                                )}
                            </div>
                            <div className="text-xs text-slate-400 mt-1">
                                {chain.hasPositions ? (
                                    <>
                                        {chain.suppliesCount} supplied • {chain.borrowsCount} borrowed
                                        {chain.healthFactor !== null && (
                                            <>
                                                {' • '}
                                                <span className={`font-semibold ${chain.healthFactor >= 2 ? 'text-green-400' :
                                                    chain.healthFactor >= 1.5 ? 'text-yellow-400' :
                                                        'text-red-400'
                                                    }`}>
                                                    HF: {chain.healthFactor.toFixed(2)}
                                                </span>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    'No positions'
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {chain.hasPositions && (
                                <div className="text-right">
                                    <div className="text-xs text-slate-500">Total Borrowed</div>
                                    <div className="text-sm font-mono text-white">
                                        {chain.borrowsCount > 0 ? `${chain.borrowsCount} assets` : '—'}
                                    </div>
                                </div>
                            )}
                            <div className="text-slate-400">
                                {openChain === chain.chainId ? (
                                    <ChevronUp className="w-5 h-5" />
                                ) : (
                                    <ChevronDown className="w-5 h-5" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Accordion content */}
                    {openChain === chain.chainId && chain.hasPositions && (
                        <div className="border-t border-slate-700 p-4 space-y-3 bg-slate-900/30">
                            {/* Show borrows */}
                            {chain.borrows.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                                        Borrowed Assets
                                    </h4>
                                    <div className="space-y-2">
                                        {chain.borrows.map((borrow) => (
                                            <div
                                                key={borrow.underlyingAsset}
                                                className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-purple-500/50 transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={getTokenLogo(borrow.symbol)}
                                                        alt={borrow.symbol}
                                                        className="w-8 h-8 rounded-full"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                    <div>
                                                        <div className="font-mono font-bold text-white">
                                                            {parseFloat(borrow.formattedAmount).toFixed(4)}
                                                        </div>
                                                        <div className="text-xs text-slate-400">
                                                            {borrow.symbol}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenSwap(chain.chainId, borrow, chain.marketAssets, chain.borrows);
                                                    }}
                                                    disabled={switchingChain === chain.chainId}
                                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {switchingChain === chain.chainId ? (
                                                        <>
                                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                                            <span className="text-sm font-semibold">Switching...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ArrowRightLeft className="w-4 h-4" />
                                                            <span className="text-sm font-semibold">Swap</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Show supplies (optional, collapsed by default) */}
                            {chain.supplies.length > 0 && (
                                <div className="pt-2">
                                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">
                                        Supplied Assets
                                    </h4>
                                    <div className="space-y-2">
                                        {chain.supplies.map((supply) => (
                                            <div
                                                key={supply.underlyingAsset}
                                                className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-700/50"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={getTokenLogo(supply.symbol)}
                                                        alt={supply.symbol}
                                                        className="w-6 h-6 rounded-full"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                    <div>
                                                        <div className="font-mono text-sm text-white">
                                                            {parseFloat(supply.formattedAmount).toFixed(4)}
                                                        </div>
                                                        <div className="text-xs text-slate-500">
                                                            {supply.symbol}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}

            {/* Debt Swap Modal */}
            <Suspense fallback={<div>Loading...</div>}>
                <DebtSwapModal
                    isOpen={modalState.open}
                    onClose={handleCloseModal}
                    initialFromToken={modalState.initialFromToken}
                    chainId={modalState.chainId}
                    marketAssets={modalState.marketAssets}
                    providedBorrows={modalState.borrows}
                />
            </Suspense>
        </div>
    );
};

export default PositionsAccordion;
