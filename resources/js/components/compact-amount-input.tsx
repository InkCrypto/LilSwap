import { ChevronDown, X, ArrowUpDown, RefreshCw } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import { formatCompactNumber } from '../utils/formatters';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';

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
    balanceLabel?: string;
    onTokenSelect: () => void;
    isUSDMode?: boolean;
    onToggleUSDMode?: () => void;
    secondaryValue?: string | null;
    displaySymbol?: string;
    isError?: boolean;
    readOnly?: boolean;
    placeholder?: string;
    isLoading?: boolean;
    loadingLabel?: string;
    showQuickActions?: boolean;
    networkIcon?: string;
    networkLabel?: string;
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
    disabled = false,
    formattedBalance,
    balanceLabel = 'Balance',
    onTokenSelect,
    isUSDMode = false,
    onToggleUSDMode,
    secondaryValue,
    displaySymbol,
    isError = false,
    readOnly = false,
    placeholder = '0.00',
    isLoading = false,
    loadingLabel = 'Loading...',
    showQuickActions = true,
    networkIcon,
    networkLabel,
}) => {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(event.target as Node)
            ) {
                setPopoverOpen(false);
            }
        };

        if (popoverOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [popoverOpen]);

    const handleApplyPct = (pct: number) => {
        if (onApplyPct) {
            onApplyPct(pct);
            setPopoverOpen(false);

            return;
        }

        if (!maxAmount || maxAmount === BigInt(0)) {
            return;
        }
    };

    const handleApplyMax = () => {
        if (onApplyMax) {
            onApplyMax();

            return;
        }
    };

    const focusPrimaryInput = () => {
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
    };

    return (
        <div className="group rounded-xl border border-border-light bg-slate-100 p-1 px-2.5 transition-colors focus-within:border-purple-500/50 dark:border-slate-700 dark:bg-slate-800">
            {/* Top row: input and token badge */}
            <div className="flex items-center gap-2 sm:gap-3">
                <div className="relative flex flex-1 items-center overflow-hidden pl-0.5 focus-within:z-10">
                    {isLoading ? (
                        <div className="flex min-h-8 items-center gap-2 py-0.5 text-purple-400">
                            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-sm font-medium">
                                {loadingLabel}
                            </span>
                        </div>
                    ) : (
                        isUSDMode && (
                            <span
                                className={`mr-0.5 font-mono text-2xl font-bold transition-colors select-none ${isError ? 'text-rose-500' : value && value !== '0' ? 'text-slate-900 dark:text-white' : 'text-muted-foreground'}`}
                            >
                                $
                            </span>
                        )
                    )}
                    {!isLoading && (
                        <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => {
                                onChange(normalizeDecimalInput(e.target.value));
                            }}
                            onPaste={(e) => {
                                const pastedText =
                                    e.clipboardData?.getData('text') || '';
                                e.preventDefault();
                                onChange(normalizeDecimalInput(pastedText));
                            }}
                            placeholder={placeholder}
                            disabled={disabled || readOnly}
                            className={`w-full overflow-hidden bg-transparent py-0.5 pr-6 text-left font-mono text-2xl font-bold text-ellipsis focus:outline-none disabled:opacity-50 ${isError ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}
                        />
                    )}
                    {/* Clear button (X) - shows when there's a value */}
                    {value &&
                        value !== '0' &&
                        value !== '0.' &&
                        !readOnly &&
                        !isLoading && (
                            <button
                                type="button"
                                onClick={() => onChange('')}
                                disabled={disabled}
                                className="absolute top-1/2 right-0.5 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-500 transition-all hover:bg-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                                title="Clear"
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        )}
                </div>
                {/* Token badge */}
                <button
                    type="button"
                    onClick={onTokenSelect}
                    disabled={disabled}
                    className={`flex items-center gap-1.5 px-1 py-1 transition-opacity hover:opacity-75 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                    {token?.symbol ? (
                        <div className="relative h-7 w-7 shrink-0">
                            <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border-light bg-slate-100 dark:border-slate-600/30 dark:bg-slate-700/50">
                                <img
                                    src={getTokenLogo(token.symbol)}
                                    alt={token.symbol}
                                    className="h-full w-full object-cover"
                                    onError={onTokenImgError(token.symbol)}
                                />
                            </div>
                            {networkLabel && (
                                <span
                                    className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-full border-2 border-slate-100 bg-slate-200 text-[7px] font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-200"
                                    title={networkLabel}
                                >
                                    {networkIcon ? (
                                        <img
                                            src={networkIcon}
                                            alt={networkLabel}
                                            className="h-full w-full object-cover"
                                            onError={(event) => {
                                                (
                                                    event.currentTarget as HTMLImageElement
                                                ).style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        networkLabel.charAt(0)
                                    )}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-xs font-bold text-slate-400">
                            ?
                        </span>
                    )}
                    <span className="text-lg leading-none font-bold text-slate-900 dark:text-white">
                        {displaySymbol || token?.symbol || 'Select'}
                    </span>
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                </button>
            </div>

            {/* Single bottom row: $USD left | Balance % MAX right */}
            <div className="mt-0 flex items-center justify-between pl-0.5">
                {/* Secondary value (USD or Token) - Toggle at the START */}
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        onToggleUSDMode?.();
                        focusPrimaryInput();
                    }}
                    disabled={disabled || !onToggleUSDMode}
                    className="group/label flex min-h-5 cursor-pointer appearance-none items-center gap-1 border-none bg-transparent p-0 text-left disabled:cursor-not-allowed"
                    title={isUSDMode ? 'Switch to Token' : 'Switch to USD'}
                >
                    {onToggleUSDMode && token && (
                        <div className="-ml-1 rounded-md p-1 text-slate-400 opacity-60 transition-all group-hover:opacity-100 group-hover/label:bg-slate-200 group-hover/label:text-slate-600 dark:group-hover/label:bg-slate-700 dark:group-hover/label:text-slate-200">
                            <ArrowUpDown className="h-2.5 w-2.5" />
                        </div>
                    )}
                    <span
                        className={`text-xs font-medium transition-colors ${isError ? 'text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                        {secondaryValue || ''}
                    </span>
                </button>

                {/* Balance + optional % popover + MAX â€” hidden for read-only inputs */}
                {!readOnly && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-medium whitespace-nowrap text-slate-500">
                            {balanceLabel}{' '}
                            {formattedBalance
                                ? formatCompactNumber(formattedBalance)
                                : '0'}
                        </span>

                        {/* % button + custom popover */}
                        {showQuickActions && (
                            <>
                                <div className="relative" ref={popoverRef}>
                                    <button
                                        type="button"
                                        className="m-0 cursor-pointer border-none bg-transparent p-0 text-xs text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
                                        disabled={
                                            disabled ||
                                            !maxAmount ||
                                            maxAmount === BigInt(0)
                                        }
                                        onClick={() =>
                                            setPopoverOpen(!popoverOpen)
                                        }
                                    >
                                        %
                                    </button>

                                    {popoverOpen && (
                                        <div className="absolute right-0 bottom-full z-50 mb-2 flex w-auto animate-in gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl duration-150 slide-in-from-bottom-2 dark:border-slate-700 dark:bg-slate-900">
                                            {[25, 50, 75].map((pct) => (
                                                <button
                                                    key={pct}
                                                    type="button"
                                                    onClick={() =>
                                                        handleApplyPct(pct)
                                                    }
                                                    className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-purple-100 hover:text-purple-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-purple-600 dark:hover:text-white"
                                                >
                                                    {pct}%
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    className="m-0 cursor-pointer border-none bg-transparent p-0 text-xs font-bold text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
                                    onClick={handleApplyMax}
                                    disabled={
                                        disabled ||
                                        !maxAmount ||
                                        maxAmount === BigInt(0)
                                    }
                                >
                                    MAX
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
