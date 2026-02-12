import axios from 'axios';

// Axios instance configured for the backend
const apiClient = axios.create({
    baseURL: 'http://localhost:3001',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 45000, // 45s timeout to allow for retries
});

// Add retry interceptor
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error.config;

        // Retry logic for rate limits and network errors
        if (!config || !config.retry) {
            config.retry = { count: 0, maxRetries: 2, delay: 1000 };
        }

        const shouldRetry =
            config.retry.count < config.retry.maxRetries &&
            (error.response?.status === 429 || // Too Many Requests
                error.response?.status === 503 || // Service Unavailable
                error.code === 'ECONNABORTED' ||  // Timeout
                error.message?.includes('rate limit'));

        if (shouldRetry) {
            config.retry.count++;
            const delay = config.retry.delay * Math.pow(2, config.retry.count - 1);

            console.log(`[API Retry ${config.retry.count}/${config.retry.maxRetries}] Waiting ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
            return apiClient(config);
        }

        return Promise.reject(error);
    }
);

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

/**
 * Fetch aggregated user positions (supplies and borrows) from Aave
 * @param {string} userAddress - User wallet address
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Aggregated position data
 */
export const getUserPosition = async (userAddress, chainId) => {
    try {
        const response = await apiClient.get(`/api/position/${userAddress}`, {
            params: { chainId }
        });
        return response.data;
    } catch (error) {
        const errorMessage = error.response?.data?.error || error.message || 'Error fetching position';
        throw new Error(errorMessage);
    }
};

export default {
    getDebtQuote,
    buildDebtSwapTx,
    getUserPosition,
};
