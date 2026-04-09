import { Info } from 'lucide-react';
import React from 'react';
import { formatHF, formatUSD } from '../utils/formatters';
import { InfoTooltip } from './info-tooltip';
import { Card } from './ui/card';

export interface PortfolioOverview {
    totalNetWorthUSD: number;
    totalSuppliedUSD: number;
    totalBorrowedUSD: number;
    activeMarkets: number;
    approxHealthFactor: number | null;
    approxHealthFactorStatus: 'value' | 'no-debt' | 'unavailable';
}

interface PortfolioOverviewCardProps {
    overview: PortfolioOverview;
}

const getApproxHealthFactorClassName = (overview: PortfolioOverview) => {
    if (overview.approxHealthFactorStatus !== 'value' || overview.approxHealthFactor == null) {
        return 'text-slate-900 dark:text-white';
    }

    if (overview.approxHealthFactor >= 3 || overview.approxHealthFactor === -1) {
        return 'text-green-400';
    }

    if (overview.approxHealthFactor >= 1.1) {
        return 'text-orange-400';
    }

    return 'text-red-500';
};

const getApproxHealthFactorLabel = (overview: PortfolioOverview) => {
    if (overview.approxHealthFactorStatus === 'no-debt') {
        return 'No debt';
    }

    if (overview.approxHealthFactorStatus === 'unavailable') {
        return 'N/A';
    }

    return formatHF(overview.approxHealthFactor);
};

const overviewItems = [
    {
        key: 'total-net-worth',
        label: 'Total net worth',
        value: (overview: PortfolioOverview) => formatUSD(overview.totalNetWorthUSD),
        accent: 'text-slate-900 dark:text-white',
    },
    {
        key: 'approx-hf',
        label: 'Approx. HF',
        value: (overview: PortfolioOverview) => getApproxHealthFactorLabel(overview),
        accent: (overview: PortfolioOverview) => getApproxHealthFactorClassName(overview),
        tooltip: 'Approximate portfolio-level risk indicator based on collateral power and debt across markets. Informational only, not an official Aave health factor.',
    },
    {
        key: 'supplied',
        label: 'Total supplied',
        value: (overview: PortfolioOverview) => formatUSD(overview.totalSuppliedUSD),
        accent: 'text-emerald-500',
    },
    {
        key: 'borrowed',
        label: 'Total borrowed',
        value: (overview: PortfolioOverview) => formatUSD(overview.totalBorrowedUSD),
        accent: 'text-primary',
    },
];

export const PortfolioOverviewCard: React.FC<PortfolioOverviewCardProps> = ({ overview }) => {
    return (
        <Card className="overflow-hidden rounded-xl border border-border-light bg-white dark:border-border-dark dark:bg-slate-800/60">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-4 sm:px-5 sm:py-4 md:flex md:items-center md:gap-0">
                {overviewItems.map(({ key, label, value, accent, tooltip }, index) => (
                    <div
                        key={key}
                        className={`px-0 py-0 md:flex-1 md:px-4 ${index > 0 ? 'md:border-l md:border-slate-200/80 dark:md:border-slate-700/80' : ''}`}
                    >
                        <div className="flex min-h-4 items-start gap-1.5 text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400">
                            <span>{label}</span>
                            {tooltip && (
                                <InfoTooltip size={11} content={tooltip}>
                                    <Info className="h-3 w-3 text-slate-400 transition-colors hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400" />
                                </InfoTooltip>
                            )}
                        </div>
                        <div className={`mt-0.5 text-base font-mono font-bold leading-none md:text-[1rem] xl:text-[1.05rem] ${typeof accent === 'function' ? accent(overview) : accent}`}>
                            {value(overview)}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
};
