import {
    getAddress,
    parseAbi,
    parseSignature,
    zeroAddress,
    Hex,
    zeroHash,
    toHex,
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

const APPROVAL_GAS_LIMIT = 150_000n;
const PERMIT_TTL_SECONDS = 3600;
const PERMIT_MIN_VALIDITY_SECONDS = 60;

interface UseCollateralSwapActionsProps {
    account: string | null;
    fromToken: any;
    toToken: any;
    allowance: bigint;
    swapAmount: bigint;
    supplyBalance: bigint | null;
    isMaxSwap?: boolean;
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

const collectErrorDetails = (error: any) => {
    const details: string[] = [];
    const visited = new Set<any>();

    const visit = (value: any) => {
        if (!value || visited.has(value)) {
            return;
        }
        visited.add(value);

        for (const key of ['shortMessage', 'message', 'details', 'code', 'data']) {
            const entry = value?.[key];
            if (entry !== undefined && entry !== null && entry !== '') {
                details.push(String(entry));
            }
        }

        visit(value?.cause);
        visit(value?.error);
    };

    visit(error);

    return Array.from(new Set(details)).join(' | ');
};

const getRevertSelector = (error: any): string | null => {
    const explicitSelector = error?.details?.revertSelector
        || error?.responseData?.details?.revertSelector;
    if (typeof explicitSelector === 'string') {
        return explicitSelector.toLowerCase();
    }

    const details = collectErrorDetails(error);
    return details.match(/0x[a-fA-F0-9]{8}/)?.[0] || null;
};

const isInsufficientReturnAmountError = (error: any) => {
    const revertSelector = getRevertSelector(error);
    const details = collectErrorDetails(error).toLowerCase();

    return revertSelector === '0xcea9e31d'
        || details.includes('insufficientreturnamount')
        || details.includes('cannot satisfy the current minimum received amount');
};

export const useCollateralSwapActions = ({
    account,
    fromToken,
    toToken,
    allowance,
    swapAmount,
    supplyBalance,
    isMaxSwap = false,
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
    preFetchedTokenName,
    onSignatureCached,
    cachedPermit,
}: UseCollateralSwapActionsProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);

    const approvalAmount = useMemo(() => {
        try {
            return swapQuote?.approval?.amount ? BigInt(swapQuote.approval.amount) : 0n;
        } catch {
            return 0n;
        }
    }, [swapQuote?.approval?.amount]);

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

    const generateAndCachePermit = useCallback(async (aTokenAddr: string, exactAmount?: bigint, referenceTimestamp?: number) => {
        if (!walletClient || !account) return null;
        try {
            let nonce: bigint;
            let name: string;

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
                name = (results?.[1]?.status === 'success' ? (results[1].result as string) : preFetchedTokenName || '');

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

            // Aave V3 Base cbBTC aToken version() reverts. Fallback to '1' since it's the standard for Aave V3.
            const version = '1';

            const deadline = BigInt((referenceTimestamp ?? Math.floor(Date.now() / 1000)) + PERMIT_TTL_SECONDS);
            const value = exactAmount || approvalAmount;

            const domain = { name, version, chainId, verifyingContract: getAddress(aTokenAddr) };
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
            const sigData = { params: permitParams, token: aTokenAddr, deadline: Number(deadline), value, nonce };

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
    }, [account, walletClient, publicClient, adapterAddress, chainId, addLog, onSignatureCached, approvalAmount, preFetchedTokenName]);

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
                throw new Error('Unable to prepare approval token for collateral swap');
            }

            if (preferPermitFinal) {
                const permitAmount = exactAmount ?? approvalAmount;
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
                gas: APPROVAL_GAS_LIMIT,
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
    }, [walletClient, publicClient, account, fromToken, adapterAddress, providedATokenAddress, networkAddresses, addLog, fetchPositionData, preferPermit, generateAndCachePermit, approvalAmount]);

    const handleSwap = useCallback(async () => {
        setTxError(null);
        clearQuoteError?.();
        setUserRejected(false);

        const maxBalanceTolerance = supplyBalance !== null
            ? (supplyBalance / 10_000n) + 1n
            : 0n;
        const effectiveIsMaxSwap = Boolean(
            isMaxSwap &&
            supplyBalance !== null &&
            supplyBalance > 0n &&
            swapAmount + maxBalanceTolerance >= supplyBalance
        );

        if (!effectiveIsMaxSwap && supplyBalance !== null && swapAmount > supplyBalance) {
            setTxError('Amount is above the executable limit for the current balance.');
            addLog?.('Amount is above the executable limit for the current balance.', 'error');
            return;
        }

        if (!adapterAddress || !account || !walletClient) return;

        let localTxId: string | null = null;
        let swapDebugMeta: any = null;
        let preflightPassed = false;
        let walletPromptOpened = false;
        let diagnosticGasEstimate: string | null = null;
        let transactionRequest: any = null;
        let activeQuote = swapQuote;
        let failureStage = 'prepare';
        let executionSnapshot: any = null;

        if (!activeQuote) {
            addLog?.('Fetching latest quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) return;
        }

        if (Boolean(activeQuote?.execution?.isMaxSwap) !== effectiveIsMaxSwap) {
            addLog?.('Refreshing quote to match the selected amount...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote || Boolean(activeQuote?.execution?.isMaxSwap) !== effectiveIsMaxSwap) {
                const staleQuoteMessage = mapErrorToUserFriendly('COLLATERAL_MAX_QUOTE_STALE')
                    || 'This quote no longer matches the selected amount. Refresh and try again.';
                setTxError(staleQuoteMessage);
                addLog?.(staleQuoteMessage, 'warning');
                resetRefreshCountdown();
                return;
            }
        }

        setIsActionLoading(true);

        try {
            failureStage = 'network_check';
            const hasCorrectNetwork = await ensureWalletNetwork();
            if (!hasCorrectNetwork) return;

            const quoteTimestamp = Number(activeQuote?.chainTimestamp);
            const quoteTimestampObservedAtMs = Number(activeQuote?.chainTimestampObservedAtMs);
            const elapsedSinceQuoteSeconds = Number.isFinite(quoteTimestampObservedAtMs)
                ? Math.max(0, Math.floor((performance.now() - quoteTimestampObservedAtMs) / 1000))
                : 0;
            const referenceTimestamp = Number.isFinite(quoteTimestamp) && quoteTimestamp > 0
                ? quoteTimestamp + elapsedSinceQuoteSeconds
                : Math.floor(Date.now() / 1000);
            const minimumPermitDeadline = referenceTimestamp + PERMIT_MIN_VALIDITY_SECONDS;

            const { priceRoute, srcAmount, fromToken: quoteFrom, toToken: quoteTo } = activeQuote;
            let permitParams = { amount: 0n, deadline: 0, v: 0, r: zeroHash as Hex, s: zeroHash as Hex };

            let aTokenAddr = activeQuote?.approval?.token || providedATokenAddress || fromToken?.aTokenAddress || quoteFrom?.aTokenAddress;

            if (!isValidATokenAddress(aTokenAddr)) {
                throw new Error('Unable to prepare approval token for collateral swap');
            }

            const effectiveAllowance = allowance;

            const effectivePreferPermit = forceRequirePermit || preferPermit;

            const requiredAllowance = activeQuote?.approval?.amount
                ? BigInt(activeQuote.approval.amount)
                : approvalAmount;
            if (requiredAllowance <= 0n) {
                throw new Error('Unable to prepare approval amount for collateral swap');
            }

            if (!effectiveIsMaxSwap && supplyBalance !== null && swapAmount > supplyBalance) {
                setTxError('Amount is above the executable limit for the current balance.');
                addLog?.('Amount is above the executable limit for the current balance.', 'error');
                return;
            }

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
                    const permit = await generateAndCachePermit(aTokenAddr, permitAmount, referenceTimestamp);
                    const permitResult: any = permit ? { permit } : null;
                    setIsActionLoading(true);

                    if (!permitResult?.permit) {
                        return approveWithBoundedFallback('permit_result_missing');
                    }

                    const validation = getPermitValidation(permitResult.permit, minimumPermitDeadline);
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

            logger.debug(`[useCollateralSwapActions] Evaluation | Allowance: ${effectiveAllowance.toString()} | Required (with Premium): ${requiredAllowance.toString()} | ForcePermit: ${forceRequirePermit} | PreferPermit: ${preferPermit} | HasLocalSignature: ${!!cachedPermit}`);

            if (effectiveAllowance < requiredAllowance || forceRequirePermit) {
                if (effectivePreferPermit) {
                    failureStage = 'permit';
                    const effectiveSignedPermit = cachedPermit;

                    if (effectiveSignedPermit) {
                        let tokenMatch = false;
                        try {
                            tokenMatch = getAddress(effectiveSignedPermit.token) === getAddress(aTokenAddr);
                        } catch {
                            tokenMatch = false;
                        }
                        const deadlineValid = Number(effectiveSignedPermit.deadline || 0) > minimumPermitDeadline;
                        const cachedValue = toPermitAmount(effectiveSignedPermit.value);
                        const valueValid = cachedValue !== null && cachedValue >= requiredAllowance;
                        const cachedPermitValidation = getPermitValidation(effectiveSignedPermit.params, minimumPermitDeadline);

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
                    failureStage = 'approve';
                    await handleApprove(false, requiredAllowance, true, aTokenAddr);
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

            const finalMinimumPermitDeadline = referenceTimestamp + PERMIT_MIN_VALIDITY_SECONDS;
            let finalPermitValidation = getPermitValidation(permitParams, finalMinimumPermitDeadline);

            if (!finalPermitValidation.valid || !finalPermitValidation.params) {
                logger.warn('[useCollateralSwapActions] Blocking invalid collateral permit before build', {
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

            addLog?.('Building secure transaction calldata...', 'warning');
            failureStage = 'build';
            const baseBuildParams = {
                fromToken: { ...quoteFrom, address: getAddress(quoteFrom.address || quoteFrom.underlyingAsset) },
                toToken: { ...quoteTo, address: getAddress(quoteTo.address || quoteTo.underlyingAsset) },
                priceRoute,
                adapterAddress,
                srcAmount: srcAmount.toString(),
                isMaxSwap: effectiveIsMaxSwap,
                slippageBps: slippage,
                marketKey: marketKey || targetNetwork.key,
                chainId,
                walletAddress: account,
                permitParams: {
                    amount: permitParams.amount.toString(),
                    deadline: permitParams.deadline.toString(),
                    v: permitParams.v,
                    r: permitParams.r,
                    s: permitParams.s,
                },
                quoteExecution: activeQuote?.execution || null,
            };

            const txResult = await buildCollateralSwapTx(baseBuildParams);

            localTxId = txResult.transactionId;
            updateCurrentTransactionId(localTxId);
            swapDebugMeta = txResult?.debugFlags || null;
            const shouldSimulateBeforeSwap = txResult?.debugFlags?.simulateBeforeSwap === true;
            transactionRequest = txResult?.transactionRequest;
            if (!transactionRequest?.to || !transactionRequest?.data) {
                throw new Error('Backend did not return a transaction request for collateral swap');
            }
            logger.debug('[useCollateralSwapActions] Swap debug decision', {
                chainId,
                marketKey: marketKey || targetNetwork?.key,
                account,
                transactionId: localTxId,
                gasEstimate: txResult?.gasEstimate || null,
                swapDebug: swapDebugMeta,
            });

            diagnosticGasEstimate = txResult?.gasEstimate?.gas?.toString?.() || null;
            executionSnapshot = {
                chainId,
                transactionId: localTxId,
                isMaxSwap: effectiveIsMaxSwap,
                fromToken: quoteFrom?.symbol,
                toToken: quoteTo?.symbol,
                amount: srcAmount?.toString?.() || null,
                priceRouteSrcAmount: priceRoute?.srcAmount || null,
                priceRouteDestAmount: priceRoute?.destAmount || null,
                priceRouteSrcUSD: priceRoute?.srcUSD || null,
                priceRouteDestUSD: priceRoute?.destUSD || null,
                priceRoute,
                requestedSlippageBps: slippage,
                effectiveSlippageBps: txResult?.effectiveSlippageBps ?? null,
                minAmountToReceive: txResult?.minAmountToReceive ?? null,
                selector: txResult?.calldataDiagnostics?.selector || null,
                augustus: txResult?.augustus || null,
                offset: txResult?.swapAllBalanceOffset ?? null,
                amountOccurrences: txResult?.calldataDiagnostics?.amountOccurrences || [],
                fixedAmountOccurrences: txResult?.calldataDiagnostics?.fixedAmountOccurrences || [],
                hasPermit: BigInt(permitParams.amount || 0) > 0n,
                permitDeadline: permitParams.deadline || 0,
                chainTimestamp: txResult?.chainTimestamp || activeQuote?.chainTimestamp || null,
                chainTimestampSource: txResult?.chainTimestampSource || activeQuote?.chainTimestampSource || null,
            };
            logger.debug('[useCollateralSwapActions] Collateral execution snapshot', executionSnapshot);

            if (!publicClient) {
                throw new Error('Unable to verify transaction before execution. Please reconnect and try again.');
            }
            failureStage = 'preflight';
            addLog?.('Checking transaction...', 'info');
            await publicClient.call({
                account: getAddress(account),
                to: getAddress(transactionRequest.to),
                data: transactionRequest.data as Hex,
                value: BigInt(transactionRequest.value || 0),
            });
            preflightPassed = true;

            addLog?.('Confirm in your wallet...', 'warning');
            failureStage = 'wallet_send';
            walletPromptOpened = true;
            const hash = await walletClient.sendTransaction({
                account: getAddress(account),
                to: getAddress(transactionRequest.to),
                data: transactionRequest.data as Hex,
                value: BigInt(transactionRequest.value || 0),
            });
            onSignatureCached?.(null);

            addLog?.(`Transaction broadcasted: ${hash}`, 'success');
            if (localTxId) {
                void recordTransactionHash(localTxId, hash, { walletAddress: account }).then((recorded) => {
                    if (!recorded) {
                        addLog?.('Hash sync pending. We will retry automatically in the background.', 'warning');
                    }
                });
            }
            onTxSent?.(hash);

            failureStage = 'receipt';
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
            onSignatureCached?.(null);
            updateCurrentTransactionId(null);
            fetchPositionData();

        } catch (error: any) {
            if (isUserRejectedError(error)) {
                setUserRejected(true);
                addLog?.('User rejected swap.', 'warning');
                const rejectionReason = preflightPassed
                    ? 'wallet_rejected_after_preflight_passed'
                    : 'wallet_rejected';

                logger.error('[useCollateralSwapActions] Wallet request rejected after build', {
                    chainId,
                    marketKey: marketKey || targetNetwork?.key,
                    account,
                    transactionId: localTxId,
                    walletPromptOpened,
                    preflightPassed,
                    diagnosticGasEstimate,
                    target: transactionRequest?.to || null,
                    calldataSelector: transactionRequest?.data?.slice?.(0, 10) || null,
                    calldataLength: transactionRequest?.data?.length || null,
                    swapDebug: swapDebugMeta,
                    failureStage,
                    executionSnapshot,
                    error: {
                        name: error?.name || null,
                        shortMessage: error?.shortMessage || null,
                        message: error?.message || null,
                        details: error?.details || null,
                        code: error?.code || null,
                        data: error?.data || null,
                    },
                });

                if (localTxId) rejectTransaction(localTxId, rejectionReason).catch(() => { });
            } else {
                const diagnostic = collectErrorDetails(error);
                const revertSelector = getRevertSelector(error);
                const quoteMovedBeforeExecution = isInsufficientReturnAmountError(error);

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
                    revertSelector,
                };

                const technicalErrorMessage = diagnostic;
                const isExpectedValidation = technicalErrorMessage.includes('INSUFFICIENT_ATOKEN_BALANCE')
                    || technicalErrorMessage.includes('Amount is above the executable limit');
                const logFn = isExpectedValidation ? logger.warn : logger.error;

                logFn('[useCollateralSwapActions] Swap failure diagnostic', {
                    chainId,
                    marketKey: marketKey || targetNetwork?.key,
                    account,
                    fromToken: fromToken?.symbol,
                    toToken: toToken?.symbol,
                    swapAmount: swapAmount?.toString?.() || '0',
                    swapDebug: swapDebugMeta,
                    failureStage,
                    executionSnapshot,
                    walletPromptOpened,
                    preflightPassed,
                    diagnosticGasEstimate,
                    target: transactionRequest?.to || null,
                    calldataSelector: transactionRequest?.data?.slice?.(0, 10) || null,
                    calldataLength: transactionRequest?.data?.length || null,
                    diagnostic,
                    revertSelector,
                    error: errorSnapshot,
                    rawError: error,
                });

                if (quoteMovedBeforeExecution) {
                    const refreshedQuote = await fetchQuote();
                    const friendlyMessage = refreshedQuote
                        ? 'Price moved before execution. Quote updated; review it and confirm again.'
                        : 'Price moved before execution. Refresh the quote and try again.';

                    setTxError(friendlyMessage);
                    addLog?.(friendlyMessage, 'warning');
                    resetRefreshCountdown();
                    return;
                }

                const friendlyMessage = mapErrorToUserFriendly(technicalErrorMessage)
                    || 'Swap failed. Please try again.';

                setTxError(friendlyMessage);
                addLog?.(`Swap Failed: ${friendlyMessage}`, 'error');
            }
            resetRefreshCountdown();
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, walletClient, publicClient, allowance, swapAmount, supplyBalance, isMaxSwap, swapQuote, fetchQuote, addLog, slippage, providedAdapterAddress, providedATokenAddress, chainId, ensureWalletNetwork, targetNetwork?.key || '', preferPermit, forceRequirePermit, handleApprove, onTxSent, clearQuote, fetchPositionData, resetRefreshCountdown, cachedPermit, marketKey, clearQuoteError, approvalAmount]);

    return {
        isActionLoading, isSigning, signedPermit: cachedPermit, forceRequirePermit, txError, userRejected,
        handleApprove, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit, setTxError,
    };
};
