/**
 * LilSwap-native spot swap implementation.
 *
 * Temporarily on hold while /swap uses the official Velora widget.
 * Do not delete. This will become the custom LilSwap swap interface later.
 */

import React from 'react';
import { AppHeader } from '@/components/app-header';
import AppFooter from '../components/app-footer';
import { SpotSwapCard } from '../components/spot-swap-card';
import { useWeb3 } from '@/contexts/web3-context';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import LilLogo from '../components/lil-logo';
import { Button } from '../components/ui/button';
import { Wallet } from 'lucide-react';

export default function SwapCustom() {
    const { account, connectWallet, isConnecting, isReconnecting, isConnectModalOpen } = useWeb3();
    const isConnectBusy = isReconnecting || (isConnecting && isConnectModalOpen);
    const { activeCount, setSheetOpen } = useTransactionTracker();

    return (
        <div className="flex flex-col min-h-screen bg-background text-slate-800 dark:text-slate-100 selection:bg-primary/30 font-sans">
            <AppHeader
                account={account}
                activeCount={activeCount}
                onOpenHistory={() => setSheetOpen(true)}
            />

            <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 pb-16 md:pb-24 w-full pt-2 md:pt-12">
                {account ? (
                    <SpotSwapCard />
                ) : (
                    <div className="mt-12 sm:mt-16 bg-white dark:bg-slate-900 rounded-3xl pt-14 pb-10 px-10 sm:pt-16 sm:pb-12 sm:px-12 border border-slate-200 dark:border-slate-800 text-center shadow-xl max-w-lg mx-auto overflow-hidden">
                        <div className="mb-8 flex flex-col items-center">
                            <LilLogo className="w-10 h-10 sm:w-12 sm:h-12 mb-6" />

                            <p className="text-slate-700 dark:text-slate-100 text-lg sm:text-2xl font-bold leading-tight mb-8">
                                Connect your wallet to <br />
                                swap tokens on <span className="text-primary italic">LilSwap</span>
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

            <AppFooter activeCount={activeCount} onOpenActivity={() => setSheetOpen(true)} />
        </div>
    );
}
