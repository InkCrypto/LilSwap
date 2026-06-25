import { Link } from '@inertiajs/react';
import { ArrowRightLeft, Coffee, Landmark } from 'lucide-react';
import React, { useMemo, useState } from 'react';
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
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';

    const activeKey = useMemo(() => {
        if (currentPath === '/spot') return 'swap';
        return 'aave';
    }, [currentPath]);

    const getItemClass = (isActive: boolean) => `${baseItemClass} ${isActive
        ? 'text-primary dark:text-purple-300'
        : 'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200'
        }`;

    const getIconClass = (isActive: boolean) => `h-5 w-5 transition-colors ${isActive
        ? 'text-primary dark:text-purple-300'
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
                className="fixed inset-x-0 bottom-0 z-50 px-1.5 pb-[env(safe-area-inset-bottom)] md:hidden"
                aria-label="Primary mobile navigation"
            >
                <div className="mx-auto grid w-full max-w-none grid-cols-3 items-center rounded-t-[1.65rem] border-x border-t border-border-light bg-white/95 px-2 py-2 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-border-dark dark:bg-slate-950/95 dark:shadow-[0_-14px_34px_-24px_rgba(0,0,0,0.85)]">
                    <Link href="/" className={getItemClass(activeKey === 'aave')} aria-current={activeKey === 'aave' ? 'page' : undefined}>
                        <Landmark className={getIconClass(activeKey === 'aave')} strokeWidth={2.2} />
                        <span>Aave</span>
                        {activeKey === 'aave' && <span className="mt-0.5 size-1.5 rounded-full bg-primary dark:bg-purple-300" />}
                    </Link>

                    <Link href="/spot" className={getItemClass(activeKey === 'swap')} aria-current={activeKey === 'swap' ? 'page' : undefined}>
                        <ArrowRightLeft className={getIconClass(activeKey === 'swap')} strokeWidth={2.2} />
                        <span>Swap</span>
                        {activeKey === 'swap' && <span className="mt-0.5 size-1.5 rounded-full bg-primary dark:bg-purple-300" />}
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