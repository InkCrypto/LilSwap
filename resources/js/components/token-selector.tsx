import { ExternalLink, Search } from 'lucide-react';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { isAddress } from 'viem';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { formatAPY } from '../utils/formatters';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';

const TOKEN_ROW_HEIGHT = 68;
const TOKEN_ROW_OVERSCAN = 8;
const LOCAL_ICON_SYMBOLS = new Set([
    'ETH',
    'WETH',
    'DAI',
    'USDC',
    'USDC.E',
    'USDT',
    'USDT0',
    'WBTC',
    'CBBTC',
    'CBETH',
    'WSTETH',
    'RETH',
    'LINK',
    'AAVE',
    'EURC',
    'GH0',
    'GHO',
    'POL',
    'WPOL',
    'WMATIC',
]);

const getSelectorTokenLogo = (token: Token) => {
    const symbol = String(token.symbol || '').toUpperCase();
    const logoURI = String(token.logoURI || '');
    const isGenericRemoteLogo = /paraswap\.io\/token\/token\.png/i.test(logoURI);

    if (LOCAL_ICON_SYMBOLS.has(symbol) || !logoURI || isGenericRemoteLogo) {
        return getTokenLogo(token.symbol);
    }

    return logoURI;
};

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
    balance?: string;
    amount?: string;
    formattedAmount?: string;
    isCustom?: boolean;
    logoURI?: string;
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
    renderStatus?: (token: Token) => {
        disabled: boolean;
        reasons: string[];
        amount?: string;
        amountRaw?: number;
        amountUSD?: string;
        contractAddress?: string;
        contractUrl?: string;
        hideRate?: boolean;
    };
    hideOverlay?: boolean;
    /** Which rate field to display in each token row. Defaults to variableBorrowRate (borrow APY). */
    rateField?: 'variableBorrowRate' | 'borrowRate' | 'supplyAPY';
    /** Optional list of all market assets to enrich name/rate data if missing */
    marketAssets?: Token[];
    allowCustomTokens?: boolean;
    onImportToken?: (address: string) => Promise<Token | null>;
    sortByAmount?: boolean;
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
    rateField = 'variableBorrowRate',
    marketAssets = [],
    allowCustomTokens = false,
    onImportToken,
    sortByAmount = false,
}) => {
    const [search, setSearch] = useState('');
    const [importedToken, setImportedToken] = useState<Token | null>(null);
    const [isImportingToken, setIsImportingToken] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        const term = search.trim();

        setImportedToken(null);

        if (!isOpen || !allowCustomTokens || !onImportToken || !isAddress(term)) {
            setIsImportingToken(false);
            return;
        }

        const alreadyListed = (tokens || []).some((token) => {
            const addr = (token.address || token.underlyingAsset || '').toLowerCase();
            return addr === term.toLowerCase();
        });

        if (alreadyListed) {
            setIsImportingToken(false);
            return;
        }

        setIsImportingToken(true);
        onImportToken(term)
            .then((token) => {
                if (!cancelled) {
                    setImportedToken(token);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setImportedToken(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsImportingToken(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [allowCustomTokens, isOpen, onImportToken, search, tokens]);

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
            (t.address || '').toLowerCase().includes(term) ||
            (t.underlyingAsset || '').toLowerCase().includes(term)
        );
        const withImported = importedToken
            ? [...filtered, importedToken]
            : filtered;

        // Sort: enabled tokens first, then disabled ones
        return [...withImported].sort((a, b) => {
            if (a.isCustom !== b.isCustom) {
                return a.isCustom ? -1 : 1;
            }

            const statusA = renderStatus ? renderStatus(a) : { disabled: false, reasons: [] };
            const statusB = renderStatus ? renderStatus(b) : { disabled: false, reasons: [] };

            if (statusA.disabled !== statusB.disabled) {
                return statusA.disabled ? 1 : -1;
            }

            if (sortByAmount) {
                const amountA = Number(statusA.amountRaw || 0);
                const amountB = Number(statusB.amountRaw || 0);

                if ((amountA > 0 || amountB > 0) && amountA !== amountB) {
                    return amountB - amountA;
                }
            }

            // Maintain alphabetical order if both have same status
            return (a.symbol || '').localeCompare(b.symbol || '');
        });
    }, [importedToken, isOpen, tokens, search, renderStatus, sortByAmount]);

    const handleClose = () => {
        setSearch('');
        setImportedToken(null);
        setIsImportingToken(false);
        setScrollTop(0);
        onClose();
    };

    useEffect(() => {
        setScrollTop(0);
        scrollContainerRef.current?.scrollTo({ top: 0 });
    }, [search, isOpen]);

    const viewportHeight = scrollContainerRef.current?.clientHeight || 440;
    const virtualStart = Math.max(0, Math.floor(scrollTop / TOKEN_ROW_HEIGHT) - TOKEN_ROW_OVERSCAN);
    const virtualEnd = Math.min(
        filteredTokens.length,
        Math.ceil((scrollTop + viewportHeight) / TOKEN_ROW_HEIGHT) + TOKEN_ROW_OVERSCAN
    );
    const visibleTokens = filteredTokens.slice(virtualStart, virtualEnd);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent
                className="max-w-md max-h-[85vh] flex! flex-col! p-0 gap-0 bg-white dark:bg-slate-900 border-border-light dark:border-slate-700 z-100 shadow-2xl rounded-2xl overflow-hidden"
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
                            className="pl-9 bg-slate-50 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 focus:border-purple-500/50 transition-colors"
                        />
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-4 pt-2 custom-scrollbar overscroll-contain min-h-0 focus:outline-none"
                    tabIndex={-1}
                    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                    {(isLoading || isImportingToken) && filteredTokens.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-sm text-slate-500">
                            {isImportingToken ? 'Importing token...' : 'Loading tokens...'}
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
                        <div
                            className="relative"
                            style={{ height: filteredTokens.length * TOKEN_ROW_HEIGHT }}
                        >
                            <div
                                className="absolute inset-x-0 top-0 space-y-1"
                                style={{ transform: `translateY(${virtualStart * TOKEN_ROW_HEIGHT}px)` }}
                            >
                            {visibleTokens.map((token) => {
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
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left group
                                            ${isDisabled
                                                ? 'opacity-40 cursor-not-allowed bg-slate-50/30 dark:bg-slate-900/20'
                                                : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/80 active:scale-[0.98]'
                                            }`}
                                        title={status.reasons.join(', ')}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center overflow-hidden border border-slate-200/50 dark:border-slate-700/50 shrink-0 group-hover:border-purple-200 dark:group-hover:border-purple-800/50 transition-colors">
                                                <img
                                                    src={getSelectorTokenLogo(token)}
                                                    alt={token.symbol}
                                                    className="w-full h-full object-cover"
                                                    onError={(event) => {
                                                        const target = event.currentTarget;
                                                        const localLogo = getTokenLogo(token.symbol);

                                                        if (!target.src.includes(localLogo)) {
                                                            target.src = localLogo;
                                                            return;
                                                        }

                                                        onTokenImgError(token.symbol)(event);
                                                    }}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-y-1 min-w-0">
                                                <div className="font-bold text-slate-900 dark:text-white truncate leading-tight">
                                                    {(() => {
                                                        const addr = (token.address || token.underlyingAsset || '').toLowerCase();

                                                        // Arbitrum Specifics - Explicitly disambiguate USDC
                                                        if (addr === '0xaf88d065e77c8cc2239327c5edb3a432268e5831') {
                                                            return 'USDC';
                                                        }

                                                        if (addr === '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8') {
                                                            return 'USDC.e';
                                                        }

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
                                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5 leading-tight">
                                                    {status.reasons.length > 0 ? (
                                                        <span className="text-rose-500/80 font-medium">{status.reasons.join(', ')}</span>
                                                    ) : token.isCustom ? (
                                                        <span className="text-amber-500 font-medium">Imported token</span>
                                                    ) : status.contractAddress ? (
                                                        <span className="flex flex-col gap-0.5 min-w-0">
                                                            <span className="truncate">{tokenName}</span>
                                                            {status.contractUrl ? (
                                                                <a
                                                                    href={status.contractUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
                                                                >
                                                                    <span>{status.contractAddress}</span>
                                                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                                                </a>
                                                            ) : (
                                                                <span>{status.contractAddress}</span>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <>
                                                            <span className="truncate">{tokenName}</span>
                                                            {rate !== undefined && status.amount && (
                                                                <>
                                                                    <span className="text-slate-300 dark:text-slate-700">•</span>
                                                                    <span className="font-medium text-slate-400">{formatAPY(rate * 100)} APY</span>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-y-1 shrink-0 text-right min-w-0">
                                            {status.amount ? (
                                                <>
                                                    <div className="font-bold text-slate-900 dark:text-white leading-tight">
                                                        {status.amount}
                                                    </div>
                                                    {status.amountUSD && (
                                                        <div className="text-xs text-slate-500 font-medium leading-tight">
                                                            {status.amountUSD}
                                                        </div>
                                                    )}
                                                </>
                                            ) : !status.hideRate && (
                                                rate !== undefined && (
                                                    <>
                                                        <div className="font-bold text-slate-700 dark:text-slate-300 leading-tight">
                                                            {formatAPY(rate * 100)}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 uppercase leading-none font-medium">APY</div>
                                                    </>
                                                )
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
