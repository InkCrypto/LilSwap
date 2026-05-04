import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUserActivity } from '../contexts/user-activity-context';
import { getDebtLimitQuote } from '../services/api';
import type { DebtLimitQuoteResult } from '../services/api';
import logger from '../utils/logger';
import { useDebounce } from './use-debounce';

const AUTO_REFRESH_SECONDS = 30;
const ERROR_RETRY_SECONDS = 15;

const getTokenAddress = (token: any) => (token?.address || token?.underlyingAsset || '').toLowerCase();

interface UseLimitQuoteProps {
    isOpen?: boolean;
    account: string | null;
    effectiveNetwork: any;
    initialMarketKey?: string | null;
    fromToken: any;
    toToken: any;
    limitInputAmount: bigint;
    debtBalance: bigint;
    limitExpirySeconds: number;
    getPriceMetadata: () => Record<string, unknown>;
    enabled?: boolean;
    freezeQuote?: boolean;
}

export const useLimitQuote = ({
    isOpen = true,
    account,
    effectiveNetwork,
    initialMarketKey,
    fromToken,
    toToken,
    limitInputAmount,
    debtBalance,
    limitExpirySeconds,
    getPriceMetadata,
    enabled = true,
    freezeQuote = false,
}: UseLimitQuoteProps) => {
    const [debtLimitQuote, setDebtLimitQuote] = useState<DebtLimitQuoteResult | null>(null);
    const [isDebtLimitQuoteLoading, setIsDebtLimitQuoteLoading] = useState(false);
    const [debtLimitQuoteError, setDebtLimitQuoteError] = useState<string | null>(null);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
    const [errorCountdown, setErrorCountdown] = useState(0);
    const [debtLimitValidTo, setDebtLimitValidTo] = useState<number | null>(null);
    const [marketLimitPrice, setMarketLimitPrice] = useState('');
    const { isTabVisible, isUserActive } = useUserActivity();

    const quoteRequestIdRef = useRef(0);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const errorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const inFlightQuoteKeyRef = useRef<string | null>(null);
    const lastAutoRequestedQuoteKeyRef = useRef<string | null>(null);

    // Match market behavior: one debounce layer, no extra post-debounce timer.
    const debouncedInputAmount = useDebounce(limitInputAmount, 500);
    const priceMetadata = getPriceMetadata();
    const priceMetadataKey = JSON.stringify(priceMetadata);
    const quoteTriggerMetadata = useMemo(() => {
        const metadata = { ...(priceMetadata || {}) } as Record<string, unknown>;
        // Display-only toggle fields must not trigger requote.
        delete metadata.priceInverted;
        delete metadata.priceDirection;
        delete metadata.priceBaseTokenAddress;
        delete metadata.priceBaseTokenSymbol;
        delete metadata.priceBaseTokenDecimals;
        delete metadata.priceQuoteTokenAddress;
        delete metadata.priceQuoteTokenSymbol;
        delete metadata.priceQuoteTokenDecimals;

        return metadata;
    }, [priceMetadata]);
    const quoteInputKey = useMemo(() => JSON.stringify({
        enabled,
        isOpen,
        account,
        chainId: effectiveNetwork?.chainId ?? null,
        marketKey: initialMarketKey || effectiveNetwork?.key || null,
        fromAddress: getTokenAddress(fromToken),
        fromDecimals: fromToken?.decimals ?? 18,
        fromSymbol: fromToken?.symbol ?? '',
        toAddress: getTokenAddress(toToken),
        toDecimals: toToken?.decimals ?? 18,
        toSymbol: toToken?.symbol ?? '',
        buyAmount: limitInputAmount.toString(),
        debtBalance: (debtBalance || 0n).toString(),
        quoteTriggerMetadata,
    }), [
        enabled,
        isOpen,
        account,
        effectiveNetwork?.chainId,
        effectiveNetwork?.key,
        initialMarketKey,
        fromToken,
        toToken,
        limitInputAmount,
        debtBalance,
        quoteTriggerMetadata,
    ]);
    const latestQuoteParamsRef = useRef({
        enabled,
        isOpen,
        account,
        effectiveNetwork,
        initialMarketKey,
        fromToken,
        toToken,
        limitInputAmount,
        debtBalance,
        limitExpirySeconds,
        priceMetadata,
        quoteInputKey,
    });

    useEffect(() => {
        latestQuoteParamsRef.current = {
            enabled,
            isOpen,
            account,
            effectiveNetwork,
            initialMarketKey,
            fromToken,
            toToken,
            limitInputAmount,
            debtBalance,
            limitExpirySeconds,
            priceMetadata,
            quoteInputKey,
        };
    }, [
        enabled,
        isOpen,
        account,
        effectiveNetwork,
        initialMarketKey,
        fromToken,
        toToken,
        limitInputAmount,
        debtBalance,
        limitExpirySeconds,
        priceMetadata,
        priceMetadataKey,
        quoteInputKey,
    ]);

    const resetRefreshCountdown = useCallback(() => {
        setNextRefreshIn(AUTO_REFRESH_SECONDS);
    }, []);

    const clearQuoteError = useCallback(() => {
        setDebtLimitQuoteError(null);
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

    const setQuoteErrorWithTimer = useCallback((errorMessage: string) => {
        clearQuoteError();
        setDebtLimitQuoteError(errorMessage);
        setErrorCountdown(ERROR_RETRY_SECONDS);

        errorIntervalRef.current = setInterval(() => {
            setErrorCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);

        errorTimerRef.current = setTimeout(() => {
            clearQuoteError();
        }, ERROR_RETRY_SECONDS * 1000);
    }, [clearQuoteError]);

    const clearQuote = useCallback(() => {
        quoteRequestIdRef.current += 1;

        setDebtLimitQuote(null);
        clearQuoteError();
        setAutoRefreshEnabled(false);
        setMarketLimitPrice('');
        setDebtLimitValidTo(null);
        lastAutoRequestedQuoteKeyRef.current = null;
        resetRefreshCountdown();
    }, [resetRefreshCountdown, clearQuoteError]);

    const fetchQuote = useCallback(async () => {
        const params = latestQuoteParamsRef.current;
        const canQuote =
            params.enabled &&
            params.isOpen &&
            !!params.account &&
            !!params.effectiveNetwork?.chainId &&
            !!params.fromToken &&
            !!params.toToken &&
            params.limitInputAmount > 0n &&
            params.limitInputAmount <= (params.debtBalance || 0n);

        if (!canQuote) {
            setDebtLimitQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        }

        const fromAddr = getTokenAddress(params.fromToken);
        const toAddr = getTokenAddress(params.toToken);

        if (fromAddr && toAddr && fromAddr === toAddr) {
            setDebtLimitQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        }

        if (inFlightQuoteKeyRef.current === params.quoteInputKey) {
            return null;
        }

        inFlightQuoteKeyRef.current = params.quoteInputKey;
        setIsDebtLimitQuoteLoading(true);
        resetRefreshCountdown();

        quoteRequestIdRef.current += 1;
        const currentRequestId = quoteRequestIdRef.current;

        const nextValidTo = Math.floor(Date.now() / 1000) + params.limitExpirySeconds;

        try {
            const result = await getDebtLimitQuote({
                walletAddress: params.account!,
                chainId: params.effectiveNetwork.chainId,
                marketKey: params.initialMarketKey || params.effectiveNetwork?.key || null,
                fromToken: {
                    address: params.fromToken.address || params.fromToken.underlyingAsset || '',
                    decimals: params.fromToken.decimals ?? 18,
                    symbol: params.fromToken.symbol ?? '',
                },
                toToken: {
                    address: params.toToken.address || params.toToken.underlyingAsset || '',
                    decimals: params.toToken.decimals ?? 18,
                    symbol: params.toToken.symbol ?? '',
                },
                buyAmount: params.limitInputAmount.toString(),
                validTo: nextValidTo,
                ...params.priceMetadata,
            });

            if (currentRequestId !== quoteRequestIdRef.current) {
                return null;
            }

            const quoteValidTo = typeof result.orderValidTo === 'number' ? result.orderValidTo : nextValidTo;
            setDebtLimitQuote(result);
            setDebtLimitValidTo(quoteValidTo);
            clearQuoteError();
            setAutoRefreshEnabled(true);

            const quoteMarketLimitPrice = result.displayLimitPrice || result.marketLimitPrice || '';
            setMarketLimitPrice(quoteMarketLimitPrice);

            logger.debug('[useLimitQuote] Quote fetched', {
                quoteId: result.quoteId,
                sellAmount: result.sellAmount,
                buyAmount: result.buyAmount,
                marketLimitPrice: quoteMarketLimitPrice,
            });

            return result;
        } catch (err: any) {
            if (currentRequestId !== quoteRequestIdRef.current) {
                return null;
            }

            const msg = err?.message || 'Unable to fetch limit quote.';
            setQuoteErrorWithTimer(msg);
            setDebtLimitQuote(null);
            setAutoRefreshEnabled(false);

            return null;
        } finally {
            if (currentRequestId === quoteRequestIdRef.current) {
                setIsDebtLimitQuoteLoading(false);
            }

            if (inFlightQuoteKeyRef.current === params.quoteInputKey) {
                inFlightQuoteKeyRef.current = null;
            }
        }
    }, [resetRefreshCountdown, clearQuoteError, setQuoteErrorWithTimer]);

    useEffect(() => {
        if (!enabled) {
            clearQuote();

            return;
        }

        if (!limitInputAmount || limitInputAmount === 0n) {
            clearQuote();

            return;
        }

        if (
            debouncedInputAmount === limitInputAmount &&
            lastAutoRequestedQuoteKeyRef.current !== quoteInputKey
        ) {
            lastAutoRequestedQuoteKeyRef.current = quoteInputKey;
            fetchQuote();
        }
    }, [
        quoteInputKey,
        limitInputAmount,
        debouncedInputAmount,
        enabled,
        fetchQuote,
        clearQuote,
    ]);

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

    useEffect(() => {
        if (errorCountdown === 0 || !debtLimitQuoteError) {
            return;
        }

        const retryTimer = setTimeout(() => {
            if (enabled && !freezeQuote) {
                fetchQuote();
            }
        }, ERROR_RETRY_SECONDS * 1000);

        return () => clearTimeout(retryTimer);
    }, [errorCountdown, debtLimitQuoteError, fetchQuote, enabled, freezeQuote]);

    const debtLimitQuoteState = useMemo(() => {
        if (isDebtLimitQuoteLoading) {
            return 'quoteLoading';
        }

        if (debtLimitQuoteError) {
            return 'quoteError';
        }

        if (debtLimitQuote) {
            return 'quoteReady';
        }

        return 'quoteMissing';
    }, [isDebtLimitQuoteLoading, debtLimitQuoteError, debtLimitQuote]);

    return {
        debtLimitQuote,
        setDebtLimitQuote,
        isDebtLimitQuoteLoading,
        setIsDebtLimitQuoteLoading,
        debtLimitQuoteError,
        setDebtLimitQuoteError: setQuoteErrorWithTimer,
        clearQuoteError,
        debtLimitQuoteState,
        debtLimitValidTo,
        setDebtLimitValidTo,
        marketLimitPrice,
        setMarketLimitPrice,
        autoRefreshEnabled,
        nextRefreshIn,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        errorCountdown,
    };
};
