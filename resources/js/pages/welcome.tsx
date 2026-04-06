import { Wallet } from 'lucide-react';
import { useConnectModal, ConnectButton } from '@rainbow-me/rainbowkit';
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AppHeader } from '@/components/app-header';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import { TransactionHistorySheet } from '@/components/transaction-history-sheet';
import { useWeb3 } from '@/contexts/web3-context';
import AppFooter from '../components/app-footer';
import LilLogo from '../components/lil-logo';
import { Button } from '../components/ui/button';

const Dashboard = lazy(() => import('../components/dashboard'));

export default function Welcome() {
    const { account } = useWeb3();
    const { activeCount, setSheetOpen } = useTransactionTracker();
    const { connectModalOpen } = useConnectModal();
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
                    <Suspense
                        fallback={
                            <div className="flex items-center justify-center py-20">
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            </div>
                        }
                    >
                        <Dashboard />
                    </Suspense>
                ) : (
                    <div className="mt-12 sm:mt-16 bg-white dark:bg-slate-900 rounded-3xl pt-14 pb-10 px-10 sm:pt-16 sm:pb-12 sm:px-12 border border-slate-200 dark:border-slate-800 text-center shadow-xl max-w-lg mx-auto overflow-hidden">
                        <div className="mb-8 flex flex-col items-center">
                            <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 mb-6" />

                            <p className="text-slate-700 dark:text-slate-100 text-lg sm:text-2xl font-bold leading-tight mb-8">
                                Swap Aave v3 positions with <br />
                                {flipPhrase}
                            </p>

                            <ConnectButton.Custom>
                                {({ openConnectModal, authenticationStatus, mounted }) => {
                                    const ready = mounted && authenticationStatus !== 'loading';
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
                                            <Button
                                                onClick={openConnectModal}
                                                disabled={isConnecting}
                                                className="text-sm px-6 py-2.5 rounded-xl h-auto flex items-center justify-center gap-2.5"
                                            >
                                                {isConnecting ? (
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <Wallet className="w-4 h-4" />
                                                )}
                                                <span>{isConnecting ? 'Connecting...' : 'Connect to start'}</span>
                                            </Button>
                                        </div>
                                    );
                                }}
                            </ConnectButton.Custom>
                        </div>
                    </div>
                )}
            </main>

            <TransactionHistorySheet />
            <AppFooter />
        </div>
    );
}
