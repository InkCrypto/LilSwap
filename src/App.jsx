import React, { useState, useCallback, lazy, Suspense, useRef, useEffect } from 'react';
import { Wallet, LogOut, ChevronDown, Eye, EyeOff, Terminal, Moon, Sun } from 'lucide-react';
import { useWeb3 } from './context/web3Context.js';
import { getLogLevel } from './utils/logger.js';
import { InfoTooltip } from './components/InfoTooltip.jsx';
import { useToast } from './context/ToastContext.jsx';
import { ApiMetaProvider } from './context/ApiMetaContext.jsx';
import AppFooter from './components/AppFooter.jsx';

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
  const { addToast } = useToast();

  // --- THEME STATE (Dark by default, persisted) ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('lilswap_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('lilswap_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('lilswap_theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  // --- STATES ---
  const [logs, setLogs] = useState([]);
  const [copyButtonState, setCopyButtonState] = useState('idle');
  const [showAddress, setShowAddress] = useState(() => {
    const saved = localStorage.getItem('lilswap_show_address');
    return saved === 'true';
  });
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      if (typeof window === 'undefined' || !window.ethereum) {
        addLog("No wallet detected! Please install MetaMask.", "error");
        return;
      }
      await connectWallet();
      addLog("Wallet connected successfully", "success");
    } catch (err) {
      addLog("Connection failed: " + err.message, "error");
    }
  };

  const handleDisconnect = () => {
    try {
      disconnectWallet();
      setShowAccountMenu(false);
      addLog("Wallet disconnected", "info");
    } catch (err) {
      addLog("Disconnect failed: " + err.message, "error");
    }
  };

  return (
    <ApiMetaProvider>
      <div className="min-h-screen bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-100 selection:bg-primary/30">

        {/* HEADER */}
        <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-12 pb-6 sm:pb-8 flex items-center justify-between gap-3">

          {/* Logo */}
          <div className="flex items-center gap-2.5 min-w-0">
            <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2 leading-none">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  LilSwap
                </h1>
                <span className="px-1 py-0 rounded text-primary text-[8px] font-bold border-2 border-primary/30 mt-0.5">BETA</span>
              </div>
              <div className="hidden sm:flex items-center gap-2 mt-1 leading-none">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] sm:tracking-[0.2em]">AAVE V3 Position Manager</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">

            {/* Theme Toggle */}
            <button
              onClick={toggleDarkMode}
              className="p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-border-light dark:border-border-dark text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {!account ? (
              <button
                onClick={handleConnect}
                className="bg-primary hover:bg-primary-hover text-white text-xs sm:text-sm font-bold px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-primary/20 active:scale-95"
              >
                <Wallet className="w-4 h-4" />
                <span className="hidden sm:inline">Connect</span>
              </button>
            ) : (
              <div className="relative" ref={menuRef}>
                <div className="flex items-center gap-2">
                  <InfoTooltip message="Protect your privacy by hiding your address from prying eyes">
                    <button
                      onClick={() => setShowAddress(prev => {
                        const newValue = !prev;
                        localStorage.setItem('lilswap_show_address', newValue.toString());
                        return newValue;
                      })}
                      className="hidden sm:flex p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-border-light dark:border-border-dark text-slate-400 hover:text-primary dark:hover:text-primary transition-all active:scale-90"
                    >
                      {showAddress ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </InfoTooltip>

                  <button
                    onClick={() => setShowAccountMenu(!showAccountMenu)}
                    className="bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 transition-all border border-border-light dark:border-border-dark active:scale-95"
                  >
                    <Wallet className="w-4 h-4 text-primary shrink-0" />
                    <span className={`hidden sm:inline font-mono transition-all duration-300 ${!showAddress ? 'blur-xs select-none opacity-90' : ''}`}>
                      {account.slice(0, 6)}...{account.slice(-4)}
                    </span>
                    <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                  </button>
                </div>

                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-card-dark rounded-xl shadow-xl border border-border-light dark:border-border-dark overflow-hidden z-50">
                    <button
                      onClick={handleDisconnect}
                      className="w-full px-4 py-3 text-left text-sm text-red-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center gap-2 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* MAIN CONTENT */}
        <main>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-12">

            {/* WALLETLESS STATE */}
            {!account ? (
              <div className="mt-16 bg-white dark:bg-card-dark rounded-3xl p-12 sm:p-16 border border-border-light dark:border-border-dark text-center shadow-xl">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-primary/20">
                  <Wallet className="w-9 h-9 text-primary" />
                </div>
                <h2 className="text-2xl font-bold font-display text-slate-900 dark:text-white mb-4">Connect Wallet to Begin</h2>
                <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-10 text-sm leading-relaxed">
                  Manage your Aave V3 positions and swap between debt assets with optimal efficiency.
                </p>
                <button
                  onClick={handleConnect}
                  className="px-10 py-3.5 bg-primary hover:bg-primary-hover text-white rounded-2xl font-bold text-sm transition-all shadow-xl shadow-primary/30 hover:scale-105 active:scale-95"
                >
                  Get Started
                </button>
              </div>
            ) : (
              <Suspense fallback={
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              }>
                <Dashboard />
              </Suspense>
            )}

            {/* LOG TERMINAL (only visible in debug mode) */}
            {getLogLevel() === 'debug' && (
              <div className="mt-12 bg-slate-900 rounded-2xl border border-border-dark overflow-hidden font-mono text-[10px]">
                <div className="bg-slate-800 px-4 py-2 border-b border-border-dark flex justify-between items-center">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Terminal className="w-3 h-3" />
                    <span className="font-bold uppercase tracking-widest">System Logs</span>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleCopyLogs} className="text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold">
                      {copyButtonState === 'copied' ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={() => setLogs([])} className="text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold">
                      Clear
                    </button>
                  </div>
                </div>
                <div className="p-4 h-32 overflow-y-auto space-y-1">
                  {logs.length === 0 && <div className="text-slate-600 italic">No activity logs...</div>}
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
            )}

          </div>
        </main>

        <AppFooter />

      </div>
    </ApiMetaProvider>
  );
}
