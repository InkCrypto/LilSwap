import axios from 'axios';


import logger from '../utils/logger';
import { notifyApiVersion, notifyApiStatus } from '../context/ApiMetaContext.jsx';
import { logSessionService } from './logSessionService';

// Axios instance configured for the backend
export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/v1',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 45000,
});

// Internal state management
let currentSession = {
    sessionId: null,
    signatureKey: null,
    expiry: 0,
    isInitializing: false,
    isPending: true,
    initPromise: null,
    _resolvePending: null,
    _performFetch: null
};

// Event labels
export const SESSION_EXPIRED_EVENT = 'lilswap:session_expired';

/**
 * Returns current state snapshots (read-only)
 */
export const getSessionData = () => ({ ...currentSession });

/**
 * Synchronizes internal state with the backend.
 * @returns {Promise<Object>} State data
 */
export const syncInternalState = async () => {
    if (currentSession.sessionId) {
        return currentSession;
    }

    if (currentSession.isInitializing) {
        return currentSession.initPromise;
    }

    currentSession.isInitializing = true;
    currentSession.isPending = false;
    
    currentSession.initPromise = (async () => {
        let worker;
        try {
            logger.debug('[Auth] S1');
            const res = await apiClient.get('/auth/init', {
                _skipAuthInterceptor: true
            });
            const { c, d } = res.data;

            logger.debug('[Auth] S2', { d });
            
            const n = await new Promise((resolve, reject) => {
                worker = new Worker(new URL('./integrityWorker.js', import.meta.url), { type: 'module' });
                
                worker.onmessage = (e) => {
                    if (e.data.error) reject(new Error(e.data.error));
                    else resolve(e.data.n);
                };
                
                worker.onerror = (err) => reject(err);
                
                worker.postMessage({ c, d });
            });

            logger.debug('[Auth] S3');

            const response = await apiClient.post('/auth/verify', { c, n }, { 
                _skipAuthInterceptor: true 
            });

            currentSession = {
                ...currentSession,
                sessionId: response.data.sessionId,
                signatureKey: response.data.signatureKey,
                expiry: response.data.expiry,
                isInitializing: false,
                isPending: false,
                initPromise: null,
                _resolvePending: null,
                _performFetch: null
            };

            logSessionService.setSession(
                currentSession.sessionId, 
                currentSession.signatureKey, 
                currentSession.expiry
            );

            return currentSession;
        } catch (error) {
            logger.error('[Auth] State sync failed', error.message || error);
            currentSession.isInitializing = false;
            currentSession.initPromise = null;
            throw error;
        } finally {
            if (worker) worker.terminate();
        }
    })();

    return currentSession.initPromise;
};

// Add request interceptor for logging and security signing
apiClient.interceptors.request.use(
    async (config) => {
        // Skip auth for internal init or if explicitly requested
        if (config._skipAuthInterceptor || config.url === '/auth/session') {
            return config;
        }

        // Wait for session initialization if it's currently in progress
        if ((currentSession.isInitializing || currentSession.isPending) && currentSession.initPromise) {
            try {
                await currentSession.initPromise;
            } catch (err) {
                // If init fails, we proceed and let the regular auth fail if needed
            }
        }

        // Use dynamic session signing if available
        if (currentSession.sessionId && currentSession.signatureKey) {
            const timestamp = Date.now().toString();

            // Handle both fresh (object) and retried (already serialized string) config.data
            let bodyString = '';
            if (config.data) {
                bodyString = typeof config.data === 'string'
                    ? config.data
                    : JSON.stringify(config.data);
            }
            
            try {
                // Use SubtleCrypto to match server-side Node.js crypto.createHmac('sha256', key)
                const enc = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey(
                    'raw',
                    enc.encode(currentSession.signatureKey),
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['sign']
                );
                const signatureBuffer = await crypto.subtle.sign(
                    'HMAC',
                    keyMaterial,
                    enc.encode(timestamp + bodyString)
                );
                const signature = Array.from(new Uint8Array(signatureBuffer))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
                
                config.headers['X-Internal-Signature'] = signature;
                config.headers['X-Internal-Timestamp'] = timestamp;
                config.headers['X-Session-Id'] = currentSession.sessionId;
            } catch (err) {
                // Fail silently
            }
        }


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
        const v = response.headers?.['x-api-version'];
        if (v) notifyApiVersion(v);
        notifyApiStatus(true);
        return response;
    },
    async (error) => {
        const config = error.config;

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

        if (error.response?.status === 401 && !config._skipAuthInterceptor && !config._retryAfterSync) {
            // Clear expired session
            currentSession = {
                sessionId: null,
                signatureKey: null,
                expiry: 0,
                isInitializing: false,
                isPending: false,
                initPromise: null,
                _resolvePending: null,
                _performFetch: null
            };
            logSessionService.setSession(null, null, 0);

            try {
                // Re-initialize session silently (user won't see any loading screen)
                await syncInternalState();
                // Retry original request once with updated session headers
                config._retryAfterSync = true;
                return apiClient(config);
            } catch (syncError) {
                // If re-initialization also fails, notify the UI
                window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
                return Promise.reject(syncError);
            }
        }

        logger.error('API Request Failed', {
            url: config?.url,
            method: config?.method,
            status: error.response?.status
        });

        if (!error.response || error.response.status >= 500 || error.code === 'ECONNABORTED') {
            notifyApiStatus(false);
        }

        return Promise.reject(error);
    }
);

export const getDebtQuote = async (params, signal = null) => {
    try {
        const response = await apiClient.post('/quote/debt', params, { signal });
        logger.debug('Debt quote received', { srcAmount: response.data.srcAmount });
        return response.data;
    } catch (error) {
        if (axios.isCancel(error)) {
            logger.debug('Debt quote request cancelled');
            throw error;
        }
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error fetching quote';
        logger.error('Failed to get debt quote', { error: errorMessage, details: data });
        throw new Error(errorMessage);
    }
};

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

export const getUserPosition = async (walletAddress, chainId) => {
    try {
        const response = await apiClient.post('/position', {
            walletAddress,
            chainId
        });

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

export const getCollateralQuote = async (params, signal = null) => {
    try {
        const response = await apiClient.post('/quote/collateral', params, { signal });
        logger.debug('Collateral quote received', { destAmount: response.data.destAmount });
        return response.data;
    } catch (error) {
        if (axios.isCancel(error)) {
            logger.debug('Collateral quote request cancelled');
            throw error;
        }
        const data = error.response?.data;
        const errorMessage = data?.userMessage || data?.message || data?.error || error.message || 'Error fetching collateral quote';
        logger.error('Failed to get collateral quote', { error: errorMessage, details: data });
        throw new Error(errorMessage);
    }
};

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
