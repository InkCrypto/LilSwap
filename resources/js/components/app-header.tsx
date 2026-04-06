import { Wallet, LogOut, ChevronDown, Eye, EyeOff, Lightbulb, History } from 'lucide-react';
import { useConnectModal, ConnectButton } from '@rainbow-me/rainbowkit';
import { useDisconnect } from 'wagmi';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { InfoTooltip } from '@/components/info-tooltip';
import { useAppearance } from '@/hooks/use-appearance';
import LilLogo from '@/components/lil-logo';
import { Button } from '@/components/ui/button';
import React from 'react';

type AppHeaderProps = {
    account?: string | null;
    activeCount?: number;
    onOpenHistory?: () => void;
};

export function AppHeader({
    account,
    activeCount = 0,
    onOpenHistory = () => {},
}: AppHeaderProps) {
    const { connectModalOpen } = useConnectModal();
    const { disconnect } = useDisconnect();
    const { resolvedAppearance, updateAppearance } = useAppearance();
    const isDarkMode = resolvedAppearance === 'dark';
    const toggleDarkMode = () => updateAppearance(isDarkMode ? 'light' : 'dark');
    const [showAddress, setShowAddress] = React.useState(() => {
        const saved = typeof localStorage !== 'undefined'
            ? localStorage.getItem('lilswap_show_address')
            : 'false';

        return saved === 'true';
    });
    const [isScrolled, setIsScrolled] = React.useState(false);

    React.useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 0);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <header
            className={`sticky top-0 z-50 transition-all duration-300 ${
                isScrolled
                    ? 'bg-background border-b-2 border-border-light/70 dark:border-border-dark/70'
                    : 'bg-background border-b border-transparent'
            }`}
        >
            <div className="max-w-480 mx-auto px-4 md:px-6 pt-6 md:pt-4 pb-6 md:pb-4 flex items-center justify-between gap-3 md:gap-2">
                <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                    <LilLogo className="w-10 h-10 md:w-12 md:h-12 shrink-0" />
                    <div className="min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-1.5 sm:gap-2 leading-none">
                            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight text-nowrap">
                                LilSwap
                            </h1>
                            <span className="px-1 py-0 rounded text-primary text-[8px] font-bold border-2 border-primary/30 mt-0.5 shrink-0">
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
                            className="flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer group rounded-full"
                            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        >
                            <Lightbulb
                                className={`w-5 h-5 transition-all duration-300 ${
                                    isDarkMode ? '' : 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]'
                                }`}
                            />
                        </button>
                    </InfoTooltip>

                    {account && (
                        <InfoTooltip message="Activity history" disableClick={true}>
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
                        </InfoTooltip>
                    )}

                    <ConnectButton.Custom>
                        {({
                            account: rainbowAccount,
                            chain,
                            openConnectModal,
                            authenticationStatus,
                            mounted,
                        }) => {
                            const ready = mounted && authenticationStatus !== 'loading';
                            const connected = ready && rainbowAccount && chain;
                            const isConnecting = !ready || connectModalOpen;

                            return (
                                <div
                                    {...(!ready && {
                                        'aria-hidden': true,
                                        style: {
                                            opacity: 0,
                                            pointerEvents: 'none',
                                            userSelect: 'none',
                                        },
                                    })}
                                >
                                    {connected ? (
                                        <div className="flex items-center gap-2">
                                            <InfoTooltip message="Protect your privacy by hiding your address" disableClick={true}>
                                                <button
                                                    onClick={() =>
                                                        setShowAddress((currentState) => {
                                                            const nextState = !currentState;
                                                            localStorage.setItem('lilswap_show_address', nextState.toString());
                                                            return nextState;
                                                        })
                                                    }
                                                    className="hidden sm:flex items-center justify-center size-7 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer rounded-full"
                                                >
                                                    {showAddress ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                                                </button>
                                            </InfoTooltip>

                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button className="bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 transition-all border border-border-light dark:border-border-dark active:scale-95 shadow-sm">
                                                        <Wallet className="w-4 h-4 text-primary shrink-0" />
                                                        <span className={`hidden sm:inline font-mono transition-all duration-300 ${showAddress ? '' : 'blur-xs select-none opacity-60'}`}>
                                                            {rainbowAccount.address.slice(0, 6)}...{rainbowAccount.address.slice(-4)}
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
                                                        onClick={() => disconnect()}
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
                                            onClick={openConnectModal}
                                            disabled={isConnecting}
                                            className="text-xs md:text-sm px-4 md:px-5 py-2 md:py-2.5 rounded-xl h-auto"
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
                                    )}
                                </div>
                            );
                        }}
                    </ConnectButton.Custom>
                </div>
            </div>
        </header>
    );
}
