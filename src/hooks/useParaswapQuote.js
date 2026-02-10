import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { getDebtQuote } from '../services/api.js';
import { getTokenDefsByDirection } from '../services/aaveContracts.js';
import { useDebounce } from './useDebounce.js';

const AUTO_REFRESH_SECONDS = 30;

export const useParaswapQuote = ({ debtBalance, direction, addLog, onQuoteLoaded, selectedNetwork }) => {
    const [swapQuote, setSwapQuote] = useState(null);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_SECONDS);
    const [slippage, setSlippage] = useState(10);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    // Debounce debtBalance to avoid spamming API while user types
    const debouncedDebtBalance = useDebounce(debtBalance, 500);

    const resetRefreshCountdown = useCallback(() => {
        setNextRefreshIn(AUTO_REFRESH_SECONDS);
    }, []);

    const clearQuote = useCallback(() => {
        setSwapQuote(null);
        setAutoRefreshEnabled(false);
        resetRefreshCountdown();
    }, [resetRefreshCountdown]);

    const fetchQuote = useCallback(async () => {
        if (!debouncedDebtBalance || debouncedDebtBalance === BigInt(0)) {
            setSwapQuote(null);
            setAutoRefreshEnabled(false);
            return null;
        }

        setIsQuoteLoading(true);
        setIsTyping(false);
        resetRefreshCountdown();

        try {
            const { fromToken, toToken } = getTokenDefsByDirection(direction, networkAddresses);

            addLog?.(`Direction: ${direction}`, 'info');
            addLog?.(`Current Debt (fromToken): ${fromToken.symbol}`, 'info');
            addLog?.(`New Debt (toToken): ${toToken.symbol}`, 'info');
            addLog?.('Updating quote...', 'info');

            const destAmount = (debouncedDebtBalance * BigInt(1001) / BigInt(1000)).toString();

            addLog?.('Finding best route on ParaSwap (SDK v6.2 → fallback v5)...', 'info');
            addLog?.(`Quote: ${toToken.symbol} → ${fromToken.symbol}, amount: ${destAmount} (Buffer +0.1%)`, 'info');
            addLog?.('Quote with 0.1% buffer to cover accrued interest', 'info');

            const routeResult = await getDebtQuote({
                fromToken: {
                    address: fromToken.address,
                    decimals: fromToken.decimals,
                    symbol: fromToken.symbol,
                },
                toToken: {
                    address: toToken.address,
                    decimals: toToken.decimals,
                    symbol: toToken.symbol,
                },
                destAmount: destAmount,
                userAddress: networkAddresses.ADAPTER,
                chainId: targetNetwork.chainId,
            });

            const { priceRoute, srcAmount, version, augustus } = routeResult;
            const quoteTimestamp = Math.floor(Date.now() / 1000);

            // Convert strings to BigInt (backend returns as string via JSON)
            const srcAmountBigInt = BigInt(srcAmount);
            const destAmountBigInt = BigInt(destAmount);

            const contractAddress = augustus?.toLowerCase() || priceRoute.contractAddress?.toLowerCase() || 'unknown';
            const detectedVersion = contractAddress === networkAddresses.AUGUSTUS.V6_2.toLowerCase()
                ? 'v6.2'
                : contractAddress === networkAddresses.AUGUSTUS.V5.toLowerCase()
                    ? 'v5'
                    : version;

            addLog?.(`📦 Augustus ${detectedVersion} | Method: ${priceRoute.contractMethod || 'buildTx'}`, 'info');
            addLog?.(`Quote received - will need ${ethers.formatUnits(srcAmountBigInt, toToken.decimals)} ${toToken.symbol}`, 'success');
            addLog?.(`Quote timestamp: ${quoteTimestamp} (valid for ~10 min)`, 'debug');

            const quotePayload = {
                priceRoute,
                srcAmount: srcAmountBigInt,
                destAmount: destAmountBigInt,
                fromToken,
                toToken,
                timestamp: quoteTimestamp,
                version,
                augustus,
            };

            setSwapQuote(quotePayload);
            setAutoRefreshEnabled(true);
            onQuoteLoaded?.(quotePayload);
            return quotePayload;
        } catch (error) {
            addLog?.('Quote error: ' + error.message, 'error');
            // setSwapQuote(null); // Keep previous quote visible
            setAutoRefreshEnabled(false);
            return null;
        } finally {
            setIsQuoteLoading(false);
        }
    }, [
        debouncedDebtBalance,
        direction,
        addLog,
        onQuoteLoaded,
        resetRefreshCountdown,
        targetNetwork.chainId,
        networkAddresses,
    ]);

    // Detect when user is typing (debtBalance changed but debouncedDebtBalance hasn't yet)
    useEffect(() => {
        if (debtBalance !== debouncedDebtBalance && debtBalance > BigInt(0)) {
            setIsTyping(true);
        } else {
            setIsTyping(false);
        }
    }, [debtBalance, debouncedDebtBalance]);

    // Auto-fetch quote when debouncedDebtBalance changes
    useEffect(() => {
        if (!debouncedDebtBalance || debouncedDebtBalance === BigInt(0)) {
            clearQuote();
            return;
        }

        fetchQuote();
    }, [debouncedDebtBalance, direction, fetchQuote, clearQuote]);

    useEffect(() => {
        if (!autoRefreshEnabled || !swapQuote) {
            return;
        }

        const countdown = setInterval(() => {
            setNextRefreshIn(prev => {
                if (prev <= 1) {
                    fetchQuote();
                    return AUTO_REFRESH_SECONDS;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(countdown);
    }, [autoRefreshEnabled, swapQuote, fetchQuote]);

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
        isTyping, // New: indicates user is typing and waiting for debounce
    };
};
