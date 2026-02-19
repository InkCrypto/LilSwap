import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { getDebtQuote } from '../services/api.js';
import { useDebounce } from './useDebounce.js';

import logger from '../utils/logger.js';
const AUTO_REFRESH_SECONDS = 30;

export const useParaswapQuote = ({
    debtAmount,
    fromToken,
    toToken,
    addLog,
    onQuoteLoaded,
    selectedNetwork,
    account,
    enabled = true,
    freezeQuote = false
}) => {
    const [swapQuote, setSwapQuote] = useState(null);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
    // slippage is expressed in basis points (bps) across the app: 50 = 0.5%
    const [slippage, setSlippage] = useState(50);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);

    // Debounce debtAmount to avoid spamming API while user types
    const debouncedDebtAmount = useDebounce(debtAmount, 500);

    const resetRefreshCountdown = useCallback(() => {
        setNextRefreshIn(AUTO_REFRESH_SECONDS);
    }, []);

    const clearQuote = useCallback(() => {
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
            debouncedDebtAmount: debouncedDebtAmount?.toString(),
            fromToken: fromToken?.symbol,
            toToken: toToken?.symbol,
            account,
            enabled
        });

        if (!debouncedDebtAmount || debouncedDebtAmount === BigInt(0) || !fromToken || !toToken) {
            logger.debug('[useParaswapQuote] Missing required data, skipping quote');
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

        try {
            addLog?.(`Swapping debt: ${fromToken.symbol} -> ${toToken.symbol}...`, 'info');
            addLog?.('Updating quote...', 'info');

            const destAmount = debouncedDebtAmount.toString();

            logger.debug('[useParaswapQuote] Fetching quote with params:', {
                fromToken: fromToken.symbol,
                fromAddress: fromToken.address || fromToken.underlyingAsset,
                toToken: toToken.symbol,
                toAddress: toToken.address || toToken.underlyingAsset,
                destAmount,
                chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId
            });

            addLog?.('Finding best route on ParaSwap...', 'info');
            addLog?.(`Quote target: ${toToken.symbol}, repay amount: ${destAmount} (exact amount)`, 'info');

            // Normalize addresses before sending to backend
            const fromTokenAddress = normalizeTokenAddress(fromToken.address || fromToken.underlyingAsset, fromToken.symbol);
            const toTokenAddress = normalizeTokenAddress(toToken.address || toToken.underlyingAsset, toToken.symbol);

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
                userAddress: account,
                chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
            });

            const { priceRoute, srcAmount, version, augustus, bufferBps, feeBps } = routeResult;
            const quoteTimestamp = Math.floor(Date.now() / 1000);

            // Convert strings to BigInt
            const srcAmountBigInt = BigInt(srcAmount);
            const destAmountBigInt = BigInt(destAmount);

            logger.debug('[useParaswapQuote] Quote received:', {
                srcAmount: srcAmountBigInt.toString(),
                destAmount: destAmountBigInt.toString(),
                srcAmountFormatted: ethers.formatUnits(srcAmountBigInt, toToken.decimals),
                version,
                augustus,
                bufferBps,
                feeBps
            });

            addLog?.(`Quote received - will need ${ethers.formatUnits(srcAmountBigInt, toToken.decimals)} ${toToken.symbol}`, 'success');

            const quotePayload = {
                priceRoute,
                srcAmount: srcAmountBigInt,
                destAmount: destAmountBigInt,
                fromToken,
                toToken,
                timestamp: quoteTimestamp,
                version,
                augustus,
                bufferBps,
                feeBps,
            };

            setSwapQuote(quotePayload);
            setAutoRefreshEnabled(true);
            onQuoteLoaded?.(quotePayload);
            return quotePayload;
        } catch (error) {
            logger.error('[useParaswapQuote] Quote error:', error);
            addLog?.('Quote error: ' + error.message, 'error');
            setAutoRefreshEnabled(false);
            return null;
        } finally {
            setIsQuoteLoading(false);
        }
    }, [
        debouncedDebtAmount,
        fromToken,
        toToken,
        addLog,
        onQuoteLoaded,
        resetRefreshCountdown,
        selectedNetwork?.chainId,
        account,
    ]);

    // Detect when user is typing
    useEffect(() => {
        if (debtAmount !== debouncedDebtAmount && debtAmount > BigInt(0)) {
            setIsTyping(true);
        } else {
            setIsTyping(false);
        }
    }, [debtAmount, debouncedDebtAmount]);

    // Auto-fetch quote
    useEffect(() => {
        logger.debug('[useParaswapQuote] Auto-fetch effect triggered:', {
            enabled,
            debouncedDebtAmount: debouncedDebtAmount?.toString(),
            fromToken: fromToken?.symbol,
            fromAddress: fromToken?.underlyingAsset,
            toToken: toToken?.symbol,
            toAddress: toToken?.underlyingAsset
        });

        if (!enabled) {
            logger.debug('[useParaswapQuote] Disabled, clearing quote');
            clearQuote();
            return;
        }

        if (!debouncedDebtAmount || debouncedDebtAmount === BigInt(0) || !fromToken || !toToken) {
            logger.debug('[useParaswapQuote] Conditions not met, clearing quote');
            clearQuote();
            return;
        }

        logger.debug('[useParaswapQuote] Calling fetchQuote...');
        fetchQuote();
    }, [debouncedDebtAmount, fromToken?.underlyingAsset, toToken?.underlyingAsset, enabled, fetchQuote, clearQuote]);

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
