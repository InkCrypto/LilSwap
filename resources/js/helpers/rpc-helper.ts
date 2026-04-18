import type { PublicClient } from 'viem';
import { createPublicClient, http, fallback } from 'viem';
import { SUPPORTED_CHAINS, getMarketByChainId } from '../constants/networks';
import { bootstrapProxySession, getProxySessionIdentity, waitForProxySessionBootstrap } from '../services/api';
import logger from '../utils/logger';

export function getCsrfToken(): string | null {
    if (typeof document === 'undefined') {
        return null;
    }

    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || null;
}

export function isSameOriginRpcUrl(rpcUrl: string): boolean {
    if (rpcUrl.startsWith('/rpc/')) {
        return true;
    }

    if (typeof window === 'undefined') {
        return false;
    }

    try {
        const url = new URL(rpcUrl, window.location.origin);

        return url.origin === window.location.origin && url.pathname.startsWith('/rpc/');
    } catch {
        return false;
    }
}

export function buildTransportHeaders(rpcUrl: string): Record<string, string> {
    const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
    };

    if (isSameOriginRpcUrl(rpcUrl)) {
        const csrfToken = getCsrfToken();

        if (csrfToken) {
            headers['X-CSRF-TOKEN'] = csrfToken;
        }
    }

    return headers;
}

type ViemHttpTransportConfig = {
    fetchOptions?: RequestInit;
    fetchFn?: typeof fetch;
};

export function buildTransportConfig(rpcUrl: string): ViemHttpTransportConfig {
    const headers = buildTransportHeaders(rpcUrl);

    if (!isSameOriginRpcUrl(rpcUrl)) {
        return {
            fetchOptions: { headers },
        };
    }

    return {
        fetchOptions: {
            headers,
            credentials: 'include',
        },
        fetchFn: async (input: RequestInfo | URL, init?: RequestInit) => {
            await waitForProxySessionBootstrap();
            const requestInit: RequestInit = {
                ...init,
                credentials: init?.credentials ?? 'include',
            };
            const response = await fetch(input, requestInit);

            if (response.status !== 401) {
                return response;
            }

            let reasonCode: string | undefined;

            try {
                const data = await response.clone().json() as { reason_code?: string };
                reasonCode = data?.reason_code;
            } catch {
                reasonCode = undefined;
            }

            if (reasonCode !== 'APP_PROXY_SESSION_BINDING_REQUIRED') {
                return response;
            }

            try {
                const payload = getProxySessionIdentity() ?? { walletAddress: null, chainId: null };
                await bootstrapProxySession(payload);

                return fetch(input, requestInit);
            } catch (error) {
                logger.warn('[RPC] Proxy session auto-recovery failed', {
                    error: (error as any)?.message,
                });

                return response;
            }
        },
    };
}

/**
 * Attempts to create a working PublicClient by trying multiple RPC URLs in order.
 * Automatically prepends local proxy URL for better reliability.
 */
export async function createRpcProviderWithFallback(rpcUrls: string[], chainId: number): Promise<PublicClient> {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    // Simple chain lookup
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
    const market = getMarketByChainId(chainId);
    const slug = market?.alchemySlug;

    // Prepend local proxy URL to the list if we have a slug
    const augmentedUrls = slug ? [`/rpc/${slug}`, ...rpcUrls] : rpcUrls;
    const uniqueUrls = Array.from(new Set(augmentedUrls));

    const transports = uniqueUrls.map(url => http(url, buildTransportConfig(url)));

    const client = createPublicClient({
        chain,
        transport: fallback(transports, { rank: true }),
    });

    try {
        await client.getBlockNumber();

        return client as any;
    } catch (error) {
        logger.error('All RPCs failed for fallbacked client:', error);

        // Return anyway as a fallback client
        return client as any;
    }
}

/**
 * Creates a synchronous RPC client.
 * Automatically prepends local proxy URL.
 */
export function createRpcProvider(rpcUrls: string[], chainId: number): PublicClient {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
    const market = getMarketByChainId(chainId);
    const slug = market?.alchemySlug;

    // Prepend local proxy URL to the list if we have a slug
    const augmentedUrls = slug ? [`/rpc/${slug}`, ...rpcUrls] : rpcUrls;
    const uniqueUrls = Array.from(new Set(augmentedUrls));

    const transports = uniqueUrls.map(url => http(url, buildTransportConfig(url)));

    return createPublicClient({
        chain,
        transport: fallback(transports),
    }) as any;
}
