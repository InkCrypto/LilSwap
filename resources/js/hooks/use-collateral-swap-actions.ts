import { useCallback, useEffect, useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { ABIS } from '../constants/abis';
import { buildCollateralSwapTx } from '../services/api';
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction, failTransaction } from '../services/transactions-api';
import logger, { isUserRejectedError } from '../utils/logger';

interface UseCollateralSwapActionsProps {
    account: string | null;
    provider: any;
    networkRpcProvider: any;
    fromToken: any;
    toToken: any;
    allowance: bigint;
    swapAmount: bigint;
    supplyBalance: bigint | null;
    swapQuote: any;
    slippage: number;
    addLog?: (message: string, type?: string) => void;
    fetchPositionData: () => void;
    fetchQuote: () => Promise<any>;
    resetRefreshCountdown: () => void;
    clearQuote: () => void;
    clearQuoteError?: () => void;
    selectedNetwork: any;
    simulateError?: boolean;
    preferPermit?: boolean;
    forceRequirePermitOverride?: boolean;
    onTxSent?: (hash: string) => void;
}

export const useCollateralSwapActions = ({
    account,
    provider,
    networkRpcProvider,
    fromToken,
    toToken,
    allowance,
    swapAmount,
    supplyBalance,
    swapQuote,
    slippage,
    addLog,
    fetchPositionData,
    fetchQuote,
    resetRefreshCountdown,
    clearQuote,
    clearQuoteError,
    selectedNetwork,
    simulateError,
    preferPermit = true,
    forceRequirePermitOverride = false,
    onTxSent,
}: UseCollateralSwapActionsProps) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const [signedPermit, setSignedPermit] = useState<any>(null);
    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermitCol') === '1';
            }
        } catch (err) { }
        return false;
    });
    const [txError, setTxError] = useState<string | null>(null);
    const [userRejected, setUserRejected] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.colTxId');
            }
        } catch (_) { }
        return null;
    });

    const updateCurrentTransactionId = (id: string | null) => {
        setCurrentTransactionId(id);
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                if (id) window.localStorage.setItem('lilswap.colTxId', id);
                else window.localStorage.removeItem('lilswap.colTxId');
            }
        } catch (err) { }
    };

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.SWAP_COLLATERAL_ADAPTER) return null;
        try { return ethers.getAddress(networkAddresses.SWAP_COLLATERAL_ADAPTER); }
        catch (error) { return null; }
    }, [networkAddresses?.SWAP_COLLATERAL_ADAPTER]);

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
            addLog?.('Provider unavailable. Please reconnect your wallet.', 'error');
            return null;
        }
        try {
            const currentNetwork = await provider.getNetwork();
            if (Number(currentNetwork.chainId) === chainId) return provider;
        } catch (error: any) {
            addLog?.('Error reading current network: ' + error.message, 'error');
            return null;
        }
        if (!targetHexChainId) {
            addLog?.(`Target network chain ID not properly configured.`, 'error');
            return null;
        }
        try {
            await provider.send('wallet_switchEthereumChain', [{ chainId: targetHexChainId }]);
            addLog?.(`Network updated to ${targetNetwork.label}.`, 'success');
            return provider;
        } catch (error: any) {
            addLog?.(`Error switching to ${targetNetwork.label}: ${error?.message || error}`, 'error');
            return null;
        }
    }, [provider, chainId, targetHexChainId, targetNetwork.label, addLog]);

    const isValidATokenAddress = (addr: string) => {
        if (!addr || addr === ethers.ZeroAddress) return false;
        try {
            const val = BigInt(addr);
            return val > BigInt(0xff);
        } catch (_) {
            return false;
        }
    };

    const generateAndCachePermit = useCallback(async (aTokenAddr: string, signer: any, exactAmount?: bigint) => {
        try {
            const aTokenContract = new ethers.Contract(aTokenAddr, ABIS.DEBT_TOKEN, signer);
            let nonce;
            try {
                nonce = await aTokenContract.nonces(account);
            } catch (err: any) {
                if (err?.code === 'BAD_DATA' || err?.code === 'CALL_EXCEPTION') {
                    const noPermitErr: any = new Error('Token does not support EIP-2612 permit; use on-chain approve');
                    noPermitErr.code = 'NO_PERMIT';
                    throw noPermitErr;
                }
                throw err;
            }
            const name = await aTokenContract.name();
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const value = exactAmount || ethers.MaxUint256;

            const domain = { name, version: '1', chainId, verifyingContract: aTokenAddr };
            const types = {
                Permit: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            };
            const message = { owner: account, spender: adapterAddress, value, nonce, deadline };

            addLog?.('Requesting EIP-2612 signature for aToken...', 'warning');
            const signature = await signer.signTypedData(domain, types, message);
            const sig = ethers.Signature.from(signature);

            const permitParams = { amount: value, deadline, v: sig.v, r: sig.r, s: sig.s };
            setSignedPermit({ params: permitParams, token: aTokenAddr, deadline, value });
            setForceRequirePermit(false);
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('lilswap.forceRequirePermitCol'); } catch (err) { }
            addLog?.('Signature received and cached', 'success');
            return permitParams;
        } catch (err: any) {
            if (err?.code !== 'NO_PERMIT') {
                if (isUserRejectedError(err)) {
                    addLog?.('Signature request cancelled by user.', 'warning');
                } else {
                    addLog?.('Signature failed: ' + (err?.message || err), 'error');
                }
            }
            throw err;
        }
    }, [account, adapterAddress, addLog, chainId]);

    const handleApprove = useCallback(async (preferPermitOverride?: boolean, exactAmount?: bigint) => {
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;
        if (!provider || !fromToken) return;
        if (!adapterAddress) {
            addLog?.(`Invalid COLLATERAL_ADAPTER for ${targetNetwork.label}.`, 'error');
            return;
        }

        try {
            setIsActionLoading(true);
            setIsSigning(true);
            const signer = await provider.getSigner();

            let aTokenAddress = fromToken.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddress)) {
                const dataProvider = new ethers.Contract(networkAddresses.DATA_PROVIDER, ABIS.DATA_PROVIDER, networkRpcProvider || signer);
                const underlyingAsset = fromToken.address || fromToken.underlyingAsset;
                const tokenAddresses = await dataProvider.getReserveTokensAddresses(underlyingAsset);
                aTokenAddress = tokenAddresses.aTokenAddress;
            }

            if (preferPermitFinal) {
                addLog?.('Requesting signature (permit)...', 'info');
                const permit = await generateAndCachePermit(aTokenAddress, signer, exactAmount);
                return { type: 'permit', permit };
            }

            const aTokenContract = new ethers.Contract(aTokenAddress, ABIS.ERC20, signer);
            addLog?.('Sending Approval Tx...');
            const approveAmount = exactAmount || ethers.MaxUint256;
            const tx = await aTokenContract.approve(adapterAddress, approveAmount);
            addLog?.(`Tx sent: ${tx.hash}. Waiting...`, 'warning');
            await tx.wait();

            addLog?.('Approval confirmed!', 'success');
            fetchPositionData();
            return { type: 'tx', tx };
        } catch (error: any) {
            if (isUserRejectedError(error)) {
                addLog?.('Approval cancelled by user.', 'warning');
            } else {
                addLog?.('Approval error: ' + (error?.message || error), 'error');
            }
            throw error;
        } finally {
            setIsSigning(false);
            setIsActionLoading(false);
        }
    }, [provider, fromToken, addLog, fetchPositionData, networkAddresses, adapterAddress, targetNetwork.label, preferPermit, generateAndCachePermit, networkRpcProvider]);

    const handleSwap = useCallback(async () => {
        setTxError(null);
        clearQuoteError?.();
        setUserRejected(false);

        if (!adapterAddress) {
            addLog?.(`Invalid COLLATERAL_ADAPTER for ${targetNetwork.label}.`, 'error');
            return;
        }

        let localTxId: string | null = null;
        let activeQuote = swapQuote;

        if (!activeQuote) {
            addLog?.('Fetching quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) return;
        }

        const now = Math.floor(Date.now() / 1000);
        const quoteAge = now - (activeQuote.timestamp || 0);

        if (quoteAge > 300) {
            addLog?.(`⚠️ Quote is too old (${quoteAge}s). Updating...`, 'warning');
            activeQuote = await fetchQuote();
            if (!activeQuote) return;
        }

        setIsActionLoading(true);

        try {
            const activeProvider = await ensureWalletNetwork();
            if (!activeProvider) return;
            const signer = await activeProvider.getSigner();

            const { priceRoute, srcAmount, fromToken: quoteFrom, toToken: quoteTo } = activeQuote;
            const srcAmountBigInt = BigInt(srcAmount);
            let permitParams = { amount: 0n, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

            let aTokenAddr = quoteFrom.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddr)) {
                const dataProvider = new ethers.Contract(networkAddresses.DATA_PROVIDER, ABIS.DATA_PROVIDER, networkRpcProvider || signer);
                const tokenAddresses = await dataProvider.getReserveTokensAddresses(quoteFrom.address || quoteFrom.underlyingAsset);
                aTokenAddr = tokenAddresses.aTokenAddress;
            }

            if (signedPermit && signedPermit.token !== aTokenAddr) {
                setSignedPermit(null);
            }

            const effectivePreferPermit = forceRequirePermit || preferPermit;

            if (allowance < srcAmountBigInt || forceRequirePermit) {
                const currentTs = Math.floor(Date.now() / 1000);
                if (effectivePreferPermit) {
                    if (signedPermit && !forceRequirePermit && signedPermit.token === aTokenAddr && signedPermit.deadline > currentTs && signedPermit.value >= srcAmountBigInt) {
                        addLog?.('Using cached signature...', 'info');
                        permitParams = signedPermit.params;
                    } else {
                        addLog?.('Requesting Signature (permit)...', 'warning');
                        const permitAmount = srcAmountBigInt + (srcAmountBigInt * 100n / 10000n) + 1n;
                        let permitResult;
                        try {
                            permitResult = await handleApprove(true, permitAmount);
                        } catch (permitErr: any) {
                            if (permitErr?.code === 'NO_PERMIT') {
                                addLog?.('Permit not supported for this token, using on-chain approve...', 'info');
                                await handleApprove(false);
                                setIsActionLoading(true);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                fetchPositionData();
                                permitResult = null;
                            } else {
                                throw permitErr;
                            }
                        }
                        setIsActionLoading(true);
                        if (permitResult && permitResult.permit) {
                            permitParams = permitResult.permit;
                        } else if (permitResult !== null) {
                            throw new Error('Signature cancelled');
                        }
                    }
                } else {
                    addLog?.('Sending on-chain approval...', 'info');
                    await handleApprove(false);
                    setIsActionLoading(true);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    fetchPositionData();
                }
            }

            addLog?.('Building calldata...', 'warning');

            const isMaxSwap = !!supplyBalance && swapAmount >= supplyBalance;

            const normalizedFromToken = {
                ...quoteFrom,
                address: ethers.getAddress(quoteFrom.address || quoteFrom.underlyingAsset),
            };
            const normalizedToToken = {
                ...quoteTo,
                address: ethers.getAddress(quoteTo.address || quoteTo.underlyingAsset),
            };

            const txResult = await buildCollateralSwapTx({
                fromToken: normalizedFromToken,
                toToken: normalizedToToken,
                priceRoute,
                adapterAddress: adapterAddress,
                srcAmount: srcAmount.toString(),
                isMaxSwap,
                slippageBps: slippage,
                chainId,
                walletAddress: account,
            });

            const { transactionId, swapCallData, augustus, swapAllBalanceOffset, minAmountToReceive } = txResult;
            localTxId = transactionId;
            updateCurrentTransactionId(transactionId);

            const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'uint256', 'uint256', 'bytes', 'address', 'tuple(uint256,uint256,uint8,bytes32,bytes32)'],
                [
                    quoteTo.address || quoteTo.underlyingAsset,
                    minAmountToReceive,
                    swapAllBalanceOffset || 0,
                    swapCallData,
                    augustus,
                    [permitParams.amount, permitParams.deadline, permitParams.v, permitParams.r, permitParams.s]
                ]
            );

            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);

            if (simulateError) throw new Error('Simulation test failure.');

            const flashLoanArgs = [
                adapterAddress,
                quoteFrom.address || quoteFrom.underlyingAsset,
                srcAmountBigInt,
                encodedParams,
                0
            ];

            let gasLimit;
            try {
                const estimatedGas = await poolContract.flashLoanSimple.estimateGas(...flashLoanArgs);
                gasLimit = (estimatedGas * BigInt(150)) / BigInt(100);
            } catch (err: any) {
                let diagnosticReason = err?.reason || err?.data || err?.message;
                if (!String(diagnosticReason).match(/invalid character|could not coalesce error/i)) {
                    setTxError(String(diagnosticReason).substring(0, 500));
                    fetchQuote();
                    return;
                }
                gasLimit = BigInt(3000000);
            }

            addLog?.('Sending Transaction...', 'warning');

            const tx = await poolContract.flashLoanSimple(...flashLoanArgs, { gasLimit });
            addLog?.(`Tx sent! Hash: ${tx.hash}`, 'success');
            onTxSent?.(tx.hash);

            if (localTxId) await recordTransactionHash(localTxId, tx.hash);

            let receipt;
            try {
                receipt = await tx.wait();
            } catch (waitErr: any) {
                const waitMessage = String(waitErr?.message || '');
                const isTransientReceiptIssue =
                    waitErr?.code === 'BAD_DATA' ||
                    waitMessage.includes('invalid value for value.index') ||
                    waitMessage.includes('"result": null');

                if (!isTransientReceiptIssue) throw waitErr;

                addLog?.('Submitted successfully. Confirmation in background.', 'warning');
                clearQuote();
                updateCurrentTransactionId(null);
                fetchPositionData();
                return;
            }

            if (receipt.status === 0) throw new Error('Transaction reverted on-chain.');

            addLog?.('🚀 SUCCESS! Collateral Swap complete.', 'success');

            if (localTxId) {
                const gasUsed = receipt.gasUsed;
                const gasPrice = receipt.gasPrice || receipt.effectiveGasPrice;
                try {
                    await confirmTransactionOnChain(localTxId, {
                        gasUsed: gasUsed.toString(),
                        gasPrice: gasPrice?.toString(),
                        actualPaid: srcAmount.toString()
                    });
                } catch (confirmErr: any) {
                    logger.warn('[handleSwap] Backend confirm failed:', confirmErr?.message);
                }
            }

            clearQuote();
            updateCurrentTransactionId(null);
            fetchPositionData();

        } catch (error: any) {
            if (isUserRejectedError(error)) {
                setUserRejected(true);
                addLog?.('User rejected transaction.', 'warning');
                if (localTxId) try { await rejectTransaction(localTxId, 'wallet_rejected'); } catch (e) { }
            } else {
                setTxError(error.message || 'Swap failed.');
                addLog?.('FAILURE: ' + error.message, 'error');
            }
            resetRefreshCountdown();
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [
        account, allowance, swapAmount, supplyBalance, swapQuote, fetchQuote, addLog, provider, slippage, clearQuote, fetchPositionData,
        resetRefreshCountdown, signedPermit, adapterAddress, networkAddresses, chainId, ensureWalletNetwork,
        targetNetwork.label, preferPermit, forceRequirePermit, handleApprove, currentTransactionId, onTxSent,
        fromToken, toToken, networkRpcProvider
    ]);

    return {
        isActionLoading, isSigning, signedPermit, forceRequirePermit, txError, userRejected,
        handleApprove, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit: () => {}, setTxError,
    };
};
