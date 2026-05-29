import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    RefreshCw,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, getAddress, parseAbi, parseUnits } from 'viem';
import { ABIS } from '../constants/abis';
import { getMarketByKey } from '../constants/networks';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useWeb3 } from '../contexts/web3-context';
import {
    clearWalletMarketBalanceCache,
    useWalletMarketBalances,
} from '../hooks/use-wallet-market-balances';
import {
    formatUSD,
    formatHF,
    formatCompactNumber,
    formatAPY,
} from '../utils/formatters';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { CompactAmountInput } from './compact-amount-input';
import { InfoTooltip } from './info-tooltip';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';

interface SupplyModalProps {
    isOpen: boolean;
    onClose: () => void;
    marketKey: string | null;
    chainId: number;
    marketAssets: any[];
    walletAddress: string;
    summary: any;
    onSuccess?: () => void;
}

const MAX_UINT256 = 2n ** 256n - 1n;
const GAS_TOKEN_RESERVE_MULTIPLIER = 2n;
const FALLBACK_NATIVE_SUPPLY_GAS = 150_000n;

const parseFiniteNumber = (value: any, fallback = 0) => {
    const parsed =
        typeof value === 'string' ? parseFloat(value) : Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
};

const getHealthFactorColor = (hf: number) => {
    if (!Number.isFinite(hf) || hf > 100) {
        return 'text-emerald-500';
    }

    if (hf >= 3) {
        return 'text-emerald-500';
    }

    if (hf >= 1.1) {
        return 'text-amber-500';
    }

    return 'text-red-500';
};

const formatPlainAmount = (value: number, maxFractionDigits = 8) => {
    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }

    return value
        .toLocaleString('en-US', {
            useGrouping: false,
            maximumFractionDigits: maxFractionDigits,
        })
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '');
};

const getTokenAddress = (token: any): string | null => {
    const raw = token?.isNativeSupplyAsset
        ? token?.wrappedUnderlyingAsset
        : token?.underlyingAsset || token?.address;

    if (!raw || typeof raw !== 'string' || !raw.startsWith('0x')) {
        return null;
    }

    try {
        return getAddress(raw);
    } catch {
        return null;
    }
};

const getExplorerTokenUrl = (
    explorer: string | undefined,
    address: string | null,
) => {
    if (!explorer || !address) {
        return undefined;
    }

    return `${explorer.replace(/\/$/, '')}/token/${address}`;
};

const formatContractAddress = (address: string | null) => {
    if (!address) {
        return undefined;
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const SupplyModal: React.FC<SupplyModalProps> = ({
    isOpen,
    onClose,
    marketKey,
    chainId,
    marketAssets,
    walletAddress,
    summary,
    onSuccess,
}) => {
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } =
        useWeb3();
    const { addTransaction } = useTransactionTracker();

    const [selectedToken, setSelectedToken] = useState<any>(null);
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [supplyAmount, setSupplyAmount] = useState<bigint>(0n);
    const [allowance, setAllowance] = useState<bigint>(0n);
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [showTransactionOverview, setShowTransactionOverview] =
        useState(false);
    const [estimatedGasCostUSD, setEstimatedGasCostUSD] = useState<
        number | null
    >(null);
    const [nativeGasReserve, setNativeGasReserve] = useState<bigint>(0n);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    const market = useMemo(
        () => (marketKey ? getMarketByKey(marketKey) : selectedNetwork),
        [marketKey, selectedNetwork],
    );
    const poolAddress = market?.addresses.POOL;
    const gatewayAddress = market?.addresses.WETH_GATEWAY;
    const nativeInfo = useMemo(() => getNativeInfo(chainId), [chainId]);

    const {
        tokens: walletBalanceTokens,
        isLoading: isLoadingWalletBalances,
        refresh: refreshWalletBalances,
    } = useWalletMarketBalances({
        enabled: isOpen,
        walletAddress,
        chainId,
        marketKey,
        marketAssets,
        publicClient,
        nativeInfo,
        gatewayAddress,
    });

    const selectedBalanceEntry = useMemo(() => {
        if (!selectedToken) {
            return null;
        }

        const key = selectedToken.isNativeSupplyAsset
            ? `native:${chainId}`
            : getTokenAddress(selectedToken)?.toLowerCase();

        return (
            walletBalanceTokens.find(
                (entry) => entry.balanceKey.toLowerCase() === key,
            ) || null
        );
    }, [chainId, selectedToken, walletBalanceTokens]);

    const balance = selectedBalanceEntry?.balance || 0n;
    const displaySymbol = selectedToken?.symbol || 'Asset';
    const selectedPrice = parseFiniteNumber(selectedToken?.priceInUSD);
    const isNativeSupply = !!selectedToken?.isNativeSupplyAsset;
    const maxSupplyAmount = useMemo(() => {
        if (!isNativeSupply) {
            return balance;
        }

        if (nativeGasReserve >= balance) {
            return 0n;
        }

        return balance - nativeGasReserve;
    }, [balance, isNativeSupply, nativeGasReserve]);

    const selectorTokens = useMemo(
        () => walletBalanceTokens.map((entry) => entry.token),
        [walletBalanceTokens],
    );

    const resetAmount = useCallback(() => {
        setInputValue('');
        setSupplyAmount(0n);
        setEstimatedGasCostUSD(null);
        setShowTransactionOverview(false);
    }, []);

    const handleSelectToken = useCallback(
        (token: any) => {
            setSelectedToken(token);
            setAllowance(0n);
            setErrorText(null);
            resetAmount();
        },
        [resetAmount],
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (walletBalanceTokens.length === 0) {
            setSelectedToken(null);
            resetAmount();

            return;
        }

        const selectedStillAvailable =
            selectedToken &&
            walletBalanceTokens.some((entry) => {
                if (selectedToken.isNativeSupplyAsset) {
                    return entry.isNative;
                }

                return (
                    getTokenAddress(entry.token)?.toLowerCase() ===
                    getTokenAddress(selectedToken)?.toLowerCase()
                );
            });

        if (!selectedStillAvailable) {
            const nativeToken = walletBalanceTokens.find(
                (entry) => entry.isNative,
            );

            handleSelectToken((nativeToken || walletBalanceTokens[0]).token);
        }
    }, [
        handleSelectToken,
        isOpen,
        resetAmount,
        selectedToken,
        walletBalanceTokens,
    ]);

    useEffect(() => {
        let cancelled = false;

        const fetchAllowance = async () => {
            if (
                !isOpen ||
                !publicClient ||
                !walletAddress ||
                !selectedToken ||
                !poolAddress ||
                isNativeSupply
            ) {
                setAllowance(MAX_UINT256);

                return;
            }

            const tokenAddress = getTokenAddress(selectedToken);

            if (!tokenAddress) {
                return;
            }

            try {
                const userAllowance = (await publicClient.readContract({
                    address: getAddress(tokenAddress),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'allowance',
                    args: [getAddress(walletAddress), getAddress(poolAddress)],
                })) as bigint;

                if (!cancelled) {
                    setAllowance(userAllowance);
                }
            } catch {
                if (!cancelled) {
                    setAllowance(0n);
                }
            }
        };

        void fetchAllowance();

        return () => {
            cancelled = true;
        };
    }, [
        isNativeSupply,
        isOpen,
        poolAddress,
        publicClient,
        selectedToken,
        walletAddress,
    ]);

    const amountAsToken = useMemo(() => {
        if (!selectedToken || supplyAmount === 0n) {
            return 0;
        }

        return parseFiniteNumber(
            formatUnits(supplyAmount, selectedToken.decimals || 18),
        );
    }, [selectedToken, supplyAmount]);

    const secondaryValue = useMemo(() => {
        if (!selectedToken) {
            return '';
        }

        if (isUSDMode) {
            if (supplyAmount === 0n) {
                return `${formatCompactNumber(0)} ${displaySymbol}`;
            }

            return `${formatCompactNumber(formatUnits(supplyAmount, selectedToken.decimals || 18))} ${displaySymbol}`;
        }

        return formatUSD(amountAsToken * selectedPrice);
    }, [
        amountAsToken,
        displaySymbol,
        isUSDMode,
        selectedPrice,
        selectedToken,
        supplyAmount,
    ]);

    const handleAmountChange = useCallback(
        (value: string) => {
            const cleaned = normalizeDecimalInput(value);
            setInputValue(cleaned);
            setErrorText(null);

            if (
                !selectedToken ||
                !cleaned ||
                cleaned === '.' ||
                parseFiniteNumber(cleaned) <= 0
            ) {
                setSupplyAmount(0n);

                return;
            }

            try {
                const decimals = selectedToken.decimals || 18;
                let tokenAmountHuman = cleaned;

                if (isUSDMode) {
                    if (selectedPrice <= 0) {
                        setSupplyAmount(0n);

                        return;
                    }

                    tokenAmountHuman = formatPlainAmount(
                        parseFiniteNumber(cleaned) / selectedPrice,
                        decimals,
                    );
                }

                const parsed = parseUnits(tokenAmountHuman || '0', decimals);

                if (parsed > maxSupplyAmount) {
                    setSupplyAmount(maxSupplyAmount);
                    const maxTokenAmount = parseFiniteNumber(
                        formatUnits(maxSupplyAmount, decimals),
                    );

                    setInputValue(
                        isUSDMode
                            ? formatPlainAmount(
                                  maxTokenAmount * selectedPrice,
                                  2,
                              )
                            : formatUnits(maxSupplyAmount, decimals),
                    );

                    return;
                }

                setSupplyAmount(parsed);
            } catch {
                setSupplyAmount(0n);
            }
        },
        [isUSDMode, maxSupplyAmount, selectedPrice, selectedToken],
    );

    const handlePercentClick = useCallback(
        (percent: number) => {
            if (!selectedToken || maxSupplyAmount === 0n) {
                return;
            }

            const amount = (maxSupplyAmount * BigInt(percent)) / 100n;
            const decimals = selectedToken.decimals || 18;
            const tokenAmount = parseFiniteNumber(
                formatUnits(amount, decimals),
            );

            setSupplyAmount(amount);
            setInputValue(
                isUSDMode
                    ? formatPlainAmount(tokenAmount * selectedPrice, 2)
                    : formatUnits(amount, decimals),
            );
        },
        [isUSDMode, maxSupplyAmount, selectedPrice, selectedToken],
    );

    const handleApplyMax = useCallback(
        () => handlePercentClick(100),
        [handlePercentClick],
    );

    useEffect(() => {
        if (
            !selectedToken ||
            !isNativeSupply ||
            supplyAmount === 0n ||
            supplyAmount <= maxSupplyAmount
        ) {
            return;
        }

        const decimals = selectedToken.decimals || 18;
        const nextAmount = maxSupplyAmount;
        const nextTokenAmount = parseFiniteNumber(
            formatUnits(nextAmount, decimals),
        );

        setSupplyAmount(nextAmount);
        setInputValue(
            isUSDMode
                ? formatPlainAmount(nextTokenAmount * selectedPrice, 2)
                : formatUnits(nextAmount, decimals),
        );
    }, [
        isNativeSupply,
        isUSDMode,
        maxSupplyAmount,
        selectedPrice,
        selectedToken,
        supplyAmount,
    ]);

    const handleToggleUSDMode = useCallback(() => {
        if (!selectedToken) {
            setIsUSDMode((value) => !value);

            return;
        }

        const nextIsUSDMode = !isUSDMode;
        setIsUSDMode(nextIsUSDMode);

        if (supplyAmount === 0n) {
            setInputValue('');

            return;
        }

        const decimals = selectedToken.decimals || 18;
        const tokenAmount = parseFiniteNumber(
            formatUnits(supplyAmount, decimals),
        );

        setInputValue(
            nextIsUSDMode
                ? formatPlainAmount(tokenAmount * selectedPrice, 2)
                : formatUnits(supplyAmount, decimals),
        );
    }, [isUSDMode, selectedPrice, selectedToken, supplyAmount]);

    const simulation = useMemo(() => {
        if (!summary || !selectedToken || supplyAmount === 0n) {
            return null;
        }

        const currentHF = parseFiniteNumber(summary.healthFactor, Infinity);
        const totalCollateral = parseFiniteNumber(summary.totalCollateralUSD);
        const totalDebt = parseFiniteNumber(summary.totalBorrowsUSD);
        let avgLT = parseFiniteNumber(summary.currentLiquidationThreshold);

        if (avgLT > 1) {
            avgLT = avgLT / 10000;
        }

        const addedUSD = amountAsToken * selectedPrice;
        let assetLT = parseFiniteNumber(
            selectedToken.reserveLiquidationThreshold ||
                selectedToken.baseLTVasCollateral,
        );

        if (assetLT > 1) {
            assetLT = assetLT / 10000;
        }

        const isCollateral = assetLT > 0;
        const currentCollateralPower =
            totalDebt > 0 && Number.isFinite(currentHF)
                ? currentHF * totalDebt
                : totalCollateral * avgLT;
        const simulatedCollateralPower =
            currentCollateralPower + (isCollateral ? addedUSD * assetLT : 0);
        const simulatedTotalCollateral = totalCollateral + addedUSD;
        const simulatedHF =
            totalDebt > 0 ? simulatedCollateralPower / totalDebt : Infinity;
        const simulatedLiquidationThreshold =
            simulatedTotalCollateral > 0
                ? simulatedCollateralPower / simulatedTotalCollateral
                : avgLT;

        return {
            currentHF,
            simulatedHF,
            currentCollateralPower,
            simulatedCollateralPower,
            currentLiquidationThreshold: avgLT,
            simulatedLiquidationThreshold,
            isCollateral,
        };
    }, [amountAsToken, selectedPrice, selectedToken, summary, supplyAmount]);

    const isWrongNetwork = selectedNetwork?.chainId !== chainId;
    const isApproveRequired =
        !!selectedToken && !isNativeSupply && allowance < supplyAmount;
    const isAmountInvalid =
        supplyAmount === 0n || supplyAmount > maxSupplyAmount;
    const isTransactionOverviewReady = !!selectedToken && supplyAmount > 0n;

    useEffect(() => {
        let cancelled = false;

        const estimateNetworkCost = async () => {
            if (
                !publicClient ||
                !walletAddress ||
                !selectedToken ||
                !poolAddress ||
                (!isNativeSupply && supplyAmount === 0n)
            ) {
                setEstimatedGasCostUSD(null);
                setNativeGasReserve(0n);

                return;
            }

            const tokenAddress = getTokenAddress(selectedToken);

            if (!tokenAddress) {
                setEstimatedGasCostUSD(null);

                return;
            }

            try {
                const account = getAddress(walletAddress);
                let gas = 0n;

                if (isApproveRequired) {
                    gas += await publicClient.estimateContractGas({
                        account,
                        address: getAddress(tokenAddress),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'approve',
                        args: [getAddress(poolAddress), MAX_UINT256],
                    });
                }

                if (isNativeSupply) {
                    if (!gatewayAddress) {
                        throw new Error('WETH Gateway address missing');
                    }

                    const estimateValue =
                        supplyAmount > 0n
                            ? supplyAmount
                            : balance > 1n
                              ? 1n
                              : balance;

                    if (estimateValue === 0n) {
                        setNativeGasReserve(0n);
                        setEstimatedGasCostUSD(null);

                        return;
                    }

                    gas += await publicClient.estimateContractGas({
                        account,
                        address: getAddress(gatewayAddress),
                        abi: parseAbi(ABIS.WETH_GATEWAY),
                        functionName: 'depositETH',
                        args: [getAddress(poolAddress), account, 0],
                        value: estimateValue,
                    });
                } else {
                    gas += await publicClient.estimateContractGas({
                        account,
                        address: getAddress(poolAddress),
                        abi: parseAbi(ABIS.POOL),
                        functionName: 'supply',
                        args: [
                            getAddress(tokenAddress),
                            supplyAmount,
                            account,
                            0,
                        ],
                    });
                }

                const gasPrice = await publicClient.getGasPrice();
                const nativeGasAmount = Number(gas * gasPrice) / 1e18;
                const nativePrice = parseFiniteNumber(
                    marketAssets.find(
                        (token) =>
                            String(token.symbol || '').toUpperCase() ===
                            nativeInfo.wrapped.toUpperCase(),
                    )?.priceInUSD ??
                        marketAssets.find(
                            (token) =>
                                String(token.symbol || '').toUpperCase() ===
                                'WETH',
                        )?.priceInUSD,
                );

                if (!cancelled) {
                    setNativeGasReserve(
                        isNativeSupply
                            ? gas * gasPrice * GAS_TOKEN_RESERVE_MULTIPLIER
                            : 0n,
                    );
                    setEstimatedGasCostUSD(
                        supplyAmount > 0n && nativePrice > 0
                            ? nativeGasAmount * nativePrice
                            : null,
                    );
                }
            } catch {
                if (!cancelled) {
                    if (isNativeSupply && publicClient) {
                        try {
                            const fallbackGasPrice =
                                await publicClient.getGasPrice();

                            if (!cancelled) {
                                setNativeGasReserve(
                                    FALLBACK_NATIVE_SUPPLY_GAS *
                                        fallbackGasPrice *
                                        GAS_TOKEN_RESERVE_MULTIPLIER,
                                );
                            }
                        } catch {
                            setNativeGasReserve(0n);
                        }
                    } else {
                        setNativeGasReserve(0n);
                    }

                    setEstimatedGasCostUSD(null);
                }
            }
        };

        void estimateNetworkCost();

        return () => {
            cancelled = true;
        };
    }, [
        gatewayAddress,
        isApproveRequired,
        isNativeSupply,
        marketAssets,
        nativeInfo.wrapped,
        poolAddress,
        publicClient,
        selectedToken,
        supplyAmount,
        walletAddress,
        balance,
    ]);

    const walletBalanceAfterSupply = useMemo(() => {
        if (!selectedToken) {
            return null;
        }

        const remaining = balance > supplyAmount ? balance - supplyAmount : 0n;

        return formatCompactNumber(
            formatUnits(remaining, selectedToken.decimals || 18),
        );
    }, [balance, selectedToken, supplyAmount]);

    const gasReserveTooltip = useMemo(() => {
        if (!selectedToken || !isNativeSupply || nativeGasReserve <= 0n) {
            return 'Your estimated wallet balance after this supply is completed.';
        }

        const reserve = nativeGasReserve > balance ? balance : nativeGasReserve;
        const formattedReserve = `${formatCompactNumber(formatUnits(reserve, selectedToken.decimals || 18))} ${displaySymbol}`;

        return `Your estimated wallet balance after this supply. MAX keeps about ${formattedReserve} reserved for network costs.`;
    }, [
        balance,
        displaySymbol,
        isNativeSupply,
        nativeGasReserve,
        selectedToken,
    ]);

    const renderSelectorStatus = useCallback(
        (token: any) => {
            const key = token.isNativeSupplyAsset
                ? `native:${chainId}`
                : getTokenAddress(token)?.toLowerCase();
            const entry = walletBalanceTokens.find(
                (item) => item.balanceKey.toLowerCase() === key,
            );
            const address = token.isNativeSupplyAsset
                ? null
                : getTokenAddress(token);

            return {
                disabled: !entry || entry.balance <= 0n,
                reasons:
                    !entry || entry.balance <= 0n ? ['No wallet balance'] : [],
                amount: entry
                    ? formatCompactNumber(entry.formatted)
                    : undefined,
                amountRaw: entry ? entry.usdValue : 0,
                amountUSD: entry ? formatUSD(entry.usdValue) : undefined,
                contractAddress: token.isNativeSupplyAsset
                    ? undefined
                    : formatContractAddress(address),
                contractUrl: token.isNativeSupplyAsset
                    ? undefined
                    : getExplorerTokenUrl(market?.explorer, address),
                hideRate: true,
            };
        },
        [chainId, market?.explorer, walletBalanceTokens],
    );

    const handleSwitchChain = async () => {
        if (!market) {
            return;
        }

        setIsLoading(true);

        try {
            await setSelectedNetwork(market.key);
        } finally {
            setIsLoading(false);
        }
    };

    const executeSupply = useCallback(
        async (token: any, amount: bigint) => {
            if (!walletClient || !poolAddress || amount === 0n) {
                return;
            }

            const tokenAddress = getTokenAddress(token);

            if (!tokenAddress) {
                throw new Error('Token address missing');
            }

            let txHash: `0x${string}`;
            const account = getAddress(walletAddress);

            if (token.isNativeSupplyAsset) {
                if (!gatewayAddress) {
                    throw new Error('WETH Gateway address missing');
                }

                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(gatewayAddress),
                    abi: parseAbi(ABIS.WETH_GATEWAY),
                    functionName: 'depositETH',
                    args: [getAddress(poolAddress), account, 0],
                    value: amount,
                });
            } else {
                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'supply',
                    args: [getAddress(tokenAddress), amount, account, 0],
                });
            }

            addTransaction({
                hash: txHash,
                chainId,
                description: `Supply ${formatUnits(amount, token.decimals || 18)} ${token.symbol}`,
                marketKey: marketKey || selectedNetwork.key,
            });

            setIsSuccess(true);
            clearWalletMarketBalanceCache(walletAddress, chainId, marketKey);
            onSuccess?.();
            setTimeout(() => {
                onClose();
                setIsSuccess(false);
                resetAmount();
            }, 2000);
        },
        [
            addTransaction,
            chainId,
            gatewayAddress,
            marketKey,
            onClose,
            onSuccess,
            poolAddress,
            resetAmount,
            selectedNetwork.key,
            walletAddress,
            walletClient,
        ],
    );

    const handleApproveAndSupply = async () => {
        if (
            !walletClient ||
            !selectedToken ||
            !poolAddress ||
            isAmountInvalid
        ) {
            return;
        }

        const lockedToken = selectedToken;
        const lockedAmount = supplyAmount;
        const tokenAddress = getTokenAddress(lockedToken);

        if (!tokenAddress) {
            return;
        }

        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();

            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            if (!lockedToken.isNativeSupplyAsset && allowance < lockedAmount) {
                const approveHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(tokenAddress),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'approve',
                    args: [getAddress(poolAddress), MAX_UINT256],
                });

                addTransaction({
                    hash: approveHash,
                    chainId,
                    description: `Approve ${lockedToken.symbol} for Aave Pool`,
                    marketKey: marketKey || selectedNetwork.key,
                });

                if (publicClient) {
                    await publicClient.waitForTransactionReceipt({
                        hash: approveHash,
                    });
                }

                setAllowance(MAX_UINT256);
            }

            await executeSupply(lockedToken, lockedAmount);
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Supply failed');
        } finally {
            setIsLoading(false);
        }
    };

    const actionLabel = useMemo(() => {
        if (walletBalanceTokens.length === 0) {
            return 'No supported wallet balance';
        }

        if (isNativeSupply && maxSupplyAmount === 0n) {
            return 'Insufficient gas reserve';
        }

        if (supplyAmount === 0n) {
            return 'Enter an amount';
        }

        if (isApproveRequired) {
            return 'Approve & Supply';
        }

        return `Supply ${displaySymbol}`;
    }, [
        displaySymbol,
        isApproveRequired,
        isNativeSupply,
        maxSupplyAmount,
        supplyAmount,
        walletBalanceTokens.length,
    ]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={selectedToken ? `Supply ${displaySymbol}` : 'Supply Assets'}
            maxWidth="520px"
            headerBorder={false}
        >
            <div className="space-y-3 p-4">
                {isSuccess ? (
                    <div className="flex animate-in flex-col items-center justify-center py-10 text-center duration-200 zoom-in-95">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                            Transaction Broadcasted
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                            Your supply request is processing on-chain.
                        </p>
                    </div>
                ) : (
                    <>
                        {walletBalanceTokens.length === 0 &&
                        !isLoadingWalletBalances ? (
                            <div className="space-y-3">
                                <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:border-slate-800/70 dark:bg-slate-900/30 dark:text-slate-400">
                                    No supported wallet balance found for this
                                    market.
                                </div>
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void refreshWalletBalances(true)
                                        }
                                        disabled={isLoadingWalletBalances}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50 dark:hover:text-slate-300"
                                    >
                                        <RefreshCw
                                            className={`h-3 w-3 ${isLoadingWalletBalances ? 'animate-spin' : ''}`}
                                        />
                                        Update balances
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <CompactAmountInput
                                    token={selectedToken}
                                    value={inputValue}
                                    isUSDMode={isUSDMode}
                                    onToggleUSDMode={handleToggleUSDMode}
                                    onChange={(val) =>
                                        handleAmountChange(
                                            normalizeDecimalInput(val),
                                        )
                                    }
                                    onApplyMax={handleApplyMax}
                                    onApplyPct={handlePercentClick}
                                    maxAmount={maxSupplyAmount}
                                    decimals={
                                        isUSDMode
                                            ? 2
                                            : selectedToken?.decimals || 18
                                    }
                                    formattedBalance={
                                        selectedBalanceEntry?.formatted || '0'
                                    }
                                    onTokenSelect={() =>
                                        setTokenSelectorOpen(true)
                                    }
                                    secondaryValue={secondaryValue}
                                    displaySymbol={displaySymbol}
                                    disabled={isLoading || !selectedToken}
                                    isError={supplyAmount > maxSupplyAmount}
                                    isLoading={
                                        isLoadingWalletBalances &&
                                        !selectedToken
                                    }
                                    loadingLabel="Loading balances..."
                                />
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void refreshWalletBalances(true)
                                        }
                                        disabled={isLoadingWalletBalances}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50 dark:hover:text-slate-300"
                                    >
                                        <RefreshCw
                                            className={`h-3 w-3 ${isLoadingWalletBalances ? 'animate-spin' : ''}`}
                                        />
                                        Update balances
                                    </button>
                                </div>
                            </div>
                        )}

                        {isTransactionOverviewReady && selectedToken && (
                            <div className="mt-1 mb-1">
                                <div className="mb-0.5 px-1 text-sm font-bold text-slate-600 dark:text-slate-400">
                                    Transaction overview
                                </div>
                                <div className="transition-all">
                                    <button
                                        onClick={() =>
                                            setShowTransactionOverview(
                                                !showTransactionOverview,
                                            )
                                        }
                                        className="flex w-full items-center justify-between px-1 py-1 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                                Costs & Fees
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                                            <span className="font-medium">
                                                {estimatedGasCostUSD != null
                                                    ? formatUSD(
                                                          estimatedGasCostUSD,
                                                      )
                                                    : '--'}
                                            </span>
                                            {showTransactionOverview ? (
                                                <ChevronUp className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}
                                        </div>
                                    </button>

                                    {showTransactionOverview && (
                                        <div className="relative ml-4 space-y-3 border-l border-dashed border-slate-300 pt-2 pr-3 pb-1 pl-4 text-xs dark:border-slate-700/50">
                                            <div className="group flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 text-slate-500">
                                                    <span>Network costs</span>
                                                    <InfoTooltip
                                                        content="Estimated network gas cost."
                                                        size={12}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                                    <span>
                                                        {estimatedGasCostUSD !=
                                                        null
                                                            ? formatUSD(
                                                                  estimatedGasCostUSD,
                                                              )
                                                            : '--'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2 px-1 pt-1 pb-1">
                                        {walletBalanceAfterSupply && (
                                            <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                                <div className="flex items-center gap-1.5">
                                                    <span>
                                                        Wallet balance after
                                                        supply
                                                    </span>
                                                    <InfoTooltip
                                                        content={
                                                            gasReserveTooltip
                                                        }
                                                        size={12}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-end gap-1 text-right font-medium">
                                                    <span className="h-3.5 w-3.5 overflow-hidden rounded-full">
                                                        <img
                                                            src={getTokenLogo(
                                                                displaySymbol,
                                                            )}
                                                            alt={displaySymbol}
                                                            className="h-full w-full object-cover"
                                                            onError={onTokenImgError(
                                                                displaySymbol,
                                                            )}
                                                        />
                                                    </span>
                                                    <span className="text-slate-900 dark:text-slate-100">
                                                        {
                                                            walletBalanceAfterSupply
                                                        }{' '}
                                                        {displaySymbol}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>Supply APY</span>
                                                <InfoTooltip
                                                    content="Annual yield on deposited assets."
                                                    size={12}
                                                />
                                            </div>
                                            <div className="text-right font-medium">
                                                <span className="text-slate-900 dark:text-slate-100">
                                                    {formatAPY(
                                                        (selectedToken.supplyAPY ??
                                                            0) * 100,
                                                    )}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>Health factor</span>
                                                <InfoTooltip
                                                    content="Safety of your collateral against your debt."
                                                    size={12}
                                                />
                                            </div>
                                            <div className="text-right font-medium">
                                                <div className="flex items-center gap-1.5 font-bold">
                                                    <span>
                                                        {formatHF(
                                                            summary?.healthFactor,
                                                        )}
                                                    </span>
                                                    {simulation && (
                                                        <>
                                                            <span className="font-normal text-slate-400">
                                                                -&gt;
                                                            </span>
                                                            <InfoTooltip
                                                                content="Liquidation < 1.0"
                                                                size={12}
                                                            >
                                                                <span
                                                                    className={`${getHealthFactorColor(simulation.simulatedHF)} font-bold`}
                                                                >
                                                                    {formatHF(
                                                                        simulation.simulatedHF,
                                                                    )}
                                                                </span>
                                                            </InfoTooltip>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {simulation && (
                                            <>
                                                <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>
                                                            Collateral power
                                                        </span>
                                                        <InfoTooltip
                                                            content="Total value of collateral considered for collateralization."
                                                            size={12}
                                                        />
                                                    </div>
                                                    <div className="text-right font-medium">
                                                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                            <span>
                                                                {formatUSD(
                                                                    simulation.currentCollateralPower,
                                                                )}
                                                            </span>
                                                            <span className="font-normal text-slate-400">
                                                                -&gt;
                                                            </span>
                                                            <span
                                                                className={
                                                                    simulation.simulatedCollateralPower >
                                                                    simulation.currentCollateralPower
                                                                        ? 'font-bold text-emerald-500'
                                                                        : 'text-slate-900 dark:text-slate-100'
                                                                }
                                                            >
                                                                {formatUSD(
                                                                    simulation.simulatedCollateralPower,
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>
                                                            Liquidation
                                                            threshold
                                                        </span>
                                                        <InfoTooltip
                                                            content="The weighted average of your collateral liquidation thresholds."
                                                            size={12}
                                                        />
                                                    </div>
                                                    <div className="text-right font-medium">
                                                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                            <span>
                                                                {Math.round(
                                                                    simulation.currentLiquidationThreshold *
                                                                        100,
                                                                )}
                                                                %
                                                            </span>
                                                            <span className="font-normal text-slate-400">
                                                                -&gt;
                                                            </span>
                                                            <span
                                                                className={
                                                                    simulation.simulatedLiquidationThreshold >
                                                                    simulation.currentLiquidationThreshold
                                                                        ? 'font-bold text-emerald-500'
                                                                        : 'text-slate-900 dark:text-slate-100'
                                                                }
                                                            >
                                                                {Math.round(
                                                                    simulation.simulatedLiquidationThreshold *
                                                                        100,
                                                                )}
                                                                %
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {errorText && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/30 dark:bg-red-950/20">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                                    {errorText}
                                </p>
                            </div>
                        )}

                        <div className="pt-3">
                            {isWrongNetwork ? (
                                <Button
                                    onClick={handleSwitchChain}
                                    disabled={isLoading}
                                    className="h-auto w-full rounded-xl bg-amber-500 py-3 font-bold text-white hover:bg-amber-600"
                                >
                                    {isLoading ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : null}
                                    Switch Network to{' '}
                                    {market?.shortLabel || 'Market Chain'}
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleApproveAndSupply}
                                    disabled={
                                        isLoading ||
                                        isAmountInvalid ||
                                        walletBalanceTokens.length === 0 ||
                                        !selectedToken
                                    }
                                    className="h-auto w-full rounded-xl bg-linear-to-r from-purple-600 to-blue-600 py-3 font-bold text-white disabled:opacity-60"
                                >
                                    {isLoading ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : null}
                                    {actionLabel}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>

            <TokenSelector
                isOpen={tokenSelectorOpen}
                onClose={() => setTokenSelectorOpen(false)}
                onSelect={handleSelectToken}
                tokens={selectorTokens}
                title="Select Asset to Supply"
                description="Choose a supported token with wallet balance"
                searchPlaceholder="Search token..."
                isLoading={isLoadingWalletBalances}
                renderStatus={renderSelectorStatus}
                rateField="supplyAPY"
                sortByAmount={true}
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
            return { native: 'POL', wrapped: 'WMATIC' };
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
