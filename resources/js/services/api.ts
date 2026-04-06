import axios from 'axios';
import { notifyApiVersion, notifyApiStatus } from '../contexts/api-meta-context';
import { getPublicApiErrorMessage } from '../utils/api-error';
import logger from '../utils/logger';

// Axios instance configured to point to the Laravel BFF Proxy
export const apiClient = axios.create({
    baseURL: '/',
    headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest', // Standard for Laravel/Inertia
    },
    withCredentials: true,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    timeout: 45000,
});

// Event labels
export const SESSION_EXPIRED_EVENT = 'lilswap:session_expired';

type ProxySessionPayload = {
    walletAddress?: string | null;
    chainId?: number | null;
};

let lastProxySessionPayload: ProxySessionPayload | null = null;
let proxySessionBootstrapInFlight: Promise<any> | null = null;

const isProtectedProxyEndpoint = (url?: string | null) => {
    if (!url) {
return false;
}

    const normalized = String(url).toLowerCase();

    return (
        normalized.startsWith('/aave/') ||
        normalized.startsWith('/rpc/') ||
        normalized.startsWith('/transactions/') ||
        normalized.startsWith('/api/')
    );
};

const runProxyBootstrap = (payload: ProxySessionPayload) => {
    if (proxySessionBootstrapInFlight) {
        return proxySessionBootstrapInFlight;
    }

    proxySessionBootstrapInFlight = apiClient.post('/session/bootstrap', payload, {
        baseURL: '/',
    }).finally(() => {
        proxySessionBootstrapInFlight = null;
    });

    return proxySessionBootstrapInFlight;
};

export const setProxySessionIdentity = (payload: ProxySessionPayload | null) => {
    lastProxySessionPayload = payload;
};

/**
 * Sync Internal State (Placeholder)
 */
export const syncInternalState = async () => {
    return { status: 'static' };
};

/**
 * Revalidate Session (Placeholder)
 */
export const revalidateSession = async () => {
    return { status: 'static' };
};

export const bootstrapProxySession = async (payload: { walletAddress?: string | null; chainId?: number | null }) => {
    lastProxySessionPayload = payload;
    const response = await runProxyBootstrap(payload);

    return response.data;
};

export const disconnectProxySession = async () => {
    try {
        await apiClient.post('/session/disconnect', {}, { baseURL: '/' });
        lastProxySessionPayload = null;
    } catch (error) {
        logger.warn('Failed to disconnect proxy session', { error: (error as any)?.message });
    }
};

/**
 * Fetch a paginated list of the user's transaction history from the database
 */
export const getUserTransactionsHistory = async (walletAddress: string, limit = 20, offset = 0) => {
    if (!walletAddress) {
        throw new Error('Wallet address is required to fetch history');
    }

    try {
        const response = await apiClient.post(`/transactions/history`, {
            walletAddress,
            limit,
            offset
        });
        
        return response.data;
    } catch (error) {
        logger.error('Failed to fetch user transaction history', error);
        
        return { transactions: [], count: 0 };
    }
};

// Request Interceptor: Logging only
// HMAC signing is now handled by the Laravel ApiController
apiClient.interceptors.request.use(
    async (config) => {
        if (isProtectedProxyEndpoint(config.url) && proxySessionBootstrapInFlight) {
            await proxySessionBootstrapInFlight;
        }

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        if (csrfToken) {
            config.headers = config.headers || {};

            if (!(config.headers as any)['X-CSRF-TOKEN']) {
                (config.headers as any)['X-CSRF-TOKEN'] = csrfToken;
            }
        }

        logger.api(config.method?.toUpperCase() || 'REQUEST', config.url || '', config.data);

        return config;
    },
    (error) => {
        logger.error('API Request Error', error);

        return Promise.reject(error);
    }
);

// Response Interceptor: Error handling and version tracking
apiClient.interceptors.response.use(
    (response) => {
        const version = response.headers['x-api-version'] || response.headers['X-Api-Version'];

        if (version) {
            notifyApiVersion(version);
            notifyApiStatus(true);
        }

        return response;
    },
    async (error) => {
        const config = error.config;

        const reasonCode = error.response?.data?.reason_code;
        const canRecoverSession =
            error.response?.status === 401 &&
            reasonCode === 'APP_PROXY_SESSION_BINDING_REQUIRED' &&
            !!config &&
            !config.__proxySessionRetried &&
            isProtectedProxyEndpoint(config.url) &&
            !!lastProxySessionPayload?.walletAddress;

        if (canRecoverSession) {
            try {
                await runProxyBootstrap(lastProxySessionPayload as ProxySessionPayload);
                config.__proxySessionRetried = true;

                return apiClient(config);
            } catch (bootstrapError) {
                logger.warn('Proxy session auto-recovery failed', {
                    error: (bootstrapError as any)?.message,
                });
            }
        }

        if (!config || !config.retry) {
            config.retry = { count: 0, maxRetries: 2, delay: 1000 };
        }

        const shouldRetry =
            config.retry.count < config.retry.maxRetries &&
            (error.response?.status === 429 ||
                error.response?.status === 503 ||
                error.code === 'ECONNABORTED' ||
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

        if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError' || error.message === 'canceled') {
            return Promise.reject(error);
        }

        logger.error('API Request Failed', {
            url: config?.url,
            method: config?.method,
            status: error.response?.status
        });

        return Promise.reject(error);
    }
);

// --- API Methods ---

export const getDebtQuote = async (params: any, signal?: AbortSignal) => {
    try {
        const response = await apiClient.post('/aave/v3/quote/debt', params, { signal });
        logger.debug('Debt quote received', { srcAmount: response.data.srcAmount });

        return response.data;
    } catch (error: any) {
        if (axios.isCancel(error)) {
throw error;
}

        const errorMessage = getPublicApiErrorMessage(error, 'Error fetching quote');

        throw new Error(errorMessage);
    }
};

export const buildDebtSwapTx = async (params: any) => {
    try {
        const response = await apiClient.post('/aave/v3/build/debt/paraswap', params);

        return response.data;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error building transaction');

        throw new Error(errorMessage);
    }
};

export const getUserPosition = async (walletAddress: string, marketKey?: string, chainId?: number) => {
    try {
        const response = await apiClient.post('/aave/v3/positions', {
            walletAddress,
            marketKey,
            chainId
        });

        if (marketKey) {
            return response.data[marketKey] || response.data;
        }

        if (chainId) {
            return response.data[chainId] || response.data;
        }

        return response.data;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error fetching position');

        throw new Error(errorMessage);
    }
};

export const getCollateralQuote = async (params: any, signal?: AbortSignal) => {
    try {
        const response = await apiClient.post('/aave/v3/quote/collateral', params, { signal });

        return response.data;
    } catch (error: any) {
        if (axios.isCancel(error)) {
throw error;
}

        const errorMessage = getPublicApiErrorMessage(error, 'Error fetching collateral quote');

        throw new Error(errorMessage);
    }
};

export const buildCollateralSwapTx = async (params: any) => {
    try {
        const response = await apiClient.post('/aave/v3/build/collateral/paraswap', params);

        return response.data;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error building collateral transaction');

        throw new Error(errorMessage);
    }
};

export default {
    getDebtQuote,
    buildDebtSwapTx,
    getCollateralQuote,
    buildCollateralSwapTx,
    getUserPosition,
    bootstrapProxySession,
    disconnectProxySession,
    revalidateSession,
    syncInternalState
};
