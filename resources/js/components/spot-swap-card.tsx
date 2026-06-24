/**
 * LilSwap-native spot swap implementation.
 * Powered by Velora aggregation.
 */

import {
    AlertCircle,
    ArrowRightLeft,
    ArrowUpDown,
    ChevronDown,
    ChevronUp,
    Loader2,
    RefreshCw,
    Settings,
    X,
} from 'lucide-react';
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { formatUnits, parseUnits } from 'viem';
import type { Hex } from 'viem';
import { getConnectorClient } from 'wagmi/actions';
import { sendTransaction, writeContract } from 'viem/actions';
import { useWeb3, wagmiConfig } from '@/contexts/web3-context';
import { useTransactionTracker } from '@/contexts/transaction-tracker-context';
import { buildSpotSwapTx, getSpotAllowance, getSpotBalance, getSpotQuote, getSpotSpender, getSpotTokens } from '@/services/api';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/info-tooltip';
import { SpotTokenSelector, SPOT_NETWORKS } from '@/components/spot-token-selector';
import { calcApprovalAmount } from '@/utils/swap-math';
import { formatCompactNumber, formatCompactToken, formatUSD } from '@/utils/formatters';
import { mapErrorToUserFriendly } from '@/utils/error-mapping';
import { getTokenLogo } from '@/utils/get-token-logo';
import { normalizeDecimalInput } from '@/utils/normalize-decimal-input';
import logger from '@/utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const APPROVAL_BUFFER_BPS = 10;
const DEFAULT_SLIPPAGE_BPS = 50;
const MIN_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 500;
const QUOTE_REFRESH_SECONDS = 30;

// Hardcoded common tokens per chain — shown instantly, zero API calls
const COMMON_TOKENS: Record<number, SpotToken[]> = {
    1: [
        { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8, symbol: 'WBTC', name: 'Wrapped BTC', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
    ],
    10: [
        { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x4200000000000000000000000000000000000042', decimals: 18, symbol: 'OP', name: 'Optimism', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
    ],
    56: [
        { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', decimals: 18, symbol: 'WBNB', name: 'Wrapped BNB', logo: null },
        { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', decimals: 18, symbol: 'BTCB', name: 'Bitcoin BEP2', logo: null },
        { address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'BNB', name: 'BNB', logo: null },
    ],
    100: [
        { address: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', decimals: 18, symbol: 'WXDAI', name: 'Wrapped XDAI', logo: null },
        { address: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x4ecaba5870353805a9f068101a40e0f32ed605c6', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'XDAI', name: 'xDAI', logo: null },
    ],
    130: [
        { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0x078d782b760474a361dda0af3839290b0ef57ad6', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x176211869ca2b568f2a7d4ee941e073a542ee242', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
    ],
    137: [
        { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', decimals: 18, symbol: 'WPOL', name: 'Wrapped POL', logo: null },
        { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', decimals: 8, symbol: 'WBTC', name: 'Wrapped BTC', logo: null },
        { address: '0x0000000000000000000000000000000000001010', decimals: 18, symbol: 'POL', name: 'POL', logo: null },
    ],
    146: [
        { address: '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38', decimals: 18, symbol: 'WS', name: 'Wrapped Sonic', logo: null },
        { address: '0x29219dd400f2bf60e5a23d13be72b486d4038894', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0xe05d4b473c1acb02b9810999e5cb9a37fa7c693c', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0x50c42deacd8fc9779823ad65ffd550b4552e36b3', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'S', name: 'Sonic', logo: null },
    ],
    8453: [
        { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', decimals: 18, symbol: 'CBETH', name: 'Coinbase Wrapped Staked ETH', logo: null },
        { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', decimals: 8, symbol: 'CBBTC', name: 'Coinbase Wrapped BTC', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
    ],
    42161: [
        { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', decimals: 8, symbol: 'WBTC', name: 'Wrapped BTC', logo: null },
        { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', decimals: 18, symbol: 'ARB', name: 'Arbitrum', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'ETH', name: 'Ether', logo: null },
    ],
    43114: [
        { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', decimals: 18, symbol: 'WAVAX', name: 'Wrapped AVAX', logo: null },
        { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null },
        { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', decimals: 6, symbol: 'USDT', name: 'Tether', logo: null },
        { address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70', decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin', logo: null },
        { address: '0x152b9d0fdc40c096757f570a51e494bd4b30e10c', decimals: 8, symbol: 'BTC.B', name: 'Bitcoin', logo: null },
        { address: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: null },
        { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, symbol: 'AVAX', name: 'AVAX', logo: null },
    ],
};

const ERC20_ABI = [
    { type: 'function' as const, name: 'allowance', inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
    { type: 'function' as const, name: 'approve', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
    { type: 'function' as const, name: 'balanceOf', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

const CHAIN_TO_MARKET_KEY: Record<number, string | null> = {
    1: 'AaveV3Ethereum', 56: 'AaveV3BNB', 137: 'AaveV3Polygon',
    8453: 'AaveV3Base', 42161: 'AaveV3Arbitrum', 43114: 'AaveV3Avalanche',
    10: 'AaveV3Optimism', 100: null, 130: null, 146: null,
};

const stableSymbols = new Set(['USDC', 'USDC.E', 'USDT', 'USDT0', 'DAI', 'USDS', 'GHO', 'RLUSD', 'PYUSD', 'FDUSD', 'USDE', 'SUSDE']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpotToken {
    address?: string;
    decimals?: number;
    symbol: string;
    name?: string;
    logo?: string | null;
    balance?: string;
}
interface SpotQuote {
    srcAmount: string;
    destAmount: string;
    srcToken: string;
    destToken: string;
    priceImpact: number | string;
    contractMethod?: string;
    gasCost?: string | null;
    srcDecimals?: number;
    destDecimals?: number;
    feeBps?: number;
    baseFeeBps?: number;
    discountPercent?: number;
    raw?: any;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const isNativeToken = (t: SpotToken | null) => {
    const a = t?.address?.toLowerCase() ?? '';
    return !a || a === NATIVE_TOKEN_ADDRESS || a === '0x0000000000000000000000000000000000000000';
};
const getTokenAddress = (t: SpotToken | null) =>
    isNativeToken(t) ? NATIVE_TOKEN_ADDRESS : (t?.address ?? '').toLowerCase();
const clampSlippage = (v: number) =>
    Number.isFinite(v) ? Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.round(v))) : DEFAULT_SLIPPAGE_BPS;
const parseAmountSafe = (value: string, decimals: number): bigint => {
    const n = value.trim();
    if (!n || n === '.') return 0n;
    const [w, f = ''] = n.split('.');
    return parseUnits(f ? `${w || '0'}.${f.slice(0, decimals)}` : w || '0', decimals);
};
const amountToInputValue = (amount: bigint, decimals: number, maxFrac = 8): string => {
    const [w, f = ''] = formatUnits(amount, decimals).split('.');
    const t = f.slice(0, maxFrac).replace(/0+$/, '');
    return t ? `${w}.${t}` : w;
};
const numberToDecimalInput = (value: number, maxFrac: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '';
    return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: maxFrac })
        .replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
const calcMinAmountOut = (dest: string, slipBps: number) =>
    (BigInt(dest) * BigInt(10000 - slipBps)) / 10000n;
const formatPercent = (v: number) =>
    !Number.isFinite(v) || v <= 0 || v < 0.0001 ? '< 0.01%'
        : `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const getQuoteUsdValue = (q: SpotQuote | null, side: 'src' | 'dest') => {
    const raw = q?.raw ?? q;
    const p = parseFloat(String(side === 'src' ? (raw?.srcUSD ?? raw?.priceRoute?.srcUSD) : (raw?.destUSD ?? raw?.priceRoute?.destUSD)) ?? '');
    return Number.isFinite(p) && p > 0 ? p : null;
};
const formatGasCost = (q: SpotQuote | null): string => {
    const usd = parseFloat(String(q?.raw?.gasCostUSD ?? q?.raw?.gasUSD ?? q?.raw?.priceRoute?.gasCostUSD ?? ''));
    if (Number.isFinite(usd) && usd > 0) return formatUSD(usd);
    if (!q?.gasCost) return '-';
    try {
        const native = parseFloat(formatUnits(BigInt(q.gasCost), 18));
        return Number.isFinite(native) && native > 0 ? `${formatCompactNumber(native)} native` : '-';
    } catch { return '-'; }
};
const quoteSideDecimals = (q: SpotQuote | null, side: 'src' | 'dest', fallback?: number): number => {
    const raw = q?.raw ?? q;
    const value = side === 'src'
        ? raw?.srcDecimals ?? raw?.priceRoute?.srcDecimals
        : raw?.destDecimals ?? raw?.priceRoute?.destDecimals;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : (fallback ?? 18);
};

const formatQuoteUnits = (amount: string | bigint, q: SpotQuote | null, side: 'src' | 'dest', fallbackDecimals?: number): string =>
    formatUnits(BigInt(amount), quoteSideDecimals(q, side, fallbackDecimals));
const getSpotTokenLogoSrc = (token: SpotToken | null): string => {
    if (!token) return '';
    const uri = String(token.logo || '');
    const isGeneric = /paraswap\.io\/token\/token\.png/i.test(uri);
    // 1. Velora HTTPS icon
    if (uri && !isGeneric && uri.startsWith('http') && !uri.startsWith('ipfs')) return uri;
    // 2. Local SVG icon
    return getTokenLogo(token.symbol);
};

// ---------------------------------------------------------------------------
// TokenBadge
// ---------------------------------------------------------------------------

interface TokenBadgeProps {
    token: SpotToken | null;
    networkIcon?: string;
    networkLabel?: string;
    onClick: () => void;
    disabled?: boolean;
}
const TokenBadge: React.FC<TokenBadgeProps> = ({ token, networkIcon, networkLabel, onClick, disabled }) => {
    const [imgError, setImgError] = useState<'local' | 'cdn' | null>(null);
    const src = (() => {
        if (imgError === 'cdn') return null;
        const base = getSpotTokenLogoSrc(token);
        if (imgError === 'local' && token) {
            return `https://app.aave.com/icons/tokens/${token.symbol.toLowerCase().replace(/-/g, '_')}.svg`;
        }
        return base;
    })();
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`flex shrink-0 items-center gap-1.5 py-1 pl-1 pr-2 transition-all hover:opacity-75 active:scale-95 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
            {token?.symbol ? (
                <div className="relative h-7 w-7 shrink-0">
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-border-light bg-slate-100 dark:border-slate-600/30 dark:bg-slate-700/50">
                        {src ? (
                            <img src={src} alt={token.symbol} className="h-full w-full object-cover"
                                onError={() => setImgError(imgError === null ? 'local' : 'cdn')}
                            />
                        ) : (
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                {token.symbol.charAt(0).toUpperCase()}
                            </span>
                        )}
                    </div>
                    {networkLabel && (
                        <span className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-full border-2 border-slate-100 bg-slate-200 text-[7px] font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-200" title={networkLabel}>
                            {networkIcon
                                ? <img src={networkIcon} alt={networkLabel} className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                : networkLabel.charAt(0)}
                        </span>
                    )}
                </div>
            ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-700/50">
                    <span className="text-[10px] font-bold text-slate-400">?</span>
                </div>
            )}
            <span className="text-lg font-bold leading-none text-slate-900 dark:text-white">
                {token?.symbol ?? 'Select'}
            </span>
            <ChevronDown className="h-5 w-5 text-slate-400" />
        </button>
    );
};

// ---------------------------------------------------------------------------
// ChainDropdown — borderless, matches token badge style
// ---------------------------------------------------------------------------

interface ChainDropdownProps {
    selectedChainId: number;
    onChange: (chainId: number) => void;
    disabled?: boolean;
}
const ChainDropdown: React.FC<ChainDropdownProps> = ({ selectedChainId, onChange, disabled }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const net = SPOT_NETWORKS.find((n) => n.chainId === selectedChainId);

    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-sm font-bold text-slate-700 transition-all hover:opacity-75 disabled:opacity-50 dark:text-slate-200"
            >
                {net?.icon ? (
                    <img src={net.icon} alt={net.label} className="h-5 w-5 rounded-full"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {net?.label?.charAt(0) ?? '?'}
                    </span>
                )}
                {net?.label ?? 'Network'}
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-2 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    {SPOT_NETWORKS.map((network) => {
                        const isActive = network.chainId === selectedChainId;
                        return (
                            <button
                                key={network.chainId}
                                type="button"
                                onClick={() => { onChange(network.chainId); setOpen(false); }}
                                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors ${isActive ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                                    }`}
                            >
                                {network.icon ? (
                                    <img src={network.icon} alt={network.label} className="h-5 w-5 rounded-full"
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                                        {network.label.charAt(0)}
                                    </span>
                                )}
                                {network.label}
                                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-purple-500" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SpotSwapCard() {
    const { account, chainId, isConnected, isSettlingAccount, connectWallet, walletClient, publicClient } = useWeb3();
    const { addTransaction } = useTransactionTracker();

    const [selectedChainId, setSelectedChainId] = useState<number>(() =>
        SPOT_NETWORKS.some((n) => n.chainId === chainId) ? Number(chainId) : 1,
    );
    const [fromToken, setFromToken] = useState<SpotToken | null>(null);
    const [toToken, setToToken] = useState<SpotToken | null>(null);
    const [fromAmount, setFromAmount] = useState('');
    const [veloraTokens, setVeloraTokens] = useState<SpotToken[] | null>(null);
    const [veloraLoading, setVeloraLoading] = useState(false);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [selectorMode, setSelectorMode] = useState<'from' | 'to'>('from');
    const [isUSDMode, setIsUSDMode] = useState(false);
    const [tokenUsdPrices, setTokenUsdPrices] = useState<Record<string, number>>({});
    const [fromBalance, setFromBalance] = useState<bigint>(0n);
    const [toBalance, setToBalance] = useState<bigint>(0n);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [quote, setQuote] = useState<SpotQuote | null>(null);
    const [quoteChainId, setQuoteChainId] = useState<number | null>(null);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [nextRefreshIn, setNextRefreshIn] = useState(QUOTE_REFRESH_SECONDS);
    const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
    const [slippageInput, setSlippageInput] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString());
    const [showSlippageSettings, setShowSlippageSettings] = useState(false);
    const [showOverview, setShowOverview] = useState(true);
    const [showCostsBreakdown, setShowCostsBreakdown] = useState(false);
    const [invertRate, setInvertRate] = useState(false);
    const [approvalRequired, setApprovalRequired] = useState(false);
    const [approvalPending, setApprovalPending] = useState(false);
    const [allowanceNonce, setAllowanceNonce] = useState(0);
    const [buildLoading, setBuildLoading] = useState(false);
    const [spender, setSpender] = useState<string | null>(null);
    const [spenderChainId, setSpenderChainId] = useState<number | null>(null);
    const [txPending, setTxPending] = useState(false);
    const [switchingNetwork, setSwitchingNetwork] = useState(false);
    const [pctMenuOpen, setPctMenuOpen] = useState(false);
    const [walletResetting, setWalletResetting] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quoteLockedRef = useRef(false);
    const slippageMenuRef = useRef<HTMLDivElement>(null);
    const pctMenuRef = useRef<HTMLDivElement>(null);
    const lastWalletKeyRef = useRef<string | null>(account?.toLowerCase() ?? null);

    // Tokens shown in the selector: hardcoded common list by default, Velora results when searching
    const selectorTokens = veloraTokens ?? (COMMON_TOKENS[selectedChainId] ?? []);
    const selectorLoading = veloraLoading && veloraTokens === null;

    const activeNetwork = SPOT_NETWORKS.find((n) => n.chainId === selectedChainId);
    const walletOnSelectedChain = !isConnected || chainId === selectedChainId;
    const walletKey = account?.toLowerCase() ?? null;
    const walletChanging = isSettlingAccount || walletResetting || lastWalletKeyRef.current !== walletKey;
    const activeSpender = spenderChainId === selectedChainId ? spender : null;
    const activeQuote = quoteChainId === selectedChainId ? quote : null;
    const executionBusy = approvalPending || buildLoading || txPending || walletChanging;

    useEffect(() => {
        if (lastWalletKeyRef.current === walletKey) return;

        abortRef.current?.abort();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        quoteLockedRef.current = false;
        lastWalletKeyRef.current = walletKey;

        setWalletResetting(true);
        setFromAmount('');
        setQuote(null);
        setQuoteChainId(null);
        setQuoteError(null);
        setFromBalance(0n);
        setToBalance(0n);
        setBalanceLoading(false);
        setApprovalRequired(false);
        setApprovalPending(false);
        setBuildLoading(false);
        setTxPending(false);
        setPctMenuOpen(false);
        setShowCostsBreakdown(false);
        setNextRefreshIn(QUOTE_REFRESH_SECONDS);
        setAllowanceNonce((current) => current + 1);

        const timeout = setTimeout(() => setWalletResetting(false), 600);
        return () => clearTimeout(timeout);
    }, [walletKey]);
    // USD prices
    const fromTokenPrice = useMemo(() => {
        if (!fromToken) return 0;
        return tokenUsdPrices[`${selectedChainId}:${getTokenAddress(fromToken)}`]
            || (stableSymbols.has(fromToken.symbol.toUpperCase()) ? 1 : 0);
    }, [fromToken, selectedChainId, tokenUsdPrices]);

    const toTokenPrice = useMemo(() => {
        if (!toToken) return 0;
        return tokenUsdPrices[`${selectedChainId}:${getTokenAddress(toToken)}`]
            || (stableSymbols.has(toToken.symbol.toUpperCase()) ? 1 : 0);
    }, [toToken, selectedChainId, tokenUsdPrices]);

    // Amount parsing
    const fromAmountWei = useMemo(() => {
        if (!fromToken || !fromAmount) return 0n;
        try {
            if (isUSDMode) {
                const usd = parseFloat(fromAmount || '0');
                if (fromTokenPrice <= 0 || !Number.isFinite(usd) || usd <= 0) return 0n;
                return parseAmountSafe(numberToDecimalInput(usd / fromTokenPrice, fromToken.decimals ?? 18), fromToken.decimals ?? 18);
            }
            return parseAmountSafe(fromAmount, fromToken.decimals ?? 18);
        } catch { return 0n; }
    }, [fromAmount, fromToken, fromTokenPrice, isUSDMode]);

    const fromTokenInputValue = useMemo(() =>
        fromToken && fromAmountWei > 0n ? amountToInputValue(fromAmountWei, fromToken.decimals ?? 18, 8) : '',
        [fromAmountWei, fromToken]);

    const hasInsufficientBalance = Boolean(isConnected && fromToken && fromAmountWei > fromBalance);

    // Fetch Velora tokens when user searches in the token selector
    const handleSearchChange = useCallback(async (query: string) => {
        if (!query.trim()) {
            setVeloraTokens(null);
            return;
        }
        setVeloraLoading(true);
        try {
            const data = await getSpotTokens(selectedChainId);
            const mapped = (data.tokens ?? []).map((t: any) => ({
                address: t.address?.toLowerCase() ?? '',
                decimals: t.decimals ?? 18,
                symbol: t.symbol ?? '',
                name: t.name ?? '',
                logo: t.logo ?? null,
            }));
            setVeloraTokens(mapped);
        } catch {
            setVeloraTokens([]);
        } finally {
            setVeloraLoading(false);
        }
    }, [selectedChainId]);

    // Default USDC on load (from hardcoded common tokens — no API call)
    useEffect(() => {
        if (fromToken || toToken) return;
        const common = COMMON_TOKENS[selectedChainId] ?? [];
        if (!common.length) return;
        const usdc = common.find((t) => t.symbol.toUpperCase() === 'USDC')
            ?? common.find((t) => t.symbol.toUpperCase() === 'USDC.E')
            ?? common.find((t) => t.symbol.toUpperCase().includes('USDC'));
        if (!usdc) return;
        setFromToken(usdc);
    }, [fromToken, selectedChainId, toToken]);

    // From balance — fetches via engine API (uses premium RPCs)
    useEffect(() => {
        if (!account || !fromToken) { setFromBalance(0n); setBalanceLoading(false); return; }
        let cancelled = false;
        setBalanceLoading(true);
        (async () => {
            try {
                const data = await getSpotBalance({
                    chainId: selectedChainId,
                    tokenAddress: isNativeToken(fromToken) ? null : (fromToken.address ?? null),
                    walletAddress: account,
                });
                if (!cancelled) setFromBalance(BigInt(data.balance));
            } catch { if (!cancelled) setFromBalance(0n); }
            finally { if (!cancelled) setBalanceLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [account, fromToken, chainId, selectedChainId, allowanceNonce]);

    // To balance — fetches via engine API (uses premium RPCs)
    useEffect(() => {
        if (!account || !toToken) { setToBalance(0n); return; }
        let cancelled = false;
        (async () => {
            try {
                const data = await getSpotBalance({
                    chainId: selectedChainId,
                    tokenAddress: isNativeToken(toToken) ? null : (toToken.address ?? null),
                    walletAddress: account,
                });
                if (!cancelled) setToBalance(BigInt(data.balance));
            } catch { if (!cancelled) setToBalance(0n); }
        })();
        return () => { cancelled = true; };
    }, [account, toToken, chainId, selectedChainId, allowanceNonce]);

    // Update USD prices from quote
    const updatePricesFromQuote = useCallback((q: SpotQuote) => {
        const updates: Record<string, number> = {};
        try {
            const srcUsd = getQuoteUsdValue(q, 'src');
            const destUsd = getQuoteUsdValue(q, 'dest');
            if (fromToken && srcUsd && BigInt(q.srcAmount) > 0n) {
                const h = parseFloat(formatQuoteUnits(q.srcAmount, q, 'src', fromToken.decimals ?? 18));
                if (h > 0) updates[`${selectedChainId}:${getTokenAddress(fromToken)}`] = srcUsd / h;
            }
            if (toToken && destUsd && BigInt(q.destAmount) > 0n) {
                const h = parseFloat(formatQuoteUnits(q.destAmount, q, 'dest', toToken.decimals ?? 18));
                if (h > 0) updates[`${selectedChainId}:${getTokenAddress(toToken)}`] = destUsd / h;
            }
        } catch { return; }
        if (Object.keys(updates).length) setTokenUsdPrices((prev) => ({ ...prev, ...updates }));
    }, [fromToken, selectedChainId, toToken]);

    // Quote fetch
    const fetchQuote = useCallback(async (force = false) => {
        if (quoteLockedRef.current && !force) return;
        if (!fromToken || !toToken || fromAmountWei <= 0n) {
            setQuote(null); setQuoteChainId(null); setQuoteLoading(false); setQuoteError(null); return;
        }
        if (getTokenAddress(fromToken) === getTokenAddress(toToken)) {
            setQuote(null); setQuoteChainId(null); setQuoteError('Choose two different tokens.'); return;
        }
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setQuoteLoading(true); setQuoteError(null);
        try {
            const data = await getSpotQuote({
                chainId: selectedChainId,
                fromToken: { address: getTokenAddress(fromToken), decimals: fromToken.decimals ?? 18, symbol: fromToken.symbol },
                toToken: { address: getTokenAddress(toToken), decimals: toToken.decimals ?? 18, symbol: toToken.symbol },
                fromAmount: fromAmountWei.toString(),
                userAddress: account ?? undefined,
                slippageBps,
            }, ctrl.signal);
            if (ctrl.signal.aborted) return;
            const q = data.quote ?? data;
            setQuote(q); setQuoteChainId(selectedChainId); setQuoteLoading(false); setNextRefreshIn(QUOTE_REFRESH_SECONDS);
            updatePricesFromQuote(q);
        } catch (err: any) {
            if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
            if (!ctrl.signal.aborted) {
                setQuote(null);
                setQuoteChainId(null);
                setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Failed to fetch quote');
                setQuoteLoading(false);
            }
        }
    }, [account, fromAmountWei, fromToken, selectedChainId, slippageBps, toToken, updatePricesFromQuote]);

    // Stabilize fetchQuote reference via ref to avoid useEffect dep array size mismatches
    const fetchQuoteRef = useRef(fetchQuote);
    fetchQuoteRef.current = fetchQuote;

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (fromToken && toToken && fromAmountWei > 0n) {
            debounceRef.current = setTimeout(() => void fetchQuoteRef.current(true), 500);
        } else {
            setQuote(null);
            setQuoteChainId(null);
            setQuoteError(null);
        }
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [fromToken, toToken, fromAmountWei]);

    useEffect(() => {
        if (!activeQuote || quoteLoading || executionBusy) return;
        const t = setInterval(() => setNextRefreshIn((c) => { if (c <= 1) { void fetchQuoteRef.current(true); return QUOTE_REFRESH_SECONDS; } return c - 1; }), 1000);
        return () => clearInterval(t);
    }, [activeQuote, quoteLoading, executionBusy]);

    useEffect(() => { quoteLockedRef.current = executionBusy; }, [executionBusy]);
    // Fetch spender address dynamically from the engine when chain changes
    useEffect(() => {
        let cancelled = false;
        setSpender(null);
        setSpenderChainId(null);
        (async () => {
            try {
                const { address } = await getSpotSpender(selectedChainId);
                if (!cancelled) { setSpender(address); setSpenderChainId(selectedChainId); }
            } catch (err) {
                logger.warn('[SpotSwap] Failed to fetch spender address', err);
                if (!cancelled) { setSpender(null); setSpenderChainId(null); }
            }
        })();
        return () => { cancelled = true; };
    }, [selectedChainId]);

    useEffect(() => () => { abortRef.current?.abort(); }, []);

    // Allowance check — uses premium RPCs via backend proxy
    useEffect(() => {
        if (!fromToken || !account || !activeSpender || isNativeToken(fromToken) || chainId !== selectedChainId || fromAmountWei <= 0n || !fromToken.address) {
            setApprovalRequired(false); return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { allowance } = await getSpotAllowance({
                    chainId: selectedChainId,
                    tokenAddress: fromToken.address!,
                    owner: account,
                    spender: activeSpender,
                });
                if (!cancelled) setApprovalRequired(BigInt(allowance) < fromAmountWei);
            } catch { if (!cancelled) setApprovalRequired(false); }
        })();
        return () => { cancelled = true; };
    }, [fromToken, account, fromAmountWei, chainId, selectedChainId, allowanceNonce, activeSpender]);

    // Click-outside for slippage menu
    useEffect(() => {
        if (!showSlippageSettings) return;
        const h = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (!slippageMenuRef.current?.contains(t) && !t.closest('[data-spot-slippage-toggle]'))
                setShowSlippageSettings(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [showSlippageSettings]);

    // Click-outside for % menu
    useEffect(() => {
        if (!pctMenuOpen) return;
        const h = (e: MouseEvent) => { if (!pctMenuRef.current?.contains(e.target as Node)) setPctMenuOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [pctMenuOpen]);

    // -----------------------------------------------------------------------
    // Handlers
    // -----------------------------------------------------------------------

    const resetForNetwork = (id: number) => {
        setSelectedChainId(id); setFromToken(null); setToToken(null);
        setFromAmount(''); setQuote(null); setQuoteChainId(null); setQuoteError(null);
        setApprovalRequired(false); setFromBalance(0n); setToBalance(0n);
    };
    const handleNetworkChange = async (id: number) => {
        if (id === selectedChainId) return;
        resetForNetwork(id);
        // Auto-switch wallet to the selected chain if connected + not already there
        if (isConnected && walletClient && id !== chainId) {
            setSwitchingNetwork(true);
            try {
                if (typeof walletClient.switchChain === 'function') {
                    await walletClient.switchChain({ id });
                }
            } catch (err: any) {
                setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Unable to switch network');
            } finally {
                setSwitchingNetwork(false);
            }
        }
    };
    const openSelector = (mode: 'from' | 'to') => { setSelectorMode(mode); setSelectorOpen(true); };

    const handleTokenSelect = (selected: SpotToken, tokenChainId: number) => {
        if (tokenChainId !== selectedChainId) resetForNetwork(tokenChainId);
        const token: SpotToken = { address: selected.address?.toLowerCase() ?? '', decimals: selected.decimals ?? 18, symbol: selected.symbol ?? '', name: selected.name ?? '', logo: selected.logo ?? null };
        const curFrom = tokenChainId === selectedChainId ? fromToken : null;
        const curTo = tokenChainId === selectedChainId ? toToken : null;
        if (selectorMode === 'from') {
            if (curTo && getTokenAddress(curTo) === getTokenAddress(token)) { setFromToken(curTo); setToToken(curFrom); }
            else setFromToken(token);
        } else {
            if (curFrom && getTokenAddress(curFrom) === getTokenAddress(token)) { setToToken(curFrom); setFromToken(curTo); }
            else setToToken(token);
        }
        setSelectorOpen(false);
    };

    const applyAmount = (amount: bigint) => {
        if (!fromToken) return;
        if (isUSDMode) {
            if (fromTokenPrice <= 0) return;
            setFromAmount(numberToDecimalInput(parseFloat(formatUnits(amount, fromToken.decimals ?? 18)) * fromTokenPrice, 2));
        } else setFromAmount(amountToInputValue(amount, fromToken.decimals ?? 18, fromToken.decimals ?? 18));
    };
    const applyMax = () => { if (fromBalance > 0n) applyAmount(fromBalance); };
    const applyPct = (pct: number) => { if (fromBalance > 0n) applyAmount((fromBalance * BigInt(pct)) / 100n); };
    const toggleUSDMode = () => {
        if (!fromToken) { setIsUSDMode((v) => !v); return; }
        if (isUSDMode) { setFromAmount(fromTokenInputValue); setIsUSDMode(false); return; }
        if (fromTokenPrice > 0 && fromAmountWei > 0n)
            setFromAmount(numberToDecimalInput(parseFloat(formatUnits(fromAmountWei, fromToken.decimals ?? 18)) * fromTokenPrice, 2));
        setIsUSDMode(true);
    };
    const updateSlippage = (v: string) => {
        setSlippageInput(v);
        const p = parseFloat(v || '0');
        if (Number.isFinite(p)) setSlippageBps(clampSlippage(p * 100));
    };

    const readWalletChainId = useCallback(async (): Promise<number | null> => {
        if (!walletClient) return chainId ?? null;
        try {
            if (typeof walletClient.getChainId === 'function') {
                return Number(await walletClient.getChainId());
            }
            if (typeof walletClient.request === 'function') {
                const raw = await walletClient.request({ method: 'eth_chainId' });
                return typeof raw === 'string' ? Number.parseInt(raw, 16) : Number(raw);
            }
        } catch {
            return chainId ?? null;
        }
        return chainId ?? null;
    }, [chainId, walletClient]);

    const ensureWalletOnSelectedChain = useCallback(async () => {
        if (!walletClient) throw new Error('Connect your wallet to continue.');

        const targetChainId = selectedChainId;
        const targetLabel = activeNetwork?.label ?? 'the selected network';
        let currentChainId = await readWalletChainId();
        if (currentChainId === targetChainId) return;

        if (typeof walletClient.switchChain !== 'function') {
            throw new Error(`Please switch your wallet to ${targetLabel} to continue.`);
        }

        await walletClient.switchChain({ id: targetChainId });

        for (let attempt = 0; attempt < 12; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            currentChainId = await readWalletChainId();
            if (currentChainId === targetChainId) return;
        }

        throw new Error(`Please switch your wallet to ${targetLabel} to continue.`);
    }, [activeNetwork?.label, readWalletChainId, selectedChainId, walletClient]);

    const getActiveWalletClient = useCallback(async () => {
        if (!account) throw new Error('Connect your wallet to continue.');
        await ensureWalletOnSelectedChain();
        return getConnectorClient(wagmiConfig, {
            account: account as Hex,
            chainId: selectedChainId as any,
        });
    }, [account, ensureWalletOnSelectedChain, selectedChainId]);
    const handleSwitchWalletNetwork = async () => {
        if (!walletClient || chainId === selectedChainId) return;
        setSwitchingNetwork(true);
        try {
            await ensureWalletOnSelectedChain();
        } catch (err: any) {
            setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Unable to switch network');
        } finally { setSwitchingNetwork(false); }
    };

    const handleApprove = async () => {
        if (!account || !fromToken || !walletClient || !activeSpender || fromAmountWei <= 0n) return;
        setApprovalPending(true); setQuoteError(null);
        try {
            const activeWalletClient = await getActiveWalletClient();
            const hash = await writeContract(activeWalletClient, {
                address: fromToken.address as Hex, abi: ERC20_ABI, functionName: 'approve',
                args: [activeSpender as Hex, calcApprovalAmount(fromAmountWei, APPROVAL_BUFFER_BPS)],
                account: account as Hex,
            });
            const mKey = CHAIN_TO_MARKET_KEY[selectedChainId];
            if (mKey) addTransaction({ hash, chainId: selectedChainId, description: `Approve ${fromToken.symbol}`, marketKey: mKey, fromTokenSymbol: fromToken.symbol, suppressPositionRefresh: true });
            const receipt = publicClient ? await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }) : null;
            if (receipt?.status !== 'success') throw new Error('Approval transaction reverted');
            setAllowanceNonce((c) => c + 1); setApprovalRequired(false);
        } catch (err: any) {
            logger.error('[SpotSwap] Approval failed', err);
            setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Approval failed');
        } finally { setApprovalPending(false); }
    };

    const handleSwap = async () => {
        if (!account || !fromToken || !toToken || !activeQuote || !walletClient || fromAmountWei <= 0n) return;
        setBuildLoading(true); setQuoteError(null); quoteLockedRef.current = true;
        try {
            const activeWalletClient = await getActiveWalletClient();
            const data = await buildSpotSwapTx({
                chainId: selectedChainId,
                fromToken: { address: getTokenAddress(fromToken), decimals: fromToken.decimals ?? 18, symbol: fromToken.symbol },
                toToken: { address: getTokenAddress(toToken), decimals: toToken.decimals ?? 18, symbol: toToken.symbol },
                fromAmount: fromAmountWei.toString(), toAmount: activeQuote.destAmount,
                userAddress: account, slippageBps, priceRoute: activeQuote.raw ?? activeQuote,
            });
            const { to, data: txData, value } = data.tx ?? data;
            setBuildLoading(false); setTxPending(true);
            const hash = await sendTransaction(activeWalletClient, { to: to as Hex, data: txData as Hex, value: value ? BigInt(value) : 0n, account: account as Hex, chainId: selectedChainId });
            const mKey = CHAIN_TO_MARKET_KEY[selectedChainId];
            if (mKey) addTransaction({ hash, chainId: selectedChainId, description: `Swap ${fromToken.symbol} to ${toToken.symbol}`, marketKey: mKey, fromTokenSymbol: fromToken.symbol, toTokenSymbol: toToken.symbol });
            setFromAmount(''); setQuote(null); setQuoteChainId(null); setAllowanceNonce((c) => c + 1);
            logger.info('[SpotSwap] Transaction sent', { hash });
        } catch (err: any) {
            logger.error('[SpotSwap] Swap failed', err);
            setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Transaction failed');
        } finally { setBuildLoading(false); setTxPending(false); quoteLockedRef.current = false; }
    };

    // Single-click swap: auto-switches network, approves if needed, then sends swap
    const handleSwapWithAutoApprove = useCallback(async () => {
        if (!account || !fromToken || !toToken || !activeQuote || !walletClient || !publicClient || !activeSpender || fromAmountWei <= 0n) return;
        setQuoteError(null);
        quoteLockedRef.current = true;

        try {
            // Step 0: Make sure the provider itself is on the target chain before approve/swap.
            const activeWalletClient = await getActiveWalletClient();

            // Step 1: Check allowance via premium RPCs (don't rely on stale approvalRequired state)
            const needsApproval = !isNativeToken(fromToken) && fromToken.address && (async () => {
                try {
                    const { allowance } = await getSpotAllowance({
                        chainId: selectedChainId,
                        tokenAddress: fromToken.address!,
                        owner: account,
                        spender: activeSpender,
                    });
                    return BigInt(allowance) < fromAmountWei;
                } catch {
                    return true; // If we can't read allowance, assume it's needed
                }
            })();

            if (await needsApproval) {
                setApprovalPending(true);
                logger.info('[SpotSwap] Auto-approving before swap');
                const hash = await writeContract(activeWalletClient, {
                    address: fromToken.address as Hex, abi: ERC20_ABI, functionName: 'approve',
                    args: [activeSpender as Hex, calcApprovalAmount(fromAmountWei, APPROVAL_BUFFER_BPS)],
                    account: account as Hex,
                });
                const mKey = CHAIN_TO_MARKET_KEY[selectedChainId];
                if (mKey) addTransaction({ hash, chainId: selectedChainId, description: `Approve ${fromToken.symbol}`, marketKey: mKey, fromTokenSymbol: fromToken.symbol, suppressPositionRefresh: true });
                const receipt = publicClient ? await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }) : null;
                if (receipt?.status !== 'success') throw new Error('Approval transaction reverted');
                setAllowanceNonce((c) => c + 1);
                setApprovalPending(false);
            }

            // Step 2: Build and send swap
            setBuildLoading(true);
            const data = await buildSpotSwapTx({
                chainId: selectedChainId,
                fromToken: { address: getTokenAddress(fromToken), decimals: fromToken.decimals ?? 18, symbol: fromToken.symbol },
                toToken: { address: getTokenAddress(toToken), decimals: toToken.decimals ?? 18, symbol: toToken.symbol },
                fromAmount: fromAmountWei.toString(), toAmount: activeQuote.destAmount,
                userAddress: account, slippageBps, priceRoute: activeQuote.raw ?? activeQuote,
            });
            const { to, data: txData, value } = data.tx ?? data;
            setBuildLoading(false); setTxPending(true);
            const swapHash = await sendTransaction(activeWalletClient, { to: to as Hex, data: txData as Hex, value: value ? BigInt(value) : 0n, account: account as Hex, chainId: selectedChainId });
            const swapMKey = CHAIN_TO_MARKET_KEY[selectedChainId];
            if (swapMKey) addTransaction({ hash: swapHash, chainId: selectedChainId, description: `Swap ${fromToken.symbol} to ${toToken.symbol}`, marketKey: swapMKey, fromTokenSymbol: fromToken.symbol, toTokenSymbol: toToken.symbol });
            setFromAmount(''); setQuote(null); setQuoteChainId(null); setAllowanceNonce((c) => c + 1);
            logger.info('[SpotSwap] Swap sent', { hash: swapHash });
        } catch (err: any) {
            logger.error('[SpotSwap] Swap failed', err);
            setQuoteError(mapErrorToUserFriendly(err?.message) || err?.message || 'Transaction failed');
        } finally { setApprovalPending(false); setBuildLoading(false); setTxPending(false); quoteLockedRef.current = false; }
    }, [account, fromToken, toToken, activeQuote, walletClient, publicClient, activeSpender, fromAmountWei, selectedChainId, slippageBps, getActiveWalletClient]);

    // -----------------------------------------------------------------------
    // Derived display values
    // -----------------------------------------------------------------------

    const minAmountOut = useMemo(() =>
        activeQuote?.destAmount && toToken ? calcMinAmountOut(activeQuote.destAmount, slippageBps) : null,
        [activeQuote?.destAmount, slippageBps, toToken]);

    const quoteSrcDecimals = activeQuote && fromToken ? quoteSideDecimals(activeQuote, 'src', fromToken.decimals ?? 18) : (fromToken?.decimals ?? 18);
    const quoteDestDecimals = activeQuote && toToken ? quoteSideDecimals(activeQuote, 'dest', toToken.decimals ?? 18) : (toToken?.decimals ?? 18);

    const outputValue = useMemo(() => {
        if (!activeQuote?.destAmount || !toToken) return '';
        if (isUSDMode) {
            const amt = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
            const num = toTokenPrice > 0 ? numberToDecimalInput(amt * toTokenPrice, 2) : '';
            return num ? `$${num}` : '';
        }
        return amountToInputValue(BigInt(activeQuote.destAmount), quoteDestDecimals, 8);
    }, [activeQuote?.destAmount, quoteDestDecimals, toToken, isUSDMode, toTokenPrice]);

    const fromSecondaryValue = useMemo(() => {
        if (!fromToken) return null;
        if (isUSDMode) return fromAmountWei > 0n ? formatCompactToken(fromTokenInputValue || '0', fromToken.symbol) : `0 ${fromToken.symbol}`;
        return fromTokenPrice > 0 ? formatUSD(parseFloat(formatUnits(fromAmountWei, fromToken.decimals ?? 18)) * fromTokenPrice) : 'USD unavailable';
    }, [fromToken, fromAmountWei, fromTokenInputValue, fromTokenPrice, isUSDMode]);

    const toSecondaryValue = useMemo(() => {
        if (!toToken) return null;
        if (!activeQuote?.destAmount) return isUSDMode ? `0 ${toToken.symbol}` : null;
        if (isUSDMode) return formatCompactToken(amountToInputValue(BigInt(activeQuote.destAmount), quoteDestDecimals, 8), toToken.symbol);
        const amt = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
        return toTokenPrice > 0 ? formatUSD(amt * toTokenPrice) : null;
    }, [toToken, activeQuote?.destAmount, quoteDestDecimals, toTokenPrice, isUSDMode]);

    const ratePreview = useMemo(() => {
        if (!activeQuote || !fromToken || !toToken) return null;
        try {
            const src = parseFloat(formatQuoteUnits(activeQuote.srcAmount, activeQuote, 'src', fromToken.decimals ?? 18));
            const dest = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
            if (src <= 0 || dest <= 0) return null;

            return invertRate
                ? { base: `1 ${toToken.symbol}`, quote: `${formatCompactNumber(src / dest)} ${fromToken.symbol}` }
                : { base: `1 ${fromToken.symbol}`, quote: `${formatCompactNumber(dest / src)} ${toToken.symbol}` };
        } catch { return null; }
    }, [activeQuote, fromToken, toToken, invertRate, quoteSrcDecimals, quoteDestDecimals]);

    const outputPreview = useMemo(() => {
        if (!activeQuote?.destAmount || !toToken) return null;
        const est = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
        const min = minAmountOut ? parseFloat(formatUnits(minAmountOut, quoteDestDecimals)) : est;
        return { estimated: est, minimum: min, estimatedUsd: toTokenPrice > 0 ? est * toTokenPrice : null, minimumUsd: toTokenPrice > 0 ? min * toTokenPrice : null };
    }, [activeQuote?.destAmount, minAmountOut, quoteDestDecimals, toToken, toTokenPrice]);

    const totalCostsUsd = useMemo(() => {
        const gasUsd = parseFloat(String(activeQuote?.raw?.gasCostUSD ?? activeQuote?.raw?.gasUSD ?? activeQuote?.raw?.priceRoute?.gasCostUSD ?? ''));
        let total = Number.isFinite(gasUsd) && gasUsd > 0 ? gasUsd : 0;

        // Add platform fee estimate
        const feeBps = activeQuote?.feeBps || 0;
        if (feeBps > 0 && activeQuote?.destAmount && toToken) {
            const grossAmount = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
            total += grossAmount * (feeBps / 10000) * toTokenPrice;
        }

        return total > 0 ? total : null;
    }, [activeQuote, quoteDestDecimals, toToken, toTokenPrice]);

    const formattedFromBalance = fromToken ? formatCompactNumber(formatUnits(fromBalance, fromToken.decimals ?? 18)) : '0';
    const formattedToBalance = toToken && toBalance > 0n ? formatCompactNumber(formatUnits(toBalance, toToken.decimals ?? 18)) : null;

    const action = useMemo(() => {
        if (!isConnected) return { label: 'Connect Wallet', disabled: false, onClick: connectWallet };
        if (!fromToken || !toToken) return { label: 'Select tokens', disabled: true, onClick: undefined };
        if (getTokenAddress(fromToken) === getTokenAddress(toToken)) return { label: 'Choose different tokens', disabled: true, onClick: undefined };
        if (!fromAmount || fromAmountWei <= 0n) return { label: 'Enter an amount', disabled: true, onClick: undefined };
        if (isUSDMode && fromTokenPrice <= 0) return { label: 'USD price unavailable', disabled: true, onClick: undefined };
        if (hasInsufficientBalance) return { label: 'Insufficient balance', disabled: true, onClick: undefined };
        if (walletChanging) return { label: 'Updating wallet...', disabled: true, onClick: undefined };
        if (!walletOnSelectedChain) return { label: switchingNetwork ? 'Switching network...' : 'Switch to ' + (activeNetwork?.label ?? 'selected network'), disabled: switchingNetwork, onClick: handleSwitchWalletNetwork };
        if (quoteLoading) return { label: 'Getting quote...', disabled: true, onClick: undefined };
        if (!isNativeToken(fromToken) && !activeSpender) return { label: 'Preparing swap...', disabled: true, onClick: undefined };
        if (approvalPending) return { label: 'Approving...', disabled: true, onClick: undefined };
        if (buildLoading) return { label: 'Building transaction...', disabled: true, onClick: undefined };
        if (txPending) return { label: 'Confirming swap...', disabled: true, onClick: undefined };
        if (!activeQuote) return { label: 'Enter an amount', disabled: true, onClick: undefined };
        return { label: approvalRequired ? 'Approve & Swap' : 'Swap', disabled: false, onClick: handleSwapWithAutoApprove };
    }, [
        approvalPending, approvalRequired, buildLoading, connectWallet,
        fromAmount, fromAmountWei, fromToken, fromTokenPrice, handleSwapWithAutoApprove,
        hasInsufficientBalance, isConnected, isUSDMode,
        activeNetwork?.label, activeQuote, activeSpender, quoteLoading, switchingNetwork, toToken, txPending, walletChanging, walletOnSelectedChain,
    ]);

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    return (
        <div className="mx-auto w-full max-w-125 rounded-[22px] bg-slate-950 p-3 shadow-2xl shadow-slate-950/25">
            <div className="relative rounded-2xl border border-border-light bg-white shadow-xl dark:border-slate-700 dark:bg-[#1b2030]">
                {walletChanging && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-slate-950/50 backdrop-blur-[1px]">
                        <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/90 px-3 py-2 text-xs font-medium text-slate-300 shadow-xl">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            <span>Updating wallet data...</span>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="px-4 pt-4 pb-2">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Swap</h2>
                    <div className="mt-3 flex min-h-7 items-center justify-between gap-3">
                        <ChainDropdown selectedChainId={selectedChainId} onChange={handleNetworkChange} disabled={executionBusy} />

                        <div className="relative flex items-center justify-end">
                            <button
                                type="button"
                                data-spot-slippage-toggle="true"
                                onClick={() => setShowSlippageSettings((v) => !v)}
                                className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 transition-all hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                                <span className="font-medium">Auto Slippage</span>
                                <span className="text-slate-800 dark:text-white">
                                    {(slippageBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%
                                </span>
                                <Settings className="h-3.5 w-3.5 text-slate-400" />
                            </button>
                            {showSlippageSettings && (
                                <div ref={slippageMenuRef} className="absolute top-full right-0 z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                                    <div className="mb-2.5 flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Max slippage</span>
                                        <button type="button" onClick={() => { setSlippageBps(DEFAULT_SLIPPAGE_BPS); setSlippageInput((DEFAULT_SLIPPAGE_BPS / 100).toString()); setShowSlippageSettings(false); }} className="text-xs font-bold text-primary hover:underline">Default</button>
                                    </div>
                                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                                        <input type="text" value={slippageInput} onChange={(e) => updateSlippage(e.target.value.replace(/[^0-9.]/g, ''))} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none dark:text-white" />
                                        <span className="text-sm font-bold text-slate-400">%</span>
                                    </div>
                                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Very low values can cause swaps to revert.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Inputs */}
                <div className="space-y-1 px-3 pb-3">

                    {/* FROM */}
                    <div className="rounded-xl border border-border-light bg-slate-100 p-2.5 transition-colors focus-within:border-purple-500/50 dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center gap-2">
                            <div className="relative flex flex-1 items-center overflow-hidden">
                                {isUSDMode && (
                                    <span className={`mr-0.5 select-none font-mono text-2xl font-bold ${fromAmount && fromAmount !== '0' ? 'text-slate-900 dark:text-white' : 'text-muted-foreground'}`}>$</span>
                                )}
                                <input
                                    type="text" inputMode="decimal" value={fromAmount}
                                    onChange={(e) => setFromAmount(normalizeDecimalInput(e.target.value))}
                                    onPaste={(e) => { e.preventDefault(); setFromAmount(normalizeDecimalInput(e.clipboardData?.getData('text') || '')); }}
                                    placeholder="0.00" disabled={executionBusy}
                                    className="w-full overflow-hidden bg-transparent font-mono text-2xl font-bold text-ellipsis focus:outline-none disabled:opacity-50 text-slate-900 dark:text-white"
                                />
                                {fromAmount && fromAmount !== '0' && !executionBusy && (
                                    <button type="button" onClick={() => setFromAmount('')} className="absolute top-1/2 right-0.5 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-500 transition-all hover:bg-slate-300 hover:text-slate-700 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200">
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </div>
                            <TokenBadge token={fromToken} networkIcon={activeNetwork?.icon} networkLabel={activeNetwork?.label} onClick={() => openSelector('from')} disabled={executionBusy} />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between">
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={toggleUSDMode} disabled={executionBusy || !fromToken}
                                className="group/s flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-default dark:text-slate-400 dark:hover:text-slate-200">
                                {fromToken && <div className="rounded p-0.5 opacity-60 transition-all group-hover/s:bg-slate-200 group-hover/s:opacity-100 dark:group-hover/s:bg-slate-700"><ArrowUpDown className="h-2.5 w-2.5" /></div>}
                                <span>{fromSecondaryValue || ''}</span>
                            </button>
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                                <span className="whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">
                                    {balanceLoading ? 'Loading…' : 'Balance'} {formattedFromBalance}
                                </span>
                                <div className="relative" ref={pctMenuRef}>
                                    <button type="button" disabled={executionBusy || fromBalance <= 0n} onClick={() => setPctMenuOpen((v) => !v)} className="cursor-pointer text-xs text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:text-white">%</button>
                                    {pctMenuOpen && (
                                        <div className="absolute right-0 bottom-full z-50 mb-2 flex gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                            {[25, 50, 75].map((pct) => (
                                                <button key={pct} type="button" onClick={() => { applyPct(pct); setPctMenuOpen(false); }}
                                                    className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-purple-100 hover:text-purple-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-purple-600 dark:hover:text-white">
                                                    {pct}%
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button type="button" disabled={executionBusy || fromBalance <= 0n} onClick={applyMax} className="cursor-pointer text-xs font-bold text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:text-white">MAX</button>
                            </div>
                        </div>
                    </div>

                    {/* Quote refresh + countdown */}
                    <div className="relative flex min-h-5 items-center justify-center">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            {fromAmount ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => void fetchQuote(true)}
                                        disabled={quoteLoading || executionBusy}
                                        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
                                        title="Refresh quote"
                                    >
                                        <RefreshCw className={`h-3 w-3 ${quoteLoading ? 'animate-spin text-primary' : ''}`} />
                                    </button>
                                    {quoteLoading || !quote ? (
                                        <span className="text-purple-400">Loading quote&hellip;</span>
                                    ) : (
                                        <span>Auto refresh in {nextRefreshIn}s</span>
                                    )}
                                </>
                            ) : (
                                <span className="text-slate-400/60">Enter an amount</span>
                            )}
                        </div>
                    </div>

                    {/* TO */}
                    <div className="rounded-xl border border-border-light bg-slate-100 p-2.5 dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center gap-2">
                            <div className="flex-1 overflow-hidden pl-0.5">
                                {quoteLoading ? (
                                    <div className="flex items-center gap-2 py-0.5 text-purple-400">
                                        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                                        <span className="text-sm font-medium">Loading quote…</span>
                                    </div>
                                ) : (
                                    <input type="text" readOnly value={outputValue} placeholder="0.00"
                                        className="w-full overflow-hidden bg-transparent font-mono text-2xl font-bold text-ellipsis text-slate-900 focus:outline-none dark:text-white placeholder:text-muted-foreground" />
                                )}
                            </div>
                            <TokenBadge token={toToken} networkIcon={activeNetwork?.icon} networkLabel={activeNetwork?.label} onClick={() => openSelector('to')} disabled={executionBusy} />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{toSecondaryValue || ''}</span>
                            {formattedToBalance && (
                                <span className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400">
                                    Current balance {formattedToBalance}
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Exchange Rate Indicator */}
                    {ratePreview && (
                        <div className="mt-1 flex flex-col items-center space-y-2">
                            <button
                                type="button"
                                onClick={() => setInvertRate((v) => !v)}
                                className="group flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                                title="Invert rate"
                            >
                                <span>{ratePreview.base}</span>
                                <ArrowRightLeft className="h-3 w-3 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-400" />
                                <span>{ratePreview.quote}</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Transaction Overview */}
                {activeQuote && fromToken && toToken && (
                    <div className="px-3 pb-3 pt-0">
                        <div className="text-sm font-bold text-slate-600 dark:text-slate-400 mb-0.5 px-1">Transaction overview</div>
                        <div className="transition-all">
                            {/* Costs & Fees Collapsible Header */}
                            <button
                                type="button"
                                onClick={() => setShowCostsBreakdown((v) => !v)}
                                className="w-full flex items-center justify-between px-1 py-1 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-[13px] text-slate-600 dark:text-slate-300">Costs & Fees</span>
                                    {(activeQuote?.discountPercent ?? 0) > 0 && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold whitespace-nowrap">
                                            Discount Applied
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                                    <span className="font-medium">{totalCostsUsd !== null ? formatUSD(totalCostsUsd) : '-'}</span>
                                    {showCostsBreakdown ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                </div>
                            </button>

                            {showCostsBreakdown && (
                                <div className="relative pl-3 pr-3 pb-1 pt-2 space-y-3 text-xs border-l border-dashed border-slate-300 dark:border-slate-700/50">
                                    {/* Network Costs */}
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <span>Network costs</span>
                                            <InfoTooltip content="Estimated network gas cost." size={12} />
                                        </div>
                                        <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                            <span>{formatGasCost(activeQuote)}</span>
                                        </div>
                                    </div>
                                    {/* Platform Fee */}
                                    <div className="flex justify-between items-center group">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <span>
                                                {(() => {
                                                    const feeBps = activeQuote?.feeBps;
                                                    if (feeBps == null || !Number.isFinite(feeBps)) return 'Service Fee (--)';
                                                    return `Service Fee (${(feeBps / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%)`;
                                                })()}
                                            </span>
                                            {(activeQuote?.discountPercent ?? 0) > 0 && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                                                    {activeQuote.discountPercent}% OFF
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                                            {toToken && (
                                                <div className="w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                                                    <img src={getTokenLogo(toToken.symbol)} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                                </div>
                                            )}
                                            <span>
                                                {(() => {
                                                    const feeBps = activeQuote?.feeBps;
                                                    if (feeBps == null || !Number.isFinite(feeBps)) return '--';
                                                    if (feeBps === 0) return 'Free';
                                                    const grossAmount = parseFloat(formatQuoteUnits(activeQuote.destAmount, activeQuote, 'dest', toToken.decimals ?? 18));
                                                    const fee = grossAmount * (feeBps / 10000);
                                                    return fee < 0.00001 ? '< 0.00001' : fee.toLocaleString('en-US', { maximumFractionDigits: 6 });
                                                })()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Persistent Rows */}
                            {showOverview && (
                                <div className="px-1 pb-1 pt-1 space-y-2">
                                    <div className="flex items-center justify-between gap-3 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                        <span className="flex items-center gap-1">Price impact <InfoTooltip content="Estimated impact of this trade on the market price." size={12} /></span>
                                        <span className={Number(activeQuote.priceImpact) > 0.02 ? 'font-medium text-amber-500' : 'font-medium text-slate-900 dark:text-slate-100'}>
                                            {formatPercent(Number(activeQuote.priceImpact))}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                        <span className="flex items-center gap-1">
                                            Minimum received
                                            <InfoTooltip content={`Protected by ${(slippageBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}% max slippage.`} size={12} />
                                        </span>
                                        <span className="text-right font-medium text-slate-900 dark:text-slate-100">
                                            {minAmountOut ? formatCompactToken(formatUnits(minAmountOut, quoteDestDecimals), toToken.symbol) : '-'}
                                            {outputPreview?.minimumUsd ? <span className="ml-1 font-normal text-slate-400">({formatUSD(outputPreview.minimumUsd)})</span> : null}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-2 text-xs dark:border-slate-700">
                                        <span className="text-slate-400 dark:text-slate-500">via Velora</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Error banner */}
                {quoteError && (
                    <div className="relative mx-4 mb-4 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs animate-in fade-in slide-in-from-top-2 duration-300 dark:border-amber-700/50 dark:bg-amber-950/40">
                        {quoteError && (
                            <button type="button" onClick={() => setQuoteError(null)} className="absolute top-1.5 right-1.5 p-1 text-amber-600/50 transition-colors hover:text-amber-800 dark:text-amber-400/50 dark:hover:text-amber-200">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                        <div className="flex items-start gap-3 pr-4">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                            <p className="font-medium leading-snug text-amber-900 dark:text-amber-100">
                                {quoteError}
                            </p>
                        </div>
                    </div>
                )}

                {/* Action button */}
                <div className="px-3 pb-4">
                    <Button type="button" onClick={action.onClick} disabled={action.disabled} className="group h-12 w-full rounded-xl text-base font-bold" size="lg">
                        {(quoteLoading || approvalPending || buildLoading || txPending || walletChanging) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : action.label.includes('Swap') ? (
                            <ArrowRightLeft className="h-4 w-4 transition-transform duration-500 group-hover:rotate-180" />
                        ) : null}
                        {action.label}
                    </Button>
                </div>
            </div>

            {/* Token Selector */}
            <SpotTokenSelector
                isOpen={selectorOpen}
                onClose={() => setSelectorOpen(false)}
                onSelect={handleTokenSelect}
                tokens={selectorTokens}
                tokensLoading={selectorLoading}
                chainId={selectedChainId}
                networkLabel={activeNetwork?.label}
                onSearchChange={handleSearchChange}
            />
        </div>
    );
}











