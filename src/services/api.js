import axios from 'axios';

// Axios instance configured for the backend
const apiClient = axios.create({
    baseURL: 'http://localhost:3001',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000, // 30s timeout for quotes
});

/**
 * Get quote for Debt Swap
 * @param {Object} params - Quote parameters
 * @param {Object} params.fromToken - Source token (current debt): { address, decimals, symbol }
 * @param {Object} params.toToken - Destination token (new debt): { address, decimals, symbol }
 * @param {string} params.destAmount - Destination amount in string (wei)
 * @param {string} params.userAddress - Adapter address
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Quote data (priceRoute, srcAmount, version, augustus)
 */
export const getDebtQuote = async (params) => {
    try {
        const response = await apiClient.post('/api/quote/debt', params);
        return response.data;
    } catch (error) {
        const errorMessage = error.response?.data?.error || error.message || 'Error fetching quote';
        throw new Error(errorMessage);
    }
};

/**
 * Build Debt Swap transaction via ParaSwap
 * @param {Object} params - Transaction parameters
 * @param {Object} params.priceRoute - ParaSwap route obtained from the quote
 * @param {string} params.srcAmount - Source amount in string (wei)
 * @param {string} params.destAmount - Destination amount in string (wei)
 * @param {Object} params.fromToken - Source token data (address, decimals, symbol)
 * @param {Object} params.toToken - Destination token data (address, decimals, symbol)
 * @param {string} params.userAddress - Adapter address
 * @param {number} params.slippage - Slippage in basis points (e.g., 100 = 1%)
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Transaction data (to, data, value, gasLimit)
 */
export const buildDebtSwapTx = async (params) => {
    try {
        const response = await apiClient.post('/api/build/debt/paraswap', params);
        return response.data;
    } catch (error) {
        const errorMessage = error.response?.data?.error || error.message || 'Error building transaction';
        throw new Error(errorMessage);
    }
};

export default {
    getDebtQuote,
    buildDebtSwapTx,
};
