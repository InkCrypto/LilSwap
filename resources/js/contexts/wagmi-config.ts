import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { http } from 'wagmi';
import { SUPPORTED_CHAINS, getMarketByChainId, getRpcGatewayUrl, CHAIN_ID_TO_NETWORK } from '../constants/networks';
import { buildTransportConfig } from '../helpers/rpc-helper';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

if (!projectId) {
    throw new Error('Missing VITE_REOWN_PROJECT_ID');
}

const transports = Object.fromEntries(
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
    }),
);

export const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks: [...SUPPORTED_CHAINS],
    transports,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
export const reownProjectId = projectId;
