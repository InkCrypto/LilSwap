import axios from 'axios';
import logger from '../utils/logger';
import { notifyApiVersion, notifyApiStatus } from '../context/ApiMetaContext.jsx';

// Axios instance configured for the backend
// Uses VITE_API_URL from environment files (.env.development or .env.production)
export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/v1',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 45000, // 45s timeout to allow for retries
});

// Add request interceptor for logging
apiClient.interceptors.request.use(
    (config) => {
        logger.api(config.method?.toUpperCase() || 'REQUEST', config.url, config.data);
        return config;
    },
    (error) => {
        logger.error('API Request Error', error);
        return Promise.reject(error);
    }
);

// Add retry interceptor
apiClient.interceptors.response.use(
    (response) => {
        // Passively capture the API version from any successful response
        const v = response.headers?.['x-api-version'];
        if (v) notifyApiVersion(v);
        notifyApiStatus(true);
        return response;
    },
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

            logger.warn(`API Retry ${config.retry.count}/${config.retry.maxRetries} - Waiting ${delay}ms`, {
                url: config.url,
                status: error.response?.status,
                error: error.message
            });

            await new Promise(resolve => setTimeout(resolve, delay));
            return apiClient(config);
        }

        // Ignore canceled/aborted requests (expected when switching tokens)
        if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError' || error.message === 'canceled') {
            return Promise.reject(error);
        }

        logger.error('API Request Failed', {
            url: config?.url,
            method: config?.method,
            status: error.response?.status,
            message: error.message
        });

        // If it's a network error or 5xx error, mark API as down
        if (!error.response || error.response.status >= 500 || error.code === 'ECONNABORTED') {
            notifyApiStatus(false);
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
 * @param {string} params.walletAddress - Actual user wallet address
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Quote data (priceRoute, srcAmount, version, augustus)
 */
export const getDebtQuote = async (params, signal = null) => {
    try {
        const response = await apiClient.post('/quote/debt', params, { signal });
        logger.debug('Debt quote received', { srcAmount: response.data.srcAmount });
        return response.data;
    } catch (error) {
        if (axios.isCancel(error)) {
            logger.debug('Debt quote request cancelled');
            throw error; // Let the caller handle or ignore
        }
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error fetching quote';
        logger.error('Failed to get debt quote', { error: errorMessage, details: data });
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
 * @param {string} params.walletAddress - Actual user wallet address
 * @param {number} params.slippageBps - Slippage in basis points (e.g., 100 = 1%)
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Transaction data (to, data, value, gasLimit)
 */
export const buildDebtSwapTx = async (params) => {
    try {
        const response = await apiClient.post('/build/debt/paraswap', params);
        logger.debug('Debt swap transaction built', { to: response.data.to });
        return response.data;
    } catch (error) {
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error building transaction';
        logger.error('Failed to build debt swap transaction', { error: errorMessage, details: data });
        throw new Error(errorMessage);
    }
};

/**
 * Fetch aggregated user positions (supplies and borrows) from Aave
 * @param {string} walletAddress - User wallet address
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Aggregated position data
 */
export const getUserPosition = async (walletAddress, chainId) => {
    try {
        const response = await apiClient.post('/position', {
            walletAddress,
            chainId
        });

        // The backend now wraps even single-chain queries with the chainId key for consistency
        const positionData = response.data[chainId] || response.data;

        logger.debug('User position fetched', {
            supplies: positionData.supplies?.length || 0,
            borrows: positionData.borrows?.length || 0
        });
        return positionData;
    } catch (error) {
        const errorMessage = error.response?.data?.error || error.message || 'Error fetching position';
        logger.error('Failed to fetch user position', { error: errorMessage });
        throw new Error(errorMessage);
    }
};

/**
 * Get quote for Collateral Swap (ExactIn)
 * @param {Object} params - Quote parameters
 * @param {Object} params.fromToken - Source token (current collateral): { address, decimals, symbol }
 * @param {Object} params.toToken - Destination token (new collateral): { address, decimals, symbol }
 * @param {string} params.srcAmount - Source amount in string (wei)
 * @param {string} params.userAddress - Adapter address
 * @param {string} params.walletAddress - Actual user wallet address
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Quote data (priceRoute, destAmount, version, augustus)
 */
export const getCollateralQuote = async (params, signal = null) => {
    try {
        const response = await apiClient.post('/quote/collateral', params, { signal });
        logger.debug('Collateral quote received', { destAmount: response.data.destAmount });
        return response.data;
    } catch (error) {
        if (axios.isCancel(error)) {
            logger.debug('Collateral quote request cancelled');
            throw error; // Let the caller handle or ignore
        }
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error fetching collateral quote';
        logger.error('Failed to get collateral quote', { error: errorMessage, details: data });
        throw new Error(errorMessage);
    }
};

/**
 * Build Collateral Swap transaction via ParaSwap
 * @param {Object} params - Transaction parameters
 * @param {Object} params.priceRoute - ParaSwap route obtained from the quote
 * @param {string} params.srcAmount - Source amount in string (wei)
 * @param {boolean} params.isMaxSwap - Whether it's a full balance swap (requires offset)
 * @param {Object} params.fromToken - Source token data (address, decimals, symbol)
 * @param {Object} params.toToken - Destination token data (address, decimals, symbol)
 * @param {string} params.userAddress - Adapter address
 * @param {string} params.walletAddress - User's wallet address
 * @param {number} params.slippageBps - Slippage in basis points (e.g., 50 = 0.5%)
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<Object>} Transaction data
 */
export const buildCollateralSwapTx = async (params) => {
    try {
        const response = await apiClient.post('/build/collateral/paraswap', params);
        logger.debug('Collateral swap transaction built', { augustus: response.data.augustus });
        return response.data;
    } catch (error) {
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error building collateral transaction';
        logger.error('Failed to build collateral swap transaction', { error: errorMessage, details: data });
        throw new Error(errorMessage);
    }
};

export default {
    getDebtQuote,
    buildDebtSwapTx,
    getCollateralQuote,
    buildCollateralSwapTx,
    getUserPosition,
};
