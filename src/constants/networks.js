import { ethers } from 'ethers';
import { AaveV3Ethereum, AaveV3Base, AaveV3Polygon, AaveV3BNB } from '@bgd-labs/aave-address-book';
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
    };
    return bookMap[chainId] || null;
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
            icon: 'https://app.aave.com/icons/networks/ethereum.svg',
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
                    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'),
                    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026'),
                },
                TOKENS: {
                    WETH: {
                        address: normalizeAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
                        decimals: 18,
                        symbol: 'WETH',
                        debtAddress: normalizeAddress('0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE'),
                        aTokenAddress: normalizeAddress('0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8'),
                    },
                    USDC: {
                        address: normalizeAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
                        decimals: 6,
                        symbol: 'USDC',
                        debtAddress: normalizeAddress('0x72E95b8931767C79bA4EeE721354d6E99a61D004'),
                        aTokenAddress: normalizeAddress('0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c'),
                    },
                    DAI: {
                        address: normalizeAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F'),
                        decimals: 18,
                        symbol: 'DAI',
                        debtAddress: normalizeAddress('0xcF8d0c70c850859266f5C338b38F9D663181C314'),
                        aTokenAddress: normalizeAddress('0x018008bfb33d285247A21d44E50697654f754e63'),
                    },
                    USDT: {
                        address: normalizeAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
                        decimals: 6,
                        symbol: 'USDT',
                        debtAddress: normalizeAddress('0x6df1C1E379bC5a00a7b4C6e67A203333772f45A8'),
                        aTokenAddress: normalizeAddress('0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a'),
                    },
                    WBTC: {
                        address: normalizeAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
                        decimals: 8,
                        symbol: 'WBTC',
                        debtAddress: normalizeAddress('0x40aAbEf1aa8f0eEc637E0E7d92fbfFB2F26A8b7B'),
                        aTokenAddress: normalizeAddress('0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8'),
                    },
                    wstETH: {
                        address: normalizeAddress('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'),
                        decimals: 18,
                        symbol: 'wstETH',
                        debtAddress: normalizeAddress('0xC96113eED8cAB59cD8A66813bCB0cEb29F06D2e4'),
                        aTokenAddress: normalizeAddress('0x0B925eD163218f6662a35e0f0371Ac234f9E9371'),
                    },
                    LINK: {
                        address: normalizeAddress('0x514910771AF9Ca656af840dff83E8264EcF986CA'),
                        decimals: 18,
                        symbol: 'LINK',
                        debtAddress: normalizeAddress('0x4228F8895C7dDA20227cFeCc6E307B7ea3E559Da'),
                        aTokenAddress: normalizeAddress('0x5E8C8A7243651DB1384C0dDfDbE39761E8e7E51a'),
                    },
                    AAVE: {
                        address: normalizeAddress('0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'),
                        decimals: 18,
                        symbol: 'AAVE',
                        debtAddress: normalizeAddress('0xBae535520Abd9f8C85E58929e0006A2c8B372F74'),
                        aTokenAddress: normalizeAddress('0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9'),
                    },
                },
                PARASWAP_API: 'https://api.paraswap.io',
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
            icon: 'https://app.aave.com/icons/networks/base.svg',
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
                    V5: normalizeAddress('0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52'),
                    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026'),
                },
                TOKENS: {
                    USDC: {
                        address: normalizeAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
                        decimals: 6,
                        symbol: 'USDC',
                        debtAddress: normalizeAddress('0x59dca05b6c26dbd64b5381374aAaC5CD05644C28'),
                        aTokenAddress: normalizeAddress('0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB'),
                    },
                    WETH: {
                        address: normalizeAddress('0x4200000000000000000000000000000000000006'),
                        decimals: 18,
                        symbol: 'WETH',
                        debtAddress: normalizeAddress('0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E'),
                        aTokenAddress: normalizeAddress('0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7'),
                    },
                    USDbC: {
                        address: normalizeAddress('0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'),
                        decimals: 6,
                        symbol: 'USDbC',
                        debtAddress: normalizeAddress('0x7376b2F323dC56fCd4C191B34163ac8a84702DAB'),
                        aTokenAddress: normalizeAddress('0x0a1d576f3eFeF75b330424287a95A366e8281D54'),
                    },
                    cbETH: {
                        address: normalizeAddress('0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22'),
                        decimals: 18,
                        symbol: 'cbETH',
                        debtAddress: normalizeAddress('0x1DabC36f19909425f654777249815c073E8Fd79F'),
                        aTokenAddress: normalizeAddress('0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad'),
                    },
                    wstETH: {
                        address: normalizeAddress('0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452'),
                        decimals: 18,
                        symbol: 'wstETH',
                        debtAddress: normalizeAddress('0x41A7C3f5904ad176dACbb1D99101F59ef0811DC1'),
                        aTokenAddress: normalizeAddress('0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D'),
                    },
                },
                PARASWAP_API: 'https://api.paraswap.io',
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
            icon: 'https://app.aave.com/icons/networks/polygon.svg',
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
                    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'),
                    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026'),
                },
                TOKENS: {
                    USDC: {
                        address: normalizeAddress('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'),
                        decimals: 6,
                        symbol: 'USDC',
                        debtAddress: normalizeAddress('0xFCCf3cAbbe80101232d343252614b6A3eE81C989'),
                        aTokenAddress: normalizeAddress('0x625E7708f30cA75bfd92586e17077590C60eb4cD'),
                    },
                    USDCn: {
                        address: normalizeAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
                        decimals: 6,
                        symbol: 'USDCn',
                        debtAddress: normalizeAddress('0x4F5f178E49dB01bF34f3b144C1Eb06cd46420e40'),
                        aTokenAddress: normalizeAddress('0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD'),
                    },
                    DAI: {
                        address: normalizeAddress('0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'),
                        decimals: 18,
                        symbol: 'DAI',
                        debtAddress: normalizeAddress('0x8619d80FB0141ba7F184CbF22fd724116D9f7ffC'),
                        aTokenAddress: normalizeAddress('0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE'),
                    },
                    WETH: {
                        address: normalizeAddress('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'),
                        decimals: 18,
                        symbol: 'WETH',
                        debtAddress: normalizeAddress('0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351'),
                        aTokenAddress: normalizeAddress('0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8'),
                    },
                    WBTC: {
                        address: normalizeAddress('0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'),
                        decimals: 8,
                        symbol: 'WBTC',
                        debtAddress: normalizeAddress('0x92b42c66840C7AD907b4BF74879FF3eF7c529473'),
                        aTokenAddress: normalizeAddress('0x078f358208685046a11C85e8ad32895DED33A249'),
                    },
                    WPOL: {
                        address: normalizeAddress('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'),
                        decimals: 18,
                        symbol: 'WPOL',
                        debtAddress: normalizeAddress('0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8'),
                        aTokenAddress: normalizeAddress('0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97'),
                    },
                    wstETH: {
                        address: normalizeAddress('0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD'),
                        decimals: 18,
                        symbol: 'wstETH',
                        debtAddress: normalizeAddress('0x77fA66882a8854d883101Fb8501BD3CaD347Fc32'),
                        aTokenAddress: normalizeAddress('0xf59036CAEBeA7dC4b86638DFA2E3C97dA9FcCd40'),
                    },
                },
                PARASWAP_API: 'https://api.paraswap.io',
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
            icon: 'https://app.aave.com/icons/networks/binance.svg',
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
                    V5: normalizeAddress('0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57'),
                    V6_2: normalizeAddress('0x6a000f200059e1213d2a795f0f087e561e4c2026'),
                },
                TOKENS: {
                    WBNB: {
                        address: normalizeAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
                        decimals: 18,
                        symbol: 'WBNB',
                        debtAddress: normalizeAddress('0x0E76414d433ddfe8004d2A7505d218874875a996'),
                        aTokenAddress: normalizeAddress('0x9B00a09492a626678E5A3009982191586C444Df9'),
                    },
                    USDC: {
                        address: normalizeAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
                        decimals: 18,
                        symbol: 'USDC',
                        debtAddress: normalizeAddress('0xcDBBEd5606d9c5C98eEedd67933991dC17F0c68d'),
                        aTokenAddress: normalizeAddress('0x00901a076785e0906d1028c7d6372d247bec7d61'),
                    },
                    USDT: {
                        address: normalizeAddress('0x55d398326f99059fF775485246999027B3197955'),
                        decimals: 18,
                        symbol: 'USDT',
                        debtAddress: normalizeAddress('0xF8bb2Be50647447Fb355e3a77b81be4db64107cd'),
                        aTokenAddress: normalizeAddress('0xa9251ca9DE909CB71783723713B21E4233fbf1B1'),
                    },
                    BTCB: {
                        address: normalizeAddress('0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'),
                        decimals: 18,
                        symbol: 'BTCB',
                        debtAddress: normalizeAddress('0x7b1E82F4f542fbB25D64c5523Fe3e44aBe4F2702'),
                        aTokenAddress: normalizeAddress('0x56a7ddc4e848EbF43845854205ad71D5D5F72d3D'),
                    },
                    ETH: {
                        address: normalizeAddress('0x2170Ed0880ac9A755fd29B2688956BD959F933F8'),
                        decimals: 18,
                        symbol: 'ETH',
                        debtAddress: normalizeAddress('0x8FDea7891b4D6dbdc746309245B316aF691A636C'),
                        aTokenAddress: normalizeAddress('0x2E94171493fAbE316b6205f1585779C887771E2F'),
                    },
                    wstETH: {
                        address: normalizeAddress('0x26c5e01524d2E6280A48F2c50fF6De7e52E9611C'),
                        decimals: 18,
                        symbol: 'wstETH',
                        debtAddress: normalizeAddress('0x55FeE2b9F45d8Bc38f3Aa69E8f3c2e48f897C9db'),
                        aTokenAddress: normalizeAddress('0xBDFd4E51D3c14a232135f04988a42576eFb31519'),
                    },
                },
                PARASWAP_API: 'https://api.paraswap.io',
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
