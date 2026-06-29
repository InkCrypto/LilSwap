import { Link } from '@inertiajs/react';
import AppLogoIcon from '@/components/app-logo-icon';

interface AppLogoProps {
    size?: 'sm' | 'lg' | 'xl';
    showBeta?: boolean;
    href?: string;
    className?: string;
    subtitle?: string;
}

export function AppLogo({ size = 'lg', showBeta, href, className = '', subtitle }: AppLogoProps) {
    const isSplash = size === 'xl';

    const iconSize = size === 'sm'
        ? 'w-8 h-8'
        : 'w-10 h-10 md:w-12 md:h-12';

    const classes = [className].filter(Boolean).join(' ');

    const content = (
        <>
            <AppLogoIcon className={`${iconSize} shrink-0${isSplash ? ' mb-6' : ''}`} />
            {!isSplash && (
                <div className="min-w-0 flex items-center gap-1.5 sm:gap-2 leading-none">
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-nowrap text-slate-900 dark:text-white">
                        LilSwap
                    </h1>
                    {subtitle ? (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold tracking-wider uppercase shrink-0">
                            {subtitle === 'MiniApp' ? 'MINI' : subtitle}
                        </span>
                    ) : (showBeta ?? size === 'lg') && (
                        <span className="px-1 py-0 rounded text-primary text-[8px] font-bold border-2 border-primary/30 mt-0.5 shrink-0">
                            BETA
                        </span>
                    )}
                </div>
            )}
        </>
    );

    const wrapperClass = isSplash
        ? `flex flex-col items-center${classes ? ' ' + classes : ''}`
        : `flex items-center gap-2 sm:gap-2.5${classes ? ' ' + classes : ''}`;

    if (href) {
        return <Link href={href} className={wrapperClass}>{content}</Link>;
    }

    return <div className={wrapperClass}>{content}</div>;
}

export default AppLogo;
