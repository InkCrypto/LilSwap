import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses';
import { ABIS } from '../constants/abis';
import { DEFAULT_NETWORK } from '../constants/networks';
import { getDebtTokenContract } from '../services/aave-contracts';
import { retryContractCall } from '../helpers/retry-helper';
import logger from '../utils/logger';

interface UseDebtPositionsProps {
    account: string | null;
    provider: any;
    networkRpcProvider: any;
    fromToken: any;
    toToken: any;
    addLog?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    selectedNetwork: any;
}

export const useDebtPositions = ({
    account,
    provider,
    networkRpcProvider,
    fromToken,
    toToken,
    addLog,
    selectedNetwork
}: UseDebtPositionsProps) => {
    const [debtBalance, setDebtBalance] = useState<bigint | null>(null);
    const [formattedDebt, setFormattedDebt] = useState<string | null>(null);
    const [allowance, setAllowance] = useState<bigint>(BigInt(0));
    const [isDebtLoading, setIsDebtLoading] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isMountedRef = useRef(true);

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    const formatUnitsFixed = (balance: bigint, decimals: number): string => {
        const s = ethers.formatUnits(balance, decimals);
        if (!/[eE]/.test(s)) return s;
        
        const b = balance.toString();
        if (decimals === 0) return b;
        const intPart = b.length > decimals ? b.slice(0, -decimals) : '0';
        let frac = b.length > decimals ? b.slice(-decimals) : b.padStart(decimals, '0');
        frac = frac.replace(/0+$/, '');
        return frac ? `${intPart}.${frac}` : intPart;
    };

    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.DEBT_SWAP_ADAPTER) return null;
        try {
            return ethers.getAddress(networkAddresses.DEBT_SWAP_ADAPTER);
        } catch (error) {
            logger.warn('[useDebtPositions] Invalid DEBT_SWAP_ADAPTER', { adapter: networkAddresses.DEBT_SWAP_ADAPTER, error });
            return null;
        }
    }, [networkAddresses?.DEBT_SWAP_ADAPTER]);

    const readProvider = useMemo(() => networkRpcProvider || provider, [networkRpcProvider, provider]);

    const fetchDebtData = useCallback(async () => {
        if (!account || !readProvider || !fromToken || !toToken) {
            return;
        }

        // Fast path: Use backend balance if available
        if (fromToken.amount) {
            const backendBalance = BigInt(fromToken.amount);
            setDebtBalance(backendBalance);
            const human = formatUnitsFixed(backendBalance, fromToken.decimals);
            setFormattedDebt(human);
            addLog?.(`[Debt] ${fromToken.symbol} balance: ${human} (from server)`, 'success');

            if (!adapterAddress) {
                addLog?.(`Invalid DEBT_SWAP_ADAPTER for ${targetNetwork.label}. Check network config.`, 'error');
                setAllowance(BigInt(0));
                setIsDebtLoading(false);
                return;
            }

            try {
                let nextDebtTokenAddr = toToken.variableDebtTokenAddress;
                if (!nextDebtTokenAddr || nextDebtTokenAddr === ethers.ZeroAddress) {
                    const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, readProvider);
                    const toTokenAddress = toToken.underlyingAsset || toToken.address;
                    const toReserveData = await poolContract.getReserveData(toTokenAddress);
                    nextDebtTokenAddr = toReserveData.variableDebtTokenAddress;
                }

                const newDebtContract = getDebtTokenContract(nextDebtTokenAddr, readProvider);
                const currentAllowance = await newDebtContract.borrowAllowance(account, adapterAddress);
                setAllowance(currentAllowance);
            } catch (error: any) {
                logger.warn('[useDebtPositions] Allowance check failed:', error.message);
            }

            setIsDebtLoading(false);
            return;
        }

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setIsDebtLoading(true);

        try {
            if (signal.aborted) return;

            const providerNetwork = await readProvider.getNetwork();
            const providerChainId = Number(providerNetwork.chainId);
            const expectedChainId = selectedNetwork?.chainId || DEFAULT_NETWORK.chainId;

            if (providerChainId !== expectedChainId) {
                const errorMsg = `❌ Provider WRONG NETWORK! Expected ${expectedChainId}, got ${providerChainId}`;
                addLog?.(errorMsg, 'error');
                throw new Error(errorMsg);
            }

            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, readProvider);
            let currentDebtTokenAddr = fromToken.debtTokenAddress;

            if (!currentDebtTokenAddr || currentDebtTokenAddr === ethers.ZeroAddress) {
                const fromTokenAddress = fromToken.underlyingAsset || fromToken.address;
                const fromReserveData = await poolContract.getReserveData(fromTokenAddress);
                currentDebtTokenAddr = fromReserveData.variableDebtTokenAddress;
            }

            const debtContract = getDebtTokenContract(currentDebtTokenAddr, readProvider);
            const balance = await retryContractCall(
                () => debtContract.balanceOf(account),
                `${fromToken.symbol} Debt Token`,
                { maxAttempts: 5, initialDelay: 800 }
            );

            if (signal.aborted || !isMountedRef.current) return;

            setDebtBalance(balance);
            setFormattedDebt(formatUnitsFixed(balance, fromToken.decimals));
            addLog?.(`[Debt] ${fromToken.symbol} balance: ${ethers.formatUnits(balance, fromToken.decimals)}`, balance > BigInt(0) ? 'success' : 'warning');

            if (!adapterAddress) {
                setAllowance(BigInt(0));
                setIsDebtLoading(false);
                return;
            }

            let nextDebtTokenAddr = toToken.variableDebtTokenAddress;
            if (!nextDebtTokenAddr || nextDebtTokenAddr === ethers.ZeroAddress) {
                const toTokenAddress = toToken.underlyingAsset || toToken.address;
                const toReserveData = await poolContract.getReserveData(toTokenAddress);
                nextDebtTokenAddr = toReserveData.variableDebtTokenAddress;
            }

            const newDebtContract = getDebtTokenContract(nextDebtTokenAddr, readProvider);
            const currentAllowance = await retryContractCall(
                () => newDebtContract.borrowAllowance(account, adapterAddress),
                `${toToken.symbol} Debt Token (allowance)`,
                { maxAttempts: 3, initialDelay: 500 }
            );

            if (signal.aborted || !isMountedRef.current) return;
            setAllowance(currentAllowance);

        } catch (error: any) {
            if (error.name !== 'AbortError' && !signal.aborted) {
                logger.error('[fetchDebtData]', error);
                const isRateLimit = error.message?.includes('429') || error.message?.includes('rate limit');
                if (isRateLimit) {
                    addLog?.('⚠️ RPC Rate Limit! Please refresh.', 'error');
                } else {
                    addLog?.('Error: ' + error.message, 'error');
                }
            }
        } finally {
            if (!signal.aborted && isMountedRef.current) {
                setIsDebtLoading(false);
            }
        }
    }, [account, readProvider, fromToken, toToken, addLog, networkAddresses, adapterAddress, targetNetwork.label, selectedNetwork?.chainId]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, []);

    useEffect(() => {
        setDebtBalance(null);
        setFormattedDebt(null);
        setAllowance(BigInt(0));
    }, [fromToken?.symbol, fromToken?.address]);

    useEffect(() => {
        if (account && readProvider && fromToken && toToken) {
            const timer = setTimeout(() => fetchDebtData(), 500);
            return () => clearTimeout(timer);
        }
    }, [account, readProvider, fromToken?.symbol, fromToken?.address, toToken?.symbol, toToken?.address, fetchDebtData]);

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
