import { 
    AaveV3Ethereum, 
    AaveV3EthereumLido, 
    AaveV3Base, 
    AaveV3Polygon, 
    AaveV3BNB, 
    AaveV3Arbitrum, 
    AaveV3Avalanche,
    AaveV3Optimism,
    AaveV3Gnosis,
    AaveV3Sonic
} from '@bgd-labs/aave-address-book';
import { getAddress } from 'viem';
import { 
    mainnet, 
    bsc, 
    polygon, 
    base, 
    arbitrum, 
    avalanche, 
    optimism, 
    gnosis,
    sonic
} from 'viem/chains';
import logger from '../utils/logger';

/**
 * Single Source of Truth for Wagmi/Viem chains
 */
export const SUPPORTED_CHAINS = [
    mainnet, 
    bsc, 
    polygon, 
    base, 
    arbitrum, 
    avalanche, 
    optimism, 
    gnosis,
    sonic
] as const;

/**
 * Helper: Normalize address checksum using viem
 */
const normalizeAddress = (address: string | undefined): string | null => {
    if (!address) {
        return null;
    }

    try {
        return getAddress(address);
    } catch (error: any) {
        logger.warn(`[networks.ts] Failed to normalize address ${address}:`, error.message);

        return address;
    }
};

const getOfficialAddressBook = (marketKey: string) => {
    const bookMap: Record<string, any> = {
        AaveV3Ethereum,
        AaveV3EthereumLido,
        AaveV3BNB,
        AaveV3Polygon,
        AaveV3Base,
        AaveV3Arbitrum,
        AaveV3Avalanche,
        AaveV3Optimism,
        AaveV3Gnosis,
        AaveV3Sonic,
    };

    return bookMap[marketKey] || null;
};

const AUGUSTUS_ADDRESSES = {
    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026')!,
    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57')!,
    V5_BASE: normalizeAddress('0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52')!,
};

export const getAlchemyRpcUrl = (slug: string) => `${window.location.origin}/rpc/${slug}`;

export interface MarketConfig {
    key: string;
    label: string;
    shortLabel: string;
    chainId: number;
    hexChainId: string;
    icon: string;
    alchemySlug: string;
    explorer: string;
    rpcUrls: string[];
    addresses: {
        POOL: string | null;
        DEBT_SWAP_ADAPTER: string | null;
        SWAP_COLLATERAL_ADAPTER: string | null;
        DATA_PROVIDER: string | null;
        AUGUSTUS: {
            V5: string;
            V6_2: string;
        };
    };
}

/**
 * @deprecated Use MarketConfig instead
 */
export type NetworkConfig = MarketConfig;

export const MARKETS: Record<string, MarketConfig> = {
    AaveV3Ethereum: (() => {
        const key = 'AaveV3Ethereum';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('eth-mainnet');

        return {
            key,
            label: 'Ethereum Core',
            shortLabel: 'Ethereum',
            chainId: 1,
            hexChainId: '0x1',
            icon: '/icons/networks/ethereum.svg',
            alchemySlug: 'eth-mainnet',
            explorer: 'https://etherscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://eth.drpc.org',
                'https://eth.llamarpc.com'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3EthereumLido: (() => {
        const key = 'AaveV3EthereumLido';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('eth-mainnet');

        return {
            key,
            label: 'Ethereum Lido',
            shortLabel: 'Lido',
            chainId: 1,
            hexChainId: '0x1',
            icon: '/icons/networks/lido.svg',
            alchemySlug: 'eth-mainnet',
            explorer: 'https://etherscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://eth.drpc.org'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Optimism: (() => {
        const key = 'AaveV3Optimism';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('opt-mainnet');

        return {
            key,
            label: 'Optimism',
            shortLabel: 'Optimism',
            chainId: 10,
            hexChainId: '0xa',
            icon: '/icons/networks/optimism.svg',
            alchemySlug: 'opt-mainnet',
            explorer: 'https://optimistic.etherscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://mainnet.optimism.io',
                'https://optimism.drpc.org'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3BNB: (() => {
        const key = 'AaveV3BNB';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('bnb-mainnet');

        return {
            key,
            label: 'BNB Chain',
            shortLabel: 'BNB',
            chainId: 56,
            hexChainId: '0x38',
            icon: '/icons/networks/binance.svg',
            alchemySlug: 'bnb-mainnet',
            explorer: 'https://bscscan.com',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://bsc-dataseed.binance.org'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Gnosis: (() => {
        const key = 'AaveV3Gnosis';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('gnosis-mainnet');

        return {
            key,
            label: 'Gnosis Chain',
            shortLabel: 'Gnosis',
            chainId: 100,
            hexChainId: '0x64',
            icon: '/icons/networks/gnosis.svg',
            alchemySlug: 'gnosis-mainnet',
            explorer: 'https://gnosisscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://rpc.gnosischain.com'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Polygon: (() => {
        const key = 'AaveV3Polygon';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('polygon-mainnet');

        return {
            key,
            label: 'Polygon',
            shortLabel: 'Polygon',
            chainId: 137,
            hexChainId: '0x89',
            icon: '/icons/networks/polygon.svg',
            alchemySlug: 'polygon-mainnet',
            explorer: 'https://polygonscan.com',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://polygon-rpc.com'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Sonic: (() => {
        const key = 'AaveV3Sonic';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('sonic-mainnet');

        return {
            key,
            label: 'Sonic',
            shortLabel: 'Sonic',
            chainId: 146,
            hexChainId: '0x92',
            icon: '/icons/networks/sonic.svg',
            alchemySlug: 'sonic-mainnet',
            explorer: 'https://sonicscan.org',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://rpc.soniclabs.com'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Base: (() => {
        const key = 'AaveV3Base';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('base-mainnet');

        return {
            key,
            label: 'Base',
            shortLabel: 'Base',
            chainId: 8453,
            hexChainId: '0x2105',
            icon: '/icons/networks/base.svg',
            alchemySlug: 'base-mainnet',
            explorer: 'https://basescan.org',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://mainnet.base.org'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5_BASE,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Arbitrum: (() => {
        const key = 'AaveV3Arbitrum';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('arb-mainnet');

        return {
            key,
            label: 'Arbitrum One',
            shortLabel: 'Arbitrum',
            chainId: 42161,
            hexChainId: '0xa4b1',
            icon: '/icons/networks/arbitrum.svg',
            alchemySlug: 'arb-mainnet',
            explorer: 'https://arbiscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://arb1.arbitrum.io/rpc'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
    AaveV3Avalanche: (() => {
        const key = 'AaveV3Avalanche';
        const book = getOfficialAddressBook(key);
        const alchemyUrl = getAlchemyRpcUrl('avax-mainnet');

        return {
            key,
            label: 'Avalanche C-Chain',
            shortLabel: 'Avalanche',
            chainId: 43114,
            hexChainId: '0xa86a',
            icon: '/icons/networks/avalanche.svg',
            alchemySlug: 'avax-mainnet',
            explorer: 'https://snowtrace.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://api.avax.network/ext/bc/C/rpc'
            ],
            addresses: {
                POOL: normalizeAddress(book?.POOL),
                DEBT_SWAP_ADAPTER: normalizeAddress(book?.DEBT_SWAP_ADAPTER || book?.DebtSwapAdapter),
                SWAP_COLLATERAL_ADAPTER: normalizeAddress(book?.SWAP_COLLATERAL_ADAPTER || book?.SwapCollateralAdapter),
                DATA_PROVIDER: normalizeAddress(book?.AAVE_PROTOCOL_DATA_PROVIDER || book?.ProtocolDataProvider),
                AUGUSTUS: {
                    V5: AUGUSTUS_ADDRESSES.V5,
                    V6_2: AUGUSTUS_ADDRESSES.V6_2,
                },
            },
        };
    })(),
};

/**
 * Legacy alias for backward compatibility
 */
export const NETWORKS = MARKETS;

export const DEFAULT_MARKET = MARKETS.AaveV3Ethereum;
export const DEFAULT_NETWORK = DEFAULT_MARKET;

/**
 * @deprecated Use getMarketByChainId instead
 */
export const getNetworkByChainId = (chainId: number | string | undefined): MarketConfig => {
    if (!chainId && chainId !== 0) {
        return DEFAULT_MARKET;
    }

    const numericId = typeof chainId === 'string' ? Number(chainId) : chainId;

    // Return the "Core" market for this chain (the one whose key ends with just the chain name, or specify priority)
    const marketsOnChain = Object.values(MARKETS).filter((m) => m.chainId === numericId);
    if (marketsOnChain.length === 0) return DEFAULT_MARKET;
    
    // Priority: Core market (AaveV3Ethereum, AaveV3Base, etc)
    const coreMarket = marketsOnChain.find(m => m.key === `AaveV3${m.shortLabel}`);
    return coreMarket || marketsOnChain[0];
};

export const getMarketByChainId = getNetworkByChainId;

/**
 * @deprecated Use getMarketByKey instead
 */
export const getNetworkByKey = (key: string): MarketConfig => MARKETS[key] || DEFAULT_MARKET;

export const getMarketByKey = (key: string): MarketConfig => MARKETS[key] || DEFAULT_MARKET;
