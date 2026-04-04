import { useState, useCallback, useEffect, useMemo } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { getAddress, parseAbi, zeroAddress, Hex, zeroHash } from 'viem';
import { ABIS } from '../constants/abis';
import logger from '../utils/logger';

// Global signature cache (per session)
// Key: `${tokenAddress}-${spenderAddress}-${account}`
const signatureCache = new Map<string, any>();

// Global concurrency guard for on-chain fetches to prevent redundant simultaneous calls
const activeAllowanceRequests = new Map<string, Promise<{ allowance: bigint; nonce: bigint; name: string }>>();

interface UseApprovalStateProps {
    account: string | null;
    tokenAddress: string | null;
    spenderAddress: string | null;
    amountRequired: bigint;
    isDebt?: boolean;
    chainId: number;
}

export const useApprovalState = ({
    account,
    tokenAddress,
    spenderAddress,
    amountRequired,
    isDebt = false,
    chainId
}: UseApprovalStateProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [onChainAllowance, setOnChainAllowance] = useState<bigint>(0n);
    const [nonce, setNonce] = useState<bigint>(0n);
    const [tokenName, setTokenName] = useState<string>('');
    const [isFetching, setIsFetching] = useState(false);

    const cacheKey = useMemo(() => {
        if (!tokenAddress || !spenderAddress || !account) return null;
        return `${chainId}-${tokenAddress.toLowerCase()}-${spenderAddress.toLowerCase()}-${account.toLowerCase()}`;
    }, [chainId, tokenAddress, spenderAddress, account]);

    const cachedSignature = useMemo(() => {
        if (!cacheKey) return null;
        return signatureCache.get(cacheKey) || null;
    }, [cacheKey]);

    const lastFetchedKey = useEffect(() => {
        // This is a dummy to track mount state or similar if needed
    }, []);

    const fetchAllowance = useCallback(async () => {
        if (!account || !tokenAddress || !spenderAddress || !publicClient) return;

        const key = `${chainId}-${tokenAddress.toLowerCase()}-${spenderAddress.toLowerCase()}-${account.toLowerCase()}-${isDebt ? 'debt' : 'erc20'}`;

        // Check if there's already an active request for this key
        if (activeAllowanceRequests.has(key)) {
            try {
                const result = await activeAllowanceRequests.get(key);
                if (result) {
                    setOnChainAllowance(result.allowance);
                    setNonce(result.nonce);
                    setTokenName(result.name);
                    return;
                }
            } catch (err) {
                // Ignore and proceed with new fetch if prev failed
            }
        }

        try {
            setIsFetching(true);

            const fetchPromise = (async () => {
                const abi = isDebt ? ABIS.DEBT_TOKEN : ABIS.ERC20;
                const calls = [
                    {
                        address: getAddress(tokenAddress),
                        abi: parseAbi(abi),
                        functionName: isDebt ? 'borrowAllowance' : 'allowance',
                        args: [getAddress(account), getAddress(spenderAddress)],
                    },
                    {
                        address: getAddress(tokenAddress),
                        abi: parseAbi(abi),
                        functionName: 'nonces',
                        args: [getAddress(account)],
                    },
                    {
                        address: getAddress(tokenAddress),
                        abi: parseAbi(abi),
                        functionName: 'name',
                    }
                ];

                const results = await publicClient.multicall({
                    contracts: calls as any,
                    allowFailure: true,
                });

                if (!results) return { allowance: 0n, nonce: 0n, name: '' };

                const allowanceVal = (results[0]?.status === 'success' ? results[0].result : 0n) as bigint;
                const nonceVal = (results[1]?.status === 'success' ? results[1].result : 0n) as bigint;
                const nameVal = (results[2]?.status === 'success' ? results[2].result : '') as string;

                return { allowance: allowanceVal, nonce: nonceVal, name: nameVal };
            })();

            activeAllowanceRequests.set(key, fetchPromise);
            const { allowance, nonce, name } = await fetchPromise;

            // Only update state if the key hasn't changed while we were fetching
            const currentKey = `${chainId}-${tokenAddress.toLowerCase()}-${spenderAddress.toLowerCase()}-${account.toLowerCase()}-${isDebt ? 'debt' : 'erc20'}`;
            if (currentKey !== key) return;

            logger.debug(`[useApprovalState] Fetched ${isDebt ? 'Borrow' : 'ERC20'} Data | Allowance: ${allowance.toString()} | Nonce: ${nonce.toString()} | Name: ${name} | Token: ${tokenAddress}`);

            setOnChainAllowance(allowance);
            setNonce(nonce);
            setTokenName(name);
        } catch (error) {
            logger.warn('[useApprovalState] Error fetching permission data:', error);
        } finally {
            activeAllowanceRequests.delete(key);
            setIsFetching(false);
        }
    }, [account, tokenAddress, spenderAddress, publicClient, isDebt, chainId]);

    useEffect(() => {
        let isMounted = true;
        fetchAllowance();
        return () => { isMounted = false; };
    }, [fetchAllowance, chainId]);

    const isApproved = useMemo(() => {
        // 1. Check on-chain - only once we have a definitive answer and it's non-zero
        if (!isFetching && onChainAllowance > 0n && onChainAllowance >= amountRequired) return true;

        // 2. Check cached signature
        if (
            cachedSignature &&
            cachedSignature.deadline > Math.floor(Date.now() / 1000) &&
            BigInt(cachedSignature.value || 0) >= amountRequired
        ) {
            return true;
        }

        return false;
    }, [onChainAllowance, amountRequired, cachedSignature, isFetching]);

    const saveSignature = useCallback((signatureData: any) => {
        if (!cacheKey) return;
        signatureCache.set(cacheKey, signatureData);
        // Force re-render by updating dummy state or just let components re-read
    }, [cacheKey]);

    return {
        onChainAllowance,
        nonce,
        tokenName,
        isApproved,
        isFetching,
        cachedSignature,
        refreshAllowance: fetchAllowance,
        saveSignature
    };
};
