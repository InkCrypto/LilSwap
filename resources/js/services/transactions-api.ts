/**
 * Transactions API Service (Frontend)
 * Communicates with backend to register and track transactions
 */

import logger from '../utils/logger';
import { apiClient } from './api';

/**
 * Updates backend with txHash after user sends to blockchain
 * @param transactionId - ID returned by buildDebtSwapTx
 * @param txHash - Transaction hash
 * @returns Promise<boolean>
 */
export async function recordTransactionHash(transactionId: string | number, txHash: string): Promise<boolean> {
    try {
        logger.debug('[Transactions] Sending hash to backend', { transactionId, txHash });
        await apiClient.post(`/transactions/${transactionId}/send-hash`, { txHash });

        logger.debug('[Transactions] Hash recorded:', { id: transactionId, hash: txHash?.slice(0, 8) });

        return true;
    } catch (error: any) {
        const data = error.response?.data;
        const status = error.response?.status;
        logger.warn('[Transactions] Error recording hash', { status, data: data || error.message });

        return false;
    }
}

interface ConfirmData {
    gasUsed: string | number;
    actualPaid: string;
    srcActualAmount?: string | null;
    collectorAmount?: string | null;
    priceImplicitUsd?: string | null;
    apyPercent?: number | null;
    gasPrice?: string | null;
    txFee?: string | null;
}

/**
 * Confirms the transaction on backend after on-chain confirmation
 * @param transactionId
 * @param confirmData
 * @returns Promise<boolean>
 */
export async function confirmTransactionOnChain(transactionId: string | number, confirmData: ConfirmData): Promise<boolean> {
    try {
        const payload = {
            gasUsed: confirmData.gasUsed,
            actualPaid: confirmData.actualPaid,
            srcActualAmount: confirmData.srcActualAmount || null,
            collectorAmount: confirmData.collectorAmount || null,
            priceImplicitUsd: confirmData.priceImplicitUsd || null,
            apyPercent: confirmData.apyPercent || null,
            gasPrice: confirmData.gasPrice || null,
            txFee: confirmData.txFee || null
        };

        await apiClient.post(`/transactions/${transactionId}/confirm`, payload);

        logger.debug('[Transactions] Confirmed:', { id: transactionId });

        return true;
    } catch (error: any) {
        logger.warn('[Transactions] Error confirming:', error.response?.status || error.message);

        return false;
    }
}

/**
 * Gets user transaction history
 * @param walletAddress
 * @param limit
 * @returns Promise<any[]>
 */
export async function getUserTransactionHistory(walletAddress: string, limit = 50): Promise<any[]> {
    try {
        const response = await apiClient.get(`/transactions/user/${walletAddress}`, {
            params: { limit }
        });

        return response.data.transactions || [];
    } catch (error: any) {
        logger.warn('[Transactions] Error fetching history:', error.response?.status || error.message);

        return [];
    }
}

/**
 * Marks a transaction as rejected by user
 */
export async function rejectTransaction(transactionId: string | number, reason: string): Promise<boolean> {
    try {
        await apiClient.post(`/transactions/${transactionId}/reject`, { reason });

        return true;
    } catch (err: any) {
        logger.warn('[Transactions] reject failure', err.response?.status || err.message);

        return false;
    }
}

/**
 * Manually marks transaction as failed (debugging/fallback)
 */
export async function failTransaction(transactionId: string | number, reason: string): Promise<boolean> {
    try {
        await apiClient.post(`/transactions/${transactionId}/fail`, { reason });

        return true;
    } catch (err: any) {
        logger.warn('[Transactions] fail failure', err.response?.status || err.message);

        return false;
    }
}
