import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import React, { useState } from 'react';
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
    borrowPowerUsedPct: number | null;
    borrowPowerUsedStatus: 'value' | 'no-debt' | 'unavailable';
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

const formatPercent = (value: number | null) => {
    if (value == null || !Number.isFinite(value)) {
        return 'N/A';
    }

    return `${value.toFixed(1)}%`;
};

const getBorrowPowerUsedLabel = (overview: PortfolioOverview) => {
    if (overview.borrowPowerUsedStatus === 'no-debt') {
        return '0.0%';
    }

    if (overview.borrowPowerUsedStatus === 'unavailable') {
        return 'N/A';
    }

    return formatPercent(overview.borrowPowerUsedPct);
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
    {
        key: 'power-used',
        label: 'Power used',
        value: (overview: PortfolioOverview) => getBorrowPowerUsedLabel(overview),
        accent: 'text-slate-900 dark:text-white',
        tooltip: 'Approximate share of your total borrowing power currently in use, based on supplied collateral and total borrowed amount across your active Aave markets.',
    },
];

export const PortfolioOverviewCard: React.FC<PortfolioOverviewCardProps> = ({ overview }) => {
    const [isMobileExpanded, setIsMobileExpanded] = useState(false);
    const totalNetWorthItem = overviewItems[0];
    const approxHfItem = overviewItems[1];

    return (
        <Card className="overflow-hidden rounded-xl border border-border-light bg-white dark:border-border-dark dark:bg-slate-800/60">
            <button
                type="button"
                onClick={() => setIsMobileExpanded((current) => !current)}
                className="flex w-full items-center justify-between px-4 py-3 text-left md:hidden"
            >
                <div className="flex min-w-0 items-center gap-5">
                    <div className="min-w-0">
                        <div className="flex min-h-4 items-start gap-1.5 text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400">
                            <span>{totalNetWorthItem.label}</span>
                            <span aria-hidden className="h-3 w-3 shrink-0" />
                        </div>
                        <div className={`mt-0.5 text-base font-mono font-bold leading-none ${typeof totalNetWorthItem.accent === 'function' ? totalNetWorthItem.accent(overview) : totalNetWorthItem.accent}`}>
                            {totalNetWorthItem.value(overview)}
                        </div>
                    </div>
                    <div className="min-w-0">
                        <div className="flex min-h-4 items-start gap-1.5 text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400">
                            <span>{approxHfItem.label}</span>
                            {approxHfItem.tooltip && (
                                <InfoTooltip size={11} content={approxHfItem.tooltip}>
                                    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none">
                                        <Info className="h-3 w-3 text-slate-400 transition-colors hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400" />
                                    </span>
                                </InfoTooltip>
                            )}
                        </div>
                        <div className={`mt-0.5 text-base font-mono font-bold leading-none ${typeof approxHfItem.accent === 'function' ? approxHfItem.accent(overview) : approxHfItem.accent}`}>
                            {approxHfItem.value(overview)}
                        </div>
                    </div>
                </div>
                {isMobileExpanded ? (
                    <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" />
                ) : (
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
                )}
            </button>

            {isMobileExpanded && (
                <div className="grid grid-cols-2 gap-x-5 gap-y-3 px-4 pb-4 md:hidden">
                    {overviewItems.slice(2).map(({ key, label, value, accent, tooltip }) => (
                        <div key={key} className="px-0 py-0">
                            <div className="flex min-h-4 items-start gap-1.5 text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400">
                                <span>{label}</span>
                                {tooltip && (
                                    <InfoTooltip size={11} content={tooltip}>
                                        <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none">
                                            <Info className="h-3 w-3 text-slate-400 transition-colors hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400" />
                                        </span>
                                    </InfoTooltip>
                                )}
                            </div>
                            <div className={`mt-0.5 text-base font-mono font-bold leading-none ${typeof accent === 'function' ? accent(overview) : accent}`}>
                                {value(overview)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="hidden md:grid md:grid-cols-5 md:gap-0 md:px-5 md:py-4">
                {overviewItems.map(({ key, label, value, accent, tooltip }, index) => (
                    <div
                        key={key}
                        className={`px-0 py-0 md:px-4 ${index > 0 ? 'md:border-l md:border-slate-200/80 dark:md:border-slate-700/80' : ''}`}
                    >
                        <div className="flex min-h-4 items-start gap-1.5 text-[9px] leading-[1.05] font-bold uppercase tracking-[0.16em] text-slate-400">
                            <span>{label}</span>
                            {tooltip && (
                                <InfoTooltip size={11} content={tooltip}>
                                    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none">
                                        <Info className="h-3 w-3 text-slate-400 transition-colors hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400" />
                                    </span>
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
