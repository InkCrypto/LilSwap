import { ethers } from 'ethers';

/**
 * approvalAmount = ceil(srcAmount * (10000 + bufferBps) / 10000)
 * srcAmountBigInt: bigint
 */
export function calcApprovalAmount(srcAmountBigInt: bigint, bufferBps: number = 0): bigint {
    const numerator = srcAmountBigInt * BigInt(10000 + bufferBps);
    // ceil division
    return (numerator + BigInt(10000) - BigInt(1)) / BigInt(10000);
}

/**
 * minAmountOut = floor(destAmount * (10000 - slippageBps) / 10000)
 */
export function calcMinAmountOut(destAmountBigInt: bigint, slippageBps: number = 50): bigint {
    const numerator = destAmountBigInt * BigInt(10000 - slippageBps);
    return numerator / BigInt(10000);
}

export function parseHumanAmountToWei(amountString: string, decimals: number = 18): bigint {
    return ethers.parseUnits(amountString, decimals);
}

export function formatWeiToHuman(amountBigInt: bigint, decimals: number = 18): string {
    return ethers.formatUnits(amountBigInt, decimals);
}
