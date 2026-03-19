import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import logger from '../utils/logger';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface AmountInputProps {
    maxAmount: bigint;
    decimals: number;
    symbol: string;
    onAmountChange: (amount: bigint) => void;
    isProcessing?: boolean;
    hasInlineSelector?: boolean;
}

/**
 * AmountInput Component
 * Allows the user to select a specific amount for swap
 * with percentage buttons (25%, 50%, 75%, Max)
 */
export const AmountInput: React.FC<AmountInputProps> = ({
    maxAmount,
    decimals,
    symbol,
    onAmountChange,
    isProcessing = false,
    hasInlineSelector = false
}) => {
    const [inputValue, setInputValue] = useState('');
    const [selectedPercentage, setSelectedPercentage] = useState<number | null>(100);
    const isEditingRef = useRef(false);
    const editingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Update input when maxAmount changes (except during manual editing)
    useEffect(() => {
        if (isEditingRef.current) return;

        if (maxAmount && maxAmount > BigInt(0)) {
            const formatted = ethers.formatUnits(maxAmount, decimals);
            setInputValue(formatted);
            setSelectedPercentage(100);
            onAmountChange(maxAmount);
        } else {
            setInputValue('');
            setSelectedPercentage(100);
            onAmountChange(BigInt(0));
        }
    }, [maxAmount, decimals, onAmountChange]);

    useEffect(() => {
        return () => {
            if (editingTimeoutRef.current) clearTimeout(editingTimeoutRef.current);
        };
    }, []);

    const handlePercentageClick = (percentage: number) => {
        if (!maxAmount || maxAmount === BigInt(0)) return;

        isEditingRef.current = false;
        if (editingTimeoutRef.current) clearTimeout(editingTimeoutRef.current);

        setSelectedPercentage(percentage);
        const calculatedAmount = (maxAmount * BigInt(percentage)) / BigInt(100);
        const formatted = ethers.formatUnits(calculatedAmount, decimals);
        setInputValue(formatted);
        onAmountChange(calculatedAmount);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => {
        const normalized = normalizeDecimalInput(e.target.value);

        isEditingRef.current = true;
        if (editingTimeoutRef.current) clearTimeout(editingTimeoutRef.current);
        editingTimeoutRef.current = setTimeout(() => {
            isEditingRef.current = false;
        }, 500);

        setInputValue(normalized);
        setSelectedPercentage(null);

        try {
            if (!normalized) {
                onAmountChange(BigInt(0));
            } else {
                const parsable = normalized.endsWith('.') ? `${normalized.slice(0, -1) || '0'}` : normalized;
                const parsedAmount = ethers.parseUnits(parsable, decimals);
                if (parsedAmount > maxAmount) {
                    onAmountChange(maxAmount);
                } else {
                    onAmountChange(parsedAmount);
                }
            }
        } catch (error) {
            logger.warn('Invalid input:', normalized);
        }
    };

    const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const pastedText = e.clipboardData?.getData('text') || '';
        const normalized = normalizeDecimalInput(pastedText);
        e.preventDefault();
        handleInputChange({ target: { value: normalized } });
    };

    const percentageButtons = [
        { value: 25, label: '25%' },
        { value: 50, label: '50%' },
        { value: 75, label: '75%' },
        { value: 100, label: 'Max' },
    ];

    const formattedMax = maxAmount > BigInt(0)
        ? Number(ethers.formatUnits(maxAmount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })
        : '0';

    return (
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
            <div className="flex justify-between items-center mb-2">
                <label className="text-xs text-slate-400 uppercase font-bold tracking-wider flex items-center gap-2">
                    Amount to Swap
                    {isProcessing && (
                        <span className="text-[10px] text-purple-400 font-normal normal-case flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                            Updating...
                        </span>
                    )}
                </label>
                <span className="text-xs text-slate-500">
                    Max: {formattedMax} {symbol}
                </span>
            </div>

            <div className="relative mb-3">
                <Input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onPaste={handleInputPaste}
                    placeholder="0.00"
                    className={`w-full bg-slate-800 text-white text-2xl font-mono font-bold px-4 py-8 rounded-lg border-2 border-slate-700 focus:border-purple-500 focus:outline-none transition-colors ${hasInlineSelector ? 'pr-20' : ''}`}
                />
                <div className={`absolute ${hasInlineSelector ? 'right-20' : 'right-4'} top-1/2 -translate-y-1/2`}>
                    <span className="text-slate-500 text-sm font-bold">
                        {symbol}
                    </span>
                </div>
            </div>

            <div className="flex gap-2">
                {percentageButtons.map(({ value, label }) => (
                    <Button
                        key={value}
                        variant={selectedPercentage === value ? 'default' : 'secondary'}
                        size="sm"
                        onClick={() => handlePercentageClick(value)}
                        disabled={!maxAmount || maxAmount === BigInt(0)}
                        className={`flex-1 font-bold ${selectedPercentage === value ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                    >
                        {label}
                    </Button>
                ))}
            </div>

            <p className="text-[10px] text-slate-500 mt-3">
                💡 You can swap part of or all of your debt
            </p>
        </div>
    );
};
