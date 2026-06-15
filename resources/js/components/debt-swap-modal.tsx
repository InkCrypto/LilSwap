import { formatUnits, parseUnits } from 'viem';
import {
    ArrowRightLeft,
    RefreshCw,
    CheckCircle2,
    AlertTriangle,
    ExternalLink,
    X,
    ChevronDown,
    ChevronUp,
    Settings,
    AlertCircle,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { MARKETS, DEFAULT_MARKET } from '../constants/networks';
import { getAddress, parseAbi } from 'viem';
import { useApprovalState } from '../hooks/use-approval-state';
import { calcApprovalAmount } from '../utils/swap-math';


import { useWeb3 } from '@/contexts/web3-context';
import { useToast } from '../contexts/toast-context';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useDebtSwitchActions } from '../hooks/use-debt-switch-actions';
import { useParaswapQuote } from '../hooks/use-paraswap-quote';
import { useLimitQuote } from '../hooks/use-limit-quote';
import { useUserPosition } from '../hooks/use-user-position';
import { getDebtLimitQuote, postDebtLimitSwap, prepareDebtLimitSwap, submitDebtLimitSwap } from '../services/api';
import type { DebtLimitPostResult, DebtLimitPrepareResult, DebtLimitQuoteResult, DebtLimitSubmitResult } from '../services/api';


import { getPairStatus, checkPairSwappable } from '../services/token-pair-cache';
import { mapErrorToUserFriendly } from '../utils/error-mapping';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput, computeLimitOutputDisplay } from '../utils/normalize-decimal-input';
import { requiresLowHealthFactorConfirmation } from '../utils/health-factor';
import { saveTokenSelection, getSavedTokenSelection } from '../utils/token-selection-memory';
import { CompactAmountInput } from './compact-amount-input';
import { InfoTooltip } from './info-tooltip';
import { LowHealthFactorConfirmationModal } from './low-health-factor-confirmation-modal';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';
import { formatUSD, formatCompactToken, getDisplaySymbol, formatAPY, formatHF, formatCompactNumber } from '../utils/formatters';
import { CollateralToggleModal } from './collateral-toggle-modal';
import logger from '../utils/logger';



interface DebtSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialFromToken?: any | null;
    initialToToken?: any | null;
    providedBorrows?: any[] | null;
    providedSupplies?: any[] | null;
    marketAssets?: any[] | null;
    chainId?: number | null;
    marketKey?: string | null;
    donator?: any | null;
    onOpenToggleCollateral?: (asset: any, summary: any, supplies: any[], marketAssets: any[]) => void;
}

const MAX_PREVALIDATIONS_PER_OPEN = 8;

type TransactionOverviewRow = {
    key: string;
    label: React.ReactNode;
    tooltip?: string;
    value: React.ReactNode;
    className?: string;
};

type DebtSwapTransactionOverviewProps = {
    expanded: boolean;
    onToggle: () => void;
    discountPercent?: number;
    totalCostsLabel?: React.ReactNode;
    costsRows: TransactionOverviewRow[];
    impactRows: TransactionOverviewRow[];
};

const OverviewRow: React.FC<TransactionOverviewRow> = ({ label, tooltip, value, className = '' }) => (
    <div className={`flex justify-between items-center group ${className}`}>
        <div className="flex items-center gap-1.5 text-slate-500">
            <span>{label}</span>
            {tooltip && <InfoTooltip content={tooltip} size={12} />}
        </div>
        <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
            {value}
        </div>
    </div>
);

const DebtSwapTransactionOverview: React.FC<DebtSwapTransactionOverviewProps> = ({
    expanded,
    onToggle,
    discountPercent = 0,
    totalCostsLabel,
    costsRows,
    impactRows,
}) => (
    <div className="mt-1 mb-1">
        <div className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-0.5 px-1">Transaction overview</div>
        <div className="transition-all">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-1 py-1 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="font-medium text-[13px] text-slate-600 dark:text-slate-300">Costs & Fees</span>
                    {discountPercent > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold whitespace-nowrap">
                            Discount Applied
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                    {totalCostsLabel != null && <span className="font-medium">{totalCostsLabel}</span>}
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </button>

            {expanded && costsRows.length > 0 && (
                <div className="relative ml-4 pl-4 pr-3 pb-1 pt-2 space-y-3 text-xs border-l border-dashed border-slate-300 dark:border-slate-700/50">
                    {costsRows.map(({ key, ...row }) => <OverviewRow key={key} {...row} />)}
                </div>
            )}

            {impactRows.length > 0 && (
                <div className="px-1 pb-1 pt-1 space-y-2">
                    {impactRows.map(({ key, ...row }) => <OverviewRow key={key} {...row} />)}
                </div>
            )}
        </div>
    </div>
);

export const DebtSwapModal: React.FC<DebtSwapModalProps> = ({
    isOpen,
    onClose,
    initialFromToken = null,
    initialToToken = null,
    providedBorrows = null,
    providedSupplies = null,
    marketAssets: externalMarketAssets = null,
    chainId: forcedChainId = null,
    marketKey: initialMarketKey = null,
    donator = null,
    onOpenToggleCollateral,
}) => {
    const { account, selectedNetwork } = useWeb3();
    const { addToast } = useToast();
    const { marketAssets: fetchedMarketAssets, supplies, borrows, summary, refresh: refreshGlobalPosition } = useUserPosition(initialMarketKey || '');
    const { addTransaction, setSheetOpen } = useTransactionTracker();
    const localMarketAssets = useMemo(() => externalMarketAssets || fetchedMarketAssets || [], [externalMarketAssets, fetchedMarketAssets]);
    const effectiveNetwork = selectedNetwork;
    const effectiveMarketKey = initialMarketKey || effectiveNetwork?.key || DEFAULT_MARKET.key;
    const effectiveChainId = effectiveNetwork?.chainId || forcedChainId || DEFAULT_MARKET.chainId;

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
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [showLowHfConfirmation, setShowLowHfConfirmation] = useState(false);
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    /**
     * swapMode: 'market' = existing Velora/ParaSwap flow (default, production).
     *           'limit'  = isolated limit order flow.
     * Market mode is always the default.
     */
    const [swapMode, setSwapMode] = useState<'market' | 'limit'>('market');
    const [isPreparingDebtLimit, setIsPreparingDebtLimit] = useState(false);
    const [limitPrice, setLimitPrice] = useState('');
    const [limitPriceInput, setLimitPriceInput] = useState('');
    const [canonicalLimitPrice, setCanonicalLimitPrice] = useState('');
    const [canonicalPriceInverted, setCanonicalPriceInverted] = useState(true);
    const [limitPriceInputError, setLimitPriceInputError] = useState<string | null>(null);
    const [limitPriceCommitNonce, setLimitPriceCommitNonce] = useState(0);
    const [priceLimitDisplayInverted, setPriceLimitDisplayInverted] = useState(true);
    const [limitExpirySeconds, setLimitExpirySeconds] = useState(600);
    const [hasCustomLimitPrice, setHasCustomLimitPrice] = useState(false);
    const [showLimitExpiryMenu, setShowLimitExpiryMenu] = useState(false);
    const [debtLimitPrepareResult, setDebtLimitPrepareResult] = useState<DebtLimitPrepareResult | null>(null);
    const [debtLimitPrepareError, setDebtLimitPrepareError] = useState<string | null>(null);
    /** Delegation state for the Limit tab. Never modified from Market mode. */
    const [limitDelegationStatus, setLimitDelegationStatus] = useState<'idle' | 'pending' | 'signed' | 'failed'>('idle');
    /** EIP-712 DelegationWithSig permit params returned after signing. Passed to submit in Phase 5. */
    const [debtLimitDelegationSignature, setDebtLimitDelegationSignature] = useState<{ amount: bigint; deadline: number; v: number; r: `0x${string}`; s: `0x${string}` } | null>(null);
    const [isSubmittingDebtLimit, setIsSubmittingDebtLimit] = useState(false);
    const [debtLimitSubmitResult, setDebtLimitSubmitResult] = useState<DebtLimitSubmitResult | null>(null);
    const [debtLimitSubmitError, setDebtLimitSubmitError] = useState<string | null>(null);
    const [isSigningDebtLimitOrder, setIsSigningDebtLimitOrder] = useState(false);
    const [debtLimitOrderSignatureResult, setDebtLimitOrderSignatureResult] = useState<{ signature: string; signatureRequest: NonNullable<DebtLimitSubmitResult['signatureRequest']> } | null>(null);
    const [debtLimitOrderSignatureError, setDebtLimitOrderSignatureError] = useState<string | null>(null);
    const [isPostingDebtLimitOrder, setIsPostingDebtLimitOrder] = useState(false);
    const [debtLimitPostResult, setDebtLimitPostResult] = useState<DebtLimitPostResult | null>(null);
    const [debtLimitPostError, setDebtLimitPostError] = useState<string | null>(null);
    const [limitOutputInputValue, setLimitOutputInputValue] = useState('');
    const isEditingLimitOutputRef = useRef(false);


    // Refs
    const methodMenuRef = useRef<HTMLDivElement>(null);
    const slippageMenuRef = useRef<HTMLDivElement>(null);
    const limitExpiryMenuRef = useRef<HTMLDivElement>(null);
    const prevFromTokenAddrRef = useRef('');
    const validatingPairsRef = useRef<Set<string>>(new Set());
    const prevalidationBudgetRef = useRef(0);
    const lastToastErrorRef = useRef<string | null>(null);
    const debtLimitPrepareRequestRef = useRef(0);
    const lastHandledLimitOrderIdRef = useRef<string | null>(null);

    const skipNextLimitPriceInputDebounceRef = useRef(false);
    const hasCustomLimitPriceRef = useRef(false);

    const limitExpiryOptions = useMemo(() => [
        { label: '10 minutes', value: 600 },
        { label: 'Half hour', value: 1800 },
        { label: 'One hour', value: 3600 },
        { label: 'One day', value: 86400 },
        { label: 'One week', value: 604800 },
        { label: 'One month', value: 2592000 },
        { label: 'Three months', value: 7776000 },
        { label: 'One year', value: 31536000 },
    ], []);

    const selectedLimitExpiry = useMemo(
        () => limitExpiryOptions.find((option) => option.value === limitExpirySeconds) || limitExpiryOptions[0],
        [limitExpiryOptions, limitExpirySeconds],
    );

    // Derived values needed for hooks
    const adapterAddress = useMemo(() => {
        const market = MARKETS[effectiveMarketKey as keyof typeof MARKETS] || DEFAULT_MARKET;
        return market.addresses.DEBT_SWAP_ADAPTER;
    }, [effectiveMarketKey]);

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

    // --- Actions ---

    // Borrow and Swap logic hooks initialization
    const {
        swapQuote,
        slippage,
        recommendedSlippage,
        setSlippage,
        isAutoSlippage,
        setIsAutoSlippage,
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
        marketKey: initialMarketKey || effectiveNetwork?.key,
        account,
        adapterAddress,
        enabled: isOpen && swapMode === 'market',
        freezeQuote,
        marketAssets: localMarketAssets,
        isMaxSwap: debtBalance !== null && debtBalance > 0n && swapAmount >= debtBalance,
    });
    const executionSlippage = isAutoSlippage ? recommendedSlippage : slippage;

    // --- Computed Values ---
    const limitInputValue = inputValue;
    const limitInputAmount = swapAmount;

    const formattedDebt = useMemo(() => {
        if (!fromToken) {
            return '0';
        }

        const addr = (fromToken.underlyingAsset || fromToken.address || '').toLowerCase();
        const borrow = activeDebtAssets.find(b => (b.underlyingAsset || '').toLowerCase() === addr);

        return borrow?.formattedAmount || '0';
    }, [fromToken, activeDebtAssets]);

    const resolvedToDebtTokenAddress = useMemo(() => {
        if (!toToken) return null;
        if (toToken.variableDebtTokenAddress && toToken.variableDebtTokenAddress !== '0x0000000000000000000000000000000000000000') {
            return toToken.variableDebtTokenAddress;
        }
        const addr = (toToken.underlyingAsset || toToken.address || '').toLowerCase();
        const match = (localMarketAssets || []).find(m => (m.underlyingAsset || '').toLowerCase() === addr);
        if (match?.variableDebtTokenAddress && match.variableDebtTokenAddress !== '0x0000000000000000000000000000000000000000') {
            return match.variableDebtTokenAddress;
        }
        const borrow = activeDebtAssets.find(b => (b.underlyingAsset || '').toLowerCase() === addr);
        if (borrow?.debtTokenAddress && borrow.debtTokenAddress !== '0x0000000000000000000000000000000000000000') {
            return borrow.debtTokenAddress;
        }
        return null;
    }, [toToken, localMarketAssets, activeDebtAssets]);

    const [toDebtTokenAddress, setToDebtTokenAddress] = useState<string | null>(null);

    useEffect(() => {
        const resolved = resolvedToDebtTokenAddress;
        if (resolved) {
            setToDebtTokenAddress(resolved);
            return;
        }

        if (!isOpen || !toToken || !effectiveNetwork || !publicClient) {
            setToDebtTokenAddress(null);
            return;
        }

        const client = publicClient;
        let isMounted = true;

        async function fetchToDebtAddress() {
            try {
                const clientChainId = await client.getChainId();
                if (clientChainId !== effectiveChainId) return;

                const market = MARKETS[effectiveMarketKey as keyof typeof MARKETS] || DEFAULT_MARKET;
                const dataProviderAddr = market.addresses.DATA_PROVIDER;
                if (!dataProviderAddr) return;

                const bytecode = await client.getBytecode({ address: getAddress(dataProviderAddr) });
                if (!bytecode || bytecode === '0x') return;

                const data = await client.readContract({
                    address: getAddress(dataProviderAddr),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(toToken.underlyingAsset || toToken.address || '')],
                }) as any;

                if (isMounted && data && (data.variableDebtTokenAddress || data[2])) {
                    setToDebtTokenAddress(data.variableDebtTokenAddress || data[2]);
                }
            } catch (err: any) {
                const msg = String(err?.message || '');
                if (msg.includes('returned no data') || msg.includes('Cannot decode zero data')) {
                    logger.debug('[DebtSwapModal] toDebtAddress unavailable for selected token/network (non-fatal).');
                    return;
                }
                logger.warn('[DebtSwapModal] Error fetching toDebtAddress:', err);
            }
        }

        fetchToDebtAddress();
        return () => { isMounted = false; };
    }, [resolvedToDebtTokenAddress, toToken, isOpen, effectiveNetwork, publicClient]);


    const amountRequired = useMemo(() => {
        if (!swapQuote) return swapAmount;
        const srcAmount = BigInt(swapQuote.srcAmount);
        const bufferBps = swapQuote.bufferBps || 70;
        return calcApprovalAmount(srcAmount, bufferBps);
    }, [swapQuote, swapAmount]);

    const formatPlainAmount = useCallback((value: number) => {
        if (!Number.isFinite(value) || value <= 0) {
            return '';
        }

        return value
            .toLocaleString('en-US', {
                useGrouping: false,
                maximumFractionDigits: value < 1 ? 8 : 6,
            })
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '');
    }, []);

    const formatRawAmountForDisplay = useCallback((rawAmount: string | undefined | null, decimals: number) => {
        if (!rawAmount) {
            return '';
        }

        try {
            return formatPlainAmount(parseFloat(formatUnits(BigInt(rawAmount), decimals)));
        } catch {
            return '';
        }
    }, [formatPlainAmount]);

    const getUserLimitPrice = useCallback(() => {
        const canonicalDestinationPerSource = parseFloat(canonicalLimitPrice || '0');

        if (!Number.isFinite(canonicalDestinationPerSource) || canonicalDestinationPerSource <= 0) {
            return '';
        }

        return canonicalPriceInverted
            ? formatPlainAmount(1 / canonicalDestinationPerSource)
            : canonicalLimitPrice;
    }, [canonicalLimitPrice, canonicalPriceInverted, formatPlainAmount]);

    const priceBaseToken = priceLimitDisplayInverted ? toToken : fromToken;
    const priceQuoteToken = priceLimitDisplayInverted ? fromToken : toToken;
    const priceDirection = priceLimitDisplayInverted ? 'sell_to_buy' : 'buy_to_sell';

    // Use the inverted state from when canonical was set for output calculations.
    // This prevents the display toggle from changing the receive amount.
    const canonicalPriceBaseToken = canonicalPriceInverted ? toToken : fromToken;
    const canonicalPriceQuoteToken = canonicalPriceInverted ? fromToken : toToken;
    const canonicalPriceDirection = canonicalPriceInverted ? 'sell_to_buy' : 'buy_to_sell';

    const getPriceMetadata = useCallback(() => ({
        userLimitPrice: hasCustomLimitPrice ? getUserLimitPrice() : undefined,
        isLimitPriceCustom: hasCustomLimitPrice,
        priceBaseTokenAddress: priceBaseToken?.address || priceBaseToken?.underlyingAsset || undefined,
        priceBaseTokenSymbol: priceBaseToken?.symbol || undefined,
        priceBaseTokenDecimals: priceBaseToken?.decimals ?? undefined,
        priceQuoteTokenAddress: priceQuoteToken?.address || priceQuoteToken?.underlyingAsset || undefined,
        priceQuoteTokenSymbol: priceQuoteToken?.symbol || undefined,
        priceQuoteTokenDecimals: priceQuoteToken?.decimals ?? undefined,
        priceInverted: priceLimitDisplayInverted,
        priceDirection,
    }), [
        hasCustomLimitPrice,
        getUserLimitPrice,
        priceBaseToken,
        priceQuoteToken,
        priceLimitDisplayInverted,
        priceDirection,
    ]);

    const {
        debtLimitQuote,
        setDebtLimitQuote,
        isDebtLimitQuoteLoading,
        debtLimitQuoteError,
        setDebtLimitQuoteError: setLimitQuoteError,
        clearQuoteError: clearLimitQuoteError,
        debtLimitQuoteState,
        debtLimitValidTo,
        setDebtLimitValidTo,
        marketLimitPrice,
        setMarketLimitPrice,
        autoRefreshEnabled: limitAutoRefreshEnabled,
        nextRefreshIn: limitNextRefreshIn,
        fetchQuote: fetchLimitQuote,
        resetRefreshCountdown: resetLimitRefreshCountdown,
        clearQuote: clearLimitQuote,
        errorCountdown: limitErrorCountdown,
    } = useLimitQuote({
        isOpen,
        account,
        effectiveNetwork,
        initialMarketKey,
        fromToken,
        toToken,
        limitInputAmount,
        debtBalance,
        limitExpirySeconds,
        getPriceMetadata,
        enabled: isOpen && swapMode === 'limit',
        freezeQuote,
    });

    const calculateBuyLimitSellAmount = useCallback((
        buyAmountRaw: bigint,
        userLimitPrice: string,
        buyDecimals: number,
        sellDecimals: number,
        direction: string,
    ) => {
        if (buyAmountRaw <= 0n || !userLimitPrice) {
            return 0n;
        }

        try {
            const priceScale = 18;
            const priceRaw = parseUnits(userLimitPrice, priceScale);

            if (priceRaw <= 0n) {
                return 0n;
            }

            if (direction === 'buy_to_sell') {
                const numerator = buyAmountRaw * priceRaw * (10n ** BigInt(sellDecimals));
                const denominator = (10n ** BigInt(priceScale)) * (10n ** BigInt(buyDecimals));

                return numerator / denominator;
            }

            const numerator = buyAmountRaw * (10n ** BigInt(sellDecimals)) * (10n ** BigInt(priceScale));
            const denominator = priceRaw * (10n ** BigInt(buyDecimals));

            return numerator / denominator;
        } catch {
            return 0n;
        }
    }, []);

    const orderSellRawAmount = debtLimitQuote?.orderSellAmountRaw || debtLimitQuote?.orderSellAmount || debtLimitQuote?.finalMaxSellAmount || debtLimitQuote?.sellAmount || null;
    const orderBuyRawAmount = debtLimitQuote?.orderBuyAmountRaw || debtLimitQuote?.orderBuyAmount || debtLimitQuote?.buyAmount || null;
    const customUserLimitPrice = hasCustomLimitPrice ? getUserLimitPrice() : '';
    const customOrderSellRawAmount = useMemo(() => {
        if (!hasCustomLimitPrice || !customUserLimitPrice || !fromToken || !toToken || limitInputAmount <= 0n) {
            return null;
        }

        const raw = calculateBuyLimitSellAmount(
            limitInputAmount,
            customUserLimitPrice,
            fromToken.decimals ?? 18,
            toToken.decimals ?? 18,
            canonicalPriceDirection,
        );

        if (raw <= 0n) return null;

        // Add the network fee from the quote so the signed order is properly funded.
        // EIP-1271 adapter orders are signed with feeAmount = 0 in the payload, meaning
        // the solver deducts the network fee directly from sellAmount. Without this addition
        // the order would be underfunded by the fee and never fill at the target rate.
        const fee = BigInt(debtLimitQuote?.quoteFeeAmount || '0');
        return (raw + fee).toString();
    }, [hasCustomLimitPrice, customUserLimitPrice, fromToken, toToken, limitInputAmount, calculateBuyLimitSellAmount, canonicalPriceDirection, debtLimitQuote?.quoteFeeAmount]);
    const displayDestinationRawAmount = hasCustomLimitPrice
        ? customOrderSellRawAmount
        : (debtLimitQuote?.displayDestinationAmountRaw || debtLimitQuote?.displayDestinationAmount || null);
    const debtLimitLilSwapFee = debtLimitQuote?.lilSwapFee?.finalFeeBps && debtLimitQuote.lilSwapFee.finalFeeBps > 0
        ? debtLimitQuote.lilSwapFee
        : null;
    const debtLimitLilSwapFeeAmount = useMemo(() => {
        if (!debtLimitLilSwapFee?.estimatedAmountRaw || !toToken) {
            return null;
        }

        try {
            const formatted = formatUnits(BigInt(debtLimitLilSwapFee.estimatedAmountRaw), toToken.decimals || 18);
            const numeric = parseFloat(formatted);

            if (!Number.isFinite(numeric)) {
                return null;
            }

            return numeric < 0.00001
                ? `< 0.00001 ${getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol}`
                : `${numeric.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol}`;
        } catch {
            return null;
        }
    }, [debtLimitLilSwapFee?.estimatedAmountRaw, toToken, localMarketAssets]);

    const limitOutputValue = useMemo(() => {
        if (displayDestinationRawAmount && toToken) {
            return formatRawAmountForDisplay(displayDestinationRawAmount, toToken.decimals || 18);
        }

        const computed = computeLimitOutputDisplay(
            limitInputValue,
            canonicalLimitPrice,
            canonicalPriceBaseToken?.symbol || '',
            canonicalPriceQuoteToken?.symbol || '',
            canonicalPriceInverted,
        );

        if (computed) {
            return computed;
        }

        const sourceAmount = parseFloat(limitInputValue || '0');
        const price = parseFloat(canonicalLimitPrice || '0');

        if (!Number.isFinite(sourceAmount) || !Number.isFinite(price) || sourceAmount <= 0 || price <= 0) {
            return '';
        }

        return formatPlainAmount(sourceAmount * price);
    }, [displayDestinationRawAmount, toToken, limitInputValue, canonicalLimitPrice, canonicalPriceBaseToken, canonicalPriceQuoteToken, canonicalPriceInverted, formatPlainAmount, formatRawAmountForDisplay]);

    /**
     * Cost margin ratio derived from the quote.
     *
     * For BUY Debt Limit orders the CoW orderbook quote includes a cost
     * envelope (network costs, solver fees, slippage) reflected in
     * `finalMaxSellAmount` vs the bare `quoteSellAmount`.  When the user
     * overrides the limit price we must apply the same proportional margin
     * to the custom sell amount so that solvers have room to cover their
     * execution costs — otherwise the order will never be filled.
     *
     * costMarginBps is expressed in basis points (10000 = 1x, 10350 ≈ +3.5%).
     */
    const costMarginBps = useMemo(() => {
        const maxSell = debtLimitQuote?.finalMaxSellAmount || debtLimitQuote?.orderSellAmountRaw;
        const baseSell = debtLimitQuote?.quoteSellAmount;
        if (!maxSell || !baseSell) return 10000n;
        try {
            const max = BigInt(maxSell);
            const base = BigInt(baseSell);
            if (base <= 0n) return 10000n;
            const bps = (max * 10000n) / base;
            // Sanity clamp: margin should be between 0% and 20%
            return bps < 10000n ? 10000n : bps > 12000n ? 12000n : bps;
        } catch {
            return 10000n;
        }
    }, [debtLimitQuote?.finalMaxSellAmount, debtLimitQuote?.orderSellAmountRaw, debtLimitQuote?.quoteSellAmount]);

    const limitOutputAmount = useMemo(() => {
        if (hasCustomLimitPrice) {
            if (!customOrderSellRawAmount) return 0n;
            return BigInt(customOrderSellRawAmount);
        }

        if (!orderSellRawAmount) {
            return 0n;
        }

        try {
            return BigInt(orderSellRawAmount);
        } catch {
            return 0n;
        }
    }, [orderSellRawAmount, hasCustomLimitPrice, customOrderSellRawAmount, costMarginBps]);

    const limitInputSecondaryValue = useMemo(() => {
        if (!fromToken) {
            return null;
        }

        if (isUSDMode) {
            if (limitInputAmount === 0n) {
                return `0 ${getDisplaySymbol(fromToken, localMarketAssets) || fromToken.symbol}`;
            }

            try {
                return formatCompactToken(
                    formatUnits(limitInputAmount, fromToken.decimals || 18),
                    getDisplaySymbol(fromToken, localMarketAssets) || fromToken.symbol,
                );
            } catch {
                return null;
            }
        }

        const rawPrice = parseFloat(fromToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
        const amount = parseFloat(limitInputValue || '0');

        return formatUSD(amount * (Number.isFinite(price) ? price : 0));
    }, [fromToken, limitInputValue, isUSDMode, limitInputAmount, localMarketAssets]);

    const limitOutputTokenAmount = useMemo(() => {
        // Never let a stale/computed input override a real quote amount.
        // Manual output is only authoritative while the user is editing the receive field.
        if (hasCustomLimitPrice && isEditingLimitOutputRef.current && limitOutputInputValue) return limitOutputInputValue;
        return limitOutputValue;
    }, [hasCustomLimitPrice, limitOutputInputValue, limitOutputValue]);

    const limitOutputDisplayValue = useMemo(() => {
        if (!toToken) {
            return '';
        }

        if (!isUSDMode) {
            return limitOutputTokenAmount;
        }

        const rawPrice = parseFloat(toToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
        const amount = parseFloat(limitOutputTokenAmount || '0');

        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
            return '';
        }

        return (amount * price).toFixed(2);
    }, [isUSDMode, limitOutputTokenAmount, toToken]);

    const limitOutputSecondaryValue = useMemo(() => {
        if (!toToken) {
            return null;
        }

        if (isUSDMode) {
            return limitOutputTokenAmount
                ? formatCompactToken(limitOutputTokenAmount, getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol)
                : `0 ${getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol}`;
        }

        const rawPrice = parseFloat(toToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
        const amount = parseFloat(limitOutputTokenAmount || '0');

        return formatUSD(amount * (Number.isFinite(price) ? price : 0));
    }, [toToken, limitOutputTokenAmount, isUSDMode, localMarketAssets]);

    useEffect(() => {
        hasCustomLimitPriceRef.current = hasCustomLimitPrice;
    }, [hasCustomLimitPrice]);

    useEffect(() => {
        if (isEditingLimitOutputRef.current) return;
        if (swapMode !== 'limit') return;

        const computed = computeLimitOutputDisplay(
            limitInputValue,
            canonicalLimitPrice,
            canonicalPriceBaseToken?.symbol || '',
            canonicalPriceQuoteToken?.symbol || '',
            canonicalPriceInverted,
        );

        if (displayDestinationRawAmount && toToken) {
            setLimitOutputInputValue(formatRawAmountForDisplay(displayDestinationRawAmount, toToken.decimals || 18));
        } else if (hasCustomLimitPrice && computed) {
            setLimitOutputInputValue(computed);
        } else {
            setLimitOutputInputValue('');
        }

        if ((import.meta as any).env.DEV && computed) {
            logger.debug('[DebtSwapModal][DEV] Output display computation', {
                rawInput: limitPriceInput,
                canonicalLimitPrice,
                parsedLimitPriceNumber: parseFloat(canonicalLimitPrice || '0'),
                formattedLimitPrice: formatPlainAmount(parseFloat(canonicalLimitPrice || '0')),
                sourceAmount: limitInputValue,
                expectedOutputByPrice: computed,
                actualDisplayedOutput: computed,
                priceBaseToken: canonicalPriceBaseToken?.symbol,
                priceQuoteToken: canonicalPriceQuoteToken?.symbol,
                priceInverted: canonicalPriceInverted,
            });
        }
    }, [canonicalLimitPrice, limitInputValue, displayDestinationRawAmount, toToken, swapMode, formatPlainAmount, formatRawAmountForDisplay, canonicalPriceBaseToken, canonicalPriceQuoteToken, canonicalPriceInverted, hasCustomLimitPrice]);

    useEffect(() => {
        isEditingLimitOutputRef.current = false;
    }, [isUSDMode]);

    useEffect(() => {
        if (swapMode !== 'limit') return;
        isEditingLimitOutputRef.current = false;
    }, [limitInputAmount, swapMode]);

    const resetDebtLimitPreparedState = useCallback(() => {
        setDebtLimitPrepareResult(null);
        setDebtLimitPrepareError(null);
        setLimitDelegationStatus('idle');
        setDebtLimitDelegationSignature(null);
        setDebtLimitSubmitResult(null);
        setDebtLimitSubmitError(null);
        setDebtLimitOrderSignatureResult(null);
        setDebtLimitOrderSignatureError(null);
        setDebtLimitPostResult(null);
        setDebtLimitPostError(null);
    }, []);

    const togglePriceLimitDisplay = useCallback(() => {
        setPriceLimitDisplayInverted((prev) => {
            const nextInverted = !prev;
            const price = parseFloat(canonicalLimitPrice || '0');
            skipNextLimitPriceInputDebounceRef.current = true;
            setLimitPriceInput(Number.isFinite(price) && price > 0
                ? formatPlainAmount(nextInverted ? price : 1 / price)
                : ''
            );
            setLimitPriceInputError(null);
            resetDebtLimitPreparedState();
            return nextInverted;
        });
    }, [canonicalLimitPrice, formatPlainAmount, resetDebtLimitPreparedState]);

    const handleLimitOutputChange = useCallback((rawValue: string) => {
        const normalized = normalizeDecimalInput(rawValue);
        isEditingLimitOutputRef.current = true;

        let tokenAmount: number;

        if (isUSDMode) {
            const usdValue = parseFloat(normalized || '0');
            const rawPrice = parseFloat(toToken?.priceInUSD || '0');
            const tokenPrice = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
            if (!Number.isFinite(usdValue) || !Number.isFinite(tokenPrice) || tokenPrice <= 0 || usdValue <= 0) {
                setLimitOutputInputValue('');
                return;
            }
            tokenAmount = usdValue / tokenPrice;
            setLimitOutputInputValue(formatPlainAmount(tokenAmount));
        } else {
            tokenAmount = parseFloat(normalized || '0');
            setLimitOutputInputValue(normalized);
        }

        const inputNum = parseFloat(limitInputValue || '0');

        if (!Number.isFinite(tokenAmount) || !Number.isFinite(inputNum) || tokenAmount <= 0 || inputNum <= 0) {
            return;
        }

        // The user-typed output value is fee-inclusive (it mirrors "Receive at most").
        // To derive the fee-exclusive canonical price (which matches how displayLimitPrice
        // is calculated), subtract the network fee before dividing.
        let feeExclusiveTokenAmount = tokenAmount;
        if (debtLimitQuote?.quoteFeeAmount && toToken) {
            try {
                const feeF = parseFloat(formatUnits(BigInt(debtLimitQuote.quoteFeeAmount), toToken.decimals || 18));
                if (Number.isFinite(feeF) && feeF > 0 && feeF < tokenAmount) {
                    feeExclusiveTokenAmount = tokenAmount - feeF;
                }
            } catch {
                // Ignore – fall back to unmodified tokenAmount
            }
        }

        const canonicalPrice = feeExclusiveTokenAmount / inputNum;
        const nextLimitPrice = formatPlainAmount(canonicalPrice);
        setLimitPrice(nextLimitPrice);
        setCanonicalLimitPrice(nextLimitPrice);
        setCanonicalPriceInverted(priceLimitDisplayInverted);
        setHasCustomLimitPrice(true);
        skipNextLimitPriceInputDebounceRef.current = true;

        if (priceLimitDisplayInverted) {
            setLimitPriceInput(nextLimitPrice);
        } else {
            setLimitPriceInput(Number.isFinite(1 / canonicalPrice) && canonicalPrice > 0
                ? formatPlainAmount(1 / canonicalPrice)
                : ''
            );
        }
        setLimitPriceInputError(null);

        setLimitPriceCommitNonce((n) => n + 1);
        resetDebtLimitPreparedState();
    }, [limitInputValue, priceLimitDisplayInverted, isUSDMode, toToken, formatPlainAmount, resetDebtLimitPreparedState, debtLimitQuote?.quoteFeeAmount]);

    const displayLimitPrice = useMemo(() => {
        return limitPriceInput;
    }, [limitPriceInput]);

    const displayMarketLimitPrice = useMemo(() => {
        const price = parseFloat(marketLimitPrice || '0');
        if (!Number.isFinite(price) || price <= 0) {
            return '';
        }

        return priceLimitDisplayInverted ? (Number.isFinite(1 / price) ? formatPlainAmount(1 / price) : marketLimitPrice) : marketLimitPrice;
    }, [priceLimitDisplayInverted, marketLimitPrice, formatPlainAmount]);

    useEffect(() => {
        if (skipNextLimitPriceInputDebounceRef.current) {
            skipNextLimitPriceInputDebounceRef.current = false;
            return;
        }

        if (swapMode !== 'limit') {
            return;
        }

        const normalizedPrice = normalizeDecimalInput(limitPriceInput);
        setLimitPriceInputError(null);

        const displayPrice = parseFloat(normalizedPrice || '0');
        const nextCanonicalPrice = Number.isFinite(displayPrice) && displayPrice > 0
            ? formatPlainAmount(priceLimitDisplayInverted ? displayPrice : 1 / displayPrice)
            : '';

        const nextCanonicalLimitPrice = nextCanonicalPrice;

        if (nextCanonicalPrice === limitPrice && nextCanonicalLimitPrice === canonicalLimitPrice) {
            return;
        }

        setLimitPrice(nextCanonicalPrice);
        setCanonicalLimitPrice(nextCanonicalLimitPrice);
        setCanonicalPriceInverted(priceLimitDisplayInverted);
        setLimitPriceCommitNonce((value) => value + 1);
        resetDebtLimitPreparedState();

        if ((import.meta as any).env.DEV) {
            const sourceAmount = limitInputValue;
            logger.debug('[DebtSwapModal][DEV] Price debounce', {
                rawInput: limitPriceInput,
                canonicalLimitPrice: nextCanonicalLimitPrice,
                parsedLimitPriceNumber: nextCanonicalPrice,
                sourceAmount,
                expectedOutputByPrice: computeLimitOutputDisplay(
                    sourceAmount,
                    nextCanonicalLimitPrice,
                    priceBaseToken?.symbol || '',
                    priceQuoteToken?.symbol || '',
                    priceLimitDisplayInverted,
                ),
                priceBaseToken: priceBaseToken?.symbol,
                priceQuoteToken: priceQuoteToken?.symbol,
                priceInverted: priceLimitDisplayInverted,
            });
        }
    }, [
        swapMode,
        limitPriceInput,
        priceLimitDisplayInverted,
        limitPrice,
        canonicalLimitPrice,
        formatPlainAmount,
        resetDebtLimitPreparedState,
        limitInputValue,
        priceBaseToken,
        priceQuoteToken,
    ]);

    useEffect(() => {
        if (swapMode !== 'limit') return;
        if (!debtLimitQuote) return;

        const quoteMarketLimitPrice = debtLimitQuote.displayLimitPrice || debtLimitQuote.marketLimitPrice || '';
        if (!hasCustomLimitPriceRef.current && quoteMarketLimitPrice) {
            skipNextLimitPriceInputDebounceRef.current = true;
            const quoteDisplayPrice = parseFloat(quoteMarketLimitPrice);
            const invertedPrice = Number.isFinite(quoteDisplayPrice) && quoteDisplayPrice > 0
                ? formatPlainAmount(1 / quoteDisplayPrice)
                : '';
            const displayPrice = priceLimitDisplayInverted
                ? invertedPrice
                : quoteMarketLimitPrice;

            setLimitPriceInput(displayPrice);
            setLimitPriceInputError(null);
            setLimitPrice(Number.isFinite(quoteDisplayPrice) && quoteDisplayPrice > 0 ? quoteMarketLimitPrice : '');
            setCanonicalLimitPrice(Number.isFinite(quoteDisplayPrice) && quoteDisplayPrice > 0 ? quoteMarketLimitPrice : '');
            setCanonicalPriceInverted(priceLimitDisplayInverted);
            setLimitPriceCommitNonce((value) => value + 1);

            if ((import.meta as any).env.DEV) {
                logger.debug('[DebtSwapModal][DEV] Quote market price init', {
                    rawQuoteMarketLimitPrice: quoteMarketLimitPrice,
                    quoteDisplayPrice,
                    invertedPrice,
                    displayPrice,
                    canonicalLimitPrice: priceLimitDisplayInverted
                        ? formatPlainAmount(1 / parseFloat(quoteMarketLimitPrice))
                        : invertedPrice,
                    priceLimitDisplayInverted,
                    expectedOutput: computeLimitOutputDisplay(
                        limitInputValue,
                        invertedPrice,
                        priceBaseToken?.symbol || '',
                        priceQuoteToken?.symbol || '',
                        false,
                    ),
                });
            }
        }

        isEditingLimitOutputRef.current = false;

        logger.debug('[DebtSwapModal][Limit] Quote display amount selection', {
            sourceAmountRaw: debtLimitQuote.displaySourceAmount || debtLimitQuote.orderBuyAmount || debtLimitQuote.buyAmount,
            displayReceiveAtMostRaw: debtLimitQuote.displayDestinationAmountRaw || debtLimitQuote.displayDestinationAmount,
            displayReceiveAtMostFormatted: debtLimitQuote.displayDestinationAmountFormatted,
            orderSellAmountRaw: debtLimitQuote.orderSellAmountRaw || debtLimitQuote.orderSellAmount || debtLimitQuote.finalMaxSellAmount || debtLimitQuote.sellAmount,
            finalMaxSellAmount: debtLimitQuote.finalMaxSellAmount,
            quoteSellAmount: debtLimitQuote.quoteSellAmount,
            quoteFeeAmount: debtLimitQuote.quoteFeeAmount,
            quoteResponseQuoteSellAmount: (debtLimitQuote.debug?.amountSelection as any)?.sellTokenCandidatesRaw?.quoteResponseQuoteSellAmount,
            quoteResponseQuoteFeeAmount: (debtLimitQuote.debug?.amountSelection as any)?.sellTokenCandidatesRaw?.quoteResponseQuoteFeeAmount,
            beforeAllFeesSellAmount: (debtLimitQuote.amountsAndCosts?.beforeAllFees as any)?.sellAmount,
            amountsToSignSellAmount: (debtLimitQuote.amountsAndCosts?.amountsToSign as any)?.sellAmount,
            orderToSignSellAmount: (debtLimitQuote.orderToSign as any)?.sellAmount,
            beforeNetworkCostsSellAmount: (debtLimitQuote.amountsAndCosts?.beforeNetworkCosts as any)?.sellAmount,
            afterNetworkCostsSellAmount: (debtLimitQuote.amountsAndCosts?.afterNetworkCosts as any)?.sellAmount,
            afterPartnerFeesSellAmount: (debtLimitQuote.amountsAndCosts?.afterPartnerFees as any)?.sellAmount,
            afterSlippageSellAmount: (debtLimitQuote.amountsAndCosts?.afterSlippage as any)?.sellAmount,
            selectedDisplayAmountSource: debtLimitQuote.debug?.amountSelection
                ? (debtLimitQuote.debug.amountSelection as any).selectedDisplayAmountSource
                : 'quote.displayDestinationAmount',
            priceDisplayAmount: debtLimitQuote.marketLimitPrice,
            displayLimitPrice: debtLimitQuote.displayLimitPrice,
            normalizedCandidates: (debtLimitQuote.debug?.amountSelection as any)?.sellTokenCandidatesFormatted,
        });

        const displayReceiveAtMostRaw = debtLimitQuote.displayDestinationAmountRaw || debtLimitQuote.displayDestinationAmount;
        const orderSellAmountRaw = debtLimitQuote.orderSellAmountRaw || debtLimitQuote.orderSellAmount || debtLimitQuote.finalMaxSellAmount || debtLimitQuote.sellAmount;

        if (
            (import.meta as any).env.DEV &&
            displayReceiveAtMostRaw &&
            orderSellAmountRaw &&
            displayReceiveAtMostRaw !== orderSellAmountRaw
        ) {
            logger.warn('[DebtSwapModal][Limit] Display amount differs from order max sell amount', {
                displayReceiveAtMostRaw,
                orderSellAmountRaw,
            });
        }

        if (
            (import.meta as any).env.DEV &&
            displayReceiveAtMostRaw &&
            orderSellAmountRaw &&
            displayReceiveAtMostRaw === orderSellAmountRaw &&
            debtLimitQuote.quoteSellAmount &&
            debtLimitQuote.quoteSellAmount !== orderSellAmountRaw
        ) {
            logger.warn('[DebtSwapModal][Limit] Display amount equals order max sell while quote sell differs', {
                displayReceiveAtMostRaw,
                orderSellAmountRaw,
                quoteSellAmount: debtLimitQuote.quoteSellAmount,
            });
        }
    }, [debtLimitQuote, swapMode, priceLimitDisplayInverted, formatPlainAmount, limitInputValue, priceBaseToken, priceQuoteToken]);

    useEffect(() => {
        if (swapMode !== 'limit') return;
        if (!debtLimitQuote && !isDebtLimitQuoteLoading) {
            resetDebtLimitPreparedState();
        }
    }, [debtLimitQuote, isDebtLimitQuoteLoading, swapMode, resetDebtLimitPreparedState]);

    useEffect(() => {
        if (swapMode !== 'limit' || !debtLimitQuoteError) return;
        resetDebtLimitPreparedState();
    }, [debtLimitQuoteError, swapMode, resetDebtLimitPreparedState]);

    const handlePrepareLimitSwap = useCallback(async (): Promise<DebtLimitPrepareResult | null> => {
        if (swapMode !== 'limit') return null;
        if (!isOpen || !debtLimitQuote) return null;
        const orderBuyAmount = orderBuyRawAmount || limitInputAmount.toString();
        if (!account || !fromToken || !toToken || !debtLimitValidTo || limitInputAmount <= 0n || limitOutputAmount <= 0n) return null;

        const varDebtToken = toDebtTokenAddress || toToken.variableDebtTokenAddress;
        if (!varDebtToken) {
            logger.debug('[DebtSwapModal][Limit] Cannot prepare: variableDebtTokenAddress not resolved');
            return null;
        }

        const chainId = effectiveChainId;
        const marketKeyToUse = initialMarketKey || effectiveNetwork?.key || null;
        const validTo = debtLimitValidTo;

        const params = {
            walletAddress: account,
            chainId,
            marketKey: marketKeyToUse,
            fromToken: {
                address: fromToken.address || fromToken.underlyingAsset || '',
                decimals: fromToken.decimals ?? 18,
                symbol: fromToken.symbol ?? '',
            },
            toToken: {
                address: toToken.address || toToken.underlyingAsset || '',
                decimals: toToken.decimals ?? 18,
                symbol: toToken.symbol ?? '',
                variableDebtTokenAddress: varDebtToken,
            },
            sellAmount: limitOutputAmount.toString(),
            buyAmount: orderBuyAmount,
            validTo,
            quoteId: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteId,
            quoteSellAmount: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteSellAmount,
            quoteFeeAmount: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteFeeAmount,
            finalMaxSellAmount: hasCustomLimitPrice
                ? limitOutputAmount.toString()
                : debtLimitQuote?.orderSellAmountRaw || debtLimitQuote?.orderSellAmount || debtLimitQuote?.finalMaxSellAmount || debtLimitQuote?.sellAmount,
            ...getPriceMetadata(),
            orderType: 'limit' as const,
        };

        logger.debug('[DebtSwapModal][Limit] handlePrepareLimitSwap', {
            chainId, from: params.fromToken.symbol, to: params.toToken.symbol,
            sellAmount: params.sellAmount, buyAmount: params.buyAmount,
        });

        setIsPreparingDebtLimit(true);
        setDebtLimitPrepareError(null);
        const requestId = ++debtLimitPrepareRequestRef.current;
        try {
            const result = await prepareDebtLimitSwap(params);
            if (requestId !== debtLimitPrepareRequestRef.current) return null;
            setDebtLimitPrepareResult(result);
            logger.debug('[DebtSwapModal][Limit] Prepare result', {
                instanceAddress: result.instanceAddress,
                approvalToken: result.approval.token,
                approvalSpender: result.approval.spender,
                orderDraft: result.orderDraft,
            });
            return result;
        } catch (err: any) {
            if (requestId !== debtLimitPrepareRequestRef.current) return null;
            logger.warn('[DebtSwapModal][Limit] Prepare failed', { message: err.message });
            setDebtLimitPrepareError(err?.message || 'Unable to prepare limit swap.');
            return null;
        } finally {
            if (requestId === debtLimitPrepareRequestRef.current) {
                setIsPreparingDebtLimit(false);
            }
        }
    }, [swapMode, isOpen, account, fromToken, toToken, limitInputAmount, limitOutputAmount, debtLimitValidTo, hasCustomLimitPrice, debtLimitQuote, toDebtTokenAddress, effectiveNetwork, initialMarketKey, orderBuyRawAmount, customUserLimitPrice, getUserLimitPrice, getPriceMetadata]);

    /**
     * Phase 4 (revised): Sign an EIP-712 DelegationWithSig permit for the destination variableDebtToken.
     * This is a SIGNED MESSAGE (signTypedData), NOT an on-chain transaction.
     * The wallet shows a typed-data signature prompt — no "Transfer Assets Ownership" dialog.
     *
     * Mirrors the existing Market flow in generateAndCachePermit (use-debt-switch-actions.ts).
     * Key differences:
     *   - delegatee = debtLimitPrepareResult.approval.spender (adapter instance, not fixed adapterAddress)
     *   - value     = debtLimitPrepareResult.approval.amount  (exact amount from prepare, not max uint256)
     *   - deadline  = debtLimitPrepareResult.validTo          (expiry set by the prepare call)
     *
     * Scoped 100% to Limit tab. Does NOT post any order.
     */
    const handleSignLimitDelegation = useCallback(async (
        prepareResultOverride?: DebtLimitPrepareResult | null,
    ) => {
        if (swapMode !== 'limit') return null;
        const prepareResult = prepareResultOverride || debtLimitPrepareResult;
        if (!prepareResult || !account || !walletClient || !publicClient) return null;
        setLimitDelegationStatus('pending');

        const { token: debtTokenAddr, spender: delegatee, amount } = prepareResult.approval;
        if (!debtTokenAddr || !delegatee || !amount) {
            logger.warn('[DebtSwapModal][Limit] Sign delegation skipped: missing approval fields');
            setLimitDelegationStatus('failed');
            return null;
        }

        const chainId = effectiveChainId;

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }
        } catch (err: any) {
            logger.warn('[DebtSwapModal][Limit] Chain switch failed', { message: err.message });
            setLimitDelegationStatus('failed');
            setDebtLimitSubmitError(err?.message || 'Unable to switch network.');
            return null;
        }

        // Read nonce + token name from the variableDebtToken contract
        let nonce: bigint = 0n;
        let tokenName: string = '';
        try {
            const results = await publicClient.multicall({
                contracts: [
                    {
                        address: getAddress(debtTokenAddr),
                        abi: parseAbi(ABIS.DEBT_TOKEN),
                        functionName: 'nonces',
                        args: [getAddress(account)],
                    },
                    {
                        address: getAddress(debtTokenAddr),
                        abi: parseAbi(ABIS.DEBT_TOKEN),
                        functionName: 'name',
                    },
                ] as any,
                allowFailure: true,
            });
            nonce = results[0]?.status === 'success' ? (results[0].result as bigint) : 0n;
            tokenName = results[1]?.status === 'success' ? (results[1].result as string) : '';
            if (!tokenName) {
                tokenName = await publicClient.readContract({
                    address: getAddress(debtTokenAddr),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
                    functionName: 'name',
                }) as string;
            }
        } catch (err: any) {
            logger.warn('[DebtSwapModal][Limit] Failed to read debt token nonce/name', { message: err.message });
            setLimitDelegationStatus('failed');
            setDebtLimitSubmitError(err?.message || 'Unable to prepare delegation signature.');
            return null;
        }

        // Use validTo from the prepare result as the permit deadline
        const deadline = BigInt(prepareResult.validTo);
        const value = BigInt(amount);
        const delegateeAddr = getAddress(delegatee);

        const domain = { name: tokenName, version: '1', chainId, verifyingContract: getAddress(debtTokenAddr) };
        const types = {
            DelegationWithSig: [
                { name: 'delegatee', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
            ],
        };
        const message = { delegatee: delegateeAddr, value, nonce, deadline };

        logger.debug('[DebtSwapModal][Limit] Requesting delegation signature (signTypedData)', {
            debtToken: debtTokenAddr, delegatee, amount, deadline: deadline.toString(), nonce: nonce.toString(), chainId,
        });

        try {
            const signature = await walletClient.signTypedData({
                account: getAddress(account),
                domain,
                types,
                primaryType: 'DelegationWithSig',
                message,
            });

            const r = `0x${signature.substring(2, 66)}` as `0x${string}`;
            const s = `0x${signature.substring(66, 130)}` as `0x${string}`;
            const v = parseInt(signature.substring(130, 132), 16);

            const permit = { amount: value, deadline: Number(deadline), v, r, s };
            setDebtLimitDelegationSignature(permit);
            setLimitDelegationStatus('signed');
            setDebtLimitSubmitResult(null);
            setDebtLimitSubmitError(null);
            setDebtLimitOrderSignatureResult(null);
            setDebtLimitOrderSignatureError(null);
            setDebtLimitPostResult(null);
            setDebtLimitPostError(null);

            logger.debug('[DebtSwapModal][Limit] Delegation permit signed', {
                delegatee,
                deadline: Number(deadline),
                v,
                r: r.slice(0, 12) + '…',
                s: s.slice(0, 12) + '…',
            });
            return permit;
        } catch (err: any) {
            logger.warn('[DebtSwapModal][Limit] Delegation signature failed', { message: err.message });
            setLimitDelegationStatus('failed');
            setDebtLimitSubmitError(err?.message || 'Unable to sign delegation.');
            return null;
        }
    }, [swapMode, debtLimitPrepareResult, account, walletClient, publicClient, effectiveNetwork]);

    const handleSubmitLimitOrder = useCallback(async (
        delegationSignatureOverride?: NonNullable<typeof debtLimitDelegationSignature>,
        prepareResultOverride?: DebtLimitPrepareResult | null,
    ) => {
        if (swapMode !== 'limit') return null;
        const prepareResult = prepareResultOverride || debtLimitPrepareResult;
        const delegationSignature = delegationSignatureOverride || debtLimitDelegationSignature;
        if (!prepareResult || !delegationSignature || !account || !fromToken || !toToken) return null;
        if (!debtLimitQuote) {
            setDebtLimitSubmitError('Limit quote required before signing limit order.');
            return null;
        }

        const varDebtToken = toDebtTokenAddress || toToken.variableDebtTokenAddress;
        if (!varDebtToken) {
            setDebtLimitSubmitError('Unable to submit limit order. Limit swap is not ready.');
            return null;
        }

        setIsSubmittingDebtLimit(true);
        setDebtLimitSubmitError(null);
        setDebtLimitSubmitResult(null);
        setDebtLimitOrderSignatureResult(null);
        setDebtLimitOrderSignatureError(null);
        setDebtLimitPostResult(null);
        setDebtLimitPostError(null);

        try {
            const orderBuyAmount = orderBuyRawAmount || limitInputAmount.toString();
            const result = await submitDebtLimitSwap({
                walletAddress: account,
                chainId: effectiveChainId,
                marketKey: initialMarketKey || effectiveNetwork?.key || null,
                fromToken: {
                    address: fromToken.address || fromToken.underlyingAsset || '',
                    decimals: fromToken.decimals ?? 18,
                    symbol: fromToken.symbol ?? '',
                },
                toToken: {
                    address: toToken.address || toToken.underlyingAsset || '',
                    decimals: toToken.decimals ?? 18,
                    symbol: toToken.symbol ?? '',
                    variableDebtTokenAddress: varDebtToken,
                },
                sellAmount: limitOutputAmount.toString(),
                buyAmount: orderBuyAmount,
                validTo: prepareResult.validTo,
                quoteId: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteId,
                quoteSellAmount: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteSellAmount,
                quoteFeeAmount: hasCustomLimitPrice ? undefined : debtLimitQuote?.quoteFeeAmount,
                finalMaxSellAmount: hasCustomLimitPrice
                    ? limitOutputAmount.toString()
                    : debtLimitQuote?.orderSellAmountRaw || debtLimitQuote?.orderSellAmount || debtLimitQuote?.finalMaxSellAmount || debtLimitQuote?.sellAmount,
                ...getPriceMetadata(),
                orderType: 'limit',
                approvedAddress: prepareResult.instanceAddress,
                delegationPermit: {
                    amount: delegationSignature.amount.toString(),
                    deadline: delegationSignature.deadline,
                    v: delegationSignature.v,
                    r: delegationSignature.r,
                    s: delegationSignature.s,
                },
            });

            setDebtLimitSubmitResult(result);
            return result;
        } catch (err: any) {
            if (err?.code === 'INSTANCE_ADDRESS_CHANGED') {
                setDebtLimitDelegationSignature(null);
                setLimitDelegationStatus('idle');
                setDebtLimitPrepareResult(null);
                setDebtLimitSubmitResult(null);
                setDebtLimitOrderSignatureResult(null);
                setDebtLimitOrderSignatureError(null);
                setDebtLimitPostResult(null);
                setDebtLimitPostError(null);
                setDebtLimitSubmitError('Limit order parameters changed. Please review the limit swap and sign again.');
            } else {
                setDebtLimitSubmitError(err?.message || 'Unable to submit limit order.');
            }
            return null;
        } finally {
            setIsSubmittingDebtLimit(false);
        }
    }, [
        swapMode,
        debtLimitPrepareResult,
        debtLimitDelegationSignature,
        account,
        fromToken,
        toToken,
        effectiveNetwork,
        initialMarketKey,
        toDebtTokenAddress,
        limitOutputAmount,
        limitInputAmount,
        hasCustomLimitPrice,
        debtLimitQuote,
        orderBuyRawAmount,
        customUserLimitPrice,
        getPriceMetadata,
    ]);

    const handleSignLimitOrder = useCallback(async (
        submitResultOverride?: DebtLimitSubmitResult | null,
    ) => {
        if (swapMode !== 'limit') return null;
        if (!walletClient || !account || (!debtLimitDelegationSignature && !submitResultOverride)) return null;

        const submitResult = submitResultOverride?.signatureRequest
            ? submitResultOverride
            : debtLimitSubmitResult?.signatureRequest
                ? debtLimitSubmitResult
                : await handleSubmitLimitOrder();

        if (!submitResult) return null;

        const { signatureRequest } = submitResult;
        if (!signatureRequest) {
            setDebtLimitOrderSignatureError('Unable to sign limit order. Missing backend typed-data signature request.');
            return null;
        }

        if (signatureRequest.type !== 'typedData') {
            setDebtLimitOrderSignatureError(`Unable to sign limit order. Unsupported signature request type: ${signatureRequest.type}`);
            return null;
        }

        setIsSigningDebtLimitOrder(true);
        setDebtLimitOrderSignatureError(null);
        setDebtLimitOrderSignatureResult(null);

        try {
            const signature = await walletClient.signTypedData({
                account: getAddress(account),
                domain: signatureRequest.domain as any,
                types: signatureRequest.types as any,
                primaryType: signatureRequest.primaryType as any,
                message: signatureRequest.message as any,
            });

            const signedOrder = {
                signature,
                signatureRequest,
            };
            setDebtLimitOrderSignatureResult(signedOrder);
            return signedOrder;
        } catch (err: any) {
            setDebtLimitOrderSignatureError(err?.message || 'Unable to sign limit order.');
            return null;
        } finally {
            setIsSigningDebtLimitOrder(false);
        }
    }, [
        swapMode,
        walletClient,
        account,
        debtLimitDelegationSignature,
        debtLimitSubmitResult,
        handleSubmitLimitOrder,
    ]);

    const handlePostLimitOrder = useCallback(async (
        orderSignatureOverride?: NonNullable<typeof debtLimitOrderSignatureResult>,
        submitResultOverride?: DebtLimitSubmitResult | null,
    ) => {
        if (swapMode !== 'limit') return null;
        const submitResult = submitResultOverride || debtLimitSubmitResult;
        const orderSignatureResult = orderSignatureOverride || debtLimitOrderSignatureResult;
        if (!account || !submitResult || !orderSignatureResult) return null;

        // Posting is allowed only when this Limit flow has a backend Debt Limit
        // quote. This prevents submitting orders from stale spot/market amounts.
        if (debtLimitQuoteState !== 'quoteReady' || !debtLimitQuote) {
            setDebtLimitPostError('Limit quote required before submitting.');
            return null;
        }

        const { limitOrder, swapSettings, instanceAddress } = submitResult;
        if (!limitOrder || !swapSettings || !instanceAddress) {
            setDebtLimitPostError('Unable to post limit order. Missing signed order payload from submit response.');
            return null;
        }

        setIsPostingDebtLimitOrder(true);
        setDebtLimitPostError(null);
        setDebtLimitPostResult(null);

        try {
            const result = await postDebtLimitSwap({
                walletAddress: account,
                chainId: effectiveChainId,
                marketKey: initialMarketKey || effectiveNetwork?.key || null,
                signature: orderSignatureResult.signature,
                limitOrder,
                swapSettings,
                instanceAddress,
                quoteSellAmount: hasCustomLimitPrice ? undefined : debtLimitQuote.quoteSellAmount,
                quoteFeeAmount: hasCustomLimitPrice ? undefined : debtLimitQuote.quoteFeeAmount,
                finalMaxSellAmount: hasCustomLimitPrice
                    ? limitOutputAmount.toString()
                    : debtLimitQuote.orderSellAmountRaw || debtLimitQuote.orderSellAmount || debtLimitQuote.finalMaxSellAmount || debtLimitQuote.sellAmount,
                fromToken: {
                    address: fromToken?.address || fromToken?.underlyingAsset || '',
                    decimals: fromToken?.decimals ?? 18,
                    symbol: fromToken?.symbol || '',
                },
                toToken: {
                    address: toToken?.address || toToken?.underlyingAsset || '',
                    decimals: toToken?.decimals ?? 18,
                    symbol: toToken?.symbol || '',
                },
                fromAmount: limitInputValue,
                toAmount: limitOutputValue,
                limitPrice,
                ...getPriceMetadata(),
                priceSource: 'limit_quote',
                priceInverted: false,
                rawQuote: debtLimitQuote,
            });

            setDebtLimitPostResult(result);
            setDebtLimitSubmitResult((current) => current
                ? { ...current, status: 'submitted', orderId: result.orderId, instanceAddress: result.instanceAddress }
                : current);
            return result;
        } catch (err: any) {
            setDebtLimitPostError(err?.message || 'Unable to post limit order.');
            return null;
        } finally {
            setIsPostingDebtLimitOrder(false);
        }
    }, [
        swapMode,
        account,
        debtLimitSubmitResult,
        debtLimitOrderSignatureResult,
        debtLimitQuoteState,
        debtLimitQuote,
        hasCustomLimitPrice,
        limitOutputAmount,
        customUserLimitPrice,
        limitOutputValue,
        limitPrice,
        getPriceMetadata,
        effectiveNetwork,
        initialMarketKey,
    ]);

    const debtLimitOrderLink = useMemo(() => {
        const orderId = debtLimitPostResult?.orderId || debtLimitSubmitResult?.orderId;
        if (!orderId) return null;

        const chainSlugById: Record<number, string> = {
            1: 'eth',
            100: 'gno',
            137: 'pol',
            42161: 'arb1',
            8453: 'base',
            43114: 'avax',
        };
        const chainSlug = chainSlugById[effectiveChainId] || String(effectiveChainId);
        return `https://explorer.cow.fi/${chainSlug}/orders/${orderId}`;
    }, [debtLimitPostResult?.orderId, debtLimitSubmitResult?.orderId, effectiveChainId]);

    const isDebtLimitMainActionBusy =
        isPreparingDebtLimit ||
        limitDelegationStatus === 'pending' ||
        isSubmittingDebtLimit ||
        isSigningDebtLimitOrder ||
        isPostingDebtLimitOrder;

    const debtLimitMainActionLabel = useMemo(() => {
        if (debtLimitSubmitResult?.status === 'submitted' || debtLimitPostResult?.status === 'submitted') {
            return 'Limit order submitted';
        }
        if (limitDelegationStatus === 'pending') return 'Signing delegation...';
        if (isSigningDebtLimitOrder) return 'Signing limit order...';
        if (isPostingDebtLimitOrder) return 'Submitting limit order...';
        if (isSubmittingDebtLimit) return 'Preparing signature...';
        if (!fromToken || !toToken || limitInputAmount <= 0n) return 'Enter amount';
        if (limitPriceInputError) return 'Review limit price';
        if (isDebtLimitQuoteLoading) return 'Getting quote...';
        if (debtLimitQuoteError || debtLimitQuoteState === 'quoteError') return 'Limit quote unavailable';
        return 'Sign & Submit Limit Order';
    }, [
        debtLimitSubmitResult?.status,
        debtLimitPostResult?.status,
        limitDelegationStatus,
        isSigningDebtLimitOrder,
        isPostingDebtLimitOrder,
        isPreparingDebtLimit,
        isSubmittingDebtLimit,
        fromToken,
        toToken,
        limitInputAmount,
        limitPriceInputError,
        isDebtLimitQuoteLoading,
        debtLimitQuoteError,
        debtLimitQuoteState,
    ]);

    const isDebtLimitMainActionDisabled =
        debtLimitSubmitResult?.status === 'submitted' ||
        debtLimitPostResult?.status === 'submitted' ||
        isDebtLimitMainActionBusy ||
        !account ||
        !fromToken ||
        !toToken ||
        limitInputAmount <= 0n ||
        !!limitPriceInputError ||
        limitInputAmount > (debtBalance || 0n) ||
        debtLimitQuoteState !== 'quoteReady' ||
        !debtLimitQuote ||
        !walletClient;

    const handleLimitMainAction = useCallback(async () => {
        if (isDebtLimitMainActionDisabled) return;

        setDebtLimitSubmitError(null);
        setDebtLimitOrderSignatureError(null);
        setDebtLimitPostError(null);
        setDebtLimitPrepareError(null);

        let prepareResult = debtLimitPrepareResult;
        if (!prepareResult) {
            prepareResult = await handlePrepareLimitSwap();
            if (!prepareResult) return;
        }

        let delegationSignature = debtLimitDelegationSignature;
        if (!delegationSignature) {
            delegationSignature = await handleSignLimitDelegation(prepareResult);
            if (!delegationSignature) return;
        }

        const submitResult = debtLimitSubmitResult?.signatureRequest
            ? debtLimitSubmitResult
            : await handleSubmitLimitOrder(delegationSignature, prepareResult);
        if (!submitResult) return;

        let orderSignatureResult = debtLimitOrderSignatureResult;
        if (!orderSignatureResult) {
            orderSignatureResult = await handleSignLimitOrder(submitResult);
            if (!orderSignatureResult) return;
        }

        await handlePostLimitOrder(orderSignatureResult, submitResult);
    }, [
        isDebtLimitMainActionDisabled,
        debtLimitPrepareResult,
        handlePrepareLimitSwap,
        debtLimitDelegationSignature,
        handleSignLimitDelegation,
        debtLimitSubmitResult,
        handleSubmitLimitOrder,
        debtLimitOrderSignatureResult,
        handleSignLimitOrder,
        handlePostLimitOrder,
    ]);

    // Use Approval Hook for ToToken Debt
    const {
        onChainAllowance,
        nonce: preFetchedNonce,
        tokenName: preFetchedTokenName,
        isApproved,
        saveSignature,
        cachedSignature
    } = useApprovalState({
        account,
        tokenAddress: isOpen ? toDebtTokenAddress : null,
        spenderAddress: isOpen ? adapterAddress : null,
        amountRequired,
        isDebt: true,
        chainId: effectiveChainId,
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
    } = useDebtSwitchActions({
        account,
        fromToken,
        toToken,
        allowance: onChainAllowance,
        swapAmount,
        debtBalance,
        swapQuote,
        slippage: executionSlippage,
        recommendedSlippage,
        fetchDebtData: refreshGlobalPosition,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        clearQuoteError,
        selectedNetwork: effectiveNetwork,
        marketKey: initialMarketKey || effectiveNetwork?.key,
        preferPermit,
        adapterAddress,
        debtTokenAddress: toDebtTokenAddress,
        preFetchedNonce,
        preFetchedTokenName,
        onSignatureCached: saveSignature,
        cachedPermit: cachedSignature,
        onTxSent: (hash: string) => {
            const amountDisplay = isUSDMode ? (inputValue ? `$${inputValue}` : '') : (inputValue ? `${inputValue} ${fromToken.symbol}` : '');

            addTransaction({
                hash,
                chainId: effectiveChainId,
                marketKey: effectiveMarketKey,
                description: `Debt Swap`,
                fromTokenSymbol: fromToken.symbol,
                toTokenSymbol: toToken.symbol
            });

            onClose();
        }
    });

    useEffect(() => {
        if (!debtLimitSubmitResult) {
            setDebtLimitOrderSignatureResult(null);
            setDebtLimitOrderSignatureError(null);
            setDebtLimitPostResult(null);
            setDebtLimitPostError(null);
        }
    }, [debtLimitSubmitResult]);

    const isBusy = isActionLoading;
    const isInsufficientBalance = swapAmount > (debtBalance || 0n);

    const getHfColor = useCallback((hf: number) => {
        if (hf === -1 || hf >= 3) return 'text-emerald-500';
        if (hf >= 1.1) return 'text-orange-500';
        return 'text-red-500';
    }, []);

    const formatBalanceAmount = useCallback((value: number) => {
        if (!Number.isFinite(value) || value <= 0) return '0';
        return value >= 1000
            ? `${(value / 1000).toFixed(2)}K`
            : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
    }, []);

    const getTokenUsdPrice = useCallback((token: any) => {
        const tokenAddress = (token?.underlyingAsset || token?.address || '').toLowerCase();
        const marketAsset = (localMarketAssets || []).find(
            asset => (asset.underlyingAsset || asset.address || '').toLowerCase() === tokenAddress
        );
        const marketPrice = parseFloat(marketAsset?.priceInUSD || '0');
        const tokenPrice = parseFloat(token?.priceInUSD || '0');
        const rawPrice = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : tokenPrice;
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
        return Number.isFinite(price) && price > 0 ? price : 0;
    }, [localMarketAssets]);

    const getRawAmountUsd = useCallback((rawAmount: string | undefined | null, token: any) => {
        if (!rawAmount || !token) return null;
        const price = getTokenUsdPrice(token);
        if (price <= 0) return null;

        try {
            const amount = parseFloat(formatUnits(BigInt(rawAmount), token.decimals || 18));
            return Number.isFinite(amount) ? amount * price : null;
        } catch {
            return null;
        }
    }, [getTokenUsdPrice]);

    const debtSwapValueImpact = useMemo(() => {
        if (!swapQuote?.srcAmount || !swapQuote?.destAmount || !fromToken || !toToken) {
            return null;
        }

        const oracleRepaidDebtUsd = getRawAmountUsd(swapQuote.destAmount, fromToken);
        const oracleNewDebtUsd = getRawAmountUsd(swapQuote.srcAmount, toToken);
        const repaidDebtUsd = oracleRepaidDebtUsd ?? parseFloat(swapQuote.priceRoute?.destUSD || '');
        const newDebtUsd = oracleNewDebtUsd ?? parseFloat(swapQuote.priceRoute?.srcUSD || '');

        if (!Number.isFinite(repaidDebtUsd) || !Number.isFinite(newDebtUsd) || repaidDebtUsd <= 0) {
            return null;
        }

        const deltaUsd = newDebtUsd - repaidDebtUsd;
        return {
            repaidDebtUsd,
            newDebtUsd,
            deltaUsd,
            deltaBps: (deltaUsd / repaidDebtUsd) * 10_000,
            usesMarketOracle: oracleRepaidDebtUsd != null && oracleNewDebtUsd != null,
        };
    }, [swapQuote, fromToken, toToken, getRawAmountUsd]);

    const debtSwapBorrowPower = useMemo(() => {
        if (!summary || !swapQuote || !fromToken || !toToken) {
            return null;
        }

        const suppliesToUse = providedSupplies && providedSupplies.length > 0 ? providedSupplies : (supplies || []);
        const marketsToUse = localMarketAssets || [];
        const currentBorrowsUsd = parseFloat(summary.totalBorrowsUSD || '0');

        if (!Number.isFinite(currentBorrowsUsd) || suppliesToUse.length === 0 || marketsToUse.length === 0) {
            return null;
        }

        const borrowLimitUsd = suppliesToUse.reduce((total, supply) => {
            if (supply.usageAsCollateralEnabledOnUser !== true) {
                return total;
            }

            const supplyAddress = (supply.underlyingAsset || supply.address || '').toLowerCase();
            const marketAsset = marketsToUse.find(m => (m.underlyingAsset || m.address || '').toLowerCase() === supplyAddress);
            const amount = parseFloat(supply.formattedAmount || '0');
            const price = getTokenUsdPrice(supply.priceInUSD ? supply : marketAsset);
            const ltv = parseFloat(marketAsset?.baseLTVasCollateral || '0');

            if (!Number.isFinite(amount) || !Number.isFinite(price) || !Number.isFinite(ltv) || amount <= 0 || price <= 0 || ltv <= 0) {
                return total;
            }

            return total + (amount * price * ltv);
        }, 0);

        const repaidDebtUsd = debtSwapValueImpact?.repaidDebtUsd || 0;
        const newDebtUsd = debtSwapValueImpact?.newDebtUsd || 0;
        const bufferedNewDebtUsd = newDebtUsd * (1 + ((swapQuote.bufferBps || 0) / 10000));
        const finalBorrowsUsd = Math.max(0, currentBorrowsUsd - repaidDebtUsd + bufferedNewDebtUsd);
        const toleranceUsd = Math.max(0.01, finalBorrowsUsd * 0.0001);
        const deficitUsd = finalBorrowsUsd - borrowLimitUsd;

        return {
            borrowLimitUsd,
            finalBorrowsUsd,
            bufferedNewDebtUsd,
            deficitUsd,
            isBlocked: borrowLimitUsd > 0 && deficitUsd > toleranceUsd,
        };
    }, [summary, swapQuote, fromToken, toToken, providedSupplies, supplies, localMarketAssets, getTokenUsdPrice, debtSwapValueImpact]);

    const buildBorrowImpactRows = useCallback(({
        repaidRawAmount,
        newDebtRawAmount,
        repaidDebtUsd,
        newDebtUsd,
        unavailable = false,
    }: {
        repaidRawAmount?: string | null;
        newDebtRawAmount?: string | null;
        repaidDebtUsd?: number | null;
        newDebtUsd?: number | null;
        unavailable?: boolean;
    }): TransactionOverviewRow[] => {
        if (!fromToken || !toToken) return [];

        const rows: TransactionOverviewRow[] = [];
        const currentHfRaw = summary ? parseFloat(summary.healthFactor) : NaN;
        const currentHf = (!Number.isFinite(currentHfRaw) || currentHfRaw > 100) ? -1 : currentHfRaw;
        let simulatedHf = currentHf;

        if (summary && repaidDebtUsd != null && newDebtUsd != null) {
            try {
                const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
                const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;
                const simulatedTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);
                simulatedHf = simulatedTotalBorrowsUSD > 0.01
                    ? (currentTotalCollateralUSD * currentLiquidationThreshold) / simulatedTotalBorrowsUSD
                    : -1;
            } catch (err) {
                logger.error('HF Simulation Error', err);
            }
        }

        rows.push({
            key: 'health-factor',
            label: (
                <>
                    <span>Health factor</span>
                    {summary?.eModeCategoryId && summary.eModeCategoryId !== 0 && (
                        <span className="px-1 py-0.5 rounded-sm bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 text-[9px] font-black uppercase tracking-tighter leading-none border border-sky-200 dark:border-sky-800/50">
                            E-Mode
                        </span>
                    )}
                </>
            ),
            tooltip: 'Safety of your collateral against borrowed assets.',
            className: 'text-[13px] text-slate-600 dark:text-slate-300 font-medium items-start',
            value: summary ? (
                <div className="flex items-center gap-1.5 font-bold text-sm">
                    <span className={getHfColor(currentHf)}>{formatHF(currentHf)}</span>
                    <span className="text-slate-400 font-normal">→</span>
                    <InfoTooltip content="Liquidation < 1.0" size={12}>
                        <span className={getHfColor(simulatedHf)}>
                            {unavailable ? '—' : formatHF(simulatedHf)}
                        </span>
                    </InfoTooltip>
                </div>
            ) : <span>-</span>,
        });

        const fromAddr = (fromToken?.underlyingAsset || fromToken?.address || '').toLowerCase();
        const fromMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === fromAddr);
        const currentApy = (fromMarketToken?.variableBorrowRate ?? 0) * 100;
        const toAddr = (toToken?.underlyingAsset || toToken?.address || '').toLowerCase();
        const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
        const newApy = (toMarketToken?.variableBorrowRate ?? 0) * 100;

        rows.push({
            key: 'borrow-apy',
            label: 'Borrow APY',
            tooltip: 'Annual interest on borrowed assets.',
            className: 'text-[13px] text-slate-600 dark:text-slate-300 font-medium',
            value: (
                <div className="text-right flex items-center gap-1.5">
                    <span className="text-slate-900 dark:text-slate-100">{formatAPY(currentApy)}</span>
                    <span className="text-slate-400 font-normal">→</span>
                    <span className="text-slate-900 dark:text-slate-100">{formatAPY(newApy)}</span>
                </div>
            ),
        });

        if (repaidDebtUsd != null && newDebtUsd != null) {
            const debtValueDeltaUsd = newDebtUsd - repaidDebtUsd;
            const debtValueDeltaPercent = repaidDebtUsd > 0
                ? (debtValueDeltaUsd / repaidDebtUsd) * 100
                : 0;

            rows.push({
                key: 'debt-value',
                label: 'Estimated debt value',
                tooltip: 'Estimated with Aave market oracle prices, not ParaSwap route USD metadata.',
                className: 'text-[13px] text-slate-600 dark:text-slate-300 font-medium',
                value: (
                    <div className="text-right">
                        <div className="flex items-center justify-end gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                            <span>{formatUSD(repaidDebtUsd)}</span>
                            <span className="text-slate-400 font-normal">â†’</span>
                            <span>{unavailable ? 'â€”' : formatUSD(newDebtUsd)}</span>
                        </div>
                        {!unavailable && Math.abs(debtValueDeltaUsd) >= 0.01 && (
                            <div className={`text-[10px] ${debtValueDeltaUsd > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                {debtValueDeltaUsd > 0 ? '+' : ''}{formatUSD(debtValueDeltaUsd)} ({debtValueDeltaPercent > 0 ? '+' : ''}{debtValueDeltaPercent.toFixed(2)}%)
                            </div>
                        )}
                    </div>
                ),
            });
        }

        const activeBorrows = providedBorrows || borrows || [];
        let fromRemaining = 0;
        let toTotal = 0;

        try {
            const existingFromBorrow = activeBorrows.find(b => (b.underlyingAsset || '').toLowerCase() === fromAddr);
            const existingFromBalance = existingFromBorrow ? parseFloat(existingFromBorrow.formattedAmount || '0') : 0;
            const repaidAmount = repaidRawAmount ? parseFloat(formatUnits(BigInt(repaidRawAmount), fromToken.decimals || 18)) : 0;
            fromRemaining = Math.max(0, existingFromBalance - repaidAmount);
        } catch {
            fromRemaining = 0;
        }

        try {
            const existingToBorrow = activeBorrows.find(b => (b.underlyingAsset || '').toLowerCase() === toAddr);
            const existingToBalance = existingToBorrow ? parseFloat(existingToBorrow.formattedAmount || '0') : 0;
            const newDebt = newDebtRawAmount ? parseFloat(formatUnits(BigInt(newDebtRawAmount), toToken.decimals || 18)) : 0;
            toTotal = existingToBalance + newDebt;
        } catch {
            toTotal = 0;
        }

        rows.push({
            key: 'borrow-balance',
            label: 'Borrow balance after switch',
            tooltip: 'Estimated debt balance after swap.',
            className: 'text-[13px] text-slate-600 dark:text-slate-300 font-medium pb-1',
            value: (
                <div className="text-right flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                            <img src={getTokenLogo(fromToken.symbol)} className="w-full h-full object-cover" />
                        </div>
                        <span>{formatBalanceAmount(fromRemaining)}</span>
                    </div>
                    <span className="text-slate-400 font-normal">→</span>
                    {unavailable ? (
                        <span className="text-slate-400 font-medium">—</span>
                    ) : (
                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-medium">
                            <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                            </div>
                            <span>{formatBalanceAmount(toTotal)}</span>
                        </div>
                    )}
                </div>
            ),
        });

        return rows;
    }, [fromToken, toToken, summary, localMarketAssets, providedBorrows, borrows, getHfColor, formatBalanceAmount]);

    const limitOverviewCostsRows = useMemo<TransactionOverviewRow[]>(() => {
        if (!debtLimitQuote || !toToken) return [];

        const rows: TransactionOverviewRow[] = [];
        const costs = (debtLimitQuote.amountsAndCosts?.costs || {}) as Record<string, any>;
        const networkCost = costs.networkFee || costs.networkCosts || costs.networkCost;
        const protocolCost = costs.protocolFee || costs.executionFee;
        const partnerFeeCost = costs.partnerFee;

        if (networkCost?.amount) {
            rows.push({
                key: 'network-costs',
                label: 'Network costs',
                tooltip: 'Estimated network gas cost.',
                value: <span>{formatCompactToken(formatUnits(BigInt(networkCost.amount), toToken.decimals || 18), getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol)}</span>,
            });
        }

        if (protocolCost?.amount) {
            rows.push({
                key: 'execution-fee',
                label: 'Execution fee',
                tooltip: 'Estimated protocol execution cost.',
                value: <span>{formatCompactToken(formatUnits(BigInt(protocolCost.amount), toToken.decimals || 18), getDisplaySymbol(toToken, localMarketAssets) || toToken.symbol)}</span>,
            });
        }

        const fee = debtLimitQuote.lilSwapFee;
        if (fee?.finalFeeBps && fee.finalFeeBps > 0) {
            rows.push({
                key: 'lilswap-fee',
                label: (
                    <div className="contents">
                        <span>LilSwap fee ({(fee.finalFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%)</span>
                        {fee.discountPercent > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                                {fee.discountPercent}% OFF
                            </span>
                        )}
                    </div>
                ),
                value: partnerFeeCost?.amount || fee.estimatedAmountRaw ? (
                    <>
                        <div className="w-3.5 h-3.5 rounded-full overflow-hidden">
                            <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                        </div>
                        <span>{debtLimitLilSwapFeeAmount || '< 0.00001'}</span>
                    </>
                ) : <span>{(fee.finalFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%</span>,
            });
        }

        return rows;
    }, [debtLimitQuote, toToken, localMarketAssets, debtLimitLilSwapFeeAmount]);

    const limitOverviewImpactRows = useMemo(() => {
        if (!debtLimitQuote) return [];

        const repaidRawAmount = orderBuyRawAmount || limitInputAmount.toString();
        const newDebtRawAmount = displayDestinationRawAmount || orderSellRawAmount;
        return buildBorrowImpactRows({
            repaidRawAmount,
            newDebtRawAmount,
            repaidDebtUsd: getRawAmountUsd(repaidRawAmount, fromToken),
            newDebtUsd: getRawAmountUsd(newDebtRawAmount, toToken),
            unavailable: limitInputAmount > (debtBalance || 0n),
        });
    }, [debtLimitQuote, orderBuyRawAmount, limitInputAmount, displayDestinationRawAmount, orderSellRawAmount, buildBorrowImpactRows, getRawAmountUsd, fromToken, toToken, debtBalance]);

    const limitTotalCostsLabel = useMemo(() => {
        const fee = debtLimitQuote?.lilSwapFee;
        if (!fee?.estimatedAmountRaw || !toToken) {
            return limitOverviewCostsRows.length > 0 ? null : undefined;
        }

        const feeUsd = getRawAmountUsd(fee.estimatedAmountRaw, toToken);
        return feeUsd == null ? null : formatUSD(feeUsd);
    }, [debtLimitQuote?.lilSwapFee, toToken, getRawAmountUsd, limitOverviewCostsRows.length]);

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
            // USD -> Token
            const usdAmount = parseFloat(inputValue);
            const tokenAmount = usdAmount / price;
            setInputValue(tokenAmount.toFixed(tokenAmount < 0.0001 ? 8 : 6).replace(/\.?0+$/, ''));
        } else {
            // Token -> USD
            const tokenAmount = parseFloat(inputValue);
            const usdAmount = tokenAmount * price;
            setInputValue(usdAmount.toFixed(2));
        }
        setIsUSDMode(!isUSDMode);
    }, [isUSDMode, inputValue, fromToken]);

    const handleToggleLimitUSDMode = useCallback(() => {
        if (!fromToken) {
            setIsUSDMode(!isUSDMode);

            return;
        }

        const rawPrice = parseFloat(fromToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;

        if (price <= 0 || !limitInputValue) {
            setIsUSDMode(!isUSDMode);

            return;
        }

        if (isUSDMode) {
            try {
                const tokenAmount = formatUnits(limitInputAmount, fromToken.decimals || 18);
                setInputValue(tokenAmount);
            } catch {
                setInputValue('');
            }
        } else {
            const tokenAmount = parseFloat(limitInputValue || '0');
            const usdAmount = tokenAmount * price;
            setInputValue(Number.isFinite(usdAmount) && usdAmount > 0 ? usdAmount.toFixed(2) : '');
        }

        setIsUSDMode(!isUSDMode);
    }, [isUSDMode, limitInputValue, limitInputAmount, fromToken]);

    const fromSecondaryValue = useMemo(() => {
        if (!fromToken) {
            return null;
        }

        if (isUSDMode) {
            // In USD mode, secondary is Token units
            if (swapAmount === BigInt(0)) {
                return `0 ${fromToken.symbol}`;
            }

            try {
                const tokenAmount = formatUnits(swapAmount, fromToken.decimals || 18);
                return formatCompactToken(tokenAmount, fromToken.symbol);
            } catch {
                return null;
            }
        } else {
            const marketUsdValue = getRawAmountUsd(swapQuote?.destAmount || swapAmount.toString(), fromToken);
            if (marketUsdValue != null) {
                return formatUSD(marketUsdValue);
            }

            if (swapQuote?.priceRoute?.destUSD) {
                return formatUSD(parseFloat(swapQuote.priceRoute.destUSD));
            }

            const rawPrice = parseFloat(fromToken.priceInUSD || '0');
            const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
            const tokenAmount = parseFloat(inputValue || '0');

            return formatUSD(tokenAmount * price);
        }
    }, [isUSDMode, fromToken, swapAmount, swapQuote, inputValue, getRawAmountUsd]);

    const toSecondaryValue = useMemo(() => {
        if (!toToken) {
            return null;
        }

        const rawPrice = parseFloat(toToken.priceInUSD || '0');
        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;

        if (isUSDMode) {
            // In USD mode, show Token units
            if (swapQuote?.srcAmount) {
                try {
                    const tokenAmount = formatUnits(swapQuote.srcAmount, toToken.decimals || 18);
                    return formatCompactToken(tokenAmount, toToken.symbol);
                } catch {
                    return null;
                }
            }
            return `0 ${toToken.symbol}`;
        } else {
            // In Token mode, show USD value
            const marketUsdValue = getRawAmountUsd(swapQuote?.srcAmount, toToken);
            if (marketUsdValue != null) {
                return formatUSD(marketUsdValue);
            }

            if (swapQuote?.priceRoute?.srcUSD) {
                return formatUSD(parseFloat(swapQuote.priceRoute.srcUSD));
            }

            if (swapQuote?.srcAmount) {
                try {
                    const tokenAmount = parseFloat(formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
                    return formatUSD(tokenAmount * price);
                } catch {
                    return null;
                }
            }
        }

        return null;
    }, [toToken, swapQuote, isUSDMode, getRawAmountUsd]);

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

    // --- Zero LTV Detection ---
    const blockingZeroLtvObjects = useMemo(() => {
        const suppliesToUse = providedSupplies && providedSupplies.length > 0 ? providedSupplies : (supplies || []);
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

                const marketAsset = marketsToUse.find(m => {
                    const marketAddress = (m.underlyingAsset || m.address || '').toLowerCase();
                    return marketAddress === supplyAddress;
                });

                return marketAsset ? { ...s, ...marketAsset } : s;
            })
            .filter(Boolean)
            .filter(asset => {
                const ltv = parseFloat(asset.baseLTVasCollateral);
                return Number.isFinite(ltv) && ltv === 0;
            });
    }, [providedSupplies, supplies, localMarketAssets]);

    const blockingZeroLtvSymbols = useMemo(() =>
        blockingZeroLtvObjects.map(s => getDisplaySymbol(s, localMarketAssets)),
        [blockingZeroLtvObjects, localMarketAssets]);

    const isBlockedByZeroLtv = blockingZeroLtvObjects.length > 0;

    useEffect(() => {
        if (swapMode !== 'limit') return;
        // In market-like UX, limit prepare is lazy (on main action click), not auto after quote.
        resetDebtLimitPreparedState();
        debtLimitPrepareRequestRef.current += 1;
        setIsPreparingDebtLimit(false);
    }, [
        swapMode,
        account,
        effectiveChainId,
        effectiveMarketKey,
        initialMarketKey,
        fromToken?.address,
        fromToken?.underlyingAsset,
        fromToken?.decimals,
        toToken?.address,
        toToken?.underlyingAsset,
        toToken?.decimals,
        toToken?.variableDebtTokenAddress,
        toDebtTokenAddress,
        debtLimitQuote,
        debtLimitValidTo,
        limitInputAmount,
        limitOutputAmount,
        limitPrice,
        canonicalLimitPrice,
        limitPriceCommitNonce,
        debtBalance,
        isBlockedByZeroLtv,
        isOpen,
        resetDebtLimitPreparedState,
    ]);

    // ── Auto-prepare when limitExpirySeconds changes ───────────────────────────
    // When the user changes the order duration, the adapter instance address
    // (spender) changes because it's derived from validTo via CREATE2.
    // We call the lightweight /prepare endpoint to get the new spender,
    // WITHOUT triggering a new price quote.
    const prevLimitExpirySecondsRef = useRef(limitExpirySeconds);
    useEffect(() => {
        if (swapMode !== 'limit') return;
        if (prevLimitExpirySecondsRef.current === limitExpirySeconds) return;
        prevLimitExpirySecondsRef.current = limitExpirySeconds;

        // Reset the existing prepared state (delegation, signature, etc.)
        // since the spender address is about to change.
        resetDebtLimitPreparedState();

        // Only auto-prepare if we already have a valid quote and inputs.
        if (!debtLimitQuote || limitInputAmount <= 0n || limitOutputAmount <= 0n) return;
        if (!account || !fromToken || !toToken || !debtLimitValidTo) return;

        // Fire-and-forget: the prepare call is very fast (local CREATE2 calc).
        handlePrepareLimitSwap();
    }, [
        swapMode,
        limitExpirySeconds,
        debtLimitQuote,
        debtLimitValidTo,
        limitInputAmount,
        limitOutputAmount,
        account,
        fromToken,
        toToken,
        resetDebtLimitPreparedState,
        handlePrepareLimitSwap,
    ]);

    useEffect(() => {
        const submittedOrderId = debtLimitPostResult?.orderId || debtLimitSubmitResult?.orderId;
        const isSubmitted = debtLimitPostResult?.status === 'submitted' || debtLimitSubmitResult?.status === 'submitted';
        if (!isSubmitted || !submittedOrderId) return;
        if (lastHandledLimitOrderIdRef.current === submittedOrderId) return;

        lastHandledLimitOrderIdRef.current = submittedOrderId;
        addToast({
            type: 'success',
            title: 'Limit order submitted',
            message: 'Your limit order was submitted successfully.',
            action: {
                label: 'View History',
                onClick: () => setSheetOpen(true),
            },
        });
        onClose();
    }, [
        debtLimitPostResult?.status,
        debtLimitPostResult?.orderId,
        debtLimitSubmitResult?.status,
        debtLimitSubmitResult?.orderId,
        addToast,
        setSheetOpen,
        onClose,
    ]);

    useEffect(() => {
        if (!isOpen) return;
        const err = debtLimitPrepareError || debtLimitSubmitError || debtLimitOrderSignatureError || debtLimitPostError;
        if (!err) return;
        const key = `limit:${err}`;
        if (lastToastErrorRef.current === key) return;
        lastToastErrorRef.current = key;
        addToast({
            type: 'error',
            title: 'Limit swap failed',
            message: err,
        });
    }, [
        isOpen,
        debtLimitPrepareError,
        debtLimitSubmitError,
        debtLimitOrderSignatureError,
        debtLimitPostError,
        addToast,
    ]);





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

                // Use the engine's pre-computed flag — it already encodes ALL rules:
                // isActive, isFrozen, isPaused, borrowingEnabled, AND E-Mode compatibility.
                // This is the single source of truth and must match the token selector list filter.
                const isGoodDefault = (token: any) => {
                    const addr = (token.address || token.underlyingAsset || '').toLowerCase();
                    if (addr === fromAddr) return false;
                    return token.canBeDebtSwapDestination === true;
                };

                // 1. Try saved selection for this market
                const marketKey = initialMarketKey || effectiveNetwork?.key || '';
                const savedAddr = getSavedTokenSelection(marketKey, 'debt');
                const savedMatch = savedAddr ? localMarketAssets.find(m => (m.address || m.underlyingAsset || '').toLowerCase() === savedAddr) : null;

                if (savedMatch && isGoodDefault(savedMatch)) {
                    setToToken(savedMatch);
                } else {
                    // 2. Pick the FIRST eligible token from the list
                    const defaultTo = localMarketAssets.find(isGoodDefault);
                    if (defaultTo) {
                        setToToken(defaultTo);
                    }
                }
            }

        }
    }, [isOpen, initialFromToken, initialToToken, localMarketAssets]);



    useEffect(() => {
        if (isOpen && toToken && effectiveNetwork) {
            const marketKey = initialMarketKey || effectiveNetwork?.key || '';
            const addr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();
            if (addr) {
                saveTokenSelection(marketKey, 'debt', addr);
            }
        }
    }, [toToken, isOpen, effectiveNetwork, initialMarketKey]);

    useEffect(() => {
        skipNextLimitPriceInputDebounceRef.current = true;
        setLimitPriceInput('');
        setLimitPriceInputError(null);
        setLimitPrice('');
        setCanonicalLimitPrice('');
        setHasCustomLimitPrice(false);
        setLimitOutputInputValue('');
        isEditingLimitOutputRef.current = false;
        clearLimitQuote();
        resetDebtLimitPreparedState();
    }, [toToken?.address, toToken?.underlyingAsset, clearLimitQuote, resetDebtLimitPreparedState]);

    // Reset pair validation state when fromToken changes

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
        setIsUSDMode(false);
        skipNextLimitPriceInputDebounceRef.current = true;
        setLimitPriceInput('');
        setLimitPriceInputError(null);
        setLimitPrice('');
        setCanonicalLimitPrice('');
        setLimitOutputInputValue('');
        isEditingLimitOutputRef.current = false;
        clearLimitQuote();
        resetDebtLimitPreparedState();
        clearQuote();
    }, [fromToken, isOpen, clearQuote, clearLimitQuote, resetDebtLimitPreparedState]);

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
            setIsUSDMode(false);
            setShowSlippageSettings(false);
            setFreezeQuote(false);
            setShowMethodMenu(false);
            skipNextLimitPriceInputDebounceRef.current = true;
            setLimitPriceInput('');
            setLimitPriceInputError(null);
            setLimitPrice('');
            setCanonicalLimitPrice('');
            setLimitOutputInputValue('');
            isEditingLimitOutputRef.current = false;
        }
    }, [isOpen]);

    const isAnySwapActionLoading = isActionLoading || isDebtLimitMainActionBusy;

    useEffect(() => {
        const shouldFreezeQuote = isAnySwapActionLoading || showLowHfConfirmation;
        if (shouldFreezeQuote !== freezeQuote) {
            setFreezeQuote(shouldFreezeQuote);
        }
    }, [isAnySwapActionLoading, showLowHfConfirmation, freezeQuote]);

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
            const friendly = txError || 'Swap failed. Please try again.';
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

    useEffect(() => {
        if (!showLimitExpiryMenu) {
            return;
        }

        const onClickOutside = (e: MouseEvent) => {
            if (limitExpiryMenuRef.current && !limitExpiryMenuRef.current.contains(e.target as Node)) {
                setShowLimitExpiryMenu(false);
            }
        };

        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [showLimitExpiryMenu]);

    useEffect(() => {
        if (txError || userRejected) {
            clearTxError();
            clearUserRejected();
        }
    }, [fromToken, toToken, inputValue, txError, userRejected, clearTxError, clearUserRejected]);


    // --- Computed Values ---

    // isBusy is now defined above with the hook

    // --- Render Helpers ---

    const renderTokenStatus = (token: any) => {
        const reasons = [];
        let disabled = false;
        let amount = undefined;
        let amountUSD = undefined;

        const tokenAddr = (token.address || token.underlyingAsset || '').toLowerCase();

        // 1. If selecting for 'Swap From', we prioritize the actual position balance
        if (selectingForFrom) {
            const borrowPos = activeDebtAssets.find(b => (b.underlyingAsset || '').toLowerCase() === tokenAddr);
            if (borrowPos) {
                // Return amount data directly for the column-based layout
                amount = formatCompactNumber(borrowPos.formattedAmount);

                // Calculate USD value for the second line
                const usdValue = parseFloat(borrowPos.formattedAmount) * parseFloat(borrowPos.priceInUSD || '0');
                if (usdValue > 0) {
                    amountUSD = formatUSD(usdValue);
                }
            } else {
                // If not a position, we still want to suppress protocol errors here as user expects positions
                disabled = true;
                reasons.push('Not a position');
            }
        } else {
            // 2. If selecting for 'Swap To', we use standard borrow checks
            const borrowStatus = getBorrowStatus(token);
            reasons.push(...borrowStatus.reasons);

            if (!borrowStatus.borrowable) {
                disabled = true;
            }
        }

        // 3. Block selecting the same token
        if (selectingForFrom) {
            // No labels or disabling for the source list — all positions are always shown.
        } else { // selecting for toToken
            if (fromToken && (fromToken.address || fromToken.underlyingAsset || '').toLowerCase() === tokenAddr) {
                disabled = true;
                reasons.push('Source token');
            }
        }


        return {
            disabled,
            reasons: reasons.filter(Boolean),
            amount,
            amountUSD
        };
    };

    const selectorTokens = selectingForFrom
        ? (borrows || [])
        : (localMarketAssets || []);

    const oppositeToken = selectingForFrom ? toToken : fromToken;
    const filteredSelectorTokens = useMemo(() => {
        let list = selectorTokens;
        if (oppositeToken && !selectingForFrom) {
            const oppositeAddr = (oppositeToken.address || oppositeToken.underlyingAsset || '').toLowerCase();
            list = list.filter((t) => (t.address || t.underlyingAsset || '').toLowerCase() !== oppositeAddr);
        }

        // --- AAVE STRICT FILTERING (FOR DEBT) ---
        // Assets are pre-filtered by the backend with explicit flags based on ALL Aave constraints
        // (E-Mode category matching, isActive, isFrozen, borrowingEnabled, etc.)
        // We only apply this to destination tokens (selectingForFrom === false).
        if (!selectingForFrom) {
            list = list.filter((t) => {
                const addr = (t.address || t.underlyingAsset || '').toLowerCase();
                const m = (localMarketAssets || []).find(ma => (ma.address || ma.underlyingAsset || '').toLowerCase() === addr);
                if (!m) return false;

                // For Debt Swap, the destination must be a valid borrowable asset per the backend
                return m.canBeDebtSwapDestination === true;
            });
        }

        return list;
    }, [selectorTokens, oppositeToken, selectingForFrom, summary?.eModeCategoryId, localMarketAssets]);


    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
            headerBorder={false}
            preventAutoFocus={true}
        >
            <div className="p-3 space-y-2">
                {/* ── Mode Switcher (Market / Limit) ──────────────────────── */}
                <div className="flex bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg mb-2">
                    <button
                        type="button"
                        onClick={() => {
                            setSwapMode('market');
                            resetDebtLimitPreparedState();
                        }}
                        className={`flex-1 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-md transition-all ${
                            swapMode === 'market'
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                        }`}
                    >
                        Market
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSwapMode('limit');
                        }}
                        className={`flex-1 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-md transition-all flex items-center justify-center gap-1.5 ${
                            swapMode === 'limit'
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                        }`}
                    >
                        Limit
                        <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-extrabold rounded bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/50 leading-none">
                            Alpha
                        </span>
                    </button>
                </div>

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
                                    You have assets with LTV 0 enabled as collateral (
                                    {blockingZeroLtvObjects.map((s: any, i: number) => (
                                        <React.Fragment key={s.underlyingAsset || s.address}>
                                            <button
                                                onClick={() => onOpenToggleCollateral?.(s, summary, supplies || providedSupplies || [], localMarketAssets)}
                                                className="font-bold text-red-700 dark:text-red-400 hover:underline decoration-red-500/50 underline-offset-2 transition-all cursor-pointer"
                                            >
                                                {getDisplaySymbol(s, localMarketAssets)}
                                            </button>
                                            {i < blockingZeroLtvObjects.length - 1 ? ', ' : ''}
                                        </React.Fragment>
                                    ))}
                                    ).<br />
                                    Aave requires you to disable them as collateral or withdraw them before performing this action.
                                </p>
                            </div>
                        </div>
                    </div>
                )}



                {/* ── Market Tab ─────────────────────────────────────────────────────── */}
                {swapMode === 'market' && (
                    <>
                        {/* Slippage Settings Toggle & Label */}
                        <div className="flex justify-end items-center mb-2 relative">
                            <div className={`flex items-center gap-1.5 transition-all ${!swapQuote ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                                    {isAutoSlippage ? 'Auto Slippage' : 'Custom Slippage'}
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
                                    <span>{(executionSlippage / 100).toFixed(2)}%</span>
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

                                    setSwapAmount(amountBI);
                                } catch (e) {
                                    console.error('Error parsing amount', e);
                                    setSwapAmount(BigInt(0));
                                }
                            }}
                            onApplyMax={() => {
                                if (!debtBalance || debtBalance === BigInt(0)) {
                                    return;
                                }

                                const maxTokenAmount = formatUnits(debtBalance, fromToken.decimals || 18);

                                if (isUSDMode) {
                                    const price = parseFloat(fromToken.priceInUSD || '0');
                                    const maxUsdAmount = parseFloat(maxTokenAmount) * price;
                                    setInputValue(maxUsdAmount.toFixed(2));
                                } else {
                                    setInputValue(maxTokenAmount);
                                }

                                setSwapAmount(debtBalance);
                            }}
                            onApplyPct={(pct) => {
                                if (!debtBalance || debtBalance === BigInt(0)) {
                                    return;
                                }

                                const amountBI = (debtBalance * BigInt(pct)) / BigInt(100);
                                const tokenAmount = formatUnits(amountBI, fromToken.decimals || 18);

                                if (isUSDMode) {
                                    const price = parseFloat(fromToken.priceInUSD || '0');
                                    const usdAmount = parseFloat(tokenAmount) * price;
                                    setInputValue(usdAmount.toFixed(2));
                                } else {
                                    setInputValue(tokenAmount);
                                }

                                setSwapAmount(amountBI);
                            }}
                            maxAmount={debtBalance}
                            decimals={isUSDMode ? 2 : (fromToken?.decimals || 18)}
                            formattedBalance={formattedDebt}
                            disabled={isActionLoading}
                            displaySymbol={fromToken ? getDisplaySymbol(fromToken, localMarketAssets) : undefined}
                            onTokenSelect={() => {
                                setSelectingForFrom(true);
                                setTokenSelectorOpen(true);
                            }}
                        />

                        {/* Quote Indicator */}
                        <div className="flex justify-center min-h-4 items-center">
                            {inputValue ? (
                                <div className="text-xs text-slate-500 flex items-center gap-2">
                                    {freezeQuote ? (
                                        <span className="text-amber-500 font-medium">Quote locked</span>
                                    ) : (
                                        <>
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
                                        </>
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
                                                    const usdVal = parseFloat(swapQuote?.priceRoute?.srcUSD || '0');
                                                    return usdVal > 0 ? 'text-slate-900 dark:text-white' : 'text-muted-foreground';
                                                })()}`}>$</span>
                                            )}
                                            <input
                                                type="text"
                                                readOnly
                                                value={(() => {
                                                    if (isUSDMode) {
                                                        const usdVal = parseFloat(swapQuote.priceRoute.srcUSD || '0');
                                                        return usdVal.toFixed(2);
                                                    }
                                                    return formatUnits(swapQuote.srcAmount, toToken.decimals || 18);
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
                                    disabled={isBusy}
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
                                                const outputF = parseFloat(formatUnits(swapQuote.srcAmount, toToken.decimals || 18));

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
                                                        const amount = parseFloat(formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
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

                                                            const amount = parseFloat(formatUnits(swapQuote.srcAmount, toToken.decimals || 18));
                                                            const fee = amount * (feeBps / 10000);

                                                            return fee < 0.00001 ? '< 0.00001' : fee.toLocaleString('en-US', { maximumFractionDigits: 6 });
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

                                        </div>
                                    )}

                                    {/* Persistent Rows Below Fees */}
                                    <div className="px-1 pb-1 pt-1 space-y-2">
                                        {/* Health Factor Row */}
                                        <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                            <div className="flex items-center gap-1.5">
                                                <span>Health factor</span>
                                                {summary?.eModeCategoryId && summary.eModeCategoryId !== 0 && (
                                                    <span className="px-1 py-0.5 rounded-sm bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 text-[9px] font-black uppercase tracking-tighter leading-none border border-sky-200 dark:border-sky-800/50">
                                                        E-Mode
                                                    </span>
                                                )}
                                                <InfoTooltip content="Safety of your collateral against borrowed assets." size={12} />
                                            </div>
                                            <div className="text-right font-medium">
                                                {(() => {
                                                    if (!summary) return <span>-</span>;

                                                    const currentHfRaw = parseFloat(summary.healthFactor);
                                                    // Handle Aave's "Infinity" which is represented as a very large number or specifically handled by formatHF
                                                    const currentHf = (isNaN(currentHfRaw) || currentHfRaw > 100) ? -1 : currentHfRaw;

                                                    const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                                    const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
                                                    const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;

                                                    let simulatedHf = currentHf;

                                                    if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount) {
                                                        try {
                                                            const repaidDebtUsd = debtSwapValueImpact?.repaidDebtUsd || 0;
                                                            const newDebtUsd = debtSwapValueImpact?.newDebtUsd || 0;

                                                            // Calculate the new total borrows.
                                                            // If we are swapping a specific debt to another, the net change is (newDebt - repaidDebt).
                                                            const simulatedTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);

                                                            if (simulatedTotalBorrowsUSD > 0.01) {
                                                                simulatedHf = (currentTotalCollateralUSD * currentLiquidationThreshold) / simulatedTotalBorrowsUSD;
                                                            } else {
                                                                simulatedHf = -1; // No debt = Infinity
                                                            }
                                                        } catch (err) {
                                                            logger.error('HF Simulation Error', err);
                                                        }
                                                    }

                                                    const getHfColor = (hf: number) => {
                                                        if (hf === -1 || hf >= 3) return 'text-emerald-500';
                                                        if (hf >= 1.1) return 'text-orange-500';
                                                        return 'text-red-500';
                                                    };

                                                    return (
                                                        <div className="flex flex-col items-end text-sm">
                                                            <div className="flex items-center gap-1.5 font-bold">
                                                                <span className={getHfColor(currentHf)}>{formatHF(currentHf)}</span>
                                                                <span className="text-slate-400 font-normal">→</span>
                                                                <InfoTooltip content="Liquidation < 1.0" size={12}>
                                                                    <span className={getHfColor(simulatedHf)}>
                                                                        {isInsufficientBalance ? '—' : formatHF(simulatedHf)}
                                                                    </span>
                                                                </InfoTooltip>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {/* Borrow APY Row */}
                                        <div className="flex justify-between items-center text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                            <div className="flex items-center gap-1.5">
                                                <span>Borrow APY</span>
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
                                                            <span className="text-slate-900 dark:text-slate-100">{formatAPY(currentApy)}</span>
                                                            <span className="text-slate-400 font-normal">→</span>
                                                            <span className="text-slate-900 dark:text-slate-100">{formatAPY(newApy)}</span>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {debtSwapValueImpact && (
                                            <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <span>Estimated debt value</span>
                                                    <InfoTooltip
                                                        content={debtSwapValueImpact.usesMarketOracle
                                                            ? 'Estimated with Aave market oracle prices, not ParaSwap route USD metadata.'
                                                            : 'Aave market oracle price unavailable. Showing ParaSwap route USD metadata as fallback.'}
                                                        size={12}
                                                    />
                                                </div>
                                                <div className="text-right">
                                                    <div className="flex items-center justify-end gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <span>{formatUSD(debtSwapValueImpact.repaidDebtUsd)}</span>
                                                        <span className="text-slate-400 font-normal">→</span>
                                                        <span>{formatUSD(debtSwapValueImpact.newDebtUsd)}</span>
                                                    </div>
                                                    {Math.abs(debtSwapValueImpact.deltaUsd) >= 0.01 && (
                                                        <div className={`text-[10px] ${debtSwapValueImpact.deltaUsd > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                            {debtSwapValueImpact.deltaUsd > 0 ? '+' : ''}{formatUSD(debtSwapValueImpact.deltaUsd)}
                                                            {' '}({debtSwapValueImpact.deltaBps > 0 ? '+' : ''}{(debtSwapValueImpact.deltaBps / 100).toFixed(2)}%)
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

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
                                                        const repaidAmount = parseFloat(formatUnits(swapQuote.destAmount || "0", fromToken.decimals || 18));
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
                                                            const newDebt = parseFloat(formatUnits(swapQuote.srcAmount || "0", toToken.decimals || 18));
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
                                                                <span>{fromRemaining === 0 ? '0' : (fromRemaining >= 1000 ? (fromRemaining / 1000).toFixed(2) + 'K' : fromRemaining.toLocaleString('en-US', { maximumFractionDigits: 6 }))}</span>
                                                            </div>
                                                            <span className="text-slate-400 font-normal">→</span>
                                                            {isInsufficientBalance ? (
                                                                <span className="text-slate-400 font-medium">—</span>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100 font-medium">
                                                                    <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-700">
                                                                        <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" />
                                                                    </div>
                                                                    <span>{toTotal === 0 ? '0' : (toTotal >= 1000 ? (toTotal / 1000).toFixed(2) + 'K' : toTotal.toLocaleString('en-US', { maximumFractionDigits: 6 }))}</span>
                                                                </div>
                                                            )}
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
                            if (!fromToken || !toToken || !localMarketAssets || !summary || !swapQuote) {
                                return null;
                            }

                            const toAddr = (toToken.underlyingAsset || toToken.address || '').toLowerCase();
                            const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);

                            const currentHfRaw = parseFloat(summary.healthFactor || '0');
                            const currentHf = (isNaN(currentHfRaw) || currentHfRaw > 100) ? -1 : currentHfRaw;

                            let simulatedHf = currentHf;
                            if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount) {
                                try {
                                    const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                    const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;
                                    const currentTotalBorrowsUSD = parseFloat(summary.totalBorrowsUSD) || 0;

                                    const repaidDebtUsd = debtSwapValueImpact?.repaidDebtUsd || 0;
                                    const newDebtUsd = debtSwapValueImpact?.newDebtUsd || 0;
                                    const simulatedTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);

                                    if (simulatedTotalBorrowsUSD > 0.01) {
                                        simulatedHf = (currentTotalCollateralUSD * currentLiquidationThreshold) / simulatedTotalBorrowsUSD;
                                    } else {
                                        simulatedHf = -1;
                                    }
                                } catch { }
                            }

                            const alerts: Array<{ label: string; message: string; isDanger: boolean }> = [];

                            const userEmodeId = summary.eModeCategoryId || 0;
                            if (userEmodeId > 0 && toMarketToken && toMarketToken.isBorrowableInCurrentEMode === false) {
                                alerts.push({
                                    label: 'E-Mode Conflict:',
                                    message: `${toToken.symbol} cannot be borrowed while in your active E-Mode category. You must disable E-Mode first.`,
                                    isDanger: true,
                                });
                            }

                            if (simulatedHf !== -1 && simulatedHf < 1.0 && !isInsufficientBalance) {
                                alerts.push({
                                    label: 'Critical:',
                                    message: 'Post-swap Health Factor will be below 1.0, which would cause the transaction to revert.',
                                    isDanger: true,
                                });
                            } else if (requiresLowHealthFactorConfirmation(currentHf, simulatedHf) && !isInsufficientBalance) {
                                alerts.push({
                                    label: 'Review:',
                                    message: `This swap lowers your Health Factor to ${formatHF(simulatedHf)}.`,
                                    isDanger: false,
                                });
                            }

                            if (debtSwapBorrowPower?.isBlocked) {
                                alerts.push({
                                    label: 'Borrow limit:',
                                    message: `This position is above Aave's borrow power limit. Repay about ${formatUSD(Math.max(0, debtSwapBorrowPower.deficitUsd))} or add collateral before switching debt.`,
                                    isDanger: true,
                                });
                            }

                            if (debtSwapValueImpact && debtSwapValueImpact.deltaUsd > 0.01 && debtSwapValueImpact.deltaBps > 10) {
                                alerts.push({
                                    label: 'Debt value increase:',
                                    message: `Estimated debt value increases by ${formatUSD(debtSwapValueImpact.deltaUsd)} (+${(debtSwapValueImpact.deltaBps / 100).toFixed(2)}%)${debtSwapValueImpact.usesMarketOracle ? ' using Aave market oracle prices' : ''}. Slippage does not protect against an already-unfavorable quote.`,
                                    isDanger: debtSwapValueImpact.deltaBps > 100,
                                });
                            }

                            if (priceImpact > 0.05) {
                                alerts.push({
                                    label: 'High Impact:',
                                    message: `Price impact is very high (${(priceImpact * 100).toFixed(2)}%).`,
                                    isDanger: true,
                                });
                            }

                            if (!isAutoSlippage && slippage < recommendedSlippage) {
                                alerts.push({
                                    label: 'Warning:',
                                    message: `Custom slippage ${(slippage / 100).toFixed(2)}% is below the recommended ${(recommendedSlippage / 100).toFixed(2)}%. The transaction may fail simulation.`,
                                    isDanger: false,
                                });
                            }

                            if (priceImpact > 0.02) {
                                alerts.push({
                                    label: 'Warning:',
                                    message: 'High price impact. Review the quoted amounts before proceeding.',
                                    isDanger: false,
                                });
                            }

                            if (alerts.length === 0) {
                                return null;
                            }

                            return (
                                <div className="space-y-1 mb-1 mt-2">
                                    {alerts.map((alert, i) => (
                                        <div
                                            key={`${alert.label}-${i}`}
                                            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${alert.isDanger
                                                ? 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
                                                : 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400'
                                                }`}
                                        >
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            <div className="min-w-0 text-[11px] leading-snug">
                                                <span className="font-bold">{alert.label}</span>{' '}
                                                <span className="font-medium">{alert.message}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

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

                            </div>
                        )}

                        {/* Transaction Error */}
                        {(txError || userRejected) && (
                            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-red-800 dark:text-red-300 font-medium">
                                        {userRejected ? 'Transaction rejected in wallet' : txError}
                                    </p>
                                </div>
                                <button onClick={userRejected ? clearUserRejected : clearTxError} className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50 rounded transition-colors">
                                    <X className="w-3.5 h-3.5 text-red-400" />
                                </button>
                            </div>
                        )}

                        {/* Action Button */}
                        {(() => {
                            const userEmodeCategoryId = summary?.eModeCategoryId || 0;
                            const toAddr = (toToken?.address || toToken?.underlyingAsset || '').toLowerCase();
                            const toMarketToken = (localMarketAssets || []).find(m => (m.underlyingAsset || m.address || '').toLowerCase() === toAddr);
                            const isEmodeConflict = userEmodeCategoryId > 0 && toMarketToken && toMarketToken.isBorrowableInCurrentEMode === false;
                            const isBorrowPowerBlocked = debtSwapBorrowPower?.isBlocked === true;

                            const currentHfRaw = parseFloat(summary?.healthFactor || '0');
                            const currentHf = (isNaN(currentHfRaw) || currentHfRaw > 100) ? -1 : currentHfRaw;

                            let simulatedHf = currentHf;
                            const currentTotalBorrowsUSD = parseFloat(summary?.totalBorrowsUSD || '0') || 0;
                            if (swapQuote && swapQuote.srcAmount && swapQuote.destAmount && summary) {
                                try {
                                    const currentTotalCollateralUSD = parseFloat(summary.totalCollateralUSD) || 0;
                                    const currentLiquidationThreshold = parseFloat(summary.currentLiquidationThreshold) || 0;

                                    const repaidDebtUsd = debtSwapValueImpact?.repaidDebtUsd || 0;
                                    const newDebtUsd = debtSwapValueImpact?.newDebtUsd || 0;
                                    const simulatedTotalBorrowsUSD = Math.max(0, currentTotalBorrowsUSD - repaidDebtUsd + newDebtUsd);

                                    if (simulatedTotalBorrowsUSD > 0.01) {
                                        simulatedHf = (currentTotalCollateralUSD * currentLiquidationThreshold) / simulatedTotalBorrowsUSD;
                                    } else {
                                        simulatedHf = -1;
                                    }
                                } catch { }
                            }

                            const isCriticalHf = simulatedHf !== -1 && currentTotalBorrowsUSD > 0 && simulatedHf < 1.0 && !isInsufficientBalance;
                            const requiresLowHfConfirmation = currentTotalBorrowsUSD > 0
                                && requiresLowHealthFactorConfirmation(currentHf, simulatedHf);
                            return (
                                <>
                                    <Button
                                        disabled={isBusy || !fromToken || !toToken || !swapAmount || !!quoteError || isBlockedByZeroLtv || isInsufficientBalance || isEmodeConflict || isBorrowPowerBlocked || isCriticalHf}
                                        onClick={() => {
                                            if (requiresLowHfConfirmation) {
                                                setShowLowHfConfirmation(true);
                                                return;
                                            }
                                            handleSwap();
                                        }}
                                        className={`w-full py-3 h-auto font-bold rounded-xl mt-2 ${isInsufficientBalance || isBorrowPowerBlocked || isCriticalHf ? 'bg-rose-500 hover:bg-rose-600 border-rose-600 text-white' : ''}`}
                                    >
                                        {isActionLoading ? (
                                            <>
                                                <RefreshCw className="w-4 h-4 animate-spin" />
                                                {isSigning ? 'Signing in wallet...' : 'Processing...'}
                                            </>
                                        ) : isInsufficientBalance ? (
                                            'Insufficient Balance'
                                        ) : isCriticalHf ? (
                                            'Critical Health Factor'
                                        ) : isBorrowPowerBlocked ? (
                                            'Borrow Limit Exceeded'
                                        ) : isEmodeConflict ? (
                                            'E-Mode Conflict'
                                        ) : (
                                            <>
                                                <ArrowRightLeft className="w-4 h-4" />
                                                {isApproved && !forceRequirePermit ? 'Confirm Swap' : 'Approve & Swap'}
                                            </>
                                        )}
                                    </Button>

                                    <LowHealthFactorConfirmationModal
                                        isOpen={showLowHfConfirmation}
                                        healthFactor={simulatedHf}
                                        onCancel={() => setShowLowHfConfirmation(false)}
                                        onConfirm={() => {
                                            setShowLowHfConfirmation(false);
                                            handleSwap();
                                        }}
                                    />
                                </>
                            );
                        })()}
                    </>
                )}


                {/* Limit Tab */}
                {swapMode === 'limit' && (
                    <div className="space-y-3">
                        {/* Source Input Section */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Swap</span>

                                <div ref={limitExpiryMenuRef} className="relative">
                                    <div className="flex items-center gap-1.5 transition-all">
                                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Expires in</span>
                                        <button
                                            type="button"
                                            onClick={() => setShowLimitExpiryMenu((value) => !value)}
                                            className={`inline-flex items-center gap-1 text-[11px] font-bold transition-colors ${showLimitExpiryMenu
                                                ? 'text-primary'
                                                : 'text-slate-900 dark:text-white hover:text-primary'
                                                }`}
                                        >
                                            <span>{selectedLimitExpiry.label}</span>
                                            <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${showLimitExpiryMenu ? 'rotate-180' : ''}`} />
                                        </button>
                                    </div>

                                    {showLimitExpiryMenu && (
                                        <div className="absolute right-0 top-full mt-2 z-40 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl w-48 animate-in fade-in slide-in-from-top-2 duration-150">
                                            {limitExpiryOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => {
                                                        setLimitExpirySeconds(option.value);
                                                        setShowLimitExpiryMenu(false);
                                                    }}
                                                    className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${limitExpirySeconds === option.value
                                                        ? 'bg-slate-50 dark:bg-slate-800 text-primary'
                                                        : 'text-slate-600 dark:text-slate-400'
                                                        }`}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <CompactAmountInput
                                token={fromToken}
                                value={limitInputValue}
                                isUSDMode={isUSDMode}
                                onToggleUSDMode={handleToggleLimitUSDMode}
                                secondaryValue={limitInputSecondaryValue}
                                isError={limitInputAmount > (debtBalance || 0n)}
                                onChange={(value) => {
                                    const normalized = normalizeDecimalInput(value);
                                    setInputValue(normalized);
                                    resetDebtLimitPreparedState();

                                    try {
                                        if (isUSDMode) {
                                            const rawPrice = parseFloat(fromToken?.priceInUSD || '0');
                                            const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
                                            const usdAmount = parseFloat(normalized || '0');

                                            if (price > 0 && usdAmount > 0) {
                                                const tokenAmount = usdAmount / price;
                                                setSwapAmount(parseUnits(tokenAmount.toFixed(fromToken?.decimals || 18), fromToken?.decimals || 18));
                                            } else {
                                                setSwapAmount(0n);
                                            }
                                        } else {
                                            setSwapAmount(normalized ? parseUnits(normalized, fromToken?.decimals || 18) : 0n);
                                        }
                                    } catch {
                                        setSwapAmount(0n);
                                    }
                                }}
                                onApplyMax={() => {
                                    if (!debtBalance || debtBalance === 0n || !fromToken) return;
                                    const maxTokenAmount = formatUnits(debtBalance, fromToken.decimals || 18);

                                    if (isUSDMode) {
                                        const rawPrice = parseFloat(fromToken.priceInUSD || '0');
                                        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
                                        setInputValue(price > 0 ? (parseFloat(maxTokenAmount) * price).toFixed(2) : '');
                                    } else {
                                        setInputValue(maxTokenAmount);
                                    }

                                    setSwapAmount(debtBalance);
                                    resetDebtLimitPreparedState();
                                }}
                                onApplyPct={(pct) => {
                                    if (!debtBalance || debtBalance === 0n || !fromToken) return;
                                    const amountBI = (debtBalance * BigInt(pct)) / 100n;
                                    const tokenAmount = formatUnits(amountBI, fromToken.decimals || 18);

                                    if (isUSDMode) {
                                        const rawPrice = parseFloat(fromToken.priceInUSD || '0');
                                        const price = rawPrice > 1_000_000_000 ? rawPrice / 1e8 : rawPrice;
                                        setInputValue(price > 0 ? (parseFloat(tokenAmount) * price).toFixed(2) : '');
                                    } else {
                                        setInputValue(tokenAmount);
                                    }

                                    setSwapAmount(amountBI);
                                    resetDebtLimitPreparedState();
                                }}
                                maxAmount={debtBalance}
                                decimals={isUSDMode ? 2 : (fromToken?.decimals || 18)}
                                formattedBalance={formattedDebt}
                                onTokenSelect={() => {
                                    setSelectingForFrom(true);
                                    setTokenSelectorOpen(true);
                                }}
                                displaySymbol={getDisplaySymbol(fromToken, localMarketAssets)}
                            />
                        </div>

                        {/* Destination Input Section */}
                        <div className="space-y-2">
                            <div className="flex items-center px-1">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Receive at most</span>
                            </div>

                            <CompactAmountInput
                                token={toToken}
                                value={limitOutputDisplayValue}
                                isUSDMode={isUSDMode}
                                secondaryValue={limitOutputSecondaryValue}
                                onChange={handleLimitOutputChange}
                                onToggleUSDMode={() => setIsUSDMode((prev) => !prev)}
                                maxAmount={0n}
                                decimals={isUSDMode ? 2 : (toToken?.decimals || 18)}
                                placeholder="0.00"
                                isLoading={debtLimitQuoteState === 'quoteLoading'}
                                loadingLabel="Loading quote..."
                                showQuickActions={false}
                                onTokenSelect={() => {
                                    setSelectingForFrom(false);
                                    setTokenSelectorOpen(true);
                                }}
                                displaySymbol={getDisplaySymbol(toToken, localMarketAssets)}
                            />
                        </div>

                        {/* Price Settings Section */}
                        {/* Price Settings Section */}
                        <div className="space-y-2">
                            <div className="flex items-center px-1">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    When 1 {getDisplaySymbol(priceLimitDisplayInverted ? fromToken : toToken, localMarketAssets) || '...'} is worth
                                </span>
                            </div>

                            <div className="bg-slate-100 dark:bg-slate-800 border border-border-light dark:border-slate-700 rounded-xl p-1 px-2.5 group transition-colors focus-within:border-purple-500/50">
                                <div className="flex items-center gap-2 sm:gap-3 mt-1">
                                    <div className="flex-1 relative overflow-hidden flex items-center pl-0.5 focus-within:z-10">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={displayLimitPrice}
                                            onChange={(event) => {
                                                const normalizedPriceInput = normalizeDecimalInput(event.target.value);

                                                setLimitPriceInput(normalizedPriceInput);
                                                setLimitPriceInputError(null);
                                                setHasCustomLimitPrice(true);
                                                isEditingLimitOutputRef.current = false;
                                                resetDebtLimitPreparedState();
                                            }}
                                            placeholder="0.00"
                                            className="w-full bg-transparent text-2xl font-mono font-bold text-left focus:outline-none py-0.5 pr-6 text-slate-900 dark:text-white placeholder:text-muted-foreground text-ellipsis overflow-hidden"
                                        />
                                    </div>

                                    <button
                                        type="button"
                                        onClick={togglePriceLimitDisplay}
                                        className="flex items-center gap-1.5 py-1 px-1 hover:opacity-75 transition-opacity"
                                        title="Switch price direction"
                                    >
                                        {(priceLimitDisplayInverted ? toToken : fromToken)?.symbol ? (
                                            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-border-light dark:border-slate-600/30">
                                                <img
                                                    src={getTokenLogo((priceLimitDisplayInverted ? toToken : fromToken).symbol)}
                                                    alt={(priceLimitDisplayInverted ? toToken : fromToken).symbol}
                                                    className="w-full h-full object-cover"
                                                    onError={onTokenImgError((priceLimitDisplayInverted ? toToken : fromToken).symbol)}
                                                />
                                            </div>
                                        ) : (
                                            <span className="text-xs font-bold text-slate-400">?</span>
                                        )}
                                        <span className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                                            {getDisplaySymbol(priceLimitDisplayInverted ? toToken : fromToken, localMarketAssets)}
                                        </span>
                                        <ArrowRightLeft className="w-4 h-4 text-slate-400" />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between mt-1 mb-1 pl-0.5 min-h-5">
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                        {debtLimitQuoteState === 'quoteLoading' ? (
                                            <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                                <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                                                Loading quote...
                                            </span>
                                        ) : debtLimitQuoteError ? (
                                            <span className="text-amber-600 dark:text-amber-400">
                                                {mapErrorToUserFriendly(debtLimitQuoteError) || 'Quote unavailable'}
                                            </span>
                                        ) : limitOutputValue ? `Est. output ${formatCompactNumber(limitOutputValue)} ${getDisplaySymbol(toToken, localMarketAssets)}` : 'Enter amount to see output'}
                                    </span>

                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!marketLimitPrice) {
                                                    return;
                                                }

                                                const price = parseFloat(marketLimitPrice);
                                                const invertedPrice = Number.isFinite(price) && price > 0 ? formatPlainAmount(1 / price) : '';

                                                skipNextLimitPriceInputDebounceRef.current = true;
                                                setLimitPriceInput(displayMarketLimitPrice || marketLimitPrice);
                                                setLimitPriceInputError(null);
                                                setLimitPrice(invertedPrice);
                                                setCanonicalLimitPrice(invertedPrice);
                                                setCanonicalPriceInverted(priceLimitDisplayInverted);
                                                setLimitPriceCommitNonce((value) => value + 1);
                                                setHasCustomLimitPrice(false);
                                                isEditingLimitOutputRef.current = false;
                                                resetDebtLimitPreparedState();
                                            }}
                                            disabled={!marketLimitPrice}
                                            className="flex items-center gap-1.5 p-0 bg-transparent border-none appearance-none transition-opacity hover:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                                {displayMarketLimitPrice || '0'}
                                            </span>
                                            <span className="text-[10px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-widest bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 rounded">
                                                MARKET
                                            </span>
                                        </button>
                                        {(() => {
                                            const userP = parseFloat(displayLimitPrice || '0');
                                            const marketP = parseFloat(displayMarketLimitPrice || '0');
                                            if (!Number.isFinite(userP) || userP <= 0 || !Number.isFinite(marketP) || marketP <= 0) return null;
                                            const diff = ((userP - marketP) / marketP) * 100;
                                            const absDiff = Math.abs(diff);
                                            if (absDiff < 0.01) return null;
                                            const color = absDiff < 0.1 ? 'text-slate-400' : diff < 0 ? 'text-emerald-500' : 'text-red-500';
                                            return (
                                                <span className={`text-[11px] font-medium ${color}`}>
                                                    {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Quote Indicator */}
                        <div className="flex justify-center min-h-4 items-center">
                            {debtLimitQuoteState === 'quoteReady' && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                    {freezeQuote ? (
                                        <span className="text-amber-500 font-medium">Quote locked</span>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    fetchLimitQuote();
                                                    resetLimitRefreshCountdown();
                                                }}
                                                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                                title="Refresh quote"
                                                disabled={isDebtLimitQuoteLoading}
                                            >
                                                <RefreshCw className={`w-3 h-3 ${isDebtLimitQuoteLoading ? 'animate-spin' : ''}`} />
                                            </button>
                                            Auto refresh in {limitNextRefreshIn}s
                                        </>
                                    )}
                                </div>
                            )}
                            {debtLimitQuoteState === 'quoteError' && limitErrorCountdown > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-amber-600 dark:text-amber-400">Retrying in</span>
                                    <div className="w-16 h-1.5 bg-amber-200 dark:bg-amber-900/40 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                                            style={{ width: `${(limitErrorCountdown / 15) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400 font-bold">
                                        {limitErrorCountdown}s
                                    </span>
                                </div>
                            )}
                        </div>

                        {limitInputAmount > (debtBalance || 0n) && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">Insufficient debt balance.</p>
                            </div>
                        )}

                        {limitPriceInputError && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">{limitPriceInputError}</p>
                            </div>
                        )}

                        {debtLimitQuoteState === 'quoteMissing' && limitInputAmount <= 0n && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Enter amount to get limit quote</p>
                            </div>
                        )}

                        {debtLimitQuote && fromToken && toToken && (
                            <DebtSwapTransactionOverview
                                expanded={showTransactionOverview}
                                onToggle={() => setShowTransactionOverview(!showTransactionOverview)}
                                discountPercent={Number(debtLimitQuote.lilSwapFee?.discountPercent || 0)}
                                totalCostsLabel={limitTotalCostsLabel}
                                costsRows={limitOverviewCostsRows}
                                impactRows={limitOverviewImpactRows}
                            />
                        )}

                        {/* Action Button */}
                        <Button
                            onClick={handleLimitMainAction}
                            disabled={isDebtLimitMainActionDisabled}
                            className={`w-full py-3 h-auto font-bold rounded-xl ${debtLimitSubmitResult?.status === 'submitted' || debtLimitPostResult?.status === 'submitted'
                                ? 'bg-emerald-600 border-emerald-700 text-white opacity-80 cursor-not-allowed'
                                : 'bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white disabled:text-slate-500 dark:disabled:text-slate-400'
                                }`}
                        >
                            {isDebtLimitMainActionBusy && <RefreshCw className="w-4 h-4 animate-spin" />}
                            {debtLimitMainActionLabel}
                        </Button>

                        {/* Errors and Success Messages */}
                        {debtLimitSubmitError && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">{debtLimitSubmitError}</p>
                            </div>
                        )}

                        {debtLimitOrderSignatureError && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">{debtLimitOrderSignatureError}</p>
                            </div>
                        )}

                        {debtLimitPostError && (
                            <div className="px-1 -mt-1">
                                <p className="text-xs text-rose-500 dark:text-rose-400 font-medium">{debtLimitPostError}</p>
                            </div>
                        )}

                        {debtLimitSubmitResult?.status === 'submitted' && debtLimitSubmitResult.orderId && (
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center justify-between gap-3">
                                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                                    Limit order submitted
                                </p>
                                {debtLimitOrderLink && (
                                    <a
                                        href={debtLimitOrderLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-black text-emerald-700 dark:text-emerald-300 hover:underline"
                                    >
                                        View order
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {tokenSelectorOpen && (
                <TokenSelector
                    isOpen={tokenSelectorOpen}
                    onClose={() => setTokenSelectorOpen(false)}
                    title={selectingForFrom ? 'Swap From' : 'Swap To'}
                    description={selectingForFrom ? 'Choose a token to swap from your debt positions' : 'Choose a token to swap into'}
                    tokens={filteredSelectorTokens}
                    onSelect={(token) => {
                        const marketKey = initialMarketKey || selectedNetwork?.key || '';
                        const tokenAddr = (token.address || token.underlyingAsset || '');
                        if (selectingForFrom) {
                            setFromToken(token);
                            saveTokenSelection(marketKey, 'debt-from', tokenAddr);

                            // If we selected a token that is currently set as 'toToken',
                            // auto-advance toToken to avoid collision errors.
                            if (toToken && (toToken.address || toToken.underlyingAsset || '').toLowerCase() === tokenAddr.toLowerCase()) {
                                const nextValidTo = localMarketAssets.find(m =>
                                    (m.address || m.underlyingAsset || '').toLowerCase() !== tokenAddr.toLowerCase() &&
                                    m.canBeDebtSwapDestination === true
                                );
                                if (nextValidTo) {
                                    setToToken(nextValidTo);
                                    saveTokenSelection(marketKey, 'debt', (nextValidTo.address || nextValidTo.underlyingAsset || '').toLowerCase());
                                }
                            }

                            // Reset input when source token changes to avoid errors with previous values
                            setSwapAmount(BigInt(0));
                            setInputValue('');
                        } else {
                            setToToken(token);
                            saveTokenSelection(marketKey, 'debt', tokenAddr);
                        }
                        setTokenSelectorOpen(false);
                    }}
                    renderStatus={renderTokenStatus}
                    hideOverlay={true}
                    marketAssets={localMarketAssets}
                />
            )}
        </Modal>
    );

};


export default DebtSwapModal;
