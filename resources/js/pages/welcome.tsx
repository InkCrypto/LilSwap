
import { Wallet, LogOut, ChevronDown, Eye, EyeOff, Lightbulb, Clock } from 'lucide-react';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import { TransactionHistorySheet } from '@/components/transaction-history-sheet';
import { useWeb3 } from '@/contexts/web3-context';
import { useAppearance } from '@/hooks/use-appearance';
import AppFooter from '../components/app-footer';
import { InfoTooltip } from '../components/info-tooltip';
import LilLogo from '../components/lil-logo';
import { Button } from '../components/ui/button';

const Dashboard = lazy(() => import('../components/dashboard'));

export default function Welcome() {
    const { account, connectWallet, disconnectWallet, isConnecting } = useWeb3();
    const { activeCount, setSheetOpen } = useTransactionTracker();

    const { resolvedAppearance, updateAppearance } = useAppearance();
    const isDarkMode = resolvedAppearance === 'dark';
    const toggleDarkMode = () => updateAppearance(isDarkMode ? 'light' : 'dark');

    const [showAddress, setShowAddress] = useState(() => {
        const saved = typeof localStorage !== 'undefined'
            ? localStorage.getItem('lilswap_show_address')
            : 'false';

        return saved === 'true';
    });

    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Dual-span simultaneous airport flip animation
    const [flipState, setFlipState] = useState<{ current: string; prev: string | null; key: number }>({
        current: 'Little', prev: null, key: 0,
    });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowAccountMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Every 3.5s: swap words. CSS keyframes handle the simultaneous animations.
    useEffect(() => {
        const interval = setInterval(() => {
            setFlipState(fs => ({
                prev: fs.current,
                current: fs.current === 'Little' ? "Lil'" : 'Little',
                key: fs.key + 1,
            }));
            // Clear the outgoing span after animation finishes
            setTimeout(() => setFlipState(fs => ({ ...fs, prev: null })), 380);
        }, 3500);

        return () => clearInterval(interval);
    }, []);

    const handleConnect = async () => {
        try {
            await connectWallet();
        } catch (err) {
            console.error("Connection failed:", err);
        }
    };

    const handleDisconnect = () => {
        try {
            disconnectWallet();
            setShowAccountMenu(false);
        } catch (err) {
            console.error("Disconnect failed:", err);
        }
    };

    const spanBase: React.CSSProperties = {
        position: 'absolute', left: 0, right: 0, textAlign: 'center',
    };

    // Both exit and enter play simultaneously via CSS @keyframes
    const flipPhrase = (
        <span style={{ position: 'relative', display: 'inline-block', clipPath: 'inset(0 -6px)', verticalAlign: 'bottom', padding: '0 4px' }}>
            <span aria-hidden style={{ visibility: 'hidden' }}>
                <span className="text-primary italic">Little</span> fees & <span className="text-primary italic">Little</span> effort!
            </span>
            {flipState.prev !== null && (
                <span key={`out-${flipState.key}`} style={{ ...spanBase, animation: 'word-exit 340ms ease forwards' }}>
                    <span className="text-primary italic">{flipState.prev}</span> fees & <span className="text-primary italic">{flipState.prev}</span> effort!
                </span>
            )}
            <span key={`in-${flipState.key}`} style={{
                ...spanBase,
                animation: flipState.prev !== null ? 'word-enter 340ms ease forwards' : 'none',
            }}>
                <span className="text-primary italic">{flipState.current}</span> fees & <span className="text-primary italic">{flipState.current}</span> effort!
            </span>
        </span>
    );



    return (
        <div className="min-h-screen bg-background text-slate-800 dark:text-slate-100 selection:bg-primary/30 font-sans">
            <style>{`
                @keyframes word-exit {
                    from { transform: translateY(0);    opacity: 1; }
                    to   { transform: translateY(-130%); opacity: 0; }
                }
                @keyframes word-enter {
                    from { transform: translateY(130%); opacity: 0; }
                    to   { transform: translateY(0);    opacity: 1; }
                }
            `}</style>

            <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-12 pb-6 sm:pb-8 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
                    <div className="min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-2 leading-none">
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight text-nowrap">
                                LilSwap
                            </h1>
                            <span className="px-1 py-0 rounded text-primary text-[8px] font-bold border-2 border-primary/30 mt-0.5">
                                BETA
                            </span>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 mt-1 leading-none text-nowrap">
                            <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] sm:tracking-[0.2em]">
                                AAVE V3 Position Manager
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <InfoTooltip message={isDarkMode ? 'Turn lights on' : 'Turn lights off'} disableClick={true}>
                        <button
                            onClick={toggleDarkMode}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer flex items-center group"
                            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            <Lightbulb className={`w-5 h-5 transition-all duration-300 ${!isDarkMode
                                ? 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]'
                                : ''
                                }`} />
                        </button>
                    </InfoTooltip>

                    {account && (
                        <InfoTooltip message="Activity history" disableClick={true}>
                            <button
                                onClick={() => setSheetOpen(true)}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer flex items-center group relative"
                                aria-label="Activity"
                            >
                                <Clock className="w-5 h-5 transition-all duration-300" />
                                {activeCount > 0 && (
                                    <span className="absolute top-0 right-0 flex size-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                                    </span>
                                )}
                            </button>
                        </InfoTooltip>
                    )}

                    {!account ? (
                        <Button
                            onClick={handleConnect}
                            disabled={isConnecting}
                            className="text-xs sm:text-sm px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl h-auto"
                        >
                            {isConnecting
                                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <Wallet className="w-4 h-4" />}
                            <span className="hidden sm:inline">
                                {isConnecting ? 'Connecting...' : 'Connect'}
                            </span>
                        </Button>
                    ) : (
                        <div className="relative" ref={menuRef}>
                            <div className="flex items-center gap-2">
                                <InfoTooltip message="Protect your privacy by hiding your address" disableClick={true}>
                                    <button
                                        onClick={() => setShowAddress(prev => {
                                            const newValue = !prev;

                                            localStorage.setItem('lilswap_show_address', newValue.toString());

                                            return newValue;
                                        })}
                                        className="hidden sm:flex p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer"
                                    >
                                        {showAddress ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                                    </button>
                                </InfoTooltip>

                                <button
                                    onClick={() => setShowAccountMenu(!showAccountMenu)}
                                    className="bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 transition-all border border-border-light dark:border-border-dark active:scale-95 shadow-sm"
                                >
                                    <Wallet className="w-4 h-4 text-primary shrink-0" />
                                    <span className={`hidden sm:inline font-mono transition-all duration-300 ${!showAddress ? 'blur-xs select-none opacity-90' : ''}`}>
                                        {account.slice(0, 6)}...{account.slice(-4)}
                                    </span>
                                    <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                                </button>
                            </div>

                            {showAccountMenu && (
                                <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-card-dark rounded-xl shadow-xl border border-border-light dark:border-border-dark overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
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

            <main className="max-w-4xl mx-auto px-4 sm:px-6 pb-12">
                {!account ? (
                    <div className="mt-12 sm:mt-16 bg-white dark:bg-slate-900 rounded-3xl pt-14 pb-10 px-10 sm:pt-16 sm:pb-12 sm:px-12 border border-slate-200 dark:border-slate-800 text-center shadow-xl max-w-lg mx-auto overflow-hidden">

                        <div className="mb-8 flex flex-col items-center">
                            <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 mb-6" />

                            <p className="text-slate-700 dark:text-slate-100 text-lg sm:text-2xl font-bold leading-tight mb-8">
                                Swap Aave v3 positions with <br />
                                {flipPhrase}
                            </p>

                            <Button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className="text-xs sm:text-sm px-8 py-2 sm:px-10 sm:py-2.5 rounded-xl h-auto flex items-center justify-center gap-2.5"
                            >
                                {isConnecting ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Wallet className="w-4 h-4" />
                                )}
                                <span>{isConnecting ? 'Connecting...' : 'Connect to start'}</span>
                            </Button>
                        </div>

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
            </main>

            <TransactionHistorySheet />
            <AppFooter />
        </div>
    );
}