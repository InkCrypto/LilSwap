import {
    getAddress,
    formatUnits,
    parseAbi,
    parseSignature,
    zeroAddress,
    encodeAbiParameters,
    Hex,
    maxUint256,
    zeroHash,
} from 'viem';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { buildDebtSwapTx } from '../services/api';
import logger from '../utils/logger';
import { prepareEngineTransactionRequest } from '../utils/transaction-request';
import { recordTransactionHash, confirmTransactionOnChain, rejectTransaction } from '../services/transactions-api';
import { isUserRejectedError } from '../utils/logger';
import { calcApprovalAmount } from '../utils/swap-math';
import { mapErrorToUserFriendly } from '../utils/error-mapping';

const DELEGATION_GAS_LIMIT = 180_000n;
const DELEGATION_PERMIT_TTL_SECONDS = 3600;
const DELEGATION_PERMIT_MIN_VALIDITY_SECONDS = 60;

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

const REVERT_SELECTOR_LENGTH = 10; // "0x" + 8 hex chars = 4 bytes

/**
 * Known Aave adapter addresses on supported chains.
 * Used to filter out false-positive revert selectors that are actually
 * the first 4 bytes of a contract address appearing in error messages.
 */
const isMatchPartOfAddress = (haystack: string, matchIndex: number, matchLength: number): boolean => {
    // An Ethereum address is 0x + 40 hex chars = 42 chars total.
    // If the match is the first 10 chars of a 42-char address, the next
    // 32 chars after the match will all be hex characters.
    const restStart = matchIndex + matchLength;
    const rest = haystack.slice(restStart, restStart + 32);

    return rest.length === 32 && /^[a-fA-F0-9]{32}$/.test(rest);
};

const getRevertSelector = (error: any): string | null => {
    // 1) Viem stores the raw revert data in error.data (or cause chain).
    //    This is the canonical source — 4 bytes (0x + 8 hex) for custom errors,
    //    or longer for errors with encoded parameters.
    const rawData = error?.data
        ?? error?.cause?.data
        ?? error?.error?.data
        ?? error?.cause?.cause?.data;

    if (typeof rawData === 'string' && rawData.startsWith('0x') && rawData.length >= REVERT_SELECTOR_LENGTH) {
        const candidate = rawData.slice(0, REVERT_SELECTOR_LENGTH).toLowerCase();

        // A real revert selector is a short, standalone hex string (4 bytes).
        // If the data is a full address (40+ hex chars), it's NOT a revert selector.
        if (rawData.length >= 42) {
            // This is likely an address or long data — skip it and fall through to regex scanning
        } else {
            return candidate;
        }
    }

    // 2) Fallback: scan error details for 0x-prefixed 8-char hex patterns.
    //    Use a heuristic to skip matches that are part of a 42-char address
    //    (0x + 40 hex chars) — those are contract addresses, not revert selectors.
    const details = collectErrorDetails(error);
    const regex = /0x[a-fA-F0-9]{8}/g;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(details)) !== null) {
        if (isMatchPartOfAddress(details, m.index, m[0].length)) {
            continue;
        }

        return m[0];
    }

    return null;
};

const getDebtSimulationErrorMessage = ({
    diagnostic,
    revertSelector,
    slippageBps,
    recommendedSlippageBps,
}: {
    diagnostic: string;
    revertSelector: string | null;
    slippageBps: number;
    recommendedSlippageBps: number;
}) => {
    const mappedRevert = mapErrorToUserFriendly(revertSelector || diagnostic);
    const normalizedDiagnostic = diagnostic.toLowerCase();

    const isKnownSlippageFailure = (
        revertSelector?.toLowerCase() === '0x81ceff30' ||
        revertSelector?.toLowerCase() === '0xcea9e31d' ||
        normalizedDiagnostic.includes('slippage')
    );

    if (isKnownSlippageFailure) {
        return `${mappedRevert || 'Preflight simulation failed because the execution tolerance was exceeded.'} Used ${(slippageBps / 100).toFixed(2)}%; recommended ${(recommendedSlippageBps / 100).toFixed(2)}%.`;
    }

    if (revertSelector) {
        return `Preflight check failed (${revertSelector}). This transaction would fail on-chain, so it was blocked to save gas. Please refresh the quote or try adjusting your slippage.`;
    }

    return mappedRevert && mappedRevert !== diagnostic
        ? mappedRevert
        : 'Preflight check failed. This transaction would fail on-chain, so it was blocked to save gas. Please refresh the quote, adjust your slippage, or check your balance.';
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
    recommendedSlippage: number;
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
    recommendedSlippage,
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
}: UseDebtSwitchActionsProps) => {
    const publicClient = usePublicClient({ chainId: selectedNetwork?.chainId || DEFAULT_NETWORK.chainId });
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const shouldRefreshQuoteBeforeNextAttemptRef = useRef(false);

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

    const generateAndCachePermit = useCallback(async (debtTokenAddr: string, exactAmount: bigint, referenceTimestamp?: number) => {
        if (!walletClient || !publicClient || !account) return null;
        try {
            if (exactAmount <= 0n) {
                throw new Error('Invalid delegation amount');
            }

            const normalizedDebtToken = getAddress(debtTokenAddr);
            const signingData = await publicClient.multicall({
                allowFailure: false,
                contracts: [
                    {
                        address: normalizedDebtToken,
                        abi: parseAbi(ABIS.DEBT_TOKEN),
                        functionName: 'nonces',
                        args: [getAddress(account)],
                    },
                    {
                        address: normalizedDebtToken,
                        abi: parseAbi(ABIS.DEBT_TOKEN),
                        functionName: 'name',
                    },
                ],
            });
            const nonce = BigInt(signingData[0] as bigint);
            const name = String(signingData[1] || '');
            if (!name) throw new Error('Unable to resolve debt token signing domain');
            if (!Number.isSafeInteger(referenceTimestamp) || Number(referenceTimestamp) <= 0) {
                throw new Error('Authoritative chain timestamp is unavailable. Please try again.');
            }
            const deadline = BigInt(Number(referenceTimestamp) + DELEGATION_PERMIT_TTL_SECONDS);
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
    }, [account, walletClient, publicClient, adapterAddress, chainId, addLog, onSignatureCached]);

    const handleApproveDelegation = useCallback(async (preferPermitOverride?: boolean, exactAmount?: bigint, skipNetworkCheck?: boolean, debtTokenAddressOverride?: string, referenceTimestamp?: number) => {
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
                const permit = await generateAndCachePermit(debtTokenAddress, exactAmount, referenceTimestamp);
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
        if (!activeQuote || shouldRefreshQuoteBeforeNextAttemptRef.current) {
            addLog?.(shouldRefreshQuoteBeforeNextAttemptRef.current ? 'Refreshing quote...' : 'Fetching quote...', 'info');
            activeQuote = await fetchQuote();
            shouldRefreshQuoteBeforeNextAttemptRef.current = false;
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
            const maxNewDebt = activeQuote?.requiredDebtDelegationAmount
                ? BigInt(activeQuote.requiredDebtDelegationAmount)
                : calcApprovalAmount(srcAmountBigInt, activeQuote?.delegationBufferBps ?? bufferBps);
            const exactDebtRepayAmount = activeQuote.destAmount;
            const isMaxSwap = debtBalance !== null && swapAmount >= debtBalance;

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

            const referenceTimestamp = Number(activeQuote?.timestamp || Math.floor(Date.now() / 1000));
            logger.debug(`[useDebtSwitchActions] Evaluation | Allowance: ${allowance.toString()} | Required: ${maxNewDebt.toString()} | ForcePermit: ${forceRequirePermit} | PreferPermit: ${preferPermit} | HasLocalSignature: ${!!cachedPermit}`);

            if (allowance < maxNewDebt || forceRequirePermit) {
                if (forceRequirePermit || preferPermit) {
                    const minimumPermitDeadline = referenceTimestamp + DELEGATION_PERMIT_MIN_VALIDITY_SECONDS;
                    const tokenMatch = cachedPermit ? getAddress(cachedPermit.token) === getAddress(newDebtTokenAddr) : false;
                    const deadlineValid = cachedPermit ? cachedPermit.deadline > minimumPermitDeadline : false;
                    const valueValid = cachedPermit ? cachedPermit.value >= maxNewDebt : false;

                    if (cachedPermit && tokenMatch && deadlineValid && valueValid && !forceRequirePermit) {
                        permitParams = cachedPermit.params;
                    } else {
                        const result = await handleApproveDelegation(true, maxNewDebt, true, newDebtTokenAddr, referenceTimestamp);
                        setIsActionLoading(true);
                        if (!result?.permit) throw new Error('Signature failed');
                        permitParams = result.permit;
                    }
                } else {
                    await handleApproveDelegation(false, maxNewDebt, true, newDebtTokenAddr);
                    setIsActionLoading(true);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    fetchDebtData();
                }
            }

            const buildWithPermit = (currentPermit: typeof permitParams) => buildDebtSwapTx({
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
                isMaxSwap,
                permitParams: currentPermit.amount > 0n ? {
                    debtToken: getAddress(newDebtTokenAddr),
                    value: currentPermit.amount.toString(),
                    deadline: currentPermit.deadline.toString(),
                    v: currentPermit.v,
                    r: currentPermit.r,
                    s: currentPermit.s,
                } : undefined,
            });

            addLog?.('Building secure transaction calldata...', 'info');
            let txResult = await buildWithPermit(permitParams);            const executionSrcAmount = txResult?.srcAmount ? BigInt(txResult.srcAmount) : srcAmountBigInt;
            const executionBufferBps = txResult?.bufferBps ?? activeQuote?.delegationBufferBps ?? bufferBps;
            const executionMaxNewDebt = txResult?.maxNewDebtAmount
                ? BigInt(txResult.maxNewDebtAmount)
                : calcApprovalAmount(executionSrcAmount, executionBufferBps);
            localTxId = txResult.transactionId?.toString?.() || null;
            updateCurrentTransactionId(localTxId);
            swapDebugMeta = txResult?.debugFlags || null;
            logger.debug('[useDebtSwitchActions] Swap build completed', {
                chainId,
                transactionId: txResult?.transactionId || null,
                quoteSrcAmount: srcAmountBigInt.toString(),
                executionSrcAmount: executionSrcAmount.toString(),
                executionMaxNewDebt: executionMaxNewDebt.toString(),
            });

            let rawTransaction = prepareEngineTransactionRequest(txResult.transactionRequest, {
                account,
                chainId,
                target: adapterAddress,
            });

            simulationInProgress = true;
            addLog?.('Checking transaction...', 'info');
            if (!publicClient) throw new Error('Unable to verify transaction before execution. Please reconnect and try again.');
            try {
                await publicClient.call({
                    ...rawTransaction,
                    gas: 3_000_000n,
                });
            } catch (preflightError: any) {
                const selector = getRevertSelector(preflightError)?.toLowerCase();
                if (selector !== '0x8baa579f' || permitParams.amount === 0n) throw preflightError;

                logger.warn('[useDebtSwitchActions] Invalid cached delegation signature; rebuilding once with fresh on-chain permit data', {
                    chainId,
                    debtToken: newDebtTokenAddr,
                    transactionId: txResult?.transactionId || null,
                });
                onSignatureCached?.(null);
                setForceRequirePermit(true);
                const renewed = await handleApproveDelegation(true, maxNewDebt, true, newDebtTokenAddr, Math.floor(Date.now() / 1000));
                setIsActionLoading(true);
                if (!renewed?.permit) throw preflightError;
                permitParams = renewed.permit;

                if (txResult?.transactionId) {
                    void rejectTransaction(String(txResult.transactionId), 'invalid_delegation_signature_rebuilt').catch(() => { });
                }
                txResult = await buildWithPermit(permitParams);
                localTxId = txResult.transactionId?.toString?.() || null;
                updateCurrentTransactionId(localTxId);
                swapDebugMeta = txResult?.debugFlags || null;
                rawTransaction = prepareEngineTransactionRequest(txResult.transactionRequest, {
                    account,
                    chainId,
                    target: adapterAddress,
                });
                await publicClient.call({
                    ...rawTransaction,
                    gas: 3_000_000n,
                });
            }
            simulationInProgress = false;
            preflightPassed = true;

            addLog?.('Confirm in your wallet...', 'warning');
            walletPromptOpened = true;
            const hash = await walletClient.sendTransaction({
                ...rawTransaction,
                chain: null,
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
                    gas: null,
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
                shouldRefreshQuoteBeforeNextAttemptRef.current = true;
            } else {
                const diagnostic = collectErrorDetails(error);
                const revertSelector = getRevertSelector(error);
                if (revertSelector?.toLowerCase() === '0x8baa579f') {
                    onSignatureCached?.(null);
                    setForceRequirePermit(true);
                }
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
                    gas: null,
                    adapterAddress,
                    diagnostic,
                    revertSelector,
                    error: errorSnapshot,
                    rawError: error,
                });

                const technicalErrorMessage = diagnostic;
                const friendlyMessage = simulationInProgress
                    ? getDebtSimulationErrorMessage({
                        diagnostic,
                        revertSelector,
                        slippageBps: slippage,
                        recommendedSlippageBps: recommendedSlippage,
                    })
                    : mapErrorToUserFriendly(technicalErrorMessage) || 'Swap failed. Please try again.';

                setTxError(friendlyMessage);
                addLog?.(`Error: ${friendlyMessage}`, 'error');
                shouldRefreshQuoteBeforeNextAttemptRef.current = true;
            }
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, walletClient, publicClient, allowance, swapAmount, debtBalance, swapQuote, fetchQuote, addLog, slippage, recommendedSlippage, providedAdapterAddress, providedDebtTokenAddress, networkAddresses, chainId, ensureWalletNetwork, preferPermit, forceRequirePermit, handleApproveDelegation, onTxSent, currentTransactionId, clearQuoteError, clearQuote, fetchDebtData, marketKey || '', targetNetwork?.key || '', cachedPermit]);

    return {
        isActionLoading, isSigning, signedPermit: cachedPermit, forceRequirePermit, txError, lastAttemptedQuote, userRejected,
        handleApproveDelegation, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit, setTxError
    };
};
