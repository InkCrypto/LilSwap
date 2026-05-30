import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, getAddress, parseAbi } from 'viem';
import type { PublicClient } from 'viem';
import { ABIS } from '../constants/abis';

const CACHE_TTL_MS = 60_000;
const NATIVE_BALANCE_KEY_PREFIX = 'native:';

interface NativeInfo {
    native: string;
    wrapped: string;
}

interface WalletMarketBalancesArgs {
    enabled: boolean;
    walletAddress: string | null;
    chainId: number;
    marketKey: string | null;
    marketAssets: any[];
    publicClient: PublicClient | null | undefined;
    nativeInfo: NativeInfo;
    gatewayAddress?: string | null;
}

export interface WalletMarketBalanceToken {
    token: any;
    balance: bigint;
    formatted: string;
    usdValue: number;
    balanceKey: string;
    isNative: boolean;
}

interface CacheEntry {
    timestamp: number;
    tokens: WalletMarketBalanceToken[];
}

const balanceCache = new Map<string, CacheEntry>();
const activeRequests = new Map<string, Promise<WalletMarketBalanceToken[]>>();

const getTokenAddress = (token: any): string | null => {
    const raw = token?.underlyingAsset || token?.address;

    if (!raw || typeof raw !== 'string' || !raw.startsWith('0x')) {
        return null;
    }

    try {
        return getAddress(raw);
    } catch {
        return null;
    }
};

const parsePrice = (token: any): number => {
    const parsed = parseFloat(token?.priceInUSD || '0');

    return Number.isFinite(parsed) ? parsed : 0;
};

export const clearWalletMarketBalanceCache = (
    walletAddress: string | null,
    chainId: number,
    marketKey: string | null,
) => {
    if (!walletAddress || !marketKey) {
        return;
    }

    balanceCache.delete(
        `${walletAddress.toLowerCase()}-${chainId}-${marketKey}`,
    );
};

export const useWalletMarketBalances = ({
    enabled,
    walletAddress,
    chainId,
    marketKey,
    marketAssets,
    publicClient,
    nativeInfo,
    gatewayAddress,
}: WalletMarketBalancesArgs) => {
    const cacheKey = useMemo(() => {
        if (!walletAddress || !marketKey) {
            return '';
        }

        return `${walletAddress.toLowerCase()}-${chainId}-${marketKey}`;
    }, [chainId, marketKey, walletAddress]);

    const supplyableTokens = useMemo(() => {
        return (marketAssets || []).filter(
            (token) =>
                token?.isActive &&
                !token?.isFrozen &&
                !token?.isPaused &&
                getTokenAddress(token),
        );
    }, [marketAssets]);

    const [tokens, setTokens] = useState<WalletMarketBalanceToken[]>(() => {
        return cacheKey ? balanceCache.get(cacheKey)?.tokens || [] : [];
    });
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number | null>(() => {
        return cacheKey ? balanceCache.get(cacheKey)?.timestamp || null : null;
    });
    const [hasLoaded, setHasLoaded] = useState(() => {
        return cacheKey ? balanceCache.has(cacheKey) : false;
    });
    const latestCacheKeyRef = useRef(cacheKey);

    useEffect(() => {
        latestCacheKeyRef.current = cacheKey;

        const cached = cacheKey ? balanceCache.get(cacheKey) : null;

        setTokens(cached?.tokens || []);
        setLastUpdated(cached?.timestamp || null);
        setHasLoaded(Boolean(cached));
        setIsLoading(enabled && Boolean(cacheKey) && !cached);
    }, [cacheKey, enabled]);

    const refresh = useCallback(
        async (force = false) => {
            if (!enabled || !cacheKey || !walletAddress || !publicClient) {
                setTokens([]);
                setLastUpdated(null);
                setHasLoaded(false);
                setIsLoading(false);

                return [];
            }

            const clientChainId = Number(publicClient.chain?.id || 0);

            if (clientChainId && clientChainId !== chainId) {
                return balanceCache.get(cacheKey)?.tokens || [];
            }

            const cached = balanceCache.get(cacheKey);
            const now = Date.now();

            if (cached && !force && now - cached.timestamp < CACHE_TTL_MS) {
                setTokens(cached.tokens);
                setLastUpdated(cached.timestamp);
                setHasLoaded(true);

                return cached.tokens;
            }

            if (cached) {
                setTokens(cached.tokens);
                setLastUpdated(cached.timestamp);
                setHasLoaded(true);
            }

            const existingRequest = activeRequests.get(cacheKey);

            if (existingRequest && !force) {
                const result = await existingRequest;

                if (latestCacheKeyRef.current === cacheKey) {
                    setTokens(result);
                    setLastUpdated(
                        balanceCache.get(cacheKey)?.timestamp || Date.now(),
                    );
                    setHasLoaded(true);
                }

                return result;
            }

            setIsLoading(true);

            const request = (async () => {
                const account = getAddress(walletAddress);
                const contracts = supplyableTokens.map((token) => ({
                    address: getAddress(getTokenAddress(token)!),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'balanceOf',
                    args: [account],
                }));

                const [erc20Results, nativeBalance] = await Promise.all([
                    contracts.length > 0
                        ? publicClient.multicall({
                              contracts: contracts as any,
                              allowFailure: true,
                          })
                        : Promise.resolve([]),
                    gatewayAddress
                        ? publicClient.getBalance({ address: account })
                        : Promise.resolve(0n),
                ]);

                const nextTokens: WalletMarketBalanceToken[] = [];

                supplyableTokens.forEach((token, index) => {
                    const result = erc20Results[index];
                    const balance =
                        result?.status === 'success'
                            ? (result.result as bigint)
                            : 0n;

                    if (balance <= 0n) {
                        return;
                    }

                    const decimals = token.decimals || 18;
                    const formatted = formatUnits(balance, decimals);
                    const usdValue = parseFloat(formatted) * parsePrice(token);

                    nextTokens.push({
                        token,
                        balance,
                        formatted,
                        usdValue: Number.isFinite(usdValue) ? usdValue : 0,
                        balanceKey: getTokenAddress(token)!,
                        isNative: false,
                    });
                });

                const wrappedToken = supplyableTokens.find(
                    (token) =>
                        String(token.symbol || '').toUpperCase() ===
                        nativeInfo.wrapped.toUpperCase(),
                );

                if (gatewayAddress && wrappedToken && nativeBalance > 0n) {
                    const decimals = wrappedToken.decimals || 18;
                    const formatted = formatUnits(nativeBalance, decimals);
                    const usdValue =
                        parseFloat(formatted) * parsePrice(wrappedToken);

                    nextTokens.push({
                        token: {
                            ...wrappedToken,
                            symbol: nativeInfo.native,
                            name: nativeInfo.native,
                            address: `${NATIVE_BALANCE_KEY_PREFIX}${chainId}`,
                            underlyingAsset: undefined,
                            wrappedUnderlyingAsset:
                                getTokenAddress(wrappedToken),
                            isNativeSupplyAsset: true,
                        },
                        balance: nativeBalance,
                        formatted,
                        usdValue: Number.isFinite(usdValue) ? usdValue : 0,
                        balanceKey: `${NATIVE_BALANCE_KEY_PREFIX}${chainId}`,
                        isNative: true,
                    });
                }

                nextTokens.sort((a, b) => {
                    if (a.usdValue !== b.usdValue) {
                        return b.usdValue - a.usdValue;
                    }

                    return String(a.token.symbol || '').localeCompare(
                        String(b.token.symbol || ''),
                    );
                });

                balanceCache.set(cacheKey, {
                    timestamp: Date.now(),
                    tokens: nextTokens,
                });

                return nextTokens;
            })();

            activeRequests.set(cacheKey, request);

            try {
                const result = await request;

                if (latestCacheKeyRef.current === cacheKey) {
                    setTokens(result);
                    setLastUpdated(
                        balanceCache.get(cacheKey)?.timestamp || Date.now(),
                    );
                    setHasLoaded(true);
                }

                return result;
            } finally {
                activeRequests.delete(cacheKey);

                if (latestCacheKeyRef.current === cacheKey) {
                    setIsLoading(false);
                }
            }
        },
        [
            cacheKey,
            chainId,
            enabled,
            gatewayAddress,
            nativeInfo.native,
            nativeInfo.wrapped,
            publicClient,
            supplyableTokens,
            walletAddress,
        ],
    );

    useEffect(() => {
        if (!enabled) {
            return;
        }

        void refresh(false);
    }, [enabled, refresh]);

    return {
        tokens,
        isLoading,
        hasLoaded,
        lastUpdated,
        refresh,
    };
};
