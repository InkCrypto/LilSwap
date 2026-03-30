import { DEFAULT_MARKET, getMarketByKey, getMarketByChainId } from './networks';

/**
 * Re-exports addresses from the network configuration for convenience and legacy compatibility.
 */
export const ADDRESSES = DEFAULT_MARKET.addresses;

export const getAddressesByKey = (marketKey: string) => getMarketByKey(marketKey).addresses;

export const getAddressesByChainId = (chainId: number | string) => getMarketByChainId(Number(chainId)).addresses;
