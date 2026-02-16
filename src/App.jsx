import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Wallet, LogOut, Terminal } from 'lucide-react';
import { useWeb3 } from './context/web3Context.js';

// Lazy load Dashboard
const Dashboard = lazy(() => import('./components/Dashboard.jsx').then(module => ({ default: module.Dashboard })));

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

export default function App() {
  const {
    account,
    connectWallet,
    disconnectWallet,
  } = useWeb3();

  // --- STATES ---
  const [logs, setLogs] = useState([]);
  const [copyButtonState, setCopyButtonState] = useState('idle');

  // --- LOG HELPER ---
  const addLog = useCallback((msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, msg, type }, ...prev]);
  }, []);

  const handleCopyLogs = () => {
    const logText = logs.map(l => `[${l.time}] ${l.msg}`).join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      setCopyButtonState('copied');
      setTimeout(() => setCopyButtonState('idle'), 2000);
    });
  };

  const handleConnect = async () => {
    try {
      await connectWallet();
      addLog("Wallet connected successfully", "success");
    } catch (err) {
      addLog("Connection failed: " + err.message, "error");
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 selection:bg-purple-500/30">
      <div className="max-w-4xl mx-auto px-4 py-12">

        {/* HEADER */}
        <header className="flex flex-wrap items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-2">
            <div className="p-3 rounded-2xl">
              <LilLogo className="w-12 h-12 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-black text-white tracking-tight">
                  LilSwap
                </h1>
                <span className="px-1 py-0 rounded text-purple-400 text-[8px] font-bold border-2 border-purple-500/30">BETA</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">AAVE V3 Position Manager</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {!account ? (
              <button
                onClick={handleConnect}
                className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-purple-900/20 active:scale-95"
              >
                <Wallet className="w-4 h-4" />
                Connect
              </button>
            ) : (
              <button
                onClick={disconnectWallet}
                className="flex items-center gap-2 text-slate-500 hover:text-red-400 transition-colors group"
              >
                <span className="text-xs font-mono">{account.slice(0, 6)}...{account.slice(-4)}</span>
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* MAIN CONTENT */}
        {!account ? (
          <div className="bg-slate-900/50 rounded-3xl p-16 border border-white/5 text-center backdrop-blur-sm">
            <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-8 border border-white/10 shadow-2xl">
              <Wallet className="w-10 h-10 text-slate-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Connect Wallet to Begin</h2>
            <p className="text-slate-400 max-w-sm mx-auto mb-10 text-sm leading-relaxed">
              Manage your Aave V3 positions and swap between debt assets with optimal efficiency.
            </p>
            <button
              onClick={handleConnect}
              className="px-10 py-4 bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-xl shadow-purple-900/40 hover:scale-105"
            >
              Get Started
            </button>
          </div>
        ) : (
          <Suspense fallback={<div>Loading...</div>}>
            <Dashboard />
          </Suspense>
        )}

        {/* LOG TERMINAL */}
        <div className="mt-12 bg-black/50 rounded-2xl border border-white/5 overflow-hidden font-mono text-[10px] backdrop-blur-sm">
          <div className="bg-white/5 px-4 py-2 border-b border-white/5 flex justify-between items-center">
            <div className="flex items-center gap-2 text-slate-500">
              <Terminal className="w-3 h-3" />
              <span className="font-bold uppercase tracking-widest">System Logs</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCopyLogs}
                className="text-slate-600 hover:text-slate-400 transition-colors uppercase font-bold"
              >
                {copyButtonState === 'copied' ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => setLogs([])}
                className="text-slate-600 hover:text-slate-400 transition-colors uppercase font-bold"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="p-4 h-32 overflow-y-auto space-y-1 custom-scrollbar">
            {logs.length === 0 && <div className="text-slate-700 italic">No activity logs...</div>}
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-600 shrink-0">[{log.time}]</span>
                <span className={
                  log.type === 'error' ? 'text-red-400' :
                    log.type === 'success' ? 'text-green-400' :
                      log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'
                }>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
