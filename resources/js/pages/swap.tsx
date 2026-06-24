import React from 'react';
import { AppHeader } from '@/components/app-header';
import AppFooter from '../components/app-footer';
import { SpotSwapCard } from '../components/spot-swap-card';
import { useWeb3 } from '@/contexts/web3-context';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';

export default function Swap() {
    const { account } = useWeb3();
    const { activeCount, setSheetOpen } = useTransactionTracker();

    return (
        <div className="flex flex-col min-h-screen bg-background text-slate-800 dark:text-slate-100 selection:bg-primary/30 font-sans">
            <AppHeader
                account={account}
                activeCount={activeCount}
                onOpenHistory={() => setSheetOpen(true)}
            />

            <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 pb-16 md:pb-24 w-full pt-2 md:pt-12">
                <SpotSwapCard />
            </main>

            <AppFooter activeCount={activeCount} onOpenActivity={() => setSheetOpen(true)} />
        </div>
    );
}
