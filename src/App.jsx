import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { ArrowRightLeft, Wallet, RefreshCw, CheckCircle2, Terminal, AlertTriangle, X, Info } from 'lucide-react';
import { useWeb3 } from './context/web3Context.js';
import { DEFAULT_NETWORK } from './constants/networks.js';
import { useDebtPositions } from './hooks/useDebtPositions.js';
import { useParaswapQuote } from './hooks/useParaswapQuote.js';
import { useDebtSwitchActions } from './hooks/useDebtSwitchActions.js';
import { AmountInput } from './components/AmountInput.jsx';

const BaseIcon = ({ className }) => (
  <svg
    viewBox="0 0 44 44"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect width="44" height="44" rx="22" fill="#0052FF" />
    <path
      d="M21.9756 36C29.721 36 36 29.732 36 22C36 14.268 29.721 8 21.9756 8C14.6271 8 8.59871 13.6419 8 20.8232H26.5371V23.1768H8C8.59871 30.3581 14.6271 36 21.9756 36Z"
      fill="white"
    />
  </svg>
);

const LilLogo = ({ className = "w-6 h-6" }) => (
  <svg
    viewBox="0 0 1536 1536"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid meet"
  >
    <rect x="0" y="0" width="1536" height="1536" rx="350" ry="350" fill="#643ab6" />
    <g transform="translate(768 768) scale(1.45) translate(-768 -768)">
      <g transform="translate(0,1536) scale(0.1,-0.1)" fill="#FFFFFF" stroke="none">
        <path d="M8348 10928 l-3 -412 -128 -22 c-593 -105 -1070 -425 -1300 -872 -116 -226 -157 -400 -157 -670 0 -375 94 -643 315 -902 106 -124 324 -288 504 -380 177 -90 463 -174 861 -254 306 -61 697 -150 800 -182 116 -35 243 -90 317 -136 177 -111 271 -303 252 -513 -18 -202 -137 -363 -349 -470 -164 -82 -335 -117 -585 -117 -291 -1 -463 37 -690 150 -100 49 -180 109 -258 192 -73 77 -98 117 -80 128 84 55 340 249 335 253 -12 11 -138 54 -387 134 -245 78 -861 278 -1129 366 -82 27 -152 47 -154 44 -4 -4 9 -428 23 -725 3 -58 9 -249 15 -425 6 -176 13 -375 16 -442 l6 -121 56 42 c32 23 112 83 180 134 67 51 124 92 127 92 3 0 48 -45 101 -100 97 -100 232 -210 359 -292 197 -127 526 -244 858 -305 l97 -17 0 -413 0 -413 500 0 500 0 0 415 c0 228 3 415 8 415 21 0 200 32 283 50 252 57 521 173 713 309 184 129 353 317 454 501 133 246 186 461 186 760 0 315 -64 549 -216 782 -218 335 -659 588 -1248 717 -52 12 -176 39 -275 61 -550 121 -682 154 -850 215 -265 96 -396 211 -447 394 -50 180 3 363 147 506 87 87 165 133 303 178 371 122 832 75 1115 -114 69 -46 157 -127 157 -144 0 -11 -11 -22 -205 -185 -60 -51 -111 -96 -113 -99 -1 -4 30 -15 70 -24 77 -18 323 -85 718 -194 360 -99 428 -118 670 -187 124 -35 227 -62 229 -60 2 2 -1 50 -7 106 -41 364 -147 1398 -159 1546 -3 39 -10 72 -14 72 -4 0 -34 -22 -66 -48 -32 -26 -115 -94 -185 -150 l-127 -103 -98 81 c-240 199 -550 344 -873 409 -52 10 -112 22 -132 25 l-38 7 0 409 0 410 -500 0 -500 0 -2 -412z" />
        <path d="M4380 7390 l0 -3110 1805 0 1805 0 -2 262 -3 262 -65 18 c-191 55 -311 93 -379 123 -170 73 -313 148 -436 229 l-130 86 -702 0 -703 0 0 2620 0 2620 -595 0 -595 0 0 -3110z" />
      </g>
    </g>
  </svg>
);

const NetworkIcon = ({ network, className = 'w-6 h-6' }) => {
  if (!network) {
    return null;
  }

  switch (network.key) {
    case 'BASE':
    default:
      return <BaseIcon className={className} />;
  }
};

export default function App() {
  const {
    account,
    provider,
    connectWallet,
    selectedNetwork,
    networkRpcProvider,
  } = useWeb3();
  const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
  const targetChainId = targetNetwork.chainId;
  // --- STATES ---
  const [logs, setLogs] = useState([]);
  const [copyButtonState, setCopyButtonState] = useState('idle'); // 'idle' | 'copied'
  const [hasLoggedAutoConnect, setHasLoggedAutoConnect] = useState(false);
  const [simulateError, setSimulateError] = useState(false); // Debug state
  const [swapAmount, setSwapAmount] = useState(BigInt(0)); // Amount user wants to swap

  // --- LOG HELPER ---
  const addLog = useCallback((msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, msg, type }, ...prev]);
  }, []);

  const {
    direction,
    setDirection,
    debtBalance,
    formattedDebt,
    allowance,
    wethDebt,
    usdcDebt,
    fetchDebtData,
    needsApproval,
    isDebtLoading,
  } = useDebtPositions({ account, provider, networkRpcProvider, addLog, selectedNetwork });

  const {
    swapQuote,
    slippage,
    setSlippage,
    autoRefreshEnabled,
    nextRefreshIn,
    fetchQuote,
    resetRefreshCountdown,
    clearQuote,
    isQuoteLoading,
    isTyping,
  } = useParaswapQuote({
    debtBalance: swapAmount, // Use user-selected amount instead of full debt
    direction,
    addLog,
    selectedNetwork,
  });

  const {
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
  } = useDebtSwitchActions({
    account,
    provider,
    direction,
    allowance,
    swapQuote,
    slippage,
    addLog,
    fetchDebtData,
    fetchQuote,
    resetRefreshCountdown, // Pass refresh callback for failure cases
    clearQuote,
    selectedNetwork,
    simulateError, // Pass debug flag
  });

  const isBusy = isActionLoading || isDebtLoading || isQuoteLoading;

  const checkNetwork = useCallback(async (_provider) => {
    const activeProvider = _provider || provider;
    if (!activeProvider) {
      return false;
    }
    try {
      const network = await activeProvider.getNetwork();
      if (Number(network.chainId) !== targetChainId) {
        addLog(`Incorrect network. Please switch to ${targetNetwork.label}.`, "error");
        return false;
      }
      return true;
    } catch (error) {
      addLog("Error checking network: " + error.message, "error");
      return false;
    }
  }, [provider, addLog, targetChainId, targetNetwork.label]);

  useEffect(() => {
    if (account && !hasLoggedAutoConnect) {
      addLog(`Automatically reconnected: ${account.slice(0, 6)}...`, "success");
      checkNetwork();
      setHasLoggedAutoConnect(true);
    }
  }, [account, hasLoggedAutoConnect, addLog, checkNetwork]);

  // Reset swap amount to full debt when debt balance or direction changes
  useEffect(() => {
    if (debtBalance && debtBalance > BigInt(0)) {
      setSwapAmount(debtBalance);
    } else {
      setSwapAmount(BigInt(0));
    }
  }, [debtBalance, direction]);

  const handleConnectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      alert("No wallet detected!");
      return;
    }

    try {
      const address = await connectWallet();
      addLog(`Wallet connected: ${address.slice(0, 6)}...`, "success");

      await checkNetwork();
    } catch (err) {
      addLog("Error connecting: " + (err?.message || err), "error");
    }
  };

  const handleRefreshQuote = async () => {
    addLog("🔄 Refreshing quote...", "info");
    await fetchQuote();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans flex flex-col items-center justify-center">
      <div className="max-w-2xl w-full space-y-6">

        {/* HEADER */}
        <header className="flex justify-between items-center border-b border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <LilLogo className="w-12 h-12" />
            <div>
              <h1 className="text-2xl font-bold text-white">LilSwap - Aave Debt Shifter</h1>
            </div>
          </div>

          {!account ? (
            <button
              onClick={handleConnectWallet}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-blue-900/20"
            >
              <Wallet className="w-4 h-4" /> Connect Wallet
            </button>
          ) : (
            <div className="bg-slate-800 px-4 py-2 rounded-full text-sm font-mono text-green-400 border border-slate-700 flex items-center gap-3 shadow-lg shadow-slate-900/30">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                {account.slice(0, 6)}...{account.slice(-4)}
              </div>
              <NetworkIcon network={selectedNetwork} className="w-6 h-6" />
            </div>
          )}
        </header>

        {/* MAIN CARD */}
        <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 shadow-2xl">

          {/* DIRECTION SELECTOR */}
          <div className="mb-8">
            <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3 block">Select Asset to Swap</label>
            <div className="bg-slate-900 rounded-xl p-4 space-y-3">
              <button
                onClick={() => setDirection("WETH_TO_USDC")}
                className={`w-full p-4 rounded-lg text-left transition-all border-2 ${direction === "WETH_TO_USDC"
                  ? "bg-slate-700 border-purple-500 shadow-lg shadow-purple-900/30"
                  : "bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${direction === "WETH_TO_USDC" ? "bg-purple-500" : "bg-slate-600"
                      }`}></div>
                    <div>
                      <div className="flex items-center gap-2 font-bold text-white">
                        <span>WETH</span>
                        <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                        <span>USDC</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Swap debt from WETH to USDC</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {wethDebt > BigInt(0) ? (
                      <div>
                        <p className="text-sm font-mono font-bold text-green-400">
                          {Number(ethers.formatUnits(wethDebt, 18)).toFixed(4)}
                        </p>
                        <p className="text-[10px] text-slate-500">WETH available</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No position</p>
                    )}
                  </div>
                </div>
              </button>

              <button
                onClick={() => setDirection("USDC_TO_WETH")}
                className={`w-full p-4 rounded-lg text-left transition-all border-2 ${direction === "USDC_TO_WETH"
                  ? "bg-slate-700 border-purple-500 shadow-lg shadow-purple-900/30"
                  : "bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${direction === "USDC_TO_WETH" ? "bg-purple-500" : "bg-slate-600"
                      }`}></div>
                    <div>
                      <div className="flex items-center gap-2 font-bold text-white">
                        <span>USDC</span>
                        <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                        <span>WETH</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Swap debt from USDC to WETH</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {usdcDebt > BigInt(0) ? (
                      <div>
                        <p className="text-sm font-mono font-bold text-green-400">
                          {Number(ethers.formatUnits(usdcDebt, 6)).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500">USDC available</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No position</p>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* AMOUNT INPUT */}
          {debtBalance > BigInt(0) && (
            <div className="mb-8">
              <AmountInput
                maxAmount={debtBalance}
                decimals={direction === "WETH_TO_USDC" ? 18 : 6}
                symbol={direction === "WETH_TO_USDC" ? "WETH" : "USDC"}
                onAmountChange={setSwapAmount}
                isProcessing={isTyping}
              />
            </div>
          )}

          {/* BALANCE DISPLAY */}
          <div className="bg-linear-to-br from-slate-900 to-slate-800 rounded-xl p-8 mb-8 border border-slate-700/50 text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-purple-500 to-transparent opacity-50"></div>

            <p className="text-slate-400 text-sm mb-2">
              {swapAmount < debtBalance ? 'Swapping' : 'Your total debt in'} {direction === "WETH_TO_USDC" ? "WETH" : "USDC"}
            </p>
            <div className="text-5xl font-bold text-white tracking-tight font-mono">
              {isBusy && !swapAmount ? (
                <span className="animate-pulse">...</span>
              ) : (
                Number(ethers.formatUnits(swapAmount, direction === "WETH_TO_USDC" ? 18 : 6)).toLocaleString(undefined, { maximumFractionDigits: 6 })
              )}
              <span className="text-xl text-slate-500 ml-2 font-sans">{direction === "WETH_TO_USDC" ? "WETH" : "USDC"}</span>
            </div>

            {/* Show total debt if partial swap */}
            {swapAmount > BigInt(0) && swapAmount < debtBalance && (
              <p className="text-xs text-slate-500 mt-2">
                Total debt: {Number(formattedDebt).toLocaleString(undefined, { maximumFractionDigits: 6 })} {direction === "WETH_TO_USDC" ? "WETH" : "USDC"}
              </p>
            )}

            {/* REAL-TIME QUOTE */}
            {swapQuote && (
              <div className="mt-6 bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-between items-center text-xs text-slate-400 uppercase font-bold tracking-wider">
                  <span>Swap Simulation</span>
                  <div className="flex items-center gap-2">
                    {autoRefreshEnabled && (
                      <span className="text-[10px] text-slate-500 font-normal normal-case">
                        🔄 {nextRefreshIn}s
                      </span>
                    )}
                    <button onClick={handleRefreshQuote} className="hover:text-white transition-colors" title="Update Quote">
                      <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-end">
                  <div className="text-left">
                    <p className="text-xs text-slate-500">Estimated New Debt</p>
                    <p className="text-xl font-mono font-bold text-green-400">
                      {Number(ethers.formatUnits(swapQuote.srcAmount, swapQuote.toToken.decimals)).toFixed(4)}
                      <span className="text-sm ml-1 text-slate-500">{swapQuote.toToken.symbol}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Exchange Rate</p>
                    <p className="text-sm font-mono text-slate-300">
                      1 {swapQuote.fromToken.symbol} ≈ {(Number(ethers.formatUnits(swapQuote.srcAmount, swapQuote.toToken.decimals)) / Number(ethers.formatUnits(swapQuote.destAmount, swapQuote.fromToken.decimals))).toFixed(4)} {swapQuote.toToken.symbol}
                    </p>
                  </div>
                </div>

                {/* SLIPPAGE CONTROL */}
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Slippage Tolerance</p>
                    <p className="text-sm font-mono font-bold text-purple-400">{(slippage / 100).toFixed(1)}%</p>
                  </div>
                  <div className="flex gap-2">
                    {[10, 50, 100, 300, 500].map((value) => (
                      <button
                        key={value}
                        onClick={() => setSlippage(value)}
                        className={`flex-1 px-2 py-1.5 text-xs rounded transition-all ${slippage === value
                          ? 'bg-purple-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                          }`}
                      >
                        {(value / 100).toFixed(1)}%
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">
                    Lower = more accurate, but may fail. Higher = more flexible, but pays more.
                  </p>
                </div>

                {/* ROUTE INFO */}
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <div className="flex items-center gap-2 text-xs">
                    <Info className="w-3 h-3" />
                    {swapQuote.version === 'v6.2-sdk' ? (
                      <span className="text-green-400 font-medium">
                        ✨ Augustus v6.2 (Optimized SDK)
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Augustus v5 (REST API fallback)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-purple-400 mt-2">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Anti-dust protection: always pays 100% of debt</span>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={fetchDebtData}
              disabled={!account || isBusy}
              className="mt-6 text-xs text-purple-400 hover:text-purple-300 flex items-center justify-center gap-1 mx-auto transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
              Update Data
            </button>
          </div>

          {/* ACTION BUTTONS */}
          <div className="space-y-4">
            {txError && (
              <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-red-400 font-bold text-sm mb-1">Simulation Error</h3>
                    <p className="text-red-300/80 text-xs font-mono break-all">{txError}</p>
                  </div>
                  <button onClick={clearTxError} className="text-red-400 hover:text-red-300 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* DEBUG INFO: Quote Comparison */}
                {lastAttemptedQuote && swapQuote && (
                  <div className="bg-black/40 rounded p-3 text-xs font-mono border border-red-500/20">
                    <div className="grid grid-cols-2 gap-4 mb-2">
                      <div>
                        <p className="text-slate-500 uppercase text-[10px] font-bold mb-1">Attempted Quote (Snapshot)</p>
                        <p className="text-slate-300">
                          <span className="text-slate-500">In:</span> {Number(ethers.formatUnits(lastAttemptedQuote.srcAmount, lastAttemptedQuote.toToken.decimals)).toFixed(6)} {lastAttemptedQuote.toToken.symbol}
                        </p>
                        <p className="text-slate-300">
                          <span className="text-slate-500">Max (2%):</span> {(Number(ethers.formatUnits(lastAttemptedQuote.srcAmount, lastAttemptedQuote.toToken.decimals)) * 1.02).toFixed(6)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 uppercase text-[10px] font-bold mb-1">Current Quote (Live)</p>
                        <p className={`${BigInt(swapQuote.srcAmount) > BigInt(lastAttemptedQuote.srcAmount) ? 'text-red-400' : 'text-green-400'}`}>
                          <span className="text-slate-500">In:</span> {Number(ethers.formatUnits(swapQuote.srcAmount, swapQuote.toToken.decimals)).toFixed(6)} {swapQuote.toToken.symbol}
                        </p>
                        <p className="text-slate-500 text-[10px] mt-1">
                          {BigInt(swapQuote.srcAmount) > BigInt(lastAttemptedQuote.srcAmount)
                            ? `▲ Price rose (Worsened)`
                            : `▼ Price fell (Improved)`}
                        </p>
                      </div>
                    </div>
                    {pendingTxParams && (
                      <div className="border-t border-white/10 pt-2 mt-1">
                        <p className="text-slate-500 text-[10px]">Sent Params:</p>
                        <p className="text-slate-400 truncate">
                          MaxNewDebt: {Array.isArray(pendingTxParams)
                            ? pendingTxParams[0]?.maxNewDebtAmount?.toString()
                            : pendingTxParams?.maxNewDebtAmount?.toString()}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pl-8 flex-wrap">
                  <button
                    onClick={() => {
                      clearTxError();
                      clearCachedPermit();
                      fetchQuote();
                    }}
                    className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded border border-red-500/30 transition-colors"
                  >
                    Clear Cache & Try Again
                  </button>

                  {/* Fallback for On-Chain Approval */}
                  <button
                    onClick={() => {
                      clearTxError();
                      handleApproveDelegation();
                    }}
                    className="text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 px-3 py-1.5 rounded border border-blue-500/30 transition-colors flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Approve Manually (On-Chain)
                  </button>

                  {/* Force Send Button */}
                  {pendingTxParams && (
                    <button
                      onClick={handleForceSwap}
                      className="text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 px-3 py-1.5 rounded border border-yellow-500/30 transition-colors flex items-center gap-1 font-bold"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Force Send (Ignore Error)
                    </button>
                  )}
                </div>
              </div>
            )}

            {!account ? (
              <div className="text-center text-slate-500 py-6 bg-slate-900/30 rounded-xl border border-dashed border-slate-700">
                Connect your wallet above to operate
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handleSwap}
                  disabled={isBusy || !debtBalance || debtBalance === BigInt(0) || !swapQuote}
                  className="w-full bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all shadow-lg shadow-purple-900/20 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {isBusy ? <RefreshCw className="animate-spin w-5 h-5" /> : <ArrowRightLeft className="w-5 h-5" />}
                  {needsApproval && !signedPermit
                    ? "Sign & Swap Debt"
                    : "Swap Debt"}
                </button>

                {userRejected && (
                  <div className="flex items-start gap-2 text-xs text-blue-400/80 bg-blue-900/10 p-3 rounded-lg border border-blue-900/30">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>You cancelled the transaction. Click the button above to try again when ready.</p>
                  </div>
                )}
              </div>
            )}

            {needsApproval && !signedPermit && (
              <div className="flex items-start gap-2 text-xs text-blue-400/80 bg-blue-900/10 p-3 rounded-lg">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Approval will be requested via signature (gasless) before the transaction.</p>
              </div>
            )}
          </div>
        </div>

        {/* CONSOLE LOGS */}
        <div className="bg-black rounded-xl border border-slate-800 overflow-hidden font-mono text-xs shadow-2xl">
          <div className="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-3 h-3 text-slate-500" />
                <span className="text-slate-500 font-semibold">Log Terminal</span>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={simulateError}
                  onChange={(e) => setSimulateError(e.target.checked)}
                  className="w-3 h-3 rounded border-slate-700 bg-slate-800 text-purple-600 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-[10px] text-slate-500 group-hover:text-red-400 transition-colors">
                  Simulate Error
                </span>
              </label>
            </div>
            <button
              onClick={() => {
                const logText = logs.map(log => `[${log.time}] ${log.msg}`).join('\n');
                navigator.clipboard.writeText(logText);
                setCopyButtonState('copied');
                setTimeout(() => setCopyButtonState('idle'), 2000);
              }}
              className={`text-xs px-2 py-1 rounded transition-colors ${copyButtonState === 'copied'
                ? 'bg-green-600 text-green-100'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
              title="Copy all logs"
              disabled={copyButtonState === 'copied'}
            >
              {copyButtonState === 'copied' ? '✓ Copied!' : 'Copy Logs'}
            </button>
          </div>
          <div className="p-4 h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
            {logs.length === 0 && <span className="text-slate-700 italic">Waiting for operations...</span>}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-3 ${log.type === 'error' ? 'text-red-400' :
                log.type === 'success' ? 'text-green-400' :
                  log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'
                }`}>
                <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                <span>{log.msg}</span>
              </div>
            ))}
            <div className="h-2"></div> {/* Final spacer */}
          </div>
        </div>

      </div>
    </div>
  );
}