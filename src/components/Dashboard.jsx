import React, { useState, useEffect } from 'react';
import { useUserPosition } from '../hooks/useUserPosition';
import { RefreshCw, TrendingUp, TrendingDown, Info, AlertCircle, ChevronDown, ChevronUp, ArrowRightLeft } from 'lucide-react';
import { useWeb3 } from '../context/web3Context';
import { DebtSwapModal } from './DebtSwapModal.jsx';

// Helper to get token logo URL from Aave CDN
const getTokenLogo = (symbol) => {
    if (!symbol) return null;
    const normalizedSymbol = symbol.toLowerCase();
    return `https://app.aave.com/icons/tokens/${normalizedSymbol}.svg`;
};

export const Dashboard = () => {
    const { supplies, borrows, marketAssets, loading, error, lastFetch, refresh } = useUserPosition();
    const { account } = useWeb3();
    const [, forceUpdate] = useState(0);
    const [swapModalOpen, setSwapModalOpen] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState(null);

    // Force re-render every second to update "last fetch" timestamp
    useEffect(() => {
        const interval = setInterval(() => {
            forceUpdate(prev => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleManualRefresh = () => {
        refresh(true); // Force refresh, bypass cache
    };

    const handleOpenSwapModal = (asset) => {
        setSelectedAsset(asset);
        setSwapModalOpen(true);
    };

    const handleCloseSwapModal = () => {
        setSwapModalOpen(false);
        setSelectedAsset(null);
    };

    // Filter out borrows with zero balance
    const activeBorrows = borrows.filter(b => parseFloat(b.formattedAmount) > 0.00001);

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

    if (!account) return null;

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-500">
            {/* ... rest unchanged until borrows ... */}
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-400" /> Positions Dashboard
                </h2>
                <div className="flex items-center gap-3">
                    {lastFetch && (
                        <span className="text-xs text-slate-500">
                            Updated {getLastFetchText()}
                        </span>
                    )}
                    <button
                        onClick={handleManualRefresh}
                        disabled={loading}
                        className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Atualizar posições (força refresh)"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-xl animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3 text-red-200 mb-3">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-bold mb-1">Erro ao Carregar Posições</p>
                            <p className="text-xs text-red-300/80">{error}</p>
                        </div>
                    </div>
                    {error.includes('rate limit') && (
                        <button
                            onClick={handleManualRefresh}
                            disabled={loading}
                            className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-bold py-2 px-3 rounded border border-red-500/30 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Carregando...' : 'Tentar Novamente'}
                        </button>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* SUPPLIES COLUMN */}
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden">
                    <div className="p-4 border-b border-slate-700/50 bg-slate-800/80 flex justify-between items-center">
                        <span className="text-sm font-bold text-slate-300 uppercase tracking-wider">Your Supplies</span>
                        <TrendingUp className="w-4 h-4 text-green-400" />
                    </div>

                    <div className="p-2 space-y-1">
                        {loading && supplies.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 opacity-20" />
                                <p className="text-sm">Loading...</p>
                            </div>
                        ) : supplies.length > 0 ? (
                            supplies.map((asset) => (
                                <div
                                    key={asset.underlyingAsset}
                                    className="group p-4 rounded-xl hover:bg-slate-700/40 border border-transparent hover:border-slate-600/50 transition-all flex justify-between items-center"
                                >
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={getTokenLogo(asset.symbol)}
                                            alt={asset.symbol}
                                            className="w-10 h-10 rounded-full"
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                        <div>
                                            <div className="font-mono font-bold text-white">
                                                {parseFloat(asset.formattedAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {asset.symbol}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="px-2 py-1 text-xs bg-slate-600 text-slate-400 rounded">
                                            Soon
                                        </span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-8 text-center text-slate-600">
                                <p className="text-sm italic">No supplies found</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* BORROWS COLUMN */}
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden">
                    <div className="p-4 border-b border-slate-700/50 bg-slate-800/80 flex justify-between items-center">
                        <span className="text-sm font-bold text-slate-300 uppercase tracking-wider">Your Borrows</span>
                        <TrendingDown className="w-4 h-4 text-orange-400" />
                    </div>

                    <div className="p-2 space-y-1">
                        {loading && activeBorrows.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 opacity-20" />
                                <p className="text-sm">Loading...</p>
                            </div>
                        ) : activeBorrows.length > 0 ? (
                            activeBorrows.map((asset) => (
                                <div
                                    key={asset.underlyingAsset}
                                    className="group p-4 rounded-xl hover:bg-slate-700/40 border border-transparent hover:border-slate-600/50 transition-all flex justify-between items-center"
                                >
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={getTokenLogo(asset.symbol)}
                                            alt={asset.symbol}
                                            className="w-10 h-10 rounded-full"
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                        <div>
                                            <div className="font-mono font-bold text-white">
                                                {parseFloat(asset.formattedAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {asset.symbol}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <button
                                            onClick={() => handleOpenSwapModal(asset)}
                                            className="bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                                        >
                                            <ArrowRightLeft className="w-4 h-4" />
                                            Swap
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="p-8 text-center text-slate-600">
                                {borrows.length > 0 ? (
                                    <>
                                        <p className="text-sm italic mb-1">No active borrows with balance</p>
                                        <p className="text-xs text-slate-700 mb-3">
                                            {borrows.length} position{borrows.length > 1 ? 's' : ''} found but with zero balance
                                        </p>
                                        <div className="mt-4 inline-flex items-start gap-2 text-left bg-slate-800/50 p-3 rounded-lg max-w-md">
                                            <svg className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <p className="text-xs text-slate-500">
                                                <span className="text-slate-400 font-medium">Note:</span> Position data has a 10-second cache. If you just repaid your debt, wait a moment or click the refresh button.
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm italic">No active borrows</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* SUMMARY BAR (Optional) */}
            {supplies.length > 0 || activeBorrows.length > 0 ? (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 flex justify-between items-center text-xs text-slate-500">
                    <div className="flex gap-4">
                        <span className="flex items-center gap-1"><Info className="w-3 h-3" /> Click the Swap button to swap your positions</span>
                    </div>
                    <div className="font-mono opacity-50">
                        Aave V3 Protocol
                    </div>
                </div>
            ) : null}

            {/* Debt Swap Modal */}
            <DebtSwapModal
                isOpen={swapModalOpen}
                onClose={handleCloseSwapModal}
                initialFromToken={selectedAsset}
                initialToToken={null}
            />
        </div>
    );
};