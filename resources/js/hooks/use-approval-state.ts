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
        return `${chainId}-${tokenAddress.toLowerCase()}-${spenderAddress.toLowerCase()}-${account.toLowerCase()}-${isDebt ? 'debt' : 'erc20'}`;
    }, [chainId, tokenAddress, spenderAddress, account, isDebt]);

    const cachedSignature = useMemo(() => {
        if (!cacheKey) return null;
        const sig = signatureCache.get(cacheKey) || null;
        if (sig) {
            logger.debug(`[useApprovalState] Signature CACHE HIT for ${tokenAddress} | Key: ${cacheKey}`);
        }
        return sig;
    }, [cacheKey]);

    const fetchAllowance = useCallback(async () => {
        if (!account || !tokenAddress || !spenderAddress || !publicClient) return;

        const key = cacheKey;
        if (!key) return;

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

            activeAllowanceRequests.set(key!, fetchPromise);
            const { allowance, nonce, name } = await fetchPromise;

            // Only update state if the key hasn't changed while we were fetching
            const currentKey = cacheKey;
            if (currentKey !== key) return;

            logger.debug(`[useApprovalState] Fetched ${isDebt ? 'Borrow' : 'ERC20'} Data | Allowance: ${allowance.toString()} | Spender: ${spenderAddress} | Nonce: ${nonce.toString()} | Name: ${name} | Token: ${tokenAddress}`);

            setOnChainAllowance(allowance);
            setNonce(nonce);
            setTokenName(name);
        } catch (error) {
            logger.warn('[useApprovalState] Error fetching permission data:', error);
        } finally {
            activeAllowanceRequests.delete(key!);
            setIsFetching(false);
        }
    }, [account, tokenAddress, spenderAddress, publicClient, isDebt, chainId, cacheKey]);

    useEffect(() => {
        fetchAllowance();
    }, [fetchAllowance, chainId]);

    const [cacheVersion, setCacheVersion] = useState(0);

    const isApproved = useMemo(() => {
        // Use cacheVersion to force re-memoization when a signature is saved
        const dummy = cacheVersion;
        
        // 1. Signature Check First (as it's often more current than on-chain fetch during bursts)
        if (
            cachedSignature &&
            cachedSignature.deadline > Math.floor(Date.now() / 1000) &&
            BigInt(cachedSignature.value || 0) >= amountRequired
        ) {
            return true;
        }

        // 2. Check on-chain - only once we have a definitive answer and it's non-zero
        if (!isFetching && onChainAllowance > 0n && onChainAllowance >= amountRequired) return true;

        return false;
    }, [onChainAllowance, amountRequired, cachedSignature, isFetching, cacheVersion]);

    const saveSignature = useCallback((signatureData: any) => {
        if (!cacheKey) return;
        logger.debug(`[useApprovalState] SAVING signature to cache for ${tokenAddress} | Key: ${cacheKey}`);
        signatureCache.set(cacheKey, signatureData);
        setCacheVersion(v => v + 1); // Trigger re-render across any hook instance
    }, [cacheKey, tokenAddress]);

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
