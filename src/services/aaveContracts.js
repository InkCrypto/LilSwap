import { ethers } from 'ethers';
import { ABIS } from '../constants/abis.js';
import { ADDRESSES } from '../constants/addresses.js';

export const getPoolContract = (signerOrProvider, addresses = ADDRESSES) =>
    new ethers.Contract(addresses.POOL, ABIS.POOL, signerOrProvider);

export const getDebtTokenContract = (tokenAddress, signerOrProvider) =>
    new ethers.Contract(tokenAddress, ABIS.DEBT_TOKEN, signerOrProvider);
