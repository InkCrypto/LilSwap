import type { MarketConfig } from './networks';
import { MARKETS } from './networks';

export type DonationTokenKey = 'native' | 'usdc' | 'usdt';

export type DonationAssetConfig = {
    tokenKey: DonationTokenKey;
    symbol: string;
    type: 'native' | 'erc20';
    decimals: number;
    address: string | null;
};

export type DonationChainConfig = {
    chainId: number;
    marketKey: keyof typeof MARKETS;
    label: string;
    nativeSymbol: string;
    assets: DonationAssetConfig[];
};

export const DONATION_WALLET = '0x41dB8386872ffab478d4ce798782E71b717745dA';
export const DONATION_MIN_USD = 1;

export const DONATION_CHAINS: DonationChainConfig[] = [
    {
        chainId: 1,
        marketKey: 'AaveV3Ethereum',
        label: 'Ethereum',
        nativeSymbol: 'ETH',
        assets: [
            { tokenKey: 'native', symbol: 'ETH', type: 'native', decimals: 18, address: null },
            { tokenKey: 'usdc', symbol: 'USDC', type: 'erc20', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
            { tokenKey: 'usdt', symbol: 'USDT', type: 'erc20', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
        ],
    },
    {
        chainId: 8453,
        marketKey: 'AaveV3Base',
        label: 'Base',
        nativeSymbol: 'ETH',
        assets: [
            { tokenKey: 'native', symbol: 'ETH', type: 'native', decimals: 18, address: null },
            { tokenKey: 'usdc', symbol: 'USDC', type: 'erc20', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        ],
    },
    {
        chainId: 137,
        marketKey: 'AaveV3Polygon',
        label: 'Polygon',
        nativeSymbol: 'POL',
        assets: [
            { tokenKey: 'native', symbol: 'POL', type: 'native', decimals: 18, address: null },
            { tokenKey: 'usdc', symbol: 'USDC', type: 'erc20', decimals: 6, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
            { tokenKey: 'usdt', symbol: 'USDT', type: 'erc20', decimals: 6, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
        ],
    },
    {
        chainId: 42161,
        marketKey: 'AaveV3Arbitrum',
        label: 'Arbitrum',
        nativeSymbol: 'ETH',
        assets: [
            { tokenKey: 'native', symbol: 'ETH', type: 'native', decimals: 18, address: null },
            { tokenKey: 'usdc', symbol: 'USDC', type: 'erc20', decimals: 6, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
        ],
    },
    {
        chainId: 56,
        marketKey: 'AaveV3BNB',
        label: 'BNB',
        nativeSymbol: 'BNB',
        assets: [
            { tokenKey: 'native', symbol: 'BNB', type: 'native', decimals: 18, address: null },
            { tokenKey: 'usdc', symbol: 'USDC', type: 'erc20', decimals: 18, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
            { tokenKey: 'usdt', symbol: 'USDT', type: 'erc20', decimals: 18, address: '0x55d398326f99059fF775485246999027B3197955' },
        ],
    },
];

export const DONATION_CHAINS_BY_ID = Object.fromEntries(
    DONATION_CHAINS.map((chain) => [chain.chainId, chain])
) as Record<number, DonationChainConfig>;

export function getDonationChainConfig(chainId: number): DonationChainConfig | null {
    return DONATION_CHAINS_BY_ID[chainId] || null;
}

export function getDonationAssetConfig(chainId: number, tokenKey: DonationTokenKey): DonationAssetConfig | null {
    const chainConfig = getDonationChainConfig(chainId);
    if (!chainConfig) return null;

    return chainConfig.assets.find((asset) => asset.tokenKey === tokenKey) || null;
}

export function getDonationMarket(chainId: number): MarketConfig | null {
    const chainConfig = getDonationChainConfig(chainId);
    if (!chainConfig) return null;

    return MARKETS[chainConfig.marketKey] || null;
}
