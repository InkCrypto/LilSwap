import { getAddress, isHex, type Address, type Hex } from 'viem';

import type { EngineTransactionRequest } from '../services/api';

export interface PreparedEngineTransactionRequest {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
}

export const prepareEngineTransactionRequest = (
    request: EngineTransactionRequest | null | undefined,
    expected: { account: string; chainId: number; target: string },
): PreparedEngineTransactionRequest => {
    if (!request || !request.to || !request.data || !isHex(request.data)) {
        throw new Error('Engine did not return a valid transaction request');
    }
    if (request.chainId !== expected.chainId || getAddress(request.to) !== getAddress(expected.target)) {
        throw new Error('Engine returned an unexpected transaction target');
    }

    return {
        account: getAddress(expected.account),
        to: getAddress(request.to),
        data: request.data,
        value: BigInt(request.value || 0),
    };
};