/**
 * Transactions API Service (Frontend)
 * Communicates with backend to register and track transactions
 */

import logger from '../utils/logger';
import { apiClient } from './api';

const PENDING_HASH_SYNC_STORAGE_KEY = 'lilswap.pendingHashSync.v1';
const HASH_SYNC_MAX_ATTEMPTS = 3;
const HASH_SYNC_RETRY_DELAYS_MS = [0, 750, 2000];

interface PendingHashSyncEntry {
    transactionId: string;
    txHash: string;
    walletAddress?: string | null;
    attempts: number;
    createdAt: number;
    updatedAt: number;
}

function readPendingHashSyncQueue(): PendingHashSyncEntry[] {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        const raw = window.localStorage.getItem(PENDING_HASH_SYNC_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writePendingHashSyncQueue(entries: PendingHashSyncEntry[]) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem(PENDING_HASH_SYNC_STORAGE_KEY, JSON.stringify(entries.slice(0, 100)));
    } catch {
        // Ignore local persistence failures.
    }
}

function upsertPendingHashSyncEntry(entry: PendingHashSyncEntry) {
    const existing = readPendingHashSyncQueue();
    const deduped = existing.filter(item =>
        !(item.transactionId === entry.transactionId && item.txHash.toLowerCase() === entry.txHash.toLowerCase())
    );
    deduped.unshift(entry);
    writePendingHashSyncQueue(deduped);
}

function removePendingHashSyncEntry(transactionId: string | number, txHash: string) {
    const existing = readPendingHashSyncQueue();
    const filtered = existing.filter(item =>
        !(item.transactionId === String(transactionId) && item.txHash.toLowerCase() === txHash.toLowerCase())
    );
    writePendingHashSyncQueue(filtered);
}

function delay(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function sendTransactionHash(transactionId: string | number, txHash: string): Promise<boolean> {
    logger.debug('[Transactions] Sending hash to backend', { transactionId, txHash });
    await apiClient.post(`/transactions/${transactionId}/send-hash`, { txHash });
    logger.debug('[Transactions] Hash recorded:', { id: transactionId, hash: txHash?.slice(0, 8) });
    return true;
}

/**
 * Updates backend with txHash after user sends to blockchain
 * @param transactionId - ID returned by buildDebtSwapTx
 * @param txHash - Transaction hash
 * @returns Promise<boolean>
 */
export async function recordTransactionHash(
    transactionId: string | number,
    txHash: string,
    options: { walletAddress?: string | null } = {}
): Promise<boolean> {
    let lastError: any = null;

    for (let attempt = 0; attempt < HASH_SYNC_MAX_ATTEMPTS; attempt++) {
        try {
            if (attempt > 0) {
                await delay(HASH_SYNC_RETRY_DELAYS_MS[attempt] || HASH_SYNC_RETRY_DELAYS_MS[HASH_SYNC_RETRY_DELAYS_MS.length - 1]);
            }
            await sendTransactionHash(transactionId, txHash);
            removePendingHashSyncEntry(transactionId, txHash);
            return true;
        } catch (error: any) {
            lastError = error;
            const data = error.response?.data;
            const status = error.response?.status;
            logger.warn('[Transactions] Error recording hash', {
                status,
                data: data || error.message,
                attempt: attempt + 1,
                maxAttempts: HASH_SYNC_MAX_ATTEMPTS,
            });
        }
    }

    upsertPendingHashSyncEntry({
        transactionId: String(transactionId),
        txHash,
        walletAddress: options.walletAddress || null,
        attempts: HASH_SYNC_MAX_ATTEMPTS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });

    logger.warn('[Transactions] Hash sync queued for retry', {
        transactionId,
        txHash: txHash?.slice(0, 10),
        error: lastError?.message,
    });

    return false;
}

export async function flushPendingTransactionHashes(walletAddress?: string | null): Promise<number> {
    const queue = readPendingHashSyncQueue();
    if (!queue.length) return 0;

    let flushed = 0;

    for (const entry of queue) {
        if (walletAddress && entry.walletAddress && entry.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
            continue;
        }

        const success = await recordTransactionHash(entry.transactionId, entry.txHash, {
            walletAddress: entry.walletAddress || walletAddress || null,
        });

        if (success) {
            flushed++;
        }
    }

    return flushed;
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
