import { useCallback, useState } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { ABIS } from '../constants/abis.js';
import { buildDebtSwapTx } from '../services/api.js';
import { getTokenDefsByDirection } from '../services/aaveContracts.js';

export const useDebtSwitchActions = ({
    account,
    provider,
    direction,
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
}) => {
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [signedPermit, setSignedPermit] = useState(null);
    const [txError, setTxError] = useState(null);
    const [pendingTxParams, setPendingTxParams] = useState(null);
    const [lastAttemptedQuote, setLastAttemptedQuote] = useState(null);
    const [userRejected, setUserRejected] = useState(false);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const adapterAddress = networkAddresses.ADAPTER;
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

    const handleApproveDelegation = useCallback(async () => {
        if (!provider) return;
        try {
            setIsActionLoading(true);
            const signer = await provider.getSigner();
            const poolContract = new ethers.Contract(networkAddresses.POOL, ABIS.POOL, signer);
            const { toToken } = getTokenDefsByDirection(direction, networkAddresses);
            const toReserveData = await poolContract.getReserveData(toToken.address);
            const newDebtContract = new ethers.Contract(toReserveData.variableDebtTokenAddress, ABIS.DEBT_TOKEN, signer);

            addLog?.('Sending Approval Tx...');
            const tx = await newDebtContract.approveDelegation(adapterAddress, ethers.MaxUint256);
            addLog?.(`Tx sent: ${tx.hash}. Waiting...`, 'warning');
            await tx.wait();

            addLog?.('Delegation approved!', 'success');
            fetchDebtData();
        } catch (error) {
            addLog?.('Approval error: ' + error.message, 'error');
        } finally {
            setIsActionLoading(false);
        }
    }, [provider, direction, addLog, fetchDebtData, networkAddresses, adapterAddress]);
    const handleSwap = useCallback(async () => {
        setTxError(null);
        setPendingTxParams(null);
        setUserRejected(false);

        let activeQuote = swapQuote;
        if (!activeQuote) {
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

        try {
            const activeProvider = await ensureWalletNetwork();
            if (!activeProvider) {
                return;
            }

            const signer = await activeProvider.getSigner();
            const { priceRoute, srcAmount, fromToken, toToken, version } = activeQuote;
            // Ensure srcAmount is BigInt (can come as string or BigInt)
            const srcAmountBigInt = typeof srcAmount === 'bigint' ? srcAmount : BigInt(srcAmount);
            const maxNewDebt = (srcAmountBigInt * BigInt(1005)) / BigInt(1000);

            let permitParams = { amount: 0, deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

            if (allowance < maxNewDebt) {
                const newDebtTokenAddr = toToken.debtAddress;
                const currentTs = Math.floor(Date.now() / 1000);

                if (
                    signedPermit &&
                    signedPermit.token === newDebtTokenAddr &&
                    signedPermit.deadline > currentTs &&
                    signedPermit.value >= maxNewDebt
                ) {
                    addLog?.('1/3 Using cached signature...', 'info');
                    permitParams = signedPermit.params;
                } else {
                    addLog?.('1/3 Requesting Signature (EIP-712)...', 'warning');
                    const debtContract = new ethers.Contract(newDebtTokenAddr, ABIS.DEBT_TOKEN, signer);
                    let nonce;
                    try {
                        nonce = await debtContract.nonces(account);
                    } catch (nonceError) {
                        throw new Error('Failed to read nonce from debt contract. Check RPC connection.');
                    }

                    const name = await debtContract.name();
                    const deadline = Math.floor(Date.now() / 1000) + 3600;
                    const value = ethers.MaxUint256;

                    addLog?.(`Generating signature for amount: MaxUint256 (Nonce: ${nonce})`, 'info');

                    const domain = {
                        name,
                        version: '1',
                        chainId,
                        verifyingContract: newDebtTokenAddr,
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

                    const signature = await signer.signTypedData(domain, types, message);
                    const sig = ethers.Signature.from(signature);

                    permitParams = {
                        amount: value,
                        deadline,
                        v: sig.v,
                        r: sig.r,
                        s: sig.s,
                    };
                    setSignedPermit({
                        params: permitParams,
                        token: newDebtTokenAddr,
                        deadline,
                        value,
                    });

                    addLog?.('Signature Received and Cached!', 'success');
                }
            } else {
                addLog?.('1/3 Delegation already approved on-chain.', 'success');
            }

            addLog?.('2/3 Generating calldata...', 'warning');
            addLog?.(`Slippage: ${slippage / 100}%`, 'info');

            const txResult = await buildDebtSwapTx({
                fromToken: {
                    address: fromToken.address,
                    decimals: fromToken.decimals,
                    symbol: fromToken.symbol,
                },
                toToken: {
                    address: toToken.address,
                    decimals: toToken.decimals,
                    symbol: toToken.symbol,
                },
                priceRoute,
                userAddress: adapterAddress,
                slippage,
                chainId,
            });

            const { swapCallData: paraswapCalldata, augustus: augustusAddress, version: txVersion } = txResult;

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
            addLog?.(`MaxNewDebt (with 0.5% buffer): ${maxNewDebt}`, 'info');

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
            const exactDebtRepayAmount = activeQuote.destAmount;

            addLog?.(`Offset: ${offset} (0x${offset.toString(16)}) - ${augustusVersion === 'v6.2-sdk' ? 'SDK v6.2' : 'API v5 fallback'}`, 'info');
            addLog?.(`Target Debt to Repay: ${exactDebtRepayAmount.toString()} (${ethers.formatUnits(exactDebtRepayAmount, fromToken.decimals)} ${fromToken.symbol})`, 'info');

            const swapParams = {
                debtAsset: fromToken.address,
                debtRepayAmount: exactDebtRepayAmount,
                debtRateMode: 2,
                newDebtAsset: toToken.address,
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

            const creditPermit = {
                debtToken: toToken.debtAddress,
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

            addLog?.('3/3 Estimating gas and confirming in wallet...', 'warning');
            let tx;
            let gasLimit;

            const adapterContract = new ethers.Contract(adapterAddress, ABIS.ADAPTER, signer);

            try {
                addLog?.('Estimating required gas...', 'info');

                if (simulateError) {
                    throw new Error("Manual Error Simulation: Forced failure for testing.");
                }

                const estimatedGas = await adapterContract.swapDebt.estimateGas(
                    swapParams,
                    creditPermit,
                    collateralPermit
                );
                gasLimit = (estimatedGas * BigInt(150)) / BigInt(100);
                const minGas = BigInt(2000000);
                const maxGas = BigInt(15000000);
                if (gasLimit < minGas) gasLimit = minGas;
                if (gasLimit > maxGas) gasLimit = maxGas;
                addLog?.(`📊 Estimated gas: ${estimatedGas.toString()}, using: ${gasLimit.toString()} (1.5x buffer)`, 'success');
            } catch (estimateError) {
                addLog?.(`❌ Simulation failed - Transaction cancelled`, 'error');
                addLog?.(`Reason: ${estimateError?.shortMessage || estimateError.message.substring(0, 150)}`, 'error');
                addLog?.(`🔍 Revert Data: ${estimateError?.data || 'N/A'}`, 'debug');
                addLog?.(`🔄 Auto-refreshing quote for a new attempt...`, 'warning');

                // Auto-refresh quote to change parameters for next attempt
                fetchQuote();

                // Set simple error message for UI
                setTxError(`Simulation failed. The quote has been updated. Please try again.`);

                // Stop execution - do not send transaction
                setIsActionLoading(false);
                return;
            }

            try {
                tx = await adapterContract.swapDebt(
                    swapParams,
                    creditPermit,
                    collateralPermit,
                    { gasLimit }
                );
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

            let receipt;
            let retryCount = 0;
            const maxRetries = 5;

            // Retry logic for tx.wait() - RPC may return null temporarily
            while (retryCount < maxRetries) {
                try {
                    receipt = await tx.wait();
                    break; // Success - exit loop
                } catch (waitError) {
                    retryCount++;

                    // If it's a BAD_DATA error with result: null, it's a temporary RPC error
                    const isTempRpcError =
                        waitError.code === 'BAD_DATA' ||
                        waitError.message?.includes('result": null') ||
                        waitError.message?.includes('invalid numeric value');

                    if (isTempRpcError && retryCount < maxRetries) {
                        addLog?.(`⏳ RPC busy - attempt ${retryCount}/${maxRetries}...`, 'info');
                        // Wait progressively longer (1s, 2s, 3s, 4s, 5s)
                        await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
                        continue;
                    }

                    // If not a temporary error or retries exhausted, check manually
                    if (retryCount >= maxRetries) {
                        addLog?.(`⚠️ RPC did not return receipt after ${maxRetries} attempts`, 'warning');
                        addLog?.(`🔍 Checking manually on blockchain...`, 'info');

                        try {
                            // Fetch transaction directly
                            const txData = await provider.getTransaction(tx.hash);
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
            }

            addLog?.('🚀 SUCCESS! Swap complete.', 'success');
            clearQuote();
            setSignedPermit(null);
            fetchDebtData();
        } catch (error) {
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
    const clearCachedPermit = useCallback(() => setSignedPermit(null), []);

    return {
        isActionLoading,
        signedPermit,
        txError,
        pendingTxParams,
        lastAttemptedQuote,
        userRejected,
        handleApproveDelegation,
        handleSwap,
        handleForceSwap,
        clearTxError,
        clearCachedPermit,
        setTxError,
    };
};
