import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    RefreshCw,
    Wallet,
    Info,
    ArrowRight,
    ArrowLeftRight,
} from 'lucide-react';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getAddress, parseAbi, formatUnits, parseUnits } from 'viem';
import { usePublicClient, useWalletClient } from 'wagmi';
import { useWeb3 } from '../contexts/web3-context';
import { useTransactionTracker } from '../contexts/transaction-tracker-context';
import { ABIS } from '../constants/abis';
import { MARKETS, getMarketByKey } from '../constants/networks';
import { Modal } from './modal';
import { TokenSelector } from './token-selector';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { InfoTooltip } from './info-tooltip';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { formatUSD, formatHF, formatCompactNumber, formatAPY } from '../utils/formatters';
import { getWithdrawSwapQuote, buildWithdrawSwapTx } from '../services/api';

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialAsset: any | null;
    marketKey: string | null;
    chainId: number;
    marketAssets: any[];
    walletAddress: string;
    summary: any;
    onSuccess?: () => void;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
    isOpen,
    onClose,
    initialAsset,
    marketKey,
    chainId,
    marketAssets,
    walletAddress,
    summary,
    onSuccess,
}) => {
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } = useWeb3();
    const { addTransaction } = useTransactionTracker();

    // Tabs: 'withdraw' | 'swap'
    const [activeTab, setActiveTab] = useState<'withdraw' | 'swap'>('withdraw');

    // Local State
    const [inputValue, setInputValue] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState<bigint>(0n);
    const [balance, setBalance] = useState<bigint>(0n); // Supplied position balance
    const [aTokenBalance, setATokenBalance] = useState<bigint>(0n); // Balance of aToken
    const [allowance, setAllowance] = useState<bigint>(0n); // Standard allowance of aToken/token depending on mode
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    // Standard native vs wrapped toggle (for standard withdraw)
    const [isNativeSelected, setIsNativeSelected] = useState(true);

    // Swap Destination State
    const [targetToken, setTargetToken] = useState<any>(null);
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [swapQuote, setSwapQuote] = useState<any>(null);
    const [slippage, setSlippage] = useState<number>(0.5); // 0.5% default

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

    // Filter swappable target assets
    const swappableTokens = useMemo(() => {
        return (marketAssets || []).filter(t => t.isActive && t.symbol !== initialAsset?.symbol);
    }, [marketAssets, initialAsset]);

    // Auto-select first target token
    useEffect(() => {
        if (isOpen && swappableTokens.length > 0 && !targetToken) {
            setTargetToken(swappableTokens[0]);
        }
    }, [isOpen, swappableTokens]);

    // Fetch user supplied balance and allowance
    const fetchBalances = useCallback(async () => {
        if (!walletAddress || !publicClient || !initialAsset) return;

        try {
            // Fetch supplied balance from position info
            const amtStr = initialAsset.formattedAmount || initialAsset.amount || '0';
            const parsedPositionBalance = parseUnits(amtStr, initialAsset.decimals || 18);
            setBalance(parsedPositionBalance);

            // Fetch aToken balance of user
            if (aTokenAddress) {
                const aBal = await publicClient.readContract({
                    address: getAddress(aTokenAddress),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'balanceOf',
                    args: [getAddress(walletAddress)],
                }) as bigint;
                setATokenBalance(aBal);
            }

            // Fetch allowances
            if (activeTab === 'withdraw') {
                if (isWrappedNative && isNativeSelected && gatewayAddress && aTokenAddress) {
                    // Gateway needs approval to spend user's aWETH
                    const gateAllowance = await publicClient.readContract({
                        address: getAddress(aTokenAddress),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'allowance',
                        args: [getAddress(walletAddress), getAddress(gatewayAddress)],
                    }) as bigint;
                    setAllowance(gateAllowance);
                } else {
                    setAllowance(2n ** 256n - 1n); // Standard ERC-20 withdraw doesn't need allowance
                }
            } else if (activeTab === 'swap' && withdrawSwapAdapterAddress && aTokenAddress) {
                // Swap Adapter needs approval to spend user's aToken
                const adapterAllowance = await publicClient.readContract({
                    address: getAddress(aTokenAddress),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'allowance',
                    args: [getAddress(walletAddress), getAddress(withdrawSwapAdapterAddress)],
                }) as bigint;
                setAllowance(adapterAllowance);
            }
        } catch (err) {
            console.error('Error fetching balances/allowances:', err);
        }
    }, [walletAddress, publicClient, initialAsset, aTokenAddress, activeTab, isWrappedNative, isNativeSelected, gatewayAddress, withdrawSwapAdapterAddress]);

    useEffect(() => {
        if (isOpen && initialAsset) {
            void fetchBalances();
            const interval = setInterval(fetchBalances, 15000);
            return () => clearInterval(interval);
        }
    }, [isOpen, initialAsset, activeTab, isNativeSelected, fetchBalances]);

    // Amount change handlers
    const handleAmountChange = (val: string) => {
        const cleaned = val.replace(/[^0-9.]/g, '');
        setInputValue(cleaned);

        if (!cleaned || isNaN(parseFloat(cleaned))) {
            setWithdrawAmount(0n);
            setSwapQuote(null);
            return;
        }

        try {
            const decimals = initialAsset?.decimals || 18;
            const parsed = parseUnits(cleaned, decimals);
            if (parsed > balance) {
                setWithdrawAmount(balance);
                setInputValue(formatUnits(balance, decimals));
            } else {
                setWithdrawAmount(parsed);
            }
        } catch {
            // Ignore parse errors
        }
    };

    const handlePercentClick = (percent: number) => {
        if (balance === 0n) return;
        const amt = (balance * BigInt(percent)) / 100n;
        const decimals = initialAsset?.decimals || 18;
        setWithdrawAmount(amt);
        setInputValue(formatUnits(amt, decimals));
    };

    // Fetch quote for Withdraw & Swap
    const fetchQuoteData = useCallback(async () => {
        if (activeTab !== 'swap' || !initialAsset || !targetToken || withdrawAmount === 0n || !withdrawSwapAdapterAddress) {
            setSwapQuote(null);
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

            setSwapQuote(quote);
        } catch (err: any) {
            setSwapQuote(null);
            setErrorText(err.message || 'Failed to fetch withdraw swap quote');
        } finally {
            setIsQuoteLoading(false);
        }
    }, [activeTab, initialAsset, targetToken, withdrawAmount, withdrawSwapAdapterAddress, chainId, walletAddress, marketKey]);

    useEffect(() => {
        const timer = setTimeout(() => {
            void fetchQuoteData();
        }, 600);
        return () => clearTimeout(timer);
    }, [withdrawAmount, targetToken, activeTab, fetchQuoteData]);

    // HF Simulation
    const simulation = useMemo(() => {
        if (!summary || !initialAsset || withdrawAmount === 0n) return null;

        const currentHF = parseFloat(summary.healthFactor || '0');
        const totalCollateral = parseFloat(summary.totalCollateralUSD || '0');
        const totalDebt = parseFloat(summary.totalBorrowsUSD || '0');

        let avgLT = parseFloat(summary.currentLiquidationThreshold || '0');
        if (avgLT > 1) avgLT = avgLT / 10000;

        const removedAmount = parseFloat(formatUnits(withdrawAmount, initialAsset.decimals || 18));
        const price = parseFloat(initialAsset.priceInUSD || '0');
        const removedUSD = removedAmount * price;

        let assetLT = parseFloat(initialAsset.reserveLiquidationThreshold || initialAsset.baseLTVasCollateral || '0');
        if (assetLT > 1) assetLT = assetLT / 10000;

        const currentNumerator = totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
        const assetContribution = removedUSD * assetLT;
        const simulatedNumerator = Math.max(0, currentNumerator - assetContribution);
        const simulatedHF = totalDebt > 0 ? simulatedNumerator / totalDebt : Infinity;

        return {
            currentHF: currentHF.toString(),
            simulatedHF: simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
            isSafe: simulatedHF > 1.05 || totalDebt === 0,
            isDanger: simulatedHF <= 1.02 && totalDebt > 0,
        };
    }, [summary, initialAsset, withdrawAmount]);

    // Contract writes
    const handleApprove = async () => {
        if (!walletClient || !aTokenAddress) return;
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
                args: [getAddress(spender), 2n ** 256n - 1n],
            });

            addTransaction({
                hash: txHash,
                chainId,
                description: `Approve ${initialAsset.symbol} receipt for ${activeTab === 'withdraw' ? 'Gateway' : 'Swap Adapter'}`,
                marketKey: marketKey || selectedNetwork.key,
            });

            if (publicClient) {
                await publicClient.waitForTransactionReceipt({ hash: txHash });
            }
            await fetchBalances();
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Approval failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (!walletClient || !initialAsset || !poolAddress || withdrawAmount === 0n) return;
        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            let txHash: `0x${string}`;

            if (activeTab === 'withdraw') {
                if (isWrappedNative && isNativeSelected) {
                    if (!gatewayAddress) throw new Error('WETH Gateway address missing');
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(gatewayAddress),
                        abi: parseAbi(ABIS.WETH_GATEWAY),
                        functionName: 'withdrawETH',
                        args: [getAddress(poolAddress), withdrawAmount, getAddress(walletAddress)],
                    });
                } else {
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(poolAddress),
                        abi: parseAbi(ABIS.POOL),
                        functionName: 'withdraw',
                        args: [getAddress(initialAsset.underlyingAsset || initialAsset.address), withdrawAmount, getAddress(walletAddress)],
                    });
                }

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Withdraw ${formatUnits(withdrawAmount, initialAsset.decimals)} ${isWrappedNative && isNativeSelected ? nativeInfo.native : initialAsset.symbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                });
            } else {
                // Withdraw & Swap route
                if (!withdrawSwapAdapterAddress || !swapQuote) throw new Error('Withdraw Swap parameters missing');

                const isMax = withdrawAmount === balance;

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
                    priceRoute: swapQuote.priceRoute,
                    adapterAddress: getAddress(withdrawSwapAdapterAddress),
                    srcAmount: withdrawAmount.toString(),
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
                        withdrawAmount,
                        BigInt(txData.minAmountToReceive),
                        BigInt(txData.swapAllBalanceOffset),
                        txData.swapCallData,
                        getAddress(txData.augustus),
                        permitParams,
                    ],
                });

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Withdraw & Swap ${formatUnits(withdrawAmount, initialAsset.decimals)} ${initialAsset.symbol} to ${targetToken.symbol}`,
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
            }, 2000);
        } catch (err: any) {
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

    const isApproveRequired = activeTab === 'swap'
        ? allowance < withdrawAmount
        : (isWrappedNative && isNativeSelected && allowance < withdrawAmount);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Withdraw ${initialAsset?.symbol}`}
            maxWidth="460px"
            headerBorder={false}
        >
            <div className="space-y-4 p-4">
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
                            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold">
                                <button
                                    onClick={() => { setActiveTab('withdraw'); setErrorText(null); }}
                                    className={`flex-1 py-2.5 rounded-lg transition-all ${activeTab === 'withdraw' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                >
                                    Withdraw
                                </button>
                                <button
                                    onClick={() => { setActiveTab('swap'); setErrorText(null); }}
                                    className={`flex-1 py-2.5 rounded-lg transition-all ${activeTab === 'swap' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                >
                                    Withdraw & Swap
                                </button>
                            </div>
                        )}

                        {/* Standard Withdraw Asset Box */}
                        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                                    <img
                                        src={getTokenLogo(isNativeSelected && activeTab === 'withdraw' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol)}
                                        alt={initialAsset?.symbol}
                                        className="w-full h-full object-cover"
                                        onError={onTokenImgError(isNativeSelected && activeTab === 'withdraw' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol)}
                                    />
                                </div>
                                <div>
                                    <div className="text-sm font-black uppercase tracking-wider text-slate-400">Position</div>
                                    <div className="font-bold text-slate-900 dark:text-white">
                                        {isNativeSelected && activeTab === 'withdraw' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}
                                    </div>
                                </div>
                            </div>

                            {/* Native / Wrapped Toggle for standard WETH withdraw */}
                            {activeTab === 'withdraw' && isWrappedNative && gatewayAddress && (
                                <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] font-bold">
                                    <button
                                        onClick={() => { setIsNativeSelected(true); setInputValue(''); setWithdrawAmount(0n); }}
                                        className={`px-3 py-1.5 rounded-md transition-all ${isNativeSelected ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                    >
                                        {nativeInfo.native}
                                    </button>
                                    <button
                                        onClick={() => { setIsNativeSelected(false); setInputValue(''); setWithdrawAmount(0n); }}
                                        className={`px-3 py-1.5 rounded-md transition-all ${!isNativeSelected ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                    >
                                        {nativeInfo.wrapped}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Amount Input */}
                        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl space-y-3">
                            <div className="flex justify-between items-center text-xs">
                                <span className="font-bold text-slate-400 uppercase tracking-wider">Amount</span>
                                <span className="text-slate-500 font-mono">
                                    Supplied: {formatCompactNumber(formatUnits(balance, initialAsset?.decimals || 18))} {initialAsset?.symbol}
                                </span>
                            </div>

                            <div className="relative">
                                <Input
                                    type="text"
                                    placeholder="0.00"
                                    value={inputValue}
                                    onChange={(e) => handleAmountChange(e.target.value)}
                                    className="w-full bg-transparent border-0 focus:ring-0 p-0 text-3xl font-mono font-bold text-slate-900 dark:text-white shadow-none"
                                />
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                    <span className="text-sm font-bold text-slate-400">{initialAsset?.symbol}</span>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
                                {[25, 50, 75, 100].map((pct) => (
                                    <button
                                        key={pct}
                                        onClick={() => handlePercentClick(pct)}
                                        className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 text-xs font-bold transition-all"
                                    >
                                        {pct === 100 ? 'MAX' : `${pct}%`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Withdraw & Swap Target Asset Box */}
                        {activeTab === 'swap' && (
                            <div className="space-y-2">
                                <div className="flex justify-center py-0.5">
                                    <div className="bg-slate-100 dark:bg-slate-900 p-2 rounded-full border border-slate-200 dark:border-slate-800">
                                        <ArrowLeftRight className="w-4 h-4 text-slate-400 rotate-90" />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                                            {targetToken && (
                                                <img
                                                    src={getTokenLogo(targetToken.symbol)}
                                                    alt={targetToken.symbol}
                                                    className="w-full h-full object-cover"
                                                    onError={onTokenImgError(targetToken.symbol)}
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-sm font-black uppercase tracking-wider text-slate-400">Receive Asset</div>
                                            <button
                                                onClick={() => setTokenSelectorOpen(true)}
                                                className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white hover:opacity-80 transition-opacity"
                                            >
                                                <span>{targetToken?.symbol}</span>
                                                <ChevronDown className="w-4 h-4 text-slate-400" />
                                            </button>
                                        </div>
                                    </div>

                                    {swapQuote && (
                                        <div className="text-right">
                                            <div className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                                                +{formatCompactNumber(formatUnits(BigInt(swapQuote.destAmount), targetToken?.decimals || 18))}
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-medium">
                                                Est. Swapped Value
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Overview / Simulations */}
                        {initialAsset && (
                            <div className="bg-slate-50 dark:bg-slate-800/20 rounded-2xl p-4 border border-slate-200/50 dark:border-slate-800/50 space-y-3 text-xs">
                                {activeTab === 'swap' && swapQuote && (
                                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                        <span>Exchange Rate</span>
                                        <span className="font-mono">
                                            1 {initialAsset.symbol} ≈ {parseFloat(formatUnits(BigInt(swapQuote.destAmount), targetToken?.decimals || 18)) / parseFloat(formatUnits(withdrawAmount, initialAsset.decimals || 18))} {targetToken?.symbol}
                                        </span>
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center gap-1">
                                        <span>Health Factor</span>
                                        <InfoTooltip content="Estimated Health Factor change after withdrawing. Warning: Do not let HF fall below 1.05 to avoid liquidations." />
                                    </div>
                                    <div className="flex items-center gap-1.5 font-mono">
                                        <span>{formatHF(summary?.healthFactor)}</span>
                                        {simulation && (
                                            <>
                                                <span>→</span>
                                                <span className={simulation.isDanger ? 'text-red-500 font-bold' : simulation.isSafe ? 'text-emerald-500 font-bold' : 'text-amber-500 font-bold'}>
                                                    {formatHF(simulation.simulatedHF)}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <span>Gas Token Cost</span>
                                    <span className="font-mono text-slate-500">&lt; $0.08</span>
                                </div>
                            </div>
                        )}

                        {simulation?.isDanger && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 p-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 animate-pulse" />
                                <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                                    High Risk: This withdrawal reduces your collateral too much and risks immediate liquidation.
                                </p>
                            </div>
                        )}

                        {errorText && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 p-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                <p className="text-xs font-semibold text-red-800 dark:text-red-300">{errorText}</p>
                            </div>
                        )}

                        {/* Action Button */}
                        <div className="pt-2">
                            {isWrongNetwork ? (
                                <Button
                                    onClick={handleSwitchChain}
                                    disabled={isLoading}
                                    className="w-full py-6 text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Switch Network to {market?.shortLabel || 'Market Chain'}
                                </Button>
                            ) : isApproveRequired ? (
                                <Button
                                    onClick={handleApprove}
                                    disabled={isLoading || withdrawAmount === 0n}
                                    className="w-full py-6 text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Approve {initialAsset?.symbol} receipt
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleConfirm}
                                    disabled={isLoading || withdrawAmount === 0n || (simulation?.isDanger ?? false)}
                                    className="w-full py-6 text-sm font-bold bg-linear-to-r from-purple-600 to-blue-600 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    {activeTab === 'swap' ? 'Confirm Swap & Withdraw' : `Withdraw ${isNativeSelected && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}`}
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
                onSelect={(tok) => { setTargetToken(tok); setSwapQuote(null); }}
                tokens={swappableTokens}
                title="Select Asset to Receive"
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
