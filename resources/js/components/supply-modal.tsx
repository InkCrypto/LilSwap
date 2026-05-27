import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    RefreshCw,
    Wallet,
    Info,
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
    const { publicClient, walletClient, selectedNetwork, setSelectedNetwork } = useWeb3();
    const { addTransaction } = useTransactionTracker();

    // Local State
    const [selectedToken, setSelectedToken] = useState<any>(null);
    const [isNativeSelected, setIsNativeSelected] = useState(true);
    const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [supplyAmount, setSupplyAmount] = useState<bigint>(0n);
    const [balance, setBalance] = useState<bigint>(0n);
    const [allowance, setAllowance] = useState<bigint>(0n);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    const market = useMemo(() => marketKey ? getMarketByKey(marketKey) : selectedNetwork, [marketKey, selectedNetwork]);
    const poolAddress = market?.addresses.POOL;
    const gatewayAddress = market?.addresses.WETH_GATEWAY;

    const nativeInfo = useMemo(() => getNativeInfo(chainId), [chainId]);

    // Filter active assets for supplying
    const supplyableTokens = useMemo(() => {
        return (marketAssets || []).filter(t => t.isActive && !t.isFrozen && !t.isPaused);
    }, [marketAssets]);

    // Check if the selected token can be deposited as native gas token
    const hasNativeOption = useMemo(() => {
        if (!selectedToken) return false;
        return selectedToken.symbol.toUpperCase() === nativeInfo.wrapped.toUpperCase() && !!gatewayAddress;
    }, [selectedToken, nativeInfo, gatewayAddress]);

    // Handle token selection
    const handleSelectToken = (token: any) => {
        setSelectedToken(token);
        setInputValue('');
        setSupplyAmount(0n);
        setErrorText(null);
        // Default to native if available
        if (token.symbol.toUpperCase() === nativeInfo.wrapped.toUpperCase() && !!gatewayAddress) {
            setIsNativeSelected(true);
        } else {
            setIsNativeSelected(false);
        }
    };

    // Auto-select first token on open if none selected
    useEffect(() => {
        if (isOpen && !selectedToken && supplyableTokens.length > 0) {
            const first = supplyableTokens.find(t => t.symbol.toUpperCase() === nativeInfo.wrapped.toUpperCase()) || supplyableTokens[0];
            handleSelectToken(first);
        }
    }, [isOpen, supplyableTokens, nativeInfo]);

    // Fetch user wallet balance and allowance
    const fetchBalanceAndAllowance = useCallback(async () => {
        if (!walletAddress || !publicClient || !selectedToken) return;

        try {
            let userBalance = 0n;
            if (hasNativeOption && isNativeSelected) {
                userBalance = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
            } else {
                userBalance = await publicClient.readContract({
                    address: getAddress(selectedToken.underlyingAsset || selectedToken.address),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'balanceOf',
                    args: [getAddress(walletAddress)],
                }) as bigint;
            }
            setBalance(userBalance);

            if (hasNativeOption && isNativeSelected) {
                setAllowance(2n ** 256n - 1n); // Native doesn't need allowance
            } else if (poolAddress) {
                const userAllowance = await publicClient.readContract({
                    address: getAddress(selectedToken.underlyingAsset || selectedToken.address),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'allowance',
                    args: [getAddress(walletAddress), getAddress(poolAddress)],
                }) as bigint;
                setAllowance(userAllowance);
            }
        } catch (err) {
            console.error('Error fetching balance/allowance:', err);
        }
    }, [walletAddress, publicClient, selectedToken, isNativeSelected, hasNativeOption, poolAddress]);

    useEffect(() => {
        if (isOpen && selectedToken) {
            void fetchBalanceAndAllowance();
            const interval = setInterval(fetchBalanceAndAllowance, 15000);
            return () => clearInterval(interval);
        }
    }, [isOpen, selectedToken, isNativeSelected, fetchBalanceAndAllowance]);

    // Update supplyAmount when input value changes
    const handleAmountChange = (val: string) => {
        const cleaned = val.replace(/[^0-9.]/g, '');
        setInputValue(cleaned);

        if (!cleaned || isNaN(parseFloat(cleaned))) {
            setSupplyAmount(0n);
            return;
        }

        try {
            const decimals = selectedToken?.decimals || 18;
            const parsed = parseUnits(cleaned, decimals);
            if (parsed > balance) {
                setSupplyAmount(balance);
                setInputValue(formatUnits(balance, decimals));
            } else {
                setSupplyAmount(parsed);
            }
        } catch {
            // Ignore parse errors
        }
    };

    const handlePercentClick = (percent: number) => {
        if (balance === 0n) return;
        const amt = (balance * BigInt(percent)) / 100n;
        const decimals = selectedToken?.decimals || 18;
        setSupplyAmount(amt);
        setInputValue(formatUnits(amt, decimals));
    };

    // HF Simulation
    const simulation = useMemo(() => {
        if (!summary || !selectedToken || supplyAmount === 0n) return null;

        const currentHF = parseFloat(summary.healthFactor || '0');
        const totalCollateral = parseFloat(summary.totalCollateralUSD || '0');
        const totalDebt = parseFloat(summary.totalBorrowsUSD || '0');

        let avgLT = parseFloat(summary.currentLiquidationThreshold || '0');
        if (avgLT > 1) avgLT = avgLT / 10000;

        const addedAmount = parseFloat(formatUnits(supplyAmount, selectedToken.decimals || 18));
        const price = parseFloat(selectedToken.priceInUSD || '0');
        const addedUSD = addedAmount * price;

        let assetLT = parseFloat(selectedToken.reserveLiquidationThreshold || selectedToken.baseLTVasCollateral || '0');
        if (assetLT > 1) assetLT = assetLT / 10000;

        // In Aave, supply is enabled as collateral by default if not LTV = 0
        const isCollateral = assetLT > 0;
        if (!isCollateral) return null;

        const currentNumerator = totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
        const assetContribution = addedUSD * assetLT;
        const simulatedNumerator = currentNumerator + assetContribution;
        const simulatedHF = totalDebt > 0 ? simulatedNumerator / totalDebt : Infinity;

        return {
            currentHF: currentHF.toString(),
            simulatedHF: simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
            isSafe: simulatedHF > 1.5 || simulatedHF === Infinity,
        };
    }, [summary, selectedToken, supplyAmount]);

    // Contract Writes
    const handleApprove = async () => {
        if (!walletClient || !selectedToken || !poolAddress) return;
        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            const txHash = await walletClient.writeContract({
                account: getAddress(walletAddress),
                address: getAddress(selectedToken.underlyingAsset || selectedToken.address),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'approve',
                args: [getAddress(poolAddress), 2n ** 256n - 1n],
            });

            addTransaction({
                hash: txHash,
                chainId,
                description: `Approve ${selectedToken.symbol} for Aave Pool`,
                marketKey: marketKey || selectedNetwork.key,
            });

            if (publicClient) {
                await publicClient.waitForTransactionReceipt({ hash: txHash });
            }
            await fetchBalanceAndAllowance();
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Approval failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (!walletClient || !selectedToken || !poolAddress || supplyAmount === 0n) return;
        setIsLoading(true);
        setErrorText(null);

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            let txHash: `0x${string}`;
            const displaySymbol = hasNativeOption && isNativeSelected ? nativeInfo.native : selectedToken.symbol;

            if (hasNativeOption && isNativeSelected) {
                if (!gatewayAddress) throw new Error('WETH Gateway address missing');
                txHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(gatewayAddress),
                    abi: parseAbi(ABIS.WETH_GATEWAY),
                    functionName: 'depositETH',
                    args: [getAddress(poolAddress), getAddress(walletAddress), 0],
                    value: supplyAmount,
                });
            } else {
                txHash = await walletClient.writeContract({
                    account: getAddress(walletAddress),
                    address: getAddress(poolAddress),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'supply',
                    args: [getAddress(selectedToken.underlyingAsset || selectedToken.address), supplyAmount, getAddress(walletAddress), 0],
                });
            }

            addTransaction({
                hash: txHash,
                chainId,
                description: `Supply ${formatUnits(supplyAmount, selectedToken.decimals)} ${displaySymbol}`,
                marketKey: marketKey || selectedNetwork.key,
            });

            setIsSuccess(true);
            onSuccess?.();
            setTimeout(() => {
                onClose();
                setIsSuccess(false);
                setInputValue('');
                setSupplyAmount(0n);
            }, 2000);
        } catch (err: any) {
            setErrorText(err.shortMessage || err.message || 'Deposit failed');
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

    const isApproveRequired = allowance < supplyAmount;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Supply Assets"
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
                        <p className="text-xs text-slate-500 mt-1">Your supply request is processing on-chain.</p>
                    </div>
                ) : (
                    <>
                        {/* Token Selection Button */}
                        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                                    {selectedToken && (
                                        <img
                                            src={getTokenLogo(isNativeSelected ? nativeInfo.native : selectedToken.symbol)}
                                            alt={selectedToken.symbol}
                                            className="w-full h-full object-cover"
                                            onError={onTokenImgError(isNativeSelected ? nativeInfo.native : selectedToken.symbol)}
                                        />
                                    )}
                                </div>
                                <div>
                                    <div className="text-sm font-black uppercase tracking-wider text-slate-400">Asset</div>
                                    <button
                                        onClick={() => setTokenSelectorOpen(true)}
                                        className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white hover:opacity-80 transition-opacity"
                                    >
                                        <span>{isNativeSelected ? nativeInfo.native : selectedToken?.symbol}</span>
                                        <ChevronDown className="w-4 h-4 text-slate-400" />
                                    </button>
                                </div>
                            </div>

                            {/* Native/Wrapped toggle if WETH/wrapped token selected */}
                            {hasNativeOption && (
                                <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] font-bold">
                                    <button
                                        onClick={() => { setIsNativeSelected(true); setInputValue(''); setSupplyAmount(0n); }}
                                        className={`px-3 py-1.5 rounded-md transition-all ${isNativeSelected ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-400'}`}
                                    >
                                        {nativeInfo.native}
                                    </button>
                                    <button
                                        onClick={() => { setIsNativeSelected(false); setInputValue(''); setSupplyAmount(0n); }}
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
                                    Wallet Balance: {formatCompactNumber(formatUnits(balance, selectedToken?.decimals || 18))} {isNativeSelected ? nativeInfo.native : selectedToken?.symbol}
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
                                    <span className="text-sm font-bold text-slate-400">{isNativeSelected ? nativeInfo.native : selectedToken?.symbol}</span>
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

                        {/* Overview */}
                        {selectedToken && (
                            <div className="bg-slate-50 dark:bg-slate-800/20 rounded-2xl p-4 border border-slate-200/50 dark:border-slate-800/50 space-y-3 text-xs">
                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <span>Supply APY</span>
                                    <span className="font-mono font-bold text-emerald-500">{formatAPY((selectedToken.supplyAPY || 0) * 100)}</span>
                                </div>

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center gap-1">
                                        <span>Health Factor</span>
                                        <InfoTooltip content="Estimated Health Factor change after this deposit. High HF protects against liquidation." />
                                    </div>
                                    <div className="flex items-center gap-1.5 font-mono">
                                        <span>{formatHF(summary?.healthFactor)}</span>
                                        {simulation && (
                                            <>
                                                <span>→</span>
                                                <span className={simulation.isSafe ? 'text-emerald-500 font-bold' : 'text-amber-500 font-bold'}>
                                                    {formatHF(simulation.simulatedHF)}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center gap-1.5">
                                        <span>Gas Token Cost</span>
                                    </div>
                                    <span className="font-mono text-slate-500">&lt; $0.05</span>
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
                                    disabled={isLoading || supplyAmount === 0n}
                                    className="w-full py-6 text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Approve {selectedToken?.symbol}
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleConfirm}
                                    disabled={isLoading || supplyAmount === 0n}
                                    className="w-full py-6 text-sm font-bold bg-linear-to-r from-purple-600 to-blue-600 text-white rounded-2xl"
                                >
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Supply {isNativeSelected ? nativeInfo.native : selectedToken?.symbol}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Token Selector Modal */}
            <TokenSelector
                isOpen={tokenSelectorOpen}
                onClose={() => setTokenSelectorOpen(false)}
                onSelect={handleSelectToken}
                tokens={supplyableTokens}
                title="Select Asset to Supply"
                rateField="supplyAPY"
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
