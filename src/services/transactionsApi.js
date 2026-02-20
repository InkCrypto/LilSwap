/**
 * Transactions API Service (Frontend)
 * Comunica com backend para registrar e rastrear transações
 */

import logger from '../utils/logger.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/v1';

/**
 * Atualiza o backend com o txHash após user enviar ao blockchain
 * @param {number} transactionId - ID retornado por buildDebtSwapTx
 * @param {string} txHash - Transaction hash
 * @returns {Promise<boolean>}
 */
export async function recordTransactionHash(transactionId, txHash) {
    try {
        const response = await fetch(`${API_URL}/transactions/${transactionId}/send-hash`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ txHash }),
        });

        if (!response.ok) {
            logger.warn('[Transactions] Failed to record hash:', response.status);
            return false;
        }

        logger.debug('[Transactions] Hash recorded:', { id: transactionId, hash: txHash?.slice(0, 8) });
        return true;
    } catch (error) {
        logger.warn('[Transactions] Error recording hash:', error.message);
        return false;
    }
}

/**
 * Confirma a transação no backend após on-chain confirmation
 * @param {number} transactionId
 * @param {Object} confirmData
 * @param {number} confirmData.gasUsed
 * @param {number} confirmData.actualPaid - Debt amount efetivamente pago (wei)
 * @returns {Promise<boolean>}
 */
export async function confirmTransactionOnChain(transactionId, confirmData) {
    try {
        const payload = {
            gasUsed: confirmData.gasUsed,
            actualPaid: confirmData.actualPaid,
            // optional fields
            srcActualAmount: confirmData.srcActualAmount || null,
            collectorAmount: confirmData.collectorAmount || null,
            priceImplicitUsd: confirmData.priceImplicitUsd || null,
            apyPercent: confirmData.apyPercent || null
        };

        const response = await fetch(`${API_URL}/transactions/${transactionId}/confirm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            logger.warn('[Transactions] Failed to confirm:', response.status);
            return false;
        }

        logger.debug('[Transactions] Confirmed:', { id: transactionId });
        return true;
    } catch (error) {
        logger.warn('[Transactions] Error confirming:', error.message);
        return false;
    }
}

/**
 * Obtém o histórico de transações do usuário
 * @param {string} userAddress
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getUserTransactionHistory(userAddress, limit = 50) {
    try {
        const response = await fetch(
            `${API_URL}/transactions/user/${userAddress}?limit=${limit}`,
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (!response.ok) {
            logger.warn('[Transactions] Failed to fetch history:', response.status);
            return [];
        }

        const data = await response.json();
        return data.transactions || [];
    } catch (error) {
        logger.warn('[Transactions] Error fetching history:', error.message);
        return [];
    }
}
