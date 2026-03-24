import { ethers } from 'ethers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { buildDebtSwapTx } from '../services/api';
// Assuming these exist in transactionsApi.ts which will be migrated or is already present
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction } from '../services/transactions-api';

import { isUserRejectedError } from '../utils/logger';
import { calcApprovalAmount } from '../utils/swap-math';

interface UseDebtSwitchActionsProps {
    account: string | null;
    provider: any;
    networkRpcProvider: any;
    fromToken: any;
    toToken: any;
    allowance: bigint;
    swapAmount: bigint;
    debtBalance: bigint | null;
    swapQuote: any;
    slippage: number;
    addLog?: (message: string, type?: string) => void;
    fetchDebtData: () => void;
    fetchQuote: () => Promise<any>;
    resetRefreshCountdown: () => void;
    clearQuote: () => void;
    clearQuoteError?: () => void;
    selectedNetwork: any;
    simulateError?: boolean;
    preferPermit?: boolean;
    freezeQuote?: boolean;
    onTxSent?: (hash: string) => void;
}

export const useDebtSwitchActions = ({
    account,
    provider,
    fromToken,
    toToken,
    allowance,
    swapAmount,
    debtBalance,
    swapQuote,
    slippage,
    addLog,
    fetchDebtData,
    fetchQuote,
    clearQuote,
    clearQuoteError,
    selectedNetwork,
    preferPermit = true,
    onTxSent,
}: UseDebtSwitchActionsProps) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const [signedPermit, setSignedPermit] = useState<any>(null);
    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermit') === '1';
            }
        } catch {
            // Ignore localStorage unavailability.
        }

        return false;
    });
    const [txError, setTxError] = useState<string | null>(null);
    const [pendingTxParams] = useState<any>(null);
    const [lastAttemptedQuote, setLastAttemptedQuote] = useState<any>(null);
    const [userRejected, setUserRejected] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.txId');
            }
        } catch {
            // Ignore localStorage unavailability.
        }

        return null;
    });

    const updateCurrentTransactionId = (id: string | null) => {
        setCurrentTransactionId(id);

        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                if (id) {
                    window.localStorage.setItem('lilswap.txId', id);
                } else {
                    window.localStorage.removeItem('lilswap.txId');
                }
            }
        } catch {
            // Ignore localStorage unavailability.
        }
    };

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.DEBT_SWAP_ADAPTER) {
            return null;
        }

        try {
            return ethers.getAddress(networkAddresses.DEBT_SWAP_ADAPTER);
        } catch {
            return null;
        }
    }, [networkAddresses?.DEBT_SWAP_ADAPTER]);

    const chainId = targetNetwork.chainId;
    const targetHexChainId = targetNetwork.hexChainId;

    useEffect(() => {
        setSignedPermit(null);
        setTxError(null);
        setUserRejected(false);
        setIsActionLoading(false);
        setIsSigning(false);
    }, [fromToken?.symbol, fromToken?.address, toToken?.symbol, toToken?.address]);

    const ensureWalletNetwork = useCallback(async () => {
        if (!provider) {
            addLog?.('Provider unavailable.', 'error');

            return null;
        }

        try {
            const currentNetwork = await provider.getNetwork();

            if (Number(currentNetwork.chainId) === chainId) {
                return provider;
            }
        } catch {
            return null;
        }

        try {
            await provider.send('wallet_switchEthereumChain', [{ chainId: targetHexChainId }]);

            return provider;
        } catch {
            return null;
        }
    }, [provider, chainId, targetHexChainId, addLog]);

    const generateAndCachePermit = useCallback(async (debtTokenAddr: string, signer: any) => {
        try {
            const debtContract = new ethers.Contract(debtTokenAddr, ABIS.DEBT_TOKEN, signer);
            const [nonce, name] = await Promise.all([debtContract.nonces(account), debtContract.name()]);
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const value = ethers.MaxUint256;

            const domain = { name, version: '1', chainId, verifyingContract: debtTokenAddr };
            const types = {
                DelegationWithSig: [
                    { name: 'delegatee', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            };
            const message = { delegatee: adapterAddress, value, nonce, deadline };

            addLog?.('Requesting signature...', 'warning');
            const signature = await signer.signTypedData(domain, types, message);
            const sig = ethers.Signature.from(signature);

            const permitParams = { amount: value, deadline, v: sig.v, r: sig.r, s: sig.s };
            setSignedPermit({ params: permitParams, token: debtTokenAddr, deadline, value });
            setForceRequirePermit(false);
            window.localStorage.removeItem('lilswap.forceRequirePermit');

            return permitParams;
        } catch (err: any) {
            if (!isUserRejectedError(err)) {
                addLog?.('Signature failed: ' + err.message, 'error');
            }

            throw err;
        }
    }, [account, adapterAddress, addLog, chainId]);

    const handleApproveDelegation = useCallback(async (preferPermitOverride?: boolean) => {
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;

        if (!provider || !toToken || !adapterAddress) {
            return;
        }

        try {
            setIsActionLoading(true);
            setIsSigning(true);
            const signer = await provider.getSigner();
            let debtTokenAddress = toToken.variableDebtTokenAddress;

            if (!debtTokenAddress || debtTokenAddress === ethers.ZeroAddress) {
                const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
                const toReserveData = await poolContract.getReserveData(toToken.address || toToken.underlyingAsset);
                debtTokenAddress = toReserveData.variableDebtTokenAddress;
            }

            if (preferPermitFinal) {
                const permit = await generateAndCachePermit(debtTokenAddress, signer);

                return { type: 'permit', permit };
            }

            const debtContract = new ethers.Contract(debtTokenAddress, ABIS.DEBT_TOKEN, signer);
            const tx = await debtContract.approveDelegation(adapterAddress, ethers.MaxUint256);
            await tx.wait();
            fetchDebtData();

            return { type: 'tx', tx };
        } catch (error: any) {
            if (!isUserRejectedError(error)) {
                addLog?.('Approval error: ' + error.message, 'error');
            }

            throw error;
        } finally {
            setIsSigning(false);
            setIsActionLoading(false);
        }
    }, [provider, toToken, adapterAddress, networkAddresses, preferPermit, generateAndCachePermit, fetchDebtData, addLog]);

    const handleSwap = useCallback(async () => {
        if (!adapterAddress) {
            return;
        }

        setTxError(null);
        clearQuoteError?.();
        setUserRejected(false);

        if (debtBalance !== null && swapAmount > debtBalance) {
            addLog?.('Insufficient balance to perform this swap.', 'error');
            setTxError('Insufficient balance');

            return;
        }

        let activeQuote = swapQuote;

        if (!activeQuote) {
            addLog?.('Fetching quote...', 'info');
            activeQuote = await fetchQuote();

            if (!activeQuote) {
                return;
            }
        }

        const quoteAge = Math.floor(Date.now() / 1000) - (activeQuote.timestamp || 0);

        if (quoteAge > 300) {
            addLog?.('Quote expired, updating...', 'warning');
            activeQuote = await fetchQuote();

            if (!activeQuote) {
                return;
            }
        }

        setLastAttemptedQuote(activeQuote);
        setIsActionLoading(true);

        try {
            const activeProvider = await ensureWalletNetwork();

            if (!activeProvider) {
                return;
            }

            const signer = await activeProvider.getSigner();

            const { priceRoute, srcAmount, fromToken: qFrom, toToken: qTo } = activeQuote;
            const srcAmountBigInt = BigInt(srcAmount);
            const bufferBps = activeQuote?.bufferBps || 50;
            const maxNewDebt = calcApprovalAmount(srcAmountBigInt, bufferBps);
            const exactDebtRepayAmount = activeQuote.destAmount;

            let permitParams = { amount: 0n, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
            let newDebtTokenAddr = qTo.variableDebtTokenAddress;

            if (!newDebtTokenAddr || newDebtTokenAddr === ethers.ZeroAddress) {
                const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
                const toReserveData = await poolContract.getReserveData(qTo.address || qTo.underlyingAsset);
                newDebtTokenAddr = toReserveData.variableDebtTokenAddress;
            }

            if (allowance < maxNewDebt || forceRequirePermit) {
                if (forceRequirePermit || preferPermit) {
                    if (signedPermit && !forceRequirePermit && signedPermit.token === newDebtTokenAddr && signedPermit.deadline > Date.now() / 1000 && signedPermit.value >= maxNewDebt) {
                        permitParams = signedPermit.params;
                    } else {
                        const res = await handleApproveDelegation(true);
                        setIsActionLoading(true);

                        if (res?.permit) {
                            permitParams = res.permit;
                            setForceRequirePermit(false);
                            window.localStorage.removeItem('lilswap.forceRequirePermit');
                        } else {
                            throw new Error('Signature failed');
                        }
                    }
                } else {
                    await handleApproveDelegation(false);
                    setIsActionLoading(true);
                    await new Promise(r => setTimeout(r, 1000));
                    fetchDebtData();
                }
            }

            addLog?.('2/3 Building transaction...', 'info');
            const txResult = await buildDebtSwapTx({
                fromToken: { address: qFrom.address || qFrom.underlyingAsset, decimals: qFrom.decimals, symbol: qFrom.symbol },
                toToken: { address: qTo.address || qTo.underlyingAsset, decimals: qTo.decimals, symbol: qTo.symbol },
                priceRoute,
                adapterAddress,
                destAmount: exactDebtRepayAmount.toString(),
                srcAmount: srcAmount.toString(),
                apyPercent: activeQuote?.apyPercent ?? null,
                slippageBps: slippage,
                chainId,
                walletAddress: account,
            });

            const { transactionId, swapCallData, augustus, dynamicOffset } = txResult;
            updateCurrentTransactionId(transactionId);

            const encodedParaswapData = ethers.AbiCoder.defaultAbiCoder().encode(['bytes', 'address'], [swapCallData, augustus]);
            const swapParams = {
                debtAsset: qFrom.address || qFrom.underlyingAsset,
                debtRepayAmount: exactDebtRepayAmount,
                debtRateMode: 2,
                newDebtAsset: qTo.address || qTo.underlyingAsset,
                maxNewDebtAmount: maxNewDebt,
                extraCollateralAsset: ethers.ZeroAddress,
                extraCollateralAmount: 0n,
                offset: dynamicOffset || 0,
                paraswapData: encodedParaswapData,
            };

            const creditPermit = {
                debtToken: permitParams.amount === 0n ? ethers.ZeroAddress : newDebtTokenAddr,
                value: permitParams.amount,
                deadline: permitParams.deadline,
                v: permitParams.v,
                r: permitParams.r,
                s: permitParams.s,
            };

            const collateralPermit = { aToken: ethers.ZeroAddress, value: 0n, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

            addLog?.('3/3 Confirming in wallet...', 'warning');
            const adapterContract = new ethers.Contract(adapterAddress, ABIS.ADAPTER, signer);

            let gasLimit;

            try {
                const est = await adapterContract.swapDebt.estimateGas(swapParams, creditPermit, collateralPermit);
                gasLimit = (est * 150n) / 100n;

                if (gasLimit < 2000000n) {
                    gasLimit = 2000000n;
                }
            } catch {
                addLog?.('Gas estimation failed, using fallback.', 'warning');
                gasLimit = 4000000n;
            }

            const tx = await adapterContract.swapDebt(swapParams, creditPermit, collateralPermit, { gasLimit });
            addLog?.(`Tx sent: ${tx.hash}`, 'success');
            
            // EARLY HASH PULSE: Record hash immediately in the background
            if (transactionId) {
                recordTransactionHash(transactionId, tx.hash).catch(err => {
                    console.warn('[handleSwap] Early hash report failed:', err.message);
                });
            }

            onTxSent?.(tx.hash);

            const receipt = await tx.wait();

            if (receipt.status === 0) {
                throw new Error('Transaction reverted');
            }

            if (transactionId) {
                try {
                    await confirmTransactionOnChain(transactionId, {
                        gasUsed: receipt.gasUsed.toString(),
                        gasPrice: (receipt.gasPrice || receipt.effectiveGasPrice)?.toString(),
                        actualPaid: exactDebtRepayAmount.toString(),
                        // Rich metadata for instant sync
                        srcActualAmount: srcAmount.toString(),
                        priceImplicitUsd: activeQuote?.priceImplicitUsd || null
                    });
                } catch (confirmErr: any) {
                    console.warn('[handleSwap] Backend confirm failed:', confirmErr?.message);
                }
            }

            addLog?.('SUCCESS! Swap complete.', 'success');
            clearQuote();
            fetchDebtData();
        } catch (error: any) {
            if (isUserRejectedError(error)) {
                setUserRejected(true);
                addLog?.('Cancelled by user.', 'warning');

                if (currentTransactionId) {
                    await rejectTransaction(currentTransactionId, 'wallet_rejected');
                }
            } else {
                setTxError(error.message);
                addLog?.('Error: ' + error.message, 'error');
            }
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, allowance, swapQuote, fetchQuote, addLog, slippage, clearQuote, fetchDebtData, signedPermit, adapterAddress, networkAddresses, chainId, ensureWalletNetwork, preferPermit, forceRequirePermit, handleApproveDelegation, onTxSent, currentTransactionId, clearQuoteError]);

    return {
        isActionLoading, isSigning, signedPermit, forceRequirePermit, txError, pendingTxParams,
        lastAttemptedQuote, userRejected, handleApproveDelegation, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit: () => { }, setTxError
    };
};
