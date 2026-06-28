import { getDefaultConfig } from 'connectkit';
import { createConfig, http } from 'wagmi';
import { SUPPORTED_CHAINS, getMarketByChainId, getRpcGatewayUrl, CHAIN_ID_TO_NETWORK } from '../constants/networks';
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
                const rpcUrl = market
                    ? getRpcGatewayUrl(market.rpcNetwork)
                    : CHAIN_ID_TO_NETWORK[chain.id]
                        ? getRpcGatewayUrl(CHAIN_ID_TO_NETWORK[chain.id])
                        : undefined;

                return [
                    chain.id,
                    rpcUrl ? http(rpcUrl, buildTransportConfig(rpcUrl)) : http(),
                ];
            })
        ),
    })
);
