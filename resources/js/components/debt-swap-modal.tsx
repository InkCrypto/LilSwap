import { ethers } from 'ethers';
import {
    ArrowRightLeft,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    X,
    ChevronDown,
    ChevronUp,
    Settings,
    AlertCircle,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from './ui/button';


import { useWeb3 } from '@/contexts/web3-context';
import { useToast } from '../contexts/toast-context';
import { useDebtSwitchActions } from '../hooks/use-debt-switch-actions';
import { useParaswapQuote } from '../hooks/use-paraswap-quote';
import { useUserPosition } from '../hooks/use-user-position';
import { getDebtQuote } from '../services/api';

import { getPairStatus, checkPairSwappable } from '../services/token-pair-cache';
import { mapErrorToUserFriendly } from '../utils/error-mapping';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { CompactAmountInput } from './compact-amount-input';
import { InfoTooltip } from './info-tooltip';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';

// Helper for USD formatting
const formatUSD = (value: number | null | undefined) => {
    if (value == null || isNaN(value)) {
        return '$0.00';
    }

    if (value === 0) {
        return '$0.00';
    }

    if (value > 0 && value < 0.01) {
        return '< $0.01';
    }

    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(2)}M`;
    }

    if (value >= 1_000) {
        return `$${(value / 1_000).toFixed(2)}K`;
    }

    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface DebtSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialFromToken?: any | null;
    initialToToken?: any | null;
    providedBorrows?: any[] | null;
    marketAssets?: any[] | null;
    chainId?: number | null;
    donator?: any | null;
}

const MAX_PREVALIDATIONS_PER_OPEN = 8;

export const DebtSwapModal: React.FC<DebtSwapModalProps> = ({
    isOpen,
    onClose,
    initialFromToken = null,
    initialToToken = null,
    providedBorrows = null,
    marketAssets: externalMarketAssets = null,
}) => {
    const { account, provider, selectedNetwork, networkRpcProvider } = useWeb3();
    const { addToast } = useToast();
    const { marketAssets: fetchedMarketAssets, borrows, summary, refresh: refreshPositions } = useUserPosition();
    const localMarketAssets = useMemo(() => externalMarketAssets || fetchedMarketAssets || [], [externalMarketAssets, fetchedMarketAssets]);
    const effectiveNetwork = selectedNetwork;

    // Local State
    const [fromToken, setFromToken] = useState<any>(initialFromToken);
    const [toToken, setToToken] = useState<any>(initialToToken);
    const [swapAmount, setSwapAmount] = useState<bigint>(BigInt(0));
    const [inputValue, setInputValue] = useState('');
    const [showSlippageSettings, setShowSlippageSettings] = useState(false);
    const [slippageInputValue, setSlippageInputValue] = useState('');
    const [invertRate, setInvertRate] = useState(false);
    const [showTransactionOverview, setShowTransactionOverview] = useState(false);
    const [preferPermit, setPreferPermit] = useState(true);
    const [freezeQuote, setFreezeQuote] = useState(false);
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [selectingForFrom, setSelectingForFrom] = useState(false);
    const [swappableTokens, setSwappableTokens] = useState<Record<string, { swappable: boolean | null; checking: boolean }>>({});
    const [showMethodMenu, setShowMethodMenu] = useState(false);
    const [isPairValidationRunning, setIsPairValidationRunning] = useState(false);

    // Refs
    const methodMenuRef = useRef<HTMLDivElement>(null);
    const prevFromTokenAddrRef = useRef('');
    const validatingPairsRef = useRef<Set<string>>(new Set());
    const prevalidationBudgetRef = useRef(0);
    const lastToastErrorRef = useRef<string | null>(null);

    // --- Actions ---

    // Borrow and Swap logic hooks initialization
    const {
        swapQuote,
        slippage,
        setSlippage,
        isAutoSlippage,
        setIsAutoSlippage,
        recommendedSlippage,
        isQuoteLoading,
        nextRefreshIn,
        fetchQuote,
        clearQuote,
        resetRefreshCountdown,
        quoteError,
        clearQuoteError,
        errorCountdown,
        priceImpact,
    } = useParaswapQuote({
        debtAmount: swapAmount,
        isCollateral: false,
        fromToken,
        toToken,
        selectedNetwork: effectiveNetwork,
        account,
        enabled: isOpen,
        freezeQuote,
    });

    const {
        isActionLoading,
        isSigning,
        signedPermit,
        forceRequirePermit,
        txError,
        userRejected,
        handleSwap,
        clearTxError,
        clearUserRejected,
    } = useDebtSwitchActions({
        account,
        provider,
        networkRpcProvider,
        fromToken,
        toToken,
        allowance: BigInt(0), // Debt swap usually handles its own allowance/permit checks
        swapQuote,
        slippage,
        fetchDebtData: refreshPositions,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        clearQuoteError,
        selectedNetwork: effectiveNetwork,
        preferPermit,
        freezeQuote,
        onTxSent: () => {
            addToast({
                message: 'Transaction submitted!',
                type: 'success',
            });
            onClose();
        }
    });

    // --- Helpers ---

    const getBorrowStatus = useCallback((token: any) => {
        if (!token) {
            return { borrowable: false, reasons: [] };
        }

        const reasons = [];
        let canBorrow = true;

        if (token.isFrozen) {
            reasons.push('Frozen'); canBorrow = false;
        }

        if (token.isPaused) {
            reasons.push('Paused'); canBorrow = false;
        }

        if (!token.isActive) {
            reasons.push('Inactive'); canBorrow = false;
        }

        if (token.borrowingEnabled === false) {
            reasons.push('Borrowing Disabled'); canBorrow = false;
        }

        return { borrowable: canBorrow, reasons };
    }, []);

    const getDisplaySymbol = useCallback((token: any, allTokens: any[]) => {
        if (!token) return '';

        const addr = (token.address || token.underlyingAsset || '').toLowerCase();

        // Arbitrum Specifics - Explicitly disambiguate USDC
        if (addr === '0xaf88d065e77c8cc2239327c5edb3a432268e5831') return 'USDC';
        if (addr === '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8') return 'USDC.e';

        const hasCollision = allTokens.some(t =>
            t.symbol === token.symbol &&
            (t.address || t.underlyingAsset || '').toLowerCase() !== (token.address || token.underlyingAsset || '').toLowerCase()
        );

        if (hasCollision) {
            const name = (token.name || '').toLowerCase();
            const symbol = (token.symbol || '').toLowerCase();

            // Aave-style: .e for bridged/pos, plain for native
            // We look for common bridged keywords or patterns
            const isBridged = name.includes('bridged') ||
                name.includes('(pos)') ||
                name.includes('(e)') ||
                name.includes('polygon') ||
                symbol.endsWith('.e');

            if (isBridged) {
                // Return SYMBOL.e (removing any existing .e to avoid .e.e)
                const baseSymbol = token.symbol.replace(/\.e$/i, '');
                return `${baseSymbol}.e`;
            }
        }

        return token.symbol;
    }, []);

    const validatePairSwappability = useCallback(async (destToken: any) => {
        if (!fromToken || !destToken || !effectiveNetwork?.chainId) {
            return;
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const destAddr = (destToken.address || destToken.underlyingAsset || '').toLowerCase();

        if (fromAddr === destAddr) {
            return;
        }

        // Check cache
        const cacheStatus = getPairStatus(fromAddr, destAddr, effectiveNetwork.chainId);

        if (cacheStatus !== null) {
            return;
        }

        if (validatingPairsRef.current.has(destAddr)) {
            return;
        }

        validatingPairsRef.current.add(destAddr);

        setSwappableTokens(prev => ({ ...prev, [destAddr]: { swappable: null, checking: true } }));

        try {
            const apyPercent = typeof fromToken?.variableBorrowRate === 'number'
                ? fromToken.variableBorrowRate * 100
                : (typeof fromToken?.borrowRate === 'number' ? fromToken.borrowRate * 100 : null);

            const isSwappable = await checkPairSwappable(
                fromToken,
                destToken,
                effectiveNetwork.chainId,
                getDebtQuote,
                {
                    adapterAddress: account,
                    walletAddress: account,
                    chainId: effectiveNetwork.chainId,
                    apyPercent,
                    amountField: 'destAmount',
                    amount: '1',
                }
            );
            setSwappableTokens(prev => ({ ...prev, [destAddr]: { swappable: isSwappable, checking: false } }));
        } catch {
            setSwappableTokens(prev => ({ ...prev, [destAddr]: { swappable: false, checking: false } }));
        } finally {
            validatingPairsRef.current.delete(destAddr);
        }
    }, [fromToken, effectiveNetwork?.chainId, account]);

    const getSwappableStatus = useCallback((destToken: any) => {
        if (!fromToken || !destToken) {
            return { swappable: false, checking: false };
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const destAddr = (destToken.address || destToken.underlyingAsset || '').toLowerCase();

        if (!fromAddr || !destAddr || fromAddr === destAddr) {
            return { swappable: false, checking: false };
        }

        const cacheStatus = getPairStatus(fromAddr, destAddr, effectiveNetwork?.chainId);

        if (cacheStatus !== null) {
            return { swappable: cacheStatus.swappable, checking: false };
        }

        const localStatus = swappableTokens[destAddr];

        if (localStatus?.checking) {
            return { swappable: null, checking: true };
        }

        return { swappable: null, checking: false };
    }, [fromToken, effectiveNetwork?.chainId, swappableTokens]);

    // --- Effects ---

    useEffect(() => {
        if (isOpen) {
            if (initialFromToken) {
                setFromToken(initialFromToken);
            }

            // Handle pre-selection of toToken
            if (initialToToken) {
                setToToken(initialToToken);
            } else if (localMarketAssets && localMarketAssets.length > 0) {
                // Pick a default (e.g. USDT or USDC)
                const fromAddr = (initialFromToken?.address || initialFromToken?.underlyingAsset || '').toLowerCase();
                const defaultTo = localMarketAssets.find(m => {
                    const addr = (m.address || m.underlyingAsset || '').toLowerCase();

                    if (addr === fromAddr) {
                        return false;
                    }

                    return m.symbol === 'USDT' || m.symbol === 'USDC';
                }) || localMarketAssets.find(m => (m.address || m.underlyingAsset || '').toLowerCase() !== fromAddr);

                if (defaultTo) {
                    setToToken(defaultTo);
                }
            }
        }
    }, [isOpen, initialFromToken, initialToToken, localMarketAssets]);

    // Reset pair validation state when fromToken changes
    const fromTokenAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();

    useEffect(() => {
        setSwappableTokens({});
        validatingPairsRef.current.clear();
    }, [fromTokenAddr]);

    // Handle token changes
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const newAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();

        if (newAddr === prevFromTokenAddrRef.current) {
            return;
        }

        prevFromTokenAddrRef.current = newAddr;

        setInputValue('');
        setSwapAmount(BigInt(0));
        clearQuote();
    }, [fromToken, isOpen, clearQuote]);

    const modalTitle = useMemo(() => {
        const fromSym = getDisplaySymbol(fromToken, localMarketAssets);
        const toSym = getDisplaySymbol(toToken, localMarketAssets);

        if (fromToken && toToken) {
            return `Debt Swap: ${fromSym} → ${toSym}`;
        }

        if (fromToken) {
            return `Debt Swap: ${fromSym}`;
        }

        return 'Debt Swap';
    }, [fromToken, toToken, localMarketAssets, getDisplaySymbol]);
    useEffect(() => {
        if (!isOpen) {
            setInputValue('');
            setSwapAmount(BigInt(0));
            setShowSlippageSettings(false);
            setFreezeQuote(false);
            setShowMethodMenu(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isActionLoading !== freezeQuote) {
            setFreezeQuote(isActionLoading);
        }
    }, [isActionLoading, freezeQuote]);

    useEffect(() => {
        if (quoteError && isOpen) {
            const friendly = mapErrorToUserFriendly(quoteError.message);
            addToast({
                message: `Unable to quote swap: ${friendly || 'This token pair may not be available'}`,
                type: 'error',
                duration: 5000,
            });
        }
    }, [quoteError, isOpen, addToast]);

    useEffect(() => {
        if (!isOpen) {
            lastToastErrorRef.current = null;
            return;
        }

        if (userRejected) {
            if (lastToastErrorRef.current !== 'userRejected') {
                addToast({
                    message: 'Transaction rejected in wallet.',
                    type: 'info',
                    duration: 3500,
                });
                lastToastErrorRef.current = 'userRejected';
            }
            return;
        }

        if (txError) {
            const friendly = mapErrorToUserFriendly(txError) || 'Swap failed. Please try again.';
            const errorKey = `tx:${friendly}`;
            if (lastToastErrorRef.current !== errorKey) {
                addToast({
                    message: friendly,
                    type: 'error',
                    duration: 5000,
                });
                lastToastErrorRef.current = errorKey;
            }
            return;
        }

        lastToastErrorRef.current = null;
    }, [isOpen, txError, userRejected, addToast]);

    useEffect(() => {
        if (!showSlippageSettings) {
            return;
        }

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const isMenuClick = slippageMenuRef.current && slippageMenuRef.current.contains(target);
            const isButtonClick = target.closest('[data-slippage-toggle]');

            if (!isMenuClick && !isButtonClick) {
                setShowSlippageSettings(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showSlippageSettings]);

    useEffect(() => {
        if (!showMethodMenu) {
            return;
        }

        const onClickOutside = (e: MouseEvent) => {
            if (methodMenuRef.current && !methodMenuRef.current.contains(e.target as Node)) {
                setShowMethodMenu(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);

        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [showMethodMenu]);

    const nextPairValidationToken = useMemo(() => {
        if (!isOpen || !tokenSelectorOpen || selectingForFrom || !fromToken) {
            return null;
        }

        if (prevalidationBudgetRef.current <= 0) {
            return null;
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();

        return localMarketAssets.find((token) => {
            const destAddr = (token.address || token.underlyingAsset || '').toLowerCase();

            if (!destAddr || !fromAddr || destAddr === fromAddr) {
                return false;
            }

            if (getPairStatus(fromAddr, destAddr, effectiveNetwork?.chainId) !== null) {
                return false;
            }

            if (validatingPairsRef.current.has(destAddr)) {
                return false;
            }

            if (swappableTokens[destAddr]?.checking) {
                return false;
            }

            return true;
        }) || null;
    }, [isOpen, tokenSelectorOpen, selectingForFrom, fromToken, localMarketAssets, effectiveNetwork?.chainId, swappableTokens]);

    useEffect(() => {
        if (tokenSelectorOpen && !selectingForFrom && fromToken) {
            prevalidationBudgetRef.current = MAX_PREVALIDATIONS_PER_OPEN;

            return;
        }

        prevalidationBudgetRef.current = 0;
    }, [tokenSelectorOpen, selectingForFrom, fromToken]);

    useEffect(() => {
        if (!nextPairValidationToken || isPairValidationRunning) {
            return;
        }

        let active = true;
        prevalidationBudgetRef.current = Math.max(0, prevalidationBudgetRef.current - 1);
        setIsPairValidationRunning(true);

        void (async () => {
            try {
                await validatePairSwappability(nextPairValidationToken);
            } finally {
                if (active) {
                    setIsPairValidationRunning(false);
                }
            }
        })();

        return () => {
            active = false;
        };
    }, [nextPairValidationToken, validatePairSwappability, isPairValidationRunning]);

    useEffect(() => {
        if (txError || userRejected) {
            clearTxError();
            clearUserRejected();
        }
    }, [fromToken, toToken, inputValue, txError, userRejected, clearTxError, clearUserRejected]);


    // --- Computed Values ---

    const activeDebtAssets = useMemo(() => {
        const sourceBorrows = providedBorrows || borrows || [];

        return sourceBorrows
            .filter(b => b.amount && BigInt(b.amount) > BigInt(0))
            .map(b => {
                const match = (localMarketAssets || []).find(m => m.underlyingAsset?.toLowerCase() === b.underlyingAsset?.toLowerCase());

                return { ...b, ...match };
            });
    }, [providedBorrows, borrows, localMarketAssets]);

    const debtBalance = useMemo(() => {
        if (!fromToken) {
            return BigInt(0);
        }

        const addr = (fromToken.underlyingAsset || fromToken.address || '').toLowerCase();
        const borrow = activeDebtAssets.find(b => (b.underlyingAsset || '').toLowerCase() === addr);

        return borrow ? BigInt(borrow.amount) : BigInt(0);
    }, [fromToken, activeDebtAssets]);

    const formattedDebt = useMemo(() => {
        if (!fromToken) {
            return '0';
        }

        const addr = (fromToken.underlyingAsset || fromToken.address || '').toLowerCase();
        const borrow = activeDebtAssets.find(b => (b.underlyingAsset || '').toLowerCase() === addr);

        return borrow?.formattedAmount || '0';
    }, [fromToken, activeDebtAssets]);

    const isBusy = isActionLoading;

    // --- Render Helpers ---

    const renderTokenStatus = (token: any) => {
        const reasons = [];
        let disabled = false;

        const tokenAddr = (token.address || token.underlyingAsset || '').toLowerCase();

        const borrowStatus = getBorrowStatus(token);
        reasons.push(...borrowStatus.reasons);

        if (!borrowStatus.borrowable) {
            disabled = true;
        }

        // Block selecting the same token
        if (selectingForFrom) {
            if (toToken && (toToken.address || toToken.underlyingAsset || '').toLowerCase() === tokenAddr) {
                disabled = true;
                reasons.push('Already selected as destination');
            }
        } else { // selecting for toToken
            if (fromToken && (fromToken.address || fromToken.underlyingAsset || '').toLowerCase() === tokenAddr) {
                disabled = true;
                reasons.push('Source token');
            }
        }

        const swappableStatus = getSwappableStatus(token);

        if (!selectingForFrom && swappableStatus.swappable === false && !swappableStatus.checking) {
            disabled = true;
            reasons.push('Swap unavailable');
        } else if (!selectingForFrom && swappableStatus.checking) {
            reasons.push('Checking availability...');
        }

        return { disabled, reasons };
    };

    const selectorTokens = selectingForFrom
        ? (borrows || [])
        : (localMarketAssets || []);

    const oppositeToken = selectingForFrom ? toToken : fromToken;
    const filteredSelectorTokens = oppositeToken
        ? selectorTokens.filter((t) => {
            const oppositeAddr = (oppositeToken.address || oppositeToken.underlyingAsset || '').toLowerCase();
            return (t.address || t.underlyingAsset || '').toLowerCase() !== oppositeAddr;
        })
        : selectorTokens;
    const slippageMenuRef = useRef<HTMLDivElement>(null);


    return (
        <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} headerBorder={false}>
            <div className="p-3 space-y-2">
                {/* Slippage Settings Toggle & Label */}
                <div className="flex justify-end items-center mb-2 relative">
                    <div className={`flex items-center gap-1.5 transition-all ${!swapQuote ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                            {isAutoSlippage ? 'Auto Slippage' : 'Slippage'}
                        </span>
                        <button
                            data-slippage-toggle="true"
                            onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                            disabled={!swapQuote}
                            className={`inline-flex items-center gap-1 text-[11px] font-bold transition-colors ${showSlippageSettings
                                ? 'text-primary'
                                : 'text-slate-900 dark:text-white hover:text-primary dark:hover:text-primary'
                                }`}
                        >
                            <span>{(slippage / 100).toFixed(2)}%</span>
                            <Settings className="w-3 h-3" />
                        </button>
                    </div>

                    {/* Slippage Settings Popover */}
                    {showSlippageSettings && (
                        <div
                            ref={slippageMenuRef}
                            className="absolute top-full mt-2 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-2xl shadow-2xl z-50 w-52"
                        >
                            <div className="flex items-center justify-between mb-2.5 px-0.5">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Max slippage</span>
                            </div>

                            <div className="p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsAutoSlippage(true);
                                            setSlippageInputValue('');
                                            if (recommendedSlippage > 0) {
                                                setSlippage(recommendedSlippage);
                                            }
                                        }}
                                        className={`h-7 px-2.5 inline-flex items-center justify-center text-[10px] font-bold rounded-lg transition-all whitespace-nowrap tabular-nums ${isAutoSlippage
                                            ? 'bg-linear-to-r from-[#8b5cf6] via-[#8b5cf6] via-30% to-[#3b82f6] text-white shadow-sm'
                                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-700 dark:hover:text-slate-200'
                                            }`}
                                    >
                                        Auto {recommendedSlippage > 0 ? `(${(recommendedSlippage / 100).toFixed(2)}%)` : ''}
                                    </button>

                                    <div className="relative h-7 w-20 shrink-0">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="Custom"
                                            value={isAutoSlippage ? '' : slippageInputValue}
                                            onChange={(e) => {
                                                const normalized = normalizeDecimalInput(e.target.value);
                                                setSlippageInputValue(normalized);

                                                if (normalized === '') {
                                                    setIsAutoSlippage(true);
                                                } else {
                                                    setIsAutoSlippage(false);
                                                    const numericVal = parseFloat(normalized);

                                                    if (!isNaN(numericVal)) {
                                                        const bps = Math.max(0, Math.min(5000, Math.floor(numericVal * 100)));
                                                        setSlippage(bps);
                                                    }
                                                }
                                            }}
                                            onPaste={(e) => {
                                                const pastedText = e.clipboardData?.getData('text') || '';
                                                e.preventDefault();

                                                const normalized = normalizeDecimalInput(pastedText);
                                                setSlippageInputValue(normalized);

                                                if (normalized === '') {
                                                    setIsAutoSlippage(true);
                                                } else {
                                                    setIsAutoSlippage(false);
                                                    const numericVal = parseFloat(normalized);

                                                    if (!isNaN(numericVal)) {
                                                        const bps = Math.max(0, Math.min(5000, Math.floor(numericVal * 100)));
                                                        setSlippage(bps);
                                                    }
                                                }
                                            }}
                                            className="h-7 w-full bg-white dark:bg-slate-900 border-none rounded-lg px-1.5 pr-4 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none placeholder:text-slate-400"
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-bold">%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* From Token Input */}
                <CompactAmountInput
                    token={fromToken}
                    value={inputValue}
                    onChange={(val) => {
                        const normalized = normalizeDecimalInput(val);
                        setInputValue(normalized);

                        try {
                            if (!normalized) {
                                setSwapAmount(BigInt(0));
                            } else {
                                const parsable = normalized.endsWith('.') ? `${normalized.slice(0, -1) || '0'}` : normalized;
                                const parsed = ethers.parseUnits(parsable, fromToken?.decimals || 18);
                                const capped = parsed > debtBalance ? debtBalance : parsed;
                                setSwapAmount(capped);
                            }
                        } catch {
                            // Ignore invalid partial decimal input while typing.
                        }
                    }}
                    maxAmount={debtBalance}
                    decimals={fromToken?.decimals || 18}
                    formattedBalance={formattedDebt}
                    disabled={isBusy}
                    onTokenSelect={() => {
                        setSelectingForFrom(true);
                        setTokenSelectorOpen(true);
                    }}
                    usdValue={fromToken && inputValue ? formatUSD(parseFloat(inputValue) * parseFloat(fromToken.priceInUSD || '0')) : null}
                    displaySymbol={fromToken ? getDisplaySymbol(fromToken, localMarketAssets) : undefined}
                />

                {/* Quote Indicator */}
                <div className="flex justify-center min-h-4 items-center">
                    {inputValue ? (
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    fetchQuote();
                                    resetRefreshCountdown();
                                }}
                                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                title="Refresh quote"
                                disabled={isQuoteLoading}
                            >
                                <RefreshCw className={`w-3 h-3 ${isQuoteLoading ? 'animate-spin' : ''}`} />
                            </button>
                            {isQuoteLoading || !swapQuote ? (
                                'Loading quote...'
                            ) : (
                                `Auto refresh in ${nextRefreshIn}s`
                            )}
                        </div>
                    ) : (
                        <div className="text-xs text-slate-500/50 flex items-center h-full">
                            Waiting for amount...
                        </div>
                    )}
                </div>

                {/* To Token Row (Selector + Quote Result) */}
                <div className="bg-slate-100 dark:bg-slate-800 border border-border-light dark:border-slate-700 rounded-xl p-1 px-2.5">
                    {/* Top Row: Amount & Token Selector */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex-1 relative overflow-hidden pl-1.5">
                            {isQuoteLoading ? (
                                <div className="flex items-center gap-2 text-purple-400 py-0.5">
                                    <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                                    <span className="text-sm font-medium">Loading quote...</span>
                                </div>
                            ) : swapQuote && toToken && fromToken ? (
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <span className="text-2xl font-mono font-bold text-slate-900 dark:text-white block py-0.5 truncate leading-none overflow-hidden text-ellipsis whitespace-nowrap">
                                        {ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18)}
                                    </span>
                                </div>
                            ) : (
                                <div className="text-slate-500 text-sm py-1.5 min-h-7 flex items-center">
                                    {toToken ? 'Enter amount to get quote' : 'Select a token'}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setSelectingForFrom(false);
                                setTokenSelectorOpen(true);
                            }}
                            className="flex items-center gap-1.5 py-1 px-1 hover:opacity-75 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            disabled={isActionLoading}
                        >
                            {toToken?.symbol ? (
                                <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-border-light dark:border-slate-600/30">
                                    <img
                                        src={getTokenLogo(toToken.symbol)}
                                        alt={toToken.symbol}
                                        className="w-full h-full object-cover"
                                        onError={onTokenImgError(toToken.symbol)}
                                    />
                                </div>
                            ) : (
                                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center border border-dashed border-slate-300 dark:border-slate-600">
                                    <span className="text-[10px] font-bold text-slate-400">?</span>
                                </div>
                            )}
                            <span className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                                {toToken ? getDisplaySymbol(toToken, localMarketAssets) : 'Select'}
                            </span>
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                        </button>
                    </div>

                    {/* Bottom Row: USD Value */}
                    <div className="flex items-center justify-between mt-0 pl-1.5">
                        <div className="text-xs text-slate-500 block min-h-4">
                            {swapQuote && toToken && (
                                <span>
                                    {(() => {
                                        const amount = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));

                                        return `~ ${formatUSD(amount * parseFloat(toToken.priceInUSD || '0'))}`;
                                    })()}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Exchange Rate Indicator */}
                {fromToken && toToken && fromToken.priceInUSD && toToken.priceInUSD && (
                    <div className="flex flex-col items-center mt-1 space-y-2">
                        <button
                            type="button"
                            onClick={() => setInvertRate(!invertRate)}
                            className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer group"
                            title="Invert rate"
                        >
                            <span>1 {invertRate ? getDisplaySymbol(toToken, localMarketAssets) : getDisplaySymbol(fromToken, localMarketAssets)}</span>
                            <ArrowRightLeft className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400" />
                            <span>
                                {(() => {
                                    if (swapQuote && swapAmount > BigInt(0)) {
                                        const inputF = parseFloat(ethers.formatUnits(swapAmount, fromToken.decimals || 18));
                                        const outputF = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));

                                        if (inputF > 0 && outputF > 0) {
                                            if (invertRate) {
                                                return (inputF / outputF).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(fromToken, localMarketAssets);
                                            } else {
                                                return (outputF / inputF).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(toToken, localMarketAssets);
                                            }
                                        }
                                    }

                                    return invertRate
                                        ? (parseFloat(toToken.priceInUSD) / parseFloat(fromToken.priceInUSD)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(fromToken, localMarketAssets)
                                        : (parseFloat(fromToken.priceInUSD) / parseFloat(toToken.priceInUSD)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(toToken, localMarketAssets);
                                })()}
                            </span>
                        </button>
                    </div>
                )}

                {/* Quote Error Display */}
                {quoteError && (
                    <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 p-3 rounded-lg relative overflow-hidden transition-all animate-in fade-in slide-in-from-top-2 duration-300">
                        <button
                            onClick={clearQuoteError}
                            className="absolute top-1.5 right-1.5 p-1 text-amber-600/50 hover:text-amber-800 dark:text-amber-400/50 dark:hover:text-amber-200 transition-colors"
                            title="Clear error"
                        >
                            <X size={14} />
                        </button>

                        <div className="flex items-start gap-3 text-xs pr-4">
                            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-amber-900 dark:text-amber-100 font-medium leading-snug">
                                    {mapErrorToUserFriendly(quoteError.message) || 'This token pair may not have sufficient liquidity'}
                                </p>

                                <div className="mt-2.5 flex items-center justify-between gap-4">
                                    <button
                                        onClick={() => fetchQuote()}
                                        className="text-[11px] font-bold px-2.5 py-1 bg-amber-600 text-white dark:bg-amber-500 rounded-md hover:bg-amber-700 dark:hover:bg-amber-600 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                                        disabled={isQuoteLoading}
                                    >
                                        {isQuoteLoading ? 'Retrying...' : 'Try Again'}
                                    </button>

                                    {errorCountdown > 0 && (
                                        <div className="flex items-center gap-2 flex-1 max-w-25">
                                            <div className="flex-1 h-1 bg-amber-200 dark:bg-amber-900/40 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                                                    style={{ width: `${(errorCountdown / 15) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400 font-bold">
                                                {errorCountdown}s
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}


                {/* Transaction Overview */}
                {swapQuote && fromToken && toToken && (
                    <div className="mt-1 mb-1">
                        <div className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-0.5 px-1">Transaction overview</div>
                        <div className="transition-all">
                            {/* Costs & Fees Collapsible Header */}
                            <button
                                onClick={() => setShowTransactionOverview(!showTransactionOverview)}
                                className="w-full flex items-center justify-between px-1 py-1 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-[13px] text-slate-600 dark:text-slate-300">Costs & Fees</span>
                                    {swapQuote?.discountPercent > 0 && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold whitespace-nowrap">
                                            Discount Applied
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                                    <span className="font-medium">
                                        {(() => {
                                            let totalUsd = 0;

                                            if (swapQuote?.priceRoute?.gasCostUSD) {
                                                totalUsd += parseFloat(swapQuote.priceRoute.gasCostUSD);
                                            }

                                            // Add platform fee estimate from backend quote (already discount-aware)
                                            if (swapQuote) {
                                                const feeBps = swapQuote?.feeBps || 0;
                                                const amount = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
                                                totalUsd += amount * (feeBps / 10000) * parseFloat(toToken.priceInUSD || '0');
                                            }

                                            return formatUSD(totalUsd);
                                        })()}
                                    </span>
                                    {showTransactionOverview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                            </button>

                            {showTransactionOverview && (
                                <div className="relative ml-4 pl-4 pr-3 pb-1 pt-2 space-y-3 text-xs border-l border-dashed border-slate-300 dark:border-slate-700/50">
                                    {/* Network Costs */}
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <span>Network costs</span>
                                            <InfoTooltip content="Estimated network gas cost." size={12} />
                                        </div>
                                        <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                            <span>{formatUSD(parseFloat(swapQuote.priceRoute.gasCostUSD || '0'))}</span>
                                        </div>
                                    </div>
                                    {/* Platform Fee */}
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <span>
                                                {(() => {
                                                    const feeBpsRaw = swapQuote?.feeBps;
                                                    const feeBps = Number(feeBpsRaw);
                                                    if (!Number.isFinite(feeBps)) {
                                                        return 'Service Fee (--)';
                                                    }

                                                    return `Service Fee (${(feeBps / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%)`;
                                                })()}
                                            </span>
                                            {swapQuote?.discountPercent > 0 && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                                                    {swapQuote.discountPercent}% OFF
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                            <div className="w-3.5 h-3.5 rounded-full overflow-hidden">
                                                <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                                            </div>
                                            <span>
                                                {(() => {
                                                    const feeBpsRaw = swapQuote?.feeBps;
                                                    const feeBps = Number(feeBpsRaw);
                                                    if (!Number.isFinite(feeBps)) {
                                                        return '--';
                                                    }

                                                    if (feeBps === 0) {
                                                        return 'Free';
                                                    }

                                                    const amount = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
                                                    const fee = amount * (feeBps / 10000);

                                                    return fee < 0.00001 ? '< 0.00001' : fee.toLocaleString(undefined, { maximumFractionDigits: 6 });
                                                })()}
                                            </span>
                                        </div>
                                    </div>
                                    {/* Savings (if any) */}
                                    {swapQuote?.priceRoute?.maxRebateUSD && parseFloat(swapQuote.priceRoute.maxRebateUSD) > 0 && (
                                        <div className="flex justify-between items-center group">
                                            <span className="text-slate-500 font-medium">Flashloan Savings</span>
                                            <div className="flex items-center gap-1 font-medium text-emerald-500">
                                                <span>{formatUSD(parseFloat(swapQuote.priceRoute.maxRebateUSD))}</span>
                                            </div>
                                        </div>
                                    )}
                                    {/* Borrow APY Change */}
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <span>Borrow APY</span>
                                            <InfoTooltip content="Interest rate on your debt." size={12} />
                                        </div>
                                        <div className="font-bold flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                            <span className="text-slate-400 line-through">
                                                {((fromToken?.variableBorrowRate || 0) * 100).toFixed(2)}%
                                            </span>
                                            <span className="text-emerald-500">
                                                {((toToken?.variableBorrowRate || 0) * 100).toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Persistent Rows Below Fees */}
                            <div className="px-1 pb-1 pt-1 space-y-2">
                                {/* Health Factor Row */}
                                <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span>Health factor</span>
                                        <InfoTooltip content="Liquidation < 1.0. Safety of your collateral against borrowed assets." size={12} />
                                    </div>
                                    <div className="text-right font-medium">
                                        {(() => {
                                            if (!summary) {
                                                return <span>-</span>;
                                            }

                                            const currentHf = parseFloat(summary.healthFactor);

                                            if (isNaN(currentHf)) {
                                                return <span>-</span>;
                                            }

                                            const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                            const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
                                            const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;

                                            let simulatedHf = currentHf;

                                            if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount) {
                                                try {
                                                    const reducedDebtAmountF = parseFloat(ethers.formatUnits(swapQuote.destAmount, fromToken.decimals || 18));
                                                    const newDebtAmountF = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));

                                                    const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                                    const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
                                                    const fromPrice = parseFloat(fromMarketToken?.priceInUSD ?? fromToken?.priceInUSD) || 0;

                                                    const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                                    const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                                                    const toPrice = parseFloat(toMarketToken?.priceInUSD ?? toToken?.priceInUSD) || 0;

                                                    if (fromPrice > 0 && toPrice > 0) {
                                                        const repaidDebtUsd = reducedDebtAmountF * fromPrice;
                                                        const newDebtUsd = newDebtAmountF * toPrice;

                                                        const newTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);

                                                        if (newTotalBorrowsUSD > 0) {
                                                            simulatedHf = (currentTotalCollateralUSD * currentLiquidationThreshold) / newTotalBorrowsUSD;
                                                        } else {
                                                            simulatedHf = -1;
                                                        }
                                                    }
                                                } catch {
                                                    // Keep preview resilient if interim quote math fails.
                                                }
                                            }

                                            const getHfColor = (hf: number) => {
                                                if (hf === -1 || hf >= 3) {
                                                    return 'text-emerald-500';
                                                }

                                                if (hf >= 1.1) {
                                                    return 'text-orange-500';
                                                }

                                                return 'text-red-500';
                                            };

                                            const formatHf = (hf: number) => hf === -1 ? <span className="text-lg leading-none">∞</span> : hf.toFixed(2);

                                            return (
                                                <div className="flex flex-col items-end">
                                                    <div className="flex items-center gap-1.5 font-bold">
                                                        <span className={getHfColor(currentHf)}>{formatHf(currentHf)}</span>
                                                        <span className="text-slate-400 font-normal">→</span>
                                                        <span className={getHfColor(simulatedHf)}>{formatHf(simulatedHf)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Borrow APY Row */}
                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span>Borrow apy</span>
                                        <InfoTooltip content="Annual interest on borrowed assets." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        {(() => {
                                            const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                            const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
                                            const currentApy = (fromMarketToken?.variableBorrowRate ?? 0) * 100;

                                            const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                            const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                                            const newApy = (toMarketToken?.variableBorrowRate ?? 0) * 100;

                                            return (
                                                <>
                                                    <span className="text-slate-900 dark:text-slate-100">{currentApy < 0.01 ? '< 0.01' : currentApy.toFixed(2)}%</span>
                                                    <span className="text-slate-400 font-normal">→</span>
                                                    <span className="text-slate-900 dark:text-slate-100">{newApy < 0.01 ? '< 0.01' : newApy.toFixed(2)}%</span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Borrow Balance Row */}
                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium pb-1">
                                    <div className="flex items-center gap-1.5">
                                        <span>Borrow balance after switch</span>
                                        <InfoTooltip content="Estimated debt balance after swap." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        {(() => {
                                            const activeBorrows = providedBorrows || borrows || [];

                                            // Handle From Token (remaining debt)
                                            let fromRemaining = 0;

                                            try {
                                                const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                                const existingFromBorrow = activeBorrows.find(b => (b.underlyingAsset || '').toLowerCase() === fromAddr);
                                                const existingFromBalance = existingFromBorrow ? parseFloat(existingFromBorrow.formattedAmount || '0') : 0;
                                                const repaidAmount = parseFloat(ethers.formatUnits(swapQuote.destAmount || "0", fromToken.decimals || 18));
                                                fromRemaining = Math.max(0, existingFromBalance - repaidAmount);
                                            } catch {
                                                // Ignore malformed balances from upstream data.
                                            }

                                            // Handle To Token (new debt)
                                            let toTotal = 0;

                                            try {
                                                const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                                const existingToBorrow = activeBorrows.find(b => (b.underlyingAsset || '').toLowerCase() === toAddr);
                                                const existingToBalance = existingToBorrow ? parseFloat(existingToBorrow.formattedAmount || '0') : 0;

                                                // Calculate to balance
                                                toTotal = existingToBalance;

                                                if (swapQuote) {
                                                    const newDebt = parseFloat(ethers.formatUnits(swapQuote.srcAmount || "0", toToken.decimals || 18));
                                                    toTotal = existingToBalance + newDebt;
                                                }
                                            } catch {
                                                // Ignore malformed balances from upstream data.
                                            }

                                            return (
                                                <>
                                                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                                            <img src={getTokenLogo(fromToken.symbol)} className="w-full h-full object-cover" />
                                                        </div>
                                                        <span>{fromRemaining === 0 ? '0' : (fromRemaining >= 1000 ? (fromRemaining / 1000).toFixed(2) + 'K' : fromRemaining.toLocaleString(undefined, { maximumFractionDigits: 6 }))}</span>
                                                    </div>
                                                    <span className="text-slate-400 font-normal">→</span>
                                                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                                            <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                                                        </div>
                                                        <span>{toTotal === 0 ? '0' : (toTotal >= 1000 ? (toTotal / 1000).toFixed(2) + 'K' : toTotal.toLocaleString(undefined, { maximumFractionDigits: 6 }))}</span>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Approval Method Section */}
                {fromToken && toToken && (
                    <div ref={methodMenuRef} className="relative flex items-center justify-end gap-2 pb-1 px-1">
                        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Approve with</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMethodMenu((s) => !s);
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold text-sky-500 hover:text-sky-600 transition-colors cursor-pointer"
                        >
                            <span>{preferPermit ? 'Signed message' : 'Transaction'}</span>
                            <Settings className="w-4 h-4" />
                        </button>

                        {showMethodMenu && (
                            <div className="absolute bottom-full mb-2 right-0 w-56 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-lg shadow-2xl p-2 z-100">
                                <button
                                    onClick={() => {
                                        setPreferPermit(true);
                                        setShowMethodMenu(false);
                                    }}
                                    className={`w-full text-left px-2 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between ${preferPermit ? 'bg-slate-50 dark:bg-slate-800/60' : ''}`}
                                >
                                    <div>
                                        <div className="font-bold text-slate-900 dark:text-white text-sm">Signature (free)</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">Faster and fee-free</div>
                                    </div>
                                    {preferPermit && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                                </button>
                                <button
                                    onClick={() => {
                                        setPreferPermit(false);
                                        setShowMethodMenu(false);
                                    }}
                                    className={`w-full text-left mt-1 px-2 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between ${!preferPermit ? 'bg-slate-50 dark:bg-slate-800/60' : ''}`}
                                >
                                    <div>
                                        <div className="font-bold text-slate-900 dark:text-white text-sm">Transaction</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">Send on-chain approval</div>
                                    </div>
                                    {!preferPermit && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Safety Alerts & Validation */}
                {swapQuote && fromToken && toToken && (
                    <div className="space-y-2 mt-2">
                        {/* High Price Impact Alert */}
                        {priceImpact > 0.05 && (
                            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-red-800 dark:text-red-300 font-bold">High Price Impact: {(priceImpact * 100).toFixed(2)}%</p>
                                    <p className="text-[10px] text-red-600 dark:text-red-400">You may lose significant value during this swap.</p>
                                </div>
                            </div>
                        )}

                        {/* Liquidation Risk Alert */}
                        {(() => {
                            if (!summary) {
                                return null;
                            }

                            const currentHf = parseFloat(summary.healthFactor);

                            // Simple simulation logic again for the alert
                            let simulatedHf = currentHf;

                            if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount) {
                                try {
                                    const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                    const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
                                    const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;
                                    const reducedDebtAmountF = parseFloat(ethers.formatUnits(swapQuote.destAmount, fromToken.decimals || 18));
                                    const newDebtAmountF = parseFloat(ethers.formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
                                    const fromPrice = parseFloat(fromToken.priceInUSD) || 0;
                                    const toPrice = parseFloat(toToken.priceInUSD) || 0;

                                    if (fromPrice > 0 && toPrice > 0) {
                                        const repaidDebtUsd = reducedDebtAmountF * fromPrice;
                                        const newDebtUsd = newDebtAmountF * toPrice;
                                        const newTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);

                                        if (newTotalBorrowsUSD > 0) {
                                            simulatedHf = (currentTotalCollateralUSD * currentLiquidationThreshold) / newTotalBorrowsUSD;
                                        }
                                    }
                                } catch {
                                    // Alert simulation should never break rendering.
                                }
                            }

                            if (simulatedHf < 1.05 && simulatedHf !== -1) {
                                return (
                                    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-red-800 dark:text-red-300 font-bold">Liquidation Risk</p>
                                            <p className="text-[10px] text-red-600 dark:text-red-400">This swap would bring your Health Factor too close to 1.00.</p>
                                        </div>
                                    </div>
                                );
                            }

                            return null;
                        })()}
                    </div>
                )}

                {/* Transaction Error */}
                {(txError || userRejected) && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-red-800 dark:text-red-300 font-medium">
                                {userRejected ? 'Transaction rejected in wallet' : mapErrorToUserFriendly(txError)}
                            </p>
                        </div>
                        <button onClick={userRejected ? clearUserRejected : clearTxError} className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50 rounded transition-colors">
                            <X className="w-3.5 h-3.5 text-red-400" />
                        </button>
                    </div>
                )}

                {/* Action Button */}
                <Button
                    disabled={isBusy || !swapQuote || swapAmount === BigInt(0)}
                    onClick={handleSwap}
                    className="w-full py-3 h-auto font-bold rounded-xl mt-2"
                >
                    {isActionLoading ? (
                        <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            {isSigning ? 'Signing in wallet...' : 'Processing...'}
                        </>
                    ) : (
                        <>
                            <ArrowRightLeft className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                            {preferPermit && (forceRequirePermit || !signedPermit) ? 'Sign & Swap' : 'Confirm Swap'}
                        </>
                    )}
                </Button>
            </div>

            {/* Token Selector Modal */}
            {tokenSelectorOpen && (
                <TokenSelector
                    isOpen={tokenSelectorOpen}
                    onClose={() => setTokenSelectorOpen(false)}
                    title={selectingForFrom ? 'Swap From' : 'Swap To'}
                    description={selectingForFrom ? 'Choose a token to swap from your debt positions' : 'Choose a token to swap into'}
                    tokens={filteredSelectorTokens}
                    onSelect={(token) => {
                        if (selectingForFrom) {
                            setFromToken(token);
                        } else {
                            setToToken(token);
                        }
                    }}
                    renderStatus={renderTokenStatus}
                    hideOverlay={true}
                    marketAssets={localMarketAssets}
                />
            )}
        </Modal>
    );
};
