import { ethers } from 'ethers';
import { ABIS } from '../constants/abis';

/**
 * Helper to get a Debt Token contract instance (Stable or Variable)
 * @param address - The debt token contract address
 * @param runner - An Ethers provider or signer
 */
export const getDebtTokenContract = (address: string, runner: ethers.ContractRunner) => {
    return new ethers.Contract(address, ABIS.DEBT_TOKEN, runner);
};

/**
 * Helper to get a generic ERC20 contract instance
 * @param address - The token address
 * @param runner - An Ethers provider or signer
 */
export const getERC20Contract = (address: string, runner: ethers.ContractRunner) => {
    return new ethers.Contract(address, ABIS.ERC20, runner);
};

/**
 * Helper to get the Aave Pool contract
 * @param address - The Pool address for the active network
 * @param runner - An Ethers provider or signer
 */
export const getPoolContract = (address: string, runner: ethers.ContractRunner) => {
    return new ethers.Contract(address, ABIS.POOL, runner);
};
