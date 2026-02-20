import { useCallback, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { ABIS } from '../constants/abis.js';
import { buildDebtSwapTx } from '../services/api.js';
import { recordTransactionHash, confirmTransactionOnChain } from '../services/transactionsApi.js';

import logger from '../utils/logger.js';
import { calcApprovalAmount } from '../utils/swapMath.js';
export const useDebtSwitchActions = ({
    account,
    provider,
    networkRpcProvider, // read-only RPC provider (fallback) - passed from Web3 context
    fromToken,
    toToken,
    allowance,
    swapQuote,
    slippage,
    addLog,
    fetchDebtData,
    fetchQuote,
    resetRefreshCountdown,
    clearQuote,
    selectedNetwork,
    simulateError,
    preferPermit = true, // default: prefer off-chain signature (permit)
    freezeQuote = false,
}) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [signedPermit, setSignedPermit] = useState(null);
    // Persisted flag: when true we WILL request a fresh off-chain permit even if on-chain allowance exists.
    // Persist to localStorage so a page reload does not silently bypass the intent of "Clear cached permits".
    const [forceRequirePermit, setForceRequirePermit] = useState(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                return window.localStorage.getItem('lilswap.forceRequirePermit') === '1';
            }
        } catch (err) {
            logger.debug('[useDebtSwitchActions] localStorage read failed for forceRequirePermit:', err?.message || err);
        }
        return false;
    });
    const [txError, setTxError] = useState(null);
    const [pendingTxParams, setPendingTxParams] = useState(null);
    const [lastAttemptedQuote, setLastAttemptedQuote] = useState(null);
    const [userRejected, setUserRejected] = useState(false);
    const [currentTransactionId, setCurrentTransactionId] = useState(null);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.DEBT_SWAP_ADAPTER) {
            return null;
        }
        try {
            return ethers.getAddress(networkAddresses.DEBT_SWAP_ADAPTER);
        } catch (error) {
            logger.warn('[useDebtSwitchActions] Invalid DEBT_SWAP_ADAPTER:', networkAddresses.DEBT_SWAP_ADAPTER, error);
            return null;
        }
    }, [networkAddresses?.DEBT_SWAP_ADAPTER]);
    const augustusMap = networkAddresses.AUGUSTUS;
    const chainId = targetNetwork.chainId;
    const targetHexChainId = targetNetwork.hexChainId;

    const ensureWalletNetwork = useCallback(async () => {
        if (!provider) {
            addLog?.('Provider unavailable. Please reconnect your wallet.', 'error');
            return null;
        }

        try {
            const currentNetwork = await provider.getNetwork();
            if (Number(currentNetwork.chainId) === chainId) {
                return provider;
            }
        } catch (networkError) {
            addLog?.('Error reading current network: ' + networkError.message, 'error');
            return null;
        }

        if (typeof window === 'undefined' || !window.ethereum || !targetHexChainId) {
            addLog?.(`Automatic switch to ${targetNetwork.label} not supported in this wallet.`, 'error');
            return null;
        }

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: targetHexChainId }],
            });
            addLog?.(`Network updated to ${targetNetwork.label}.`, 'success');
            return new ethers.BrowserProvider(window.ethereum);
        } catch (switchError) {
            addLog?.(`Error switching to ${targetNetwork.label}: ${switchError?.message || switchError}`, 'error');
            return null;
        }
    }, [provider, chainId, targetHexChainId, targetNetwork.label, addLog]);

    // Helper: create and cache an EIP-712 DelegationWithSig (permit)
    const generateAndCachePermit = useCallback(async (debtTokenAddr, signer) => {
        try {
            const debtContract = new ethers.Contract(debtTokenAddr, ABIS.DEBT_TOKEN, signer);
            const nonce = await debtContract.nonces(account);
            const name = await debtContract.name();
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
            const value = ethers.MaxUint256;

            const domain = {
                name,
                version: '1',
                chainId,
                verifyingContract: debtTokenAddr,
            };

            const types = {
                DelegationWithSig: [
                    { name: 'delegatee', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            };

            const message = {
                delegatee: adapterAddress,
                value,
                nonce,
                deadline,
            };

            addLog?.('Requesting EIP-712 signature...', 'warning');
            const signature = await signer.signTypedData(domain, types, message);
            const sig = ethers.Signature.from(signature);

            const permitParams = {
                amount: value,
                deadline,
                v: sig.v,
                r: sig.r,
                s: sig.s,
            };

            setSignedPermit({ params: permitParams, token: debtTokenAddr, deadline, value });
            setForceRequirePermit(false);
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('lilswap.forceRequirePermit'); } catch (err) { logger.debug('[generateAndCachePermit] failed to clear persisted flag:', err?.message || err); }
            addLog?.('Signature received and cached', 'success');
            return permitParams;
        } catch (err) {
            addLog?.('Signature failed: ' + (err?.message || err), 'error');
            throw err;
        }
    }, [account, adapterAddress, addLog, chainId]);

    const handleApproveDelegation = useCallback(async (preferPermitOverride) => {
        // preferPermitOverride: optional boolean to override hook-level preferPermit
        const preferPermitFinal = typeof preferPermitOverride === 'boolean' ? preferPermitOverride : preferPermit;

        if (!provider || !toToken) return;
        if (!adapterAddress) {
            addLog?.(`Invalid DEBT_SWAP_ADAPTER for ${targetNetwork.label}. Check network config.`, 'error');
            return;
        }

        try {
            setIsActionLoading(true);
            const signer = await provider.getSigner();

            // Use debt token address from backend, with fallback to on-chain
            let debtTokenAddress = toToken.variableDebtTokenAddress;
            if (!debtTokenAddress || debtTokenAddress === ethers.ZeroAddress) {
                logger.debug('[handleApproveDelegation] No debt token from backend, falling back to on-chain...');
                const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
                const toTokenAddress = toToken.address || toToken.underlyingAsset;
                const toReserveData = await poolContract.getReserveData(toTokenAddress);
                debtTokenAddress = toReserveData.variableDebtTokenAddress;
                if (!debtTokenAddress || debtTokenAddress === ethers.ZeroAddress) {
                    throw new Error(`Unable to get debt token address for ${toToken.symbol}`);
                }
            }

            if (preferPermitFinal) {
                // Request EIP-712 signature and cache it
                addLog?.('Requesting signature (user preference)...', 'info');
                const permit = await generateAndCachePermit(debtTokenAddress, await provider.getSigner());
                return { type: 'permit', permit };
            }

            // Fallback: on-chain approval
            const newDebtContract = new ethers.Contract(debtTokenAddress, ABIS.DEBT_TOKEN, signer);

            addLog?.('Sending Approval Tx...');
            const tx = await newDebtContract.approveDelegation(adapterAddress, ethers.MaxUint256);
            addLog?.(`Tx sent: ${tx.hash}. Waiting...`, 'warning');
            await tx.wait();

            addLog?.('Delegation approved!', 'success');
            fetchDebtData();
            return { type: 'tx', tx };
        } catch (error) {
            addLog?.('Approval error: ' + (error?.message || error), 'error');
            throw error;
        } finally {
            setIsActionLoading(false);
        }
    }, [provider, toToken?.underlyingAsset, toToken?.address, addLog, fetchDebtData, networkAddresses, adapterAddress, targetNetwork.label, preferPermit, generateAndCachePermit]);
    const handleSwap = useCallback(async () => {
        if (!adapterAddress) {
            addLog?.(`Invalid DEBT_SWAP_ADAPTER for ${targetNetwork.label}. Check network config.`, 'error');
            return;
        }
        logger.debug('\n==========================================');
        logger.debug('🚀🚀🚀 SWAP BUTTON CLICKED! 🚀🚀🚀');
        logger.debug('==========================================\n');

        logger.debug('[handleSwap] 🚀 SWAP INITIATED!');
        logger.debug('[handleSwap] Current state:', {
            hasProvider: !!provider,
            hasQuote: !!swapQuote,
            hasFromToken: !!fromToken,
            hasToToken: !!toToken,
            allowance: allowance?.toString(),
            account
        });

        setTxError(null);
        setPendingTxParams(null);
        setUserRejected(false);

        let activeQuote = swapQuote;
        if (!activeQuote) {
            logger.debug('[handleSwap] No quote available, fetching...');
            addLog?.('Fetching quote...', 'info');
            activeQuote = await fetchQuote();
            if (!activeQuote) {
                logger.error('[handleSwap] ❌ Failed to fetch quote');
                addLog?.('Failed to fetch quote', 'error');
                return;
            }
        }

        logger.debug('[handleSwap] Using quote:', {
            srcAmount: activeQuote.srcAmount?.toString(),
            destAmount: activeQuote.destAmount?.toString(),
            fromToken: activeQuote.fromToken?.symbol,
            toToken: activeQuote.toToken?.symbol
        });

        const now = Math.floor(Date.now() / 1000);
        const quoteAge = now - (activeQuote.timestamp || 0);
        logger.debug('[handleSwap] Quote age check:', { quoteAge, timestamp: activeQuote.timestamp });

        if (quoteAge > 300) {
            logger.debug('[handleSwap] Quote too old, refreshing...');
            addLog?.(`⚠️ Quote is too old (${quoteAge}s). Updating...`, 'warning');
            activeQuote = await fetchQuote();
            if (!activeQuote) {
                logger.error('[handleSwap] ❌ Failed to refresh quote');
                return;
            }
        }

        logger.debug('[handleSwap] Quote validated, proceeding...');

        // Warning for small amounts (but does not block)
        const destAmountFloat = parseFloat(ethers.formatUnits(activeQuote.destAmount, activeQuote.fromToken.decimals));
        const WARNING_THRESHOLD_USDC = 20; // Warning for values < $20 USD
        const WARNING_THRESHOLD_WETH = 0.01; // Warning for values < 0.01 WETH (~$25 USD)

        let showSmallValueWarning = false;

        if (activeQuote.fromToken.symbol === 'USDC' && destAmountFloat < WARNING_THRESHOLD_USDC) {
            showSmallValueWarning = true;
        } else if (activeQuote.fromToken.symbol === 'WETH' && destAmountFloat < WARNING_THRESHOLD_WETH) {
            showSmallValueWarning = true;
        }

        if (showSmallValueWarning) {
            addLog?.(`⚠️ WARNING: Small swap amount detected`, 'warning');
            addLog?.(`  • Value: ${destAmountFloat.toFixed(6)} ${activeQuote.fromToken.symbol}`, 'warning');
            addLog?.(`  • Estimated gas: ~$2-5 USD on Base`, 'warning');
            addLog?.(`  • For small values, consider grouping operations`, 'warning');
            addLog?.(`  • Continuing with transaction...`, 'info');
        }

        setLastAttemptedQuote(activeQuote);
        setIsActionLoading(true);

        logger.debug('[handleSwap] ✅ Starting swap execution...');
        logger.debug('[handleSwap] Network:', targetNetwork.label, 'ChainId:', chainId);

        try {
            logger.debug('[handleSwap] Step 1: Ensuring correct network...');
            const activeProvider = await ensureWalletNetwork();
            if (!activeProvider) {
                logger.error('[handleSwap] ❌ Failed to ensure wallet network');
                addLog?.('Failed to connect to correct network', 'error');
                return;
            }

            logger.debug('[handleSwap] ✅ Network confirmed');
            logger.debug('[handleSwap] Step 2: Getting signer...');
            const signer = await activeProvider.getSigner();
            logger.debug('[handleSwap] ✅ Signer obtained');

            const { priceRoute, srcAmount, fromToken, toToken, version } = activeQuote;
            // Ensure srcAmount is BigInt (can come as string or BigInt)
            const srcAmountBigInt = typeof srcAmount === 'bigint' ? srcAmount : BigInt(srcAmount);

            // Buffer in basis points (bps) - received from backend's quote response
            // Use activeQuote (which may have been refreshed) not swapQuote (stale state)
            const bufferBps = activeQuote?.bufferBps || 50; // Fallback to 50 bps if not provided
            const maxNewDebt = calcApprovalAmount(srcAmountBigInt, bufferBps);
            const exactDebtRepayAmount = activeQuote.destAmount; // Amount to repay (exact output)

            let permitParams = { amount: 0, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

            logger.debug('[handleSwap] Step 3: Checking delegation allowance...');
            logger.debug('[handleSwap] Allowance:', allowance?.toString(), 'Required:', maxNewDebt.toString());

            // Get debt token address directly from backend data (more reliable than on-chain query)
            logger.debug('[handleSwap] 📋 INPUT TOKENS:', {
                fromToken: {
                    symbol: fromToken.symbol,
                    address: fromToken.address,
                    underlyingAsset: fromToken.underlyingAsset,
                    decimals: fromToken.decimals,
                    debtTokenAddress: fromToken.debtTokenAddress
                },
                toToken: {
                    symbol: toToken.symbol,
                    address: toToken.address,
                    underlyingAsset: toToken.underlyingAsset,
                    decimals: toToken.decimals,
                    variableDebtTokenAddress: toToken.variableDebtTokenAddress
                }
            });

            // Use debt token address from backend, with fallback to on-chain if not available
            let newDebtTokenAddr = toToken.variableDebtTokenAddress;

            if (!newDebtTokenAddr || newDebtTokenAddr === ethers.ZeroAddress) {
                logger.debug('[handleSwap] ⚠️ No debt token from backend, falling back to on-chain query...');
                logger.debug('[handleSwap] 🔍 toToken object:', {
                    symbol: toToken.symbol,
                    underlyingAsset: toToken.underlyingAsset,
                    address: toToken.address,
                    hasVariableDebtTokenAddress: !!toToken.variableDebtTokenAddress,
                    variableDebtTokenAddress: toToken.variableDebtTokenAddress
                });
                const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
                const toTokenAddress = toToken.address || toToken.underlyingAsset;
                logger.debug('[handleSwap] 📞 Calling getReserveData with address:', toTokenAddress);
                const toReserveData = await poolContract.getReserveData(toTokenAddress);
                newDebtTokenAddr = toReserveData.variableDebtTokenAddress;
                logger.debug('[handleSwap] 📋 getReserveData returned:', {
                    aToken: toReserveData.aTokenAddress,
                    variableDebtToken: toReserveData.variableDebtTokenAddress,
                    stableDebtToken: toReserveData.stableDebtTokenAddress
                });

                if (!newDebtTokenAddr || newDebtTokenAddr === ethers.ZeroAddress) {
                    throw new Error(`Unable to get debt token address for ${toToken.symbol}. Token may not support borrowing.`);
                }
            }

            logger.debug('[handleSwap] ✅ Using debt token address:', {
                symbol: toToken.symbol,
                underlyingAsset: toToken.underlyingAsset || toToken.address,
                variableDebtTokenAddress: newDebtTokenAddr,
                source: toToken.variableDebtTokenAddress ? 'backend' : 'on-chain fallback'
            });

            // Check if we have a cached signature for a DIFFERENT token
            if (signedPermit && signedPermit.token !== newDebtTokenAddr) {
                logger.debug('[handleSwap] ⚠️ Token changed! Invalidating cached signature:', {
                    cachedToken: signedPermit.token,
                    newToken: newDebtTokenAddr
                });
                setSignedPermit(null); // Clear invalid cache
            }

            // Treat a forced-clear as an explicit request to re-obtain an off-chain permit
            const effectivePreferPermit = forceRequirePermit || preferPermit;

            if (allowance < maxNewDebt || forceRequirePermit) {
                logger.debug('[handleSwap] ⚠️ Insufficient allowance or force-permit, need signature/approval...');

                const currentTs = Math.floor(Date.now() / 1000);

                // If forceRequirePermit is set we will prefer collecting a fresh permit even if on-chain allowance
                // would otherwise let the flow proceed without a signature.
                if (effectivePreferPermit) {
                    if (
                        signedPermit &&
                        !forceRequirePermit &&
                        signedPermit.token === newDebtTokenAddr &&
                        signedPermit.deadline > currentTs &&
                        signedPermit.value >= maxNewDebt
                    ) {
                        logger.debug('[handleSwap] ✅ Using cached signature (per user preference)');
                        addLog?.('1/3 Using cached signature...', 'info');
                        permitParams = signedPermit.params;
                    } else {
                        addLog?.('1/3 Requesting Signature (EIP-712)...', 'warning');

                        // Request & cache a new permit — prefer the returned value to avoid stale React state
                        const permitResult = await handleApproveDelegation(true);

                        if (permitResult && permitResult.permit) {
                            permitParams = permitResult.permit;
                            setForceRequirePermit(false);
                            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('lilswap.forceRequirePermit'); } catch (err) { logger.debug('[handleSwap] failed to clear persisted flag after permit:', err?.message || err); }
                        } else if (signedPermit && signedPermit.token === newDebtTokenAddr && !forceRequirePermit) {
                            // fallback to cached state if present
                            permitParams = signedPermit.params;
                        } else {
                            throw new Error('Signature not provided or cancelled');
                        }
                    }
                } else {
                    // User explicitly chose on-chain approval — ignore any cached signature and send tx
                    addLog?.('1/3 Sending on-chain approval (user chose on-chain)...', 'info');
                    await handleApproveDelegation(false);
                    // Wait a moment for allowance to update, then refetch
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await fetchDebtData();
                    // permitParams remains empty (on-chain allowance will satisfy adapter)
                }
            } else {
                logger.debug('✅ Step 3: Delegation already approved on-chain, skipping signature');
                addLog?.('1/3 Delegation already approved on-chain.', 'success');
            }

            logger.debug('🔨 Step 4: Building transaction calldata...');
            addLog?.('2/3 Generating calldata...', 'warning');
            addLog?.(`Slippage: ${slippage / 100}%`, 'info');

            logger.debug('🔄 Calling buildDebtSwapTx with:', {
                fromToken: fromToken.symbol,
                toToken: toToken.symbol,
                chainId,
                slippage
            });

            const txResult = await buildDebtSwapTx({
                fromToken: {
                    address: fromToken.address || fromToken.underlyingAsset,
                    decimals: fromToken.decimals,
                    symbol: fromToken.symbol,
                },
                toToken: {
                    address: toToken.address || toToken.underlyingAsset,
                    decimals: toToken.decimals,
                    symbol: toToken.symbol,
                },
                priceRoute,
                userAddress: adapterAddress,
                destAmount: exactDebtRepayAmount.toString(),
                srcAmount: activeQuote.srcAmount.toString(),
                // Pass APY from the frontend quote so backend can persist it
                apyPercent: activeQuote?.apyPercent ?? null,
                slippageBps: slippage,  // User's chosen slippage in BPS (e.g., 50 = 0.5%)
                chainId,
                userWalletAddress: account,  // Pass user's wallet for tracking
            });

            const { swapCallData: paraswapCalldata, augustus: augustusAddress, version: txVersion, transactionId } = txResult;

            // Store transaction ID for later use
            setCurrentTransactionId(transactionId);
            logger.debug('[handleSwap] Transaction ID stored:', transactionId);

            logger.debug('✅ Step 4 Complete: Transaction calldata built successfully');
            logger.debug('  - Augustus:', augustusAddress);
            logger.debug('  - Version:', txVersion);
            logger.debug('  - Calldata length:', paraswapCalldata?.length || 0, 'chars');

            if (!augustusAddress || augustusAddress === ethers.ZeroAddress) {
                addLog?.('⚠️ WARNING: Invalid Augustus address returned', 'warning');
            }
            if (!paraswapCalldata || paraswapCalldata.length < 10) {
                throw new Error('ParaSwap returned invalid or empty calldata');
            }

            let augustusVersion =
                augustusAddress.toLowerCase() === augustusMap.V6_2.toLowerCase()
                    ? 'v6.2'
                    : augustusAddress.toLowerCase() === augustusMap.V5.toLowerCase()
                        ? 'v5'
                        : txVersion || 'unknown';

            addLog?.(`📦 ParaSwap Route: Augustus ${augustusVersion} (${augustusAddress.slice(0, 10)}...)`, 'success');
            addLog?.(`MaxNewDebt (with ${(bufferBps / 100).toFixed(2)}% buffer): ${maxNewDebt}`, 'info');

            if (paraswapCalldata && paraswapCalldata.length >= 10) {
                const selector = paraswapCalldata.slice(0, 10);
                addLog?.(`ParaSwap Function Selector: ${selector}`, 'info');
            }

            addLog?.(`Version used: ${txVersion}`, 'info');

            const encodedParaswapData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['bytes', 'address'],
                [paraswapCalldata, augustusAddress]
            );

            addLog?.(`ParaSwap Calldata Size: ${paraswapCalldata.length / 2} bytes`, 'info');
            addLog?.(`Encoded ParaSwap Data Size: ${encodedParaswapData.length / 2} bytes`, 'info');
            addLog?.(`ParaSwap Calldata (first 100 chars): ${paraswapCalldata.substring(0, 100)}`, 'info');
            addLog?.(`Augustus (final): ${augustusAddress} (${augustusVersion})`, 'info');

            const offset = augustusVersion === 'v6.2-sdk' ? 0x84 : 0;

            addLog?.(`Offset: ${offset} (0x${offset.toString(16)}) - ${augustusVersion === 'v6.2-sdk' ? 'SDK v6.2' : 'API v5 fallback'}`, 'info');
            addLog?.(`Target Debt to Repay: ${exactDebtRepayAmount.toString()} (${ethers.formatUnits(exactDebtRepayAmount, fromToken.decimals)} ${fromToken.symbol})`, 'info');

            const swapParams = {
                debtAsset: fromToken.address || fromToken.underlyingAsset,
                debtRepayAmount: exactDebtRepayAmount,
                debtRateMode: 2,
                newDebtAsset: toToken.address || toToken.underlyingAsset,
                maxNewDebtAmount: maxNewDebt,
                extraCollateralAsset: ethers.ZeroAddress,
                extraCollateralAmount: 0,
                offset,
                paraswapData: encodedParaswapData,
            };

            addLog?.(`SwapParams - debtAsset: ${swapParams.debtAsset}`, 'info');
            addLog?.(`SwapParams - debtRepayAmount: ${swapParams.debtRepayAmount}`, 'info');
            addLog?.(`SwapParams - newDebtAsset: ${swapParams.newDebtAsset}`, 'info');
            addLog?.(`SwapParams - maxNewDebtAmount: ${swapParams.maxNewDebtAmount}`, 'info');
            addLog?.(`SwapParams - paraswapData length: ${swapParams.paraswapData.length / 2} bytes`, 'info');

            const debtRepayFormatted = ethers.formatUnits(swapParams.debtRepayAmount, fromToken.decimals);
            const srcAmountFormatted = ethers.formatUnits(activeQuote.srcAmount, toToken.decimals);
            const maxNewDebtFormatted = ethers.formatUnits(swapParams.maxNewDebtAmount, toToken.decimals);
            const priceRatio = parseFloat(debtRepayFormatted) / parseFloat(srcAmountFormatted);

            addLog?.(`📊 VALUES TO BE SENT TO WALLET:`, 'info');
            addLog?.(`  • Debt to Repay (debtRepayAmount): ${debtRepayFormatted} ${fromToken.symbol}`, 'info');
            addLog?.(`  • WETH required (quoted srcAmount): ${srcAmountFormatted} ${toToken.symbol}`, 'info');
            addLog?.(`  • Max WETH authorized (maxNewDebtAmount): ${maxNewDebtFormatted} ${toToken.symbol}`, 'info');
            addLog?.(`  • Conversion rate: 1 ${toToken.symbol} = ${priceRatio.toFixed(2)} ${fromToken.symbol}`, 'info');
            addLog?.(`  • If WETH = $2700: ${(parseFloat(srcAmountFormatted) * 2700).toFixed(2)} USD`, 'info');

            const creditPermitDebtToken = permitParams.amount === 0 ? ethers.ZeroAddress : newDebtTokenAddr;

            const creditPermit = {
                debtToken: creditPermitDebtToken,
                value: permitParams.amount,
                deadline: permitParams.deadline,
                v: permitParams.v,
                r: permitParams.r,
                s: permitParams.s,
            };

            addLog?.(`CreditPermit - debtToken: ${creditPermit.debtToken}`, 'info');
            addLog?.(`CreditPermit - value: ${creditPermit.value}`, 'info');

            const collateralPermit = {
                aToken: ethers.ZeroAddress,
                value: 0,
                deadline: 0,
                v: 0,
                r: ethers.ZeroHash,
                s: ethers.ZeroHash,
            };

            addLog?.(`CollateralPermit - aToken: ${collateralPermit.aToken}`, 'info');

            logger.debug('⛽ Step 5: Estimating gas and preparing transaction...');
            addLog?.('3/3 Estimating gas and confirming in wallet...', 'warning');
            let tx;
            let gasLimit;

            const adapterContract = new ethers.Contract(adapterAddress, ABIS.ADAPTER, signer);
            logger.debug('  - Adapter contract initialized:', adapterAddress);

            try {
                logger.debug('  - Calling estimateGas for swapDebt...');
                logger.debug('  - swapParams:', {
                    debtAsset: swapParams.debtAsset,
                    debtRepayAmount: swapParams.debtRepayAmount.toString(),
                    debtRateMode: swapParams.debtRateMode,
                    newDebtAsset: swapParams.newDebtAsset,
                    maxNewDebtAmount: swapParams.maxNewDebtAmount.toString(),
                    offset: swapParams.offset,
                    paraswapDataLength: swapParams.paraswapData.length
                });
                logger.debug('  - creditPermit:', {
                    debtToken: creditPermit.debtToken,
                    value: creditPermit.value.toString(),
                    deadline: creditPermit.deadline.toString(),
                    v: creditPermit.v,
                    r: creditPermit.r.substring(0, 20) + '...',
                    s: creditPermit.s.substring(0, 20) + '...'
                });
                logger.debug('  - collateralPermit:', collateralPermit);

                addLog?.('Estimating required gas...', 'info');

                if (simulateError) {
                    throw new Error('Manual Error Simulation: Forced failure for testing.');
                }

                logger.debug('  - Starting estimateGas call with 15s timeout...');

                // Retry / diagnostics policy for estimateGas to handle transient RPC/provider issues
                const maxAttempts = 3;
                let lastEstimateError = null;
                let diagnosticReason = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        const estimateGasPromise = adapterContract.swapDebt.estimateGas(
                            swapParams,
                            creditPermit,
                            collateralPermit
                        );

                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Gas estimation timeout after 15 seconds')), 15000)
                        );

                        const estimatedGas = await Promise.race([estimateGasPromise, timeoutPromise]);

                        logger.debug('  - estimateGas returned successfully! (attempt', attempt, ')');
                        gasLimit = (estimatedGas * BigInt(150)) / BigInt(100);
                        const minGas = BigInt(2000000);
                        const maxGas = BigInt(15000000);
                        if (gasLimit < minGas) gasLimit = minGas;
                        if (gasLimit > maxGas) gasLimit = maxGas;

                        logger.debug('✅ Gas estimation successful:', {
                            estimated: estimatedGas.toString(),
                            withBuffer: gasLimit.toString()
                        });
                        addLog?.(`📊 Estimated gas: ${estimatedGas.toString()}, using: ${gasLimit.toString()} (1.5x buffer)`, 'success');
                        lastEstimateError = null;
                        break; // success
                    } catch (err) {
                        lastEstimateError = err;
                        logger.warn(`[estimateGas] attempt ${attempt} failed:`, err?.message || err);

                        // Attempt diagnostics and actionable fallback via read-only RPC provider (if available)
                        if (networkRpcProvider && account) {
                            try {
                                const adapterRead = new ethers.Contract(adapterAddress, ABIS.ADAPTER, networkRpcProvider);
                                logger.debug('[estimateGas] running diagnostic via networkRpcProvider (callStatic/estimateGas)');

                                // Try callStatic to surface revert reason if present
                                try {
                                    await adapterRead.callStatic.swapDebt(swapParams, creditPermit, collateralPermit, { from: account });
                                } catch (callErr) {
                                    diagnosticReason = callErr?.reason || callErr?.data || String(callErr?.message || callErr);
                                    logger.debug('[estimateGas][diagnostic] callStatic threw:', diagnosticReason);
                                }

                                // Try estimateGas on the read provider — if it succeeds, use it as a valid fallback
                                try {
                                    const est = await adapterRead.estimateGas(swapParams, creditPermit, collateralPermit, { from: account });
                                    logger.debug('[estimateGas][diagnostic] networkRpcProvider estimated gas:', est.toString());

                                    // Accept the read-provider estimate as a fallback and continue flow
                                    logger.info('[estimateGas] Using networkRpcProvider estimate as fallback for gasLimit');
                                    const estimatedGas = est;
                                    gasLimit = (estimatedGas * BigInt(150)) / BigInt(100);
                                    const minGas = BigInt(2000000);
                                    const maxGas = BigInt(15000000);
                                    if (gasLimit < minGas) gasLimit = minGas;
                                    if (gasLimit > maxGas) gasLimit = maxGas;

                                    logger.debug('✅ Fallback gas estimate successful (networkRpcProvider):', {
                                        estimated: estimatedGas.toString(),
                                        withBuffer: gasLimit.toString()
                                    });

                                    // Treat as success and exit retry loop
                                    lastEstimateError = null;
                                    diagnosticReason = diagnosticReason || 'Fallback estimate used';
                                    break;
                                } catch (estErr) {
                                    logger.debug('[estimateGas][diagnostic] networkRpcProvider estimateGas failed:', estErr?.message || estErr);
                                    if (!diagnosticReason) diagnosticReason = estErr?.message || String(estErr);
                                }
                            } catch (diagErr) {
                                logger.debug('[estimateGas][diagnostic] diagnostics failed:', diagErr?.message || diagErr);
                                if (!diagnosticReason) diagnosticReason = diagErr?.message || String(diagErr);
                            }
                        }

                        // Detect malformed RPC responses / parse errors and give more actionable feedback
                        const msg = String(err?.message || '');
                        const isParseError = /invalid character|could not coalesce error|unexpected token/i.test(msg);

                        if (isParseError) {
                            logger.warn('[estimateGas] Detected RPC/parse error; consider switching RPC endpoint or retrying');
                        }

                        // If not last attempt, wait briefly and retry
                        if (attempt < maxAttempts) {
                            await new Promise(r => setTimeout(r, 300 * attempt));
                            continue;
                        }
                    }
                }

                // If after retries we still have an error, handle it (preserve previous UX)
                if (lastEstimateError) {
                    logger.error('❌ GAS ESTIMATION FAILED:', lastEstimateError);
                    logger.error('  - Error name:', lastEstimateError?.name);
                    logger.error('  - Error code:', lastEstimateError?.code);
                    logger.error('  - Error message:', lastEstimateError?.message);
                    logger.error('  - Error data:', lastEstimateError?.data);
                    logger.error('  - Error reason:', lastEstimateError?.reason);
                    logger.error('  - Error shortMessage:', lastEstimateError?.shortMessage);

                    // Surface a clearer message when diagnostics found a revert reason
                    if (diagnosticReason) {
                        addLog?.(`🔍 Simulation diagnostic: ${diagnosticReason}`, 'debug');
                    }

                    // If parse/RPC error was detected, suggest RPC switch
                    const msg = String(lastEstimateError?.message || '');
                    const isParseError = /invalid character|could not coalesce error|unexpected token/i.test(msg);

                    addLog?.(`❌ Simulation failed - Transaction cancelled`, 'error');

                    if (isParseError) {
                        addLog?.('⚠️ RPC returned malformed response; try switching RPC endpoint or refresh the page.', 'error');
                        setTxError('RPC returned malformed response. Try switching RPC endpoint or refresh the page.');
                    } else if (diagnosticReason) {
                        addLog?.(`Reason: ${diagnosticReason}`, 'error');
                        setTxError(`Simulation failed: ${String(diagnosticReason).substring(0, 200)}`);
                    } else {
                        addLog?.(`Reason: ${lastEstimateError?.shortMessage || lastEstimateError.message.substring(0, 150)}`, 'error');
                        setTxError('Simulation failed. The quote has been updated. Please try again.');
                    }

                    addLog?.(`🔄 Auto-refreshing quote for a new attempt...`, 'warning');
                    fetchQuote();

                    setIsActionLoading(false);
                    return;
                }
            } catch (e) {
                // Safety net - should not reach here
                logger.error('[estimateGas] Unexpected error in estimation flow:', e);
                addLog?.('❌ Simulation failed due to an internal error. Try again.', 'error');
                setTxError('Internal error during simulation. Try again.');
                fetchQuote();
                setIsActionLoading(false);
                return;
            }

            logger.debug('🚀 Step 6: Sending transaction to wallet for confirmation...');
            logger.debug('  - GasLimit:', gasLimit.toString());
            logger.debug('  - Waiting for user confirmation in wallet...');

            try {
                tx = await adapterContract.swapDebt(
                    swapParams,
                    creditPermit,
                    collateralPermit,
                    { gasLimit }
                );

                logger.debug('✅ Step 6 Complete: Transaction sent to network!');
                logger.debug('  - Transaction hash:', tx.hash);
                logger.debug('  - Block explorer:', `https://basescan.org/tx/${tx.hash}`);

                addLog?.('✅ swapDebt sent successfully!', 'success');
            } catch (swapError) {
                if (swapError.code === 'ACTION_REJECTED') {
                    addLog?.('User rejected action.', 'warning');
                    setUserRejected(true);
                    resetRefreshCountdown();
                    throw swapError;
                }
                addLog?.(`\n❌ swapDebt failed: ${swapError.message.substring(0, 150)}`, 'error');
                if (swapError.reason) {
                    addLog?.(`Reason: ${swapError.reason}`, 'error');
                }
                if (swapError.data && swapError.data !== '0x') {
                    addLog?.(`Error data: ${swapError.data.substring(0, 100)}`, 'debug');
                }
                throw swapError;
            }

            addLog?.('\nWaiting for transaction confirmation...', 'info');
            addLog?.(`Tx hash: ${tx.hash}`, 'warning');
            addLog?.(`🔍 BaseScan: https://basescan.org/tx/${tx.hash}`, 'info');

            // Record transaction hash on backend for tracking
            if (currentTransactionId) {
                await recordTransactionHash(currentTransactionId, tx.hash);
            }

            let receipt;
            let waitRetryCount = 0;
            const waitMaxRetries = 5;

            // Retry logic for tx.wait() - RPC may return null temporarily
            while (waitRetryCount < waitMaxRetries) {
                try {
                    receipt = await tx.wait();
                    break; // Success - exit loop
                } catch (waitError) {
                    waitRetryCount++;

                    // If it's a BAD_DATA error with result: null, it's a temporary RPC error
                    const isTempRpcError =
                        waitError.code === 'BAD_DATA' ||
                        waitError.message?.includes('result": null') ||
                        waitError.message?.includes('invalid numeric value');

                    if (isTempRpcError && waitRetryCount < waitMaxRetries) {
                        addLog?.(`⏳ RPC busy - attempt ${waitRetryCount}/${waitMaxRetries}...`, 'info');
                        // Wait progressively longer (1s, 2s, 3s, 4s, 5s)
                        await new Promise(resolve => setTimeout(resolve, waitRetryCount * 1000));
                        continue;
                    }

                    // If not a temporary error or retries exhausted, check manually
                    if (waitRetryCount >= waitMaxRetries) {
                        addLog?.(`⚠️ RPC did not return receipt after ${waitMaxRetries} attempts`, 'warning');
                        addLog?.(`🔍 Checking manually on blockchain...`, 'info');

                        try {
                            // Fetch transaction directly (first try wallet provider)
                            let txData = null;
                            try {
                                txData = await provider.getTransaction(tx.hash);
                            } catch (providerErr) {
                                logger.debug('[wait][manualCheck] provider.getTransaction failed, will try networkRpcProvider as fallback:', providerErr?.message || providerErr);
                            }

                            // If wallet provider didn't return useful data, try read-only RPC provider
                            if ((!txData || !txData.blockNumber) && networkRpcProvider) {
                                try {
                                    const remoteTx = await networkRpcProvider.getTransaction(tx.hash);
                                    if (remoteTx && remoteTx.blockNumber) {
                                        txData = remoteTx;
                                        logger.debug('[wait][manualCheck] networkRpcProvider returned transaction info:', { blockNumber: remoteTx.blockNumber });
                                    }
                                } catch (rpcErr) {
                                    logger.debug('[wait][manualCheck] networkRpcProvider.getTransaction failed:', rpcErr?.message || rpcErr);
                                }
                            }

                            if (txData && txData.blockNumber) {
                                addLog?.(`✅ Transaction CONFIRMED in block ${txData.blockNumber}!`, 'success');
                                addLog?.(`🔍 Check details: https://basescan.org/tx/${tx.hash}`, 'info');
                                // Transaction was mined - consider success
                                break;
                            } else {
                                addLog?.(`⏳ Transaction still pending...`, 'warning');
                                throw new Error('Transaction pending or not found');
                            }
                        } catch (manualCheckError) {
                            addLog?.(`❌ Could not confirm transaction status`, 'error');
                            addLog?.(`🔍 Check manually: https://basescan.org/tx/${tx.hash}`, 'error');
                            throw new Error(`Unable to confirm transaction status. Check BaseScan: ${tx.hash}`);
                        }
                    }

                    // Transaction was mined but reverted
                    if (waitError.receipt && waitError.receipt.status === 0) {
                        addLog?.('❌ Transaction REVERTED on-chain!', 'error');
                        addLog?.(`🔍 Check details: https://basescan.org/tx/${tx.hash}`, 'error');

                        // Try to decode revert reason
                        if (waitError.reason) {
                            addLog?.(`Revert reason: ${waitError.reason}`, 'error');
                        } else if (waitError.data) {
                            addLog?.(`Revert data: ${waitError.data.substring(0, 100)}`, 'error');
                        }

                        throw new Error(`Transaction reverted: ${waitError.reason || 'Check BaseScan for details'}`);
                    }

                    // If reached here and not a temporary error, throw
                    throw waitError;
                }
            }

            // If we have receipt, process normally
            if (receipt) {
                // Check if transaction was successful
                if (receipt.status === 0) {
                    addLog?.('❌ Transaction REVERTED on-chain!', 'error');

                    // Try to get revert reason
                    try {
                        const code = await provider.call(tx, tx.blockNumber);
                        addLog?.(`Revert reason: ${code}`, 'error');
                    } catch (revertError) {
                        const reason = revertError.reason || revertError.data || 'Unknown reason';
                        addLog?.(`Revert reason: ${reason}`, 'error');
                    }

                    throw new Error(`Transaction reverted. Check BaseScan: https://basescan.org/tx/${tx.hash}`);
                }

                const gasUsed = receipt.gasUsed;
                const gasPrice = receipt.gasPrice || receipt.effectiveGasPrice;
                const gasCostInGwei = (gasUsed * gasPrice) / BigInt(1e9);
                addLog?.(`📊 Gas used: ${gasUsed.toString()} (~${ethers.formatUnits(gasCostInGwei, 9)} Gwei)`, 'info');

                // Confirm transaction on backend with final details
                if (currentTransactionId) {
                    // Record actual debt repaid (exact output) instead of the authorization ceiling
                    await confirmTransactionOnChain(currentTransactionId, {
                        gasUsed: gasUsed.toString(),
                        actualPaid: exactDebtRepayAmount.toString(),
                        apyPercent: swapQuote?.apyPercent ?? null
                    });
                }
            }

            addLog?.('🚀 SUCCESS! Swap complete.', 'success');

            clearQuote();
            setSignedPermit(null);
            setForceRequirePermit(false);
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('lilswap.forceRequirePermit'); } catch (err) { logger.debug('[handleSwap] failed to clear persisted flag:', err?.message || err); }
            setCurrentTransactionId(null);  // Clear transaction ID
            fetchDebtData();
        } catch (error) {
            logger.error('❌ [handleSwap] Caught error in main try-catch:', error);
            logger.error('  - Error code:', error.code);
            logger.error('  - Error message:', error.message);
            logger.error('  - Full error:', error);

            if (error.code === 'ACTION_REJECTED') {
                setUserRejected(true);
            } else {
                // Enhanced error message with troubleshooting hints
                let errorMsg = error.message;

                if (errorMsg.includes('reverted') || errorMsg.includes('execution failed')) {
                    errorMsg = 'Transaction reverted. Possible causes:\n' +
                        '• Slippage exceeded (price changed)\n' +
                        '• Health Factor < 1.0 after swap\n' +
                        '• Insufficient collateral for new debt\n' +
                        '• ParaSwap route expired';
                }

                setTxError(errorMsg);
                addLog?.('FAILURE: ' + errorMsg, 'error');
                setUserRejected(false);
            }
            resetRefreshCountdown();
        } finally {
            setIsActionLoading(false);
            setCurrentTransactionId(null);  // Always clear transaction ID on completion or error
        }
    }, [
        account,
        allowance,
        swapQuote,
        fetchQuote,
        addLog,
        provider,
        slippage,
        clearQuote,
        fetchDebtData,
        resetRefreshCountdown,
        signedPermit,
        adapterAddress,
        networkAddresses,
        chainId,
        ensureWalletNetwork,
        targetNetwork.label,
        preferPermit,
        forceRequirePermit,
        handleApproveDelegation,
        networkRpcProvider,
    ]);

    const handleForceSwap = useCallback(async () => {
        if (!pendingTxParams) return;
        setTxError(null);
        setIsActionLoading(true);
        try {
            const activeProvider = await ensureWalletNetwork();
            if (!activeProvider) {
                return;
            }
            const signer = await activeProvider.getSigner();
            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
            addLog?.('Forcing transaction submission (Flashloan, Gas Limit: 8M)...', 'warning');
            const [debtAsset, debtAmount, encodedParams] = pendingTxParams;
            const tx = await poolContract.flashLoanSimple(
                adapterAddress,
                debtAsset,
                debtAmount,
                encodedParams,
                0,
                { gasLimit: 8000000 }
            );
            addLog?.(`Tx sent (Forced): ${tx.hash}`, 'warning');
            await tx.wait();
            addLog?.('🚀 SUCCESS! Swap complete.', 'success');
            clearQuote();
            setSignedPermit(null);
            setForceRequirePermit(false);
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem('lilswap.forceRequirePermit'); } catch (err) { logger.debug('[handleForceSwap] failed to clear persisted flag:', err?.message || err); }
            setPendingTxParams(null);
            fetchDebtData();
        } catch (error) {
            setTxError(error.message);
            addLog?.('FAILURE (Forced): ' + error.message, 'error');
        } finally {
            setIsActionLoading(false);
        }
    }, [pendingTxParams, addLog, clearQuote, fetchDebtData, networkAddresses, adapterAddress, ensureWalletNetwork]);

    const clearTxError = useCallback(() => setTxError(null), []);
    const clearUserRejected = useCallback(() => setUserRejected(false), []);
    const clearCachedPermit = useCallback(async () => {
        // Clear in-memory cached signature
        setSignedPermit(null);
        // Force the next swap to request a fresh off-chain signature even if on-chain allowance exists
        setForceRequirePermit(true);
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('lilswap.forceRequirePermit', '1');
            }
        } catch (err) {
            logger.debug('[clearCachedPermit] failed to persist forceRequirePermit:', err?.message || err);
        }

        // Aggressive cleanup to avoid reusing a stale simulation or pending tx params
        setPendingTxParams(null);
        setLastAttemptedQuote(null);
        setTxError(null);

        // Clear frontend quote so UI shows a fresh flow and the next action will re-fetch/require signature
        if (typeof clearQuote === 'function') {
            try { clearQuote(); } catch (err) { logger.debug('[clearCachedPermit] clearQuote failed:', err?.message || err); }
        }

        addLog?.('Cached permit cleared — next swap will request a fresh signature', 'success');

        // Ask wallet (if available) to forget site permissions / cached approvals.
        // This is best-effort: some wallets (MetaMask, Rabby) expose wallet_getPermissions / wallet_revokePermissions.
        if (typeof window !== 'undefined' && window.ethereum && window.ethereum.request) {
            try {
                let perms = null;
                try {
                    perms = await window.ethereum.request({ method: 'wallet_getPermissions' });
                    logger.debug('[clearCachedPermit] wallet_getPermissions:', perms);
                } catch (gErr) {
                    logger.debug('[clearCachedPermit] wallet_getPermissions not available or failed:', gErr?.message || gErr);
                }

                // Try to revoke account permissions (best-effort). This may disconnect the wallet/ui.
                try {
                    await window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
                    addLog?.('Requested wallet to forget site permissions — reconnect to continue', 'info');
                    logger.info('[clearCachedPermit] wallet_revokePermissions called');
                } catch (revErr) {
                    logger.debug('[clearCachedPermit] wallet_revokePermissions failed:', revErr?.message || revErr);
                    addLog?.('Wallet did not accept permission-revoke request. Please remove site trust in your wallet settings (Rabby/MetaMask).', 'warning');
                }
            } catch (err) {
                logger.debug('[clearCachedPermit] wallet forget attempt failed:', err?.message || err);
            }
        } else {
            addLog?.('No injected wallet detected; clear cached permit in your wallet extension if present.', 'info');
        }
    }, [setForceRequirePermit, clearQuote, addLog]);

    return {
        isActionLoading,
        signedPermit,
        forceRequirePermit,
        txError,
        pendingTxParams,
        lastAttemptedQuote,
        userRejected,
        handleApproveDelegation,
        handleSwap,
        handleForceSwap,
        clearTxError,
        clearUserRejected,
        clearCachedPermit,
        setTxError,
    };
};
