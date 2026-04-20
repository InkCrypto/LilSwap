import { getDefaultConfig } from 'connectkit';
import { createConfig, http } from 'wagmi';
import { SUPPORTED_CHAINS, getMarketByChainId, getAlchemyRpcUrl } from '../constants/networks';
import { buildTransportConfig } from '../helpers/rpc-helper';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

if (!projectId) {
    throw new Error('Missing VITE_REOWN_PROJECT_ID');
}

const appName = 'LilSwap';
const appDescription = 'Aave V3 Position Manager';
const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.lilswap.xyz';
const appIcon = typeof window !== 'undefined' ? `${window.location.origin}/favicon.png` : 'https://app.lilswap.xyz/favicon.png';

export const wagmiConfig = createConfig(
    getDefaultConfig({
        // Required API Keys
        walletConnectProjectId: projectId,

        // Required App Info
        appName,
        appDescription,
        appUrl,
        appIcon,

        // Chains
        chains: SUPPORTED_CHAINS,

        // Transports
        transports: Object.fromEntries(
            SUPPORTED_CHAINS.map((chain) => {
                const market = getMarketByChainId(chain.id);
                const rpcUrl = market ? getAlchemyRpcUrl(market.alchemySlug) : undefined;

                return [
                    chain.id,
                    rpcUrl ? http(rpcUrl, buildTransportConfig(rpcUrl)) : http(),
                ];
            })
        ),
    })
);
