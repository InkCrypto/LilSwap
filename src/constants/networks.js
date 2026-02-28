import { ethers } from 'ethers';
import { AaveV3Ethereum, AaveV3Base, AaveV3Polygon, AaveV3BNB, AaveV3Arbitrum } from '@bgd-labs/aave-address-book';

import logger from '../utils/logger.js';
/**
 * Helper: Normalize address checksum using ethers v6
 * @param {string} address - Raw address
 * @returns {string} EIP-55 normalized address
 */
const normalizeAddress = (address) => {
    if (!address) return null;
    try {
        return ethers.getAddress(address);
    } catch (error) {
        logger.warn(`[networks.js] Failed to normalize address ${address}:`, error.message);
        return address; // Fallback to original
    }
};

/**
 * Get canonical addresses from official address book
 * @param {number} chainId - Chain ID
 * @returns {object} Address map from Aave official book
 */
const getOfficialAddressBook = (chainId) => {
    const bookMap = {
        1: AaveV3Ethereum,
        8453: AaveV3Base,
        137: AaveV3Polygon,
        56: AaveV3BNB,
        42161: AaveV3Arbitrum,
    };
    return bookMap[chainId] || null;
};


/**
 * Augustus (ParaSwap/Velora) router addresses.
 * V6.2: same address on all EVM chains — deployed with CREATE2.
 * V5:   differs on Base (historical deployment before CREATE2 standard).
 */
const AUGUSTUS_ADDRESSES = {
    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026'),
    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'), // Ethereum, Polygon, BNB, Arbitrum...
    V5_BASE: normalizeAddress('0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52'), // Base only
};

export const NETWORKS = {
    ETHEREUM: (() => {
        const book = getOfficialAddressBook(1);
        return {
            key: 'ETHEREUM',
            label: 'Ethereum Mainnet',
            shortLabel: 'Ethereum',
            chainId: 1,
            hexChainId: '0x1',
            icon: '/icons/networks/ethereum.svg',

            explorer: 'https://etherscan.io',
            rpcUrls: [
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

    BASE: (() => {
        const book = getOfficialAddressBook(8453);
        return {
            key: 'BASE',
            label: 'Base',
            shortLabel: 'Base',
            chainId: 8453,
            hexChainId: '0x2105',
            icon: '/icons/networks/base.svg',

            explorer: 'https://basescan.org',
            rpcUrls: [
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

    POLYGON: (() => {
        const book = getOfficialAddressBook(137);
        return {
            key: 'POLYGON',
            label: 'Polygon',
            shortLabel: 'Polygon',
            chainId: 137,
            hexChainId: '0x89',
            icon: '/icons/networks/polygon.svg',

            explorer: 'https://polygonscan.com',
            rpcUrls: [
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

    BNB: (() => {
        const book = getOfficialAddressBook(56);
        return {
            key: 'BNB',
            label: 'BNB Chain',
            shortLabel: 'BNB',
            chainId: 56,
            hexChainId: '0x38',
            icon: '/icons/networks/binance.svg',

            explorer: 'https://bscscan.com',
            rpcUrls: [
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

    ARBITRUM: (() => {
        const book = getOfficialAddressBook(42161);
        return {
            key: 'ARBITRUM',
            label: 'Arbitrum One',
            shortLabel: 'Arbitrum',
            chainId: 42161,
            hexChainId: '0xa4b1',
            icon: '/icons/networks/arbitrum.svg',

            explorer: 'https://arbiscan.io',
            rpcUrls: [
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

};

export const DEFAULT_NETWORK = NETWORKS.BASE;

export const getNetworkByChainId = (chainId) => {
    if (!chainId && chainId !== 0) {
        return DEFAULT_NETWORK;
    }
    const numericId = typeof chainId === 'string' ? Number(chainId) : chainId;
    return (
        Object.values(NETWORKS).find((network) => network.chainId === numericId) || DEFAULT_NETWORK
    );
};

export const getNetworkByKey = (key) => NETWORKS[key] || DEFAULT_NETWORK;
