import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    RefreshCw,
    Wallet,
    Info,
    ArrowRight,
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
    onSuccess?: () => void;
}

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
    onSuccess,
}) => {
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } = useWeb3();
    const { addTransaction } = useTransactionTracker();

    // Tabs: 'repay' | 'atoken'
    const [activeTab, setActiveTab] = useState<'repay' | 'atoken'>('repay');

    // Local State
    const [inputValue, setInputValue] = useState('');
    const [repayAmount, setRepayAmount] = useState<bigint>(0n);
    const [debtBalance, setDebtBalance] = useState<bigint>(0n); // Outstanding debt
    const [walletBalance, setWalletBalance] = useState<bigint>(0n); // User wallet balance
    const [aTokenBalance, setATokenBalance] = useState<bigint>(0n); // aToken balance (collateral)
    const [allowance, setAllowance] = useState<bigint>(0n);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    // Standard native vs wrapped toggle (for standard repay)
    const [isNativeSelected, setIsNativeSelected] = useState(true);

    const market = useMemo(() => marketKey ? getMarketByKey(marketKey) : selectedNetwork, [marketKey, selectedNetwork]);
    const poolAddress = market?.addresses.POOL;
    const gatewayAddress = market?.addresses.WETH_GATEWAY;

    const nativeInfo = useMemo(() => getNativeInfo(chainId), [chainId]);

    const isWrappedNative = useMemo(() => {
        if (!initialAsset) return false;
        return initialAsset.symbol.toUpperCase() === nativeInfo.wrapped.toUpperCase();
    }, [initialAsset, nativeInfo]);

    // Find if user has supplies for "Repay with aTokens"
    const suppliedAsset = useMemo(() => {
        if (!initialAsset || !supplies) return null;
        const targetAddr = (initialAsset.underlyingAsset || initialAsset.address || '').toLowerCase();
        return supplies.find(s => (s.underlyingAsset || s.address || '').toLowerCase() === targetAddr);
    }, [initialAsset, supplies]);

    // Fetch user balances & allowances
    const fetchBalances = useCallback(async () => {
        if (!walletAddress || !publicClient || !initialAsset) return;

        try {
            // Outstanding debt
            const debtStr = initialAsset.formattedAmount || initialAsset.amount || '0';
            const parsedDebt = parseUnits(debtStr, initialAsset.decimals || 18);
            setDebtBalance(parsedDebt);

            // User wallet balance of underlying
            let bal = 0n;
            if (isWrappedNative && isNativeSelected) {
                bal = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
            } else {
                bal = await publicClient.readContract({
                    address: getAddress(initialAsset.underlyingAsset || initialAsset.address),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'balanceOf',
                    args: [getAddress(walletAddress)],
                }) as bigint;
            }
            setWalletBalance(bal);

            // aToken balance of user
            if (suppliedAsset) {
                const aTokenAddr = suppliedAsset.aTokenAddress || null;
                if (aTokenAddr) {
                    const aBal = await publicClient.readContract({
                        address: getAddress(aTokenAddr),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'balanceOf',
                        args: [getAddress(walletAddress)],
                    }) as bigint;
                    setATokenBalance(aBal);
                }
            } else {
                setATokenBalance(0n);
            }

            // Allowance of underlying to POOL
            if (activeTab === 'repay') {
                if (isWrappedNative && isNativeSelected) {
                    setAllowance(2n ** 256n - 1n); // Native doesn't need allowance
                } else if (poolAddress) {
                    const userAllowance = await publicClient.readContract({
                        address: getAddress(initialAsset.underlyingAsset || initialAsset.address),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'allowance',
                        args: [getAddress(walletAddress), getAddress(poolAddress)],
                    }) as bigint;
                    setAllowance(userAllowance);
                }
            } else {
                setAllowance(2n ** 256n - 1n); // Repay with aTokens burns directly, no allowance needed
            }
        } catch (err) {
            console.error('Error fetching balances/allowances:', err);
        }
    }, [walletAddress, publicClient, initialAsset, isWrappedNative, isNativeSelected, poolAddress, activeTab, suppliedAsset]);

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
            setRepayAmount(0n);
            return;
        }

        try {
            const decimals = initialAsset?.decimals || 18;
            const parsed = parseUnits(cleaned, decimals);
            const maxRepayable = activeTab === 'repay' ? walletBalance : aTokenBalance;
            const limit = maxRepayable < debtBalance ? maxRepayable : debtBalance;

            if (parsed > limit) {
                setRepayAmount(limit);
                setInputValue(formatUnits(limit, decimals));
            } else {
                setRepayAmount(parsed);
            }
        } catch {
            // Ignore parse errors
        }
    };

    const handlePercentClick = (percent: number) => {
        const maxRepayable = activeTab === 'repay' ? walletBalance : aTokenBalance;
        const limit = maxRepayable < debtBalance ? maxRepayable : debtBalance;
        if (limit === 0n) return;

        const amt = (limit * BigInt(percent)) / 100n;
        const decimals = initialAsset?.decimals || 18;
        setRepayAmount(amt);
        setInputValue(formatUnits(amt, decimals));
    };

    // HF Simulation
    const simulation = useMemo(() => {
        if (!summary || !initialAsset || repayAmount === 0n) return null;

        const currentHF = parseFloat(summary.healthFactor || '0');
        const totalCollateral = parseFloat(summary.totalCollateralUSD || '0');
        const totalDebt = parseFloat(summary.totalBorrowsUSD || '0');

        let avgLT = parseFloat(summary.currentLiquidationThreshold || '0');
        if (avgLT > 1) avgLT = avgLT / 10000;

        const price = parseFloat(initialAsset.priceInUSD || '0');
        const repaidUSD = parseFloat(formatUnits(repayAmount, initialAsset.decimals || 18)) * price;

        if (activeTab === 'repay') {
            const currentNumerator = totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
            const simulatedDebt = Math.max(0, totalDebt - repaidUSD);
            const simulatedHF = simulatedDebt > 0 ? currentNumerator / simulatedDebt : Infinity;

            return {
                currentHF: currentHF.toString(),
                simulatedHF: simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
                isSafe: true,
            };
        } else {
            // Repay with aTokens: reduces both collateral and debt
            let assetLT = parseFloat(initialAsset.reserveLiquidationThreshold || initialAsset.baseLTVasCollateral || '0');
            if (assetLT > 1) assetLT = assetLT / 10000;

            const currentNumerator = totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
            const removedContribution = repaidUSD * assetLT;
            const simulatedNumerator = Math.max(0, currentNumerator - removedContribution);
            const simulatedDebt = Math.max(0, totalDebt - repaidUSD);
            const simulatedHF = simulatedDebt > 0 ? simulatedNumerator / simulatedDebt : Infinity;

            return {
                currentHF: currentHF.toString(),
                simulatedHF: simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
                isSafe: simulatedHF > 1.05 || simulatedDebt === 0,
            };
        }
    }, [summary, initialAsset, repayAmount, activeTab]);

    // Contract Writes
    const handleApprove = async () => {
        if (!walletClient || !initialAsset || !poolAddress) return;
        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            const txHash = await walletClient.writeContract({
                account: getAddress(walletAddress),
                address: getAddress(initialAsset.underlyingAsset || initialAsset.address),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'approve',
                args: [getAddress(poolAddress), 2n ** 256n - 1n],
            });

            addTransaction({
                hash: txHash,
                chainId,
                description: `Approve ${initialAsset.symbol} for Aave Pool`,
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
        if (!walletClient || !initialAsset || !poolAddress || repayAmount === 0n) return;
        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            let txHash: `0x${string}`;
            const displaySymbol = isNativeSelected && activeTab === 'repay' && isWrappedNative ? nativeInfo.native : initialAsset.symbol;

            if (activeTab === 'repay') {
                if (isWrappedNative && isNativeSelected) {
                    if (!gatewayAddress) throw new Error('WETH Gateway address missing');
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(gatewayAddress),
                        abi: parseAbi(ABIS.WETH_GATEWAY),
                        functionName: 'repayETH',
                        args: [getAddress(poolAddress), repayAmount, 2n, getAddress(walletAddress)],
                        value: repayAmount,
                    });
                } else {
                    txHash = await walletClient.writeContract({
                        account: getAddress(walletAddress),
                        address: getAddress(poolAddress),
                        abi: parseAbi(ABIS.POOL),
                        functionName: 'repay',
                        args: [getAddress(initialAsset.underlyingAsset || initialAsset.address), repayAmount, 2n, getAddress(walletAddress)],
                    });
                }

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Repay ${formatUnits(repayAmount, initialAsset.decimals)} ${displaySymbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                });
            } else {
                // Repay with aTokens
                txHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'repayWithATokens',
                    args: [getAddress(initialAsset.underlyingAsset || initialAsset.address), repayAmount, 2n],
                });

                addTransaction({
                    hash: txHash,
                    chainId,
                    description: `Repay with aTokens: ${formatUnits(repayAmount, initialAsset.decimals)} ${initialAsset.symbol}`,
                    marketKey: marketKey || selectedNetwork.key,
                });
            }

            setIsSuccess(true);
            onSuccess?.();
            setTimeout(() => {
                onClose();
                setIsSuccess(false);
                setInputValue('');
                setRepayAmount(0n);
            }, 2000);
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Repayment failed');
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

    const isApproveRequired = activeTab === 'repay' && allowance < repayAmount;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Repay ${initialAsset?.symbol} Debt`}
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
                        <p className="text-xs text-slate-500 mt-1">Your repay request is processing on-chain.</p>
                    </div>
                ) : (
                    <>
                        {/* Tab Switcher */}
                        <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold">
                            <button
                                onClick={() => { setActiveTab('repay'); setErrorText(null); }}
                                className={`flex-1 py-2.5 rounded-lg transition-all ${activeTab === 'repay' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                            >
                                Repay with Wallet
                            </button>
                            <button
                                onClick={() => { setActiveTab('atoken'); setErrorText(null); }}
                                disabled={!suppliedAsset}
                                className={`flex-1 py-2.5 rounded-lg transition-all ${activeTab === 'atoken' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'} disabled:opacity-40 disabled:cursor-not-allowed`}
                                title={!suppliedAsset ? 'No supplied balance for this asset' : undefined}
                            >
                                Repay with aTokens
                            </button>
                        </div>

                        {/* Debt Info Box */}
                        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                                    <img
                                        src={getTokenLogo(isNativeSelected && activeTab === 'repay' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol)}
                                        alt={initialAsset?.symbol}
                                        className="w-full h-full object-cover"
                                        onError={onTokenImgError(isNativeSelected && activeTab === 'repay' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol)}
                                    />
                                </div>
                                <div>
                                    <div className="text-sm font-black uppercase tracking-wider text-slate-400">Debt Position</div>
                                    <div className="font-bold text-slate-900 dark:text-white">
                                        {isNativeSelected && activeTab === 'repay' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}
                                    </div>
                                </div>
                            </div>

                            {/* Native / Wrapped Toggle for standard WETH repay */}
                            {activeTab === 'repay' && isWrappedNative && gatewayAddress && (
                                <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] font-bold">
                                    <button
                                        onClick={() => { setIsNativeSelected(true); setInputValue(''); setRepayAmount(0n); }}
                                        className={`px-3 py-1.5 rounded-md transition-all ${isNativeSelected ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                    >
                                        {nativeInfo.native}
                                    </button>
                                    <button
                                        onClick={() => { setIsNativeSelected(false); setInputValue(''); setRepayAmount(0n); }}
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
                                    {activeTab === 'repay' ? 'Wallet Balance' : 'aToken Balance'}: {formatCompactNumber(formatUnits(activeTab === 'repay' ? walletBalance : aTokenBalance, initialAsset?.decimals || 18))} {isNativeSelected && activeTab === 'repay' && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}
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

                        {/* Repay Overview */}
                        {initialAsset && (
                            <div className="bg-slate-50 dark:bg-slate-800/20 rounded-2xl p-4 border border-slate-200/50 dark:border-slate-800/50 space-y-3 text-xs">
                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <span>Remaining Debt</span>
                                    <span className="font-mono font-bold">
                                        {formatCompactNumber(formatUnits(debtBalance - repayAmount, initialAsset.decimals))} {initialAsset.symbol}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center gap-1">
                                        <span>Health Factor</span>
                                        <InfoTooltip content="Estimated Health Factor change after repayment. Repaying debt improves HF." />
                                    </div>
                                    <div className="flex items-center gap-1.5 font-mono">
                                        <span>{formatHF(summary?.healthFactor)}</span>
                                        {simulation && (
                                            <>
                                                <span>→</span>
                                                <span className="text-emerald-500 font-bold">
                                                    {formatHF(simulation.simulatedHF)}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <span>Gas Token Cost</span>
                                    <span className="font-mono text-slate-500">&lt; $0.06</span>
                                </div>
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
                                    disabled={isLoading || repayAmount === 0n}
                                    className="w-full py-6 text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Approve {initialAsset?.symbol}
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleConfirm}
                                    disabled={isLoading || repayAmount === 0n}
                                    className="w-full py-6 text-sm font-bold bg-linear-to-r from-purple-600 to-blue-600 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    {activeTab === 'atoken' ? 'Confirm Repay with aTokens' : `Repay ${isNativeSelected && isWrappedNative ? nativeInfo.native : initialAsset?.symbol}`}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>
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
