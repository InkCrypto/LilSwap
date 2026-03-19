import { ethers } from 'ethers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_NETWORK } from '../constants/networks';
import { useUserActivity } from '../contexts/user-activity-context';
import { getDebtQuote, getCollateralQuote } from '../services/api';
import logger from '../utils/logger';
import { useDebounce } from './use-debounce';

const AUTO_REFRESH_SECONDS = 30;

const pickNumberish = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const resolveFeeBps = (routeResult: any): number | null => {
    const directCandidates = [
        routeResult?.feeBps,
        routeResult?.fee_bps,
        routeResult?.serviceFeeBps,
        routeResult?.service_fee_bps,
    ];

    for (const candidate of directCandidates) {
        const parsed = pickNumberish(candidate);

        if (parsed !== null) {
            return parsed;
        }
    }

    return null;
};

const resolveDiscountPercent = (routeResult: any): number => {
    const directCandidates = [
        routeResult?.discountPercent,
        routeResult?.discount_percent,
        routeResult?.partnerDiscountPercent,
        routeResult?.partner_discount_percent,
    ];

    for (const candidate of directCandidates) {
        const parsed = pickNumberish(candidate);

        if (parsed !== null) {
            return parsed;
        }
    }

    return 0;
};

interface UseParaswapQuoteProps {
    debtAmount?: bigint;
    sellAmount?: bigint;
    isCollateral?: boolean;
    fromToken: any;
    toToken: any;
    addLog?: (message: string, type?: string) => void;
    onQuoteLoaded?: (quote: any) => void;
    selectedNetwork: any;
    account: string | null;
    adapterAddress?: string | null;
    enabled?: boolean;
    freezeQuote?: boolean;
}

export const useParaswapQuote = ({
    debtAmount,
    sellAmount,
    isCollateral = false,
    fromToken,
    toToken,
    addLog,
    onQuoteLoaded,
    selectedNetwork,
    account,
    adapterAddress = null,
    enabled = true,
    freezeQuote = false
}: UseParaswapQuoteProps) => {
    const [swapQuote, setSwapQuote] = useState<any>(null);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
    const [slippage, setSlippage] = useState(50);
    const [isAutoSlippage, setIsAutoSlippage] = useState(true);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [quoteError, setQuoteError] = useState<any>(null);
    const [errorCountdown, setErrorCountdown] = useState(0);
    const { isTabVisible, isUserActive } = useUserActivity();

    const quoteRequestIdRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const errorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const currentAmount = isCollateral ? sellAmount : debtAmount;
    const debouncedAmount = useDebounce(currentAmount, 500);

    const resetRefreshCountdown = useCallback(() => {
        setNextRefreshIn(AUTO_REFRESH_SECONDS);
    }, []);

    const clearQuoteError = useCallback(() => {
        setQuoteError(null);
        setErrorCountdown(0);

        if (errorTimerRef.current) {
            clearTimeout(errorTimerRef.current);
            errorTimerRef.current = null;
        }

        if (errorIntervalRef.current) {
            clearInterval(errorIntervalRef.current);
            errorIntervalRef.current = null;
        }
    }, []);

    const setQuoteErrorWithTimer = useCallback((errorData: any, seconds = 15) => {
        clearQuoteError();
        setQuoteError(errorData);
        setErrorCountdown(seconds);

        errorIntervalRef.current = setInterval(() => {
            setErrorCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        errorTimerRef.current = setTimeout(() => {
            clearQuoteError();
        }, seconds * 1000);
    }, [clearQuoteError]);

    const clearQuote = useCallback(() => {
        quoteRequestIdRef.current += 1;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setSwapQuote(null);
        clearQuoteError();
        setAutoRefreshEnabled(false);
        resetRefreshCountdown();
    }, [resetRefreshCountdown, clearQuoteError]);

    const normalizeTokenAddress = (address: string, symbol = 'unknown') => {
        if (!address) {
            return null;
        }

        try {
            return ethers.getAddress(address);
        } catch (error: any) {
            logger.warn(`[useParaswapQuote] Invalid address checksum for ${symbol}: ${address}`, error.message);

            return address;
        }
    };

    const fetchQuote = useCallback(async () => {
        if (!debouncedAmount || debouncedAmount === BigInt(0) || !fromToken || !toToken) {
            setSwapQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        }

        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const toAddr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();

        if (fromAddr && toAddr && fromAddr === toAddr) {
            setSwapQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        }

        if (!account) {
            addLog?.('Please connect wallet to get quote', 'warning');
            setSwapQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        }

        setIsQuoteLoading(true);
        setIsTyping(false);
        resetRefreshCountdown();

        quoteRequestIdRef.current += 1;
        const currentRequestId = quoteRequestIdRef.current;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            const fromTokenAddress = normalizeTokenAddress(fromToken.address || fromToken.underlyingAsset, fromToken.symbol);
            const toTokenAddress = normalizeTokenAddress(toToken.address || toToken.underlyingAsset, toToken.symbol);

            if (isCollateral) {
                addLog?.('Updating quote...', 'info');
                const srcAmount = debouncedAmount.toString();

                const routeResult = await getCollateralQuote({
                    fromToken: { address: fromTokenAddress, decimals: fromToken.decimals, symbol: fromToken.symbol },
                    toToken: { address: toTokenAddress, decimals: toToken.decimals, symbol: toToken.symbol },
                    srcAmount,
                    adapterAddress: adapterAddress || account,
                    walletAddress: account,
                    chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
                }, signal);

                const { priceRoute, destAmount, version, augustus, bufferBps } = routeResult;
                const feeBps = resolveFeeBps(routeResult);
                const discountPercent = resolveDiscountPercent(routeResult);
                const destAmountBn = BigInt(destAmount);

                const quotePayload = {
                    priceRoute,
                    srcAmount: BigInt(srcAmount),
                    destAmount: destAmountBn,
                    fromToken,
                    toToken,
                    timestamp: Math.floor(Date.now() / 1000),
                    version,
                    augustus,
                    bufferBps,
                    feeBps,
                    discountPercent,
                    apyPercent: null,
                };

                if (quoteRequestIdRef.current !== currentRequestId) {
                    return null;
                }

                setSwapQuote(quotePayload);
                clearQuoteError();
                setAutoRefreshEnabled(true);
                onQuoteLoaded?.(quotePayload);

                return quotePayload;

            } else {
                addLog?.('Updating quote...', 'info');
                const apyDecimal = typeof fromToken?.variableBorrowRate === 'number'
                    ? fromToken.variableBorrowRate
                    : (typeof fromToken?.borrowRate === 'number' ? fromToken.borrowRate : 0.05);

                let destAmountBigInt = BigInt(debouncedAmount.toString());

                if (destAmountBigInt > 0n) {
                    const thirtyMinSeconds = 30 * 60;
                    const yearSeconds = 365 * 24 * 60 * 60;
                    const rawDebt = Number(destAmountBigInt);
                    const driftBuffer = Math.ceil(rawDebt * apyDecimal * (thirtyMinSeconds / yearSeconds));
                    destAmountBigInt += BigInt(driftBuffer) + 1n;
                }

                const destAmount = destAmountBigInt.toString();

                const apyPercentToSend = (typeof fromToken?.variableBorrowRate === 'number')
                    ? fromToken.variableBorrowRate * 100
                    : (typeof fromToken?.borrowRate === 'number' ? fromToken.borrowRate * 100 : null);

                const routeResult = await getDebtQuote({
                    fromToken: { address: fromTokenAddress, decimals: fromToken.decimals, symbol: fromToken.symbol },
                    toToken: { address: toTokenAddress, decimals: toToken.decimals, symbol: toToken.symbol },
                    destAmount,
                    adapterAddress: account,
                    walletAddress: account,
                    apyPercent: apyPercentToSend,
                    chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
                }, signal);

                const { priceRoute, srcAmount, version, augustus, bufferBps, apyPercent } = routeResult;
                const feeBps = resolveFeeBps(routeResult);
                const discountPercent = resolveDiscountPercent(routeResult);
                const srcAmountBigInt = BigInt(srcAmount);

                const quotePayload = {
                    priceRoute,
                    srcAmount: srcAmountBigInt,
                    destAmount: BigInt(destAmount),
                    fromToken,
                    toToken,
                    timestamp: Math.floor(Date.now() / 1000),
                    version,
                    augustus,
                    bufferBps,
                    feeBps,
                    discountPercent,
                    apyPercent: typeof apyPercent === 'number' ? apyPercent : null,
                };

                if (quoteRequestIdRef.current !== currentRequestId) {
                    return null;
                }

                setSwapQuote(quotePayload);
                clearQuoteError();
                setAutoRefreshEnabled(true);
                onQuoteLoaded?.(quotePayload);

                return quotePayload;
            }
        } catch (error: any) {
            if (error.name === 'AbortError' || error.message === 'canceled') {
                return null;
            }

            addLog?.('Quote error: ' + error.message, 'error');
            setQuoteErrorWithTimer({ message: error.message || 'Failed to fetch quote' });
            setSwapQuote(null);

            return null;
        } finally {
            setIsQuoteLoading(false);
        }
    }, [debouncedAmount, isCollateral, fromToken, toToken, addLog, onQuoteLoaded, resetRefreshCountdown, selectedNetwork?.chainId, account, adapterAddress, clearQuoteError, setQuoteErrorWithTimer]);

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    useEffect(() => {
        setIsTyping(!!(currentAmount && currentAmount !== debouncedAmount && currentAmount > 0n));
    }, [currentAmount, debouncedAmount]);

    const tokenJustChangedRef = useRef(false);
    useEffect(() => {
        tokenJustChangedRef.current = true;
        clearQuote();
    }, [fromToken?.address, fromToken?.underlyingAsset, toToken?.address, toToken?.underlyingAsset, clearQuote]);

    useEffect(() => {
        if (!enabled) {
            clearQuote();

            return;
        }

        if (!currentAmount || currentAmount === 0n) {
            clearQuote();

            return;
        }

        if (currentAmount !== debouncedAmount && !tokenJustChangedRef.current) {
            return;
        }

        tokenJustChangedRef.current = false;
        fetchQuote();
    }, [currentAmount, debouncedAmount, enabled, fetchQuote, clearQuote]);

    useEffect(() => {
        if (!autoRefreshEnabled || !enabled || freezeQuote) {
            return;
        }

        const interval = setInterval(() => {
            if (!isTabVisible || !isUserActive) {
                return;
            }

            setNextRefreshIn((prev) => {
                if (prev <= 1) {
                    fetchQuote();

                    return AUTO_REFRESH_SECONDS;
                }

                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [autoRefreshEnabled, fetchQuote, enabled, freezeQuote, isTabVisible, isUserActive]);

    const { priceImpact, recommendedSlippage } = useMemo(() => {
        if (!swapQuote?.priceRoute) {
            return { priceImpact: 0, recommendedSlippage: 10 };
        }

        let impact = swapQuote.priceRoute.priceImpact || 0;

        if (impact === 0 && swapQuote.priceRoute.srcUSD && swapQuote.priceRoute.destUSD) {
            const srcUSD = parseFloat(swapQuote.priceRoute.srcUSD);
            const destUSD = parseFloat(swapQuote.priceRoute.destUSD);

            if (srcUSD > 0) {
                impact = Math.max(0, (srcUSD - destUSD) / srcUSD);
            }
        }

        return { priceImpact: impact, recommendedSlippage: Math.max(10, Math.ceil(impact * 10000) + 10) };
    }, [swapQuote]);

    useEffect(() => {
        if (isAutoSlippage && swapQuote) {
            setSlippage(recommendedSlippage);
        }
    }, [swapQuote, isAutoSlippage, recommendedSlippage]);

    return {
        swapQuote, slippage, setSlippage, isAutoSlippage, setIsAutoSlippage,
        recommendedSlippage, priceImpact, autoRefreshEnabled, nextRefreshIn,
        fetchQuote, resetRefreshCountdown, clearQuote, isQuoteLoading, isTyping,
        quoteError, setQuoteError: setQuoteErrorWithTimer, clearQuoteError, errorCountdown,
    };
};
