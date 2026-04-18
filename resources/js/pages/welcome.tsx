import { Heart, Wallet } from 'lucide-react';
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AppHeader } from '@/components/app-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { AaveHistorySheet } from '@/components/aave-history-sheet';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import { useWeb3 } from '@/contexts/web3-context';
import { usePositions } from '@/hooks/use-positions';
import AppFooter from '../components/app-footer';
import { DonateModal } from '../components/donate-modal';
import { VerifyDonationModal } from '../components/verify-donation-modal';
import LilLogo from '../components/lil-logo';
import { Button } from '../components/ui/button';

const Dashboard = lazy(() => import('../components/dashboard'));

export default function Welcome() {
    const { account, connectWallet, isConnecting, isReconnecting, isConnectModalOpen } = useWeb3();
    const { activeCount, setSheetOpen } = useTransactionTracker();
    const { positionsByChain, donator, loading, error, lastFetch, refresh } = usePositions(account);
    const [isDonateOpen, setIsDonateOpen] = useState(false);
    const [isVerifyOpen, setIsVerifyOpen] = useState(false);
    const [flipState, setFlipState] = useState<{ current: string; prev: string | null; key: number }>({
        current: 'Little', prev: null, key: 0,
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setFlipState((currentState) => ({
                prev: currentState.current,
                current: currentState.current === 'Little' ? "Lil'" : 'Little',
                key: currentState.key + 1,
            }));

            setTimeout(() => {
                setFlipState((currentState) => ({ ...currentState, prev: null }));
            }, 380);
        }, 3500);

        return () => clearInterval(interval);
    }, []);

    const spanBase: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        right: 0,
        textAlign: 'center',
    };

    const flipPhrase = (
        <span
            style={{
                position: 'relative',
                display: 'inline-block',
                clipPath: 'inset(0 -6px)',
                verticalAlign: 'bottom',
                padding: '0 4px',
            }}
        >
            <span aria-hidden style={{ visibility: 'hidden' }}>
                <span className="text-primary italic">Little</span> fees & <span className="text-primary italic">Little</span> effort!
            </span>
            {flipState.prev !== null && (
                <span key={`out-${flipState.key}`} style={{ ...spanBase, animation: 'word-exit 340ms ease forwards' }}>
                    <span className="text-primary italic">{flipState.prev}</span> fees & <span className="text-primary italic">{flipState.prev}</span> effort!
                </span>
            )}
            <span
                key={`in-${flipState.key}`}
                style={{
                    ...spanBase,
                    animation: flipState.prev !== null ? 'word-enter 340ms ease forwards' : 'none',
                }}
            >
                <span className="text-primary italic">{flipState.current}</span> fees & <span className="text-primary italic">{flipState.current}</span> effort!
            </span>
        </span>
    );

    const donatorTagSuffix = donator.type?.toLowerCase().includes('partner') ? 'Partner' : 'Donator';
    const appTagLabel = donator.isDonator ? `Lil'${donatorTagSuffix}` : 'Get 10% Fee Discount';
    const desktopTagClassName = 'pointer-events-auto inline-flex h-6 items-center rounded-md border border-primary/35 bg-white px-2.5 text-[9px] font-black uppercase tracking-[0.16em] text-primary shadow-[0_0_10px_rgba(168,85,247,0.12)] dark:border-cyan-400/35 dark:bg-cyan-500/14 dark:text-cyan-300 dark:shadow-[0_0_12px_rgba(34,211,238,0.16)]';
    const mobileTagClassName = 'pointer-events-auto inline-flex h-5 items-center rounded-md border border-primary/35 bg-white px-2 text-[8px] font-black uppercase tracking-[0.16em] text-primary shadow-[0_0_10px_rgba(168,85,247,0.12)] dark:border-cyan-400/35 dark:bg-cyan-500/14 dark:text-cyan-300 dark:shadow-[0_0_12px_rgba(34,211,238,0.16)]';
    const showDonatorTag = positionsByChain !== null;

    return (
        <div className="flex flex-col min-h-screen bg-background text-slate-800 dark:text-slate-100 selection:bg-primary/30 font-sans">
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

            <AppHeader
                account={account}
                activeCount={activeCount}
                onOpenHistory={() => setSheetOpen(true)}
            />

            <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 pb-24 w-full pt-2 md:pt-12">
                {account ? (
                    <div className="relative">
                        {showDonatorTag && (
                            <>
                                <div className="pointer-events-none absolute left-1/2 top-0 z-45 -translate-x-1/2 -translate-y-[92%] sm:hidden">
                                    {donator.isDonator ? (
                                        <InfoTooltip message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}>
                                            <span className={`${mobileTagClassName} cursor-help`}>
                                                {appTagLabel}
                                                {appTagLabel === "Lil'Donator" && <Heart className="ml-1 h-2.5 w-2.5 fill-current" />}
                                            </span>
                                        </InfoTooltip>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setIsDonateOpen(true)}
                                            className={`${mobileTagClassName} transition-colors hover:bg-primary/8 dark:hover:bg-cyan-500/20`}
                                        >
                                            {appTagLabel}
                                        </button>
                                    )}
                                </div>

                                <div className="pointer-events-none absolute left-1/2 top-0 z-45 hidden -translate-x-1/2 -translate-y-[118%] sm:block">
                                    {donator.isDonator ? (
                                        <InfoTooltip message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}>
                                            <span className={`${desktopTagClassName} cursor-help`}>
                                                {appTagLabel}
                                                {appTagLabel === "Lil'Donator" && <Heart className="ml-1 h-3 w-3 fill-current" />}
                                            </span>
                                        </InfoTooltip>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setIsDonateOpen(true)}
                                            className={`${desktopTagClassName} transition-colors hover:bg-primary/8 dark:hover:bg-cyan-500/20`}
                                        >
                                            {appTagLabel}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                        <Suspense
                            fallback={
                                <div className="flex items-center justify-center py-20">
                                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                </div>
                            }
                        >
                            <Dashboard
                                account={account}
                                positionsByChain={positionsByChain}
                                donator={donator}
                                loading={loading}
                                error={error}
                                lastFetch={lastFetch}
                                refresh={refresh}
                            />
                        </Suspense>
                    </div>
                ) : (
                    <div className="mt-12 sm:mt-16 bg-white dark:bg-slate-900 rounded-3xl pt-14 pb-10 px-10 sm:pt-16 sm:pb-12 sm:px-12 border border-slate-200 dark:border-slate-800 text-center shadow-xl max-w-lg mx-auto overflow-hidden">
                        <div className="mb-8 flex flex-col items-center">
                            <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 mb-6" />

                            <p className="text-slate-700 dark:text-slate-100 text-lg sm:text-2xl font-bold leading-tight mb-8">
                                Swap Aave v3 positions with <br />
                                {flipPhrase}
                            </p>

                            <Button
                                onClick={connectWallet}
                                disabled={isConnectModalOpen || isConnecting || isReconnecting}
                                className="text-sm px-6 py-2.5 rounded-xl h-auto flex items-center justify-center gap-2.5"
                            >
                                {isConnectModalOpen || isConnecting || isReconnecting ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Wallet className="w-4 h-4" />
                                )}
                                <span>{isConnectModalOpen || isConnecting || isReconnecting ? 'Connecting...' : 'Connect to start'}</span>
                            </Button>
                        </div>
                    </div>
                )}
            </main>

            <AaveHistorySheet />
            <DonateModal
                isOpen={isDonateOpen}
                onClose={() => setIsDonateOpen(false)}
                onVerified={() => refresh(true)}
                onOpenVerify={() => {
                    setIsDonateOpen(false);
                    setTimeout(() => setIsVerifyOpen(true), 150);
                }}
            />
            <VerifyDonationModal
                isOpen={isVerifyOpen}
                onClose={() => setIsVerifyOpen(false)}
                onVerified={() => refresh(true)}
                onOpenDonate={() => {
                    setIsVerifyOpen(false);
                    setTimeout(() => setIsDonateOpen(true), 150);
                }}
            />
            <AppFooter />
        </div>
    );
}
