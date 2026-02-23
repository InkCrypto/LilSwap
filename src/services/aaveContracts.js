import { ethers } from 'ethers';
import { ABIS } from '../constants/abis.js';
import { ADDRESSES } from '../constants/addresses.js';

export const getPoolContract = (signerOrProvider, addresses = ADDRESSES) =>
    new ethers.Contract(addresses.POOL, ABIS.POOL, signerOrProvider);

export const getDebtTokenContract = (tokenAddress, signerOrProvider) =>
    new ethers.Contract(tokenAddress, ABIS.DEBT_TOKEN, signerOrProvider);

export const getTokenDefsByDirection = (direction, addresses = ADDRESSES) => {
    const isWethToUsdc = direction === 'WETH_TO_USDC';

    // Try to get native token (WETH, WBNB, WPOL, etc.)
    const nativeToken = addresses.TOKENS.WETH
        || addresses.TOKENS.WBNB
        || addresses.TOKENS.WPOL
        || addresses.TOKENS.ETH;

    // Try to get stablecoin (USDC, USDT, DAI, etc.)
    const stablecoin = addresses.TOKENS.USDC
        || addresses.TOKENS.USDCn
        || addresses.TOKENS.USDT
        || addresses.TOKENS.DAI;

    if (!nativeToken || !stablecoin) {
        throw new Error('Required tokens not found for this network');
    }

    const fromToken = isWethToUsdc ? nativeToken : stablecoin;
    const toToken = isWethToUsdc ? stablecoin : nativeToken;

    return { fromToken, toToken };
};
