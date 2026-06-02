import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    RefreshCw,
    ArrowRightLeft,
} from 'lucide-react';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { getAddress, parseAbi, formatUnits, parseUnits } from 'viem';
import { useWeb3 } from '../contexts/web3-context';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { ABIS } from '../constants/abis';
import { getMarketByKey } from '../constants/networks';
import { getAaveSwapTokensByChainId } from '../constants/aave-token-list';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Checkbox } from './ui/checkbox';
import { InfoTooltip } from './info-tooltip';
import { CompactAmountInput } from './compact-amount-input';
import { formatHF, formatCompactNumber, formatCompactToken, formatUSD, formatAPY } from '../utils/formatters';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { getTokenLogo } from '../utils/get-token-logo';
import { getWithdrawSwapQuote, buildWithdrawSwapTx } from '../services/api';

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialAsset: any | null;
    marketKey: string | null;
    chainId: number;
    marketAssets: any[];
    supplies?: any[];
    walletAddress: string;
    summary: any;
    onSuccess?: () => void;
}

const MIN_HEALTH_FACTOR_AFTER_WITHDRAW = 1.01;
const RISK_HEALTH_FACTOR_THRESHOLD = 1.5;
const CUSTOM_TARGET_TOKENS_STORAGE_PREFIX = 'lilswap:withdraw-swap-custom-target-tokens';
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TARGET_BALANCE_MULTICALL_CHUNK_SIZE = 80;
const MAX_UINT256 = 2n ** 256n - 1n;
const APPROVAL_GAS_LIMIT = 150_000n;
const WITHDRAW_GAS_LIMIT = 500_000n;
const WITHDRAW_SWAP_GAS_LIMIT_FALLBACK = 2_500_000n;
const WITHDRAW_SWAP_GAS_LIMIT_MAX = 8_000_000n;

const getAssetAddress = (asset: any) => (asset?.underlyingAsset || asset?.address || '').toLowerCase();

const parseGasLimit = (value: unknown): bigint | null => {
    if (value == null || value === '') {
        return null;
    }

    try {
        return BigInt(value as string | number | bigint);
    } catch {
        return null;
    }
};

const resolveWithdrawSwapGasLimit = (txData: any, priceRoute: any): bigint => {
    const explicitGas = parseGasLimit(txData?.gas);

    if (explicitGas && explicitGas > 0n) {
        return explicitGas;
    }

    const routeGas = parseGasLimit(priceRoute?.gasCost);

    if (!routeGas || routeGas <= 0n) {
        return WITHDRAW_SWAP_GAS_LIMIT_FALLBACK;
    }

    const buffered = routeGas * 4n + 500_000n;

    if (buffered < WITHDRAW_SWAP_GAS_LIMIT_FALLBACK) {
        return WITHDRAW_SWAP_GAS_LIMIT_FALLBACK;
    }

    if (buffered > WITHDRAW_SWAP_GAS_LIMIT_MAX) {
        return WITHDRAW_SWAP_GAS_LIMIT_MAX;
    }

    return buffered;
};

const getCustomTargetTokenStorageKey = (chainId: number) => `${CUSTOM_TARGET_TOKENS_STORAGE_PREFIX}:${chainId}`;

const getProtocolTokenAddresses = (assets: any[] = []) => {
    const addresses = new Set<string>();

    assets.forEach((asset) => {
        [
            asset?.aTokenAddress,
            asset?.stableDebtTokenAddress,
            asset?.variableDebtTokenAddress,
            asset?.debtTokenAddress,
        ].forEach((address) => {
            if (typeof address === 'string' && address && !/^0x0{40}$/i.test(address)) {
                addresses.add(address.toLowerCase());
            }
        });
    });

    return addresses;
};

const isProtocolTokenCandidate = (token: any) => {
    const symbol = String(token?.symbol || '');
    const name = String(token?.name || '');

    return (
        /^am[A-Z0-9]/.test(symbol) ||
        /^a[A-Z0-9]/.test(symbol) ||
        /^stata[A-Z0-9]/i.test(symbol) ||
        /^staticA/i.test(symbol) ||
        /^stk/i.test(symbol) ||
        /^variableDebt/i.test(symbol) ||
        /^stableDebt/i.test(symbol) ||
        /^vd/i.test(symbol) ||
        /^sd/i.test(symbol) ||
        /\bAave v\d?\b/i.test(name) ||
        /\bAave Market/i.test(name) ||
        /\bStata\b/i.test(name) ||
        /\bStaticAToken\b/i.test(name) ||
        /\bStatic AToken\b/i.test(name) ||
        /\baToken\b/i.test(name) ||
        /\bdebt token\b/i.test(name) ||
        /\bvariable debt\b/i.test(name) ||
        /\bstable debt\b/i.test(name)
    );
};

const formatAddressShort = (address?: string | null) => {
    if (!address) return '';

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const chunkArray = <T,>(items: T[], size: number) => {
    const chunks: T[][] = [];

    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }

    return chunks;
};

const getNativePriceUSD = (assets: any[] = [], wrappedSymbol: string) => {
    const wrappedAsset = assets.find((asset) => {
        const symbol = String(asset?.symbol || '').toUpperCase();

        return symbol === wrappedSymbol.toUpperCase() || symbol === 'WETH';
    });

    return parseFiniteNumber(wrappedAsset?.priceInUSD);
};

const parseFiniteNumber = (value: any, fallback = 0) => {
    const parsed = typeof value === 'number' ? value : parseFloat(value || '');

    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeRatio = (value: any) => {
    const parsed = parseFiniteNumber(value);

    if (parsed > 100) {
        return parsed / 10000;
    }

    if (parsed > 1) {
        return parsed / 100;
    }

    return parsed;
};

const getHealthFactorColor = (hf: number) => {
    if (hf === -1 || hf >= 3) return 'text-emerald-500';
    if (hf >= 1.1) return 'text-orange-500';
    return 'text-red-500';
};

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
    isOpen,
    onClose,
    initialAsset: providedInitialAsset,
    marketKey,
    chainId,
    marketAssets,
    supplies,
    walletAddress,
    summary,
    onSuccess,
}) => {
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } = useWeb3();
    const { addTransaction } = useTransactionTracker();

    const enrichSupplyAsset = useCallback((asset: any | null) => {
        if (!asset) return null;

        const assetAddress = getAssetAddress(asset);
        const marketAsset = (marketAssets || []).find((candidate) => getAssetAddress(candidate) === assetAddress);

        return {
            ...(marketAsset || {}),
            ...asset,
            reserveLiquidationThreshold: asset.reserveLiquidationThreshold ?? marketAsset?.reserveLiquidationThreshold,
            baseLTVasCollateral: asset.baseLTVasCollateral ?? marketAsset?.baseLTVasCollateral,
            supplyAPY: asset.supplyAPY ?? marketAsset?.supplyAPY,
            availableLiquidity: asset.availableLiquidity ?? marketAsset?.availableLiquidity,
            usageAsCollateralEnabled: asset.usageAsCollateralEnabled ?? marketAsset?.usageAsCollateralEnabled,
            eModeCollateralCategories: asset.eModeCollateralCategories ?? marketAsset?.eModeCollateralCategories,
            eModeBorrowableCategories: asset.eModeBorrowableCategories ?? marketAsset?.eModeBorrowableCategories,
        };
    }, [marketAssets]);

    const selectableSupplyTokens = useMemo(() => {
        return (supplies || []).map(enrichSupplyAsset).filter((supply) => {
            try {
                return BigInt(supply.amount || supply.balance || 0) > 0n || parseFloat(supply.formattedAmount || '0') > 0;
            } catch {
                return parseFloat(supply.formattedAmount || '0') > 0;
            }
        });
    }, [enrichSupplyAsset, supplies]);

    const defaultWithdrawAsset = useMemo(() => {
        if (providedInitialAsset) {
            return enrichSupplyAsset(providedInitialAsset);
        }

        return [...selectableSupplyTokens].sort((a, b) => {
            const aValue = parseFloat(a.formattedAmount || '0') * parseFloat(a.priceInUSD || '0');
            const bValue = parseFloat(b.formattedAmount || '0') * parseFloat(b.priceInUSD || '0');

            return bValue - aValue;
        })[0] || null;
    }, [enrichSupplyAsset, providedInitialAsset, selectableSupplyTokens]);

    const [selectedAsset, setSelectedAsset] = useState<any | null>(defaultWithdrawAsset);
    const initialAsset = selectedAsset;

    // Tabs: 'withdraw' | 'swap'
    const [activeTab, setActiveTab] = useState<'withdraw' | 'swap'>('withdraw');

    // Local State
    const [inputValue, setInputValue] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState<bigint>(0n);
    const [isMaxWithdrawSelected, setIsMaxWithdrawSelected] = useState(false);
    const [balance, setBalance] = useState<bigint>(0n); // Supplied position balance
    const [aTokenBalance, setATokenBalance] = useState<bigint>(0n); // Balance of aToken
    const [allowance, setAllowance] = useState<bigint>(0n); // Standard allowance of aToken/token depending on mode
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingBalances, setIsFetchingBalances] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [showTransactionOverview, setShowTransactionOverview] = useState(false);
    const [riskAccepted, setRiskAccepted] = useState(false);
    const [estimatedGasCostUSD, setEstimatedGasCostUSD] = useState<number | null>(null);

    // Standard native vs wrapped toggle (for standard withdraw)
    const [isNativeSelected, setIsNativeSelected] = useState(true);

    // Swap Destination State
    const [targetToken, setTargetToken] = useState<any>(null);
    const [baseTargetTokens, setBaseTargetTokens] = useState<any[]>([]);
    const [customTargetTokens, setCustomTargetTokens] = useState<any[]>([]);
    const [targetWalletBalances, setTargetWalletBalances] = useState<Record<string, { formatted: string; raw: string }>>({});
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [swapQuote, setSwapQuote] = useState<any>(null);
    const [lockedSwapQuote, setLockedSwapQuote] = useState<any>(null);
    const quoteLockedRef = useRef(false);
    const optimisticAllowanceSpenderRef = useRef<string | null>(null);
    const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default
    const [invertRate, setInvertRate] = useState(false);
    const [nextRefreshIn, setNextRefreshIn] = useState(30);

    const lockSwapQuote = useCallback((quote: any) => {
        quoteLockedRef.current = !!quote;
        setIsQuoteLoading(false);
        setLockedSwapQuote(quote);
    }, []);

    const clearLockedSwapQuote = useCallback(() => {
        quoteLockedRef.current = false;
        setLockedSwapQuote(null);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        setSelectedAsset(defaultWithdrawAsset);
        setInputValue('');
        setWithdrawAmount(0n);
        setIsMaxWithdrawSelected(false);
        setSwapQuote(null);
        optimisticAllowanceSpenderRef.current = null;
        clearLockedSwapQuote();
        setErrorText(null);
        setIsUSDMode(false);
        setRiskAccepted(false);
    }, [clearLockedSwapQuote, isOpen, defaultWithdrawAsset]);

    useEffect(() => {
        if (!isOpen || typeof window === 'undefined') return;

        try {
            const stored = window.localStorage.getItem(getCustomTargetTokenStorageKey(chainId));
            const parsed = stored ? JSON.parse(stored) : [];

            setCustomTargetTokens(Array.isArray(parsed) ? parsed : []);
        } catch {
            setCustomTargetTokens([]);
        }
    }, [chainId, isOpen]);

    useEffect(() => {
        if (!isOpen || activeTab !== 'swap' || !chainId) return;

        setBaseTargetTokens(getAaveSwapTokensByChainId(chainId));
    }, [activeTab, chainId, isOpen]);

    const market = useMemo(() => marketKey ? getMarketByKey(marketKey) : selectedNetwork, [marketKey, selectedNetwork]);
    const poolAddress = market?.addresses.POOL;
    const gatewayAddress = market?.addresses.WETH_GATEWAY;
    const withdrawSwapAdapterAddress = market?.addresses.WITHDRAW_SWAP_ADAPTER;

    const nativeInfo = useMemo(() => getNativeInfo(chainId), [chainId]);

    const isWrappedNative = useMemo(() => {
        if (!initialAsset) return false;
        return initialAsset.symbol.toUpperCase() === nativeInfo.wrapped.toUpperCase();
    }, [initialAsset, nativeInfo]);

    // Derived: aTokenAddress for initialAsset
    const aTokenAddress = useMemo(() => {
        if (!initialAsset) return null;
        return initialAsset.aTokenAddress || null;
    }, [initialAsset]);

    const persistCustomTargetToken = useCallback((token: any) => {
        const tokenAddress = getAssetAddress(token);
        if (!tokenAddress || typeof window === 'undefined') return;

        setCustomTargetTokens((current) => {
            const next = [
                token,
                ...current.filter((candidate) => getAssetAddress(candidate) !== tokenAddress),
            ];

            try {
                window.localStorage.setItem(getCustomTargetTokenStorageKey(chainId), JSON.stringify(next));
            } catch {
                // Ignore storage failures; imported token still works in the current session.
            }

            return next;
        });
    }, [chainId]);

    const swappableTokens = useMemo(() => {
        const sourceAddress = getAssetAddress(initialAsset);
        const protocolTokenAddresses = getProtocolTokenAddresses(marketAssets);
        const seen = new Set<string>();

        return [...(marketAssets || []), ...baseTargetTokens, ...customTargetTokens].map((token) => {
            const address = getAssetAddress(token);
            const marketAsset = (marketAssets || []).find((asset) => getAssetAddress(asset) === address);
            const nativePriceUSD = address === NATIVE_TOKEN_ADDRESS
                ? getNativePriceUSD(marketAssets, nativeInfo.wrapped)
                : 0;

            return {
                ...(marketAsset || {}),
                ...token,
                underlyingAsset: token.underlyingAsset || token.address,
                priceInUSD: nativePriceUSD > 0
                    ? String(nativePriceUSD)
                    : (token.priceInUSD ?? marketAsset?.priceInUSD ?? '0'),
                supplyAPY: token.supplyAPY ?? marketAsset?.supplyAPY,
                variableBorrowRate: token.variableBorrowRate ?? marketAsset?.variableBorrowRate,
                borrowRate: token.borrowRate ?? marketAsset?.borrowRate,
            };
        }).filter((token) => {
            const address = getAssetAddress(token);
            if (!address || address === sourceAddress || seen.has(address)) return false;
            if (address === NATIVE_TOKEN_ADDRESS) return false;
            if (token.isActive === false) return false;
            if (!token.isCustom && (protocolTokenAddresses.has(address) || isProtocolTokenCandidate(token))) return false;

            seen.add(address);

            return true;
        });
    }, [baseTargetTokens, customTargetTokens, initialAsset, marketAssets, nativeInfo.wrapped]);

    const handleImportTargetToken = useCallback(async (address: string) => {
        if (!publicClient || !walletAddress) return null;

        const tokenAddress = getAddress(address);
        if (tokenAddress.toLowerCase() === getAssetAddress(initialAsset)) return null;

        const existingToken = swappableTokens.find((token) => getAssetAddress(token) === tokenAddress.toLowerCase());
        if (existingToken) return existingToken;

        const abi = parseAbi(ABIS.ERC20);
        const [symbol, name, decimals] = await Promise.all([
            publicClient.readContract({
                address: tokenAddress,
                abi,
                functionName: 'symbol',
            }) as Promise<string>,
            publicClient.readContract({
                address: tokenAddress,
                abi,
                functionName: 'name',
            }) as Promise<string>,
            publicClient.readContract({
                address: tokenAddress,
                abi,
                functionName: 'decimals',
            }) as Promise<number>,
        ]);
        const normalizedDecimals = Number(decimals);
        const balanceOf = await publicClient.readContract({
            address: tokenAddress,
            abi,
            functionName: 'balanceOf',
            args: [getAddress(walletAddress)],
        }) as bigint;

        const token = {
            address: tokenAddress,
            underlyingAsset: tokenAddress,
            symbol,
            name,
            decimals: normalizedDecimals,
            amount: balanceOf.toString(),
            formattedAmount: formatUnits(balanceOf, normalizedDecimals),
            balance: balanceOf.toString(),
            priceInUSD: '0',
            isActive: true,
            isCustom: true,
        };

        persistCustomTargetToken(token);

        return token;
    }, [initialAsset, persistCustomTargetToken, publicClient, swappableTokens, walletAddress]);

    // Auto-select first target token
    useEffect(() => {
        const targetAddress = (targetToken?.underlyingAsset || targetToken?.address || '').toLowerCase();
        const targetStillValid = targetAddress
            ? swappableTokens.some((token) => (token.underlyingAsset || token.address || '').toLowerCase() === targetAddress)
            : false;

        if (isOpen && swappableTokens.length > 0 && (!targetToken || !targetStillValid)) {
            setTargetToken(swappableTokens[0]);
        }
    }, [isOpen, swappableTokens, targetToken]);

    useEffect(() => {
        if (!isLoading) {
            clearLockedSwapQuote();
        }
    }, [activeTab, clearLockedSwapQuote, initialAsset, isLoading, slippage, targetToken, withdrawAmount]);

    useEffect(() => {
        let cancelled = false;

        const fetchTargetWalletBalances = async () => {
            if (!isOpen || !tokenSelectorOpen || activeTab !== 'swap' || !publicClient || !walletAddress || swappableTokens.length === 0) {
                setTargetWalletBalances({});
                return;
            }

            try {
                setTargetWalletBalances({});
                const account = getAddress(walletAddress);
                const erc20Tokens = swappableTokens.filter((token) => getAssetAddress(token) !== NATIVE_TOKEN_ADDRESS);
                const nativeToken = swappableTokens.find((token) => getAssetAddress(token) === NATIVE_TOKEN_ADDRESS);
                const nextBalances: Record<string, { formatted: string; raw: string }> = {};

                if (nativeToken) {
                    const nativeBalance = await publicClient.getBalance({ address: account });
                    if (cancelled) return;

                    const nativeEntry = {
                        [NATIVE_TOKEN_ADDRESS]: {
                            formatted: formatUnits(nativeBalance, nativeToken.decimals || 18),
                            raw: nativeBalance.toString(),
                        },
                    };

                    Object.assign(nextBalances, nativeEntry);
                }

                for (const tokenChunk of chunkArray(erc20Tokens, TARGET_BALANCE_MULTICALL_CHUNK_SIZE)) {
                    const multicallResults = await publicClient.multicall({
                        allowFailure: true,
                        contracts: tokenChunk.map((token) => ({
                            address: getAddress(token.underlyingAsset || token.address),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'balanceOf',
                            args: [account],
                        })),
                    });

                    if (cancelled) return;

                    const chunkBalances: Record<string, { formatted: string; raw: string }> = {};
                    tokenChunk.forEach((token, index) => {
                        const result = multicallResults[index];
                        const address = getAssetAddress(token);
                        const raw = result?.status === 'success' && typeof result.result === 'bigint'
                            ? result.result
                            : 0n;

                        chunkBalances[address] = {
                            formatted: formatUnits(raw, token.decimals || 18),
                            raw: raw.toString(),
                        };
                    });

                    Object.assign(nextBalances, chunkBalances);
                }

                if (!cancelled) {
                    setTargetWalletBalances(nextBalances);
                }
            } catch {
                if (!cancelled) {
                    setTargetWalletBalances({});
                }
            }
        };

        void fetchTargetWalletBalances();

        return () => {
            cancelled = true;
        };
    }, [activeTab, isOpen, publicClient, swappableTokens, tokenSelectorOpen, walletAddress]);

    // Fetch user supplied balance and allowance
    const fetchBalances = useCallback(async () => {
        if (!walletAddress || !publicClient || !initialAsset) return;

        setIsFetchingBalances(true);

        try {
            // Fetch supplied balance from position info
            const amtStr = initialAsset.formattedAmount || initialAsset.amount || '0';
            const parsedPositionBalance = parseUnits(amtStr, initialAsset.decimals || 18);
            setBalance(parsedPositionBalance);

            if (!aTokenAddress) return;

            const account = getAddress(walletAddress);
            const aToken = getAddress(aTokenAddress);
            const contracts: any[] = [{
                address: aToken,
                abi: parseAbi(ABIS.ERC20),
                functionName: 'balanceOf',
                args: [account],
            }];
            let allowanceIndex = -1;
            let allowanceSpender: string | null = null;

            if (activeTab === 'withdraw') {
                if (isWrappedNative && isNativeSelected && gatewayAddress && aTokenAddress) {
                    allowanceSpender = getAddress(gatewayAddress);
                } else {
                    setAllowance(2n ** 256n - 1n); // Standard ERC-20 withdraw doesn't need allowance
                }
            } else if (activeTab === 'swap' && withdrawSwapAdapterAddress && aTokenAddress) {
                allowanceSpender = getAddress(withdrawSwapAdapterAddress);
            }

            if (allowanceSpender) {
                allowanceIndex = contracts.length;
                contracts.push({
                    address: aToken,
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'allowance',
                    args: [account, allowanceSpender],
                });
            }

            const results = await publicClient.multicall({
                allowFailure: true,
                contracts,
            });
            const aBalResult = results[0];
            if (aBalResult?.status === 'success' && typeof aBalResult.result === 'bigint') {
                setATokenBalance(aBalResult.result);
                setBalance(aBalResult.result);
            }

            if (allowanceIndex >= 0) {
                const allowanceResult = results[allowanceIndex];
                const nextAllowance = allowanceResult?.status === 'success' && typeof allowanceResult.result === 'bigint'
                    ? allowanceResult.result
                    : 0n;
                const isOptimisticSpender = !!allowanceSpender
                    && optimisticAllowanceSpenderRef.current === allowanceSpender.toLowerCase();

                setAllowance((currentAllowance) => (
                    isOptimisticSpender && currentAllowance >= MAX_UINT256 && nextAllowance < currentAllowance
                        ? currentAllowance
                        : nextAllowance
                ));
            }
        } catch (err) {
            console.error('Error fetching balances/allowances:', err);
        } finally {
            setIsFetchingBalances(false);
        }
    }, [walletAddress, publicClient, initialAsset, aTokenAddress, activeTab, isWrappedNative, isNativeSelected, gatewayAddress, withdrawSwapAdapterAddress]);

    useEffect(() => {
        if (isOpen && initialAsset) {
            void fetchBalances();
        }
    }, [isOpen, initialAsset, activeTab, isNativeSelected, fetchBalances]);

    const withdrawLimits = useMemo(() => {
        const emptyLimits = {
            maxByBalance: balance,
            maxByLiquidity: balance,
            maxByHealthFactor: balance,
            maxWithdrawAmount: balance,
            limitReason: null as 'balance' | 'liquidity' | 'health-factor' | null,
        };

        if (!initialAsset || balance === 0n) return emptyLimits;

        const decimals = initialAsset.decimals || 18;
        const tokenBalance = parseFiniteNumber(formatUnits(balance, decimals));
        const tokenPrice = parseFiniteNumber(initialAsset.priceInUSD);
        const totalDebt = parseFiniteNumber(summary?.totalBorrowsUSD);
        const currentHF = parseFiniteNumber(summary?.healthFactor, Infinity);
        const assetLT = normalizeRatio(initialAsset.reserveLiquidationThreshold);
        const isCollateral = initialAsset.usageAsCollateralEnabledOnUser && assetLT > 0;

        let maxByLiquidity = balance;
        try {
            if (initialAsset.availableLiquidity != null) {
                maxByLiquidity = BigInt(initialAsset.availableLiquidity);
            }
        } catch {
            const liquidity = parseFiniteNumber(initialAsset.availableLiquidity, tokenBalance);
            maxByLiquidity = parseUnits(Math.max(0, liquidity).toFixed(decimals), decimals);
        }

        const dustTolerance = 10n ** BigInt(Math.max(0, decimals - 9));
        if (balance > maxByLiquidity && balance - maxByLiquidity <= dustTolerance) {
            maxByLiquidity = balance;
        }

        let maxByHealthFactor = balance;
        if (isCollateral && totalDebt > 0 && tokenPrice > 0 && assetLT > 0) {
            const excessHF = currentHF - MIN_HEALTH_FACTOR_AFTER_WITHDRAW;
            const maxWithdrawUSD = excessHF > 0 ? (excessHF * totalDebt) / assetLT : 0;
            const maxWithdrawTokens = Math.min(tokenBalance, Math.max(0, maxWithdrawUSD / tokenPrice));
            maxByHealthFactor = parseUnits(maxWithdrawTokens.toFixed(decimals), decimals);
        }

        const maxWithdrawAmount = [balance, maxByLiquidity, maxByHealthFactor].reduce((min, value) => value < min ? value : min, balance);
        let limitReason: 'balance' | 'liquidity' | 'health-factor' | null = null;

        if (maxWithdrawAmount < balance) {
            if (maxWithdrawAmount === maxByHealthFactor) {
                limitReason = 'health-factor';
            } else if (maxWithdrawAmount === maxByLiquidity) {
                limitReason = 'liquidity';
            }
        }

        return {
            maxByBalance: balance,
            maxByLiquidity,
            maxByHealthFactor,
            maxWithdrawAmount,
            limitReason,
        };
    }, [balance, initialAsset, summary]);

    const maxWithdrawAmount = withdrawLimits.maxWithdrawAmount;

    const isFullBalanceMaxSelected = isMaxWithdrawSelected
        && aTokenBalance > 0n
        && maxWithdrawAmount === aTokenBalance;
    const isWithdrawOverMax = withdrawAmount > 0n
        && withdrawAmount > maxWithdrawAmount
        && !isFullBalanceMaxSelected;
    const withdrawLimitReason = withdrawAmount > balance
        ? 'balance'
        : isWithdrawOverMax
            ? withdrawLimits.limitReason
            : null;
    const isLimitStateSettling = isFetchingBalances || (activeTab === 'swap' && isMaxWithdrawSelected && isQuoteLoading && !swapQuote);
    const shouldShowWithdrawLimitWarning = isWithdrawOverMax && !isLimitStateSettling && !isMaxWithdrawSelected;

    const fetchCurrentATokenBalance = useCallback(async () => {
        if (!walletAddress || !publicClient || !aTokenAddress) {
            return null;
        }

        return publicClient.readContract({
            address: getAddress(aTokenAddress),
            abi: parseAbi(ABIS.ERC20),
            functionName: 'balanceOf',
            args: [getAddress(walletAddress)],
        }) as Promise<bigint>;
    }, [aTokenAddress, publicClient, walletAddress]);

    // Amount change handlers
    const handleAmountChange = (val: string) => {
        const cleaned = val.replace(/[^0-9.]/g, '');
        setInputValue(cleaned);
        setRiskAccepted(false);
        setIsMaxWithdrawSelected(false);

        if (!cleaned || isNaN(parseFloat(cleaned))) {
            setWithdrawAmount(0n);
            setSwapQuote(null);
            return;
        }

        try {
            const decimals = initialAsset?.decimals || 18;
            let parsed: bigint;

            if (isUSDMode) {
                const price = parseFloat(initialAsset?.priceInUSD || '0');

                if (!Number.isFinite(price) || price <= 0) {
                    setWithdrawAmount(0n);
                    return;
                }

                const tokenAmount = parseFloat(cleaned) / price;
                parsed = parseUnits(tokenAmount.toFixed(decimals), decimals);
            } else {
                parsed = parseUnits(cleaned, decimals);
            }

            if (parsed > balance) {
                setWithdrawAmount(balance);
                const maxTokenAmount = formatUnits(balance, decimals);

                if (isUSDMode) {
                    const price = parseFloat(initialAsset?.priceInUSD || '0');
                    const maxUSD = parseFloat(maxTokenAmount) * price;
                    setInputValue(Number.isFinite(maxUSD) ? maxUSD.toFixed(2) : '');
                } else {
                    setInputValue(maxTokenAmount);
                }
            } else {
                setWithdrawAmount(parsed);
            }
        } catch {
            // Ignore parse errors
        }
    };

    const handlePercentClick = (percent: number) => {
        if (maxWithdrawAmount === 0n) return;
        const amt = (maxWithdrawAmount * BigInt(percent)) / 100n;
        const decimals = initialAsset?.decimals || 18;
        const tokenAmount = formatUnits(amt, decimals);
        setWithdrawAmount(amt);
        setIsMaxWithdrawSelected(percent === 100);
        setRiskAccepted(false);

        if (isUSDMode) {
            const price = parseFloat(initialAsset?.priceInUSD || '0');
            const usdAmount = parseFloat(tokenAmount) * price;
            setInputValue(Number.isFinite(usdAmount) ? usdAmount.toFixed(2) : '');
        } else {
            setInputValue(tokenAmount);
        }
    };

    useEffect(() => {
        if (
            !isMaxWithdrawSelected ||
            !initialAsset ||
            maxWithdrawAmount === 0n ||
            withdrawAmount === maxWithdrawAmount
        ) {
            return;
        }

        const decimals = initialAsset.decimals || 18;
        const tokenAmount = formatUnits(maxWithdrawAmount, decimals);

        setWithdrawAmount(maxWithdrawAmount);

        if (isUSDMode) {
            const price = parseFloat(initialAsset.priceInUSD || '0');
            const usdAmount = parseFloat(tokenAmount) * price;
            setInputValue(Number.isFinite(usdAmount) ? usdAmount.toFixed(2) : '');
        } else {
            setInputValue(tokenAmount);
        }
    }, [
        initialAsset,
        isMaxWithdrawSelected,
        isUSDMode,
        maxWithdrawAmount,
        withdrawAmount,
    ]);

    // Fetch quote for Withdraw & Swap
    const fetchQuoteData = useCallback(async (force = false) => {
        if (isLoading || (quoteLockedRef.current && !force)) {
            return;
        }

        if (activeTab !== 'swap' || !initialAsset || !targetToken || withdrawAmount === 0n || !withdrawSwapAdapterAddress) {
            setSwapQuote(null);
            return;
        }

        if (getAssetAddress(targetToken) === NATIVE_TOKEN_ADDRESS) {
            setSwapQuote(null);
            setErrorText(`${nativeInfo.native} output is not available for Withdraw & Swap yet. Choose ${nativeInfo.wrapped} instead.`);
            return;
        }

        setIsQuoteLoading(true);
        setErrorText(null);

        try {
            const quote = await getWithdrawSwapQuote({
                fromToken: {
                    address: getAddress(initialAsset.underlyingAsset || initialAsset.address),
                    decimals: initialAsset.decimals,
                    symbol: initialAsset.symbol,
                },
                toToken: {
                    address: getAddress(targetToken.underlyingAsset || targetToken.address),
                    decimals: targetToken.decimals,
                    symbol: targetToken.symbol,
                },
                srcAmount: withdrawAmount.toString(),
                adapterAddress: getAddress(withdrawSwapAdapterAddress),
                chainId,
                walletAddress,
                marketKey,
            });

            if (quoteLockedRef.current && !force) {
                return;
            }

            setSwapQuote(quote);
        } catch (err: any) {
            if (quoteLockedRef.current && !force) {
                return;
            }

            setSwapQuote(null);
            setErrorText(err.message || 'Failed to fetch withdraw swap quote');
        } finally {
            if (!quoteLockedRef.current || force) {
                setIsQuoteLoading(false);
            }
        }
    }, [activeTab, chainId, initialAsset, isLoading, marketKey, nativeInfo.native, nativeInfo.wrapped, targetToken, walletAddress, withdrawAmount, withdrawSwapAdapterAddress]);

    useEffect(() => {
        const timer = setTimeout(() => {
            void fetchQuoteData();
        }, 600);
        return () => clearTimeout(timer);
    }, [withdrawAmount, targetToken, activeTab, fetchQuoteData]);

    useEffect(() => {
        if (activeTab !== 'swap' || withdrawAmount === 0n || !swapQuote || isQuoteLoading || lockedSwapQuote) {
            setNextRefreshIn(30);
            return;
        }

        setNextRefreshIn(30);
        const interval = setInterval(() => {
            setNextRefreshIn((value) => {
                if (value <= 1) {
                    void fetchQuoteData();
                    return 30;
                }

                return value - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [activeTab, fetchQuoteData, isQuoteLoading, lockedSwapQuote, swapQuote, withdrawAmount]);

    // HF Simulation
    const simulation = useMemo(() => {
        if (!summary || !initialAsset || withdrawAmount === 0n) return null;

        const currentHF = parseFloat(summary.healthFactor || '0');
        const totalCollateral = parseFloat(summary.totalCollateralUSD || '0');
        const totalDebt = parseFloat(summary.totalBorrowsUSD || '0');
        const avgLT = normalizeRatio(summary.currentLiquidationThreshold);

        const removedAmount = parseFloat(formatUnits(withdrawAmount, initialAsset.decimals || 18));
        let price = parseFiniteNumber(initialAsset.priceInUSD);
        if (price > 1_000_000_000) {
            price = price / 1e8;
        }
        const removedUSD = removedAmount * price;

        const assetLT = normalizeRatio(initialAsset.reserveLiquidationThreshold);
        const isCollateral = initialAsset.usageAsCollateralEnabledOnUser && assetLT > 0;

        const currentNumerator = totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
        const assetContribution = isCollateral ? removedUSD * assetLT : 0;
        const simulatedCollateral = isCollateral ? Math.max(0, totalCollateral - removedUSD) : totalCollateral;
        const simulatedNumerator = simulatedCollateral > 0 ? Math.max(0, currentNumerator - assetContribution) : 0;
        const simulatedHF = totalDebt > 0 ? simulatedNumerator / totalDebt : Infinity;
        const simulatedLT = simulatedCollateral > 0 ? simulatedNumerator / simulatedCollateral : 0;

        return {
            currentHF: currentHF.toString(),
            simulatedHF: simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
            isSafe: simulatedHF >= MIN_HEALTH_FACTOR_AFTER_WITHDRAW || totalDebt === 0,
            isDanger: simulatedHF < MIN_HEALTH_FACTOR_AFTER_WITHDRAW && totalDebt > 0,
            isRisky: simulatedHF >= MIN_HEALTH_FACTOR_AFTER_WITHDRAW && simulatedHF < RISK_HEALTH_FACTOR_THRESHOLD && totalDebt > 0 && isCollateral,
            currentCollateralPower: currentNumerator,
            simulatedCollateralPower: simulatedNumerator,
            currentLiquidationThreshold: avgLT,
            simulatedLiquidationThreshold: simulatedLT,
            removedUSD,
            isCollateral,
        };
    }, [summary, initialAsset, withdrawAmount]);

    const requiresRiskAcceptance = !!simulation?.isRisky;
    const isWithdrawBlocked = isWithdrawOverMax || !!simulation?.isDanger || (requiresRiskAcceptance && !riskAccepted);
    const isSwapQuoteReady = activeTab !== 'swap' || (!!swapQuote && !isQuoteLoading);
    const isTransactionOverviewReady = withdrawAmount > 0n && (
        activeTab === 'withdraw' || (!!swapQuote && !isQuoteLoading)
    );

    const remainingSupplyDisplay = useMemo(() => {
        if (!initialAsset) return null;

        const remaining = balance > withdrawAmount ? balance - withdrawAmount : 0n;

        return `${formatCompactNumber(formatUnits(remaining, initialAsset.decimals || 18))} ${initialAsset.symbol}`;
    }, [balance, initialAsset, withdrawAmount]);

    const costsAndFees = useMemo(() => {
        const gasUSD = activeTab === 'swap'
            ? parseFloat(swapQuote?.priceRoute?.gasCostUSD || '0')
            : (estimatedGasCostUSD ?? 0);
        const feeBps = Number(swapQuote?.feeBps || 0);
        const destAmount = swapQuote?.destAmount && targetToken
            ? parseFloat(formatUnits(BigInt(swapQuote.destAmount), targetToken.decimals || 18))
            : 0;
        const targetPrice = parseFloat(targetToken?.priceInUSD || '0');
        const quoteDestUSD = parseFloat(swapQuote?.priceRoute?.destUSD || '0');
        const serviceFeeToken = Number.isFinite(feeBps) && feeBps > 0 ? destAmount * (feeBps / 10000) : 0;
        const serviceFeeUSD = Number.isFinite(targetPrice) && targetPrice > 0
            ? serviceFeeToken * targetPrice
            : (Number.isFinite(quoteDestUSD) && quoteDestUSD > 0 && Number.isFinite(feeBps) ? quoteDestUSD * (feeBps / 10000) : 0);

        return {
            gasUSD: Number.isFinite(gasUSD) ? gasUSD : 0,
            feeBps: Number.isFinite(feeBps) ? feeBps : 0,
            serviceFeeToken,
            serviceFeeUSD: Number.isFinite(serviceFeeUSD) ? serviceFeeUSD : 0,
            totalUSD: (Number.isFinite(gasUSD) ? gasUSD : 0) + (Number.isFinite(serviceFeeUSD) ? serviceFeeUSD : 0),
        };
    }, [activeTab, estimatedGasCostUSD, swapQuote, targetToken]);

    // Contract writes
    const handleApprove = async () => {
        if (!walletClient || !aTokenAddress || isWithdrawBlocked) return;
        const lockedQuote = activeTab === 'swap' ? swapQuote : null;

        if (activeTab === 'swap' && (!lockedQuote || isQuoteLoading)) {
            setErrorText('Wait for the quote to finish before approving.');
            return;
        }

        if (activeTab === 'swap') {
            lockSwapQuote(lockedQuote);
        }

        setIsLoading(true);
        setErrorText(null);

        const spender = activeTab === 'withdraw' ? gatewayAddress : withdrawSwapAdapterAddress;
        if (!spender) return;

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            const txHash = await walletClient.writeContract({
                account: getAddress(walletAddress),
                address: getAddress(aTokenAddress),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'approve',
                args: [getAddress(spender), MAX_UINT256],
                gas: APPROVAL_GAS_LIMIT,
            });

            addTransaction({
                hash: txHash,
                chainId,
                description: `Approve ${initialAsset.symbol} receipt for ${activeTab === 'withdraw' ? 'Gateway' : 'Swap Adapter'}`,
                marketKey: marketKey || selectedNetwork.key,
                suppressPositionRefresh: true,
            });

            if (publicClient) {
                await publicClient.waitForTransactionReceipt({ hash: txHash });
            }

            optimisticAllowanceSpenderRef.current = getAddress(spender).toLowerCase();
            setAllowance(MAX_UINT256);

            await handleConfirm(lockedQuote);
        } catch (err: any) {
            clearLockedSwapQuote();
            setErrorText(err.shortMessage || err.message || 'Approval failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = async (lockedQuote?: any) => {
        if (!walletClient || !initialAsset || !poolAddress || withdrawAmount === 0n || isWithdrawBlocked) return;
        const quoteForExecution = activeTab === 'swap' ? (lockedQuote || lockedSwapQuote || swapQuote) : null;
        const hasLockedQuoteForExecution = activeTab === 'swap' && !!(lockedQuote || lockedSwapQuote);

        if (activeTab === 'swap' && (!quoteForExecution || (!hasLockedQuoteForExecution && isQuoteLoading))) {
            setErrorText('Wait for the quote to finish before confirming.');
            return;
        }

        if (activeTab === 'swap' && quoteForExecution) {
            lockSwapQuote(quoteForExecution);
        }

        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            let txHash: `0x${string}`;

            if (activeTab === 'withdraw') {
                const freshATokenBalance = isFullBalanceMaxSelected
                    ? await fetchCurrentATokenBalance()
                    : null;
                const displayWithdrawAmount = freshATokenBalance ?? withdrawAmount;
                const contractWithdrawAmount = freshATokenBalance !== null
                    ? MAX_UINT256
                    : withdrawAmount;

                if (isWrappedNative && isNativeSelected) {
                    if (!gatewayAddress) throw new Error('WETH Gateway address missing');
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(gatewayAddress),
                        abi: parseAbi(ABIS.WETH_GATEWAY),
                        functionName: 'withdrawETH',
                        args: [getAddress(poolAddress), contractWithdrawAmount, getAddress(walletAddress)],
                        gas: WITHDRAW_GAS_LIMIT,
                    });
                } else {
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(poolAddress),
                        abi: parseAbi(ABIS.POOL),
                        functionName: 'withdraw',
                        args: [getAddress(initialAsset.underlyingAsset || initialAsset.address), contractWithdrawAmount, getAddress(walletAddress)],
                        gas: WITHDRAW_GAS_LIMIT,
                    });
                }

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Withdraw ${formatUnits(displayWithdrawAmount, initialAsset.decimals)} ${isWrappedNative && isNativeSelected ? nativeInfo.native : initialAsset.symbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                });
            } else {
                // Withdraw & Swap route
                if (!withdrawSwapAdapterAddress || !quoteForExecution) throw new Error('Withdraw Swap parameters missing');
                if (getAssetAddress(targetToken) === NATIVE_TOKEN_ADDRESS) {
                    throw new Error(`${nativeInfo.native} output is not available for Withdraw & Swap yet. Choose ${nativeInfo.wrapped} instead.`);
                }

                const isMax = isFullBalanceMaxSelected;
                const freshATokenBalance = isMax
                    ? await fetchCurrentATokenBalance()
                    : null;
                const quoteAmount = freshATokenBalance ?? withdrawAmount;
                const latestQuote = quoteForExecution;

                // Build swap transaction calldata
                const txData = await buildWithdrawSwapTx({
                    fromToken: {
                        address: getAddress(initialAsset.underlyingAsset || initialAsset.address),
                        decimals: initialAsset.decimals,
                        symbol: initialAsset.symbol,
                    },
                    toToken: {
                        address: getAddress(targetToken.underlyingAsset || targetToken.address),
                        decimals: targetToken.decimals,
                        symbol: targetToken.symbol,
                    },
                    priceRoute: latestQuote.priceRoute,
                    adapterAddress: getAddress(withdrawSwapAdapterAddress),
                    srcAmount: quoteAmount.toString(),
                    isMaxSwap: isMax,
                    slippageBps: slippage * 100,
                    chainId,
                    walletAddress,
                    marketKey,
                });

                const permitParams = {
                    amount: 0n,
                    deadline: 0n,
                    v: 0,
                    r: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
                    s: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
                };

                txHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(withdrawSwapAdapterAddress),
                    abi: ABIS.WITHDRAW_SWAP_ADAPTER,
                    functionName: 'withdrawAndSwap',
                    args: [
                        getAddress(initialAsset.underlyingAsset || initialAsset.address),
                        getAddress(targetToken.underlyingAsset || targetToken.address),
                        isMax ? MAX_UINT256 : withdrawAmount,
                        BigInt(txData.minAmountToReceive),
                        BigInt(txData.swapAllBalanceOffset),
                        txData.swapCallData,
                        getAddress(txData.augustus),
                        permitParams,
                    ],
                    gas: resolveWithdrawSwapGasLimit(txData, latestQuote.priceRoute),
                });

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Withdraw & Swap ${formatUnits(quoteAmount, initialAsset.decimals)} ${initialAsset.symbol} to ${targetToken.symbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                });
            }

            setIsSuccess(true);
            onSuccess?.();
            setTimeout(() => {
                onClose();
                setIsSuccess(false);
                setInputValue('');
                setWithdrawAmount(0n);
                setIsMaxWithdrawSelected(false);
                clearLockedSwapQuote();
            }, 2000);
        } catch (err: any) {
            clearLockedSwapQuote();
            setErrorText(err.shortMessage || err.message || 'Withdrawal failed');
        } finally {
            setIsLoading(false);
        }
    };

    const isWrongNetwork = selectedNetwork?.chainId !== chainId;

    const handleSwitchChain = async () => {
        if (!market) return;
        setIsLoading(true);
        try {
            await setSelectedNetwork(market.key);
        } finally {
            setIsLoading(false);
        }
    };

    const requiredAllowanceAmount = isFullBalanceMaxSelected ? MAX_UINT256 : withdrawAmount;
    const isApproveRequired = activeTab === 'swap'
        ? allowance < requiredAllowanceAmount
        : (isWrappedNative && isNativeSelected && allowance < requiredAllowanceAmount);

    useEffect(() => {
        setEstimatedGasCostUSD(null);
    }, [activeTab, initialAsset, withdrawAmount]);

    const withdrawToken = useMemo(() => {
        if (!initialAsset) return null;

        if (activeTab === 'withdraw' && isWrappedNative && isNativeSelected) {
            return { ...initialAsset, symbol: nativeInfo.native };
        }

        return initialAsset;
    }, [activeTab, initialAsset, isNativeSelected, isWrappedNative, nativeInfo.native]);

    const handleToggleUSDMode = useCallback(() => {
        if (!initialAsset) {
            setIsUSDMode(!isUSDMode);
            return;
        }

        const price = parseFloat(initialAsset.priceInUSD || '0');

        if (!Number.isFinite(price) || price <= 0 || !inputValue) {
            setIsUSDMode(!isUSDMode);
            return;
        }

        if (isUSDMode) {
            const usdAmount = parseFloat(inputValue);
            const tokenAmount = usdAmount / price;
            setInputValue(tokenAmount.toFixed(tokenAmount < 0.0001 ? 8 : 6).replace(/\.?0+$/, ''));
        } else {
            const tokenAmount = parseFloat(inputValue);
            setInputValue((tokenAmount * price).toFixed(2));
        }

        setIsUSDMode(!isUSDMode);
    }, [initialAsset, inputValue, isUSDMode]);

    const sourceSecondaryValue = useMemo(() => {
        if (!initialAsset) return null;

        if (isUSDMode) {
            if (withdrawAmount === 0n) return `0 ${initialAsset.symbol}`;

            return formatCompactToken(formatUnits(withdrawAmount, initialAsset.decimals || 18), initialAsset.symbol);
        }

        if (withdrawAmount === 0n) return formatUSD(0);

        const amount = parseFloat(formatUnits(withdrawAmount, initialAsset.decimals || 18));
        const price = parseFloat(initialAsset.priceInUSD || '0');

        if (!Number.isFinite(amount) || !Number.isFinite(price) || price <= 0) {
            return null;
        }

        return `$${(amount * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }, [initialAsset, isUSDMode, withdrawAmount]);

    const targetValue = useMemo(() => {
        if (!swapQuote?.destAmount || !targetToken) return '';

        return formatUnits(BigInt(swapQuote.destAmount), targetToken.decimals || 18);
    }, [swapQuote?.destAmount, targetToken]);

    const targetSecondaryValue = useMemo(() => {
        if (isQuoteLoading) return 'Loading quote...';
        if (!targetToken || !targetValue) return 'Est. receive';

        const amount = parseFloat(targetValue);
        const price = parseFloat(targetToken.priceInUSD || '0');
        const quoteDestUSD = parseFloat(swapQuote?.priceRoute?.destUSD || '0');

        if (Number.isFinite(quoteDestUSD) && quoteDestUSD > 0) {
            return formatUSD(quoteDestUSD);
        }

        if (!Number.isFinite(amount) || !Number.isFinite(price) || price <= 0) {
            return 'Est. receive';
        }

        return `$${(amount * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }, [isQuoteLoading, swapQuote?.priceRoute?.destUSD, targetToken, targetValue]);

    const renderSourceTokenStatus = useCallback((token: any) => {
        const formattedAmount = token.formattedAmount || token.formattedBalance || '0';
        const amount = formatCompactNumber(formattedAmount);
        const amountNumber = parseFloat(formattedAmount || '0');
        const price = parseFloat(token.priceInUSD || '0');
        const amountUSD = Number.isFinite(amountNumber) && Number.isFinite(price) && price > 0
            ? formatUSD(amountNumber * price)
            : undefined;

        return {
            disabled: false,
            reasons: [],
            amount,
            amountUSD,
        };
    }, []);

    const renderTargetTokenStatus = useCallback((token: any) => {
        const address = getAssetAddress(token);
        const walletBalance = targetWalletBalances[address];
        const formattedAmount = walletBalance?.formatted || token.formattedAmount || token.formattedBalance || '0';
        const amountNumber = parseFloat(formattedAmount || '0');
        const price = parseFloat(token.priceInUSD || '0');
        const amountUSD = Number.isFinite(amountNumber) && Number.isFinite(price) && price > 0
            ? formatUSD(amountNumber * price)
            : undefined;
        const isNativeToken = address === NATIVE_TOKEN_ADDRESS;

        return {
            disabled: false,
            reasons: [],
            amount: Number.isFinite(amountNumber) ? formatCompactNumber(formattedAmount) : undefined,
            amountRaw: Number.isFinite(amountNumber) ? amountNumber : 0,
            amountUSD,
            contractAddress: isNativeToken ? undefined : formatAddressShort(token.underlyingAsset || token.address),
            contractUrl: !isNativeToken && market?.explorer && (token.underlyingAsset || token.address)
                ? `${market.explorer}/address/${token.underlyingAsset || token.address}`
                : undefined,
            hideRate: true,
        };
    }, [market?.explorer, targetWalletBalances]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={initialAsset?.symbol ? `Withdraw ${initialAsset.symbol}` : 'Withdraw'}
            maxWidth="460px"
            headerBorder={false}
            preventAutoFocus={true}
        >
            <div className="p-3 space-y-2">
                {isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center animate-in zoom-in-95 duration-200">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Transaction Broadcasted</h3>
                        <p className="text-xs text-slate-500 mt-1">Your withdraw request is processing on-chain.</p>
                    </div>
                ) : (
                    <>
                        {/* Tab Switcher */}
                        {withdrawSwapAdapterAddress && (
                            <div className="grid grid-cols-2 h-9 rounded-xl bg-slate-100 dark:bg-slate-800/45 p-0.5 text-[11px] font-bold">
                                <button
                                    onClick={() => { setActiveTab('withdraw'); setErrorText(null); }}
                                    className={`inline-flex h-8 items-center justify-center rounded-lg transition-all whitespace-nowrap ${activeTab === 'withdraw' ? 'bg-white dark:bg-slate-700/80 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                                >
                                    Withdraw
                                </button>
                                <button
                                    onClick={() => { setActiveTab('swap'); setErrorText(null); }}
                                    className={`inline-flex h-8 items-center justify-center rounded-lg transition-all whitespace-nowrap ${activeTab === 'swap' ? 'bg-white dark:bg-slate-700/80 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                                >
                                    Withdraw & Swap
                                </button>
                            </div>
                        )}

                        <CompactAmountInput
                            token={withdrawToken}
                            value={inputValue}
                            isUSDMode={isUSDMode}
                            onToggleUSDMode={handleToggleUSDMode}
                            onChange={(val) => handleAmountChange(normalizeDecimalInput(val))}
                            onApplyMax={() => handlePercentClick(100)}
                            onApplyPct={handlePercentClick}
                            maxAmount={maxWithdrawAmount}
                            decimals={isUSDMode ? 2 : (initialAsset?.decimals || 18)}
                            formattedBalance={formatUnits(balance, initialAsset?.decimals || 18)}
                            onTokenSelect={() => {
                                if (selectableSupplyTokens.length > 1) {
                                    setSourceSelectorOpen(true);
                                }
                            }}
                            secondaryValue={sourceSecondaryValue}
                            displaySymbol={withdrawToken?.symbol}
                            disabled={isLoading}
                            isError={shouldShowWithdrawLimitWarning}
                        />

                        {shouldShowWithdrawLimitWarning && initialAsset && (
                            <div className="px-1 text-xs font-medium text-amber-500">
                                {withdrawLimitReason === 'health-factor'
                                    ? `You can withdraw up to ${formatCompactNumber(formatUnits(maxWithdrawAmount, initialAsset.decimals || 18))} ${initialAsset.symbol} while keeping Health Factor above ${MIN_HEALTH_FACTOR_AFTER_WITHDRAW.toFixed(2)}.`
                                    : withdrawLimitReason === 'liquidity'
                                        ? 'Available protocol liquidity is lower than your supplied balance.'
                                        : 'Amount exceeds your supplied balance.'}
                            </div>
                        )}

                        {activeTab === 'withdraw' && isWrappedNative && gatewayAddress && (
                            <div className="flex items-center gap-2 px-1 pt-1">
                                <Switch
                                    checked={isNativeSelected}
                                    onCheckedChange={setIsNativeSelected}
                                />
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    Unwrap {nativeInfo.wrapped} (to withdraw {nativeInfo.native})
                                </span>
                            </div>
                        )}

                        {/* Withdraw & Swap Target Asset Box */}
                        {activeTab === 'swap' && (
                            <div className="space-y-2">
                                <div className="flex justify-center min-h-4 items-center">
                                    {withdrawAmount > 0n ? (
                                        <div className="text-xs text-slate-500 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    clearLockedSwapQuote();
                                                    void fetchQuoteData(true);
                                                    setNextRefreshIn(30);
                                                }}
                                                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                                title="Refresh quote"
                                                disabled={isQuoteLoading || isLoading}
                                            >
                                                <RefreshCw className={`w-3 h-3 ${isQuoteLoading ? 'animate-spin' : ''}`} />
                                            </button>
                                            {isQuoteLoading || !swapQuote ? (
                                                'Loading quote...'
                                            ) : lockedSwapQuote ? (
                                                'Quote locked'
                                            ) : (
                                                `Auto refresh in ${nextRefreshIn}s`
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-500/50 flex items-center h-full">
                                            Waiting for amount...
                                        </div>
                                    )}
                                </div>

                                <CompactAmountInput
                                    token={targetToken}
                                    value={targetValue ? formatCompactNumber(targetValue) : ''}
                                    onChange={() => undefined}
                                    maxAmount={0n}
                                    decimals={targetToken?.decimals || 18}
                                    formattedBalance="0"
                                    onTokenSelect={() => setTokenSelectorOpen(true)}
                                    secondaryValue={targetSecondaryValue}
                                    displaySymbol={targetToken?.symbol}
                                    readOnly={true}
                                    isLoading={isQuoteLoading}
                                    loadingLabel="Loading quote..."
                                    showQuickActions={false}
                                />

                                {initialAsset && targetToken && (
                                    <div className="flex flex-col items-center mt-1 space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => setInvertRate(!invertRate)}
                                            className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer group"
                                            title="Invert rate"
                                        >
                                            <span>1 {invertRate ? targetToken.symbol : initialAsset.symbol}</span>
                                            <ArrowRightLeft className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400" />
                                            <span>
                                                {(() => {
                                                    const inputF = parseFloat(formatUnits(withdrawAmount, initialAsset.decimals || 18));
                                                    const outputF = swapQuote?.destAmount
                                                        ? parseFloat(formatUnits(BigInt(swapQuote.destAmount), targetToken.decimals || 18))
                                                        : 0;

                                                    if (inputF > 0 && outputF > 0) {
                                                        return invertRate
                                                            ? `${(inputF / outputF).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${initialAsset.symbol}`
                                                            : `${(outputF / inputF).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${targetToken.symbol}`;
                                                    }

                                                    const fromPrice = parseFloat(initialAsset.priceInUSD || '0');
                                                    const toPrice = parseFloat(targetToken.priceInUSD || '0');

                                                    if (fromPrice > 0 && toPrice > 0) {
                                                        return invertRate
                                                            ? `${(toPrice / fromPrice).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${initialAsset.symbol}`
                                                            : `${(fromPrice / toPrice).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${targetToken.symbol}`;
                                                    }

                                                    return '-';
                                                })()}
                                            </span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Overview / Simulations */}
                        {initialAsset && isTransactionOverviewReady && (
                            <div className="mt-1 mb-1">
                                <div className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-0.5 px-1">Transaction overview</div>
                                <div className="transition-all">
                                    <button
                                        onClick={() => setShowTransactionOverview(!showTransactionOverview)}
                                        className="w-full flex items-center justify-between px-1 py-1 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-[13px] text-slate-600 dark:text-slate-300">Costs & Fees</span>
                                            {swapQuote?.discountPercent > 0 && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold whitespace-nowrap">
                                                    Discount Applied
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                                            <span className="font-medium">{costsAndFees.totalUSD > 0 ? formatUSD(costsAndFees.totalUSD) : '< $0.01'}</span>
                                            {showTransactionOverview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </div>
                                    </button>

                                    {showTransactionOverview && (
                                        <div className="relative ml-4 pl-4 pr-3 pb-1 pt-2 space-y-3 text-xs border-l border-dashed border-slate-300 dark:border-slate-700/50">
                                            <div className="flex justify-between items-center group">
                                                <div className="flex items-center gap-1.5 text-slate-500">
                                                    <span>Network costs</span>
                                                    <InfoTooltip content="Estimated network gas cost." size={12} />
                                                </div>
                                                <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                                    <span>{costsAndFees.gasUSD > 0 ? formatUSD(costsAndFees.gasUSD) : '< $0.01'}</span>
                                                </div>
                                            </div>

                                            {activeTab === 'swap' && targetToken && (
                                                <div className="flex justify-between items-center group">
                                                    <div className="flex items-center gap-1.5 text-slate-500">
                                                        <span>Service Fee ({(costsAndFees.feeBps / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%)</span>
                                                        {swapQuote?.discountPercent > 0 && (
                                                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                                                                {swapQuote.discountPercent}% OFF
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                                        <div className="w-3.5 h-3.5 rounded-full overflow-hidden">
                                                            <img src={getTokenLogo(targetToken.symbol)} className="w-full h-full object-cover" />
                                                        </div>
                                                        <span>
                                                            {costsAndFees.feeBps === 0
                                                                ? 'Free'
                                                                : costsAndFees.serviceFeeToken < 0.00001
                                                                    ? '< 0.00001'
                                                                    : costsAndFees.serviceFeeToken.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Persistent Rows Below Fees */}
                                    <div className="px-1 pb-1 pt-1 space-y-2">
                                        {remainingSupplyDisplay && (
                                            <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <span>Remaining supply</span>
                                                    <InfoTooltip content="Your estimated token balance in the protocol after the withdraw is completed." size={12} />
                                                </div>
                                                <div className="text-right font-medium">
                                                    <span className="text-slate-900 dark:text-slate-100">{remainingSupplyDisplay}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Health Factor Row */}
                                        <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                            <div className="flex items-center gap-1.5">
                                                <span>Health factor</span>
                                                <InfoTooltip content="Safety of your collateral against your debt." size={12} />
                                            </div>
                                            <div className="text-right font-medium">
                                                <div className="flex items-center gap-1.5 font-bold">
                                                    <span>{formatHF(summary?.healthFactor)}</span>
                                                    {simulation && (
                                                        <>
                                                            <span className="text-slate-400 font-normal">-&gt;</span>
                                                            <InfoTooltip content="Liquidation < 1.0" size={12}>
                                                                <span className={`${getHealthFactorColor(parseFiniteNumber(simulation.simulatedHF, -1))} font-bold`}>
                                                                    {formatHF(simulation.simulatedHF)}
                                                                </span>
                                                            </InfoTooltip>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {simulation && (
                                            <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <span>Collateral power</span>
                                                    <InfoTooltip content="Total value of collateral considered for collateralization." size={12} />
                                                </div>
                                                <div className="text-right font-medium">
                                                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <span>{formatUSD(simulation.currentCollateralPower)}</span>
                                                        <span className="text-slate-400 font-normal">-&gt;</span>
                                                        <span className={simulation.simulatedCollateralPower < simulation.currentCollateralPower ? 'text-amber-500 font-bold' : 'text-slate-900 dark:text-slate-100'}>
                                                            {formatUSD(simulation.simulatedCollateralPower)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                            <div className="flex items-center gap-1.5">
                                                <span>Supply APY</span>
                                                <InfoTooltip content="Annual yield on deposited assets." size={12} />
                                            </div>
                                            <div className="text-right font-medium">
                                                <span className="text-slate-900 dark:text-slate-100">{formatAPY((initialAsset.supplyAPY ?? 0) * 100)}</span>
                                            </div>
                                        </div>

                                        {simulation && (
                                            <div className="flex justify-between items-start text-[13px] text-slate-600 dark:text-slate-300 font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    <span>Liquidation threshold</span>
                                                    <InfoTooltip content="The weight average of your collateral's liquidation thresholds." size={12} />
                                                </div>
                                                <div className="text-right font-medium">
                                                    <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                        <span>{Math.round(simulation.currentLiquidationThreshold * 100)}%</span>
                                                        <span className="text-slate-400 font-normal">-&gt;</span>
                                                        <span className={simulation.simulatedLiquidationThreshold < simulation.currentLiquidationThreshold ? 'text-amber-500 font-bold' : 'text-slate-900 dark:text-slate-100'}>
                                                            {Math.round(simulation.simulatedLiquidationThreshold * 100)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {simulation?.isDanger && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 p-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 animate-pulse" />
                                <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                                    This withdrawal would reduce your Health Factor below {MIN_HEALTH_FACTOR_AFTER_WITHDRAW.toFixed(2)}. Reduce the amount to continue.
                                </p>
                            </div>
                        )}

                        {requiresRiskAcceptance && !simulation?.isDanger && (
                            <div className="space-y-1.5 mt-2 mb-2 px-4 text-center">
                                <p className="mx-auto max-w-97.5 text-[11px] font-bold leading-snug text-red-600 dark:text-red-400">
                                    Withdrawing this amount will reduce your Health Factor and increase liquidation risk.
                                </p>
                                <label className="flex items-center justify-center gap-2 text-[11px] font-bold text-red-600 dark:text-red-400">
                                    <Checkbox
                                        checked={riskAccepted}
                                        onCheckedChange={(checked) => setRiskAccepted(checked === true)}
                                        className="border-red-500/60 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                                    />
                                    I acknowledge the risks involved.
                                </label>
                            </div>
                        )}

                        {errorText && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 p-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                <p className="text-xs font-semibold text-red-800 dark:text-red-300">{errorText}</p>
                            </div>
                        )}

                        {/* Action Button */}
                        <div className="pt-3">
                            {isWrongNetwork ? (
                                <Button
                                    onClick={handleSwitchChain}
                                    disabled={isLoading}
                                    className="w-full py-3 h-auto font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                                    Switch Network to {market?.shortLabel || 'Market Chain'}
                                </Button>
                            ) : isApproveRequired ? (
                                <Button
                                    onClick={handleApprove}
                                    disabled={isLoading || withdrawAmount === 0n || isWithdrawBlocked || !isSwapQuoteReady}
                                    className="w-full py-3 h-auto font-bold rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                                    {!isSwapQuoteReady
                                        ? 'Getting quote...'
                                        : shouldShowWithdrawLimitWarning
                                            ? withdrawLimitReason === 'health-factor'
                                                ? 'Unsafe Health Factor'
                                                : 'Amount exceeds available'
                                            : simulation?.isDanger
                                                ? 'Unsafe Health Factor'
                                                : requiresRiskAcceptance && !riskAccepted
                                                    ? 'Accept risk to continue'
                                                    : activeTab === 'swap'
                                                        ? 'Approve & Withdraw Swap'
                                                        : `Approve ${initialAsset?.symbol} receipt`}
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => handleConfirm()}
                                    disabled={isLoading || withdrawAmount === 0n || isWithdrawBlocked || !isSwapQuoteReady}
                                    className="w-full py-3 h-auto font-bold rounded-xl"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                                    {!isSwapQuoteReady
                                        ? 'Getting quote...'
                                        : shouldShowWithdrawLimitWarning
                                            ? withdrawLimitReason === 'health-factor'
                                                ? 'Unsafe Health Factor'
                                                : 'Amount exceeds available'
                                            : simulation?.isDanger
                                                ? 'Unsafe Health Factor'
                                                : requiresRiskAcceptance && !riskAccepted
                                                    ? 'Accept risk to continue'
                                                    : withdrawAmount === 0n
                                                        ? 'Enter an amount'
                                                        : activeTab === 'swap'
                                                            ? 'Confirm Withdraw & Swap'
                                                            : `Withdraw ${isNativeSelected && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}`}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Token Selector (for target asset swap) */}
            <TokenSelector
                isOpen={tokenSelectorOpen}
                onClose={() => setTokenSelectorOpen(false)}
                onSelect={(tok) => {
                    setTargetToken(tok);
                    setSwapQuote(null);
                    if (tok.isCustom) {
                        persistCustomTargetToken(tok);
                    }
                }}
                tokens={swappableTokens}
                title="Select Asset to Receive"
                description="Choose a token or paste a token address"
                searchPlaceholder="Search name or paste address"
                renderStatus={renderTargetTokenStatus}
                marketAssets={marketAssets}
                allowCustomTokens
                onImportToken={handleImportTargetToken}
                sortByAmount
            />
            <TokenSelector
                isOpen={sourceSelectorOpen}
                onClose={() => setSourceSelectorOpen(false)}
                onSelect={(token) => {
                    setSelectedAsset(token);
                    setInputValue('');
                    setWithdrawAmount(0n);
                    setIsMaxWithdrawSelected(false);
                    setSwapQuote(null);
                    setErrorText(null);
                    setRiskAccepted(false);
                    setSourceSelectorOpen(false);
                }}
                tokens={selectableSupplyTokens}
                title="Select Position to Withdraw"
                description="Choose a token to withdraw from your supply positions"
                renderStatus={renderSourceTokenStatus}
                rateField="supplyAPY"
                marketAssets={marketAssets}
            />
        </Modal>
    );
};

const getNativeInfo = (chainId: number) => {
    switch (chainId) {
        case 1:
        case 8453:
        case 42161:
        case 10:
            return { native: 'ETH', wrapped: 'WETH' };
        case 56:
            return { native: 'BNB', wrapped: 'WBNB' };
        case 137:
            return { native: 'POL', wrapped: 'WPOL' };
        case 43114:
            return { native: 'AVAX', wrapped: 'WAVAX' };
        case 100:
            return { native: 'xDAI', wrapped: 'WXDAI' };
        case 146:
            return { native: 'S', wrapped: 'wS' };
        default:
            return { native: 'ETH', wrapped: 'WETH' };
    }
};
