import { AaveV3Ethereum, AaveV3Base, AaveV3Polygon, AaveV3BNB, AaveV3Arbitrum, AaveV3Avalanche } from '@bgd-labs/aave-address-book';
import { ethers } from 'ethers';
import logger from '../utils/logger';

/**
 * Helper: Normalize address checksum using ethers v6
 */
const normalizeAddress = (address: string | undefined): string | null => {
    if (!address) {
return null;
}

    try {
        return ethers.getAddress(address);
    } catch (error: any) {
        logger.warn(`[networks.ts] Failed to normalize address ${address}:`, error.message);

        return address;
    }
};

const getOfficialAddressBook = (chainId: number) => {
    const bookMap: Record<number, any> = {
        1: AaveV3Ethereum,
        56: AaveV3BNB,
        137: AaveV3Polygon,
        8453: AaveV3Base,
        42161: AaveV3Arbitrum,
        43114: AaveV3Avalanche,
    };

    return bookMap[chainId] || null;
};

const AUGUSTUS_ADDRESSES = {
    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026')!,
    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57')!,
    V5_BASE: normalizeAddress('0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52')!,
};

const getAlchemyRpcUrl = (slug: string) => `${window.location.origin}/rpc/${slug}`;

export interface NetworkConfig {
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

export const NETWORKS: Record<string, NetworkConfig> = {
    ETHEREUM: (() => {
        const book = getOfficialAddressBook(1);
        const alchemyUrl = getAlchemyRpcUrl('eth-mainnet');

        return {
            key: 'ETHEREUM',
            label: 'Ethereum Mainnet',
            shortLabel: 'Ethereum',
            chainId: 1,
            hexChainId: '0x1',
            icon: '/icons/networks/ethereum.svg',
            alchemySlug: 'eth-mainnet',
            explorer: 'https://etherscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://mainnet.gateway.tenderly.co',
                'https://rpc.flashbots.net',
                'https://eth.llamarpc.com',
                'https://eth-mainnet.public.blastapi.io',
                'https://ethereum-rpc.publicnode.com'
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
    BNB: (() => {
        const book = getOfficialAddressBook(56);
        const alchemyUrl = getAlchemyRpcUrl('bnb-mainnet');

        return {
            key: 'BNB',
            label: 'BNB Chain',
            shortLabel: 'BNB',
            chainId: 56,
            hexChainId: '0x38',
            icon: '/icons/networks/binance.svg',
            alchemySlug: 'bnb-mainnet',
            explorer: 'https://bscscan.com',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://bsc.publicnode.com',
                'https://bsc-dataseed.binance.org',
                'https://bsc-dataseed1.binance.org'
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
    POLYGON: (() => {
        const book = getOfficialAddressBook(137);
        const alchemyUrl = getAlchemyRpcUrl('polygon-mainnet');

        return {
            key: 'POLYGON',
            label: 'Polygon',
            shortLabel: 'Polygon',
            chainId: 137,
            hexChainId: '0x89',
            icon: '/icons/networks/polygon.svg',
            alchemySlug: 'polygon-mainnet',
            explorer: 'https://polygonscan.com',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://gateway.tenderly.co/public/polygon',
                'https://polygon-pokt.nodies.app',
                'https://polygon-bor-rpc.publicnode.com',
                'https://polygon-rpc.com',
                'https://polygon-mainnet.public.blastapi.io'
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
    BASE: (() => {
        const book = getOfficialAddressBook(8453);
        const alchemyUrl = getAlchemyRpcUrl('base-mainnet');

        return {
            key: 'BASE',
            label: 'Base',
            shortLabel: 'Base',
            chainId: 8453,
            hexChainId: '0x2105',
            icon: '/icons/networks/base.svg',
            alchemySlug: 'base-mainnet',
            explorer: 'https://basescan.org',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://base.gateway.tenderly.co',
                'https://base.llamarpc.com',
                'https://base.publicnode.com',
                'https://mainnet.base.org',
                'https://base-mainnet.public.blastapi.io',
                'https://1rpc.io/base'
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
    ARBITRUM: (() => {
        const book = getOfficialAddressBook(42161);
        const alchemyUrl = getAlchemyRpcUrl('arb-mainnet');

        return {
            key: 'ARBITRUM',
            label: 'Arbitrum One',
            shortLabel: 'Arbitrum',
            chainId: 42161,
            hexChainId: '0xa4b1',
            icon: '/icons/networks/arbitrum.svg',
            alchemySlug: 'arb-mainnet',
            explorer: 'https://arbiscan.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://arb1.arbitrum.io/rpc',
                'https://arbitrum.llamarpc.com',
                'https://arbitrum-one.public.blastapi.io',
                'https://arbitrum.publicnode.com',
                'https://1rpc.io/arb'
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
    AVALANCHE: (() => {
        const book = getOfficialAddressBook(43114);
        const alchemyUrl = getAlchemyRpcUrl('avax-mainnet');

        return {
            key: 'AVALANCHE',
            label: 'Avalanche C-Chain',
            shortLabel: 'Avalanche',
            chainId: 43114,
            hexChainId: '0xa86a',
            icon: '/icons/networks/avalanche.svg',
            alchemySlug: 'avax-mainnet',
            explorer: 'https://snowtrace.io',
            rpcUrls: [
                ...(alchemyUrl ? [alchemyUrl] : []),
                'https://api.avax.network/ext/bc/C/rpc',
                'https://avalanche.drpc.org',
                'https://avax.meowrpc.com'
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

export const DEFAULT_NETWORK = NETWORKS.ETHEREUM;

export const getNetworkByChainId = (chainId: number | string | undefined): NetworkConfig => {
    if (!chainId && chainId !== 0) {
        return DEFAULT_NETWORK;
    }

    const numericId = typeof chainId === 'string' ? Number(chainId) : chainId;

    return (
        Object.values(NETWORKS).find((network) => network.chainId === numericId) || DEFAULT_NETWORK
    );
};

export const getNetworkByKey = (key: string): NetworkConfig => NETWORKS[key] || DEFAULT_NETWORK;
