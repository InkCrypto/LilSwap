import { Search } from 'lucide-react';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getTokenLogo } from '@/utils/get-token-logo';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOKEN_ROW_HEIGHT = 68;
const TOKEN_ROW_OVERSCAN = 8;
const TOKEN_LIST_BOTTOM_PADDING = 0;

// Popular token symbols shown as quick-select pills per chain
const POPULAR_SYMBOLS: Record<number, string[]> = {
    1: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'WETH'],
    10: ['ETH', 'USDC', 'USDT', 'DAI', 'OP', 'WETH'],
    56: ['BNB', 'USDC', 'USDT', 'DAI', 'BTCB', 'ETH', 'WBNB'],
    100: ['XDAI', 'USDC', 'USDT', 'WETH', 'WXDAI'],
    130: ['ETH', 'USDC', 'USDT', 'WETH'],
    137: ['POL', 'USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'WMATIC'],
    146: ['S', 'USDC', 'USDT', 'WETH'],
    8453: ['ETH', 'USDC', 'DAI', 'CBETH', 'WETH'],
    42161: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'ARB', 'WETH'],
    43114: ['AVAX', 'USDC', 'USDT', 'DAI', 'BTC.B', 'ETH', 'WAVAX'],
};
// ---------------------------------------------------------------------------
// Network definitions — exported so SpotSwapCard can reference them
// ---------------------------------------------------------------------------
export interface NetworkInfo {
    chainId: number;
    label: string;
    icon: string;
}
export const SPOT_NETWORKS: NetworkInfo[] = [
    { chainId: 1, label: 'Ethereum', icon: '/icons/networks/ethereum.svg' },
    { chainId: 56, label: 'BNB', icon: '/icons/networks/binance.svg' },
    { chainId: 137, label: 'Polygon', icon: '/icons/networks/polygon.svg' },
    { chainId: 8453, label: 'Base', icon: '/icons/networks/base.svg' },
    { chainId: 42161, label: 'Arbitrum', icon: '/icons/networks/arbitrum.svg' },
    { chainId: 43114, label: 'Avalanche', icon: '/icons/networks/avalanche.svg' },
    { chainId: 10, label: 'Optimism', icon: '/icons/networks/optimism.svg' },
    { chainId: 100, label: 'Gnosis', icon: '/icons/networks/gnosis.svg' },
    { chainId: 130, label: 'Unichain', icon: '' },
];
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SpotToken {
    symbol: string;
    name?: string;
    address?: string;
    decimals?: number;
    logo?: string | null;
    balance?: string;
    isCustom?: boolean;
}
export interface SpotTokenSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (token: SpotToken, chainId: number) => void;
    /** Token list already filtered to the active chain by the parent */
    tokens: SpotToken[];
    tokensLoading: boolean;
    /** Chain id of the tokens being shown — forwarded to onSelect */
    chainId: number;
    /** Network name shown in the dialog subtitle */
    networkLabel?: string;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getSelectorTokenLogo = (token: SpotToken) => {
    const symbol = String(token.symbol || '').toUpperCase();
    const logoURI = String(token.logo || '');
    const isGenericRemoteLogo = /paraswap\.io\/token\/token\.png/i.test(logoURI);
    // 1. Velora HTTPS icon
    if (logoURI && !isGenericRemoteLogo && logoURI.startsWith('http') && !logoURI.startsWith('ipfs')) return logoURI;
    // 2. Local SVG icon (via alias mapping or lowercase symbol)
    return getTokenLogo(token.symbol);
};
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const SpotTokenSelector: React.FC<SpotTokenSelectorProps> = ({
    isOpen,
    onClose,
    onSelect,
    tokens = [],
    tokensLoading,
    chainId,
    networkLabel,
}) => {
    const [search, setSearch] = useState('');
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(360);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const updateViewportHeight = useCallback(() => {
        const next = scrollContainerRef.current?.clientHeight;
        if (next) setViewportHeight(next);
    }, []);
    useEffect(() => {
        if (isOpen) {
            setSearch('');
            setScrollTop(0);
        }
    }, [isOpen]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            setScrollTop(0);
            scrollContainerRef.current?.scrollTo({ top: 0 });
            updateViewportHeight();
        });
        return () => cancelAnimationFrame(frame);
    }, [search, isOpen, updateViewportHeight]);
    const handleClose = () => {
        setSearch('');
        setScrollTop(0);
        onClose();
    };
    const filteredTokens = useMemo(() => {
        if (!search.trim()) {
            // Default: show only popular tokens (curated list, no noise)
            const popular = POPULAR_SYMBOLS[chainId] ?? [];
            return tokens.filter((t) =>
                popular.some((sym) => t.symbol?.toUpperCase() === sym.toUpperCase()),
            );
        }
        // Search: show all matching tokens from full Velora list
        const term = search.toLowerCase();
        return tokens.filter(
            (t) =>
                (t.symbol || '').toLowerCase().includes(term) ||
                (t.name || '').toLowerCase().includes(term) ||
                (t.address || '').toLowerCase().includes(term),
        );
    }, [tokens, search, chainId]);
    const virtualStart = Math.max(0, Math.floor(scrollTop / TOKEN_ROW_HEIGHT) - TOKEN_ROW_OVERSCAN);
    const virtualEnd = Math.min(
        filteredTokens.length,
        Math.ceil((scrollTop + viewportHeight) / TOKEN_ROW_HEIGHT) + TOKEN_ROW_OVERSCAN,
    );
    const visibleTokens = filteredTokens.slice(virtualStart, virtualEnd);
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent
                className="z-100 flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border-border-light bg-white p-0 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                overlayClassName="bg-transparent z-90"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader className="p-4 pb-2">
                    <DialogTitle className="text-lg font-bold">Select a token</DialogTitle>
                    {networkLabel && (
                        <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                            {networkLabel}
                        </DialogDescription>
                    )}
                </DialogHeader>
                <div className="px-4 pb-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <Input
                            placeholder="Search by name or address"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="border-slate-200/60 bg-slate-50 pl-9 transition-colors focus:border-purple-500/50 dark:border-slate-800/60 dark:bg-slate-900/50"
                        />
                    </div>
                </div>
                <div
                    ref={scrollContainerRef}
                    className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-2 focus:outline-none"
                    tabIndex={-1}
                    onScroll={(e) => {
                        setScrollTop(e.currentTarget.scrollTop);
                        setViewportHeight(e.currentTarget.clientHeight || 360);
                    }}
                >
                    {tokensLoading && filteredTokens.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                            Loading tokens...
                        </div>
                    ) : filteredTokens.length === 0 ? (
                        <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-slate-500">
                            <span>No tokens found</span>
                            {search && (
                                <button
                                    onClick={() => setSearch('')}
                                    className="text-xs font-medium text-primary hover:underline"
                                >
                                    Clear search
                                </button>
                            )}
                        </div>
                    ) : (
                        <div
                            className="relative"
                            style={{ height: filteredTokens.length * TOKEN_ROW_HEIGHT + TOKEN_LIST_BOTTOM_PADDING }}
                        >
                            <div
                                className="absolute inset-x-0 top-0 space-y-1"
                                style={{ transform: `translateY(${virtualStart * TOKEN_ROW_HEIGHT}px)` }}
                            >
                                {visibleTokens.map((token) => (
                                    <button
                                        key={token.address ?? token.symbol}
                                        onClick={() => {
                                            onSelect(token, chainId);
                                            handleClose();
                                        }}
                                        className="group flex w-full items-center justify-between rounded-xl p-3 text-left transition-all hover:bg-slate-100/80 active:scale-[0.98] dark:hover:bg-slate-800/80"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/50 bg-slate-100 transition-colors group-hover:border-purple-200 dark:border-slate-700/50 dark:bg-slate-800/50 dark:group-hover:border-purple-800/50">
                                                <img
                                                    src={getSelectorTokenLogo(token)}
                                                    alt={token.symbol}
                                                    className="h-full w-full object-cover"
                                                    onError={(ev) => {
                                                        const t = ev.currentTarget;
                                                        const local = getTokenLogo(token.symbol);
                                                        if (!t.src.includes(local)) { t.src = local; return; }
                                                        t.style.display = 'none';
                                                        const p = t.parentElement;
                                                        if (p && !p.querySelector('[data-fb]')) {
                                                            const s = document.createElement('span');
                                                            s.setAttribute('data-fb', '');
                                                            s.className = 'text-[10px] font-bold text-slate-500 dark:text-slate-400';
                                                            s.textContent = token.symbol?.charAt(0)?.toUpperCase() ?? '?';
                                                            p.appendChild(s);
                                                        }
                                                    }}
                                                />
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-y-0.5">
                                                <div className="truncate font-bold text-slate-900 dark:text-white">
                                                    {token.symbol}
                                                </div>
                                                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                                    {token.name || networkLabel || ''}
                                                </div>
                                            </div>
                                        </div>
                                        {token.balance && (
                                            <div className="shrink-0 text-right text-sm font-medium text-slate-700 dark:text-slate-300">
                                                {token.balance}
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
