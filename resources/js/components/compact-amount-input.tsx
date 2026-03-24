import { ChevronDown, X, ArrowUpDown } from 'lucide-react';
import React, { useState } from 'react';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { formatCompactNumber } from '../utils/formatters';

interface CompactAmountInputProps {
    token: {
        symbol: string;
        decimals?: number;
        underlyingAsset?: string;
        address?: string;
    } | null;
    value: string;
    onChange: (value: string) => void;
    onApplyMax?: () => void;
    onApplyPct?: (pct: number) => void;
    maxAmount: bigint;
    decimals: number;
    disabled?: boolean;
    formattedBalance?: string;
    onTokenSelect: () => void;
    isUSDMode?: boolean;
    onToggleUSDMode?: () => void;
    secondaryValue?: string | null;
    displaySymbol?: string;
    isError?: boolean;
    readOnly?: boolean;
    placeholder?: string;
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
    onApplyMax,
    onApplyPct,
    maxAmount,
    decimals,
    disabled = false,
    formattedBalance,
    onTokenSelect,
    isUSDMode = false,
    onToggleUSDMode,
    secondaryValue,
    displaySymbol,
    isError = false,
    readOnly = false,
    placeholder = '0.00',
}) => {
    const [popoverOpen, setPopoverOpen] = useState(false);



    const handleApplyPct = (pct: number) => {
        if (onApplyPct) {
            onApplyPct(pct);
            setPopoverOpen(false);

            return;
        }

        if (!maxAmount || maxAmount === BigInt(0)) {
            return;
        }

        // ethers is no longer imported, so we expect the parent to handle this if they want to be precise,
        // but for backward compatibility if we had ethers, we'd use it.
        // Actually, let's just make onApplyMax/Pct required or handle them in parent.
        // I'll re-add ethers just in case or better, force the parent to provide handlers.
        // I'll be explicit here: this component doesn't need ethers anymore as parents handle calculations.
    };

    const handleApplyMax = () => {
        if (onApplyMax) {
            onApplyMax();

            return;
        }
    };

    return (
        <div className="bg-slate-100 dark:bg-slate-800 border border-border-light dark:border-slate-700 rounded-xl p-1 px-2.5 group transition-colors focus-within:border-purple-500/50">
            {/* Top row: input and token badge */}
            <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex-1 relative overflow-hidden flex items-center pl-0.5 focus-within:z-10">
                    {isUSDMode && (
                        <span className={`text-2xl font-mono font-bold mr-0.5 select-none transition-colors ${isError ? 'text-rose-500' : (value && value !== '0' ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500')}`}>$</span>
                    )}
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
                        placeholder={placeholder}
                        disabled={disabled || readOnly}
                        className={`w-full bg-transparent text-2xl font-mono font-bold text-left focus:outline-none disabled:opacity-50 py-0.5 pr-6 text-ellipsis overflow-hidden ${isError ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}
                    />
                    {/* Clear button (X) - shows when there's a value */}
                    {value && value !== '0' && value !== '0.' && !readOnly && (
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
            <div className="flex items-center justify-between mt-0 pl-0.5">
                {/* Secondary value (USD or Token) - Toggle at the START */}
                <button
                    type="button"
                    onClick={onToggleUSDMode}
                    disabled={disabled || !onToggleUSDMode}
                    className="flex items-center gap-1 flex-1 min-h-5 text-left group/label p-0 bg-transparent border-none appearance-none cursor-pointer disabled:cursor-not-allowed"
                    title={isUSDMode ? "Switch to Token" : "Switch to USD"}
                >
                    {onToggleUSDMode && token && (
                        <div className="p-1 rounded-md group-hover/label:bg-slate-200 dark:group-hover/label:bg-slate-700 text-slate-400 group-hover/label:text-slate-600 dark:group-hover/label:text-slate-200 transition-all group-hover:opacity-100 opacity-60 -ml-1">
                            <ArrowUpDown className="w-2.5 h-2.5" />
                        </div>
                    )}
                    <span className={`text-xs font-medium transition-colors ${isError ? 'text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {secondaryValue || ''}
                    </span>
                </button>

                {/* Balance + % popover + MAX — hidden for read-only (destination) inputs */}
                {!readOnly && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="text-slate-500 font-medium whitespace-nowrap">Balance {formattedBalance ? formatCompactNumber(formattedBalance) : '0'}</span>

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
                )}
            </div>
        </div>
    );
};
