import { Wallet, LogOut, ChevronDown, History, Eye, EyeOff, Landmark, ArrowRightLeft } from 'lucide-react';
import React from 'react';
import { Link } from '@inertiajs/react';
import { InfoTooltip } from '@/components/info-tooltip';
import AppLogo from '@/components/app-logo';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useWeb3 } from '@/contexts/web3-context';
import { useAppearance } from '@/hooks/use-appearance';
import { useUiPreferences } from '@/hooks/use-ui-preferences';

type AppHeaderProps = {
    account?: string | null;
    activeCount?: number;
    onOpenHistory?: () => void;
};

export function AppHeader({
    account,
    activeCount = 0,
    onOpenHistory = () => { },
}: AppHeaderProps) {
    const { connectWallet, disconnectWallet, isConnecting, isReconnecting, isConnectModalOpen } = useWeb3();
    const isConnectBusy = isReconnecting || (isConnecting && isConnectModalOpen);
    const { resolvedAppearance, updateAppearance } = useAppearance();
    const { preferences, updatePreference } = useUiPreferences();
    const isDarkMode = resolvedAppearance === 'dark';
    const toggleDarkMode = () => updateAppearance(isDarkMode ? 'light' : 'dark');
    const [isScrolled, setIsScrolled] = React.useState(false);
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    const isSwapActive = currentPath === '/spot';
    const isHomeActive = currentPath === '/';
    const isAaveActive = currentPath === '/aave';

    React.useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 0);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const logoContentMobile = (
        <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <PopoverTrigger asChild>
                <button
                    className="flex items-center gap-1.5 text-slate-900 dark:text-white select-none active:scale-[0.98] transition-all hover:opacity-85"
                >
                    <AppLogo size="sm" />
                    <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-300 ${isMenuOpen ? 'rotate-180 text-primary dark:text-purple-400' : ''}`}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-40 p-1 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 backdrop-blur-md shadow-xl rounded-xl"
            >
                <div className="flex flex-col gap-0.5 font-sans">
                    <Link
                        href="/"
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${isHomeActive || isAaveActive
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                    >
                        <Landmark className="w-4 h-4 shrink-0" strokeWidth={2.2} />
                        <span>Aave v3</span>
                    </Link>

                    <Link
                        href="/spot"
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${isSwapActive
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                    >
                        <ArrowRightLeft className="w-4 h-4 shrink-0" strokeWidth={2.2} />
                        <span>Swap</span>
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );

    return (
        <header
            className={`sticky top-0 z-40 transition-all duration-300 ${isScrolled
                ? 'bg-background border-b-2 border-border-light/70 dark:border-border-dark/70'
                : 'bg-background border-b border-transparent'
                }`}
        >
            <div className="max-w-480 mx-auto px-4 md:px-6 pt-6 md:pt-4 pb-6 md:pb-4 flex items-center justify-between gap-3 md:gap-2">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                    {/* Mobile Logo Menu or Static Logo */}
                    <div className="block sm:hidden">
                        {account ? (
                            logoContentMobile
                        ) : (
                            isHomeActive ? (
                                <AppLogo size="sm" className="pr-3" />
                            ) : (
                                <AppLogo size="sm" href="/" className="pr-3" />
                            )
                        )}
                    </div>

                    {/* Desktop Logo */}
                    <div className="hidden sm:flex items-center gap-3 sm:gap-4 min-w-0">
                        <AppLogo size="lg" showBeta href={isHomeActive ? undefined : '/'} />

                        {account && (
                            <nav className="hidden sm:flex items-center gap-8 ml-8">
                                <Link
                                    href="/"
                                    className={`relative text-xl font-medium transition-colors ${isHomeActive
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                                        }`}
                                >
                                    Aave
                                    {isHomeActive && (
                                        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-600 dark:bg-purple-400" />
                                    )}
                                </Link>
                                <Link
                                    href="/spot"
                                    className={`relative text-xl font-medium transition-colors ${isSwapActive
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                                        }`}
                                >
                                    Swap
                                    {isSwapActive && (
                                        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-600 dark:bg-purple-400" />
                                    )}
                                </Link>
                            </nav>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <InfoTooltip message={isDarkMode ? 'Turn lights on' : 'Turn lights off'} disableClick={true}>
                        <button
                            onClick={toggleDarkMode}
                            className="flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer group rounded-full"
                            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            <span
                                className={`material-symbols-outlined text-[20px] leading-none transition-all duration-300 ${isDarkMode
                                    ? 'text-current'
                                    : 'text-yellow-400 group-hover:text-yellow-500 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]'
                                    }`}
                                style={{ fontVariationSettings: isDarkMode ? "'FILL' 0, 'wght' 300, 'GRAD' 0" : "'FILL' 1, 'wght' 300, 'GRAD' 200" }}
                            >
                                lightbulb
                            </span>
                        </button>
                    </InfoTooltip>

                    {/* TODO: Add a notification badge showing the count of PENDING transactions (on-chain unconfirmed).
                       This should replace the current activeCount ping dot with a proper count badge
                       to give users clear feedback that the app is actively tracking their swaps. */}
                    {account && (
                        <button
                            onClick={onOpenHistory}
                            className="flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer group relative rounded-full"
                            aria-label="Activity"
                        >
                            <History className="w-5 h-5 transition-all duration-300" />
                            {activeCount > 0 && (
                                <span className="absolute top-0 right-0 flex size-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                                </span>
                            )}
                        </button>
                    )}

                    {account ? (
                        <div className="flex items-center gap-2">
                            <InfoTooltip message="Protect your privacy by hiding your address" disableClick={true}>
                                <button
                                    onClick={() => updatePreference('showAddress', !preferences.showAddress)}
                                    className="hidden sm:flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer rounded-full"
                                    aria-label={preferences.showAddress ? 'Hide wallet address' : 'Show wallet address'}
                                >
                                    {preferences.showAddress ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                                </button>
                            </InfoTooltip>

                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 transition-all border border-border-light dark:border-border-dark active:scale-95 shadow-sm">
                                        <Wallet className="w-4 h-4 text-primary shrink-0" />
                                        <span className={`hidden sm:inline font-mono transition-all duration-300 ${preferences.showAddress ? '' : 'blur-xs select-none opacity-60'}`}>
                                            {`${account.slice(0, 6)}...${account.slice(-4)}`}
                                        </span>
                                        <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent
                                    align="end"
                                    sideOffset={6}
                                    className="w-36 sm:w-(--radix-popover-trigger-width) p-0 bg-white dark:bg-slate-900 border-border-light dark:border-border-dark shadow-xl rounded-xl overflow-hidden"
                                >
                                    <button
                                        onClick={() => {
                                            void disconnectWallet();
                                        }}
                                        className="w-full h-10 flex items-center justify-center gap-2.5 px-3 text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors group"
                                    >
                                        <LogOut className="w-4 h-4 transition-transform group-hover:scale-110" />
                                        Disconnect
                                    </button>
                                </PopoverContent>
                            </Popover>
                        </div>
                    ) : (
                        <Button
                            onClick={connectWallet}
                            disabled={isConnectBusy}
                            className="text-xs md:text-sm px-4 md:px-5 py-2 md:py-2.5 rounded-xl h-auto"
                        >
                            {isConnectBusy ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Wallet className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">
                                {isConnectBusy ? 'Connecting...' : 'Connect'}
                            </span>
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
}
