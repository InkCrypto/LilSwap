import { ethers } from 'ethers';

/**
 * approvalAmount = ceil(srcAmount * (10000 + bufferBps) / 10000)
 * srcAmountBigInt: BigInt
 */
export function calcApprovalAmount(srcAmountBigInt, bufferBps = 0) {
    const numerator = srcAmountBigInt * BigInt(10000 + bufferBps);
    // ceil division
    return (numerator + BigInt(10000) - BigInt(1)) / BigInt(10000);
}

/**
 * minAmountOut = floor(destAmount * (10000 - slippageBps) / 10000)
 */
export function calcMinAmountOut(destAmountBigInt, slippageBps = 50) {
    const numerator = destAmountBigInt * BigInt(10000 - slippageBps);
    return numerator / BigInt(10000);
}

export function parseHumanAmountToWei(amountString, decimals = 18) {
    return ethers.parseUnits(amountString, decimals);
}

export function formatWeiToHuman(amountBigInt, decimals = 18) {
    return ethers.formatUnits(amountBigInt, decimals);
}
