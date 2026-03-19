import { DEFAULT_NETWORK, getNetworkByKey, getNetworkByChainId } from './networks';

/**
 * Re-exports addresses from the network configuration for convenience and legacy compatibility.
 */
export const ADDRESSES = DEFAULT_NETWORK.addresses;

export const getAddressesByKey = (networkKey: string) => getNetworkByKey(networkKey).addresses;

export const getAddressesByChainId = (chainId: number | string) => getNetworkByChainId(Number(chainId)).addresses;
