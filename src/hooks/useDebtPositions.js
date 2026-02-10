import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import {
    getDebtTokenContract,
    getTokenDefsByDirection,
} from '../services/aaveContracts.js';
import { retryContractCall } from '../helpers/retryHelper.js';

export const useDebtPositions = ({ account, provider, networkRpcProvider, addLog, selectedNetwork }) => {
    const [direction, setDirection] = useState('WETH_TO_USDC');
    const [debtBalance, setDebtBalance] = useState(null);
    const [formattedDebt, setFormattedDebt] = useState('0');
    const [allowance, setAllowance] = useState(BigInt(0));
    const [wethDebt, setWethDebt] = useState(BigInt(0));
    const [usdcDebt, setUsdcDebt] = useState(BigInt(0));
    const [isDebtLoading, setIsDebtLoading] = useState(false);
    const abortControllerRef = useRef(null);
    const isMountedRef = useRef(true);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    // Get tokens dynamically based on network
    const { fromToken: nativeToken, toToken: stablecoin } = useMemo(() => {
        try {
            return getTokenDefsByDirection('WETH_TO_USDC', networkAddresses);
        } catch (error) {
            console.error('Error getting token definitions:', error);
            // Return empty objects to prevent crashes
            return {
                fromToken: { debtAddress: ethers.ZeroAddress },
                toToken: { debtAddress: ethers.ZeroAddress }
            };
        }
    }, [networkAddresses]);

    const wethDebtTokenAddress = nativeToken.debtAddress;
    const usdcDebtTokenAddress = stablecoin.debtAddress;
    const adapterAddress = networkAddresses.DEBT_SWAP_ADAPTER;
    const readProvider = useMemo(() => networkRpcProvider || provider, [networkRpcProvider, provider]);

    const detectPositions = useCallback(async () => {
        if (!account || !readProvider) {
            return;
        }
        try {
            const wethDebtContract = getDebtTokenContract(wethDebtTokenAddress, readProvider);
            const usdcDebtContract = getDebtTokenContract(usdcDebtTokenAddress, readProvider);
            const [wethBalance, usdcBalance] = await Promise.all([
                retryContractCall(
                    () => wethDebtContract.balanceOf(account),
                    `${nativeToken.symbol} Debt Token`,
                    { maxAttempts: 5, initialDelay: 800 }
                ),
                retryContractCall(
                    () => usdcDebtContract.balanceOf(account),
                    `${stablecoin.symbol} Debt Token`,
                    { maxAttempts: 5, initialDelay: 800 }
                ),
            ]);

            if (!isMountedRef.current) {
                return;
            }

            setWethDebt(wethBalance);
            setUsdcDebt(usdcBalance);

            if (wethBalance > BigInt(0)) {
                setDirection('WETH_TO_USDC');
                addLog?.(`Position detected: ${ethers.formatUnits(wethBalance, nativeToken.decimals)} ${nativeToken.symbol}`, 'success');
            } else if (usdcBalance > BigInt(0)) {
                setDirection('USDC_TO_WETH');
                addLog?.(`Position detected: ${ethers.formatUnits(usdcBalance, stablecoin.decimals)} ${stablecoin.symbol}`, 'success');
            }

            if (wethBalance > BigInt(0) && usdcBalance > BigInt(0)) {
                addLog?.(`Multiple positions found (${nativeToken.symbol} + ${stablecoin.symbol})`, 'info');
            }
        } catch (error) {
            console.error('[detectPositions]', error);
            // Silently fail - fetchDebtData will try again
        }
    }, [account, readProvider, addLog, wethDebtTokenAddress, usdcDebtTokenAddress, nativeToken, stablecoin]);

    const fetchDebtData = useCallback(async () => {
        if (!account || !readProvider) {
            return;
        }

        // Cancel any pending request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        // Create new abort controller for this request
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setIsDebtLoading(true);

        try {
            // Check if already aborted
            if (signal.aborted) {
                return;
            }

            const { fromToken, toToken } = getTokenDefsByDirection(direction, networkAddresses);

            addLog?.(`Fetching data: ${fromToken.symbol} -> ${toToken.symbol}...`);
            const currentDebtTokenAddr = fromToken.debtAddress;
            addLog?.(`Debt Token Address (${fromToken.symbol}): ${currentDebtTokenAddr}`, 'info');

            const debtContract = getDebtTokenContract(currentDebtTokenAddr, readProvider);
            const balance = await retryContractCall(
                () => debtContract.balanceOf(account),
                `${fromToken.symbol} Debt Token`,
                { maxAttempts: 5, initialDelay: 800 } // More retries, longer initial delay
            );

            // Check if aborted before setting state
            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setDebtBalance(balance);
            setFormattedDebt(ethers.formatUnits(balance, fromToken.decimals));

            const newDebtContract = getDebtTokenContract(toToken.debtAddress, readProvider);
            let currentAllowance = BigInt(0);
            try {
                currentAllowance = await retryContractCall(
                    () => newDebtContract.borrowAllowance(account, adapterAddress),
                    `${toToken.symbol} Debt Token (allowance)`,
                    { maxAttempts: 3, initialDelay: 500 } // Moderate retries for allowance
                );
            } catch (allowanceError) {
                // Silently handle - some debt tokens may not support borrowAllowance view function
                // User will see delegation prompt if needed
            }

            // Check if aborted before setting state
            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setAllowance(currentAllowance);

            addLog?.(`Debt found: ${ethers.formatUnits(balance, fromToken.decimals)} ${fromToken.symbol}`);
            if (currentAllowance === BigInt(0)) {
                addLog?.(`Info: Credit Delegation required for ${toToken.symbol}.`, 'warning');
            } else {
                addLog?.('Credit Delegation OK.', 'success');
            }
        } catch (error) {
            // Don't log if request was aborted
            if (error.name !== 'AbortError' && !signal.aborted) {
                console.error('[fetchDebtData]', error);
                addLog?.('Error fetching data: ' + error.message, 'error');
            }
        } finally {
            // Only reset loading if this is still the current request
            if (!signal.aborted && isMountedRef.current) {
                setIsDebtLoading(false);
            }
        }
    }, [account, readProvider, direction, addLog, networkAddresses, adapterAddress]);

    // Cleanup on unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    useEffect(() => {
        detectPositions();
    }, [detectPositions]);

    useEffect(() => {
        if (account && readProvider) {
            // Add delay to ensure provider is fully ready after reconnection
            const timer = setTimeout(() => {
                fetchDebtData();
            }, 800); // Increased from 300ms to 800ms
            return () => clearTimeout(timer);
        }
    }, [account, readProvider, fetchDebtData]);

    const needsApproval = useMemo(() =>
        Boolean(debtBalance && debtBalance > BigInt(0) && allowance < (debtBalance * BigInt(2))),
        [debtBalance, allowance]);

    return {
        direction,
        setDirection,
        debtBalance,
        formattedDebt,
        allowance,
        wethDebt,
        usdcDebt,
        fetchDebtData,
        needsApproval,
        isDebtLoading,
    };
};
