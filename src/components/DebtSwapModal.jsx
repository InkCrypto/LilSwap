import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ethers } from 'ethers';
import {
    ArrowRightLeft,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    X,
    Search,
    ChevronDown,
    Lock,
    Settings,
    Percent,
    Info
} from 'lucide-react';
import { Modal } from './Modal.jsx';
import { useWeb3 } from '../context/web3Context.js';
import { useParaswapQuote } from '../hooks/useParaswapQuote.js';
import { useDebtSwitchActions } from '../hooks/useDebtSwitchActions.js';
import { useDebtPositions } from '../hooks/useDebtPositions.js';
import { useUserPosition } from '../hooks/useUserPosition.js';

// Helper to get token logo URL from Aave CDN
const getTokenLogo = (symbol) => {
    if (!symbol) return null;
    const normalizedSymbol = symbol.toLowerCase();
    return `https://app.aave.com/icons/tokens/${normalizedSymbol}.svg`;
};

// Token Selector Component
const TokenSelector = ({ label, selectedToken, tokens, onSelect, disabled, getBorrowStatus, compact = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const buttonRef = useRef(null);
    const [portalStyle, setPortalStyle] = useState(null);

    useEffect(() => {
        if (isOpen && buttonRef.current) {
            try {
                const rect = buttonRef.current.getBoundingClientRect();
                const buttonCenter = rect.left + rect.width / 2;
                const width = Math.min(400, window.innerWidth - 32);
                const left = Math.max(16, Math.min(buttonCenter - width / 2, window.innerWidth - width - 16));
                const top = rect.bottom + 8;
                setPortalStyle({ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, zIndex: 99999 });
            } catch (e) {
                console.warn('TokenSelector portal positioning error:', e);
            }
        } else {
            setPortalStyle(null);
        }
    }, [isOpen]);

    const filteredTokens = useMemo(() => {
        if (!tokens) return [];
        return tokens.filter(t =>
            t.symbol.toLowerCase().includes(search.toLowerCase()) ||
            t.name?.toLowerCase().includes(search.toLowerCase())
        );
    }, [tokens, search]);

    return (
        <div className={compact ? "relative shrink-0" : "relative w-full"}>
            <button
                ref={buttonRef}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={compact
                    ? `px-3 py-2 rounded-full bg-slate-900 hover:bg-slate-800 border ${isOpen ? 'border-purple-500' : 'border-slate-700'} flex items-center gap-2 overflow-hidden transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
                    : `w-full bg-slate-800 border ${isOpen ? 'border-purple-500' : 'border-slate-700'} p-3 rounded-xl flex items-center justify-between hover:bg-slate-750 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
                }
            >
                {compact ? (
                    <>
                        <div className="flex items-center gap-2">
                            {selectedToken?.symbol ? (
                                <img
                                    src={getTokenLogo(selectedToken.symbol)}
                                    alt={selectedToken.symbol}
                                    className="w-6 h-6 rounded-full"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            ) : null}
                            <span className="text-sm font-bold text-white">{selectedToken?.symbol || '—'}</span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center border border-slate-700 overflow-hidden">
                                {selectedToken?.symbol ? (
                                    <img
                                        src={getTokenLogo(selectedToken.symbol)}
                                        alt={selectedToken.symbol} // Corrigido o fechamento do atributo alt
                                        className="w-6 h-6"
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
                            <div className="text-left">
                                <span className="text-sm font-bold text-white block">{selectedToken?.symbol || 'Select'}</span>
                            </div>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </>
                )}
            </button>

            {isOpen && portalStyle && (
                createPortal(
                    <>
                        <div className="fixed inset-0 z-99998" onClick={() => setIsOpen(false)} />
                        <div
                            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                            style={portalStyle}
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
                                    const status = getBorrowStatus ? getBorrowStatus(token) : { borrowable: true, reasons: [] };
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

// Compact Amount Input Row
const CompactAmountInputRow = ({ token, value, onChange, maxAmount, decimals, disabled, formattedDebt, onTokenSelect }) => {

    const handlePercentage = (percentage) => {
        if (!maxAmount || maxAmount === BigInt(0)) return;
        const calculatedAmount = (maxAmount * BigInt(percentage)) / BigInt(100);
        const formatted = ethers.formatUnits(calculatedAmount, decimals);
        onChange(formatted);
    };

    const formattedMax = maxAmount > BigInt(0)
        ? Number(ethers.formatUnits(maxAmount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
        : '0';

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
            {/* Top row: input and token badge */}
            <div className="flex items-baseline gap-2 sm:gap-3">
                <div className="flex-1">
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                onChange(val);
                            }
                        }}
                        placeholder="0.00"
                        disabled={disabled}
                        className="w-full bg-transparent text-white text-2xl font-mono font-bold text-left pl-3 focus:outline-none disabled:opacity-50 py-1"
                    />
                </div>
                {/* Token badge */}
                <div className="bg-slate-900 px-2 sm:px-3 py-1 rounded-full border border-slate-700 flex items-center gap-1 sm:gap-2 cursor-pointer" onClick={onTokenSelect}>
                    {token?.symbol ? (
                        <img
                            src={getTokenLogo(token.symbol)}
                            alt={token.symbol}
                            className="w-5 h-5 sm:w-6 sm:h-6 rounded-full"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                    ) : (
                        <span className="text-xs font-bold">?</span>
                    )}
                    <span className="text-sm sm:text-sm font-bold text-white">{token?.symbol}</span>
                </div>
            </div>
            {/* Bottom row: borrowed and percent buttons */}
            <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-slate-500 pl-3">Borrowed: {formattedDebt || '0'}</div>
                <div className="text-xs text-slate-400 flex gap-3">
                    {[25, 50, 75].map((pct) => (
                        <button
                            key={pct}
                            className="bg-transparent p-0 m-0 text-xs text-slate-400 hover:text-white"
                            style={{ border: 'none' }}
                            onClick={() => onChange((Number(ethers.formatUnits(maxAmount, decimals)) * pct / 100).toFixed(decimals))}
                        >
                            {pct}%
                        </button>
                    ))}
                    <button
                        className="bg-transparent p-0 m-0 text-xs text-slate-400 font-bold hover:text-white"
                        style={{ border: 'none' }}
                        onClick={() => onChange(Number(ethers.formatUnits(maxAmount, decimals)).toFixed(decimals))}
                    >
                        MAX
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * DebtSwapModal Component
 * Complete modal for swapping debt with integrated hooks and state management
 */
export const DebtSwapModal = ({
    isOpen,
    onClose,
    initialFromToken = null,
    initialToToken = null,
    chainId = null,
    marketAssets: providedMarketAssets = null
}) => {
    const { account, provider, selectedNetwork, networkRpcProvider } = useWeb3();

    // Use provided marketAssets as fallback if selectedNetwork isn't synced yet
    // In normal flow, selectedNetwork will be updated by Web3Provider's chainChanged handler
    const { marketAssets: fetchedMarketAssets } = useUserPosition();
    const marketAssets = providedMarketAssets || fetchedMarketAssets;

    // For hooks, use selectedNetwork (should be updated by Web3Provider)
    // chainId prop is kept for debug/fallback purposes
    const effectiveNetwork = selectedNetwork;

    // Local state
    const [fromToken, setFromToken] = useState(initialFromToken);
    const [toToken, setToToken] = useState(initialToToken);
    const [swapAmount, setSwapAmount] = useState(BigInt(0));
    const [inputValue, setInputValue] = useState('');
    const [showSlippageSettings, setShowSlippageSettings] = useState(false);
    const [activeTab, setActiveTab] = useState('market');
    const [logs, setLogs] = useState([]);

    const addLog = useCallback((message, type = 'info') => {
        console.log(`[DebtSwapModal] ${type}: ${message}`);
        setLogs(prev => [...prev.slice(-4), { message, type, timestamp: Date.now() }]);
    }, []);

    // Initialize tokens from props
    useEffect(() => {
        if (isOpen && initialFromToken) {
            setFromToken(initialFromToken);

            // Auto-select toToken if not provided
            if (!initialToToken && marketAssets && marketAssets.length > 0) {
                const isBorrowableToken = (token) => {
                    if (!token) return false;
                    if (!token.isActive || token.isFrozen || token.isPaused || !token.borrowingEnabled) return false;
                    return true;
                };

                // Prefer USDC, USDT, or DAI
                const defaultTo = marketAssets.find(t =>
                    (t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI') &&
                    t.underlyingAsset !== initialFromToken.underlyingAsset &&
                    isBorrowableToken(t)
                ) || marketAssets.find(t =>
                    t.underlyingAsset !== initialFromToken.underlyingAsset && isBorrowableToken(t)
                );

                if (defaultTo) {
                    setToToken(defaultTo);
                }
            }
        }
        if (isOpen && initialToToken) {
            setToToken(initialToToken);
        }

        // Reset inputs when modal closes
        if (!isOpen) {
            setInputValue('');
            setSwapAmount(BigInt(0));
            setShowSlippageSettings(false);
            setLogs([]);
        }
    }, [isOpen, initialFromToken, initialToToken, marketAssets]);

    // Debt positions hook
    const {
        debtBalance,
        formattedDebt,
        allowance,
        isDebtLoading,
        fetchDebtData,
    } = useDebtPositions({
        account,
        provider,
        networkRpcProvider,
        fromToken,
        toToken,
        addLog,
        selectedNetwork: effectiveNetwork,
    });

    // Debug debt data
    useEffect(() => {
        console.log('[DebtSwapModal] Debt data:', {
            isDebtLoading,
            hasFromToken: !!fromToken,
            fromTokenSymbol: fromToken?.symbol,
            formattedDebt,
            debtBalance: debtBalance?.toString(),
            allowance: allowance?.toString()
        });
    }, [isDebtLoading, fromToken, formattedDebt, debtBalance, allowance]);

    // Quote hook
    const {
        swapQuote,
        slippage,
        setSlippage,
        isQuoteLoading,
        isTyping,
        nextRefreshIn,
        fetchQuote,
        clearQuote,
        resetRefreshCountdown,
    } = useParaswapQuote({
        debtAmount: swapAmount,
        fromToken,
        toToken,
        addLog,
        onQuoteLoaded: null,
        selectedNetwork: effectiveNetwork,
        account,
        enabled: isOpen,
    });

    // Actions hook
    const {
        isActionLoading,
        signedPermit,
        txError,
        pendingTxParams,
        userRejected,
        handleSwap,
        handleApproveDelegation,
        clearTxError,
        clearUserRejected,
        clearCachedPermit,
    } = useDebtSwitchActions({
        account,
        provider,
        fromToken,
        toToken,
        allowance,
        swapQuote,
        slippage,
        addLog,
        fetchDebtData,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        selectedNetwork: effectiveNetwork,
        simulateError: false,
    });

    // Destructure clearUserRejected from actions (added in hook)
    // (Note: clearUserRejected is returned by useDebtSwitchActions)
    // eslint-disable-next-line no-unused-vars
    const { } = {};

    const needsApproval = useMemo(() => {
        if (!toToken || !swapQuote?.srcAmount) return false;

        try {
            const srcAmountBigInt = typeof swapQuote.srcAmount === 'bigint'
                ? swapQuote.srcAmount
                : BigInt(swapQuote.srcAmount);

            const maxNewDebt = (srcAmountBigInt * BigInt(1005)) / BigInt(1000);
            return allowance < maxNewDebt;
        } catch (error) {
            console.warn('[DebtSwapModal] Failed to compute needsApproval from quote:', error);
            return false;
        }
    }, [allowance, toToken, swapQuote]);
    const isBusy = isActionLoading || isDebtLoading;

    // Debug state changes
    useEffect(() => {
        console.log('[DebtSwapModal] State update:', {
            isOpen,
            fromToken: fromToken?.symbol,
            toToken: toToken?.symbol,
            debtBalance: debtBalance?.toString(),
            formattedDebt,
            swapAmount: swapAmount?.toString(),
            inputValue,
            hasQuote: !!swapQuote,
            isQuoteLoading,
            isBusy,
            needsApproval
        });
    }, [isOpen, fromToken, toToken, debtBalance, formattedDebt, swapAmount, inputValue, swapQuote, isQuoteLoading, isBusy, needsApproval]);

    // Initialize input value when debtBalance is loaded
    useEffect(() => {
        // Removed automatic loading of debt balance - user must input manually
    }, [debtBalance, fromToken, inputValue]);

    // Handle input change
    const handleInputChange = useCallback((value) => {
        setInputValue(value);
        try {
            if (!value || value === '' || value === '.') {
                setSwapAmount(BigInt(0));
            } else {
                const parsed = ethers.parseUnits(value, fromToken?.decimals || 18);
                const maxAmt = debtBalance || BigInt(0);
                const finalAmount = parsed > maxAmt ? maxAmt : parsed;
                console.log('[DebtSwapModal] Input changed:', {
                    value,
                    parsed: parsed.toString(),
                    maxAmt: maxAmt.toString(),
                    finalAmount: finalAmount.toString()
                });
                setSwapAmount(finalAmount);
            }
        } catch (error) {
            console.warn('Invalid input:', value, error);
        }
    }, [fromToken?.decimals, debtBalance]);

    // Get borrow status for token
    const getBorrowStatus = useCallback((token) => {
        if (!token) return { borrowable: false, reasons: [] };
        const isFrozen = token.isFrozen;
        const isPaused = token.isPaused;
        const isInactive = !token.isActive;
        const borrowingDisabled = !token.borrowingEnabled;
        const notBorrowable = isFrozen || isPaused || isInactive || borrowingDisabled;
        return { borrowable: !notBorrowable, reasons: [] };
    }, []);

    // Clear transaction errors when key data changes so old errors don't persist
    useEffect(() => {
        if (txError) {
            clearTxError && clearTxError();
            clearUserRejected && clearUserRejected();
        }
    }, [swapQuote]);

    // Always clear userRejected when key data changes (quote updates)
    useEffect(() => {
        if (userRejected) {
            clearUserRejected && clearUserRejected();
        }
    }, [swapQuote]);

    // Clear errors when modal is opened
    useEffect(() => {
        if (isOpen && txError) {
            clearTxError && clearTxError();
            clearUserRejected && clearUserRejected();
        }
    }, [isOpen]);

    // Also clear userRejected when modal opens (regardless of txError)
    useEffect(() => {
        if (isOpen && userRejected) {
            clearUserRejected && clearUserRejected();
        }
    }, [isOpen]);

    // Clear errors when user changes tokens or input value
    useEffect(() => {
        if (txError) {
            clearTxError && clearTxError();
            clearUserRejected && clearUserRejected();
        }
    }, [fromToken, toToken, inputValue]);

    // Also clear userRejected when user modifies tokens or input
    useEffect(() => {
        if (userRejected) {
            clearUserRejected && clearUserRejected();
        }
    }, [fromToken, toToken, inputValue]);

    // Filter tokens
    const borrowableAssets = useMemo(() => {
        if (!marketAssets) return [];
        return marketAssets.filter(asset => {
            const status = getBorrowStatus(asset);
            return status.borrowable;
        });
    }, [marketAssets, getBorrowStatus]);

    const activeDebtAssets = useMemo(() => {
        if (!marketAssets) return [];
        return marketAssets.filter(asset => asset.amount && BigInt(asset.amount) > BigInt(0));
    }, [marketAssets]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Swap USDC debt" maxWidth="520px">
            <div className="p-4 space-y-4">
                {/* Header with Tabs and Slippage */}
                <div className="flex items-center justify-between gap-2 relative">
                    {/* Tabs: Market / Limit */}
                    <div className="flex gap-2 bg-slate-800 p-1 rounded-lg flex-1">
                        <button
                            onClick={() => setActiveTab('market')}
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'market'
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            Market
                        </button>
                        <button
                            disabled
                            aria-disabled="true"
                            title="Limit orders coming soon"
                            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all opacity-60 cursor-not-allowed ${activeTab === 'limit'
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-400'
                                }`}
                        >
                            <span>Limit</span>
                            <span className="text-[10px] ml-1 opacity-60">Soon</span>
                        </button>
                    </div>

                    {/* Slippage Icon */}
                    <button
                        onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                        title={`Slippage: ${(slippage / 10).toFixed(1)}%`}
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>

                {/* Slippage Settings Popover */}
                {showSlippageSettings && (
                    <div className="absolute top-16 right-4 bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-lg z-50 animate-in slide-in-from-top-2 duration-150">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs text-slate-400 uppercase font-bold">Slippage Tolerance</label>
                            <span className="text-sm font-bold text-white">{(slippage / 10).toFixed(1)}%</span>
                        </div>
                        <div className="flex gap-2">
                            {[5, 10, 30, 50].map((val) => (
                                <button
                                    key={val}
                                    onClick={() => {
                                        setSlippage(val);
                                        setShowSlippageSettings(false);
                                    }}
                                    className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all ${slippage === val
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-900 text-slate-400 hover:bg-slate-700'
                                        }`}
                                >
                                    {val / 10}%
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* From Token Input Row */}
                {fromToken && (
                    <>
                        <CompactAmountInputRow
                            token={fromToken}
                            value={inputValue}
                            onChange={handleInputChange}
                            maxAmount={debtBalance || BigInt(0)}
                            decimals={fromToken.decimals}
                            disabled={isBusy}
                            formattedDebt={formattedDebt}
                            onTokenSelect={() => { setSelectingForFrom(true); setTokenSelectorOpen(true); }}
                        />
                    </>
                )}

                {/* Auto Refresh Display */}
                {inputValue && (
                    <div className="flex justify-center">
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                            <RefreshCw className="w-3 h-3" />
                            {isQuoteLoading || !swapQuote ? (
                                'Loading quote...'
                            ) : (
                                `Auto refresh in ${nextRefreshIn}s`
                            )}
                        </div>
                    </div>
                )}

                {/* To Token Row (Selector + Quote Result) */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
                    <div className="flex items-center gap-3">
                        {/* Quote Result */}
                        <div className="flex-1 min-w-0 pl-3">
                            {isQuoteLoading ? (
                                <div className="flex items-center gap-2 text-purple-400">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span className="text-sm">Loading quote...</span>
                                </div>
                            ) : swapQuote && toToken && fromToken ? (
                                <div>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-mono font-bold text-white block">
                                            {(() => {
                                                try {
                                                    const formatted = ethers.formatUnits(swapQuote.srcAmount, toToken.decimals);
                                                    return Number(formatted).toLocaleString(undefined, { maximumFractionDigits: 4 });
                                                } catch (e) {
                                                    return '...';
                                                }
                                            })()}
                                        </span>
                                        {/* token symbol removed here; compact selector shows logo+symbol at the end */}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-slate-500 text-sm">
                                    {toToken ? 'Enter amount to get quote' : 'Select a token'}
                                </div>
                            )}
                        </div>

                        {/* Token Selector Button - Compact (moved to right) */}
                        <div className="shrink-0 ml-2">
                            <TokenSelector
                                selectedToken={toToken}
                                tokens={borrowableAssets}
                                onSelect={setToToken}
                                disabled={isBusy}
                                getBorrowStatus={getBorrowStatus}
                                compact={true}
                            />
                        </div>
                    </div>
                </div>

                {/* Error Display */}
                {txError && (
                    <div className="bg-red-900/20 border border-red-500/50 p-3 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs text-red-300">{txError}</p>
                            </div>
                            <button onClick={clearTxError} className="text-red-400 hover:text-red-300">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* User Rejected */}
                {userRejected && (
                    <div className="bg-yellow-900/20 border border-yellow-500/50 p-3 rounded-lg text-center">
                        <p className="text-xs text-yellow-300">Transaction was rejected</p>
                    </div>
                )}

                {/* Action Button */}
                <button
                    onClick={handleSwap}
                    disabled={isBusy || !swapQuote || !fromToken || !toToken || swapAmount === BigInt(0)}
                    className="w-full bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {isBusy ? (
                        <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Processing...
                        </>
                    ) : (
                        <>
                            <ArrowRightLeft className="w-4 h-4" />
                            {needsApproval && !signedPermit ? 'Assinar e Trocar' : 'Confirmar Troca'}
                        </>
                    )}
                </button>

                {swapQuote && needsApproval && (
                    <button
                        onClick={handleApproveDelegation}
                        disabled={isBusy || !toToken}
                        className="w-full bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 font-bold py-2 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-orange-500/40"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        Aprovar onchain (fallback)
                    </button>
                )}

                {/* Logs */}
                {logs.length > 0 && (
                    <div className="bg-slate-800/30 rounded-lg p-2 space-y-1 max-h-24 overflow-y-auto text-xs">
                        {logs.map((log, idx) => (
                            <div key={idx} className={`text-${log.type === 'error' ? 'red' : log.type === 'success' ? 'green' : 'slate'}-400`}>
                                {log.message}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
};
