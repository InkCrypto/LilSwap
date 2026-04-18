import { mainnet, bsc, polygon, base, arbitrum, avalanche, optimism, gnosis, sonic } from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { getMarketByChainId, SUPPORTED_CHAINS, getAlchemyRpcUrl } from '../constants/networks';
import { buildTransportConfig } from '../helpers/rpc-helper';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

if (!projectId) {
    throw new Error('Missing VITE_REOWN_PROJECT_ID');
}

const metadata = {
    name: 'LilSwap',
    description: 'Aave V3 Position Manager',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://app.lilswap.xyz',
    icons: [typeof window !== 'undefined' ? `${window.location.origin}/favicon.png` : 'https://app.lilswap.xyz/favicon.png'],
};

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
    mainnet,
    arbitrum,
    polygon,
    base,
    bsc,
    avalanche,
    optimism,
    gnosis,
    sonic,
];

type CustomRpcUrlMap = Record<string, Array<{ url: string; config?: Record<string, unknown> }>>;

const customRpcUrls = Object.fromEntries(
    SUPPORTED_CHAINS.map((chain) => {
        const market = getMarketByChainId(chain.id);
        const rpcUrl = market ? getAlchemyRpcUrl(market.alchemySlug) : undefined;

        return [
            `eip155:${chain.id}`,
            rpcUrl ? [{ url: rpcUrl, config: buildTransportConfig(rpcUrl) }] : [],
        ];
    }),
) as CustomRpcUrlMap;

const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks,
    ssr: true,
    customRpcUrls,
});

createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    metadata,
    enableCoinbase: false,
    allWallets: 'SHOW',
    featuredWalletIds: [
        '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
        '1aedbcfc1f31aade56ca34c38b0a1607b41cccfa3de93c946ef3b4ba2dfab11c', // OneKey
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
        '163d2cf19babf05eb8962e9748f9ebe613ed52ebf9c8107c9a0f104bfcf161b3', // Brave
    ],
    features: {
        analytics: false,
        email: false,
        socials: false,
    },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
