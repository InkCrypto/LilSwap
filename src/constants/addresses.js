import { DEFAULT_NETWORK, getNetworkByKey, getNetworkByChainId } from './networks.js';

export const ADDRESSES = DEFAULT_NETWORK.addresses;

export const getAddressesByKey = (networkKey) => getNetworkByKey(networkKey).addresses;

export const getAddressesByChainId = (chainId) => getNetworkByChainId(chainId).addresses;
