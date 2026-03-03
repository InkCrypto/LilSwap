import { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { getDebtQuote, getCollateralQuote } from '../services/api.js';
import { useDebounce } from './useDebounce.js';

import logger from '../utils/logger.js';
const AUTO_REFRESH_SECONDS = 30;

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
}) => {
    const [swapQuote, setSwapQuote] = useState(null);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
    // slippage is expressed in basis points (bps) across the app: 25 = 0.25%
    const [slippage, setSlippage] = useState(25);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);

    // Track the current quote request to prevent stale responses from overriding cleared state
    const quoteRequestIdRef = useRef(0);
    const abortControllerRef = useRef(null);

    // Debounce debtAmount to avoid spamming API while user types
    const currentAmount = isCollateral ? sellAmount : debtAmount;
    const debouncedAmount = useDebounce(currentAmount, 500);

    const resetRefreshCountdown = useCallback(() => {
        setNextRefreshIn(AUTO_REFRESH_SECONDS);
    }, []);

    const clearQuote = useCallback(() => {
        quoteRequestIdRef.current += 1; // Invalidate any in-flight quote requests
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setSwapQuote(null);
        setAutoRefreshEnabled(false);
        resetRefreshCountdown();
    }, [resetRefreshCountdown]);

    /**
     * Normalize and validate token address for ParaSwap API
     * @param {string} address - Raw token address
     * @param {string} symbol - Token symbol for logging
     * @returns {string} Normalized address or original if invalid
     */
    const normalizeTokenAddress = (address, symbol = 'unknown') => {
        if (!address) return null;
        try {
            const normalized = ethers.getAddress(address);
            logger.debug(`[useParaswapQuote] Address normalized for ${symbol}: ${address.substring(0, 10)}... -> ${normalized.substring(0, 10)}...`);
            return normalized;
        } catch (error) {
            logger.warn(`[useParaswapQuote] Invalid address checksum for ${symbol}: ${address}`, error.message);
            return address; // Fallback to original and let backend validate
        }
    };

    const fetchQuote = useCallback(async () => {
        logger.debug('[useParaswapQuote] fetchQuote called', {
            debouncedAmount: debouncedAmount?.toString(),
            fromToken: fromToken?.symbol,
            toToken: toToken?.symbol,
            account,
            enabled
        });

        if (!debouncedAmount || debouncedAmount === BigInt(0) || !fromToken || !toToken) {
            logger.debug('[useParaswapQuote] Missing required data, skipping quote');
            setSwapQuote(null);
            setAutoRefreshEnabled(false);
            return null;
        }

        // Guard: same from/to address (happens briefly when switching tokens)
        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const toAddr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();
        if (fromAddr && toAddr && fromAddr === toAddr) {
            logger.debug('[useParaswapQuote] Same from/to token, skipping quote');
            setSwapQuote(null);
            setAutoRefreshEnabled(false);
            return null;
        }

        if (!account) {
            logger.debug('[useParaswapQuote] No account connected');
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

        // Abort any existing request before starting a new one
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            // Normalize addresses before sending to backend
            const fromTokenAddress = normalizeTokenAddress(fromToken.address || fromToken.underlyingAsset, fromToken.symbol);
            const toTokenAddress = normalizeTokenAddress(toToken.address || toToken.underlyingAsset, toToken.symbol);

            if (isCollateral) {
                addLog?.(`Swapping collateral: ${fromToken.symbol} -> ${toToken.symbol}...`, 'info');
                addLog?.('Updating quote...', 'info');

                const srcAmount = debouncedAmount.toString();

                logger.debug('[useParaswapQuote] Fetching collateral quote with params:', {
                    fromToken: fromToken.symbol,
                    toToken: toToken.symbol,
                    srcAmount,
                    chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId
                });

                const routeResult = await getCollateralQuote({
                    fromToken: {
                        address: fromTokenAddress,
                        decimals: fromToken.decimals,
                        symbol: fromToken.symbol,
                    },
                    toToken: {
                        address: toTokenAddress,
                        decimals: toToken.decimals,
                        symbol: toToken.symbol,
                    },
                    srcAmount: srcAmount,
                    adapterAddress: adapterAddress || account, // adapter contract is required; fallback to account
                    walletAddress: account,
                    chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
                }, signal);

                const { priceRoute, destAmount, version, augustus, bufferBps, feeBps } = routeResult;
                const quoteTimestamp = Math.floor(Date.now() / 1000);

                const srcAmountBigInt = BigInt(srcAmount);
                const destAmountBn = BigInt(destAmount);

                addLog?.(`Quote received - will receive approx ${ethers.formatUnits(destAmountBn, toToken.decimals)} ${toToken.symbol}`, 'success');

                const quotePayload = {
                    priceRoute,
                    srcAmount: srcAmountBigInt,
                    destAmount: destAmountBn,
                    fromToken,
                    toToken,
                    timestamp: quoteTimestamp,
                    version,
                    augustus,
                    bufferBps,
                    feeBps,
                    apyPercent: null,
                };

                if (quoteRequestIdRef.current !== currentRequestId) {
                    logger.debug('[useParaswapQuote] Collateral quote received, but request ID mutated (dropped)');
                    return null;
                }

                setSwapQuote(quotePayload);
                setAutoRefreshEnabled(true);
                onQuoteLoaded?.(quotePayload);
                return quotePayload;

            } else {
                addLog?.(`Swapping debt: ${fromToken.symbol} -> ${toToken.symbol}...`, 'info');
                addLog?.('Updating quote...', 'info');

                // Calculate a buffer to cover APY drift while the transaction is mining
                const apyDecimal = typeof fromToken?.variableBorrowRate === 'number'
                    ? fromToken.variableBorrowRate
                    : (typeof fromToken?.borrowRate === 'number' ? fromToken.borrowRate : 0.05); // Default 5%

                let destAmountBigInt = BigInt(debouncedAmount.toString());
                if (destAmountBigInt > 0n) {
                    const thirtyMinSeconds = 30 * 60;
                    const yearSeconds = 365 * 24 * 60 * 60;
                    const rawDebt = Number(destAmountBigInt);
                    const driftBuffer = Math.ceil(rawDebt * apyDecimal * (thirtyMinSeconds / yearSeconds));
                    const driftBigInt = BigInt(driftBuffer) + 1n;
                    destAmountBigInt += driftBigInt;
                }
                const destAmount = destAmountBigInt.toString();

                addLog?.('Finding best route on ParaSwap...', 'info');
                addLog?.(`Quote target: ${toToken.symbol}, repay amount: ${destAmount} (exact amount)`, 'info');

                const apyPercentToSend = (typeof fromToken?.variableBorrowRate === 'number')
                    ? fromToken.variableBorrowRate * 100
                    : (typeof fromToken?.borrowRate === 'number' ? fromToken.borrowRate * 100 : null);

                const routeResult = await getDebtQuote({
                    fromToken: {
                        address: fromTokenAddress,
                        decimals: fromToken.decimals,
                        symbol: fromToken.symbol,
                    },
                    toToken: {
                        address: toTokenAddress,
                        decimals: toToken.decimals,
                        symbol: toToken.symbol,
                    },
                    destAmount: destAmount,
                    adapterAddress: account,
                    apyPercent: apyPercentToSend,
                    chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
                }, signal);

                const { priceRoute, srcAmount, version, augustus, bufferBps, feeBps, apyPercent } = routeResult;
                const quoteTimestamp = Math.floor(Date.now() / 1000);

                const srcAmountBigInt = BigInt(srcAmount);
                const destAmountBn = BigInt(destAmount);

                addLog?.(`Quote received - will need ${ethers.formatUnits(srcAmountBigInt, toToken.decimals)} ${toToken.symbol}`, 'success');

                const quotePayload = {
                    priceRoute,
                    srcAmount: srcAmountBigInt,
                    destAmount: destAmountBn,
                    fromToken,
                    toToken,
                    timestamp: quoteTimestamp,
                    version,
                    augustus,
                    bufferBps,
                    feeBps,
                    apyPercent: typeof apyPercent === 'number' ? apyPercent : null,
                };

                if (quoteRequestIdRef.current !== currentRequestId) {
                    logger.debug('[useParaswapQuote] Debt quote received, but request ID mutated (dropped)');
                    return null;
                }

                setSwapQuote(quotePayload);
                setAutoRefreshEnabled(true);
                onQuoteLoaded?.(quotePayload);
                return quotePayload;
            }
        } catch (error) {
            // Ignore canceled/aborted requests (expected when switching tokens)
            if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError' || error.message === 'canceled') {
                logger.debug('[useParaswapQuote] Quote request canceled (expected)');
                return null;
            }

            logger.error('[useParaswapQuote] Quote error:', error);
            addLog?.('Quote error: ' + error.message, 'error');
            setAutoRefreshEnabled(false);
            return null;
        } finally {
            setIsQuoteLoading(false);
        }
    }, [
        debouncedAmount,
        isCollateral,
        fromToken,
        toToken,
        addLog,
        onQuoteLoaded,
        resetRefreshCountdown,
        selectedNetwork?.chainId,
        account,
        adapterAddress,
        enabled
    ]);

    // Cleanup: abort any in-flight request when the hook unmounts
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    // Detect when user is typing
    useEffect(() => {
        if (currentAmount !== debouncedAmount && currentAmount > BigInt(0)) {
            setIsTyping(true);
        } else {
            setIsTyping(false);
        }
    }, [currentAmount, debouncedAmount]);

    // Proactively clear quote when token addresses change — runs BEFORE the debounced auto-fetch
    // so we never display stale quote data during the transition.
    const prevFromAddrRef = useRef('');
    const prevToAddrRef = useRef('');
    const tokenJustChangedRef = useRef(false);
    useEffect(() => {
        const fromAddr = (fromToken?.address || fromToken?.underlyingAsset || '').toLowerCase();
        const toAddr = (toToken?.address || toToken?.underlyingAsset || '').toLowerCase();
        const changed = (fromAddr !== prevFromAddrRef.current) || (toAddr !== prevToAddrRef.current);
        prevFromAddrRef.current = fromAddr;
        prevToAddrRef.current = toAddr;
        if (changed) {
            // Invalidate in-flight requests to prevent stale responses from overwriting cleared state
            quoteRequestIdRef.current += 1;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            setSwapQuote(null);
            setAutoRefreshEnabled(false);
            setIsQuoteLoading(false);
            resetRefreshCountdown();

            // Mark that token just changed to skip debounce check on next auto-fetch
            tokenJustChangedRef.current = true;
        }
    }, [fromToken?.address, fromToken?.underlyingAsset, toToken?.address, toToken?.underlyingAsset, resetRefreshCountdown]);

    // Auto-fetch quote
    useEffect(() => {
        logger.debug('[useParaswapQuote] Auto-fetch effect triggered:', {
            enabled,
            currentAmount: currentAmount?.toString(),
            debouncedAmount: debouncedAmount?.toString(),
            fromToken: fromToken?.symbol,
            toToken: toToken?.symbol
        });

        if (!enabled) {
            clearQuote();
            return;
        }

        // 1. Instant abort if the real amount is 0 (e.g. user cleared input or switched tokens)
        // This prevents the race condition where debouncedAmount is still > 0 for 500ms
        if (!currentAmount || currentAmount === BigInt(0)) {
            logger.debug('[useParaswapQuote] Current amount is 0, clearing quote immediately');
            clearQuote();
            return;
        }

        // 2. If the user is actively typing, wait for the debounce to catch up
        // UNLESS token just changed (then fetch immediately with current amount)
        if (currentAmount !== debouncedAmount && !tokenJustChangedRef.current) {
            logger.debug('[useParaswapQuote] User is typing (current != debounced), waiting...');
            return;
        }

        // Clear the token-changed flag after using it
        if (tokenJustChangedRef.current) {
            logger.debug('[useParaswapQuote] Token just changed, fetching immediately without debounce wait');
            tokenJustChangedRef.current = false;
        }

        // 3. Fallback checks
        if (!debouncedAmount || debouncedAmount === BigInt(0) || !fromToken || !toToken) {
            clearQuote();
            return;
        }

        // Guard: same from/to address (happens briefly when switching tokens)
        const fromAddr = (fromToken.address || fromToken.underlyingAsset || '').toLowerCase();
        const toAddr = (toToken.address || toToken.underlyingAsset || '').toLowerCase();
        if (fromAddr && toAddr && fromAddr === toAddr) {
            clearQuote();
            return;
        }

        logger.debug('[useParaswapQuote] Calling fetchQuote...');
        fetchQuote();
    }, [currentAmount, debouncedAmount, fromToken?.underlyingAsset, toToken?.underlyingAsset, enabled, fetchQuote, clearQuote]);

    // Refresh interval
    useEffect(() => {
        if (!autoRefreshEnabled || !enabled || freezeQuote) return;

        const interval = setInterval(() => {
            setNextRefreshIn((prev) => {
                if (prev <= 1) {
                    fetchQuote();
                    return AUTO_REFRESH_SECONDS;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [autoRefreshEnabled, fetchQuote, enabled, freezeQuote]);

    return {
        swapQuote,
        slippage,
        setSlippage,
        autoRefreshEnabled,
        nextRefreshIn,
        fetchQuote,
        resetRefreshCountdown,
        clearQuote,
        isQuoteLoading,
        isTyping,
    };
};
