import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';

/**
 * AmountInput Component
 * Allows the user to select a specific amount for swap
 * with percentage buttons (25%, 50%, 75%, Max)
 */
export const AmountInput = ({
    maxAmount,
    decimals,
    symbol,
    onAmountChange,
    isProcessing = false // Shows loading state while waiting for backend
}) => {
    const [inputValue, setInputValue] = useState('');
    const [selectedPercentage, setSelectedPercentage] = useState(100);
    const isEditingRef = useRef(false);
    const editingTimeoutRef = useRef(null);

    // Update input when maxAmount changes (except during manual editing)
    useEffect(() => {
        // Don't override input value while user is typing
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
    }, [maxAmount, decimals]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            clearTimeout(editingTimeoutRef.current);
        };
    }, []);

    const handlePercentageClick = (percentage) => {
        if (!maxAmount || maxAmount === BigInt(0)) return;

        // Clear editing flag since this is a percentage button click
        isEditingRef.current = false;
        clearTimeout(editingTimeoutRef.current);

        setSelectedPercentage(percentage);
        const calculatedAmount = (maxAmount * BigInt(percentage)) / BigInt(100);
        const formatted = ethers.formatUnits(calculatedAmount, decimals);
        setInputValue(formatted);
        onAmountChange(calculatedAmount);
    };

    const handleInputChange = (e) => {
        const value = e.target.value;

        // Mark that user is manually editing
        isEditingRef.current = true;
        clearTimeout(editingTimeoutRef.current);
        editingTimeoutRef.current = setTimeout(() => {
            isEditingRef.current = false;
        }, 500); // Clear flag 500ms after user stops typing

        // Allow only numbers and decimal point
        if (value === '' || /^\d*\.?\d*$/.test(value)) {
            setInputValue(value);
            setSelectedPercentage(null); // Clear percentage selection on manual input

            try {
                if (value === '' || value === '.') {
                    onAmountChange(BigInt(0));
                } else {
                    const parsedAmount = ethers.parseUnits(value, decimals);
                    // Validate that input doesn't exceed max
                    if (parsedAmount > maxAmount) {
                        onAmountChange(maxAmount);
                    } else {
                        onAmountChange(parsedAmount);
                    }
                }
            } catch (error) {
                // Invalid input, ignore
                console.warn('Invalid input:', value);
            }
        }
    };

    const percentageButtons = [
        { value: 25, label: '25%' },
        { value: 50, label: '50%' },
        { value: 75, label: '75%' },
        { value: 100, label: 'Max' },
    ];

    const isMaxButtonActive = selectedPercentage === 100;
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

            {/* Input Field */}
            <div className="relative mb-3">
                <input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    className="w-full bg-slate-800 text-white text-2xl font-mono font-bold px-4 py-3 rounded-lg border-2 border-slate-700 focus:border-purple-500 focus:outline-none transition-colors"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <span className="text-slate-500 text-sm font-bold">
                        {symbol}
                    </span>
                </div>
            </div>

            {/* Percentage Buttons */}
            <div className="flex gap-2">
                {percentageButtons.map(({ value, label }) => (
                    <button
                        key={value}
                        onClick={() => handlePercentageClick(value)}
                        disabled={!maxAmount || maxAmount === BigInt(0)}
                        className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${selectedPercentage === value
                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                            }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <p className="text-[10px] text-slate-500 mt-3">
                💡 You can swap part of or all of your debt
            </p>
        </div>
    );
};
