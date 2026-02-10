import { ethers } from 'ethers';
import { ABIS } from '../constants/abis.js';
import { ADDRESSES } from '../constants/addresses.js';

export const getPoolContract = (signerOrProvider, addresses = ADDRESSES) =>
    new ethers.Contract(addresses.POOL, ABIS.POOL, signerOrProvider);

export const getDebtTokenContract = (tokenAddress, signerOrProvider) =>
    new ethers.Contract(tokenAddress, ABIS.DEBT_TOKEN, signerOrProvider);

export const getTokenDefsByDirection = (direction, addresses = ADDRESSES) => {
    const isWethToUsdc = direction === 'WETH_TO_USDC';
    const fromToken = isWethToUsdc ? addresses.TOKENS.WETH : addresses.TOKENS.USDC;
    const toToken = isWethToUsdc ? addresses.TOKENS.USDC : addresses.TOKENS.WETH;
    return { fromToken, toToken };
};
