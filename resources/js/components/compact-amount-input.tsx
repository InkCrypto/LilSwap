import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { ChevronDown, X } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import logger from '../utils/logger';

interface CompactAmountInputProps {
    token: {
        symbol: string;
        decimals?: number;
        underlyingAsset?: string;
        address?: string;
    } | null;
    value: string;
    onChange: (value: string) => void;
    maxAmount: bigint;
    decimals: number;
    disabled?: boolean;
    formattedBalance?: string;
    onTokenSelect: () => void;
    usdValue?: string | null;
    displaySymbol?: string;
}

/**
 * CompactAmountInput Component
 * Condensed input row designed for modals.
 * Top row: Amount Input + Token Selector
 * Bottom row: USD Value (left) | Balance/Pct/Max (right)
 */
export const CompactAmountInput: React.FC<CompactAmountInputProps> = ({
    token,
    value,
    onChange,
    maxAmount,
    decimals,
    disabled = false,
    formattedBalance,
    onTokenSelect,
    usdValue,
    displaySymbol,
}) => {
    const [popoverOpen, setPopoverOpen] = useState(false);

    const compactNumber = (str: string | undefined) => {
        if (!str) return '0';
        const n = parseFloat(str);
        if (isNaN(n)) return str;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
        return Number(n.toFixed(4)).toString();
    };

    const handleApplyPct = (pct: number) => {
        if (!maxAmount || maxAmount === BigInt(0)) return;
        const calculatedAmount = (maxAmount * BigInt(pct)) / BigInt(100);
        onChange(ethers.formatUnits(calculatedAmount, decimals));
        setPopoverOpen(false);
    };

    const handleApplyMax = () => {
        if (!maxAmount || maxAmount === BigInt(0)) return;
        onChange(ethers.formatUnits(maxAmount, decimals));
    };

    return (
        <div className="bg-slate-100 dark:bg-slate-800 border border-border-light dark:border-slate-700 rounded-xl p-1 px-2.5">
            {/* Top row: input and token badge */}
            <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex-1 relative overflow-hidden">
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => {
                            onChange(normalizeDecimalInput(e.target.value));
                        }}
                        onPaste={(e) => {
                            const pastedText = e.clipboardData?.getData('text') || '';
                            e.preventDefault();
                            onChange(normalizeDecimalInput(pastedText));
                        }}
                        placeholder="0.00"
                        disabled={disabled}
                        className="w-full bg-transparent text-slate-900 dark:text-white text-2xl font-mono font-bold text-left pl-1.5 focus:outline-none disabled:opacity-50 py-0.5 pr-6 text-ellipsis overflow-hidden"
                    />
                    {/* Clear button (X) - shows when there's a value */}
                    {value && value !== '0' && value !== '0.' && (
                        <button
                            type="button"
                            onClick={() => onChange('')}
                            disabled={disabled}
                            className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Clear"
                        >
                            <X className="w-2.5 h-2.5" />
                        </button>
                    )}
                </div>
                {/* Token badge */}
                <button
                    type="button"
                    onClick={onTokenSelect}
                    disabled={disabled}
                    className={`flex items-center gap-1.5 py-1 px-1 hover:opacity-75 transition-opacity ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {token?.symbol ? (
                        <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden border border-border-light dark:border-slate-600/30">
                            <img
                                src={getTokenLogo(token.symbol)}
                                alt={token.symbol}
                                className="w-full h-full object-cover"
                                onError={onTokenImgError(token.symbol)}
                            />
                        </div>
                    ) : (
                        <span className="text-xs font-bold text-slate-400">?</span>
                    )}
                    <span className="text-lg font-bold text-slate-900 dark:text-white leading-none">
                        {displaySymbol || token?.symbol || 'Select'}
                    </span>
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                </button>
            </div>

            {/* Single bottom row: $USD left | Balance % MAX right */}
            <div className="flex items-center justify-between mt-0 pl-1.5">
                {/* USD value */}
                <span className="text-xs text-slate-500">{usdValue ? `~ ${usdValue}` : ''}</span>

                {/* Balance + % popover + MAX */}
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="text-slate-500 font-medium whitespace-nowrap">Balance {compactNumber(formattedBalance) || '0'}</span>

                    {/* % button + custom popover */}
                    <div className="relative">
                        <button
                            type="button"
                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-transparent border-none p-0 m-0 cursor-pointer transition-colors disabled:opacity-50"
                            disabled={disabled || !maxAmount || maxAmount === BigInt(0)}
                            onClick={() => setPopoverOpen(!popoverOpen)}
                        >
                            %
                        </button>
                        
                        {popoverOpen && (
                            <div className="absolute bottom-full right-0 mb-2 p-1.5 flex gap-1.5 w-auto rounded-lg border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-xl z-50 animate-in slide-in-from-bottom-2 duration-150">
                                {[25, 50, 75].map((pct) => (
                                    <button
                                        key={pct}
                                        type="button"
                                        onClick={() => handleApplyPct(pct)}
                                        className="px-3 py-1.5 text-xs font-bold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-600 hover:text-purple-600 dark:hover:text-white transition-colors"
                                    >
                                        {pct}%
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-transparent border-none p-0 m-0 cursor-pointer transition-colors disabled:opacity-50"
                        onClick={handleApplyMax}
                        disabled={disabled || !maxAmount || maxAmount === BigInt(0)}
                    >
                        MAX
                    </button>
                </div>
            </div>
        </div>
    );
};
