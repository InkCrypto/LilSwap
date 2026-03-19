import { Head } from '@inertiajs/react';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Wallet, LogOut, ChevronDown, Eye, EyeOff, Lightbulb } from 'lucide-react';
import { useWeb3 } from '@/contexts/web3-context';
import { useAppearance } from '@/hooks/use-appearance';
import { InfoTooltip } from '../components/info-tooltip';
import AppFooter from '../components/app-footer';
import LilLogo from '../components/lil-logo';

import { Button } from '../components/ui/button';
const Dashboard = lazy(() => import('../components/dashboard'));

export default function Welcome() {
    const {
        account,
        connectWallet,
        disconnectWallet,
        isConnecting,
    } = useWeb3();

    const { resolvedAppearance, updateAppearance } = useAppearance();
    const isDarkMode = resolvedAppearance === 'dark';
    const toggleDarkMode = () => updateAppearance(isDarkMode ? 'light' : 'dark');

    const [showAddress, setShowAddress] = useState(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('lilswap_show_address') : 'false';
        return saved === 'true';
    });
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowAccountMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
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

    return (
        <>
            <Head title="LilSwap - Aave V3 Position Manager" />
            <div className="min-h-screen bg-background text-slate-800 dark:text-slate-100 selection:bg-primary/30">
                <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-12 pb-6 sm:pb-8 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
                        <div className="min-w-0 flex flex-col justify-center">
                            <div className="flex items-center gap-2 leading-none">
                                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight text-nowrap">
                                    LilSwap
                                </h1>
                                <span className="px-1 py-0 rounded text-primary text-[8px] font-bold border-2 border-primary/30 mt-0.5">BETA</span>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 mt-1 leading-none text-nowrap">
                                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] sm:tracking-[0.2em]">AAVE V3 Position Manager</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <button
                            onClick={toggleDarkMode}
                            className="flex items-center gap-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer group"
                            aria-label="Toggle dark mode"
                        >
                            <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                {isDarkMode ? 'Turn lights on' : 'Turn lights off'}
                            </span>
                            <Lightbulb className={`w-5 h-5 transition-all duration-300 ${isDarkMode
                                ? 'text-slate-500 dark:text-slate-500 group-hover:text-slate-400'
                                : 'text-yellow-400 group-hover:text-yellow-500 drop-shadow-[0_0_6px_rgba(250,204,21,0.7)]'
                                }`} />
                        </button>

                        {!account ? (
                            <Button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className="text-xs sm:text-sm px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl h-auto"
                            >
                                {isConnecting ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Wallet className="w-4 h-4" />
                                )}
                                <span className="hidden sm:inline">
                                    {isConnecting ? 'Connecting...' : 'Connect'}
                                </span>
                            </Button>
                        ) : (
                            <div className="relative" ref={menuRef}>
                                <div className="flex items-center gap-2">
                                    <InfoTooltip message="Protect your privacy by hiding your address">
                                        <button
                                            onClick={() => setShowAddress(prev => {
                                                const newValue = !prev;
                                                localStorage.setItem('lilswap_show_address', newValue.toString());
                                                return newValue;
                                            })}
                                            className="hidden sm:flex p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer"
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
                        <div className="mt-16 bg-white dark:bg-slate-900 rounded-3xl p-12 sm:p-16 border border-slate-200 dark:border-slate-800 text-center shadow-xl">
                            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-primary/20">
                                <Wallet className="w-9 h-9 text-primary" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Connect Wallet to Begin</h2>
                            <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-10 text-sm leading-relaxed">
                                Maximize your Aave V3 potential. Optimize your positions by swapping collateral or debt assets with seamless routing and maximum efficiency.
                            </p>
                            <Button
                                onClick={handleConnect}
                                disabled={isConnecting}
                                className="px-10 py-3.5 rounded-2xl h-auto"
                            >
                                {isConnecting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span>Connecting...</span>
                                    </>
                                ) : (
                                    'Get Started'
                                )}
                            </Button>
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

                <AppFooter />
            </div>
        </>
    );
}
