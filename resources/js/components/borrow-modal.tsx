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
import { Switch } from './ui/switch';

interface BorrowModalProps {
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

const parseFiniteNumber = (value: any, fallback = 0) => {
    const parsed =
        typeof value === 'string' ? parseFloat(value) : Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
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

const getTokenAddress = (token: any): string | null => {
    const raw = token?.isNativeBorrowAsset
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

const floorToUnits = (value: number, decimals: number) => {
    if (!Number.isFinite(value) || value <= 0) {
        return 0n;
    }

    const normalized = formatPlainAmount(value, decimals);

    if (!normalized) {
        return 0n;
    }

    try {
        return parseUnits(normalized, decimals);
    } catch {
        return 0n;
    }
};

export const BorrowModal: React.FC<BorrowModalProps> = ({
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
    const [borrowAmount, setBorrowAmount] = useState<bigint>(0n);
    const [delegationAllowance, setDelegationAllowance] = useState<bigint>(0n);
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [borrowNativeForWrapped, setBorrowNativeForWrapped] = useState(true);
    const [showTransactionOverview, setShowTransactionOverview] =
        useState(false);
    const [estimatedGasCostUSD, setEstimatedGasCostUSD] = useState<
        number | null
    >(null);
    const [riskAccepted, setRiskAccepted] = useState(false);
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

    const nativeWrappedReserve = useMemo(
        () =>
            (marketAssets || []).find(
                (token) =>
                    String(token.symbol || '').toUpperCase() ===
                    nativeInfo.wrapped.toUpperCase(),
            ),
        [marketAssets, nativeInfo.wrapped],
    );

    const availableBorrowUSD = parseFiniteNumber(
        summary?.availableBorrowsUSD,
    );
    const getMaxBorrowAmount = useCallback(
        (token: any) => {
            const price = parseFiniteNumber(token?.priceInUSD);
            const decimals = token?.decimals || 18;

            if (availableBorrowUSD <= 0 || price <= 0) {
                return 0n;
            }

            const maxByBorrowPower = availableBorrowUSD / price;
            const maxByLiquidity = parseFiniteNumber(
                token?.availableLiquidity,
                maxByBorrowPower,
            );
            const borrowCap = parseFiniteNumber(token?.borrowCap);
            const totalDebt = parseFiniteNumber(token?.totalDebt);
            const maxByCap =
                borrowCap > 0
                    ? Math.max(0, borrowCap - totalDebt)
                    : Number.POSITIVE_INFINITY;
            const maxHuman = Math.min(
                maxByBorrowPower,
                maxByLiquidity,
                maxByCap,
            );

            return floorToUnits(maxHuman, decimals);
        },
        [availableBorrowUSD],
    );

    const selectorTokens = useMemo(() => {
        return (marketAssets || [])
            .filter((token) => {
                const isBorrowable =
                    token.isActive &&
                    !token.isFrozen &&
                    !token.isPaused &&
                    token.borrowingEnabled !== false &&
                    token.isBorrowableInCurrentEMode !== false;

                return isBorrowable && getMaxBorrowAmount(token) > 0n;
            })
            .map((token) => {
                const isWrappedNative =
                    !!gatewayAddress &&
                    String(token.symbol || '').toUpperCase() ===
                    nativeInfo.wrapped.toUpperCase();

                if (!isWrappedNative) {
                    return {
                        ...token,
                        isNativeBorrowAsset: false,
                    };
                }

                return {
                    ...token,
                    symbol: nativeInfo.native,
                    name: nativeInfo.native,
                    isNativeBorrowAsset: true,
                    wrappedSymbol: token.symbol,
                    wrappedUnderlyingAsset:
                        token.underlyingAsset || token.address,
                };
            });
    }, [
        gatewayAddress,
        getMaxBorrowAmount,
        marketAssets,
        nativeInfo.native,
        nativeInfo.wrapped,
    ]);

    const isWrappedNativeBorrowOption = !!selectedToken?.isNativeBorrowAsset;
    const isNativeBorrow = isWrappedNativeBorrowOption && borrowNativeForWrapped;
    const displaySymbol =
        isWrappedNativeBorrowOption && !borrowNativeForWrapped
            ? selectedToken?.wrappedSymbol || nativeInfo.wrapped
            : selectedToken?.symbol || 'Asset';
    const displayToken = useMemo(
        () =>
            selectedToken
                ? {
                    ...selectedToken,
                    symbol: displaySymbol,
                }
                : null,
        [displaySymbol, selectedToken],
    );
    const selectedPrice = parseFiniteNumber(selectedToken?.priceInUSD);
    const maxBorrowAmount = useMemo(
        () => (selectedToken ? getMaxBorrowAmount(selectedToken) : 0n),
        [getMaxBorrowAmount, selectedToken],
    );

    const resetAmount = useCallback(() => {
        setInputValue('');
        setBorrowAmount(0n);
        setEstimatedGasCostUSD(null);
        setShowTransactionOverview(false);
        setRiskAccepted(false);
        setErrorText(null);
    }, []);

    const handleSelectToken = useCallback(
        (token: any) => {
            setSelectedToken(token);
            setBorrowNativeForWrapped(!!token?.isNativeBorrowAsset);
            setDelegationAllowance(token?.isNativeBorrowAsset ? 0n : MAX_UINT256);
            resetAmount();
            setTokenSelectorOpen(false);
        },
        [resetAmount],
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (selectorTokens.length === 0) {
            setSelectedToken(null);
            resetAmount();

            return;
        }

        const selectedAddress = getTokenAddress(selectedToken);
        const selectedStillAvailable =
            selectedToken &&
            selectorTokens.some((token) => {
                if (selectedToken.isNativeBorrowAsset) {
                    return token.isNativeBorrowAsset;
                }

                return (
                    !token.isNativeBorrowAsset &&
                    getTokenAddress(token)?.toLowerCase() ===
                    selectedAddress?.toLowerCase()
                );
            });

        if (!selectedStillAvailable) {
            const nativeToken = selectorTokens.find(
                (token) => token.isNativeBorrowAsset,
            );

            handleSelectToken(nativeToken || selectorTokens[0]);
        }
    }, [
        handleSelectToken,
        isOpen,
        resetAmount,
        selectedToken,
        selectorTokens,
    ]);

    useEffect(() => {
        let cancelled = false;

        const fetchDelegationAllowance = async () => {
            if (
                !isOpen ||
                !publicClient ||
                !walletAddress ||
                !selectedToken ||
                !gatewayAddress ||
                !isNativeBorrow
            ) {
                setDelegationAllowance(MAX_UINT256);

                return;
            }

            const debtTokenAddress = selectedToken.variableDebtTokenAddress;

            if (!debtTokenAddress) {
                setDelegationAllowance(0n);

                return;
            }

            try {
                const allowance = (await publicClient.readContract({
                    address: getAddress(debtTokenAddress),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
                    functionName: 'borrowAllowance',
                    args: [getAddress(walletAddress), getAddress(gatewayAddress)],
                })) as bigint;

                if (!cancelled) {
                    setDelegationAllowance(allowance);
                }
            } catch {
                if (!cancelled) {
                    setDelegationAllowance(0n);
                }
            }
        };

        void fetchDelegationAllowance();

        return () => {
            cancelled = true;
        };
    }, [
        gatewayAddress,
        isNativeBorrow,
        isOpen,
        publicClient,
        selectedToken,
        walletAddress,
    ]);

    useEffect(() => {
        if (isNativeBorrow) {
            return;
        }

        setDelegationAllowance(MAX_UINT256);
    }, [isNativeBorrow]);

    const amountAsToken = useMemo(() => {
        if (!selectedToken || borrowAmount === 0n) {
            return 0;
        }

        return parseFiniteNumber(
            formatUnits(borrowAmount, selectedToken.decimals || 18),
        );
    }, [borrowAmount, selectedToken]);

    const amountUSD = amountAsToken * selectedPrice;

    const secondaryValue = useMemo(() => {
        if (!selectedToken) {
            return '';
        }

        if (isUSDMode) {
            if (borrowAmount === 0n) {
                return `${formatCompactNumber(0)} ${displaySymbol}`;
            }

            return `${formatCompactNumber(formatUnits(borrowAmount, selectedToken.decimals || 18))} ${displaySymbol}`;
        }

        return formatUSD(amountUSD);
    }, [
        amountUSD,
        borrowAmount,
        displaySymbol,
        isUSDMode,
        selectedToken,
    ]);

    const handleAmountChange = useCallback(
        (value: string) => {
            const cleaned = normalizeDecimalInput(value);
            setInputValue(cleaned);
            setErrorText(null);
            setRiskAccepted(false);

            if (
                !selectedToken ||
                !cleaned ||
                cleaned === '.' ||
                parseFiniteNumber(cleaned) <= 0
            ) {
                setBorrowAmount(0n);

                return;
            }

            try {
                const decimals = selectedToken.decimals || 18;
                let tokenAmountHuman = cleaned;

                if (isUSDMode) {
                    if (selectedPrice <= 0) {
                        setBorrowAmount(0n);

                        return;
                    }

                    tokenAmountHuman = formatPlainAmount(
                        parseFiniteNumber(cleaned) / selectedPrice,
                        decimals,
                    );
                }

                setBorrowAmount(parseUnits(tokenAmountHuman || '0', decimals));
            } catch {
                setBorrowAmount(0n);
            }
        },
        [isUSDMode, selectedPrice, selectedToken],
    );

    const handlePercentClick = useCallback(
        (percent: number) => {
            if (!selectedToken || maxBorrowAmount === 0n) {
                return;
            }

            const amount = (maxBorrowAmount * BigInt(percent)) / 100n;
            const decimals = selectedToken.decimals || 18;
            const tokenAmount = parseFiniteNumber(
                formatUnits(amount, decimals),
            );

            setBorrowAmount(amount);
            setRiskAccepted(false);
            setInputValue(
                isUSDMode
                    ? formatPlainAmount(tokenAmount * selectedPrice, 2)
                    : formatUnits(amount, decimals),
            );
        },
        [isUSDMode, maxBorrowAmount, selectedPrice, selectedToken],
    );

    const handleApplyMax = useCallback(
        () => handlePercentClick(100),
        [handlePercentClick],
    );

    const handleToggleUSDMode = useCallback(() => {
        if (!selectedToken) {
            setIsUSDMode((value) => !value);

            return;
        }

        const nextIsUSDMode = !isUSDMode;
        setIsUSDMode(nextIsUSDMode);

        if (borrowAmount === 0n) {
            setInputValue('');

            return;
        }

        const decimals = selectedToken.decimals || 18;
        const tokenAmount = parseFiniteNumber(
            formatUnits(borrowAmount, decimals),
        );

        setInputValue(
            nextIsUSDMode
                ? formatPlainAmount(tokenAmount * selectedPrice, 2)
                : formatUnits(borrowAmount, decimals),
        );
    }, [borrowAmount, isUSDMode, selectedPrice, selectedToken]);

    const simulation = useMemo(() => {
        if (!summary || !selectedToken || borrowAmount === 0n) {
            return null;
        }

        const currentHF = parseFiniteNumber(summary.healthFactor, Infinity);
        const totalCollateral = parseFiniteNumber(summary.totalCollateralUSD);
        const totalDebt = parseFiniteNumber(summary.totalBorrowsUSD);
        let avgLT = parseFiniteNumber(summary.currentLiquidationThreshold);

        if (avgLT > 1) {
            avgLT = avgLT / 10000;
        }

        const currentCollateralPower =
            totalDebt > 0 && Number.isFinite(currentHF)
                ? currentHF * totalDebt
                : totalCollateral * avgLT;
        const simulatedTotalDebt = totalDebt + amountUSD;
        const simulatedHF =
            simulatedTotalDebt > 0
                ? currentCollateralPower / simulatedTotalDebt
                : Infinity;

        return {
            currentHF,
            simulatedHF,
            totalDebt,
            simulatedTotalDebt,
            availableBorrowAfterUSD: Math.max(
                0,
                availableBorrowUSD - amountUSD,
            ),
        };
    }, [
        amountUSD,
        availableBorrowUSD,
        borrowAmount,
        selectedToken,
        summary,
    ]);

    const isWrongNetwork = selectedNetwork?.chainId !== chainId;
    const isApproveRequired =
        !!selectedToken && isNativeBorrow && delegationAllowance < borrowAmount;
    const isAmountOverMax = borrowAmount > maxBorrowAmount;
    const isHealthFactorInvalid =
        !!simulation && simulation.simulatedHF <= 1;
    const shouldAcceptRisk =
        !!simulation &&
        simulation.simulatedHF > 1 &&
        simulation.simulatedHF < 1.5;
    const isAmountInvalid =
        borrowAmount === 0n || isAmountOverMax || isHealthFactorInvalid;
    const isTransactionOverviewReady = !!selectedToken && borrowAmount > 0n;
    const selectedBorrowRate =
        (selectedToken?.variableBorrowRate ?? selectedToken?.borrowRate ?? 0) *
        100;

    useEffect(() => {
        setEstimatedGasCostUSD(null);
    }, [borrowAmount, selectedToken]);

    const renderSelectorStatus = useCallback(
        (token: any) => {
            const maxAmount = getMaxBorrowAmount(token);
            const tokenAmount = parseFiniteNumber(
                formatUnits(maxAmount, token.decimals || 18),
            );
            const address = token.isNativeBorrowAsset
                ? null
                : getTokenAddress(token);
            const price = parseFiniteNumber(token.priceInUSD);

            return {
                disabled: maxAmount <= 0n,
                reasons: maxAmount <= 0n ? ['Not available to borrow'] : [],
                amount: formatCompactNumber(tokenAmount),
                amountRaw: tokenAmount * price,
                amountUSD: formatUSD(tokenAmount * price),
                contractAddress: token.isNativeBorrowAsset
                    ? undefined
                    : formatContractAddress(address),
                contractUrl: token.isNativeBorrowAsset
                    ? undefined
                    : getExplorerTokenUrl(market?.explorer, address),
            };
        },
        [getMaxBorrowAmount, market?.explorer],
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

    const executeBorrow = useCallback(
        async (token: any, amount: bigint, borrowAsNative: boolean) => {
            if (!walletClient || !poolAddress || amount === 0n) {
                return;
            }

            const tokenAddress = getTokenAddress(token);

            if (!tokenAddress) {
                throw new Error('Token address missing');
            }

            const account = getAddress(walletAddress);
            let txHash: `0x${string}`;

            if (token.isNativeBorrowAsset && borrowAsNative) {
                if (!gatewayAddress) {
                    throw new Error('WETH Gateway address missing');
                }

                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(gatewayAddress),
                    abi: parseAbi(ABIS.WETH_GATEWAY),
                    functionName: 'borrowETH',
                    args: [getAddress(poolAddress), amount, 0],
                });
            } else {
                txHash = await walletClient.writeContract({
                    account,
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'borrow',
                    args: [getAddress(tokenAddress), amount, 2n, 0, account],
                });
            }

            addTransaction({
                hash: txHash,
                chainId,
                description: `Borrow ${formatUnits(amount, token.decimals || 18)} ${borrowAsNative ? token.symbol : token.wrappedSymbol || token.symbol}`,
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
            onClose,
            onSuccess,
            poolAddress,
            resetAmount,
            selectedNetwork.key,
            walletAddress,
            walletClient,
        ],
    );

    const handleApproveAndBorrow = async () => {
        if (
            !walletClient ||
            !selectedToken ||
            !poolAddress ||
            isAmountInvalid ||
            (shouldAcceptRisk && !riskAccepted)
        ) {
            return;
        }

        const lockedToken = selectedToken;
        const lockedAmount = borrowAmount;

        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();

            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            const lockedBorrowAsNative =
                lockedToken.isNativeBorrowAsset && borrowNativeForWrapped;

            if (lockedBorrowAsNative && delegationAllowance < lockedAmount) {
                if (!gatewayAddress || !lockedToken.variableDebtTokenAddress) {
                    throw new Error('Debt token address missing');
                }

                const approveHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(lockedToken.variableDebtTokenAddress),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
                    functionName: 'approveDelegation',
                    args: [getAddress(gatewayAddress), MAX_UINT256],
                });

                addTransaction({
                    hash: approveHash,
                    chainId,
                    description: `Approve credit delegation for ${lockedToken.symbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                    suppressPositionRefresh: true,
                });

                if (publicClient) {
                    await publicClient.waitForTransactionReceipt({
                        hash: approveHash,
                    });
                }

                setDelegationAllowance(MAX_UINT256);
            }

            await executeBorrow(lockedToken, lockedAmount, lockedBorrowAsNative);
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Borrow failed');
        } finally {
            setIsLoading(false);
        }
    };

    const actionLabel = useMemo(() => {
        if (selectorTokens.length === 0) {
            return 'No borrowable assets';
        }

        if (borrowAmount === 0n) {
            return 'Enter an amount';
        }

        if (isAmountOverMax) {
            return 'Amount exceeds borrow power';
        }

        if (isHealthFactorInvalid) {
            return 'Health factor too low';
        }

        if (shouldAcceptRisk && !riskAccepted) {
            return 'Accept risk to continue';
        }

        if (isApproveRequired) {
            return 'Approve & Borrow';
        }

        return `Borrow ${displaySymbol}`;
    }, [
        borrowAmount,
        displaySymbol,
        isAmountOverMax,
        isApproveRequired,
        isHealthFactorInvalid,
        riskAccepted,
        selectorTokens.length,
        shouldAcceptRisk,
    ]);

    const availableText = selectedToken
        ? `${formatUSD(availableBorrowUSD)} available to borrow`
        : formatUSD(availableBorrowUSD);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={selectedToken ? `Borrow ${displaySymbol}` : 'Borrow Assets'}
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
                            Your borrow request is processing on-chain.
                        </p>
                    </div>
                ) : (
                    <>
                        {selectorTokens.length === 0 ? (
                            <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:border-slate-800/70 dark:bg-slate-900/30 dark:text-slate-400">
                                No borrowable assets found for this market.
                            </div>
                        ) : (
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
                                onApplyMax={handleApplyMax}
                                onApplyPct={handlePercentClick}
                                maxAmount={maxBorrowAmount}
                                decimals={
                                    isUSDMode
                                        ? 2
                                        : selectedToken?.decimals || 18
                                }
                                formattedBalance={
                                    selectedToken
                                        ? formatUnits(
                                            maxBorrowAmount,
                                            selectedToken.decimals || 18,
                                        )
                                        : '0'
                                }
                                balanceLabel="Available"
                                onTokenSelect={() => setTokenSelectorOpen(true)}
                                secondaryValue={secondaryValue}
                                displaySymbol={displaySymbol}
                                disabled={isLoading || !selectedToken}
                                isError={isAmountOverMax || isHealthFactorInvalid}
                                placeholder="0.00"
                            />
                        )}

                        {isWrappedNativeBorrowOption && (
                            <div className="flex items-center gap-2 px-1 pt-1">
                                <Switch
                                    checked={borrowNativeForWrapped}
                                    onCheckedChange={(checked) => {
                                        setBorrowNativeForWrapped(checked);
                                        setDelegationAllowance(
                                            checked ? 0n : MAX_UINT256,
                                        );
                                    }}
                                />
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    Unwrap {selectedToken?.wrappedSymbol || nativeInfo.wrapped} (to borrow {nativeInfo.native})
                                </span>
                            </div>
                        )}

                        <div className="px-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
                            {availableText}
                        </div>

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
                                        {simulation && (
                                            <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                                <div className="flex items-center gap-1.5">
                                                    <span>
                                                        Available to borrow
                                                        after
                                                    </span>
                                                    <InfoTooltip
                                                        content="Estimated borrow power remaining after this transaction."
                                                        size={12}
                                                    />
                                                </div>
                                                <span className="text-slate-900 dark:text-slate-100">
                                                    {formatUSD(
                                                        simulation.availableBorrowAfterUSD,
                                                    )}
                                                </span>
                                            </div>
                                        )}

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

                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>Borrow APY</span>
                                                <InfoTooltip
                                                    content="Variable annual borrow rate for this asset."
                                                    size={12}
                                                />
                                            </div>
                                            <span className="text-slate-900 dark:text-slate-100">
                                                {formatAPY(selectedBorrowRate)}
                                            </span>
                                        </div>

                                        <div className="flex items-start justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span>
                                                    Borrow balance after
                                                    transaction
                                                </span>
                                                <InfoTooltip
                                                    content="Estimated amount added to your borrowed position."
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
                                                    {formatCompactNumber(
                                                        amountAsToken,
                                                    )}{' '}
                                                    {displaySymbol}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {shouldAcceptRisk && (
                            <div className="space-y-2 px-3 pt-2 text-center text-xs font-bold text-red-500">
                                <p>
                                    Borrowing this amount will reduce your Health Factor and increase liquidation risk.
                                </p>
                                <label className="flex cursor-pointer items-center justify-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={riskAccepted}
                                        onChange={(event) =>
                                            setRiskAccepted(
                                                event.target.checked,
                                            )
                                        }
                                        className="h-4 w-4 rounded border-red-500 bg-transparent text-red-500 focus:ring-red-500"
                                    />
                                    <span>I acknowledge the risks involved.</span>
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
                                    onClick={handleApproveAndBorrow}
                                    disabled={
                                        isLoading ||
                                        isAmountInvalid ||
                                        selectorTokens.length === 0 ||
                                        !selectedToken ||
                                        (shouldAcceptRisk && !riskAccepted)
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
                title="Select Asset to Borrow"
                description="Choose a token available in this market"
                searchPlaceholder="Search token..."
                renderStatus={renderSelectorStatus}
                rateField="variableBorrowRate"
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
