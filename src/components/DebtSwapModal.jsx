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
import { InfoTooltip } from './InfoTooltip.jsx';
import { useWeb3 } from '../context/web3Context.js';
import { useParaswapQuote } from '../hooks/useParaswapQuote.js';
import { useDebtSwitchActions } from '../hooks/useDebtSwitchActions.js';
import { useDebtPositions } from '../hooks/useDebtPositions.js';
import { useUserPosition } from '../hooks/useUserPosition.js';
import { getUserPosition } from '../services/api.js';

import logger, { getLogLevel } from '../utils/logger.js';
import { calcApprovalAmount } from '../utils/swapMath.js';
// Helper to get token logo URL from Aave CDN
const getTokenLogo = (symbol) => {
    if (!symbol) return null;

    const iconAliasMap = {
        'BTCB': 'btc',
    };

    const upperSymbol = symbol.toUpperCase();
    const mappedSymbol = iconAliasMap[upperSymbol] || symbol.toLowerCase();

    return `https://app.aave.com/icons/tokens/${mappedSymbol}.svg`;
};

// Format a numeric USD value to a compact string like "$1.21K" or "$1,234.56"
const formatUSD = (value) => {
    if (value == null || isNaN(value)) return null;
    if (value === 0) return '$0.00';
    if (value < 0.01) return '< $0.01';
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 10_000) return `$${(value / 1_000).toFixed(2)}K`;
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
                logger.warn('TokenSelector portal positioning error:', e);
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
                                        alt={selectedToken.symbol} // Fixed alt attribute closing
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
                            <div className="text-left min-w-0">
                                <span className="text-sm font-bold text-white block">{selectedToken?.symbol || 'Select'}</span>
                                <span className="text-[10px] text-slate-400 block truncate">{selectedToken?.variableBorrowRate != null ? `${(selectedToken.variableBorrowRate * 100).toFixed(2)}% APY` : (selectedToken?.name || '')}</span>
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
                            <div className="p-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
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
                                            <div className="text-xs text-slate-400 ml-2">{(token.variableBorrowRate ?? token.borrowRate) != null ? `${((token.variableBorrowRate ?? token.borrowRate) * 100).toFixed(2)}%` : '-'}</div>
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
const CompactAmountInputRow = ({ token, value, onChange, maxAmount, decimals, disabled, formattedDebt, onTokenSelect, usdValue }) => {
    const [pctPopoverOpen, setPctPopoverOpen] = useState(false);
    const pctBtnRef = useRef(null);
    const pctPopoverRef = useRef(null);

    // Format large numbers compactly: 1200 → "1.21K", 1500000 → "1.50M"
    const compactNumber = (str) => {
        const n = parseFloat(str);
        if (isNaN(n)) return str;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
        return Number(n.toFixed(4)).toString();
    };

    // Close popover when clicking outside
    useEffect(() => {
        if (!pctPopoverOpen) return;
        const handler = (e) => {
            if (
                pctBtnRef.current && !pctBtnRef.current.contains(e.target) &&
                pctPopoverRef.current && !pctPopoverRef.current.contains(e.target)
            ) {
                setPctPopoverOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [pctPopoverOpen]);

    const applyPct = (pct) => {
        if (!maxAmount || maxAmount === BigInt(0)) return;
        const calculatedAmount = (maxAmount * BigInt(pct)) / BigInt(100);
        onChange(ethers.formatUnits(calculatedAmount, decimals));
        setPctPopoverOpen(false);
    };

    const applyMax = () => {
        if (!maxAmount || maxAmount === BigInt(0)) return;
        onChange(ethers.formatUnits(maxAmount, decimals));
    };

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
                <button
                    type="button"
                    onClick={onTokenSelect}
                    disabled={disabled}
                    aria-haspopup="dialog"
                    className={`flex items-center gap-1.5 py-1 px-1 hover:opacity-75 transition-opacity ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {token?.symbol ? (
                        <img
                            src={getTokenLogo(token.symbol)}
                            alt={token.symbol}
                            className="w-6 h-6 rounded-full"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                    ) : (
                        <span className="text-xs font-bold text-slate-400">?</span>
                    )}
                    <span className="text-sm font-bold text-white">{token?.symbol || 'Select'}</span>
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                </button>
            </div>

            {/* Single bottom row: $USD left | Balance % MAX right */}
            <div className="flex items-center justify-between mt-1.5 pl-3">
                {/* USD value */}
                <span className="text-xs text-slate-500">{usdValue ?? ''}</span>

                {/* Balance + % popover + MAX */}
                <div className="flex items-center gap-2 text-xs text-slate-400 relative">
                    <span className="text-slate-500">Balance {compactNumber(formattedDebt) || '0'}</span>

                    {/* % button + popover */}
                    <div className="relative">
                        <button
                            ref={pctBtnRef}
                            type="button"
                            className="text-xs text-slate-400 hover:text-white bg-transparent border-none p-0 m-0 cursor-pointer"
                            onClick={() => setPctPopoverOpen((v) => !v)}
                        >
                            %
                        </button>

                        {pctPopoverOpen && (
                            <div
                                ref={pctPopoverRef}
                                className="absolute top-full mt-2 right-0 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-1.5 flex gap-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                            >
                                {[25, 50, 75].map((pct) => (
                                    <button
                                        key={pct}
                                        type="button"
                                        onClick={() => applyPct(pct)}
                                        className="px-3 py-1.5 text-xs font-bold rounded-md bg-slate-800 text-slate-300 hover:bg-purple-600 hover:text-white transition-colors"
                                    >
                                        {pct}%
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        className="text-xs font-bold text-slate-400 hover:text-white bg-transparent border-none p-0 m-0 cursor-pointer"
                        onClick={applyMax}
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
    marketAssets: providedMarketAssets = null,
    providedBorrows = null,
}) => {
    const { account, provider, selectedNetwork, networkRpcProvider } = useWeb3();

    // Use provided marketAssets as fallback if selectedNetwork isn't synced yet
    // In normal flow, selectedNetwork will be updated by Web3Provider's chainChanged handler
    const { marketAssets: fetchedMarketAssets, borrows, loading: positionsLoading, refresh: refreshPositions } = useUserPosition();
    const marketAssets = providedMarketAssets || fetchedMarketAssets;

    // Fallback: sometimes the hook instance for this modal doesn't yet have `borrows` cached
    const [fallbackBorrows, setFallbackBorrows] = useState(null);
    const [fallbackLoading, setFallbackLoading] = useState(false);

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
    const [invertRate, setInvertRate] = useState(false);
    // Preference: use permit (EIP-712 signature) by default — session only
    const [preferPermit, setPreferPermit] = useState(true);
    const [showMethodMenu, setShowMethodMenu] = useState(false);
    const methodMenuRef = useRef(null);
    // Track previous token addresses to detect actual token changes (not re-renders)
    const prevFromTokenAddrRef = useRef('');
    const prevToTokenAddrRef = useRef('');
    const [freezeQuote, setFreezeQuote] = useState(false);
    const slippageMenuRef = useRef(null);

    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [selectingForFrom, setSelectingForFrom] = useState(false);
    const [tokenModalSearch, setTokenModalSearch] = useState('');

    const addLog = useCallback((message, type = 'info') => {
        logger.debug(`[DebtSwapModal] ${type}: ${message}`);
    }, []);

    // Stable token-selector openers
    const openTokenSelectorForFrom = useCallback(() => {

        // Only refresh if parent did NOT provide borrows (avoid duplicate fetch when modal opened from PositionsAccordion)
        const hasProvidedBorrows = providedBorrows && providedBorrows.length > 0;

        // If no provided borrows and no cached borrows in hook, refresh shared hook
        if (!hasProvidedBorrows && (!borrows || borrows.length === 0) && !positionsLoading && typeof refreshPositions === 'function') {
            refreshPositions(true).catch((e) => logger.warn('[DebtSwapModal] refreshPositions failed', e));
        }

        // If still empty after a short delay and parent didn't provide borrows, fetch directly from backend as a fallback
        if (!hasProvidedBorrows && (!borrows || borrows.length === 0) && (!fallbackBorrows || fallbackBorrows.length === 0)) {
            if (account && selectedNetwork?.chainId) {
                setFallbackLoading(true);
                getUserPosition(account, selectedNetwork.chainId)
                    .then((pos) => {
                        setFallbackBorrows(pos?.borrows || []);
                    })
                    .catch((err) => logger.warn('[DebtSwapModal] fallback fetch failed', err))
                    .finally(() => setFallbackLoading(false));
            }
        }

        setSelectingForFrom(true);
        setTokenModalSearch('');
        setTokenSelectorOpen(true);
    }, [borrows, positionsLoading, marketAssets, refreshPositions, account, selectedNetwork, fallbackBorrows, setTokenModalSearch]);

    const openTokenSelectorForTo = useCallback(() => {
        setSelectingForFrom(false);
        setTokenModalSearch('');
        setTokenSelectorOpen(true);
    }, [setTokenModalSearch]);

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
            setFreezeQuote(false);
        }
    }, [isOpen, initialFromToken, initialToToken, marketAssets]);

    // Close modal strongly if the actual wallet address changes while open
    const prevAccountRef = useRef(account);
    useEffect(() => {
        if (isOpen && account && prevAccountRef.current && prevAccountRef.current !== account) {
            logger.debug('[DebtSwapModal] Wallet address changed while open. Closing modal to prevent desync.');
            onClose();
        }
        prevAccountRef.current = account;
    }, [account, isOpen, onClose]);

    // Ensure `toToken` is never the same as `fromToken`. If user changes `fromToken` to the
    // currently-selected `toToken`, clear `toToken` so we don't attempt an invalid quote.
    useEffect(() => {
        if (!fromToken) return;
        if (!toToken) return;
        const fromAddr = (fromToken.underlyingAsset || fromToken.address || '').toLowerCase();
        const toAddr = (toToken.underlyingAsset || toToken.address || '').toLowerCase();
        if (fromAddr && toAddr && fromAddr === toAddr) {
            setToToken(null);
        }
    }, [fromToken, toToken]);



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
        freezeQuote,
    });

    // When the user changes the source token: clear the input amount and quote.
    // The destination token is preserved UNLESS it's the same asset as the new fromToken
    // (which would be an invalid self-swap) — in that case auto-select the first available
    // borrowable token instead.
    // We use a ref to track the previous address so this only runs when the token
    // *actually* changes — not when function references like clearQuote/fetchDebtData
    // get new identities on re-render (which would reset toToken spuriously).
    useEffect(() => {
        if (!isOpen) return;
        const newAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
        if (newAddr === prevFromTokenAddrRef.current) return; // same token, skip
        prevFromTokenAddrRef.current = newAddr;

        setInputValue('');
        setSwapAmount(BigInt(0));
        clearQuote && clearQuote();

        // Check if the current toToken conflicts with the newly-selected fromToken.
        // Read toToken directly from the closure (not via functional updater) so that
        // marketAssets is also fresh and we can do the fallback lookup reliably.
        const currentToAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
        if (currentToAddr && newAddr && currentToAddr === newAddr) {
            prevToTokenAddrRef.current = ''; // reset ref so toToken effect fires on next selection
            // Auto-select the first borrowable token that isn't the new fromToken
            const fallback = (marketAssets || []).find((t) => {
                const tAddr = (t.underlyingAsset || t.address || '').toLowerCase();
                return tAddr && tAddr !== newAddr && t.isActive && !t.isFrozen && !t.isPaused && t.borrowingEnabled;
            }) || null;
            setToToken(fallback);
        }

        // Refresh on-chain debt data for the new fromToken so the MAX button is up-to-date.
        if (typeof fetchDebtData === 'function') {
            fetchDebtData().catch((e) => logger.warn('[DebtSwapModal] fetchDebtData failed on fromToken change', e));
        }
    }, [fromToken, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // When the destination token changes, clear the stale quote so the UI shows a
    // loading state while a fresh quote is fetched. Source amount is preserved so
    // the auto-quote can fire immediately with the existing input value.
    useEffect(() => {
        if (!isOpen) return;
        const newAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
        if (newAddr === prevToTokenAddrRef.current) return; // same token, skip
        prevToTokenAddrRef.current = newAddr;

        clearQuote && clearQuote();
    }, [toToken, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Actions hook
    const {
        isActionLoading,
        signedPermit,
        forceRequirePermit,
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
        networkRpcProvider,
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
        preferPermit,
        freezeQuote,
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

            // Buffer in basis points (bps) - received from backend's quote response
            const bufferBps = swapQuote.bufferBps || 50; // Fallback to 50 bps if not provided
            const maxNewDebt = calcApprovalAmount(srcAmountBigInt, bufferBps);
            return allowance < maxNewDebt;
        } catch (error) {
            logger.warn('[DebtSwapModal] Failed to compute needsApproval from quote:', error);
            return false;
        }
    }, [allowance, toToken, swapQuote]);
    const isBusy = isActionLoading || isDebtLoading;
    const displayBufferBps = swapQuote?.bufferBps ?? 13;
    const displayBufferPct = (displayBufferBps / 100).toFixed(2);
    const isDev = import.meta.env?.MODE === 'development';

    const modalTitle = useMemo(() => {
        if (fromToken && toToken) return `Swap ${fromToken.symbol} → ${toToken.symbol}`;
        if (fromToken) return `Swap ${fromToken.symbol} debt`;
        if (toToken) return `Swap to ${toToken.symbol}`;
        return 'Swap debt';
    }, [fromToken, toToken]);



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

                setSwapAmount(finalAmount);
            }
        } catch (error) {
            logger.warn('Invalid input:', value, error);
        }
    }, [fromToken?.decimals, debtBalance]);

    // Get borrow status for token
    const getBorrowStatus = useCallback((token) => {
        if (!token) return { borrowable: false, reasons: [] };

        let notBorrowable = false;
        const reasons = [];

        if (token.isFrozen) { reasons.push('Frozen'); notBorrowable = true; }
        if (token.isPaused) { reasons.push('Paused'); notBorrowable = true; }
        if (!token.isActive) { reasons.push('Inactive'); notBorrowable = true; }
        if (!token.borrowingEnabled) { reasons.push('Borrowing Disabled'); notBorrowable = true; }

        try {
            // Aave V3 borrowCap is typically in whole tokens. totalDebt is also in whole tokens from formattedReserves.
            if (token.borrowCap && token.borrowCap !== "0" && token.totalDebt) {
                const cap = parseFloat(token.borrowCap);
                const debt = parseFloat(token.totalDebt);

                // If debt is 99.5% of cap or greater, prevent borrowing
                if (cap > 0 && debt >= cap * 0.995) {
                    reasons.push('Borrow Cap Reached');
                    notBorrowable = true;
                }
            }

            // Liquidity check: availableLiquidity is in wei usually
            if (token.availableLiquidity) {
                const liquidity = BigInt(token.availableLiquidity);
                if (liquidity === 0n) {
                    reasons.push('No Liquidity');
                    notBorrowable = true;
                }
            }
        } catch (error) {
            logger.warn('Failed to parse liquidity or borrow cap for', token.symbol, error);
        }

        return { borrowable: !notBorrowable, reasons };
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

    // Close slippage popover when clicking outside
    useEffect(() => {
        if (!showSlippageSettings) return;
        const handleClickOutside = (e) => {
            if (slippageMenuRef.current && !slippageMenuRef.current.contains(e.target)) {
                setShowSlippageSettings(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showSlippageSettings]);

    // Filter tokens
    const borrowableAssets = useMemo(() => {
        if (!marketAssets) return [];
        return marketAssets.filter(asset => {
            const status = getBorrowStatus(asset);
            return status.borrowable;
        });
    }, [marketAssets, getBorrowStatus]);

    // Build a detailed list for borrowed tokens by merging borrow entries with market asset metadata
    const activeDebtAssets = useMemo(() => {
        // prefer borrows provided by parent (PositionsAccordion) so modal can show positions immediately
        const sourceBorrows = (providedBorrows && providedBorrows.length > 0)
            ? providedBorrows
            : (borrows && borrows.length > 0) ? borrows : (fallbackBorrows || []);
        if (!sourceBorrows || sourceBorrows.length === 0) return [];
        const chainMarket = marketAssets || [];
        return sourceBorrows
            .filter(b => b.amount && BigInt(b.amount) > BigInt(0))
            .map((b) => {
                const match = chainMarket.find(m => m.underlyingAsset?.toLowerCase() === b.underlyingAsset?.toLowerCase());
                return {
                    underlyingAsset: b.underlyingAsset,
                    symbol: b.symbol || match?.symbol,
                    name: match?.name || b.symbol || '',
                    decimals: b.decimals || match?.decimals || 18,
                    amount: b.amount,
                    formattedAmount: b.formattedAmount,
                    isActive: match?.isActive,
                    isFrozen: match?.isFrozen,
                    isPaused: match?.isPaused,
                    borrowingEnabled: match?.borrowingEnabled,
                    debtTokenAddress: b.debtTokenAddress,
                    // prefer market's variableBorrowRate (exact source used by backend), fallback to borrow entry
                    variableBorrowRate: (typeof match?.variableBorrowRate === 'number') ? match.variableBorrowRate : (b.borrowRate ?? 0),
                    borrowRate: b.borrowRate,
                };
            });
    }, [providedBorrows, borrows, marketAssets, fallbackBorrows]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="520px" headerBorder={false}>
            <div className="p-3 space-y-3">
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
                        title={`Slippage: ${(slippage / 100).toFixed(2)}%`}
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>

                {/* Slippage Settings Popover */}
                {showSlippageSettings && (
                    <div
                        ref={slippageMenuRef}
                        className="absolute top-16 right-4 bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-lg z-50 animate-in slide-in-from-top-2 duration-150 overflow-visible"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs text-slate-400 uppercase font-bold">Slippage Tolerance</label>
                            <span className="text-sm font-bold text-white">{(slippage / 100).toFixed(2)}%</span>
                        </div>
                        <div className="flex gap-2">
                            {[25, 50, 150, 500].map((val) => (
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
                                    {(val / 100).toFixed(2)}%
                                </button>
                            ))}
                        </div>
                        {isDev && (
                            <>
                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <label className="text-xs text-slate-400 uppercase font-bold">Freeze Quote</label>
                                    <button
                                        type="button"
                                        onClick={() => setFreezeQuote((prev) => !prev)}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${freezeQuote
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-slate-900 text-slate-400 hover:bg-slate-700'
                                            }`}
                                    >
                                        {freezeQuote ? 'On' : 'Off'}
                                    </button>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                    <label className="text-xs text-slate-400 uppercase font-bold">Buffer</label>
                                    <span className="text-sm font-bold text-white">{displayBufferPct}%</span>
                                </div>
                            </>
                        )}

                        {getLogLevel() === 'debug' && (
                            <div className="mt-3">
                                <label className="text-xs text-slate-400 uppercase font-bold">Developer</label>

                                <div className="mt-2 flex items-center gap-3">
                                    <InfoTooltip message="This will also attempt to ask your wallet to forget site permissions/signatures (may disconnect). If your wallet still auto-approves, remove the site from your wallet's Connected/Trusted sites.">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearCachedPermit();
                                                addLog?.('Cached permit signatures cleared', 'success');
                                                addLog?.('Next swap will request a fresh permit signature', 'info');
                                                logger.info('Cached permit signatures cleared via UI');
                                            }}
                                            className="px-3 py-1 text-xs font-bold rounded-md transition-all bg-slate-900 text-slate-400 hover:bg-slate-700"
                                        >
                                            Clear cached permits
                                        </button>
                                    </InfoTooltip>

                                    {forceRequirePermit && (
                                        <div className="text-xs text-amber-300 italic">Will require fresh signature (persisted)</div>
                                    )}
                                </div>
                            </div>
                        )}
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
                            onTokenSelect={openTokenSelectorForFrom}
                            usdValue={(() => {
                                const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                const marketToken = (marketAssets || []).find(m =>
                                    (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr
                                );
                                const price = parseFloat(marketToken?.priceInUSD ?? fromToken?.priceInUSD);
                                const amount = parseFloat(inputValue);
                                if (!isNaN(price) && price > 0 && !isNaN(amount) && amount > 0) {
                                    return formatUSD(amount * price);
                                }
                                return null;
                            })()}
                        />
                    </>
                )}

                {/* Auto Refresh Display */}
                {inputValue && (
                    <div className="flex justify-center">
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    fetchQuote();
                                    resetRefreshCountdown();
                                }}
                                className="text-slate-500 hover:text-slate-300 transition-colors"
                                title="Refresh quote"
                                aria-label="Refresh quote"
                                disabled={isQuoteLoading}
                            >
                                <RefreshCw className={`w-3 h-3 ${isQuoteLoading ? 'animate-spin' : ''}`} />
                            </button>
                            {isQuoteLoading || !swapQuote ? (
                                'Loading quote...'
                            ) : freezeQuote && isDev ? (
                                'Quote frozen'
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
                                                    // Show full precision (no rounding) using ethers.formatUnits
                                                    return ethers.formatUnits(swapQuote.srcAmount, toToken.decimals);
                                                } catch (e) {
                                                    return '...';
                                                }
                                            })()}
                                        </span>
                                        {/* token symbol removed here; compact selector shows logo+symbol at the end */}
                                    </div>
                                    {(() => {
                                        try {
                                            // priceInUSD may not be on the live toToken object;
                                            // look it up from marketAssets (same source used on the home page)
                                            const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                            const marketToken = (marketAssets || []).find(m =>
                                                (m.underlyingAsset || m.address || '').toLowerCase() === toAddr
                                            );
                                            const price = parseFloat(marketToken?.priceInUSD ?? toToken?.priceInUSD);
                                            const amount = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals));
                                            if (!isNaN(price) && price > 0 && !isNaN(amount) && amount > 0) {
                                                return <div className="text-xs text-slate-500 mt-0.5">{formatUSD(amount * price)}</div>;
                                            }
                                        } catch (e) { /* noop */ }
                                        return null;
                                    })()}
                                </div>
                            ) : (
                                <div className="text-slate-500 text-sm">
                                    {toToken ? 'Enter amount to get quote' : 'Select a token'}
                                </div>
                            )}
                        </div>

                        {/* Token Selector Button - Compact (moved to right) */}
                        <div className="shrink-0 ml-2">
                            <button
                                type="button"
                                onClick={(e) => { openTokenSelectorForTo(); }}
                                className="flex items-center gap-1.5 py-1 px-1 hover:opacity-75 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={isBusy}
                                aria-haspopup="dialog"
                            >
                                {toToken?.symbol ? (
                                    <img src={getTokenLogo(toToken.symbol)} alt={toToken.symbol} className="w-6 h-6 rounded-full" onError={(e) => e.target.style.display = 'none'} />
                                ) : (
                                    <span className="text-xs font-bold text-slate-400">?</span>
                                )}
                                <span className="text-sm font-bold text-white">{toToken?.symbol || 'Select'}</span>
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Exchange Rate Indicator */}
                {fromToken && toToken && fromToken.priceInUSD && toToken.priceInUSD && (
                    <div className="flex justify-center mt-2 px-1">
                        <button
                            type="button"
                            onClick={() => setInvertRate(!invertRate)}
                            className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-slate-300 transition-colors cursor-pointer group"
                            title="Invert rate"
                        >
                            <span>1 {invertRate ? toToken.symbol : fromToken.symbol}</span>
                            <ArrowRightLeft className="w-3 h-3 text-slate-500 group-hover:text-slate-400" />
                            <span>
                                {(() => {
                                    if (swapQuote && swapQuote.srcAmount && swapAmount && swapAmount > BigInt(0)) {
                                        try {
                                            const inputF = parseFloat(ethers.formatUnits(swapAmount, fromToken.decimals));
                                            const outputF = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals));
                                            if (inputF > 0 && outputF > 0) {
                                                if (invertRate) {
                                                    return (inputF / outputF).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + fromToken.symbol;
                                                } else {
                                                    return (outputF / inputF).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + toToken.symbol;
                                                }
                                            }
                                        } catch (e) {
                                            // Fall back to oracle
                                        }
                                    }
                                    return invertRate
                                        ? (parseFloat(toToken.priceInUSD) / parseFloat(fromToken.priceInUSD)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + fromToken.symbol
                                        : (parseFloat(fromToken.priceInUSD) / parseFloat(toToken.priceInUSD)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + toToken.symbol;
                                })()}
                            </span>
                        </button>
                    </div>
                )}

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

                {/* Method selector (always shown) */}
                <div ref={methodMenuRef} className="relative flex justify-end mb-4">
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-400 font-medium">Approve with</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowMethodMenu((s) => !s); }}
                            className="inline-flex items-center gap-1 text-[#2EBDE3] hover:text-[#21a8cc] font-bold transition-colors cursor-pointer"
                            aria-expanded={showMethodMenu}
                            aria-haspopup="menu"
                            title="Choose approval method"
                        >
                            <span>{preferPermit ? 'Signed message' : 'Transaction'}</span>
                            <Settings className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {showMethodMenu && (
                        <div className="absolute bottom-full mb-2 right-0 w-60 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2 z-[100]">
                            <button
                                onClick={() => { setPreferPermit(true); setShowMethodMenu(false); }}
                                className={`w-full text-left px-2 py-2 rounded-md hover:bg-slate-800 flex items-center justify-between ${preferPermit ? 'bg-slate-800/60' : ''}`}
                            >
                                <div>
                                    <div className="font-bold text-white text-sm">Signature (free)</div>
                                    <div className="text-xs text-slate-400">Faster and fee-free</div>
                                </div>
                                {preferPermit && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                            </button>
                            <button
                                onClick={() => { setPreferPermit(false); setShowMethodMenu(false); }}
                                className={`w-full text-left mt-1 px-2 py-2 rounded-md hover:bg-slate-800 flex items-center justify-between ${!preferPermit ? 'bg-slate-800/60' : ''}`}
                            >
                                <div>
                                    <div className="font-bold text-white text-sm">Transaction</div>
                                    <div className="text-xs text-slate-400">Send on‑chain approval</div>
                                </div>
                                {!preferPermit && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* Full-screen token selector modal (used for both `from` and `to`) */}
                {tokenSelectorOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
                        <div className="fixed inset-0 bg-black/40" onClick={() => { setTokenSelectorOpen(false); setSelectingForFrom(false); }} />
                        <div className="relative z-10 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
                            <div className="p-3 flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-white">{selectingForFrom ? 'Swap From' : 'Swap To'}</div>
                                    <div className="text-xs text-slate-400 mt-1">{selectingForFrom ? 'Choose a token to swap from your debt positions' : 'Choose a token to borrow/swap to'}</div>
                                </div>

                                <div className="ml-2 shrink-0 self-start">
                                    <button className="text-slate-400 p-1 rounded hover:bg-slate-800" aria-label="Close token selector" onClick={() => { setTokenSelectorOpen(false); setSelectingForFrom(false); setTokenModalSearch(''); }}>
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Search row - full width but padded */}
                            <div className="px-3 pb-2">
                                <div className="relative w-full">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Search token..."
                                        value={tokenModalSearch}
                                        onChange={(e) => setTokenModalSearch(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-purple-500"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                            </div>

                            <div className="p-2">
                                {selectingForFrom && positionsLoading ? (
                                    <div className="p-4 text-center text-slate-500 text-xs">Loading tokens...</div>
                                ) : (() => {
                                    let baseList = selectingForFrom ? activeDebtAssets : (borrowableAssets || []);

                                    // When selecting the `to` token, exclude the currently-selected `fromToken`
                                    // to prevent choosing the same asset as both source and destination.
                                    if (!selectingForFrom && fromToken) {
                                        const fromAddr = (fromToken.underlyingAsset || fromToken.address || '').toLowerCase();
                                        baseList = baseList.filter((t) => {
                                            const tAddr = (t.underlyingAsset || t.address || '').toLowerCase();
                                            return !fromAddr || !tAddr || fromAddr !== tAddr;
                                        });
                                    }

                                    const list = tokenModalSearch?.trim()
                                        ? baseList.filter(t => (t.symbol || '').toLowerCase().includes(tokenModalSearch.toLowerCase()) || (t.name || '').toLowerCase().includes(tokenModalSearch.toLowerCase()))
                                        : baseList;
                                    if (!list || list.length === 0) {
                                        return (
                                            <div className="p-4 text-center text-slate-500 text-xs space-y-2">
                                                <div>No tokens available</div>
                                                {selectingForFrom && !positionsLoading && (
                                                    <div className="flex items-center justify-center mt-2">
                                                        <button
                                                            className="text-xs px-3 py-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-750"
                                                            onClick={() => { if (typeof refreshPositions === 'function') { refreshPositions(true); } }}
                                                        >
                                                            Refresh positions
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }

                                    return list.map((token) => {
                                        const status = getBorrowStatus ? getBorrowStatus(token) : { borrowable: true };
                                        const disabled = !status.borrowable;
                                        return (
                                            <button
                                                key={token.underlyingAsset || token.address}
                                                disabled={disabled}
                                                onClick={() => {
                                                    if (selectingForFrom) setFromToken(token); else setToToken(token);
                                                    setSelectingForFrom(false);
                                                    setTokenSelectorOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-800'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <img src={getTokenLogo(token.symbol)} alt={token.symbol} className="w-6 h-6" onError={(e) => e.target.style.display = 'none'} />
                                                    <div className="flex-1">
                                                        <div className="font-bold text-white text-sm">{token.symbol}</div>
                                                        <div className="text-xs text-slate-400">{token.name}</div>
                                                    </div>
                                                    {!disabled && <div className="text-xs text-slate-400">{(token.variableBorrowRate ?? token.borrowRate) != null ? `${((token.variableBorrowRate ?? token.borrowRate) * 100).toFixed(2)}%` : '-'}</div>}
                                                </div>
                                            </button>
                                        );
                                    });
                                })()}
                            </div>
                        </div>
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
                            {(needsApproval && !signedPermit) || forceRequirePermit ? 'Sign & Swap' : 'Confirm Swap'}
                        </>
                    )}
                </button>

                {/* Logs - Hidden, all output to console */}
            </div>
        </Modal>
    );
};
