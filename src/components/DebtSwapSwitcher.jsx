import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ethers } from 'ethers';
import {
    ArrowRightLeft,
    RefreshCw,
    CheckCircle2,
    TrendingDown,
    Info,
    AlertTriangle,
    X,
    Search,
    ChevronDown,
    Lock
} from 'lucide-react';
import { AmountInput } from './AmountInput.jsx';

// Helper to get token logo URL from Aave CDN
const getTokenLogo = (symbol) => {
    if (!symbol) return null;
    const normalizedSymbol = symbol.toLowerCase();
    return `https://app.aave.com/icons/tokens/${normalizedSymbol}.svg`;
};

const TokenSelector = ({ label, selectedToken, tokens, onSelect, disabled, getBorrowStatus, compact = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const buttonRef = useRef(null);
    const [minWidth, setMinWidth] = useState(null);

    const [portalStyle, setPortalStyle] = useState(null);

    useEffect(() => {
        if (isOpen && buttonRef.current) {
            try {
                const rect = buttonRef.current.getBoundingClientRect();
                const maxWidth = 520;
                const minWidthPx = buttonRef.current.offsetWidth;
                let left = rect.left;
                // Keep within viewport horizontally
                const availableRight = window.innerWidth - left - 8;
                const width = Math.min(maxWidth, Math.max(minWidthPx, availableRight));
                if (left + width > window.innerWidth - 8) {
                    left = Math.max(8, window.innerWidth - width - 8);
                }
                const top = rect.bottom + 8; // 8px gap
                setMinWidth(minWidthPx);
                setPortalStyle({ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, zIndex: 9999 });
            } catch (e) {
                // ignore
            }
        } else {
            setPortalStyle(null);
        }
    }, [isOpen]);

    useEffect(() => {
        const onScroll = () => {
            if (isOpen && buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                const left = Math.max(8, rect.left);
                const top = rect.bottom + 8;
                setPortalStyle((s) => s ? { ...s, left: `${left}px`, top: `${top}px` } : s);
            }
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, [isOpen]);

    const filteredTokens = useMemo(() => {
        if (!tokens) return [];
        return tokens.filter(t =>
            t.symbol.toLowerCase().includes(search.toLowerCase()) ||
            t.name?.toLowerCase().includes(search.toLowerCase())
        );
    }, [tokens, search]);

    return (
        <div className={compact ? 'relative inline-block' : 'relative flex-1'}>
            {!compact && <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">{label}</span>}
            <button
                ref={buttonRef}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={compact
                    ? `inline-flex items-center gap-2 bg-slate-900 border ${isOpen ? 'border-purple-500' : 'border-slate-700'} px-3 py-1 rounded-lg hover:bg-slate-800 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
                    : `w-full bg-slate-900 border ${isOpen ? 'border-purple-500' : 'border-slate-700'} p-3 rounded-xl flex items-center justify-between hover:bg-slate-800 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
                }
            >
                <div className={`flex items-center gap-2 ${compact ? '' : ''}`}>
                    <div className={`${compact ? 'w-6 h-6' : 'w-8 h-8'} rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden`}>
                        {selectedToken?.symbol ? (
                            <img
                                src={getTokenLogo(selectedToken.symbol)}
                                alt={selectedToken.symbol}
                                className={`${compact ? 'w-4 h-4' : 'w-6 h-6'}`}
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'block';
                                }}
                            />
                        ) : null}
                        <span className="text-xs font-bold" style={{ display: selectedToken?.symbol ? 'none' : 'block' }}>
                            {selectedToken?.symbol?.[0] || '?'}
                        </span>
                    </div>
                    <span className={`text-sm font-bold text-white ${compact ? 'hidden sm:inline-block' : ''}`}>{selectedToken?.symbol || (compact ? '' : 'Select')}</span>
                </div>
                {!compact && <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
            </button>

            {isOpen && portalStyle && (
                createPortal(
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                        <div
                            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                            style={{
                                ...portalStyle,
                                maxWidth: '520px',
                                borderRadius: '12px'
                            }}
                        >
                            <div className="p-2 border-b border-slate-700">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        autoFocus
                                        type="text"
                                        placeholder="Search token..."
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-purple-500"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                            </div>
                            <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
                                {filteredTokens.length === 0 && (
                                    <div className="p-4 text-center text-slate-500 text-xs">No tokens found</div>
                                )}
                                {filteredTokens.map((token) => {
                                    const status = getBorrowStatus(token);
                                    const isRestricted = !status.borrowable;

                                    return (
                                        <button
                                            key={token.underlyingAsset || token.address}
                                            onClick={() => {
                                                if (isRestricted) return;
                                                onSelect(token);
                                                setIsOpen(false);
                                                setSearch('');
                                            }}
                                            className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors group ${isRestricted ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-800'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden">
                                                    <img
                                                        src={getTokenLogo(token.symbol)}
                                                        alt={token.symbol}
                                                        className="w-7 h-7"
                                                        onError={(e) => {
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                    />
                                                    <span className="text-xs font-bold" style={{ display: 'none' }}>{token.symbol[0]}</span>
                                                </div>
                                                <div className="text-left">
                                                    <div className="text-sm font-bold text-white group-hover:text-purple-400">{token.symbol}</div>
                                                    <div className="text-[10px] text-slate-500">{token.name}</div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                {status.reasons.map((reason) => (
                                                    <div
                                                        key={`${token.symbol}-${reason.key}`}
                                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold border ${reason.className}`}
                                                    >
                                                        {reason.icon}
                                                        {reason.label}
                                                    </div>
                                                ))}
                                                {!status.reasons.length && token.availableLiquidity === "0" && (
                                                    <div className="flex items-center gap-1 bg-red-900/30 text-red-500 px-1.5 py-0.5 rounded text-[8px] font-bold border border-red-500/30">
                                                        <Lock className="w-2.5 h-2.5" /> FROZEN
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>,
                    document.body
                )
            )}
        </div>
    );
};

export const DebtSwapSwitcher = ({
    fromToken,
    setFromToken,
    toToken,
    setToToken,
    marketAssets,
    debtBalance,
    formattedDebt,
    swapAmount,
    setSwapAmount,
    isTyping,
    swapQuote,
    slippage,
    setSlippage,
    nextRefreshIn,
    isBusy,
    isQuoteLoading,
    needsApproval,
    signedPermit,
    userRejected,
    handleSwap,
    txError,
    clearTxError,
    pendingTxParams,
    handleApproveDelegation,
    fetchQuote,
    clearCachedPermit,
}) => {
    // Preference for permit vs on-chain approval (session only)
    const [preferPermit, setPreferPermit] = useState(true);
    const [showMethodMenu, setShowMethodMenu] = useState(false);
    const methodMenuRef = useRef(null);

    // Close method menu when clicking outside
    useEffect(() => {
        if (!showMethodMenu) return;
        const handleClickOutside = (e) => {
            if (methodMenuRef.current && !methodMenuRef.current.contains(e.target)) {
                setShowMethodMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMethodMenu]);
    const getBorrowStatus = (token) => {
        if (!token) return { borrowable: false, reasons: [] };

        const reasons = [];
        const addReason = (key, label, className, icon) => {
            reasons.push({ key, label, className, icon });
        };

        const isFrozen = token.isFrozen;
        const isPaused = token.isPaused;
        const isInactive = !token.isActive;
        const borrowingDisabled = !token.borrowingEnabled;

        // Note: Liquidity/cap checks removed - Aave validates at swap time
        // We only show basic protocol-level restrictions here

        if (isInactive) {
            addReason('inactive', 'INACTIVE', 'bg-slate-700/40 text-slate-300 border-slate-600/50', <Lock className="w-2.5 h-2.5" />);
        }
        if (isPaused) {
            addReason('paused', 'PAUSED', 'bg-amber-900/30 text-amber-500 border-amber-500/30', <AlertTriangle className="w-2.5 h-2.5" />);
        }
        if (isFrozen) {
            addReason('frozen', 'FROZEN', 'bg-red-900/30 text-red-500 border-red-500/30', <Lock className="w-2.5 h-2.5" />);
        }
        if (borrowingDisabled) {
            addReason('borrow-disabled', 'BORROW OFF', 'bg-slate-800/50 text-slate-400 border-slate-600/40', <Lock className="w-2.5 h-2.5" />);
        }

        return { borrowable: reasons.length === 0, reasons };
    };

    const toTokenStatus = getBorrowStatus(toToken);
    const isToTokenBorrowable = toTokenStatus.borrowable;
    return (
        <div className="space-y-6">
            {/* LOADING STATE */}
            {isBusy && !debtBalance && (
                <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                    <span className="text-sm text-slate-400">Loading position...</span>
                </div>
            )}

            {/* NO DEBT WARNING */}
            {fromToken && (!debtBalance || debtBalance === BigInt(0)) && !isBusy && (
                <div className="bg-amber-900/20 border border-amber-500/50 p-4 rounded-xl animate-in fade-in">
                    <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <h3 className="text-amber-300 font-bold text-sm mb-1">No Active Debt</h3>
                            <p className="text-amber-200/80 text-xs mb-2">
                                No active debt found for {fromToken.symbol} in this wallet.
                                Verify you’re connected to the correct network or if this position has been fully repaid.
                            </p>
                            <p className="text-amber-300/60 text-[10px] italic">
                                Tip: Try refreshing positions using the ↻ button at the top of the dashboard.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Primary amount input for debt asset */}
            <div className="space-y-3">
                <div className="relative">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">{fromToken?.symbol || 'Debt Asset'}</span>
                    <AmountInput
                        maxAmount={debtBalance || BigInt(0)}
                        decimals={fromToken?.decimals || 18}
                        symbol={fromToken?.symbol || ''}
                        onAmountChange={setSwapAmount}
                        isProcessing={isTyping}
                    />

                </div>

                {/* Slippage (moved above To box) */}
                <div className="flex items-center justify-between gap-4 mt-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Slippage</span>
                    <div className="flex gap-1">
                        {[50, 100, 300, 500].map(v => (
                            <button
                                key={v}
                                onClick={() => setSlippage(v)}
                                className={`px-2 py-0.5 text-[10px] rounded ${slippage === v ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-500'}`}
                            >
                                {(v / 100).toFixed(1)}%
                            </button>
                        ))}
                    </div>
                </div>

                {/* TO input with inline selector showing the NEW DEBT ESTIMATED as the quote result */}
                <div className="relative bg-slate-900 border border-slate-700 p-4 pr-20 rounded-xl">
                    <div className="flex items-start justify-between">
                        <div>
                            <label className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Nova Dívida Estimada</label>
                            <div className="text-2xl font-mono font-bold text-white">
                                {swapQuote && toToken ? (
                                    Number(ethers.formatUnits(swapQuote.destAmount, toToken.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })
                                ) : (
                                    <span className="text-slate-500 text-lg">Enter an amount</span>
                                )}
                                <span className="text-sm text-slate-500 ml-2">{toToken?.symbol || ''}</span>
                            </div>
                            {swapQuote && (
                                <div className="text-[10px] text-slate-500 mt-2">Price: 1 {fromToken?.symbol} ≈ {(Number(swapQuote.srcAmount) / Number(swapQuote.destAmount) * Math.pow(10, fromToken?.decimals - (toToken?.decimals || 18))).toFixed(6)} {toToken?.symbol}</div>
                            )}
                        </div>

                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                            <TokenSelector
                                compact
                                selectedToken={toToken}
                                tokens={marketAssets?.filter(t => t.underlyingAsset !== fromToken?.underlyingAsset)}
                                onSelect={setToToken}
                                getBorrowStatus={getBorrowStatus}
                            />
                        </div>

                        {swapQuote && (
                            <div className="absolute right-20 top-3 text-[10px] text-slate-400 flex items-center gap-2">
                                {isQuoteLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                                <span>{nextRefreshIn}s</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {!isToTokenBorrowable && toToken && (
                <div className="bg-amber-900/20 border border-amber-500/40 p-3 rounded-xl flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-amber-200/80">
                        <span className="font-bold text-amber-300">Token unavailable for borrowing.</span>
                        <span className="ml-2">Select another asset or wait for availability.</span>
                    </div>
                </div>
            )}

            {/* ERROR DISPLAY */}
            {txError && (
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="text-red-400 font-bold text-xs mb-1">Transaction error</h3>
                            <p className="text-red-300/80 text-[10px] font-mono break-all">{txError}</p>
                        </div>
                        <button onClick={clearTxError} className="text-red-400 hover:text-red-300 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex gap-2 pl-8 flex-wrap">
                        <button
                            onClick={() => {
                                clearTxError();
                                clearCachedPermit();
                                fetchQuote();
                            }}
                            className="text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded border border-red-500/30 transition-colors"
                        >
                            Clear cache and retry
                        </button>

                        <button
                            onClick={() => {
                                clearTxError();
                                handleApproveDelegation(preferPermit);
                            }}
                            className="text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 px-3 py-1.5 rounded border border-blue-500/30 transition-colors flex items-center gap-1"
                        >
                            Approve manually
                        </button>
                        <div className="ml-2 text-[10px] text-slate-400">Signature recommended</div>
                    </div>
                </div>
            )}

            {/* STATUS PENDING APPROVAL */}
            {pendingTxParams && (
                <div className="bg-blue-900/20 shadow-2xl rounded-xl p-4 border border-blue-500/30 animate-in zoom-in-95">
                    <div className="flex items-center gap-3 text-blue-400 mb-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-bold">Signature required</span>
                    </div>
                    <p className="text-[10px] text-blue-300/80 mb-3">
                        Credit delegation approval required. Please approve to continue.
                    </p>
                </div>
            )}

            {/* Duplicate amount block removed — primary amount input is shown above */}





            {/* QUOTE LOADING STATE */}
            {!swapQuote && isQuoteLoading && (
                <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 flex items-center justify-center gap-2 animate-pulse">
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                    <span className="text-sm text-slate-400">Fetching best quote...</span>
                </div>
            )}

            {/* WAITING FOR SELECTION */}
            {!swapQuote && !isQuoteLoading && !toToken && (
                <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 flex items-center justify-center">
                    <span className="text-sm text-slate-500">Select a destination asset to see quote</span>
                </div>
            )}

            {/* ACTION BUTTON */}
            <div className="space-y-3">
                {/* Method selector (always shown) */}
                <div ref={methodMenuRef} className="relative flex justify-end mb-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMethodMenu((s) => !s); }}
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline cursor-pointer"
                        aria-expanded={showMethodMenu}
                        aria-haspopup="menu"
                        title="Choose approval method"
                    >
                        <Settings className="w-3 h-3" />
                        <span>{preferPermit ? 'Signature (recommended)' : 'Approve on-chain'}</span>
                    </button>

                    {showMethodMenu && (
                        <div className="absolute top-6 right-0 w-60 bg-slate-900 border border-slate-700 rounded-md shadow-xl p-2 z-50">
                            <button
                                onClick={() => { setPreferPermit(true); setShowMethodMenu(false); }}
                                className={`w-full text-left px-2 py-2 rounded hover:bg-slate-800 flex items-center justify-between ${preferPermit ? 'bg-slate-800/60' : ''}`}
                            >
                                <div>
                                    <div className="font-bold text-white text-sm">Signature (recommended)</div>
                                    <div className="text-xs text-slate-400">Faster and fee-free</div>
                                </div>
                                {preferPermit && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                            </button>
                            <button
                                onClick={() => { setPreferPermit(false); setShowMethodMenu(false); }}
                                className={`w-full text-left mt-1 px-2 py-2 rounded hover:bg-slate-800 flex items-center justify-between ${!preferPermit ? 'bg-slate-800/60' : ''}`}
                            >
                                <div>
                                    <div className="font-bold text-white text-sm">Approve on-chain</div>
                                    <div className="text-xs text-slate-400">Send on‑chain approval transaction</div>
                                </div>
                                {!preferPermit && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                            </button>
                        </div>
                    )}
                </div>

                <button
                    onClick={handleSwap}
                    disabled={isBusy || !debtBalance || debtBalance === BigInt(0) || !swapQuote || !isToTokenBorrowable}
                    className="w-full bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl flex items-center justify-center gap-3 transition-all shadow-lg shadow-purple-900/20"
                >
                    {isBusy ? <RefreshCw className="animate-spin w-5 h-5" /> : <ArrowRightLeft className="w-5 h-5" />}
                    {needsApproval && !signedPermit ? 'Sign & Swap' : 'Confirm Swap'}
                </button>

                {userRejected && (
                    <div className="text-[10px] text-blue-400 text-center">
                        Transaction cancelled. Try again when ready.
                    </div>
                )}
            </div>
        </div>
    );
};
