import { Heart, Wallet } from 'lucide-react';
import React, { useState, Suspense, lazy } from 'react';
import { HistorySheet } from '@/components/history-sheet';
import { AppHeader } from '@/components/app-header';
import { InfoTooltip } from '@/components/info-tooltip';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import { useWeb3 } from '@/contexts/web3-context';
import { usePositions } from '@/hooks/use-positions';
import { useFlipPhrase } from '../components/flip-phrase';
import AppFooter from '../components/app-footer';
import MobileBottomNav from '../components/mobile-bottom-nav';
import { DonateModal } from '../components/donate-modal';
import AppLogo from '@/components/app-logo';
import { Button } from '../components/ui/button';
import { VerifyDonationModal } from '../components/verify-donation-modal';

const Dashboard = lazy(() => import('../components/dashboard'));

export default function Welcome() {
    const { account, connectWallet, isConnecting, isReconnecting, isConnectModalOpen } = useWeb3();
    const isConnectBusy = isReconnecting || (isConnecting && isConnectModalOpen);
    const { activeCount, setSheetOpen } = useTransactionTracker();
    const { positionsByChain, donator, loading, error, lastFetch, refresh } = usePositions(account);
    const [isDonateOpen, setIsDonateOpen] = useState(false);
    const [isVerifyOpen, setIsVerifyOpen] = useState(false);
    const flipPhrase = useFlipPhrase();

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

            <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 pb-32 md:pb-24 w-full pt-2 md:pt-12">
                {account ? (
                    <div className="relative">
                        {showDonatorTag && (
                            <>
                                <div className="pointer-events-none absolute left-1/2 top-0 z-45 -translate-x-1/2 translate-y-[-92%] sm:hidden">
                                    {donator.isDonator ? (
                                        <InfoTooltip
                                            maxWidth="250px"
                                            message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}
                                        >
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

                                <div className="pointer-events-none absolute left-1/2 top-0 z-45 hidden -translate-x-1/2 translate-y-[-118%] sm:block">
                                    {donator.isDonator ? (
                                        <InfoTooltip
                                            maxWidth="250px"
                                            message={`You are enjoying a ${donator.discountPercent}% discount. Thank you for supporting LilSwap!`}
                                        >
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
                            <AppLogo size="xl" />

                            <p className="text-slate-700 dark:text-slate-100 text-lg sm:text-2xl font-bold leading-tight mb-8">
                                Swap tokens & positions with <br />
                                {flipPhrase}
                            </p>

                            <Button
                                onClick={connectWallet}
                                disabled={isConnectBusy}
                                className="text-sm px-6 py-2.5 rounded-xl h-auto flex items-center justify-center gap-2.5"
                            >
                                {isConnectBusy ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Wallet className="w-4 h-4" />
                                )}
                                <span>{isConnectBusy ? 'Connecting...' : 'Connect to start'}</span>
                            </Button>
                        </div>
                    </div>
                )}
            </main>

            <HistorySheet />
            {account && <MobileBottomNav onVerifiedDonation={() => refresh(true)} />}
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
            <AppFooter activeCount={activeCount} onOpenActivity={() => setSheetOpen(true)} />
        </div>
    );
}
