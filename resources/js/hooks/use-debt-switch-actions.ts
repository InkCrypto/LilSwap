import {
    getAddress,
    formatUnits,
    parseAbi,
    parseSignature,
    zeroAddress,
    encodeAbiParameters,
    Hex,
    zeroHash,
} from 'viem';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { buildDebtSwapTx } from '../services/api';
import logger from '../utils/logger';
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction } from '../services/transactions-api';
import { isUserRejectedError } from '../utils/logger';
import { calcApprovalAmount } from '../utils/swap-math';
import { mapErrorToUserFriendly } from '../utils/error-mapping';

const DELEGATION_GAS_LIMIT = 180_000n;
const SWAP_GAS_LIMIT_FALLBACK = 2_500_000n;
const SWAP_GAS_LIMIT_MAX = 8_000_000n;
const EXECUTION_GAS_BUFFER_BPS = 2_000n;

const parseGasLimit = (value: unknown): bigint | null => {
    if (value == null || value === '') {
        return null;
    }

    try {
        return BigInt(value as string | number | bigint);
    } catch {
        return null;
    }
};

const resolveSwapGasLimit = (txResult: any, priceRoute: any): bigint => {
    const explicitGas = parseGasLimit(txResult?.gas);

    if (explicitGas && explicitGas > 0n) {
        return explicitGas;
    }

    const routeGas = parseGasLimit(priceRoute?.gasCost);

    if (!routeGas || routeGas <= 0n) {
        return SWAP_GAS_LIMIT_FALLBACK;
    }

    const buffered = routeGas * 4n + 500_000n;

    if (buffered < SWAP_GAS_LIMIT_FALLBACK) {
        return SWAP_GAS_LIMIT_FALLBACK;
    }

    if (buffered > SWAP_GAS_LIMIT_MAX) {
        return SWAP_GAS_LIMIT_MAX;
    }

    return buffered;
};

const applyExecutionGasBuffer = (estimatedGas: bigint): bigint => {
    const buffered = estimatedGas + (estimatedGas * EXECUTION_GAS_BUFFER_BPS / 10_000n);

    return buffered > SWAP_GAS_LIMIT_MAX ? SWAP_GAS_LIMIT_MAX : buffered;
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
    const details = collectErrorDetails(error);
    return details.match(/0x[a-fA-F0-9]{8}/)?.[0] || null;
};

interface UseDebtSwitchActionsProps {
    account: string | null;
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
    preferPermit?: boolean;
    marketKey?: string | null;
    onTxSent?: (hash: string) => void;
    freezeQuote?: boolean;
    onSignatureCached?: (sig: any) => void;
    cachedPermit?: any | null;
    adapterAddress?: string | null;
    debtTokenAddress?: string | null;
    preFetchedNonce?: bigint | null;
    preFetchedTokenName?: string | null;
}

export const useDebtSwitchActions = ({
    account,
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
    marketKey = null,
    onTxSent,
    freezeQuote = false,
    onSignatureCached,
    cachedPermit,
    adapterAddress: providedAdapterAddress,
    debtTokenAddress: providedDebtTokenAddress,
    preFetchedTokenName,
}: UseDebtSwitchActionsProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);

    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermit') === '1';
            }
        } catch {
            return false;
        }
        return false;
    });
    const [txError, setTxError] = useState<string | null>(null);
    const [lastAttemptedQuote, setLastAttemptedQuote] = useState<any>(null);
    const [userRejected, setUserRejected] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.txId');
            }
        } catch {
            return null;
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
            // Ignore
        }
    };

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = useMemo(() => {
        if (providedAdapterAddress) return providedAdapterAddress;
        if (!networkAddresses?.DEBT_SWAP_ADAPTER) return null;
        try {
            return getAddress(networkAddresses.DEBT_SWAP_ADAPTER);
        } catch {
            return null;
        }
    }, [providedAdapterAddress, networkAddresses?.DEBT_SWAP_ADAPTER]);

    const chainId = targetNetwork.chainId;

    const clearCachedPermit = useCallback(() => {
        // Managed by global cache
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

    const generateAndCachePermit = useCallback(async (debtTokenAddr: string, exactAmount: bigint) => {
        if (!walletClient || !account) return null;
        try {
            if (exactAmount <= 0n) {
                throw new Error('Invalid delegation amount');
            }

            let nonce: bigint;
            let name: string;

            const calls = [
                {
                    address: getAddress(debtTokenAddr),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
                    functionName: 'nonces',
                    args: [getAddress(account)],
                },
                {
                    address: getAddress(debtTokenAddr),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
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
                    address: getAddress(debtTokenAddr),
                    abi: parseAbi(ABIS.DEBT_TOKEN),
                    functionName: 'name',
                }) as string;
            }

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
            const value = exactAmount;

            const domain = { name, version: '1', chainId, verifyingContract: getAddress(debtTokenAddr) };
            const types = {
                DelegationWithSig: [
                    { name: 'delegatee', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            };
            const message = { delegatee: getAddress(adapterAddress!), value, nonce, deadline };

            addLog?.('Requesting delegation signature...', 'warning');
            const signature = await walletClient.signTypedData({
                account: getAddress(account),
                domain,
                types,
                primaryType: 'DelegationWithSig',
                message,
            });

            const parsedSig = parseSignature(signature);
            const r = parsedSig.r as Hex;
            const s = parsedSig.s as Hex;
            let v = Number(parsedSig.v ?? (parsedSig.yParity === 0 ? 27n : 28n));
            if (v < 27) v += 27;

            const permitParams = { amount: value, deadline: Number(deadline), v, r, s };
            const sigData = { params: permitParams, token: debtTokenAddr, deadline: Number(deadline), value, nonce };

            onSignatureCached?.(sigData);
            setForceRequirePermit(false);

            return permitParams;
        } catch (err: any) {
            if (!isUserRejectedError(err)) {
                addLog?.('Signature failed: ' + err.message, 'error');
            }
            throw err;
        }
    }, [account, walletClient, publicClient, adapterAddress, chainId, addLog, preFetchedTokenName, onSignatureCached]);

    const handleApproveDelegation = useCallback(async (preferPermitOverride?: boolean, exactAmount?: bigint, skipNetworkCheck?: boolean, debtTokenAddressOverride?: string) => {
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;
        if (!walletClient || !toToken || !adapterAddress || !account) return;

        try {
            setIsActionLoading(true);
            setIsSigning(true);

            if (!skipNetworkCheck) {
                if (!(await ensureWalletNetwork())) return;
            }

            let debtTokenAddress = debtTokenAddressOverride || providedDebtTokenAddress || toToken?.variableDebtTokenAddress;

            if (!debtTokenAddress || debtTokenAddress === zeroAddress) {
                logger.debug('[useDebtSwitchActions] Resolving debt token address via on-chain read (not available from position data)');
                const toReserveData = await publicClient?.readContract({
                    address: getAddress(networkAddresses.POOL),
                    abi: parseAbi(ABIS.POOL_GETTER),
                    functionName: 'getReserveData',
                    args: [getAddress(toToken.address || toToken.underlyingAsset)],
                }) as any;
                debtTokenAddress = toReserveData.variableDebtTokenAddress || toReserveData[11];
            }

            if (!exactAmount || exactAmount <= 0n) {
                throw new Error('Invalid approval amount');
            }

            if (preferPermitFinal) {
                const permit = await generateAndCachePermit(debtTokenAddress, exactAmount);
                return { type: 'permit', permit };
            }

            addLog?.('Sending Approval Transaction...');
            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(debtTokenAddress),
                abi: parseAbi(ABIS.DEBT_TOKEN),
                functionName: 'approveDelegation',
                args: [getAddress(adapterAddress), exactAmount],
                gas: DELEGATION_GAS_LIMIT,
            });

            await publicClient?.waitForTransactionReceipt({ hash });
            fetchDebtData();

            return { type: 'tx', hash };
        } catch (error: any) {
            if (!isUserRejectedError(error)) {
                addLog?.('Approval error: ' + error.message, 'error');
            }
            throw error;
        } finally {
            setIsSigning(false);
            setIsActionLoading(false);
        }
    }, [walletClient, publicClient, account, toToken, adapterAddress, networkAddresses, preferPermit, generateAndCachePermit, fetchDebtData, addLog]);

    const handleSwap = useCallback(async () => {
        if (!account || !walletClient) return;

        if (!adapterAddress) {
            addLog?.('Critical error: Adapter address not configured for this network', 'error');
            setTxError('System configuration error: Swap adapter missing.');
            return;
        }

        setTxError(null);
        clearQuoteError?.();
        setUserRejected(false);

        if (debtBalance !== null && swapAmount > debtBalance) {
            addLog?.('Insufficient debt balance.', 'error');
            setTxError('Insufficient balance');
            return;
        }

        let activeQuote = swapQuote;
        let simulationInProgress = false;
        let swapDebugMeta: any = null;
        let localTxId: string | null = null;
        let preflightPassed = false;
        let walletPromptOpened = false;
        let finalGasLimit: bigint | null = null;
        if (!activeQuote) {
            addLog?.('Fetching quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) return;
        }

        setLastAttemptedQuote(activeQuote);
        setIsActionLoading(true);

        try {
            const hasCorrectNetwork = await ensureWalletNetwork();
            if (!hasCorrectNetwork) return;

            const { priceRoute, srcAmount, fromToken: qFrom, toToken: qTo } = activeQuote;
            const srcAmountBigInt = BigInt(srcAmount);
            const bufferBps = activeQuote?.bufferBps ?? 70;
            const maxNewDebt = calcApprovalAmount(srcAmountBigInt, bufferBps);
            const exactDebtRepayAmount = activeQuote.destAmount;

            let permitParams = { amount: 0n, deadline: 0, v: 0, r: zeroHash as Hex, s: zeroHash as Hex };
            let newDebtTokenAddr = providedDebtTokenAddress || toToken?.variableDebtTokenAddress || qTo?.variableDebtTokenAddress;

            if (!newDebtTokenAddr || newDebtTokenAddr === zeroAddress) {
                addLog?.('Resolving debt token address...', 'info');
                logger.debug('[useDebtSwitchActions] Resolving debt token address via on-chain read (not available from position data)');
                const toReserveData = await publicClient?.readContract({
                    address: getAddress(networkAddresses.POOL),
                    abi: parseAbi(ABIS.POOL_GETTER),
                    functionName: 'getReserveData',
                    args: [getAddress(qTo.address || qTo.underlyingAsset)],
                }) as any;
                newDebtTokenAddr = toReserveData.variableDebtTokenAddress || toReserveData[11];
            }

            logger.debug(`[useDebtSwitchActions] Evaluation | Allowance: ${allowance.toString()} | Required: ${maxNewDebt.toString()} | ForcePermit: ${forceRequirePermit} | PreferPermit: ${preferPermit} | HasLocalSignature: ${!!cachedPermit}`);

            addLog?.('Building secure transaction calldata...', 'info');
            const txResult = await buildDebtSwapTx({
                fromToken: { address: getAddress(qFrom.address || qFrom.underlyingAsset), decimals: qFrom.decimals, symbol: qFrom.symbol },
                toToken: { address: getAddress(qTo.address || qTo.underlyingAsset), decimals: qTo.decimals, symbol: qTo.symbol },
                priceRoute,
                adapterAddress,
                destAmount: exactDebtRepayAmount.toString(),
                srcAmount: srcAmount.toString(),
                apyPercent: activeQuote?.apyPercent ?? null,
                slippageBps: slippage,
                marketKey: marketKey || targetNetwork.key,
                chainId,
                walletAddress: account,
            });
            const executionSrcAmount = txResult?.srcAmount ? BigInt(txResult.srcAmount) : srcAmountBigInt;
            const executionBufferBps = txResult?.slippageBps ?? txResult?.bufferBps ?? bufferBps;
            const executionMaxNewDebt = calcApprovalAmount(executionSrcAmount, executionBufferBps);
            const executionDebtRepayAmount = txResult?.destAmount ? BigInt(txResult.destAmount) : BigInt(exactDebtRepayAmount);
            localTxId = txResult.transactionId?.toString?.() || null;
            updateCurrentTransactionId(localTxId);
            swapDebugMeta = txResult?.debugFlags || null;
            const shouldSimulateBeforeSwap = txResult?.debugFlags?.simulateBeforeSwap === true;
            logger.debug('[useDebtSwitchActions] Swap debug decision', {
                chainId,
                marketKey: marketKey || targetNetwork?.key,
                account,
                transactionId: txResult?.transactionId || null,
                swapDebug: swapDebugMeta,
                dynamicOffset: txResult?.dynamicOffset ?? null,
                augustus: txResult?.augustus ?? null,
                contractMethod: txResult?.contractMethod ?? null,
                quoteSrcAmount: srcAmountBigInt.toString(),
                executionSrcAmount: executionSrcAmount.toString(),
                executionMaxNewDebt: executionMaxNewDebt.toString(),
            });

            if (executionMaxNewDebt > maxNewDebt) {
                logger.warn('[useDebtSwitchActions] Build route requires more debt delegation than the initial quote requirement', {
                    quoteRequired: maxNewDebt.toString(),
                    executionRequired: executionMaxNewDebt.toString(),
                    currentPermitAmount: permitParams.amount.toString(),
                    allowance: allowance.toString(),
                });
            }

            if (allowance < executionMaxNewDebt || forceRequirePermit) {
                logger.debug('[useDebtSwitchActions] Final delegation evaluation after build', {
                    allowance: allowance.toString(),
                    executionRequired: executionMaxNewDebt.toString(),
                    preferPermit,
                    forceRequirePermit,
                    hasLocalSignature: !!cachedPermit,
                });

                if (forceRequirePermit || preferPermit) {
                    const effectiveSignedPermit = cachedPermit;
                    const now = Math.floor(Date.now() / 1000);
                    const tokenMatch = effectiveSignedPermit
                        ? getAddress(effectiveSignedPermit.token) === getAddress(newDebtTokenAddr)
                        : false;
                    const deadlineValid = effectiveSignedPermit
                        ? effectiveSignedPermit.deadline > now
                        : false;
                    const valueValid = effectiveSignedPermit
                        ? effectiveSignedPermit.value >= executionMaxNewDebt
                        : false;

                    logger.debug('[useDebtSwitchActions] Permit check against final build requirement', {
                        tokenMatch,
                        deadlineValid,
                        valueValid,
                        permitValue: effectiveSignedPermit?.value?.toString?.() || null,
                        required: executionMaxNewDebt.toString(),
                    });

                    if (effectiveSignedPermit && tokenMatch && deadlineValid && valueValid && !forceRequirePermit) {
                        logger.debug('[useDebtSwitchActions] Reusing cached permit for final build requirement');
                        permitParams = effectiveSignedPermit.params;
                    } else {
                        addLog?.('Requesting delegation signature...', 'warning');
                        const res = await handleApproveDelegation(true, executionMaxNewDebt, true, newDebtTokenAddr);

                        setIsActionLoading(true);

                        if (res?.permit) {
                            permitParams = res.permit;
                        } else {
                            throw new Error('Signature failed');
                        }
                    }
                } else {
                    logger.debug('[useDebtSwitchActions] PreferPermit is false, using exact on-chain approve after build');
                    await handleApproveDelegation(false, executionMaxNewDebt, true, newDebtTokenAddr);
                    setIsActionLoading(true);
                    await new Promise(r => setTimeout(r, 1500));
                    fetchDebtData();
                }
            }

            const encodedParaswapData = encodeAbiParameters(
                [{ type: 'bytes' }, { type: 'address' }],
                [txResult.swapCallData as Hex, getAddress(txResult.augustus)]
            );

            const swapParams = {
                debtAsset: getAddress(qFrom.address || qFrom.underlyingAsset),
                debtRepayAmount: executionDebtRepayAmount,
                debtRateMode: 2n,
                newDebtAsset: getAddress(qTo.address || qTo.underlyingAsset),
                maxNewDebtAmount: executionMaxNewDebt,
                extraCollateralAsset: zeroAddress,
                extraCollateralAmount: 0n,
                offset: BigInt(txResult.dynamicOffset || 0),
                paraswapData: encodedParaswapData,
            };

            const creditPermit = {
                debtToken: permitParams.amount === 0n ? zeroAddress : getAddress(newDebtTokenAddr),
                value: permitParams.amount,
                deadline: BigInt(permitParams.deadline),
                v: permitParams.v,
                r: permitParams.r,
                s: permitParams.s,
            };

            const collateralPermit = { aToken: zeroAddress, value: 0n, deadline: 0n, v: 0, r: zeroHash as Hex, s: zeroHash as Hex };

            if (creditPermit.debtToken !== zeroAddress && creditPermit.value < executionMaxNewDebt) {
                throw new Error(`Unable to refresh delegation for updated route requirement. Signed: ${creditPermit.value.toString()} Required: ${executionMaxNewDebt.toString()}`);
            }

            finalGasLimit = resolveSwapGasLimit(txResult, priceRoute);

            // Preflight simulation removed to minimize delay

            addLog?.('Confirm in your wallet...', 'warning');
            walletPromptOpened = true;
            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(adapterAddress),
                abi: ABIS.ADAPTER,
                functionName: 'swapDebt',
                args: [swapParams, creditPermit, collateralPermit],
                gas: finalGasLimit,
            });
            onSignatureCached?.(null);

            addLog?.(`Transaction broadcasted: ${hash}`, 'success');
            if (txResult.transactionId) {
                void recordTransactionHash(txResult.transactionId, hash, { walletAddress: account }).then((recorded) => {
                    if (!recorded) {
                        addLog?.('Hash sync pending. We will retry automatically in the background.', 'warning');
                    }
                });
            }
            onTxSent?.(hash);

            const receipt = await publicClient?.waitForTransactionReceipt({ hash });

            if (receipt?.status === 'reverted') throw new Error('Transaction reverted on-chain.');

            addLog?.('🚀 Swap Complete!', 'success');
            if (txResult.transactionId) {
                confirmTransactionOnChain(txResult.transactionId.toString(), {
                    gasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : '0',
                    actualPaid: exactDebtRepayAmount ? exactDebtRepayAmount.toString() : '0',
                }).catch(() => { });
            }

            clearQuote();
            onSignatureCached?.(null);
            fetchDebtData();
        } catch (error: any) {
            if (isUserRejectedError(error)) {
                setUserRejected(true);
                addLog?.('Cancelled by user.', 'warning');
                const rejectionReason = preflightPassed
                    ? 'wallet_rejected_after_preflight_passed'
                    : 'wallet_rejected';

                logger.error('[useDebtSwitchActions] Wallet request rejected after build', {
                    chainId,
                    marketKey: marketKey || targetNetwork?.key,
                    account,
                    transactionId: localTxId,
                    walletPromptOpened,
                    preflightPassed,
                    gas: finalGasLimit?.toString() || null,
                    adapterAddress,
                    swapDebug: swapDebugMeta,
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
                logger.error('[useDebtSwitchActions] Swap failure diagnostic', {
                    chainId,
                    marketKey: marketKey || targetNetwork?.key,
                    account,
                    fromToken: fromToken?.symbol,
                    toToken: toToken?.symbol,
                    swapAmount: swapAmount?.toString?.() || '0',
                    swapDebug: swapDebugMeta,
                    walletPromptOpened,
                    preflightPassed,
                    gas: finalGasLimit?.toString() || null,
                    adapterAddress,
                    diagnostic,
                    revertSelector,
                    error: errorSnapshot,
                    rawError: error,
                });

                const technicalErrorMessage = diagnostic;
                const friendlyMessage = mapErrorToUserFriendly(technicalErrorMessage)
                    || (simulationInProgress
                        ? 'Simulation failed. Try increasing slippage or reducing amount.'
                        : 'Swap failed. Please try again.');

                setTxError(friendlyMessage);
                addLog?.(`Error: ${friendlyMessage}`, 'error');
            }
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, walletClient, publicClient, allowance, swapAmount, debtBalance, swapQuote, fetchQuote, addLog, slippage, providedAdapterAddress, providedDebtTokenAddress, preFetchedTokenName, networkAddresses, chainId, ensureWalletNetwork, preferPermit, forceRequirePermit, handleApproveDelegation, onTxSent, currentTransactionId, clearQuoteError, clearQuote, fetchDebtData, marketKey || '', targetNetwork?.key || '', cachedPermit]);

    return {
        isActionLoading, isSigning, signedPermit: cachedPermit, forceRequirePermit, txError, lastAttemptedQuote, userRejected,
        handleApproveDelegation, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit, setTxError
    };
};
