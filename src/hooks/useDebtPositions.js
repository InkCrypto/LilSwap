import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { ABIS } from '../constants/abis.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import {
    getDebtTokenContract,
} from '../services/aaveContracts.js';
import { retryContractCall } from '../helpers/retryHelper.js';

export const useDebtPositions = ({ account, provider, networkRpcProvider, fromToken, toToken, addLog, selectedNetwork }) => {
    const [debtBalance, setDebtBalance] = useState(null);
    const [formattedDebt, setFormattedDebt] = useState('0');
    const [allowance, setAllowance] = useState(BigInt(0));
    const [isDebtLoading, setIsDebtLoading] = useState(false);
    const abortControllerRef = useRef(null);
    const isMountedRef = useRef(true);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.DEBT_SWAP_ADAPTER) {
            return null;
        }
        try {
            return ethers.getAddress(networkAddresses.DEBT_SWAP_ADAPTER);
        } catch (error) {
            console.warn('[useDebtPositions] Invalid DEBT_SWAP_ADAPTER:', networkAddresses.DEBT_SWAP_ADAPTER, error);
            return null;
        }
    }, [networkAddresses?.DEBT_SWAP_ADAPTER]);
    const readProvider = useMemo(() => networkRpcProvider || provider, [networkRpcProvider, provider]);

    const fetchDebtData = useCallback(async () => {
        if (!account || !readProvider || !fromToken || !toToken) {
            console.log('[useDebtPositions] Missing requirements:', {
                hasAccount: !!account,
                hasProvider: !!readProvider,
                hasFromToken: !!fromToken,
                hasToToken: !!toToken
            });
            return;
        }

        // 🔥 FAST PATH: Use backend balance directly if available
        if (fromToken.amount) {
            const backendBalance = BigInt(fromToken.amount);
            console.log('[useDebtPositions] ⚡ Using BACKEND balance (faster):', {
                balance: backendBalance.toString(),
                formatted: ethers.formatUnits(backendBalance, fromToken.decimals),
                source: 'Backend API'
            });

            setDebtBalance(backendBalance);
            setFormattedDebt(fromToken.formattedAmount);
            addLog?.(`[Debt] ${fromToken.symbol} balance: ${fromToken.formattedAmount} (from server)`, 'success');

            if (!adapterAddress) {
                addLog?.(`Invalid DEBT_SWAP_ADAPTER for ${targetNetwork.label}. Check network config.`, 'error');
                setAllowance(BigInt(0));
                setIsDebtLoading(false);
                return;
            }

            // Still check allowance on-chain using backend debt token address
            try {
                // Use debt token address from backend, with fallback to on-chain
                let nextDebtTokenAddr = toToken.variableDebtTokenAddress;
                if (!nextDebtTokenAddr || nextDebtTokenAddr === ethers.ZeroAddress) {
                    console.log('[useDebtPositions] No debt token from backend, falling back to on-chain...');
                    const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, readProvider);
                    const toTokenAddress = toToken.underlyingAsset || toToken.address;
                    const toReserveData = await poolContract.getReserveData(toTokenAddress);
                    nextDebtTokenAddr = toReserveData.variableDebtTokenAddress;
                    if (!nextDebtTokenAddr || nextDebtTokenAddr === ethers.ZeroAddress) {
                        throw new Error(`No debt token address for ${toToken.symbol}`);
                    }
                }

                const newDebtContract = getDebtTokenContract(nextDebtTokenAddr, readProvider);
                const currentAllowance = await newDebtContract.borrowAllowance(account, adapterAddress);
                setAllowance(currentAllowance);

                if (currentAllowance > BigInt(0)) {
                    addLog?.(`[Allowance] Credit delegation OK for ${toToken.symbol}`, 'success');
                } else {
                    addLog?.(`[Allowance] Credit delegation required for ${toToken.symbol}`, 'warning');
                }
            } catch (error) {
                console.warn('[useDebtPositions] Allowance check failed:', error.message);
            }

            setIsDebtLoading(false);
            return;
        }
        console.log('[useDebtPositions] ReadProvider details:', {
            provider: readProvider.constructor.name,
            connection: readProvider._getConnection?.() || 'N/A'
        });

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

            // ⚠️ CRITICAL: Verify provider is on correct network FIRST
            const providerNetwork = await readProvider.getNetwork();
            const providerChainId = Number(providerNetwork.chainId);
            const expectedChainId = selectedNetwork?.chainId || DEFAULT_NETWORK.chainId;

            console.log('[useDebtPositions] 🔍 Network verification:', {
                providerChainId,
                expectedChainId,
                providerName: providerNetwork.name,
                match: providerChainId === expectedChainId
            });

            if (providerChainId !== expectedChainId) {
                const errorMsg = `❌ Provider on WRONG NETWORK! Expected ${expectedChainId} (Base), got ${providerChainId}`;
                console.error('[useDebtPositions]', errorMsg);
                addLog?.(errorMsg, 'error');
                throw new Error(errorMsg);
            }

            console.log('[useDebtPositions] ✅ Network OK! Provider is on chainId', providerChainId);

            console.log('[useDebtPositions] Fetching debt data:', {
                fromToken: fromToken.symbol,
                toToken: toToken.symbol,
                account,
                networkAddresses: networkAddresses.POOL,
                chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId,
                hasDebtTokenAddress: !!fromToken.debtTokenAddress
            });

            addLog?.(`[Debt] Checking ${fromToken.symbol} balance...`);

            // Get Pool contract to query reserve data
            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, readProvider);

            // ALWAYS fetch debtTokenAddress from the Pool contract
            // Use debt token address from backend, with fallback to on-chain
            let currentDebtTokenAddr = fromToken.debtTokenAddress;
            console.log('[useDebtPositions] Debt token from backend:', currentDebtTokenAddr);

            if (!currentDebtTokenAddr || currentDebtTokenAddr === ethers.ZeroAddress) {
                const fromTokenAddress = fromToken.underlyingAsset || fromToken.address;
                console.log('[useDebtPositions] No debt token from backend, falling back to on-chain...');
                const fromReserveData = await poolContract.getReserveData(fromTokenAddress);
                currentDebtTokenAddr = fromReserveData.variableDebtTokenAddress;
                console.log('[useDebtPositions] Fallback result:', currentDebtTokenAddr);
            }

            const debtContract = getDebtTokenContract(currentDebtTokenAddr, readProvider);

            const contractAddress = await debtContract.getAddress();
            const contractNetwork = await readProvider.getNetwork();

            console.log('[useDebtPositions] 📄 Debt contract details:', {
                contractAddress,
                providerChainId: Number(contractNetwork.chainId),
                providerName: contractNetwork.name,
                expectedChainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId
            });

            console.log('[useDebtPositions] Calling balanceOf for account:', account);
            const balance = await retryContractCall(
                () => debtContract.balanceOf(account),
                `${fromToken.symbol} Debt Token`,
                { maxAttempts: 5, initialDelay: 800 }
            );

            // Check if aborted before setting state
            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setDebtBalance(balance);
            setFormattedDebt(ethers.formatUnits(balance, fromToken.decimals));

            console.log('[useDebtPositions] ✅ Debt balance fetched:', {
                debtTokenAddress: currentDebtTokenAddr,
                account,
                balance: balance.toString(),
                formatted: ethers.formatUnits(balance, fromToken.decimals),
                decimals: fromToken.decimals,
                backendAmount: fromToken.amount,
                backendFormatted: fromToken.formattedAmount
            });

            const balanceDiff = Math.abs(Number(balance) - Number(fromToken.amount || 0));
            const tolerance = Number(fromToken.amount || 0) * 0.001; // 0.1% tolerance for interest accrual

            if (balanceDiff > tolerance && fromToken.amount) {
                console.warn('[useDebtPositions] ⚠️ On-chain differs from backend (interest accrual is normal):', {
                    onChain: ethers.formatUnits(balance, fromToken.decimals),
                    backend: fromToken.formattedAmount,
                    diffPercent: ((balanceDiff / Number(fromToken.amount)) * 100).toFixed(4) + '%'
                });

                if (balance === BigInt(0) && Number(fromToken.amount) > 1000000) { // More than 1 USDC raw
                    console.error('[useDebtPositions] 🔴 CRITICAL: On-chain is 0 but backend shows significant debt!');
                    console.error('[useDebtPositions] This is likely a provider/RPC issue.');
                    console.error('[useDebtPositions] Using BACKEND value as it\'s more reliable.');
                    addLog?.('⚠️ Using server balance due to RPC inconsistency', 'warning');
                }
            }

            addLog?.(`[Debt] ${fromToken.symbol} balance: ${ethers.formatUnits(balance, fromToken.decimals)}`, balance > BigInt(0) ? 'success' : 'warning');

            if (!adapterAddress) {
                addLog?.(`Invalid DEBT_SWAP_ADAPTER for ${targetNetwork.label}. Check network config.`, 'error');
                setAllowance(BigInt(0));
                setIsDebtLoading(false);
                return;
            }

            // Get the debt token address of the target token for allowance check
            addLog?.(`[Allowance] Checking credit delegation for ${toToken.symbol}...`);
            // Use debt token address from backend, with fallback to on-chain
            let nextDebtTokenAddr = toToken.variableDebtTokenAddress;
            if (!nextDebtTokenAddr || nextDebtTokenAddr === ethers.ZeroAddress) {
                console.log('[useDebtPositions] No debt token from backend, falling back to on-chain...');
                const toTokenAddress = toToken.underlyingAsset || toToken.address;
                const toReserveData = await poolContract.getReserveData(toTokenAddress);
                nextDebtTokenAddr = toReserveData.variableDebtTokenAddress;
                console.log('[useDebtPositions] Fallback result:', nextDebtTokenAddr);
            }

            const newDebtContract = getDebtTokenContract(nextDebtTokenAddr, readProvider);
            let currentAllowance = BigInt(0);
            try {
                currentAllowance = await retryContractCall(
                    () => newDebtContract.borrowAllowance(account, adapterAddress),
                    `${toToken.symbol} Debt Token (allowance)`,
                    { maxAttempts: 3, initialDelay: 500 }
                );

                if (currentAllowance > BigInt(0)) {
                    addLog?.(`[Allowance] Credit delegation OK for ${toToken.symbol}`, 'success');
                } else {
                    addLog?.(`[Allowance] Credit delegation required for ${toToken.symbol}`, 'warning');
                }
            } catch (allowanceError) {
                addLog?.(`[Allowance] Could not check allowance for ${toToken.symbol}`, 'warning');
            }

            // Check if aborted before setting state
            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setAllowance(currentAllowance);

        } catch (error) {
            if (error.name !== 'AbortError' && !signal.aborted) {
                console.error('[fetchDebtData]', error);

                // Check if it's a rate limit error
                const isRateLimitError =
                    error.message?.includes('429') ||
                    error.message?.includes('Too Many Requests') ||
                    error.message?.includes('rate limit') ||
                    error.message?.includes('Failed to fetch');

                if (isRateLimitError) {
                    addLog?.('⚠️ RPC Rate Limit! Please refresh the page to use a different RPC endpoint.', 'error');
                    console.error('[fetchDebtData] Rate limit detected. Current RPC may be overloaded.');
                    console.error('[fetchDebtData] Try refreshing the page to reconnect with a different RPC.');
                } else {
                    addLog?.('Error fetching data: ' + error.message, 'error');
                }
            }
        } finally {
            if (!signal.aborted && isMountedRef.current) {
                setIsDebtLoading(false);
            }
        }
    }, [account, readProvider, fromToken?.underlyingAsset, toToken?.underlyingAsset, addLog, networkAddresses, adapterAddress, targetNetwork.label]);

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
        if (account && readProvider && fromToken && toToken) {
            const timer = setTimeout(() => {
                fetchDebtData();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [account, readProvider, fetchDebtData]);

    const needsApproval = useMemo(() =>
        Boolean(debtBalance && debtBalance > BigInt(0) && allowance < (debtBalance * BigInt(2))),
        [debtBalance, allowance]);

    return {
        debtBalance,
        formattedDebt,
        allowance,
        fetchDebtData,
        needsApproval,
        isDebtLoading,
    };
};
