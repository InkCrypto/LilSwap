import { useCallback, useEffect, useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { ABIS } from '../constants/abis.js';
import { buildCollateralSwapTx } from '../services/api.js';
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction, failTransaction } from '../services/transactionsApi.js';
import logger, { isUserRejectedError } from '../utils/logger.js';

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
    selectedNetwork,
    simulateError,
    preferPermit = true,
    forceRequirePermitOverride = false,
    onTxSent,
}) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const [signedPermit, setSignedPermit] = useState(null);
    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermitCol') === '1';
            }
        } catch (err) { }
        return false;
    });
    const [txError, setTxError] = useState(null);
    const [userRejected, setUserRejected] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.colTxId');
            }
        } catch (_) { }
        return null;
    });

    const updateCurrentTransactionId = id => {
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

    const augustusMap = networkAddresses.AUGUSTUS;
    const chainId = targetNetwork.chainId;
    const targetHexChainId = targetNetwork.hexChainId;

    // Clear ALL stale action state when EITHER token changes (from or to)
    // This prevents reuse of wrong token's permit, stale errors, and zombie loading state
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
        } catch (error) {
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
        } catch (error) {
            addLog?.(`Error switching to ${targetNetwork.label}: ${error?.message || error}`, 'error');
            return null;
        }
    }, [provider, chainId, targetHexChainId, targetNetwork.label, addLog]);

    // Guard against EVM precompile addresses (0x1–0x0a) and zero address being
    // used as aToken addresses (can happen when server returns stale/cross-chain data).
    const isValidATokenAddress = (addr) => {
        if (!addr || addr === ethers.ZeroAddress) return false;
        try {
            const val = BigInt(addr);
            return val > BigInt(0xff); // precompiles live at 0x01–0xff range
        } catch (_) {
            return false;
        }
    };

    const generateAndCachePermit = useCallback(async (aTokenAddr, signer, exactAmount) => {
        try {
            const aTokenContract = new ethers.Contract(aTokenAddr, ABIS.DEBT_TOKEN, signer); // EIP712 standard same as debt
            let nonce;
            try {
                nonce = await aTokenContract.nonces(account);
            } catch (err) {
                // BAD_DATA / CALL_EXCEPTION means this aToken does not implement EIP-2612 permit.
                // Signal the caller to fall back to on-chain approve.
                if (err?.code === 'BAD_DATA' || err?.code === 'CALL_EXCEPTION') {
                    const noPermitErr = new Error('Token does not support EIP-2612 permit; use on-chain approve');
                    noPermitErr.code = 'NO_PERMIT';
                    throw noPermitErr;
                }
                throw err;
            }
            const name = await aTokenContract.name();
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            // Use exact amount instead of MaxUint256 for better security and UX
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
        } catch (err) {
            if (err?.code !== 'NO_PERMIT') {
                if (isUserRejectedError(err)) {
                    addLog?.('Signature request cancelled by user.', 'warning');
                    logger.info('[useCollateralSwapActions] Signature cancelled by user');
                } else {
                    addLog?.('Signature failed: ' + (err?.message || err), 'error');
                }
            }
            throw err;
        }
    }, [account, adapterAddress, addLog, chainId]);

    const handleApprove = useCallback(async (preferPermitOverride, exactAmount) => {
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

            // fromToken is expected to have aTokenAddress populated
            let aTokenAddress = fromToken.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddress)) {
                logger.debug('[handleApprove] aTokenAddress invalid/precompile, fetching from DATA_PROVIDER:', aTokenAddress);
                // Use DATA_PROVIDER.getReserveTokensAddresses — simpler than POOL.getReserveData, immune to struct changes
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
            // Use exact amount for on-chain approval too (with buffer), fallback to MaxUint256
            const approveAmount = exactAmount || ethers.MaxUint256;
            const tx = await aTokenContract.approve(adapterAddress, approveAmount);
            addLog?.(`Tx sent: ${tx.hash}. Waiting...`, 'warning');
            await tx.wait();

            addLog?.('Approval confirmed!', 'success');
            fetchPositionData();
            return { type: 'tx', tx };
        } catch (error) {
            if (isUserRejectedError(error)) {
                addLog?.('Approval cancelled by user.', 'warning');
                logger.info('[useCollateralSwapActions] Approval cancelled by user');
            } else {
                addLog?.('Approval error: ' + (error?.message || error), 'error');
            }
            throw error;
        } finally {
            setIsSigning(false);
            setIsActionLoading(false);
        }
    }, [provider, fromToken, addLog, fetchPositionData, networkAddresses, adapterAddress, targetNetwork.label, preferPermit, generateAndCachePermit]);

    const handleSwap = useCallback(async () => {
        logger.debug('[useCollateralSwapActions] Swap initiated with:', {
            adapterAddress,
            fromToken: fromToken?.symbol,
            toToken: toToken?.symbol,
            swapQuote: !!swapQuote,
            provider: !!provider
        });

        if (!adapterAddress) {
            addLog?.(`Invalid COLLATERAL_ADAPTER for ${targetNetwork.label}.`, 'error');
            return;
        }

        setTxError(null);
        setUserRejected(false);
        let localTxId = null;

        let activeQuote = swapQuote;
        if (!activeQuote) {
            addLog?.('Fetching quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) {
                addLog?.('Failed to fetch quote', 'error');
                return;
            }
        }

        // Validate quote freshness (align with debt swap robustness)
        const now = Math.floor(Date.now() / 1000);
        const quoteAge = now - (activeQuote.timestamp || 0);
        logger.debug('[handleSwap] Quote age check:', { quoteAge, timestamp: activeQuote.timestamp });

        if (quoteAge > 300) {
            logger.debug('[handleSwap] Quote too old, refreshing...');
            addLog?.(`⚠️ Quote is too old (${quoteAge}s). Updating...`, 'warning');
            activeQuote = await fetchQuote();
            if (!activeQuote) {
                logger.error('[handleSwap] ❌ Failed to refresh quote');
                addLog?.('Failed to refresh quote', 'error');
                return;
            }
        }

        logger.debug('[handleSwap] Quote validated, proceeding...');

        setIsActionLoading(true);

        try {
            const activeProvider = await ensureWalletNetwork();
            if (!activeProvider) return;
            const signer = await activeProvider.getSigner();

            const { priceRoute, srcAmount, fromToken: quoteFrom, toToken: quoteTo } = activeQuote;
            const srcAmountBigInt = typeof srcAmount === 'bigint' ? srcAmount : BigInt(srcAmount);
            let permitParams = { amount: 0, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

            // Use quote's fromToken for aTokenAddr lookup (not closure fromToken) to avoid stale state
            let aTokenAddr = quoteFrom.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddr)) {
                logger.debug('[handleSwap] aTokenAddr invalid/precompile, fetching from DATA_PROVIDER:', aTokenAddr);
                // Use DATA_PROVIDER.getReserveTokensAddresses — simpler than POOL.getReserveData, immune to struct changes
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
                        // Add 1% buffer over srcAmount to cover slippage during execution
                        const permitAmount = srcAmountBigInt + (srcAmountBigInt * 100n / 10000n) + 1n;
                        let permitResult;
                        try {
                            permitResult = await handleApprove(true, permitAmount);
                        } catch (permitErr) {
                            if (permitErr?.code === 'NO_PERMIT') {
                                // aToken does not support EIP-2612 — fall back to on-chain approve
                                addLog?.('Permit not supported for this token, using on-chain approve...', 'info');
                                await handleApprove(false);
                                setIsActionLoading(true);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                await fetchPositionData();
                                // Continue with empty permitParams (on-chain approve was sent)
                                permitResult = null;
                            } else {
                                throw permitErr; // real error (user rejection, network error, etc.)
                            }
                        }
                        setIsActionLoading(true); // Re-assert true because handleApprove finally block clears it
                        if (permitResult && permitResult.permit) {
                            permitParams = permitResult.permit;
                        } else if (permitResult !== null) {
                            throw new Error('Signature cancelled');
                        }
                        // null means on-chain approve path was taken — continue without permit
                    }
                } else {
                    addLog?.('Sending on-chain approval...', 'info');
                    await handleApprove(false);
                    setIsActionLoading(true); // Re-assert true because handleApprove finally block clears it
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await fetchPositionData();
                }
            } else {
                addLog?.('Approval already given.', 'success');
            }

            addLog?.('Building calldata...', 'warning');

            const isMaxSwap = !!supplyBalance && swapAmount >= supplyBalance;

            // Normalize addresses to EIP-55 checksum format before sending to engine (ethers v5)
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

            addLog?.(`ParaSwap Route generated for Augustus: ${augustus}`, 'success');

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

            addLog?.('Estimating required gas...', 'info');

            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);

            if (simulateError) throw new Error('Simulation test failure.');

            // Call flashLoanSimple
            // (receiverAddress, asset, amount, params, referralCode)
            const flashLoanArgs = [
                adapterAddress,
                quoteFrom.address || quoteFrom.underlyingAsset,
                srcAmountBigInt,
                encodedParams,
                0 // referral code
            ];

            let gasLimit;
            try {
                const estimatedGas = await poolContract.flashLoanSimple.estimateGas(...flashLoanArgs);
                gasLimit = (estimatedGas * BigInt(150)) / BigInt(100);
                addLog?.(`Gas estimated: ${gasLimit.toString()}`, 'success');
            } catch (err) {
                logger.error('Gas estimation failed:', err);
                addLog?.('Simulation failed. Generating fallback gas limit.', 'warning');

                // If it's a revert (e.g., LTV drop, insufficient liquidity), maybe show the reason
                let diagnosticReason = err?.reason || err?.data || err?.message;
                if (!String(diagnosticReason).match(/invalid character|could not coalesce error/i)) {
                    setTxError(`Simulation failed: ${String(diagnosticReason).substring(0, 200)}`);
                    fetchQuote();
                    return;
                }

                // Basic fallback if RPC glitch
                gasLimit = BigInt(3000000);
            }

            addLog?.('Sending Transaction...', 'warning');

            const tx = await poolContract.flashLoanSimple(...flashLoanArgs, { gasLimit });
            addLog?.(`Tx sent! Hash: ${tx.hash}`, 'success');
            onTxSent?.(tx.hash);

            if (localTxId) {
                await recordTransactionHash(localTxId, tx.hash);
            }

            const receipt = await tx.wait();

            if (receipt.status === 0) {
                throw new Error('Transaction reverted on-chain.');
            }

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
                } catch (confirmErr) {
                    logger.warn('[handleSwap] Could not confirm tx in backend (non-critical):', confirmErr?.message);
                }
            }

            clearQuote();
            updateCurrentTransactionId(null);
            fetchPositionData();

        } catch (error) {
            if (isUserRejectedError(error)) {
                logger.info('[handleSwap] User cancelled action', {
                    code: error?.code,
                    name: error?.name,
                });
                setUserRejected(true);
                addLog?.('User rejected transaction.', 'warning');
                if (localTxId) {
                    try { await rejectTransaction(localTxId, 'wallet_rejected'); } catch (e) { }
                }
            } else {
                logger.error('[handleSwap] error', {
                    code: error?.code,
                    message: error?.message,
                    name: error?.name,
                });
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

    const clearTxError = useCallback(() => setTxError(null), []);
    const clearUserRejected = useCallback(() => setUserRejected(false), []);
    const clearCachedPermit = useCallback(async () => {
        // Clear in-memory cached signature
        setSignedPermit(null);
        // Force the next swap to request a fresh off-chain signature even if on-chain allowance exists
        setForceRequirePermit(true);
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('lilswap.forceRequirePermitCol', '1');
            }
        } catch (err) {
            logger.debug('[clearCachedPermit] failed to persist forceRequirePermitCol:', err?.message || err);
        }

        // Aggressive cleanup to avoid reusing a stale simulation or pending tx params
        setTxError(null);

        addLog?.('Cached permit cleared — next swap will request a fresh signature', 'success');

        // Ask wallet (if available) to forget site permissions / cached approvals.
        // This is best-effort: some wallets (MetaMask, Rabby) expose wallet_getPermissions / wallet_revokePermissions.
        const eipProvider = provider?.provider;
        if (eipProvider && eipProvider.request) {
            try {
                let perms = null;
                try {
                    perms = await eipProvider.request({ method: 'wallet_getPermissions' });
                    logger.debug('[clearCachedPermit] wallet_getPermissions:', perms);
                } catch (gErr) {
                    logger.debug('[clearCachedPermit] wallet_getPermissions not available or failed:', gErr?.message || gErr);
                }

                // Try to revoke account permissions (best-effort). This may disconnect the wallet/ui.
                try {
                    await eipProvider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
                    addLog?.('Requested wallet to forget site permissions — reconnect to continue', 'info');
                    logger.info('[clearCachedPermit] wallet_revokePermissions called');
                } catch (revErr) {
                    logger.debug('[clearCachedPermit] wallet_revokePermissions failed:', revErr?.message || revErr);
                    addLog?.('Wallet did not accept permission-revoke request. Please remove site trust in your wallet settings.', 'warning');
                }
            } catch (err) {
                logger.debug('[clearCachedPermit] wallet forget attempt failed:', err?.message || err);
            }
        } else {
            addLog?.('Wallet provider does not support permission revocation; clear cached permit in your wallet settings if needed.', 'info');
        }
    }, [setForceRequirePermit, addLog]);

    return {
        isActionLoading, isSigning, signedPermit, forceRequirePermit, txError, userRejected,
        handleApprove, handleSwap, clearTxError, clearUserRejected, clearCachedPermit, setTxError,
    };
};
