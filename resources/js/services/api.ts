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
        normalized.startsWith('/limit-orders') ||
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

export const getProxySessionIdentity = (): ProxySessionPayload | null => {
    return lastProxySessionPayload;
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

export const waitForProxySessionBootstrap = async () => {
    if (proxySessionBootstrapInFlight) {
        await proxySessionBootstrapInFlight;
    }
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

// Debt Limit Swap Types

export interface DebtLimitPrepareParams {
    walletAddress: string;
    chainId: number;
    marketKey?: string | null;
    fromToken: {
        address: string;
        decimals: number;
        symbol: string;
    };
    toToken: {
        address: string;
        decimals: number;
        symbol: string;
        /** variableDebtToken of the destination asset — required for delegation approval */
        variableDebtTokenAddress: string;
    };
    /** Raw BigInt string — new debt underlying (sell side) */
    sellAmount: string;
    /** Raw BigInt string — old debt underlying (buy side) */
    buyAmount: string;
    /** Unix timestamp for order expiry */
    validTo: number;
    orderType?: 'limit' | 'market';
    slippageBps?: number;
    quoteId?: number;
    quoteSellAmount?: string;
    quoteFeeAmount?: string;
    finalMaxSellAmount?: string;
    partnerFee?: { volumeBps: number; recipient: string };
}

export interface DebtLimitPrepareResult {
    provider: 'limitSwap';
    swapType: 'debt';
    orderType: 'limit' | 'market';
    chainId: number;
    marketKey: string | null;
    validTo: number;
    instanceAddress: string;
    approval: {
        /** Always 'delegation' for Debt Swap */
        type: 'delegation';
        /** Destination variableDebtToken address — NOT the underlying */
        token: string;
        /** Calculated adapter instance address */
        spender: string;
        amount: string;
    };
    orderDraft: {
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        buyAmount: string;
        kind: 'buy';
    };
    debug: Record<string, unknown>;
}

export interface DebtLimitQuoteParams {
    walletAddress: string;
    chainId: number;
    marketKey?: string | null;
    fromToken: {
        address: string;
        decimals: number;
        symbol: string;
    };
    toToken: {
        address: string;
        decimals: number;
        symbol: string;
    };
    buyAmount: string;
    validTo?: number;
}

export interface DebtLimitQuoteResult {
    provider: 'limit';
    swapType: 'debt';
    orderType: 'limit';
    chainId: number;
    marketKey: string | null;
    kind: 'buy';
    quoteId?: number;
    sellToken: string;
    buyToken: string;
    orderToSign?: Record<string, unknown>;
    amountsAndCosts?: Record<string, unknown> | null;
    sellAmount: string;
    buyAmount: string;
    quoteSellAmount?: string;
    quoteFeeAmount?: string;
    finalMaxSellAmount?: string;
    sellTokenDecimals: number;
    buyTokenDecimals: number;
    marketLimitPrice: string | null;
    validTo?: number | null;
    adapterAwareQuote: boolean;
    adapterAwareQuoteReason?: string;
    debug?: Record<string, unknown>;
}

export interface DebtLimitSubmitParams extends DebtLimitPrepareParams {
    approvedAddress?: string | null;
    delegationPermit: {
        amount: string;
        deadline: number;
        v: number;
        r: `0x${string}` | string;
        s: `0x${string}` | string;
    };
}

export interface DebtLimitSubmitResult {
    provider: 'limit';
    swapType: 'debt';
    orderType: 'limit';
    status: 'submitted' | 'signature_required';
    chainId: number;
    marketKey: string | null;
    orderId?: string | null;
    instanceAddress: string;
    requiredSignature?: {
        type: string;
        reason?: string;
    };
    signatureRequest?: {
        type: 'typedData';
        domain: Record<string, unknown>;
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: string;
        message: Record<string, unknown>;
    };
    limitOrder?: Record<string, unknown>;
    swapSettings?: Record<string, unknown>;
    debug?: Record<string, unknown>;
}

export interface DebtLimitPostParams {
    walletAddress: string;
    chainId: number;
    marketKey?: string | null;
    signature: `0x${string}` | string;
    limitOrder: Record<string, unknown>;
    swapSettings: Record<string, unknown>;
    instanceAddress: string;
    quoteSellAmount?: string;
    quoteFeeAmount?: string;
    finalMaxSellAmount?: string;
    fromToken?: {
        address: string;
        decimals: number;
        symbol: string;
    };
    toToken?: {
        address: string;
        decimals: number;
        symbol: string;
    };
    fromAmount?: string;
    toAmount?: string;
    limitPrice?: string;
    priceSource?: 'limit_quote' | string;
    priceInverted?: boolean;
    rawQuote?: DebtLimitQuoteResult | null;
}

export interface DebtLimitPostResult {
    provider: 'limit';
    swapType: 'debt';
    orderType: 'limit';
    status: 'submitted';
    chainId: number;
    marketKey: string | null;
    orderId: string;
    instanceAddress: string;
    debug?: Record<string, unknown>;
}

/**
 * Prepare an Aave Debt Swap limit order.
 *
 * Returns the adapter instance address and the delegation approval target.
 * Does NOT post an order. Does NOT trigger wallet signing.
 *
 * Guard: only call when swapType === 'debt' && orderType === 'limit'
 */
export const prepareDebtLimitSwap = async (
    params: DebtLimitPrepareParams,
): Promise<DebtLimitPrepareResult> => {
    try {
        const response = await apiClient.post('/aave/v3/build/debt/limit/prepare', params);

        return response.data as DebtLimitPrepareResult;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error preparing limit swap');

        throw new Error(errorMessage);
    }
};

export const getDebtLimitQuote = async (
    params: DebtLimitQuoteParams,
): Promise<DebtLimitQuoteResult> => {
    try {
        const response = await apiClient.post('/aave/v3/quote/debt/limit', params);

        return response.data as DebtLimitQuoteResult;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error fetching limit quote');

        throw new Error(errorMessage);
    }
};

export const submitDebtLimitSwap = async (
    params: DebtLimitSubmitParams,
): Promise<DebtLimitSubmitResult> => {
    try {
        const response = await apiClient.post('/aave/v3/build/debt/limit/submit', params);

        return response.data as DebtLimitSubmitResult;
    } catch (error: any) {
        const responseData = error?.response?.data;
        const errorMessage = responseData?.error === 'INSTANCE_ADDRESS_CHANGED'
            ? 'Limit order parameters changed. Please review the limit swap and sign again.'
            : getPublicApiErrorMessage(error, 'Error submitting limit order');

        const submitError = new Error(errorMessage) as Error & {
            code?: string;
            responseData?: any;
        };
        submitError.code = responseData?.error;
        submitError.responseData = responseData;

        throw submitError;
    }
};

export const postDebtLimitSwap = async (
    params: DebtLimitPostParams,
): Promise<DebtLimitPostResult> => {
    try {
        const response = await apiClient.post('/aave/v3/build/debt/limit/post', params);

        return response.data as DebtLimitPostResult;
    } catch (error: any) {
        const errorMessage = getPublicApiErrorMessage(error, 'Error posting limit order');

        throw new Error(errorMessage);
    }
};

export interface LimitOrderHistoryItem {
    id: number | string;
    wallet_address: string;
    chain_id: number | string;
    market_key?: string | null;
    swap_context: 'debt' | string;
    order_mode: 'limit' | string;
    execution_path: string;
    kind: 'buy' | 'sell' | string;
    from_token_symbol: string;
    from_token_address: string;
    from_amount?: string | null;
    to_token_symbol: string;
    to_token_address: string;
    to_amount?: string | null;
    order_sell_token_symbol?: string | null;
    order_sell_token_address?: string | null;
    order_sell_amount?: string | null;
    order_buy_token_symbol?: string | null;
    order_buy_token_address?: string | null;
    order_buy_amount?: string | null;
    limit_price?: string | null;
    price_source?: string | null;
    price_inverted?: number | boolean;
    order_uid: string;
    quote_id?: string | null;
    instance_address?: string | null;
    valid_to: number | string;
    app_data_hash?: string | null;
    app_code?: string | null;
    signing_scheme?: string | null;
    fee_bps?: number | string | null;
    status: string;
    created_at: string;
    updated_at?: string;
}

export interface LimitOrdersResponse {
    orders: LimitOrderHistoryItem[];
    pagination: {
        limit: number;
        offset: number;
        count: number;
    };
}

export const getLimitOrders = async (params: {
    walletAddress: string;
    chainId?: number;
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<LimitOrdersResponse> => {
    if (!params.walletAddress) {
        throw new Error('Wallet address is required to fetch limit orders');
    }

    try {
        const response = await apiClient.get('/limit-orders', { params });

        return response.data as LimitOrdersResponse;
    } catch (error) {
        logger.error('Failed to fetch limit orders', error);

        return {
            orders: [],
            pagination: {
                limit: params.limit || 50,
                offset: params.offset || 0,
                count: 0,
            },
        };
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

export const getDonationConfig = async () => {
    const response = await apiClient.get('/donations/config');

    return response.data;
};

export const getDonationPreflight = async (params: {
    walletAddress: string;
    chainId: number;
    tokenKey: string;
}) => {
    const response = await apiClient.post('/donations/preflight', params);

    return response.data;
};

export const verifyDonationByHash = async (params: { txHash: string; walletAddress?: string | null; chainId?: number | null }) => {
    const response = await apiClient.post('/donations/verify-hash', params);

    return response.data;
};

export const verifyDonationByWallet = async (params: {
    walletAddress: string;
    chainId: number;
    tokenKey: string;
    approximateSentAt: string;
}) => {
    const response = await apiClient.post('/donations/verify-wallet', params);

    return response.data;
};

export default {
    getDebtQuote,
    getDebtLimitQuote,
    buildDebtSwapTx,
    prepareDebtLimitSwap,
    submitDebtLimitSwap,
    postDebtLimitSwap,
    getCollateralQuote,
    buildCollateralSwapTx,
    getUserPosition,
    getDonationConfig,
    getDonationPreflight,
    verifyDonationByHash,
    verifyDonationByWallet,
    bootstrapProxySession,
    disconnectProxySession,
    revalidateSession,
    syncInternalState
};
