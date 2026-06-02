import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    RefreshCw,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, getAddress, parseAbi, parseUnits } from 'viem';
import { usePublicClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { getMarketByKey } from '../constants/networks';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { useWeb3 } from '../contexts/web3-context';
import {
    formatAPY,
    formatCompactNumber,
    formatHF,
    formatUSD,
} from '../utils/formatters';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { CompactAmountInput } from './compact-amount-input';
import { InfoTooltip } from './info-tooltip';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';

interface RepayModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialAsset: any | null;
    marketKey: string | null;
    chainId: number;
    marketAssets: any[];
    walletAddress: string;
    summary: any;
    supplies?: any[];
    borrows?: any[];
    onSuccess?: () => void;
}

const MAX_UINT256 = 2n ** 256n - 1n;
const GAS_TOKEN_RESERVE_MULTIPLIER = 2n;
const FALLBACK_NATIVE_REPAY_GAS = 180_000n;
const APPROVAL_GAS_LIMIT = 150_000n;
const REPAY_GAS_LIMIT = 300_000n;
const REPAY_WITH_ATOKENS_GAS_LIMIT = 250_000n;
const NATIVE_REPAY_GAS_LIMIT = 300_000n;
const RISK_HEALTH_FACTOR_THRESHOLD = 1.5;
type RepaySourceType = 'wallet' | 'atoken';
const aTokenMetadataCache = new Map<string, { symbol: string; name: string }>();

const parseFiniteNumber = (value: any, fallback = 0) => {
    const parsed =
        typeof value === 'string' ? parseFloat(value) : Number(value);

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

const getAssetAddress = (asset: any): string | null => {
    const raw = asset?.underlyingAsset || asset?.address;

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

export const RepayModal: React.FC<RepayModalProps> = ({
    isOpen,
    onClose,
    initialAsset,
    marketKey,
    chainId,
    marketAssets,
    walletAddress,
    summary,
    supplies = [],
    borrows = [],
    onSuccess,
}) => {
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } =
        useWeb3();
    const marketPublicClient = usePublicClient({ chainId });
    const readClient = marketPublicClient || publicClient;
    const { addTransaction } = useTransactionTracker();

    const [selectedDebt, setSelectedDebt] = useState<any | null>(null);
    const [debtSelectorOpen, setDebtSelectorOpen] = useState(false);
    const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
    const [selectedRepaySource, setSelectedRepaySource] =
        useState<RepaySourceType>('wallet');
    const [inputValue, setInputValue] = useState('');
    const [repayAmount, setRepayAmount] = useState<bigint>(0n);
    const [debtBalance, setDebtBalance] = useState<bigint>(0n);
    const [walletBalance, setWalletBalance] = useState<bigint>(0n);
    const [aTokenBalance, setATokenBalance] = useState<bigint>(0n);
    const [aTokenMetadata, setATokenMetadata] = useState<{
        symbol: string;
        name: string;
    } | null>(null);
    const [allowance, setAllowance] = useState<bigint>(0n);
    const [nativeGasReserve, setNativeGasReserve] = useState<bigint>(0n);
    const [estimatedGasCostUSD, setEstimatedGasCostUSD] = useState<
        number | null
    >(null);
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [showTransactionOverview, setShowTransactionOverview] =
        useState(false);
    const [repayNativeForWrapped, setRepayNativeForWrapped] = useState(true);
    const [isBalancesLoading, setIsBalancesLoading] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [riskAccepted, setRiskAccepted] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    const market = useMemo(
        () => (marketKey ? getMarketByKey(marketKey) : selectedNetwork),
        [marketKey, selectedNetwork],
    );
    const poolAddress = market?.addresses.POOL;
    const gatewayAddress = market?.addresses.WETH_GATEWAY;
    const nativeInfo = useMemo(() => getNativeInfo(chainId), [chainId]);
    const activeTab = selectedRepaySource;

    const enrichDebtAsset = useCallback(
        (asset: any | null) => {
            if (!asset) {
                return null;
            }

            const assetAddress = getAssetAddress(asset)?.toLowerCase();
            const marketAsset = (marketAssets || []).find(
                (candidate) =>
                    getAssetAddress(candidate)?.toLowerCase() === assetAddress,
            );

            return {
                ...(marketAsset || {}),
                ...asset,
                name: asset.name ?? marketAsset?.name,
                variableBorrowRate:
                    asset.variableBorrowRate ??
                    asset.borrowRate ??
                    marketAsset?.variableBorrowRate,
                borrowRate:
                    asset.borrowRate ??
                    asset.variableBorrowRate ??
                    marketAsset?.variableBorrowRate,
                reserveLiquidationThreshold:
                    asset.reserveLiquidationThreshold ??
                    marketAsset?.reserveLiquidationThreshold,
                baseLTVasCollateral:
                    asset.baseLTVasCollateral ?? marketAsset?.baseLTVasCollateral,
                aTokenAddress: asset.aTokenAddress ?? marketAsset?.aTokenAddress,
            };
        },
        [marketAssets],
    );

    const selectableDebts = useMemo(() => {
        const source = initialAsset ? [initialAsset, ...borrows] : borrows;
        const seen = new Set<string>();

        return source
            .map(enrichDebtAsset)
            .filter((debt) => {
                const address = getAssetAddress(debt)?.toLowerCase();

                if (!debt || !address || seen.has(address)) {
                    return false;
                }

                seen.add(address);

                try {
                    return BigInt(debt.amount || 0) > 0n;
                } catch {
                    return parseFiniteNumber(debt.formattedAmount) > 0;
                }
            })
            .sort((a, b) => {
                const valueA =
                    parseFiniteNumber(a.formattedAmount) *
                    parseFiniteNumber(a.priceInUSD);
                const valueB =
                    parseFiniteNumber(b.formattedAmount) *
                    parseFiniteNumber(b.priceInUSD);

                return valueB - valueA;
            });
    }, [borrows, enrichDebtAsset, initialAsset]);

    const selectedDebtAddress = getAssetAddress(selectedDebt);
    const selectedDebtPrice = parseFiniteNumber(selectedDebt?.priceInUSD);
    const isWrappedNativeDebt =
        !!selectedDebt &&
        String(selectedDebt.symbol || '').toUpperCase() ===
        nativeInfo.wrapped.toUpperCase();
    const isNativeRepay =
        activeTab === 'wallet' && isWrappedNativeDebt && repayNativeForWrapped;
    const sourceDisplaySymbol =
        activeTab === 'atoken'
            ? aTokenMetadata?.symbol || selectedDebt?.symbol || 'Asset'
            : isNativeRepay
                ? nativeInfo.native
                : selectedDebt?.symbol || 'Asset';
    const debtDisplaySymbol = selectedDebt?.symbol || 'Asset';
    const suppliedAsset = useMemo(() => {
        if (!selectedDebtAddress) {
            return null;
        }

        return (
            supplies.find(
                (supply) =>
                    getAssetAddress(supply)?.toLowerCase() ===
                    selectedDebtAddress.toLowerCase(),
            ) || null
        );
    }, [selectedDebtAddress, supplies]);

    const displayToken = useMemo(
        () =>
            selectedDebt
                ? {
                    ...selectedDebt,
                    symbol: sourceDisplaySymbol,
                    name:
                        activeTab === 'atoken'
                            ? aTokenMetadata?.name ||
                            `Aave ${selectedDebt.symbol}`
                            : selectedDebt.name,
                    underlyingAsset:
                        activeTab === 'atoken'
                            ? suppliedAsset?.aTokenAddress ||
                            selectedDebt.underlyingAsset
                            : selectedDebt.underlyingAsset,
                    address:
                        activeTab === 'atoken'
                            ? suppliedAsset?.aTokenAddress ||
                            selectedDebt.address
                            : selectedDebt.address,
                }
                : null,
        [activeTab, aTokenMetadata, selectedDebt, sourceDisplaySymbol, suppliedAsset],
    );

    const suppliedPositionBalance = useMemo(() => {
        if (!selectedDebt || !suppliedAsset) {
            return 0n;
        }

        try {
            if (suppliedAsset.amount != null) {
                return BigInt(suppliedAsset.amount);
            }
        } catch {
            // Fall back to formatted amount below.
        }

        try {
            return parseUnits(
                suppliedAsset.formattedAmount ||
                suppliedAsset.formattedBalance ||
                '0',
                selectedDebt.decimals || 18,
            );
        } catch {
            return 0n;
        }
    }, [selectedDebt, suppliedAsset]);

    const effectiveATokenBalance =
        aTokenBalance > 0n ? aTokenBalance : suppliedPositionBalance;

    const maxRepayAmount = useMemo(() => {
        const sourceBalance =
            activeTab === 'wallet' ? walletBalance : effectiveATokenBalance;
        const availableSource =
            isNativeRepay && sourceBalance > nativeGasReserve
                ? sourceBalance - nativeGasReserve
                : isNativeRepay
                    ? 0n
                    : sourceBalance;

        return availableSource < debtBalance ? availableSource : debtBalance;
    }, [
        activeTab,
        debtBalance,
        effectiveATokenBalance,
        isNativeRepay,
        nativeGasReserve,
        walletBalance,
    ]);

    const sourceBalance =
        activeTab === 'wallet' ? walletBalance : effectiveATokenBalance;
    const isApproveRequired =
        activeTab === 'wallet' &&
        !isNativeRepay &&
        repayAmount > 0n &&
        allowance < repayAmount;
    const isAmountInvalid =
        repayAmount === 0n || repayAmount > maxRepayAmount;

    const resetAmount = useCallback(() => {
        setInputValue('');
        setRepayAmount(0n);
        setEstimatedGasCostUSD(null);
        setShowTransactionOverview(false);
        setRiskAccepted(false);
        setErrorText(null);
    }, []);

    const handleSelectDebt = useCallback(
        (debt: any) => {
            setSelectedDebt(enrichDebtAsset(debt));
            setSelectedRepaySource('wallet');
            setRepayNativeForWrapped(
                String(debt?.symbol || '').toUpperCase() ===
                nativeInfo.wrapped.toUpperCase(),
            );
            setAllowance(0n);
            setATokenMetadata(null);
            resetAmount();
        },
        [enrichDebtAsset, nativeInfo.wrapped, resetAmount],
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const defaultDebt = initialAsset
            ? enrichDebtAsset(initialAsset)
            : selectableDebts[0] || null;

        setSelectedDebt(defaultDebt);
        setSelectedRepaySource('wallet');
        setRepayNativeForWrapped(
            String(defaultDebt?.symbol || '').toUpperCase() ===
            nativeInfo.wrapped.toUpperCase(),
        );
        setAllowance(0n);
        setDebtBalance(0n);
        setWalletBalance(0n);
        setATokenBalance(0n);
        setATokenMetadata(null);
        resetAmount();
    }, [
        enrichDebtAsset,
        initialAsset,
        isOpen,
        nativeInfo.wrapped,
        resetAmount,
        selectableDebts,
    ]);

    const refreshBalances = useCallback(async () => {
        if (!isOpen || !readClient || !walletAddress || !selectedDebt) {
            return;
        }

        const debtAddress = getAssetAddress(selectedDebt);

        if (!debtAddress) {
            return;
        }

        setIsBalancesLoading(true);

        try {
            const account = getAddress(walletAddress);
            const decimals = selectedDebt.decimals || 18;
            const parsedDebt =
                selectedDebt.amount != null
                    ? BigInt(selectedDebt.amount)
                    : parseUnits(
                        selectedDebt.formattedAmount || '0',
                        decimals,
                    );

            setDebtBalance(parsedDebt);

            const aTokenAddress = suppliedAsset?.aTokenAddress
                ? getAddress(suppliedAsset.aTokenAddress)
                : null;
            const cachedATokenMetadata = aTokenAddress
                ? aTokenMetadataCache.get(aTokenAddress.toLowerCase())
                : null;

            if (cachedATokenMetadata) {
                setATokenMetadata(cachedATokenMetadata);
            }

            const [walletBal, aBal, userAllowance, aSymbol, aName] =
                await Promise.all([
                    isNativeRepay
                        ? readClient.getBalance({ address: account })
                        : readClient.readContract({
                            address: getAddress(debtAddress),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'balanceOf',
                            args: [account],
                        }),
                    aTokenAddress
                        ? readClient.readContract({
                            address: aTokenAddress,
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'balanceOf',
                            args: [account],
                        })
                        : Promise.resolve(0n),
                    activeTab === 'wallet' && !isNativeRepay && poolAddress
                        ? readClient.readContract({
                            address: getAddress(debtAddress),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'allowance',
                            args: [account, getAddress(poolAddress)],
                        })
                        : Promise.resolve(MAX_UINT256),
                    aTokenAddress
                        ? readClient
                            .readContract({
                                address: aTokenAddress,
                                abi: parseAbi(ABIS.ERC20),
                                functionName: 'symbol',
                            })
                            .catch(() => null)
                        : Promise.resolve(null),
                    aTokenAddress
                        ? readClient
                            .readContract({
                                address: aTokenAddress,
                                abi: parseAbi(ABIS.ERC20),
                                functionName: 'name',
                            })
                            .catch(() => null)
                        : Promise.resolve(null),
                ]);

            setWalletBalance(walletBal as bigint);
            setATokenBalance(aBal as bigint);
            setAllowance(userAllowance as bigint);

            if (aSymbol) {
                const metadata = {
                    symbol: String(aSymbol),
                    name: String(aName || aSymbol),
                };

                if (aTokenAddress) {
                    aTokenMetadataCache.set(
                        aTokenAddress.toLowerCase(),
                        metadata,
                    );
                }

                setATokenMetadata(metadata);
            } else if (!cachedATokenMetadata) {
                setATokenMetadata(null);
            }
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Failed to load balances');
        } finally {
            setIsBalancesLoading(false);
        }
    }, [
        activeTab,
        isNativeRepay,
        isOpen,
        poolAddress,
        readClient,
        selectedDebt,
        suppliedAsset?.aTokenAddress,
        walletAddress,
    ]);

    useEffect(() => {
        void refreshBalances();
    }, [refreshBalances]);

    const amountAsToken = useMemo(() => {
        if (!selectedDebt || repayAmount === 0n) {
            return 0;
        }

        return parseFiniteNumber(
            formatUnits(repayAmount, selectedDebt.decimals || 18),
        );
    }, [repayAmount, selectedDebt]);

    const secondaryValue = useMemo(() => {
        if (!selectedDebt) {
            return '';
        }

        if (isUSDMode) {
            if (repayAmount === 0n) {
                return `${formatCompactNumber(0)} ${sourceDisplaySymbol}`;
            }

            return `${formatCompactNumber(formatUnits(repayAmount, selectedDebt.decimals || 18))} ${sourceDisplaySymbol}`;
        }

        return formatUSD(amountAsToken * selectedDebtPrice);
    }, [
        amountAsToken,
        isUSDMode,
        repayAmount,
        selectedDebt,
        selectedDebtPrice,
        sourceDisplaySymbol,
    ]);

    const handleAmountChange = useCallback(
        (value: string) => {
            const cleaned = normalizeDecimalInput(value);
            setInputValue(cleaned);
            setErrorText(null);

            if (
                !selectedDebt ||
                !cleaned ||
                cleaned === '.' ||
                parseFiniteNumber(cleaned) <= 0
            ) {
                setRepayAmount(0n);

                return;
            }

            try {
                const decimals = selectedDebt.decimals || 18;
                let tokenAmountHuman = cleaned;

                if (isUSDMode) {
                    if (selectedDebtPrice <= 0) {
                        setRepayAmount(0n);

                        return;
                    }

                    tokenAmountHuman = formatPlainAmount(
                        parseFiniteNumber(cleaned) / selectedDebtPrice,
                        decimals,
                    );
                }

                const parsed = parseUnits(tokenAmountHuman || '0', decimals);

                if (parsed > maxRepayAmount) {
                    const maxTokenAmount = parseFiniteNumber(
                        formatUnits(maxRepayAmount, decimals),
                    );

                    setRepayAmount(maxRepayAmount);
                    setInputValue(
                        isUSDMode
                            ? formatPlainAmount(
                                maxTokenAmount * selectedDebtPrice,
                                2,
                            )
                            : formatUnits(maxRepayAmount, decimals),
                    );

                    return;
                }

                setRepayAmount(parsed);
            } catch {
                setRepayAmount(0n);
            }
        },
        [isUSDMode, maxRepayAmount, selectedDebt, selectedDebtPrice],
    );

    const handlePercentClick = useCallback(
        (percent: number) => {
            if (!selectedDebt || maxRepayAmount === 0n) {
                return;
            }

            const amount = (maxRepayAmount * BigInt(percent)) / 100n;
            const decimals = selectedDebt.decimals || 18;
            const tokenAmount = parseFiniteNumber(
                formatUnits(amount, decimals),
            );

            setRepayAmount(amount);
            setInputValue(
                isUSDMode
                    ? formatPlainAmount(tokenAmount * selectedDebtPrice, 2)
                    : formatUnits(amount, decimals),
            );
        },
        [isUSDMode, maxRepayAmount, selectedDebt, selectedDebtPrice],
    );

    const handleToggleUSDMode = useCallback(() => {
        if (!selectedDebt) {
            setIsUSDMode((value) => !value);

            return;
        }

        const nextUSDMode = !isUSDMode;
        const decimals = selectedDebt.decimals || 18;
        const currentTokenAmount =
            repayAmount > 0n
                ? parseFiniteNumber(formatUnits(repayAmount, decimals))
                : parseFiniteNumber(inputValue);

        setIsUSDMode(nextUSDMode);

        if (!inputValue || inputValue === '.') {
            return;
        }

        if (nextUSDMode) {
            setInputValue(
                selectedDebtPrice > 0
                    ? formatPlainAmount(currentTokenAmount * selectedDebtPrice, 2)
                    : '',
            );
        } else {
            setInputValue(
                selectedDebtPrice > 0
                    ? formatPlainAmount(
                        parseFiniteNumber(inputValue) / selectedDebtPrice,
                        decimals,
                    )
                    : '',
            );
        }
    }, [
        inputValue,
        isUSDMode,
        repayAmount,
        selectedDebt,
        selectedDebtPrice,
    ]);

    const simulation = useMemo(() => {
        if (!summary || !selectedDebt || repayAmount === 0n) {
            return null;
        }

        const currentHF = parseFiniteNumber(summary.healthFactor, Infinity);
        const totalCollateral = parseFiniteNumber(summary.totalCollateralUSD);
        const totalDebt = parseFiniteNumber(summary.totalBorrowsUSD);
        const avgLT = normalizeRatio(summary.currentLiquidationThreshold);
        const repaidUSD = amountAsToken * selectedDebtPrice;
        const currentCollateralPower =
            totalDebt > 0 && Number.isFinite(currentHF)
                ? currentHF * totalDebt
                : totalCollateral * avgLT;

        let simulatedCollateralPower = currentCollateralPower;

        if (activeTab === 'atoken') {
            const assetLT = normalizeRatio(
                selectedDebt.reserveLiquidationThreshold ||
                selectedDebt.baseLTVasCollateral,
            );

            simulatedCollateralPower = Math.max(
                0,
                currentCollateralPower - repaidUSD * assetLT,
            );
        }

        const simulatedDebt = Math.max(0, totalDebt - repaidUSD);
        const simulatedHF =
            simulatedDebt > 0
                ? simulatedCollateralPower / simulatedDebt
                : Infinity;
        const simulatedCollateral = Math.max(0, totalCollateral - (activeTab === 'atoken' ? repaidUSD : 0));
        const simulatedLT =
            simulatedCollateral > 0
                ? simulatedCollateralPower / simulatedCollateral
                : avgLT;

        return {
            currentHF,
            simulatedHF,
            currentCollateralPower,
            simulatedCollateralPower,
            currentLiquidationThreshold: avgLT,
            simulatedLiquidationThreshold: simulatedLT,
            currentDebt: totalDebt,
            simulatedDebt,
        };
    }, [
        activeTab,
        amountAsToken,
        repayAmount,
        selectedDebt,
        selectedDebtPrice,
        summary,
    ]);

    const requiresRiskAcceptance =
        activeTab === 'atoken' &&
        !!simulation &&
        simulation.simulatedDebt > 0 &&
        simulation.simulatedHF < RISK_HEALTH_FACTOR_THRESHOLD;

    useEffect(() => {
        let cancelled = false;

        const estimateNetworkCost = async () => {
            if (!readClient || !walletAddress || !selectedDebt || !poolAddress) {
                setEstimatedGasCostUSD(null);
                setNativeGasReserve(0n);

                return;
            }

            const debtAddress = getAssetAddress(selectedDebt);

            if (!debtAddress) {
                setEstimatedGasCostUSD(null);

                return;
            }

            try {
                const estimateAmount =
                    repayAmount > 0n
                        ? repayAmount
                        : debtBalance > 1n
                            ? 1n
                            : debtBalance;

                if (estimateAmount === 0n) {
                    setEstimatedGasCostUSD(null);
                    setNativeGasReserve(0n);

                    return;
                }

                let gas = 0n;

                if (isApproveRequired) {
                    gas += APPROVAL_GAS_LIMIT;
                }

                if (activeTab === 'atoken') {
                    gas += REPAY_WITH_ATOKENS_GAS_LIMIT;
                } else if (isNativeRepay) {
                    if (!gatewayAddress) {
                        throw new Error('WETH Gateway address missing');
                    }

                    gas += NATIVE_REPAY_GAS_LIMIT;
                } else {
                    gas += REPAY_GAS_LIMIT;
                }

                const gasPrice = await readClient.getGasPrice();
                const nativeGasAmount = Number(gas * gasPrice) / 1e18;
                const nativePrice = parseFiniteNumber(
                    (marketAssets || []).find(
                        (token) =>
                            String(token.symbol || '').toUpperCase() ===
                            nativeInfo.wrapped.toUpperCase(),
                    )?.priceInUSD,
                );

                if (!cancelled) {
                    setNativeGasReserve(
                        isNativeRepay
                            ? gas * gasPrice * GAS_TOKEN_RESERVE_MULTIPLIER
                            : 0n,
                    );
                    setEstimatedGasCostUSD(
                        repayAmount > 0n && nativePrice > 0
                            ? nativeGasAmount * nativePrice
                            : null,
                    );
                }
            } catch {
                if (!cancelled) {
                    if (isNativeRepay && readClient) {
                        try {
                            const fallbackGasPrice =
                                await readClient.getGasPrice();

                            setNativeGasReserve(
                                FALLBACK_NATIVE_REPAY_GAS *
                                fallbackGasPrice *
                                GAS_TOKEN_RESERVE_MULTIPLIER,
                            );
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
        activeTab,
        debtBalance,
        gatewayAddress,
        isApproveRequired,
        isNativeRepay,
        marketAssets,
        nativeInfo.wrapped,
        poolAddress,
        readClient,
        repayAmount,
        selectedDebt,
        walletAddress,
    ]);

    const remainingDebt = useMemo(() => {
        if (!selectedDebt) {
            return '';
        }

        const remaining = debtBalance > repayAmount ? debtBalance - repayAmount : 0n;

        return formatCompactNumber(
            formatUnits(remaining, selectedDebt.decimals || 18),
        );
    }, [debtBalance, repayAmount, selectedDebt]);

    const selectedDebtBalance = useMemo(() => {
        if (!selectedDebt) {
            return '';
        }

        return formatCompactNumber(
            formatUnits(debtBalance, selectedDebt.decimals || 18),
        );
    }, [debtBalance, selectedDebt]);

    const sourceBalanceAfter = useMemo(() => {
        if (!selectedDebt) {
            return '';
        }

        const remaining = sourceBalance > repayAmount ? sourceBalance - repayAmount : 0n;

        return formatCompactNumber(
            formatUnits(remaining, selectedDebt.decimals || 18),
        );
    }, [repayAmount, selectedDebt, sourceBalance]);

    const renderDebtStatus = useCallback(
        (token: any) => {
            const address = getAssetAddress(token);
            const amount =
                token.formattedAmount ||
                (token.amount
                    ? formatUnits(BigInt(token.amount), token.decimals || 18)
                    : '0');
            const usdValue =
                parseFiniteNumber(amount) *
                parseFiniteNumber(token.priceInUSD);

            return {
                disabled: parseFiniteNumber(amount) <= 0,
                reasons:
                    parseFiniteNumber(amount) <= 0 ? ['No active debt'] : [],
                amount: formatCompactNumber(amount),
                amountRaw: usdValue,
                amountUSD: formatUSD(usdValue),
                contractAddress: formatContractAddress(address),
                contractUrl: getExplorerTokenUrl(market?.explorer, address),
            };
        },
        [market?.explorer],
    );

    const repaySourceTokens = useMemo(() => {
        if (!selectedDebt || !selectedDebtAddress) {
            return [];
        }

        const walletSymbol = isNativeRepay
            ? nativeInfo.native
            : selectedDebt.symbol;
        const walletName = isNativeRepay
            ? nativeInfo.native
            : selectedDebt.name;
        const sources: any[] = [
            {
                ...selectedDebt,
                symbol: walletSymbol,
                name: walletName,
                sourceType: 'wallet' satisfies RepaySourceType,
                sourceBalance: walletBalance,
                sourceAddress: selectedDebtAddress,
                logoURI: selectedDebt.logoURI,
            },
        ];

        if (
            suppliedAsset?.aTokenAddress &&
            effectiveATokenBalance > 0n &&
            aTokenMetadata?.symbol
        ) {
            // TODO: add collateral sources through a repay-with-collateral swap adapter.
            sources.push({
                ...selectedDebt,
                symbol: aTokenMetadata.symbol,
                name: aTokenMetadata?.name || `Aave ${selectedDebt.symbol}`,
                sourceType: 'atoken' satisfies RepaySourceType,
                sourceBalance: effectiveATokenBalance,
                sourceAddress: getAddress(suppliedAsset.aTokenAddress),
                underlyingAsset: getAddress(suppliedAsset.aTokenAddress),
                address: getAddress(suppliedAsset.aTokenAddress),
                logoURI: selectedDebt.logoURI,
            });
        }

        return sources;
    }, [
        aTokenMetadata,
        effectiveATokenBalance,
        isNativeRepay,
        nativeInfo.native,
        selectedDebt,
        selectedDebtAddress,
        suppliedAsset?.aTokenAddress,
        walletBalance,
    ]);

    const renderRepaySourceStatus = useCallback(
        (token: any) => {
            const balance = BigInt(token.sourceBalance || 0);
            const formattedBalance = selectedDebt
                ? formatUnits(balance, selectedDebt.decimals || 18)
                : '0';
            const usdValue =
                parseFiniteNumber(formattedBalance) * selectedDebtPrice;
            const address = token.sourceAddress || getAssetAddress(token);

            return {
                disabled: balance <= 0n,
                reasons: balance <= 0n ? ['No balance'] : [],
                amount: formatCompactNumber(formattedBalance),
                amountRaw: usdValue,
                amountUSD: formatUSD(usdValue),
                contractAddress: formatContractAddress(address),
                contractUrl: getExplorerTokenUrl(market?.explorer, address),
            };
        },
        [market?.explorer, selectedDebt, selectedDebtPrice],
    );

    const handleSelectRepaySource = useCallback(
        (source: any) => {
            const nextSource: RepaySourceType =
                source.sourceType === 'atoken' ? 'atoken' : 'wallet';

            setSelectedRepaySource(nextSource);
            setRepayNativeForWrapped(
                nextSource === 'wallet' && isWrappedNativeDebt,
            );
            setAllowance(0n);
            setSourceSelectorOpen(false);
            resetAmount();
        },
        [isWrappedNativeDebt, resetAmount],
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

    const executeRepay = useCallback(
        async (
            debt: any,
            amount: bigint,
            tab: 'wallet' | 'atoken',
            nativeRepay: boolean,
            repayAllWithATokens: boolean,
        ) => {
            if (!walletClient || !poolAddress || amount === 0n) {
                return;
            }

            const debtAddress = getAssetAddress(debt);

            if (!debtAddress) {
                throw new Error('Debt asset address missing');
            }

            const account = getAddress(walletAddress);
            let txHash: `0x${string}`;

            if (tab === 'atoken') {
                const contractAmount = repayAllWithATokens
                    ? MAX_UINT256
                    : amount;

                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'repayWithATokens',
                    args: [getAddress(debtAddress), contractAmount, 2n],
                });
            } else if (nativeRepay) {
                if (!gatewayAddress) {
                    throw new Error('WETH Gateway address missing');
                }

                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(gatewayAddress),
                    abi: parseAbi(ABIS.WETH_GATEWAY),
                    functionName: 'repayETH',
                    args: [getAddress(poolAddress), amount, 2n, account],
                    value: amount,
                });
            } else {
                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'repay',
                    args: [getAddress(debtAddress), amount, 2n, account],
                });
            }

            const txSymbol =
                tab === 'wallet' &&
                    nativeRepay &&
                    String(debt.symbol || '').toUpperCase() ===
                    nativeInfo.wrapped.toUpperCase()
                    ? nativeInfo.native
                    : debt.symbol;

            addTransaction({
                hash: txHash,
                chainId,
                description:
                    tab === 'atoken'
                        ? `Repay with aTokens: ${formatUnits(amount, debt.decimals || 18)} ${debt.symbol}`
                        : `Repay ${formatUnits(amount, debt.decimals || 18)} ${txSymbol}`,
                marketKey: marketKey || selectedNetwork.key,
            });

            setIsSuccess(true);
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
            nativeInfo.native,
            nativeInfo.wrapped,
            onClose,
            onSuccess,
            poolAddress,
            resetAmount,
            selectedNetwork.key,
            walletAddress,
            walletClient,
        ],
    );

    const handleApproveAndRepay = async () => {
        if (
            !walletClient ||
            !selectedDebt ||
            !poolAddress ||
            isAmountInvalid ||
            (requiresRiskAcceptance && !riskAccepted)
        ) {
            return;
        }

        const lockedDebt = selectedDebt;
        const lockedAmount = repayAmount;
        const lockedTab = activeTab;
        const lockedNativeRepay = isNativeRepay;
        const lockedRepayAllWithATokens =
            lockedTab === 'atoken' &&
            debtBalance > 0n &&
            lockedAmount >= debtBalance;
        const debtAddress = getAssetAddress(lockedDebt);

        if (!debtAddress) {
            return;
        }

        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();

            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            if (
                lockedTab === 'wallet' &&
                !lockedNativeRepay &&
                allowance < lockedAmount
            ) {
                const approveHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(debtAddress),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'approve',
                    args: [getAddress(poolAddress), MAX_UINT256],
                });

                addTransaction({
                    hash: approveHash,
                    chainId,
                    description: `Approve ${lockedDebt.symbol} for Aave Pool`,
                    marketKey: marketKey || selectedNetwork.key,
                    suppressPositionRefresh: true,
                });

                if (readClient) {
                    await readClient.waitForTransactionReceipt({
                        hash: approveHash,
                    });
                }

                setAllowance(MAX_UINT256);
            }

            await executeRepay(
                lockedDebt,
                lockedAmount,
                lockedTab,
                lockedNativeRepay,
                lockedRepayAllWithATokens,
            );
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Repay failed');
        } finally {
            setIsLoading(false);
        }
    };

    const isWrongNetwork = selectedNetwork?.chainId !== chainId;
    const modalTitle = selectedDebt
        ? `Repay ${selectedDebt.symbol}`
        : `Repay debt on ${market?.shortLabel || market?.label || 'Market'}`;
    const actionLabel = useMemo(() => {
        if (!selectedDebt) {
            return 'No active debt';
        }

        if (isBalancesLoading) {
            return 'Loading balances...';
        }

        if (isNativeRepay && maxRepayAmount === 0n) {
            return 'Insufficient gas reserve';
        }

        if (repayAmount === 0n) {
            return 'Enter an amount';
        }

        if (requiresRiskAcceptance && !riskAccepted) {
            return 'Accept risk to continue';
        }

        if (isApproveRequired) {
            return 'Approve & Repay';
        }

        return activeTab === 'atoken'
            ? 'Repay with aTokens'
            : `Repay ${debtDisplaySymbol}`;
    }, [
        activeTab,
        debtDisplaySymbol,
        isApproveRequired,
        isBalancesLoading,
        isNativeRepay,
        maxRepayAmount,
        repayAmount,
        requiresRiskAcceptance,
        riskAccepted,
        selectedDebt,
    ]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={modalTitle}
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
                            Your repay request is processing on-chain.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Source selection mirrors Aave: wallet balance and matching aToken are token choices, not modal tabs. */}
                        {/* TODO: add repay-with-collateral as another source after exact-output swap support is implemented. */}
                        {selectedDebt && (
                            <button
                                type="button"
                                onClick={() => setDebtSelectorOpen(true)}
                                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/60 bg-slate-100/70 px-3 py-3 text-left transition-colors hover:border-blue-400/30 hover:bg-slate-100 dark:border-slate-700/50 dark:bg-slate-800/45 dark:hover:bg-slate-800/70"
                            >
                                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Debt to repay
                                </span>
                                <span className="flex min-w-0 items-center justify-end gap-2">
                                    <span className="flex min-w-0 items-center gap-1.5 text-base font-bold text-slate-800 dark:text-slate-100">
                                        <span className="h-5 w-5 overflow-hidden rounded-full">
                                            <img
                                                src={getTokenLogo(
                                                    selectedDebt.symbol,
                                                )}
                                                alt={selectedDebt.symbol}
                                                className="h-full w-full object-cover"
                                                onError={onTokenImgError(
                                                    selectedDebt.symbol,
                                                )}
                                            />
                                        </span>
                                        <span className="truncate">
                                            {debtDisplaySymbol}
                                        </span>
                                    </span>
                                    <span className="text-sm font-semibold whitespace-nowrap text-slate-600 dark:text-slate-300">
                                        {selectedDebtBalance}{' '}
                                        {debtDisplaySymbol}
                                    </span>
                                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                                </span>
                            </button>
                        )}

                        <div className="space-y-1">
                            <div className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                Repay with
                            </div>
                            <CompactAmountInput
                                token={displayToken}
                                value={inputValue}
                                isUSDMode={isUSDMode}
                                onToggleUSDMode={handleToggleUSDMode}
                                onChange={(val) =>
                                    handleAmountChange(
                                        normalizeDecimalInput(val),
                                    )
                                }
                                onApplyMax={() => handlePercentClick(100)}
                                onApplyPct={handlePercentClick}
                                maxAmount={maxRepayAmount}
                                decimals={
                                    isUSDMode
                                        ? 2
                                        : selectedDebt?.decimals || 18
                                }
                                formattedBalance={formatUnits(
                                    sourceBalance,
                                    selectedDebt?.decimals || 18,
                                )}
                                balanceLabel={
                                    activeTab === 'wallet'
                                        ? 'Balance'
                                        : 'aToken balance'
                                }
                                onTokenSelect={() =>
                                    setSourceSelectorOpen(true)
                                }
                                secondaryValue={secondaryValue}
                                displaySymbol={sourceDisplaySymbol}
                                disabled={isLoading || !selectedDebt}
                                isError={repayAmount > maxRepayAmount}
                                isLoading={isBalancesLoading && !selectedDebt}
                                loadingLabel="Loading balances..."
                            />
                        </div>

                        {activeTab === 'wallet' &&
                            isWrappedNativeDebt &&
                            gatewayAddress && (
                                <div className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                    <Switch
                                        checked={repayNativeForWrapped}
                                        onCheckedChange={(checked) => {
                                            setRepayNativeForWrapped(checked);
                                            resetAmount();
                                        }}
                                    />
                                    <span>
                                        Use {nativeInfo.native} to repay{' '}
                                        {nativeInfo.wrapped}
                                    </span>
                                </div>
                            )}

                        {repayAmount > 0n && selectedDebt && (
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
                                        <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            Costs & Fees
                                        </span>
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
                                                <span className="font-medium text-slate-600 dark:text-slate-300">
                                                    {estimatedGasCostUSD != null
                                                        ? formatUSD(
                                                            estimatedGasCostUSD,
                                                        )
                                                        : '--'}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2 px-1 pt-1 pb-1">
                                        <OverviewRow
                                            label="Remaining debt"
                                            tooltip="Estimated debt balance after this repay."
                                            tokenSymbol={selectedDebt.symbol}
                                            value={`${remainingDebt} ${selectedDebt.symbol}`}
                                        />
                                        <OverviewRow
                                            label={
                                                activeTab === 'wallet'
                                                    ? 'Wallet balance after repay'
                                                    : 'aToken balance after repay'
                                            }
                                            tooltip="Estimated source balance after this repay."
                                            tokenSymbol={sourceDisplaySymbol}
                                            value={`${sourceBalanceAfter} ${sourceDisplaySymbol}`}
                                        />
                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>Health factor</span>
                                                <InfoTooltip
                                                    content="Safety of your collateral against your debt."
                                                    size={12}
                                                />
                                            </div>
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
                                                        <span
                                                            className={`${getHealthFactorColor(simulation.simulatedHF)} font-bold`}
                                                        >
                                                            {formatHF(
                                                                simulation.simulatedHF,
                                                            )}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>Borrow APY</span>
                                                <InfoTooltip
                                                    content="Current variable borrow APY for this debt."
                                                    size={12}
                                                />
                                            </div>
                                            <span className="font-medium text-slate-900 dark:text-slate-100">
                                                {formatAPY(
                                                    (selectedDebt.variableBorrowRate ??
                                                        selectedDebt.borrowRate ??
                                                        0) * 100,
                                                )}
                                            </span>
                                        </div>

                                        {activeTab === 'atoken' &&
                                            simulation && (
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
                                                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                                                            <span>
                                                                {formatUSD(
                                                                    simulation.currentCollateralPower,
                                                                )}
                                                            </span>
                                                            <span className="font-normal text-slate-400">
                                                                -&gt;
                                                            </span>
                                                            <span>
                                                                {formatUSD(
                                                                    simulation.simulatedCollateralPower,
                                                                )}
                                                            </span>
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
                                                            <span>
                                                                {Math.round(
                                                                    simulation.simulatedLiquidationThreshold *
                                                                    100,
                                                                )}
                                                                %
                                                            </span>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {requiresRiskAcceptance && (
                            <div className="space-y-2 px-1 pt-1 text-sm font-semibold text-red-500">
                                <p>
                                    Repaying with aTokens can reduce your Health
                                    Factor and increase liquidation risk.
                                </p>
                                <label className="flex items-center justify-center gap-2 text-xs font-bold">
                                    <Checkbox
                                        checked={riskAccepted}
                                        onCheckedChange={(checked) =>
                                            setRiskAccepted(Boolean(checked))
                                        }
                                    />
                                    I acknowledge the risks involved.
                                </label>
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
                                    onClick={handleApproveAndRepay}
                                    disabled={
                                        isLoading ||
                                        isBalancesLoading ||
                                        isAmountInvalid ||
                                        !selectedDebt ||
                                        (requiresRiskAcceptance &&
                                            !riskAccepted)
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
                isOpen={debtSelectorOpen}
                onClose={() => setDebtSelectorOpen(false)}
                onSelect={handleSelectDebt}
                tokens={selectableDebts}
                title="Select Debt to Repay"
                description="Choose which borrow position to repay"
                searchPlaceholder="Search debt..."
                renderStatus={renderDebtStatus}
                rateField="variableBorrowRate"
                marketAssets={marketAssets}
                sortByAmount={true}
            />

            <TokenSelector
                isOpen={sourceSelectorOpen}
                onClose={() => setSourceSelectorOpen(false)}
                onSelect={handleSelectRepaySource}
                tokens={repaySourceTokens}
                title="Select asset to repay with"
                description="Choose wallet balance or supplied aToken balance"
                searchPlaceholder="Search source..."
                renderStatus={renderRepaySourceStatus}
                rateField="supplyAPY"
                marketAssets={marketAssets}
                sortByAmount={true}
            />
        </Modal>
    );
};

const OverviewRow = ({
    label,
    tooltip,
    tokenSymbol,
    value,
}: {
    label: string;
    tooltip: string;
    tokenSymbol: string;
    value: string;
}) => (
    <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
        <div className="flex items-center gap-1.5">
            <span>{label}</span>
            <InfoTooltip content={tooltip} size={12} />
        </div>
        <div className="flex items-center justify-end gap-1 text-right font-medium">
            <span className="h-3.5 w-3.5 overflow-hidden rounded-full">
                <img
                    src={getTokenLogo(tokenSymbol)}
                    alt={tokenSymbol}
                    className="h-full w-full object-cover"
                    onError={onTokenImgError(tokenSymbol)}
                />
            </span>
            <span className="text-slate-900 dark:text-slate-100">{value}</span>
        </div>
    </div>
);

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
