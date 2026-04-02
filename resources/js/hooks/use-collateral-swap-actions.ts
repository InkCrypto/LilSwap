import {
    getAddress,
    formatUnits,
    parseAbi,
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
    simulateError?: boolean;
    preferPermit?: boolean;
    forceRequirePermitOverride?: boolean;
    marketKey?: string | null;
    onTxSent?: (hash: string) => void;
}

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
    simulateError,
    preferPermit = true,
    marketKey = null,
    onTxSent,
}: UseCollateralSwapActionsProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [isSigning, setIsSigning] = useState(false);
    const [signedPermit, setSignedPermit] = useState<any>(null);
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
        if (!networkAddresses?.SWAP_COLLATERAL_ADAPTER) return null;
        try {
            return getAddress(networkAddresses.SWAP_COLLATERAL_ADAPTER);
        } catch {
            return null;
        }
    }, [networkAddresses?.SWAP_COLLATERAL_ADAPTER]);

    const chainId = targetNetwork.chainId;

    useEffect(() => {
        setSignedPermit(null);
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
            const nonce = await publicClient?.readContract({
                address: getAddress(aTokenAddr),
                abi: parseAbi(ABIS.DEBT_TOKEN),
                functionName: 'nonces',
                args: [getAddress(account)],
            }) as bigint;

            const name = await publicClient?.readContract({
                address: getAddress(aTokenAddr),
                abi: parseAbi(ABIS.DEBT_TOKEN),
                functionName: 'name',
            }) as string;

            const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
            const value = exactAmount || BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

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

            // Parse signature (v, r, s)
            const r = `0x${signature.substring(2, 66)}` as Hex;
            const s = `0x${signature.substring(66, 130)}` as Hex;
            const v = parseInt(signature.substring(130, 132), 16);

            const permitParams = { amount: value, deadline: Number(deadline), v, r, s };
            setSignedPermit({ params: permitParams, token: aTokenAddr, deadline: Number(deadline), value });
            setForceRequirePermit(false);

            addLog?.('Signature received and cached', 'success');
            return permitParams;
        } catch (err: any) {
            if (isUserRejectedError(err)) {
                addLog?.('Signature request cancelled.', 'warning');
            } else {
                addLog?.('Signature failed: ' + (err?.message || err), 'error');
            }
            throw err;
        }
    }, [account, walletClient, publicClient, adapterAddress, chainId, addLog]);

    const handleApprove = useCallback(async (preferPermitOverride?: boolean, exactAmount?: bigint) => {
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;
        if (!walletClient || !fromToken || !adapterAddress || !account) return;

        try {
            setIsActionLoading(true);
            setIsSigning(true);

            let aTokenAddress = fromToken.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddress)) {
                const tokenAddresses = await publicClient?.readContract({
                    address: getAddress(networkAddresses.DATA_PROVIDER),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(fromToken.address || fromToken.underlyingAsset)],
                }) as any;
                aTokenAddress = tokenAddresses[0] || tokenAddresses.aTokenAddress;
            }

            if (preferPermitFinal) {
                const permit = await generateAndCachePermit(aTokenAddress, exactAmount);
                return { type: 'permit', permit };
            }

            addLog?.('Sending Approval Transaction...');
            const approveAmount = exactAmount || BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(aTokenAddress),
                abi: parseAbi(ABIS.ERC20),
                functionName: 'approve',
                args: [getAddress(adapterAddress), approveAmount],
            });

            addLog?.(`Transaction sent: ${hash}. Waiting for confirmation...`, 'warning');
            await publicClient?.waitForTransactionReceipt({ hash });

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
    }, [walletClient, publicClient, account, fromToken, adapterAddress, networkAddresses, addLog, fetchPositionData, preferPermit, generateAndCachePermit]);

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

            let aTokenAddr = quoteFrom.aTokenAddress;
            if (!isValidATokenAddress(aTokenAddr)) {
                const tokenAddresses = await publicClient?.readContract({
                    address: getAddress(networkAddresses.DATA_PROVIDER),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(quoteFrom.address || quoteFrom.underlyingAsset)],
                }) as any;
                aTokenAddr = tokenAddresses[0] || tokenAddresses.aTokenAddress;
            }

            const effectivePreferPermit = forceRequirePermit || preferPermit;
            if (allowance < srcAmountBigInt || forceRequirePermit) {
                if (effectivePreferPermit) {
                    if (signedPermit && !forceRequirePermit && signedPermit.token === aTokenAddr && signedPermit.deadline > Math.floor(Date.now() / 1000) && signedPermit.value >= srcAmountBigInt) {
                        permitParams = signedPermit.params;
                    } else {
                        const permitAmount = srcAmountBigInt + (srcAmountBigInt * 100n / 10000n) + 1n;
                        const permitResult = await handleApprove(true, permitAmount);
                        setIsActionLoading(true);
                        if (permitResult?.permit) permitParams = permitResult.permit;
                    }
                } else {
                    await handleApprove(false);
                    setIsActionLoading(true);
                    await new Promise(r => setTimeout(r, 1500));
                    fetchPositionData();
                }
            }

            addLog?.('Building secure transaction calldata...', 'warning');
            const txResult = await buildCollateralSwapTx({
                fromToken: { ...quoteFrom, address: getAddress(quoteFrom.address || quoteFrom.underlyingAsset) },
                toToken: { ...quoteTo, address: getAddress(quoteTo.address || quoteTo.underlyingAsset) },
                priceRoute,
                adapterAddress,
                srcAmount: srcAmount.toString(),
                isMaxSwap: !!supplyBalance && swapAmount >= supplyBalance,
                slippageBps: slippage,
                marketKey: marketKey || targetNetwork.key,
                chainId,
                walletAddress: account,
            });

            localTxId = txResult.transactionId;
            updateCurrentTransactionId(localTxId);

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

            if (simulateError) throw new Error('Simulation Failure');

            const flashLoanArgs = [
                getAddress(adapterAddress),
                getAddress(quoteFrom.address || quoteFrom.underlyingAsset),
                srcAmountBigInt,
                encodedParams,
                0
            ] as const;

            addLog?.('Confirm in your wallet...', 'warning');

            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(networkAddresses.POOL),
                abi: parseAbi(ABIS.POOL),
                functionName: 'flashLoanSimple',
                args: flashLoanArgs,
            });

            addLog?.(`Transaction broadcasted: ${hash}`, 'success');
            if (localTxId) recordTransactionHash(localTxId, hash).catch(() => { });
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
                setTxError(error.message);
                addLog?.('Swap Failed: ' + error.message, 'error');
            }
            resetRefreshCountdown();
        } finally {
            setIsActionLoading(false);
            updateCurrentTransactionId(null);
        }
    }, [account, walletClient, publicClient, allowance, swapAmount, supplyBalance, swapQuote, fetchQuote, addLog, slippage, adapterAddress, networkAddresses, chainId, ensureWalletNetwork, targetNetwork?.key || '', preferPermit, forceRequirePermit, handleApprove, onTxSent, clearQuote, fetchPositionData, resetRefreshCountdown, signedPermit, marketKey, clearQuoteError, simulateError]);

    return {
        isActionLoading, isSigning, signedPermit, forceRequirePermit, txError, userRejected,
        handleApprove, handleSwap, clearTxError: () => setTxError(null),
        clearUserRejected: () => setUserRejected(false), clearCachedPermit: () => { }, setTxError,
    };
};
