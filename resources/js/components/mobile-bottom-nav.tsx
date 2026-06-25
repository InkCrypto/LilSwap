import { Link } from '@inertiajs/react';
import { ArrowRightLeft, Coffee, Landmark } from 'lucide-react';
import React, { useMemo, useState, useEffect } from 'react';
import { DonateModal } from './donate-modal';
import { VerifyDonationModal } from './verify-donation-modal';

type MobileBottomNavProps = {
    onVerifiedDonation?: () => void | Promise<void>;
};

const baseItemClass = 'group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold leading-none transition-colors active:scale-[0.98]';

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onVerifiedDonation }) => {
    const [isDonateOpen, setIsDonateOpen] = useState(false);
    const [isVerifyOpen, setIsVerifyOpen] = useState(false);
    const [autoVerifyData, setAutoVerifyData] = useState<{ txHash: string; chainId: number } | null>(null);
    const [isWeb3Browser, setIsWeb3Browser] = useState(false);
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const hasWallet = !!((window as any).ethereum || (window as any).rabby || (window as any).web3);
            const hasWalletUA = /rabby|metamask|trust|coinbase|alphawallet|status|tokenpocket/i.test(navigator.userAgent);
            if (hasWallet || hasWalletUA) {
                setIsWeb3Browser(true);
            }
        }
    }, []);

    const activeKey = useMemo(() => {
        if (currentPath === '/spot') return 'swap';
        return 'aave';
    }, [currentPath]);

    const getItemClass = (isActive: boolean) => `${baseItemClass} ${isActive
        ? 'text-primary'
        : 'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200'
        }`;

    const getIconClass = (isActive: boolean) => `h-5 w-5 transition-colors ${isActive
        ? 'text-primary'
        : 'text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200'
        }`;

    const handleDonated = (txHash: string, chainId: number) => {
        setIsDonateOpen(false);
        setAutoVerifyData({ txHash, chainId });
        setIsVerifyOpen(true);
    };

    return (
        <>
            <nav
                className={`fixed inset-x-0 bottom-0 z-50 border-t border-border-light bg-white/95 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-border-dark dark:bg-slate-950/95 dark:shadow-[0_-10px_30px_rgba(0,0,0,0.5)] md:hidden ${
                    isWeb3Browser ? 'pb-0' : 'pb-[env(safe-area-inset-bottom,0px)]'
                }`}
                aria-label="Primary mobile navigation"
            >
                <div className="mx-auto grid w-full max-w-none grid-cols-3 items-center px-2 py-2">
                    <Link href="/" className={getItemClass(activeKey === 'aave')} aria-current={activeKey === 'aave' ? 'page' : undefined}>
                        <Landmark className={getIconClass(activeKey === 'aave')} strokeWidth={2.2} />
                        <span>Aave</span>
                        {activeKey === 'aave' && <span className="mt-0.5 size-1.5 rounded-full bg-primary" />}
                    </Link>

                    <Link href="/spot" className={getItemClass(activeKey === 'swap')} aria-current={activeKey === 'swap' ? 'page' : undefined}>
                        <ArrowRightLeft className={getIconClass(activeKey === 'swap')} strokeWidth={2.2} />
                        <span>Swap</span>
                        {activeKey === 'swap' && <span className="mt-0.5 size-1.5 rounded-full bg-primary" />}
                    </Link>

                    <button type="button" onClick={() => setIsDonateOpen(true)} className={getItemClass(false)}>
                        <Coffee className={getIconClass(false)} strokeWidth={2.2} />
                        <span>Donate</span>
                    </button>
                </div>
            </nav>

            <DonateModal
                isOpen={isDonateOpen}
                onClose={() => setIsDonateOpen(false)}
                onVerified={onVerifiedDonation}
                onDonated={handleDonated}
                onOpenVerify={() => {
                    setIsDonateOpen(false);
                    setTimeout(() => setIsVerifyOpen(true), 150);
                }}
            />

            <VerifyDonationModal
                isOpen={isVerifyOpen}
                onClose={() => {
                    setIsVerifyOpen(false);
                    setAutoVerifyData(null);
                }}
                onVerified={onVerifiedDonation}
                initialHash={autoVerifyData?.txHash}
                initialChainId={autoVerifyData?.chainId}
                onOpenDonate={() => {
                    setIsVerifyOpen(false);
                    setTimeout(() => setIsDonateOpen(true), 150);
                }}
            />
        </>
    );
};

export default MobileBottomNav;