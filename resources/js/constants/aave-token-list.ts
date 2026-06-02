// Generated from Aave interface src/ui-config/TokenList.ts.
// Keep this list static so swap selectors match Aave's default token universe per chain.

export interface AaveSwapTokenInfo {
    chainId: number;
    address: string;
    underlyingAsset: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    extensions?: Record<string, unknown>;
    priceInUSD: string;
    isActive: boolean;
    isAaveTokenList: boolean;
}

import tokenList from './aave-token-list.json';

export const AAVE_SWAP_TOKEN_LIST: AaveSwapTokenInfo[] = tokenList as AaveSwapTokenInfo[];

export const getAaveSwapTokensByChainId = (chainId: number): AaveSwapTokenInfo[] => {
    const seen = new Set<string>();

    return AAVE_SWAP_TOKEN_LIST.filter((token) => token.chainId === chainId).filter((token) => {
        const key = token.address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
