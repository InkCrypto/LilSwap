import {
    getAddress,
    formatUnits,
    parseAbi,
    parseSignature,
    zeroAddress,
    encodeAbiParameters,
    decodeEventLog,
    Hex,
    zeroHash,
    parseUnits
} from 'viem';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { buildCollateralSwapTx } from '../services/api';
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction } from '../services/transactions-api';
import logger, { isUserRejectedError } from '../utils/logger';
import { mapErrorToUserFriendly } from '../utils/error-mapping';

interface UseCollateralSwapActionsProps {
    account: string | null;
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
    preferPermit?: boolean;
    forceRequirePermitOverride?: boolean;
    marketKey?: string | null;
    onTxSent?: (hash: string) => void;
    adapterAddress?: string | null;
    aTokenAddress?: string | null;
    preFetchedNonce?: bigint | null;
    preFetchedTokenName?: string | null;
    onSignatureCached?: (sig: any) => void;
    cachedPermit?: any | null;
}

type CollateralPermitParams = {
    amount: bigint;
    deadline: number;
    v: number;
    r: Hex;
    s: Hex;
};

const EMPTY_COLLATERAL_PERMIT_PARAMS: CollateralPermitParams = {
    amount: 0n,
    deadline: 0,
    v: 0,
    r: zeroHash as Hex,
    s: zeroHash as Hex,
};

const isBytes32Hex = (value: unknown): value is Hex =>
    typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

const toPermitAmount = (value: unknown): bigint | null => {
    try {
        return BigInt(value as any);
    } catch {
        return null;
    }
};

const getPermitValidation = (params: any, now = Math.floor(Date.now() / 1000)) => {
    const amount = toPermitAmount(params?.amount);
    const deadline = Number(params?.deadline ?? 0);
    const v = Number(params?.v ?? 0);
    const r = params?.r;
    const s = params?.s;
    const rIsZero = r === zeroHash;
    const sIsZero = s === zeroHash;
    const amountNonZero = amount !== null && amount > 0n;
    const deadlineNonZero = Number.isFinite(deadline) && deadline > 0;

    const meta = {
        hasPermit: amountNonZero || deadlineNonZero || v !== 0 || !rIsZero || !sIsZero,
        deadlineNonZero,
        amountNonZero,
        v,
        rIsZero,
        sIsZero,
    };

    const isEmpty = amount === 0n && deadline === 0 && v === 0 && rIsZero && sIsZero;
    if (isEmpty) {
        return { valid: true, isEmpty: true, params: EMPTY_COLLATERAL_PERMIT_PARAMS, reason: null, meta };
    }

    if (amount === null) {
        return { valid: false, isEmpty: false, params: null, reason: 'invalid_amount', meta };
    }

    const invalidReason =
        !amountNonZero ? 'amount_zero' :
            !deadlineNonZero ? 'deadline_zero' :
                deadline <= now ? 'deadline_expired' :
                    (v !== 27 && v !== 28) ? 'invalid_v' :
                        !isBytes32Hex(r) ? 'invalid_r' :
                            !isBytes32Hex(s) ? 'invalid_s' :
                                rIsZero ? 'r_zero' :
                                    sIsZero ? 's_zero' :
                                        null;

    if (invalidReason) {
        return { valid: false, isEmpty: false, params: null, reason: invalidReason, meta };
    }

    return {
        valid: true,
        isEmpty: false,
        params: {
            amount,
            deadline,
            v,
            r: r as Hex,
            s: s as Hex,
        },
        reason: null,
        meta,
    };
};

const isMalformedPermitSignatureError = (error: any) => {
    const message = [
        error?.shortMessage,
        error?.details,
        error?.message,
        error?.cause?.shortMessage,
        error?.cause?.details,
        error?.cause?.message,
        error?.code,
    ].filter(Boolean).join(' ').toLowerCase();

    return message.includes('expected valid s')
        || message.includes('ecdsa')
        || message.includes('invalid signature')
        || message.includes('malformed signature');
};

export const useCollateralSwapActions = ({
    account,
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
    preferPermit = true,
    marketKey = null,
    onTxSent,
    adapterAddress: providedAdapterAddress,
    aTokenAddress: providedATokenAddress,
    preFetchedNonce,
    preFetchedTokenName,
    onSignatureCached,
    cachedPermit,
}: UseCollateralSwapActionsProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);

    // Calculate required allowance incorporating Aave V3 flashloan premium (default to 5 bps)
    const amountRequiredForAllowance = useMemo(() => {
        if (!swapAmount) return 0n;
        const premiumBps = swapQuote?.flashLoanPremiumBps !== undefined ? BigInt(swapQuote.flashLoanPremiumBps) : 5n;
        const premium = (swapAmount * premiumBps) / 10000n;
        return swapAmount + premium;
    }, [swapAmount, swapQuote?.flashLoanPremiumBps]);

    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermitCol') === '1';
            }
        } catch {
            return false;
        }
        return false;
    });
    const [txError, setTxError] = useState<string | null>(null);
    const [userRejected, setUserRejected] = useState(false);

    const updateCurrentTransactionId = (id: string | null) => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                if (id) {
                    window.localStorage.setItem('lilswap.colTxId', id);
                } else {
                    window.localStorage.removeItem('lilswap.colTxId');
                }
            }
        } catch {
            // Ignore
        }
    };

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = useMemo(() => {
        if (providedAdapterAddress) return providedAdapterAddress;
        if (!networkAddresses?.SWAP_COLLATERAL_ADAPTER) return null;
        try {
            return getAddress(networkAddresses.SWAP_COLLATERAL_ADAPTER);
        } catch {
            return null;
        }
    }, [providedAdapterAddress, networkAddresses?.SWAP_COLLATERAL_ADAPTER]);

    const chainId = targetNetwork.chainId;

    const clearCachedPermit = useCallback(() => {
        // No longer managing local state here; global cache manages persistence
    }, []);

    useEffect(() => {
        setTxError(null);
        setUserRejected(false);
        setIsActionLoading(false);
        setIsSigning(false);
    }, [fromToken?.symbol, fromToken?.address, toToken?.symbol, toToken?.address]);

    const ensureWalletNetwork = useCallback(async () => {
        if (!walletClient) {
            addLog?.('Wallet not connected.', 'error');
            return false;
        }
        const currentChainId = await walletClient.getChainId();
        if (currentChainId !== chainId) {
            try {
                await walletClient.switchChain({ id: chainId });
                return true;
            } catch (error: any) {
                addLog?.(`Error switching network: ${error.message}`, 'error');
                return false;
            }
        }
        return true;
    }, [walletClient, chainId, addLog]);

    const isValidATokenAddress = (addr: string) => {
        if (!addr || addr === zeroAddress) return false;
        try {
            return BigInt(addr) > BigInt(0xff);
        } catch {
            return false;
        }
    };

    const generateAndCachePermit = useCallback(async (aTokenAddr: string, exactAmount?: bigint) => {
        if (!walletClient || !account) return null;
        try {
            let nonce: bigint;
            let name: string;

            if (preFetchedNonce !== null && preFetchedNonce !== undefined && preFetchedTokenName) {
                nonce = preFetchedNonce;
                name = preFetchedTokenName;
            } else {
                try {
                    const calls = [
                        {
                            address: getAddress(aTokenAddr),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'nonces',
                            args: [getAddress(account)],
                        },
                        {
                            address: getAddress(aTokenAddr),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'name',
                        }
                    ];

                    const results = await publicClient?.multicall({
                        contracts: calls as any,
                        allowFailure: true,
                    });

                    nonce = (results?.[0]?.status === 'success' ? (results[0].result as bigint) : 0n);
                    name = (results?.[1]?.status === 'success' ? (results[1].result as string) : '');

                    if (!name) {
                        name = await publicClient?.readContract({
                            address: getAddress(aTokenAddr),
                            abi: parseAbi(ABIS.ERC20),
                            functionName: 'name',
                        }) as string;
                    }
                } catch (readErr: any) {
                    const noPermitErr: any = new Error('Token does not support EIP-2612 permit; use on-chain approve');
                    noPermitErr.code = 'NO_PERMIT';
                    noPermitErr.cause = readErr;
                    throw noPermitErr;
                }
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
            const value = exactAmount || (amountRequiredForAllowance + (amountRequiredForAllowance * 100n / 10000n) + 1n);

            const domain = { name, version: '1', chainId, verifyingContract: getAddress(aTokenAddr) };
            const types = {
                Permit: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            };
            const message = { owner: getAddress(account), spender: getAddress(adapterAddress!), value, nonce, deadline };

            addLog?.('Requesting signature for aToken (Permit)...', 'warning');
            
            const signature = await walletClient.signTypedData({
                account: getAddress(account),
                domain,
                types,
                primaryType: 'Permit',
                message,
            });

            // Keep parity with ethers.Signature.from(): robustly parse and normalize v to 27/28.
            const parsedSig = parseSignature(signature);
            const r = parsedSig.r as Hex;
            const s = parsedSig.s as Hex;
            let v = Number(parsedSig.v ?? (parsedSig.yParity === 0 ? 27n : 28n));
            if (v < 27) v += 27;

            logger.debug('[useCollateralSwapActions] Permit signature parsed', {
                chainId,
                token: aTokenAddr,
                signatureLength: signature?.length,
                v,
            });

            const permitParams = { amount: value, deadline: Number(deadline), v, r, s };
            const sigData = { params: permitParams, token: aTokenAddr, deadline: Number(deadline), value };

            onSignatureCached?.(sigData);
            setForceRequirePermit(false);

            addLog?.('Signature received and cached', 'success');
            return permitParams;
        } catch (err: any) {
            if (err?.code === 'NO_PERMIT') {
                throw err;
            }

            if (isUserRejectedError(err)) {
                addLog?.('Signature request cancelled.', 'warning');
            } else {
                addLog?.('Signature failed: ' + (err?.message || err), 'error');
            }
            throw err;
        }
    }, [account, walletClient, publicClient, adapterAddress, chainId, addLog, onSignatureCached]);

    const handleApprove = useCallback(async (preferPermitOverride?: boolean, exactAmount?: bigint, skipNetworkCheck?: boolean, aTokenAddressOverride?: string) => {
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;
        if (!walletClient || !fromToken || !adapterAddress || !account) return;

        try {
            setIsActionLoading(true);
            setIsSigning(true);

            if (!skipNetworkCheck) {
                if (!(await ensureWalletNetwork())) return;
            }

            let aTokenAddress = aTokenAddressOverride || providedATokenAddress || fromToken?.aTokenAddress;
            
            if (!isValidATokenAddress(aTokenAddress)) {
                addLog?.('Resolving aToken address...', 'info');
                const tokenAddresses = await publicClient?.readContract({
                    address: getAddress(networkAddresses.DATA_PROVIDER),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(fromToken.address || fromToken.underlyingAsset)],
                }) as any;
                aTokenAddress = tokenAddresses[0] || tokenAddresses.aTokenAddress;
            }

            if (preferPermitFinal) {
                const permitAmount = exactAmount ?? (amountRequiredForAllowance > 0n ? (amountRequiredForAllowance + (amountRequiredForAllowance * 100n / 10000n) + 1n) : 0n);
                const permit = await generateAndCachePermit(aTokenAddress, permitAmount);
                return { type: 'permit', permit };
            }

            addLog?.('Sending Approval Transaction...');
            const fallbackAmount = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
            const approveAmount = exactAmount ?? fallbackAmount;

            if (approveAmount <= 0n) {
                throw new Error('Invalid approval amount');
            }

            logger.debug('[useCollateralSwapActions] Sending approve', {
                chainId,
                token: aTokenAddress,
                spender: adapterAddress,
                amount: approveAmount.toString(),
            });

            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(aTokenAddress),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'approve',
                args: [getAddress(adapterAddress), approveAmount],
            });

            addLog?.(`Transaction sent: ${hash}. Waiting for confirmation...`, 'warning');
            await publicClient?.waitForTransactionReceipt({ hash });

            const confirmedAllowance = await publicClient?.readContract({
                address: getAddress(aTokenAddress),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'allowance',
                args: [getAddress(account), getAddress(adapterAddress)],
            }) as bigint || 0n;

            logger.debug('[useCollateralSwapActions] Post-approve allowance', {
                chainId,
                token: aTokenAddress,
                spender: adapterAddress,
                allowance: confirmedAllowance.toString(),
            });

            addLog?.('Approval confirmed!', 'success');
            fetchPositionData();
            return { type: 'tx', hash };
        } catch (error: any) {
            if (isUserRejectedError(error)) {
                addLog?.('Approval cancelled by user.', 'warning');
            } else {
                addLog?.('Approval error: ' + error.message, 'error');
            }
            throw error;
        } finally {
            setIsSigning(false);
            setIsActionLoading(false);
        }
    }, [walletClient, publicClient, account, fromToken, providedAdapterAddress, providedATokenAddress, networkAddresses, addLog, fetchPositionData, preferPermit, generateAndCachePermit]);

    const handleSwap = useCallback(async () => {
        setTxError(null);
        clearQuoteError?.();
        setUserRejected(false);

        if (supplyBalance !== null && swapAmount > supplyBalance) {
            setTxError('Insufficient balance');
            addLog?.('Insufficient balance for swap.', 'error');
            return;
        }

        if (!adapterAddress || !account || !walletClient) return;

        let localTxId: string | null = null;
        let simulationInProgress = false;
        let swapDebugMeta: any = null;
        let activeQuote = swapQuote;

        if (!activeQuote) {
            addLog?.('Fetching latest quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) return;
        }

        setIsActionLoading(true);

        try {
            const hasCorrectNetwork = await ensureWalletNetwork();
            if (!hasCorrectNetwork) return;

            const { priceRoute, srcAmount, fromToken: quoteFrom, toToken: quoteTo } = activeQuote;
            const srcAmountBigInt = BigInt(srcAmount);
            let permitParams = { amount: 0n, deadline: 0, v: 0, r: zeroHash as Hex, s: zeroHash as Hex };

            let aTokenAddr = providedATokenAddress || fromToken?.aTokenAddress || quoteFrom?.aTokenAddress;
            
            if (!isValidATokenAddress(aTokenAddr)) {
                addLog?.('Resolving aToken address...', 'info');
                const tokenAddresses = await publicClient?.readContract({
                    address: getAddress(networkAddresses.DATA_PROVIDER),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(quoteFrom.address || quoteFrom.underlyingAsset)],
                }) as any;
                aTokenAddr = tokenAddresses[0] || tokenAddresses.aTokenAddress;
            }

            // Trust the UI allowance provided via props to avoid redundant on-chain call
            const effectiveAllowance = allowance;

            const effectivePreferPermit = forceRequirePermit || preferPermit;

            // Calculate required allowance incorporating Aave V3 flashloan premium (default to 5 bps)
            const activePremiumBps = activeQuote?.flashLoanPremiumBps !== undefined ? BigInt(activeQuote.flashLoanPremiumBps) : 5n;
            const activePremium = (srcAmountBigInt * activePremiumBps) / 10000n;
            const requiredAllowance = srcAmountBigInt + activePremium;

            const approveWithBoundedFallback = async (reason: string) => {
                logger.warn('[useCollateralSwapActions] Falling back to on-chain approve for collateral permit', {
                    chainId,
                    token: aTokenAddr,
                    spender: adapterAddress,
                    reason,
                });
                addLog?.('Permit unavailable, using on-chain approve...', 'info');
                const boundedFallbackAmount = requiredAllowance + (requiredAllowance * 100n / 10000n) + 1n;
                await handleApprove(false, boundedFallbackAmount, true, aTokenAddr);
                setIsActionLoading(true);
                await new Promise(r => setTimeout(r, 1000));
                fetchPositionData();
                return EMPTY_COLLATERAL_PERMIT_PARAMS;
            };

            const requestPermitOrApprove = async () => {
                const permitAmount = requiredAllowance + (requiredAllowance * 100n / 10000n) + 1n;
                try {
                    const permitResult: any = await handleApprove(effectivePreferPermit, permitAmount, true, aTokenAddr);
                    setIsActionLoading(true);

                    if (!permitResult?.permit) {
                        return approveWithBoundedFallback('permit_result_missing');
                    }

                    const validation = getPermitValidation(permitResult.permit);
                    logger.debug('[useCollateralSwapActions] Fresh permit validation', {
                        chainId,
                        token: aTokenAddr,
                        spender: adapterAddress,
                        valid: validation.valid,
                        reason: validation.reason,
                        ...validation.meta,
                    });

                    if (!validation.valid || validation.isEmpty || !validation.params) {
                        return approveWithBoundedFallback(`fresh_permit_invalid:${validation.reason || 'empty'}`);
                    }

                    return validation.params;
                } catch (permitErr: any) {
                    if (permitErr?.code === 'NO_PERMIT' || isMalformedPermitSignatureError(permitErr)) {
                        return approveWithBoundedFallback(permitErr?.code === 'NO_PERMIT' ? 'no_permit' : 'malformed_signature');
                    }
                    throw permitErr;
                }
            };

            logger.debug(`[useCollateralSwapActions] Evaluation | Allowance: ${allowance.toString()} | Required (with Premium): ${requiredAllowance.toString()} | ForcePermit: ${forceRequirePermit} | PreferPermit: ${preferPermit} | HasLocalSignature: ${!!cachedPermit}`);

            if (effectiveAllowance < requiredAllowance || forceRequirePermit) {
                if (effectivePreferPermit) {
                    const effectiveSignedPermit = cachedPermit;

                    if (effectiveSignedPermit) {
                        let tokenMatch = false;
                        try {
                            tokenMatch = getAddress(effectiveSignedPermit.token) === getAddress(aTokenAddr);
                        } catch {
                            tokenMatch = false;
                        }
                        const deadlineValid = Number(effectiveSignedPermit.deadline || 0) > Math.floor(Date.now() / 1000);
                        const cachedValue = toPermitAmount(effectiveSignedPermit.value);
                        const valueValid = cachedValue !== null && cachedValue >= requiredAllowance;
                        const cachedPermitValidation = getPermitValidation(effectiveSignedPermit.params);

                        logger.debug('[useCollateralSwapActions] Cached permit validation', {
                            chainId,
                            token: aTokenAddr,
                            spender: adapterAddress,
                            tokenMatch,
                            deadlineValid,
                            valueValid,
                            permitValid: cachedPermitValidation.valid,
                            reason: cachedPermitValidation.reason,
                            cachedValue: cachedValue?.toString() || null,
                            requiredAllowance: requiredAllowance.toString(),
                            ...cachedPermitValidation.meta,
                        });

                        if (tokenMatch && deadlineValid && valueValid && cachedPermitValidation.valid && !cachedPermitValidation.isEmpty && cachedPermitValidation.params && !forceRequirePermit) {
                            logger.debug('[useCollateralSwapActions] REUSING successful cached permit');
                            permitParams = cachedPermitValidation.params;
                        } else {
                            logger.debug('[useCollateralSwapActions] Cached permit INVALID or EXPIRED, re-requesting...');
                            permitParams = await requestPermitOrApprove();
                        }
                    } else {
                        logger.debug('[useCollateralSwapActions] No local permit found, re-requesting...');
                        permitParams = await requestPermitOrApprove();
                    }
                } else {
                    await handleApprove(false, undefined, true, aTokenAddr);
                    setIsActionLoading(true);
                    await new Promise(r => setTimeout(r, 1500));
                    fetchPositionData();

                    // Defensive recheck for BSC: if allowance is still too tight, force explicit max approval once more.
                    const refreshedAllowance = await publicClient?.readContract({
                        address: getAddress(aTokenAddr),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'allowance',
                        args: [getAddress(account), getAddress(adapterAddress)],
                    }) as bigint || 0n;

                    if (chainId === 56 && refreshedAllowance < (requiredAllowance + 1_000_000_000_000n)) {
                        addLog?.('Allowance still tight after approval, retrying bounded approval...', 'warning');
                        const boundedRetryAmount = requiredAllowance + (requiredAllowance * 100n / 10000n) + 1n;
                        await handleApprove(false, boundedRetryAmount, true, aTokenAddr);
                        setIsActionLoading(true);
                        await new Promise(r => setTimeout(r, 1000));
                        fetchPositionData();
                    }
                }
            }

            addLog?.('Building secure transaction calldata...', 'warning');
            const baseBuildParams = {
                fromToken: { ...quoteFrom, address: getAddress(quoteFrom.address || quoteFrom.underlyingAsset) },
                toToken: { ...quoteTo, address: getAddress(quoteTo.address || quoteTo.underlyingAsset) },
                priceRoute,
                adapterAddress,
                srcAmount: srcAmount.toString(),
                isMaxSwap: supplyBalance !== null && swapAmount >= supplyBalance,
                slippageBps: slippage,
                marketKey: marketKey || targetNetwork.key,
                chainId,
                walletAddress: account,
            };

            let txResult;
            try {
                txResult = await buildCollateralSwapTx(baseBuildParams);
            } catch (buildError: any) {
                if (String(buildError?.message || '').includes('MAX_SWAP_OFFSET_NOT_FOUND') && baseBuildParams.isMaxSwap) {
                    addLog?.('Retrying build without max offset path...', 'info');
                    txResult = await buildCollateralSwapTx({
                        ...baseBuildParams,
                        isMaxSwap: false,
                    });
                } else {
                    throw buildError;
                }
            }

            localTxId = txResult.transactionId;
            updateCurrentTransactionId(localTxId);
            swapDebugMeta = txResult?.debugFlags || null;
            const shouldSimulateBeforeSwap = txResult?.debugFlags?.simulateBeforeSwap === true;
            logger.debug('[useCollateralSwapActions] Swap debug decision', {
                chainId,
                marketKey: marketKey || targetNetwork?.key,
                account,
                transactionId: localTxId,
                swapDebug: swapDebugMeta,
            });

            const finalPermitValidation = getPermitValidation(permitParams);
            if (!finalPermitValidation.valid || !finalPermitValidation.params) {
                logger.warn('[useCollateralSwapActions] Blocking invalid collateral permit before encoding', {
                    chainId,
                    token: aTokenAddr,
                    spender: adapterAddress,
                    reason: finalPermitValidation.reason,
                    ...finalPermitValidation.meta,
                });
                permitParams = EMPTY_COLLATERAL_PERMIT_PARAMS;
            } else {
                permitParams = finalPermitValidation.params;
            }

            logger.debug('[useCollateralSwapActions] Permit params encoding metadata', {
                chainId,
                token: aTokenAddr,
                spender: adapterAddress,
                ...getPermitValidation(permitParams).meta,
            });

            // Use explicit params definition to avoid abitype inference errors
            const encodedParams = encodeAbiParameters(
                [
                    { name: 'assetToReceive', type: 'address' },
                    { name: 'minAmountToReceive', type: 'uint256' },
                    { name: 'swapAllBalanceOffset', type: 'uint256' },
                    { name: 'swapCallData', type: 'bytes' },
                    { name: 'augustus', type: 'address' },
                    {
                        name: 'permitParams',
                        type: 'tuple',
                        components: [
                            { name: 'amount', type: 'uint256' },
                            { name: 'deadline', type: 'uint256' },
                            { name: 'v', type: 'uint8' },
                            { name: 'r', type: 'bytes32' },
                            { name: 's', type: 'bytes32' }
                        ]
                    }
                ],
                [
                    getAddress(quoteTo.address || quoteTo.underlyingAsset),
                    BigInt(txResult.minAmountToReceive || 0),
                    BigInt(txResult.swapAllBalanceOffset || 0),
                    (txResult.swapCallData || '0x') as Hex,
                    getAddress(txResult.augustus || zeroAddress),
                    {
                        amount: permitParams.amount,
                        deadline: BigInt(permitParams.deadline),
                        v: permitParams.v,
                        r: permitParams.r,
                        s: permitParams.s
                    }
                ]
            );

            const flashLoanArgs = [
                getAddress(adapterAddress),
                getAddress(quoteFrom.address || quoteFrom.underlyingAsset),
                srcAmountBigInt,
                encodedParams,
                0
            ] as const;

            if (shouldSimulateBeforeSwap) {
                addLog?.('Running debug simulation before sending transaction...', 'info');
                simulationInProgress = true;
                await publicClient?.simulateContract({
                    account: getAddress(account),
                    address: getAddress(networkAddresses.POOL),
                    abi: parseAbi(ABIS.POOL),
                    functionName: 'flashLoanSimple',
                    args: flashLoanArgs,
                });
                simulationInProgress = false;
            }

            addLog?.('Confirm in your wallet...', 'warning');
            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(networkAddresses.POOL),
                abi: parseAbi(ABIS.POOL),
                functionName: 'flashLoanSimple',
                args: flashLoanArgs,
            });

            addLog?.(`Transaction broadcasted: ${hash}`, 'success');
            if (localTxId) {
                void recordTransactionHash(localTxId, hash, { walletAddress: account }).then((recorded) => {
                    if (!recorded) {
                        addLog?.('Hash sync pending. We will retry automatically in the background.', 'warning');
                    }
                });
            }
            onTxSent?.(hash);

            const receipt = await publicClient?.waitForTransactionReceipt({ hash });

            if (receipt?.status === 'reverted') throw new Error('Transaction reverted on-chain.');

            addLog?.('🚀 Swap Complete!', 'success');
            if (localTxId) {
                confirmTransactionOnChain(localTxId, {
                    gasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : '0',
                    actualPaid: srcAmount.toString(),
                }).catch(() => { });
            }

            clearQuote();
            updateCurrentTransactionId(null);
            fetchPositionData();

        } catch (error: any) {
            if (isUserRejectedError(error)) {
                setUserRejected(true);
                addLog?.('User rejected swap.', 'warning');
                if (localTxId) rejectTransaction(localTxId, 'wallet_rejected').catch(() => { });
            } else {
                const diagnostic = Array.from(new Set([
                    error?.shortMessage,
                    error?.details,
                    error?.code,
                    error?.cause?.shortMessage,
                    error?.cause?.details,
                    error?.cause?.code,
                ].filter(Boolean).map((entry) => String(entry)))).join(' | ');

                const errorSnapshot = {
                    name: error?.name || null,
                    shortMessage: error?.shortMessage || null,
                    message: error?.message || null,
                    details: error?.details || null,
                    code: error?.code || null,
                    data: error?.data || null,
                    cause: {
                        name: error?.cause?.name || null,
                        shortMessage: error?.cause?.shortMessage || null,
                        message: error?.cause?.message || null,
                        details: error?.cause?.details || null,
                        code: error?.cause?.code || null,
                        data: error?.cause?.data || null,
                    },
                };

                logger.error('[useCollateralSwapActions] Swap failure diagnostic', {
                    chainId,
                    marketKey: marketKey || targetNetwork?.key,
                    account,
                    fromToken: fromToken?.symbol,
                    toToken: toToken?.symbol,
                    swapAmount: swapAmount?.toString?.() || '0',
                    swapDebug: swapDebugMeta,
                    diagnostic,
                    error: errorSnapshot,
                    rawError: error,
                });

                const technicalErrorMessage = Array.from(new Set([
                    error?.shortMessage,
                    error?.message,
                    error?.details,
                    error?.cause?.shortMessage,
                    error?.cause?.message,
                    error?.cause?.details,
                ].filter(Boolean).map((entry) => String(entry)))).join(' | ');
                const friendlyMessage = mapErrorToUserFriendly(technicalErrorMessage)
                    || (simulationInProgress
                        ? 'Simulation failed. Try increasing slippage or reducing amount.'
                        : 'Swap failed. Please try again.');

                setTxError(friendlyMessage);
                addLog?.(`Swap Failed: ${friendlyMessage}`, 'error');
            }
            resetRefreshCountdown();
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, walletClient, publicClient, allowance, swapAmount, supplyBalance, swapQuote, fetchQuote, addLog, slippage, providedAdapterAddress, providedATokenAddress, networkAddresses, chainId, ensureWalletNetwork, targetNetwork?.key || '', preferPermit, forceRequirePermit, handleApprove, onTxSent, clearQuote, fetchPositionData, resetRefreshCountdown, cachedPermit, marketKey, clearQuoteError]);

    return {
        isActionLoading, isSigning, signedPermit: cachedPermit, forceRequirePermit, txError, userRejected,
        handleApprove, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit, setTxError,
    };
};
