import { Search } from 'lucide-react';
import React, { useState, useMemo, useRef } from 'react';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';

interface Token {
    symbol: string;
    name?: string;
    underlyingAsset?: string;
    address?: string;
    decimals?: number;
    variableBorrowRate?: number;
    borrowRate?: number;
    supplyAPY?: number;
    isActive?: boolean;
    isFrozen?: boolean;
    isPaused?: boolean;
    borrowingEnabled?: boolean;
    priceInUSD?: string;
}

interface TokenSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (token: Token) => void;
    tokens: Token[];
    title: string;
    description?: string;
    isLoading?: boolean;
    searchPlaceholder?: string;
    renderStatus?: (token: Token) => { disabled: boolean; reasons: string[] };
    hideOverlay?: boolean;
    /** Which rate field to display in each token row. Defaults to variableBorrowRate (borrow APY). */
    rateField?: 'variableBorrowRate' | 'borrowRate' | 'supplyAPY';
    /** Optional list of all market assets to enrich name/rate data if missing */
    marketAssets?: Token[];
}

export const TokenSelector: React.FC<TokenSelectorProps> = ({
    isOpen,
    onClose,
    onSelect,
    tokens,
    title,
    description,
    isLoading = false,
    searchPlaceholder = "Search token...",
    renderStatus,
    hideOverlay = false,
    rateField = 'variableBorrowRate',
    marketAssets = [],
}) => {
    const [search, setSearch] = useState('');
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const filteredTokens = useMemo(() => {
        if (!isOpen) {
            return [];
        }

        if (!tokens) {
            return [];
        }

        const term = search.toLowerCase();
        const filtered = tokens.filter(t =>
            (t.symbol || '').toLowerCase().includes(term) ||
            (t.name || '').toLowerCase().includes(term) ||
            (t.address || '').toLowerCase().includes(term)
        );

        // Sort: enabled tokens first, then disabled ones
        return [...filtered].sort((a, b) => {
            const statusA = renderStatus ? renderStatus(a) : { disabled: false };
            const statusB = renderStatus ? renderStatus(b) : { disabled: false };

            if (statusA.disabled !== statusB.disabled) {
                return statusA.disabled ? 1 : -1;
            }

            // Maintain alphabetical order if both have same status
            return (a.symbol || '').localeCompare(b.symbol || '');
        });
    }, [isOpen, tokens, search, renderStatus]);

    const handleClose = () => {
        setSearch('');
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent
                className="max-w-md max-h-[85vh] flex! flex-col! p-0 gap-0 border-border-light dark:border-slate-700 z-100"
                hideOverlay={false}
                overlayClassName="bg-transparent z-90"
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    scrollContainerRef.current?.focus();
                }}
            >
                <DialogHeader className="p-4 pb-2">
                    <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
                    <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                        {description || 'Select a token from the list below.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-4 pb-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <Input
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                        />
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-4 pt-2 custom-scrollbar overscroll-contain min-h-0 focus:outline-none"
                    tabIndex={-1}
                >
                    {isLoading && filteredTokens.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-sm text-slate-500">
                            Loading tokens...
                        </div>
                    ) : filteredTokens.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-sm text-slate-500 gap-2">
                            <span>No tokens found</span>
                            {search && (
                                <button
                                    onClick={() => setSearch('')}
                                    className="text-xs text-primary hover:underline font-medium"
                                >
                                    Clear search
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredTokens.map((token) => {
                                const status = renderStatus ? renderStatus(token) : { disabled: false, reasons: [] };
                                const isDisabled = status.disabled;

                                // Enrich data from marketAssets if missing (common for debt/supply list)
                                const addr = (token.address || token.underlyingAsset || '').toLowerCase();
                                const richToken = (marketAssets || []).find(m => (m.address || m.underlyingAsset || '').toLowerCase() === addr);

                                const tokenName = token.name || richToken?.name || '';

                                const rate = rateField === 'supplyAPY'
                                    ? (token.supplyAPY ?? richToken?.supplyAPY)
                                    : rateField === 'borrowRate'
                                        ? (token.borrowRate ?? richToken?.borrowRate)
                                        : (token.variableBorrowRate ?? token.borrowRate ?? richToken?.variableBorrowRate ?? richToken?.borrowRate);

                                return (
                                    <button
                                        key={token.underlyingAsset || token.address || token.symbol}
                                        onClick={() => {
                                            if (!isDisabled) {
                                                onSelect(token);
                                                handleClose();
                                            }
                                        }}
                                        aria-disabled={isDisabled}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors text-left
                                            ${isDisabled
                                                ? 'opacity-50 cursor-not-allowed bg-slate-50/50 dark:bg-slate-900/30'
                                                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                            }`}
                                        title={status.reasons.join(', ')}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
                                                <img
                                                    src={getTokenLogo(token.symbol)}
                                                    alt={token.symbol}
                                                    className="w-full h-full object-cover"
                                                    onError={onTokenImgError(token.symbol)}
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-900 dark:text-white truncate">
                                                    {(() => {
                                                        const addr = (token.address || token.underlyingAsset || '').toLowerCase();

                                                        // Arbitrum Specifics - Explicitly disambiguate USDC
                                                        if (addr === '0xaf88d065e77c8cc2239327c5edb3a432268e5831') return 'USDC';
                                                        if (addr === '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8') return 'USDC.e';
                                                        const hasCollision = tokens.some(t =>
                                                            t.symbol === token.symbol &&
                                                            (t.address || t.underlyingAsset || '').toLowerCase() !== (token.address || token.underlyingAsset || '').toLowerCase()
                                                        );

                                                        if (hasCollision) {
                                                            const name = (token.name || '').toLowerCase();
                                                            const symbol = (token.symbol || '').toLowerCase();

                                                            // Aave-style: .e for bridged/pos, plain for native
                                                            const isBridged = name.includes('bridged') ||
                                                                name.includes('(pos)') ||
                                                                name.includes('(e)') ||
                                                                name.includes('polygon') ||
                                                                symbol.endsWith('.e');

                                                            if (isBridged) {
                                                                const baseSymbol = token.symbol.replace(/\.e$/i, '');
                                                                return `${baseSymbol}.e`;
                                                            }
                                                        }
                                                        return token.symbol;
                                                    })()}
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                    {status.reasons.length > 0 ? status.reasons.join(', ') : tokenName}
                                                </div>
                                            </div>
                                        </div>

                                        {rate !== undefined && (
                                            <div className="text-right shrink-0">
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    {(rate * 100).toFixed(2)}%
                                                </div>
                                                <div className="text-[10px] text-slate-500 uppercase">APY</div>
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
