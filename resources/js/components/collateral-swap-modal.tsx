import clsx from 'clsx';
import { formatUnits, parseUnits } from 'viem';
import {
    ArrowRightLeft,
    RefreshCw,
    X,
    ChevronDown,
    ChevronUp,
    Settings,
    AlertTriangle,
    AlertCircle,
    CheckCircle2,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';


import { useWeb3 } from '@/contexts/web3-context';
import { useToast } from '../contexts/toast-context';
import { useCollateralPositions } from '../hooks/use-collateral-positions';
import { useCollateralSwapActions } from '../hooks/use-collateral-swap-actions';
import { useParaswapQuote } from '../hooks/use-paraswap-quote';
import { useUserPosition } from '../hooks/use-user-position';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { getCollateralQuote } from '../services/api';

import { getPairStatus, checkPairSwappable } from '../services/token-pair-cache';
import { mapErrorToUserFriendly } from '../utils/error-mapping';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import logger from '../utils/logger';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { getAddress, parseAbi } from 'viem';
import { usePublicClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { useApprovalState } from '../hooks/use-approval-state';
import { saveTokenSelection, getSavedTokenSelection } from '../utils/token-selection-memory';
import { ADDRESSES, getAddressesByKey } from '../constants/addresses';
import { MARKETS, DEFAULT_MARKET } from '../constants/networks';
import { CompactAmountInput } from './compact-amount-input';
import { InfoTooltip } from './info-tooltip';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';
import { formatUSD, formatCompactToken, getDisplaySymbol, formatAPY, formatHF, formatCompactNumber } from '../utils/formatters';



interface CollateralSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialFromToken?: any | null;
    initialToToken?: any | null;
    providedSupplies?: any[] | null;
    marketAssets?: any[] | null;
    chainId?: number | null;
    marketKey?: string | null;
    donator?: any | null;
}

const MAX_PREVALIDATIONS_PER_OPEN = 8;

export const CollateralSwapModal: React.FC<CollateralSwapModalProps> = ({
    isOpen,
    onClose,
    initialFromToken = null,
    initialToToken = null,
    providedSupplies = null,
    marketAssets: externalMarketAssets = null,
    marketKey: initialMarketKey = null,
    donator = null,
}) => {
    const { account, selectedNetwork } = useWeb3();
    const { addToast } = useToast();
    const { marketAssets: fetchedMarketAssets, supplies, borrows, summary, refresh: refreshGlobalPosition } = useUserPosition(initialMarketKey || '');
    const { addTransaction, setSheetOpen } = useTransactionTracker();
    const localMarketAssets = useMemo(() => externalMarketAssets || fetchedMarketAssets || [], [externalMarketAssets, fetchedMarketAssets]);

    // Local State
    const [fromToken, setFromToken] = useState<any>(initialFromToken);
    const [toToken, setToToken] = useState<any>(initialToToken);
    const [preferPermit, setPreferPermit] = useState(true);

    const modalLog = useCallback((msg: string, type?: string) => {
        logger.debug(`[CollateralSwapModal] ${msg}`, { type });
    }, []);

    const {
        supplyBalance: localBalance,
        fetchPositionData: refreshPositions,
    } = useCollateralPositions({
        account,
        fromToken,
        addLog: modalLog,
        selectedNetwork
    });
    const [swapAmount, setSwapAmount] = useState<bigint>(BigInt(0));
    const [inputValue, setInputValue] = useState('');
    const [showSlippageSettings, setShowSlippageSettings] = useState(false);
    const [showTransactionOverview, setShowTransactionOverview] = useState(false);
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [selectingForFrom, setSelectingForFrom] = useState(false);
    const [swappableTokens, setSwappableTokens] = useState<Record<string, { swappable: boolean | null; checking: boolean }>>({});
    const [invertRate, setInvertRate] = useState(false);
    const [slippageInputValue, setSlippageInputValue] = useState('');
    const [freezeQuote, setFreezeQuote] = useState(false);
    const [showMethodMenu, setShowMethodMenu] = useState(false);
    const [isPairValidationRunning, setIsPairValidationRunning] = useState(false);
    const [isUSDMode, setIsUSDMode] = useState(false);

    const slippageMenuRef = useRef<HTMLDivElement>(null);
    const methodMenuRef = useRef<HTMLDivElement>(null);
    const validatingPairsRef = useRef<Set<string>>(new Set());
    const prevalidationBudgetRef = useRef(0);
    const lastToastErrorRef = useRef<string | null>(null);

    // Derived values needed for hooks
    const adapterAddress = useMemo(() => {
        const market = MARKETS[selectedNetwork?.key as keyof typeof MARKETS] || DEFAULT_MARKET;
        return market.addresses.SWAP_COLLATERAL_ADAPTER;
    }, [selectedNetwork]);

    // Hooks
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
        sellAmount: swapAmount,
        isCollateral: true,
        fromToken,
        toToken,
        selectedNetwork,
        marketKey: initialMarketKey || selectedNetwork?.key,
        account,
        enabled: isOpen,
        freezeQuote,
        marketAssets: localMarketAssets,
        adapterAddress,
    });
    const [aTokenAddress, setATokenAddress] = useState<string | null>(null);
    const publicClient = usePublicClient();

    // Resolve aTokenAddress for the fromToken
    useEffect(() => {
        let isMounted = true;

        async function fetchATokenAddress() {
            if (!isOpen || !fromToken || !selectedNetwork || !publicClient) {
                setATokenAddress(null);
                return;
            }

            const directATokenAddress = fromToken.aTokenAddress || null;
            if (directATokenAddress) {
                setATokenAddress(directATokenAddress);
                return;
            }

            try {
                const clientChainId = await publicClient.getChainId();
                if (clientChainId !== selectedNetwork.chainId) {
                    return;
                }

                const market = MARKETS[selectedNetwork.key as keyof typeof MARKETS] || DEFAULT_MARKET;
                const dataProviderAddr = market.addresses.DATA_PROVIDER;
                if (!dataProviderAddr) return;

                const data = await publicClient.readContract({
                    address: getAddress(dataProviderAddr),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(fromToken.underlyingAsset || fromToken.address || '')],
                }) as any;

                if (isMounted && data && (data.aTokenAddress || data[0])) {
                    setATokenAddress(data.aTokenAddress || data[0]);
                }
            } catch (err: any) {
                logger.debug('[CollateralSwapModal] aTokenAddress unavailable for selected token/network (non-fatal).');
            }
        }

        fetchATokenAddress();
        return () => { isMounted = false; };
    }, [fromToken, isOpen, selectedNetwork, publicClient]);

    const activeSupplies = useMemo(() => {
        const sourceSupplies = providedSupplies && providedSupplies.length > 0 ? providedSupplies : (supplies || []);

        return sourceSupplies.filter((p: any) => p.amount && BigInt(p.amount) > BigInt(0));
    }, [providedSupplies, supplies]);

    const availableBalance = useMemo(() => {
        if (!fromToken) {
            return BigInt(0);
        }

        const pos = activeSupplies.find((p: any) => (p.address || p.underlyingAsset)?.toLowerCase() === (fromToken.address || fromToken.underlyingAsset)?.toLowerCase());

        return pos ? BigInt((pos as any).amount || (pos as any).balance || 0) : BigInt(0);
    }, [fromToken, activeSupplies]);

    const formattedBalance = useMemo(() => {
        if (!fromToken) {
            return '0';
        }

        const pos = activeSupplies.find((p: any) => (p.address || p.underlyingAsset)?.toLowerCase() === (fromToken.address || fromToken.underlyingAsset)?.toLowerCase());

        return (pos as any)?.formattedAmount || (pos as any)?.formattedBalance || '0';
    }, [fromToken, activeSupplies]);
    const isInsufficientBalance = swapAmount > (availableBalance || 0n);

    // Use Approval Hook for Collateral (aToken)
    const {
        onChainAllowance,
        nonce: preFetchedNonce,
        tokenName: preFetchedTokenName,
        saveSignature,
        cachedSignature,
        isApproved,
    } = useApprovalState({
        account,
        tokenAddress: isOpen ? aTokenAddress : null,
        spenderAddress: isOpen ? adapterAddress : null,
        amountRequired: swapAmount,
        isDebt: false,
        chainId: selectedNetwork.chainId,
        enabled: isOpen,
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
    } = useCollateralSwapActions({
        account,
        fromToken,
        toToken,
        allowance: onChainAllowance,
        swapAmount,
        supplyBalance: localBalance,
        swapQuote,
        slippage,
        addLog: modalLog,
        fetchPositionData: refreshPositions,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        clearQuoteError,
        selectedNetwork,
        preferPermit,
        adapterAddress,
        aTokenAddress,
        preFetchedNonce,
        preFetchedTokenName,
        onSignatureCached: saveSignature,
        cachedPermit: cachedSignature,
        marketKey: initialMarketKey || selectedNetwork?.key,
        onTxSent: (hash: string) => {
            const amountDisplay = inputValue ? `${inputValue} ${fromToken.symbol}` : '';

            addTransaction({
                hash,
                chainId: selectedNetwork?.chainId || 1,
                marketKey: initialMarketKey || selectedNetwork?.key,
                description: `Collateral Swap`,
                fromTokenSymbol: fromToken.symbol,
                toTokenSymbol: toToken.symbol
            });

            onClose();
        }
    });

    // --- Helpers ---

    const handleToggleUSDMode = useCallback(() => {
        if (!fromToken) {
            setIsUSDMode(!isUSDMode);
            return;
        }
        const price = parseFloat(fromToken.priceInUSD || '0');
        if (price <= 0 || !inputValue) {
            setIsUSDMode(!isUSDMode);
            return;
        }
        if (isUSDMode) {
            const usdAmount = parseFloat(inputValue);
            const tokenAmount = usdAmount / price;
            setInputValue(tokenAmount.toFixed(tokenAmount < 0.0001 ? 8 : 6).replace(/\.?0+$/, ''));
        } else {
            const tokenAmount = parseFloat(inputValue);
            setInputValue((tokenAmount * price).toFixed(2));
        }
        setIsUSDMode(!isUSDMode);
    }, [isUSDMode, inputValue, fromToken]);

    const fromSecondaryValue = useMemo(() => {
        if (!fromToken) return null;
        if (isUSDMode) {
            if (swapAmount === BigInt(0)) return `0 ${fromToken.symbol}`;
            try {
                const tokenAmount = formatUnits(swapAmount, fromToken.decimals || 18);
                return formatCompactToken(tokenAmount, fromToken.symbol);
            } catch { return null; }
        } else {
            if (swapQuote?.priceRoute?.srcUSD) return formatUSD(parseFloat(swapQuote.priceRoute.srcUSD));
            const rawPrice = parseFloat(fromToken.priceInUSD || '0');
            const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
            return formatUSD(parseFloat(inputValue || '0') * price);
        }
    }, [isUSDMode, fromToken, swapAmount, swapQuote, inputValue]);

    const toSecondaryValue = useMemo(() => {
        if (!toToken) return null;

        const rawPrice = parseFloat(toToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;

        if (isUSDMode) {
            // In USD mode, show Token units
            if (swapQuote?.destAmount) {
                try {
                    const tokenAmount = formatUnits(swapQuote.destAmount, toToken.decimals || 18);
                    return formatCompactToken(tokenAmount, toToken.symbol);
                } catch { return null; }
            }
            return `0 ${toToken.symbol}`;
        } else {
            // In Token mode, show USD value
            if (swapQuote?.priceRoute?.destUSD) return formatUSD(parseFloat(swapQuote.priceRoute.destUSD));
            if (swapQuote?.destAmount) {
                try {
                    const tokenAmount = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));
                    return formatUSD(tokenAmount * price);
                } catch { return null; }
            }
        }
        return null;
    }, [toToken, swapQuote, isUSDMode]);

    const renderTokenStatus = (token: any) => {
        const reasons = [];
        let disabled = false;
        let amount = undefined;
        let amountUSD = undefined;

        const tokenAddr = (token.address || token.underlyingAsset || '').toLowerCase();

        // For 'Swap From': show the supply position balance, hide 'Inactive' for active positions
        if (selectingForFrom) {
            const supplyPos = activeSupplies.find(p => (p.address || p.underlyingAsset || '').toLowerCase() === tokenAddr);
            if (supplyPos) {
                amount = formatCompactNumber(supplyPos.formattedAmount || supplyPos.formattedBalance || '0');

                // Calculate USD value for the second line
                const usdValue = parseFloat(supplyPos.formattedAmount || supplyPos.formattedBalance || '0') * parseFloat(supplyPos.priceInUSD || '0');
                if (usdValue > 0) {
                    amountUSD = formatUSD(usdValue);
                }
            } else {
                // Not a position the user holds — apply standard checks
                if (token.isFrozen) { reasons.push('Frozen'); disabled = true; }
                if (token.isPaused) { reasons.push('Paused'); disabled = true; }
                if (token.isActive === false) { reasons.push('Inactive'); disabled = true; }
            }
        } else {
            if (token.isFrozen) { reasons.push('Frozen'); disabled = true; }
            if (token.isPaused) { reasons.push('Paused'); disabled = true; }
            if (token.isActive === false) { reasons.push('Inactive'); disabled = true; }
        }

        // Block selecting the same token (only for destination selector)
        if (!selectingForFrom && fromToken && (fromToken.address || fromToken.underlyingAsset || '').toLowerCase() === tokenAddr) {
            disabled = true;
            reasons.push('Source token');
        }

        return {
            disabled,
            reasons,
            amount,
            amountUSD
        };
    };

    const selectorTokens = selectingForFrom
        ? activeSupplies
        : (localMarketAssets || []);

    const oppositeToken = selectingForFrom ? toToken : fromToken;
    const filteredSelectorTokens = useMemo(() => {
        let list = selectorTokens;

        if (oppositeToken && !selectingForFrom) {
            const oppositeAddr = (oppositeToken.address || oppositeToken.underlyingAsset || '').toLowerCase();
            list = list.filter((t) => (t.address || t.underlyingAsset || '').toLowerCase() !== oppositeAddr);
        }

        // Filter destination tokens: any asset that can be used as collateral destination
        // (backend pre-computes this: active, not paused/frozen, usageAsCollateralEnabled)
        if (!selectingForFrom) {
            list = list.filter((t) => {
                const addr = (t.address || t.underlyingAsset || '').toLowerCase();
                const m = (localMarketAssets || []).find(ma => (ma.address || ma.underlyingAsset || '').toLowerCase() === addr);
                if (!m) return false;
                return m.canBeCollateralSwapDestination === true;
            });
        }

        return list;
    }, [selectorTokens, oppositeToken, selectingForFrom, summary?.eModeCategoryId, localMarketAssets]);

    const blockingZeroLtvAssets = useMemo(() => {
        const suppliesToUse = activeSupplies || [];
        const marketsToUse = localMarketAssets || [];

        if (suppliesToUse.length === 0 || marketsToUse.length === 0) return [];

        return suppliesToUse
            .filter(s => {
                const hasPositiveSupply = parseFloat(s.formattedAmount || '0') > 0 || parseFloat(s.amount || '0') > 0;
                return s.usageAsCollateralEnabledOnUser && hasPositiveSupply;
            })
            .map(s => {
                const supplyAddress = (s.underlyingAsset || s.address || '').toLowerCase();
                if (!supplyAddress) return null;

                const asset = marketsToUse.find(m => {
                    const marketAddress = (m.underlyingAsset || m.address || '').toLowerCase();
                    return marketAddress === supplyAddress;
                });
                return asset ? { ...s, ...asset } : s;
            })
            .filter(Boolean)
            .filter(asset => {
                const ltv = parseFloat(asset.baseLTVasCollateral);
                return Number.isFinite(ltv) && ltv === 0;
            })
            .map(asset => getDisplaySymbol(asset, marketsToUse));
    }, [activeSupplies, localMarketAssets]);

    const isBlockedByZeroLtv = blockingZeroLtvAssets.length > 0;

    const validatePairSwappability = useCallback(async (destToken: any) => {
        if (!fromToken || !destToken || !selectedNetwork) {
            return;
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const destAddr = (destToken.address || destToken.underlyingAsset || '').toLowerCase();

        if (!fromAddr || !destAddr || fromAddr === destAddr) {
            return;
        }

        const marketKey = initialMarketKey || selectedNetwork?.key || '';
        const cached = getPairStatus(fromAddr, destAddr, marketKey);

        if (cached !== null) {
            return;
        }

        if (validatingPairsRef.current.has(destAddr)) {
            return;
        }

        validatingPairsRef.current.add(destAddr);

        setSwappableTokens((prev) => ({ ...prev, [destAddr]: { swappable: null, checking: true } }));

        try {
            const marketKey = initialMarketKey || selectedNetwork?.key || '';
            const isSwappable = await checkPairSwappable(
                fromToken,
                destToken,
                marketKey,
                getCollateralQuote,
                {
                    adapterAddress: account,
                    walletAddress: account,
                    marketKey,
                    amountField: 'srcAmount',
                    amount: '1',
                }
            );

            setSwappableTokens((prev) => ({ ...prev, [destAddr]: { swappable: isSwappable, checking: false } }));
        } catch {
            setSwappableTokens((prev) => ({ ...prev, [destAddr]: { swappable: false, checking: false } }));
        } finally {
            validatingPairsRef.current.delete(destAddr);
        }
    }, [fromToken, selectedNetwork?.chainId, account]);

    const getSwappableStatus = useCallback((destToken: any) => {
        if (!fromToken || !destToken) {
            return { swappable: false, checking: false };
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const destAddr = (destToken.address || destToken.underlyingAsset || '').toLowerCase();

        if (!fromAddr || !destAddr || fromAddr === destAddr) {
            return { swappable: false, checking: false };
        }

        const marketKey = initialMarketKey || selectedNetwork?.key || '';
        const cacheStatus = getPairStatus(fromAddr, destAddr, marketKey);

        if (cacheStatus !== null) {
            return { swappable: cacheStatus.swappable, checking: false };
        }

        const localStatus = swappableTokens[destAddr];

        if (localStatus?.checking) {
            return { swappable: null, checking: true };
        }

        return { swappable: null, checking: false };
    }, [fromToken, selectedNetwork, swappableTokens, initialMarketKey]);

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
                const fromAddr = (initialFromToken?.address || initialFromToken?.underlyingAsset || '').toLowerCase();

                const isGoodDefault = (token: any) => {
                    const addr = (token.address || token.underlyingAsset || '').toLowerCase();
                    if (addr === fromAddr) return false;

                    // Backend pre-computes valid collateral destinations (including E-Mode rules, freezing, pause)
                    return token.canBeCollateralSwapDestination === true;
                };

                // 1. Try saved selection for this market
                const marketKey = initialMarketKey || selectedNetwork?.key || '';
                const savedAddr = getSavedTokenSelection(marketKey, 'collateral');
                const savedMatch = savedAddr ? localMarketAssets.find(m => (m.address || m.underlyingAsset || '').toLowerCase() === savedAddr) : null;

                if (savedMatch && isGoodDefault(savedMatch)) {
                    setToToken(savedMatch);
                } else {
                    // 2. Pick the FIRST eligible token from the list (no stable preference)
                    const defaultTo = localMarketAssets.find(isGoodDefault);

                    if (defaultTo) {
                        setToToken(defaultTo);
                    }
                }
            }
        }
    }, [isOpen, initialFromToken, initialToToken, localMarketAssets]);

    useEffect(() => {
        if (isOpen && toToken && selectedNetwork) {
            const marketKey = initialMarketKey || selectedNetwork?.key || '';
            const addr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();
            if (addr) {
                saveTokenSelection(marketKey, 'collateral', addr);
            }
        }
    }, [toToken, isOpen, selectedNetwork, initialMarketKey]);

    // Reset pair validation state when fromToken changes

    // Reset when modal closes
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

    const simulationStatus = useMemo(() => {
        if (!swapQuote || !fromToken || !toToken || !summary) {
            return { simulatedHf: -1, isEmodeRestricted: false, currentTotalBorrowsUSD: 0 };
        }

        let simulatedHf = -1;
        const currentHfRaw = parseFloat(summary.healthFactor);
        const currentHf = (isNaN(currentHfRaw) || currentHfRaw > 100) ? -1 : currentHfRaw;
        const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
        const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
        const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;

        const toAddr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();
        const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
        const userEmodeCategoryId = summary?.eModeCategoryId || 0;

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);

        // E-Mode boost: use eModeCategoryId (borrowable bitmap) as primary signal,
        // with eModeCollateralCategories as fallback. AaveV3Ethereum has all-zero collateralBitmap
        // for E-Mode 2 but eModeCategoryId correctly identifies assets in the category.
        const isFromAssetEmode = userEmodeCategoryId !== 0 && (
            fromMarketToken?.eModeCategoryId === userEmodeCategoryId ||
            ((fromMarketToken?.eModeCollateralCategories || []) as number[]).includes(userEmodeCategoryId)
        );

        const isToAssetEmode = userEmodeCategoryId !== 0 && (
            toMarketToken?.eModeCategoryId === userEmodeCategoryId ||
            ((toMarketToken?.eModeCollateralCategories || []) as number[]).includes(userEmodeCategoryId)
        );

        // Restricted ONLY if we were in E-Mode with the source asset and are leaving it with the destination
        const isEmodeRestricted = userEmodeCategoryId !== 0 && isFromAssetEmode && !isToAssetEmode;

        const activeEmode = (summary?.eModes || []).find((m: any) => m.id === userEmodeCategoryId);
        const emodeLT = activeEmode ? (Number(activeEmode.liquidationThreshold) / 10000) : 0;

        let simulatedLT = currentLiquidationThreshold;

        try {
            const fromLiqThreshold = isFromAssetEmode ? emodeLT : (parseFloat(fromMarketToken?.reserveLiquidationThreshold || '0') || 0);
            const toLiqThreshold = isToAssetEmode ? emodeLT : (parseFloat(toMarketToken?.reserveLiquidationThreshold || '0') || 0);

            const srcUSD = parseFloat(swapQuote.srcUSD || '0');
            const netReceivedUsd = parseFloat(swapQuote.destUSD || '0');

            if (srcUSD > 0 && netReceivedUsd > 0) {
                const lostCollateralPower = srcUSD * fromLiqThreshold;
                // Gained collateral power uses effective (potentially boosted) toLiqThreshold
                const gainedCollateralPower = netReceivedUsd * toLiqThreshold;

                const currentCollateralPower = currentTotalCollateralUSD * currentLiquidationThreshold;
                const simulatedCollateralPower = Math.max(0, currentCollateralPower - lostCollateralPower + gainedCollateralPower);
                const simulatedTotalCollateralUSD = Math.max(0, currentTotalCollateralUSD - srcUSD + netReceivedUsd);

                if (simulatedTotalCollateralUSD > 0) {
                    simulatedLT = simulatedCollateralPower / simulatedTotalCollateralUSD;
                }

                if (currentTotalBorrowsUSD > 0.01) {
                    simulatedHf = simulatedCollateralPower / currentTotalBorrowsUSD;
                } else {
                    simulatedHf = -1;
                }
            }
        } catch (err) {
            logger.error('Collateral HF Simulation Error', err);
        }

        return { simulatedHf, isEmodeRestricted, currentTotalBorrowsUSD, simulatedLT, currentLiquidationThreshold };
    }, [swapQuote, fromToken, toToken, summary, localMarketAssets]);

    const { simulatedHf, isEmodeRestricted, currentTotalBorrowsUSD, simulatedLT = 0, currentLiquidationThreshold = 0 } = simulationStatus;

    useEffect(() => {
        if (txError || userRejected) {
            clearTxError();
            clearUserRejected();
        }
    }, [fromToken, toToken, inputValue, txError, userRejected, clearTxError, clearUserRejected]);

    const modalTitle = useMemo(() => {
        const fromSym = getDisplaySymbol(fromToken, localMarketAssets);
        const toSym = getDisplaySymbol(toToken, localMarketAssets);

        if (fromToken && toToken) {
            return `Collateral Swap: ${fromSym} → ${toSym}`;
        }

        if (fromToken) {
            return `Collateral Swap: ${fromSym}`;
        }

        return 'Collateral Swap';
    }, [fromToken, toToken, localMarketAssets, getDisplaySymbol]);


    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
            headerBorder={false}
            preventAutoFocus={true}
        >
            <div className="p-3 space-y-2">
                {/* Zero LTV Warning */}
                {isBlockedByZeroLtv && (
                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-3 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300 mb-2">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <h4 className="text-sm font-bold text-red-900 dark:text-red-200">
                                    Action Blocked by Aave
                                </h4>
                                <p className="text-xs text-red-800/80 dark:text-red-300/80 leading-relaxed">
                                    You have assets with LTV 0 ({blockingZeroLtvAssets.join(', ')}) enabled as collateral.<br />
                                    Aave requires you to disable them as collateral or withdraw them before performing this action.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
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
                            title="Slippage settings"
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

                {/* From Input */}
                <CompactAmountInput
                    token={fromToken}
                    value={inputValue}
                    isUSDMode={isUSDMode}
                    onToggleUSDMode={handleToggleUSDMode}
                    secondaryValue={fromSecondaryValue}
                    isError={isInsufficientBalance}
                    onChange={(val) => {
                        const normalized = normalizeDecimalInput(val);
                        setInputValue(normalized);

                        try {
                            if (!normalized || normalized === '.' || parseFloat(normalized) === 0) {
                                setSwapAmount(BigInt(0));
                                return;
                            }

                            let amountBI: bigint;

                            if (isUSDMode) {
                                const price = parseFloat(fromToken?.priceInUSD || '0');
                                if (price > 0) {
                                    const tokenAmountNum = parseFloat(normalized) / price;
                                    amountBI = parseUnits(tokenAmountNum.toFixed(fromToken?.decimals || 18), fromToken?.decimals || 18);
                                } else {
                                    amountBI = BigInt(0);
                                }
                            } else {
                                amountBI = parseUnits(normalized, fromToken.decimals || 18);
                            }

                            // NO CAPPING — allow above-balance quoting
                            setSwapAmount(amountBI);
                        } catch {
                            // Ignore invalid partial decimal input while typing.
                        }
                    }}
                    onApplyMax={() => {
                        if (!availableBalance || availableBalance === BigInt(0)) return;
                        const maxTokenAmount = formatUnits(availableBalance, fromToken.decimals || 18);
                        if (isUSDMode) {
                            const price = parseFloat(fromToken.priceInUSD || '0');
                            setInputValue((parseFloat(maxTokenAmount) * price).toFixed(2));
                        } else {
                            setInputValue(maxTokenAmount);
                        }
                        setSwapAmount(availableBalance);
                    }}
                    onApplyPct={(pct) => {
                        if (!availableBalance || availableBalance === BigInt(0)) return;
                        const amountBI = (availableBalance * BigInt(pct)) / BigInt(100);
                        const tokenAmount = formatUnits(amountBI, fromToken.decimals || 18);
                        if (isUSDMode) {
                            const price = parseFloat(fromToken.priceInUSD || '0');
                            setInputValue((parseFloat(tokenAmount) * price).toFixed(2));
                        } else {
                            setInputValue(tokenAmount);
                        }
                        setSwapAmount(amountBI);
                    }}
                    maxAmount={availableBalance}
                    decimals={isUSDMode ? 2 : (fromToken?.decimals || 18)}
                    formattedBalance={formattedBalance}
                    onTokenSelect={() => {
                        setSelectingForFrom(true);
                        setTokenSelectorOpen(true);
                    }}
                    displaySymbol={fromToken ? getDisplaySymbol(fromToken, localMarketAssets) : undefined}
                    disabled={isActionLoading}
                />

                {/* Auto Refresh Display */}
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
                                <div className="flex items-center overflow-hidden">
                                    {isUSDMode && (
                                        <span className={`text-2xl font-mono font-bold mr-0.5 select-none transition-colors ${(() => {
                                            const usdVal = parseFloat(swapQuote?.priceRoute?.destUSD || '0');
                                            return usdVal > 0 ? 'text-slate-900 dark:text-white' : 'text-muted-foreground';
                                        })()}`}>$</span>
                                    )}
                                    <input
                                        type="text"
                                        readOnly
                                        value={(() => {
                                            if (isUSDMode) {
                                                const usdVal = parseFloat(swapQuote.priceRoute.destUSD || '0');
                                                return usdVal.toFixed(2);
                                            }
                                            return formatUnits(swapQuote.destAmount, toToken.decimals || 18);
                                        })()}
                                        className="text-2xl font-mono font-bold bg-transparent border-none text-slate-900 dark:text-white block w-full py-0.5 leading-none focus:outline-none cursor-text select-all"
                                    />

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
                    <div className="flex items-center justify-between mt-0 pl-1.5 min-h-5">
                        <div className="text-xs text-slate-500 font-medium transition-colors">
                            {toSecondaryValue || ''}
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
                                        const inputF = parseFloat(formatUnits(swapAmount, fromToken.decimals || 18));
                                        const outputF = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));

                                        if (inputF > 0 && outputF > 0) {
                                            if (invertRate) {
                                                return (inputF / outputF).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(fromToken, localMarketAssets);
                                            } else {
                                                return (outputF / inputF).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(toToken, localMarketAssets);
                                            }
                                        }
                                    }

                                    return invertRate
                                        ? (parseFloat(toToken.priceInUSD) / parseFloat(fromToken.priceInUSD)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(fromToken, localMarketAssets)
                                        : (parseFloat(fromToken.priceInUSD) / parseFloat(toToken.priceInUSD)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + getDisplaySymbol(toToken, localMarketAssets);
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
                                                const amount = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));
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

                                                    return `Service Fee (${(feeBps / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%)`;
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

                                                    const amount = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));
                                                    const fee = amount * (feeBps / 10000);

                                                    return fee < 0.00001 ? '< 0.00001' : fee.toLocaleString('en-US', { maximumFractionDigits: 6 });
                                                })()}
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
                                        <InfoTooltip content="Safety of your collateral against your debt." size={12} />
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
                                                    const withdrawnAmountF = parseFloat(formatUnits(swapQuote.srcAmount, fromToken.decimals || 18));
                                                    const newAmountF = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));

                                                    const userEmodeId = summary.eModeCategoryId || 0;
                                                    const activeEMode = userEmodeId > 0 ? summary.eModes?.find((m: any) => m.id === userEmodeId) : null;

                                                    const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                                    const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
                                                    const fromPrice = parseFloat(fromMarketToken?.priceInUSD ?? fromToken?.priceInUSD) || 0;

                                                    // E-Mode boost applies if the asset is in the user's active E-Mode category.
                                                    // Aave uses the borrowable bitmap (eModeCategoryId) as the primary signal —
                                                    // the collateral bitmap may be empty even when the boost applies (AaveV3Ethereum quirk).
                                                    let fromLt = parseFloat(fromMarketToken?.reserveLiquidationThreshold || '0');
                                                    if (userEmodeId > 0 && activeEMode) {
                                                        const fromInEMode =
                                                            (fromMarketToken?.eModeCategoryId === userEmodeId) ||
                                                            ((fromMarketToken?.eModeCollateralCategories || []) as number[]).includes(userEmodeId);
                                                        if (fromInEMode) {
                                                            fromLt = activeEMode.liquidationThreshold / 10000;
                                                        }
                                                    }

                                                    const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                                    const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                                                    const toPrice = parseFloat(toMarketToken?.priceInUSD ?? toToken?.priceInUSD) || 0;

                                                    // Same logic for the destination asset
                                                    let toLt = parseFloat(toMarketToken?.reserveLiquidationThreshold || '0');
                                                    if (userEmodeId > 0 && activeEMode) {
                                                        const toInEMode =
                                                            (toMarketToken?.eModeCategoryId === userEmodeId) ||
                                                            ((toMarketToken?.eModeCollateralCategories || []) as number[]).includes(userEmodeId);
                                                        if (toInEMode) {
                                                            toLt = activeEMode.liquidationThreshold / 10000;
                                                        }
                                                    }

                                                    if (fromPrice > 0 && toPrice > 0) {
                                                        const withdrawnUsd = withdrawnAmountF * fromPrice;
                                                        // Net received includes base service fee + standard slippage deduction approximation
                                                        const netReceivedAmountToken = newAmountF * (1 - ((swapQuote.feeBps || 0) / 10000)) * (1 - (slippage / 10000));
                                                        const newUsd = netReceivedAmountToken * toPrice;

                                                        const newTotalCollateralUSD = Math.max(0, currentTotalCollateralUSD - withdrawnUsd + newUsd);

                                                        let newAvgLt = currentLiquidationThreshold;

                                                        if (newTotalCollateralUSD > 0) {
                                                            const currentThresholdUsd = currentTotalCollateralUSD * currentLiquidationThreshold;
                                                            const newThresholdUsd = Math.max(0, currentThresholdUsd - (withdrawnUsd * fromLt) + (newUsd * toLt));
                                                            newAvgLt = newThresholdUsd / newTotalCollateralUSD;
                                                        }

                                                        if (currentTotalBorrowsUSD > 0) {
                                                            simulatedHf = (newTotalCollateralUSD * newAvgLt) / currentTotalBorrowsUSD;
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

                                            return (
                                                <div className="flex flex-col items-end">
                                                    <div className="flex items-center gap-1.5 font-bold">
                                                        <span className={getHfColor(currentHf)}>{formatHF(currentHf)}</span>
                                                        <span className="text-slate-400 font-normal">→</span>
                                                        <InfoTooltip content="Liquidation < 1.0" size={12}>
                                                            <span className={isInsufficientBalance ? 'text-slate-400 font-normal' : getHfColor(simulatedHf)}>
                                                                {isInsufficientBalance ? '—' : formatHF(simulatedHf)}
                                                            </span>
                                                        </InfoTooltip>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Collateral Power Row */}
                                {summary?.healthFactor && summary.healthFactor !== '-1' && (
                                    <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                        <div className="flex items-center gap-1.5">
                                            <span>Collateral power</span>
                                            <InfoTooltip content="Total value of collateral considered for collateralization." size={12} />
                                        </div>
                                        <div className="text-right font-medium">
                                            {(() => {
                                                const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                                let simulatedTotalCollateralUSD = currentTotalCollateralUSD;

                                                if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount) {
                                                    try {
                                                        const withdrawnAmountF = parseFloat(formatUnits(swapQuote.srcAmount, fromToken.decimals || 18));
                                                        const newAmountF = parseFloat(formatUnits(swapQuote.destAmount, toToken.decimals || 18));

                                                        const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                                        const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);

                                                        // FIX: Normalize price (Aave raw prices are 1e8)
                                                        const rawFromPrice = parseFloat(fromMarketToken?.priceInUSD ?? fromToken?.priceInUSD ?? '0');
                                                        const fromPrice = rawFromPrice > 1_000_000_000 ? rawFromPrice / 1e8 : rawFromPrice;

                                                        const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                                        const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);

                                                        // FIX: Normalize price (Aave raw prices are 1e8)
                                                        const rawToPrice = parseFloat(toMarketToken?.priceInUSD ?? toToken?.priceInUSD ?? '0');
                                                        const toPrice = rawToPrice > 1_000_000_000 ? rawToPrice / 1e8 : rawToPrice;

                                                        if (fromPrice > 0 && toPrice > 0) {
                                                            const withdrawnUsd = parseFloat(swapQuote.srcUSD || '0') || (withdrawnAmountF * fromPrice);
                                                            const netReceivedUsd = parseFloat(swapQuote.destUSD || '0') || (newAmountF * (1 - ((swapQuote.feeBps || 0) / 10000)) * (1 - (slippage / 10000)) * toPrice);
                                                            simulatedTotalCollateralUSD = Math.max(0, currentTotalCollateralUSD - withdrawnUsd + netReceivedUsd);
                                                        }
                                                    } catch {
                                                        // Keep preview resilient if interim quote math fails.
                                                    }
                                                }

                                                return (
                                                    <div className="flex flex-col items-end">
                                                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                            <span>{formatUSD(currentTotalCollateralUSD)}</span>
                                                            <span className="text-slate-400 font-normal">→</span>
                                                            <span className={isInsufficientBalance ? 'text-slate-400 font-normal' : (simulatedTotalCollateralUSD > currentTotalCollateralUSD ? 'text-emerald-500' : simulatedTotalCollateralUSD < currentTotalCollateralUSD ? 'text-amber-500 font-bold' : 'text-slate-900 dark:text-slate-100')}>
                                                                {isInsufficientBalance ? '—' : formatUSD(simulatedTotalCollateralUSD)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}

                                {/* Supply APY Row */}
                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span>Supply APY</span>
                                        <InfoTooltip content="Annual yield on deposited assets." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        {(() => {
                                            const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                            const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
                                            const currentApy = (fromMarketToken?.supplyAPY ?? 0) * 100;

                                            const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                            const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                                            const newApy = (toMarketToken?.supplyAPY ?? 0) * 100;

                                            return (
                                                <>
                                                    <span className="text-slate-900 dark:text-slate-100">{formatAPY(currentApy)}</span>
                                                    <span className="text-slate-400 font-normal">→</span>
                                                    <span className="text-slate-900 dark:text-slate-100">{formatAPY(newApy)}</span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>

                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span>Liquidation threshold</span>
                                        <InfoTooltip content="The weight average of your collateral's liquidation thresholds." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        <span className="text-slate-900 dark:text-slate-100">{Math.round(currentLiquidationThreshold * 100)}%</span>
                                        <span className="text-slate-400 font-normal">→</span>
                                        <span className={clsx(
                                            "font-medium",
                                            (simulatedLT ?? 0) > currentLiquidationThreshold ? "text-emerald-500" : ((simulatedLT ?? 0) < currentLiquidationThreshold ? "text-amber-500" : "text-slate-900 dark:text-white")
                                        )}>
                                            {Math.round((simulatedLT ?? 0) * 100)}%
                                        </span>
                                    </div>
                                </div>

                                {/* Collateralization Row */}
                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                    <div className="flex items-center gap-1.5">
                                        <span>Collateralization</span>
                                        <InfoTooltip content="Whether this asset can be used as collateral (backing for loans)." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        {(() => {
                                            const userEmodeId = summary?.eModeCategoryId || 0;

                                            const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                            const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
                                            const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                            const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                                            // Collateral eligibility: protocol-level eligibility (Aave doesn't mention E-Mode in collateral swap UI)
                                            const fromEligible = fromMarketToken?.usageAsCollateralEnabled;
                                            const toEligible = toMarketToken?.usageAsCollateralEnabled;

                                            const fromText = fromEligible ? 'Enabled' : 'Disabled';
                                            const fromColor = fromEligible ? 'text-emerald-500' : 'text-slate-400';
                                            const toText = toEligible ? 'Enabled' : 'Unavailable';
                                            const toColor = toEligible ? 'text-emerald-500' : 'text-amber-500 font-bold';

                                            return (
                                                <>
                                                    <span className={fromColor}>{fromText}</span>
                                                    <span className="text-slate-400 font-normal">→</span>
                                                    <span className={toColor}>{toText}</span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Supply Balance Row */}
                                <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium pb-1">
                                    <div className="flex items-center gap-1.5">
                                        <span>Min. balance after switch</span>
                                        <InfoTooltip content="Your estimated token balance in the protocol after the swap is completed." size={12} />
                                    </div>
                                    <div className="text-right flex items-center gap-1.5">
                                        {(() => {
                                            const activeSupplies = providedSupplies || [];

                                            // Handle From Token (remaining balance)
                                            let fromRemaining = 0;

                                            try {
                                                const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
                                                const existingFromSupply = activeSupplies.find(s => (s.underlyingAsset || '').toLowerCase() === fromAddr);
                                                const existingFromBalance = existingFromSupply ? parseFloat(existingFromSupply.formattedAmount || '0') : 0;
                                                const withdrawnAmount = parseFloat(formatUnits(swapQuote.srcAmount || "0", fromToken.decimals || 18));
                                                fromRemaining = Math.max(0, existingFromBalance - withdrawnAmount);
                                            } catch {
                                                // Ignore malformed balances from upstream data.
                                            }

                                            // Handle To Token (new balance)
                                            let toTotal = 0;

                                            try {
                                                const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
                                                const existingToSupply = activeSupplies.find(s => (s.underlyingAsset || '').toLowerCase() === toAddr);
                                                const existingToBalance = existingToSupply ? parseFloat(existingToSupply.formattedAmount || '0') : 0;

                                                // Calculate to balance
                                                toTotal = existingToBalance;

                                                if (swapQuote) {
                                                    const grossReceived = parseFloat(formatUnits(swapQuote.destAmount || "0", toToken.decimals || 18));
                                                    // Deduct fee and slippage for conservative estimate
                                                    const netReceived = grossReceived * (1 - ((swapQuote.feeBps || 0) / 10000)) * (1 - (slippage / 10000));
                                                    toTotal = existingToBalance + netReceived;
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
                                                        <span>{fromRemaining === 0 ? '0' : (fromRemaining >= 1000 ? (fromRemaining / 1000).toFixed(2) + 'K' : fromRemaining.toLocaleString('en-US', { maximumFractionDigits: 6 }))}</span>
                                                    </div>
                                                    <span className="text-slate-400 font-normal">→</span>
                                                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                                            <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                                                        </div>
                                                        <span>{toTotal === 0 ? '0' : (toTotal >= 1000 ? (toTotal / 1000).toFixed(2) + 'K' : toTotal.toLocaleString('en-US', { maximumFractionDigits: 6 }))}</span>
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

                {/* Safety Alerts */}
                {(() => {
                    if (!fromToken || !toToken || !localMarketAssets || !swapQuote) {
                        return null;
                    }

                    const toAddr = (toToken.underlyingAsset || toToken.address || '').toLowerCase();
                    const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                    const toCanBeCollateral = toMarketToken?.usageAsCollateralEnabled;

                    const alerts: Array<{ label: string; message: string; isDanger: boolean }> = [];

                    if (toMarketToken && !toCanBeCollateral) {
                        alerts.push({
                            label: 'Warning:',
                            message: `${toToken.symbol} cannot be used as collateral on Aave.`,
                            isDanger: false,
                        });
                    }

                    if (isEmodeRestricted) {
                        alerts.push({
                            label: 'Restricted:',
                            message: `${toToken.symbol} is outside your active E-Mode category and will reduce your collateral power.`,
                            isDanger: false,
                        });
                    }

                    if (simulatedHf !== -1 && simulatedHf < 1.05 && currentTotalBorrowsUSD > 0 && !isInsufficientBalance) {
                        alerts.push({
                            label: 'Danger:',
                            message: `This swap will leave your Health Factor very low (${formatHF(simulatedHf)}).`,
                            isDanger: true,
                        });
                    }

                    if (priceImpact > 0.05) {
                        alerts.push({
                            label: 'High Impact:',
                            message: `Price impact is very high (${(priceImpact * 100).toFixed(2)}%).`,
                            isDanger: true,
                        });
                    }

                    if (slippage < recommendedSlippage || priceImpact > 0.02) {
                        alerts.push({
                            label: 'Warning:',
                            message: 'High risk of revert. Consider increasing slippage.',
                            isDanger: true,
                        });
                    }

                    if (alerts.length === 0) {
                        return null;
                    }

                    return (
                        <div className="space-y-1 mb-1">
                            {alerts.map((alert, i) => (
                                <div key={`${alert.label}-${i}`} className="flex justify-center gap-1.5 px-1">
                                    <span className={`text-[11px] font-bold ${alert.isDanger ? 'text-red-500' : 'text-amber-500'}`}>{alert.label}</span>
                                    <div className={`flex items-center gap-1 text-[11px] font-bold ${alert.isDanger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-500'}`}>
                                        <span className="text-center">{alert.message}</span>
                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })()}

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

                {/* Swap Button */}
                <Button
                    disabled={isActionLoading || !swapQuote || swapAmount === BigInt(0) || isInsufficientBalance || (simulatedHf !== -1 && simulatedHf < 1.05 && currentTotalBorrowsUSD > 0) || isBlockedByZeroLtv}
                    onClick={handleSwap}
                    className={`w-full py-3 h-auto font-bold rounded-xl mt-2 ${isInsufficientBalance ? 'bg-rose-500 hover:bg-rose-600 border-rose-600 text-white' : ''}`}
                >
                    {isActionLoading ? (
                        <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            {isSigning ? 'Confirm in Wallet...' : 'Swapping...'}
                        </>
                    ) : isInsufficientBalance ? (
                        'Insufficient Balance'
                    ) : (simulatedHf !== -1 && simulatedHf < 1.05 && currentTotalBorrowsUSD > 0) ? (
                        'Unsafe Health Factor'
                    ) : (
                        <>
                            <ArrowRightLeft className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                            {isApproved && !forceRequirePermit ? 'Confirm Swap' : 'Approve & Swap'}
                        </>
                    )}
                </Button>

                {/* Error Display */}
                {(txError || userRejected) && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-800 dark:text-red-300 font-medium">
                            {userRejected ? 'Transaction rejected in wallet' : mapErrorToUserFriendly(txError)}
                        </p>
                    </div>
                )}
            </div>

            {/* Token Selector */}
            {tokenSelectorOpen && (
                <TokenSelector
                    isOpen={tokenSelectorOpen}
                    onClose={() => setTokenSelectorOpen(false)}
                    title={selectingForFrom ? 'Swap From' : 'Swap To'}
                    description={selectingForFrom ? 'Choose a token to swap from your supply positions' : 'Choose a token to swap into'}
                    tokens={filteredSelectorTokens}
                    onSelect={(token) => {
                        const marketKey = initialMarketKey || selectedNetwork?.key || '';
                        const addr = (token.address || token.underlyingAsset || '').toLowerCase();
                        if (selectingForFrom) {
                            setFromToken(token);
                            saveTokenSelection(marketKey, 'collateral-from', addr);

                            // If we selected the current 'toToken' as our source, update the 'toToken'
                            // to avoid the "Swap same token" error.
                            if (toToken && (toToken.address || toToken.underlyingAsset || '').toLowerCase() === addr) {
                                const nextValidTo = localMarketAssets.find(m =>
                                    (m.address || m.underlyingAsset || '').toLowerCase() !== addr &&
                                    m.canBeCollateralSwapDestination === true
                                );
                                if (nextValidTo) {
                                    setToToken(nextValidTo);
                                    saveTokenSelection(marketKey, 'collateral', (nextValidTo.address || nextValidTo.underlyingAsset || '').toLowerCase());
                                }
                            }

                            // Reset input when source token changes to avoid errors with previous values
                            setSwapAmount(BigInt(0));
                            setInputValue('');
                        } else {
                            setToToken(token);
                            saveTokenSelection(marketKey, 'collateral', addr);
                        }
                        setTokenSelectorOpen(false);
                    }}
                    renderStatus={renderTokenStatus}
                    hideOverlay={true}
                    rateField="supplyAPY"
                    marketAssets={localMarketAssets}
                />
            )}
        </Modal>
    );
};

export default CollateralSwapModal;
