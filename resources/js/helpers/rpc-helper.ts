import { createPublicClient, http, fallback, PublicClient } from 'viem';
import { SUPPORTED_CHAINS, getMarketByChainId } from '../constants/networks';
import logger from '../utils/logger';

export function getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || null;
}

export function isSameOriginRpcUrl(rpcUrl: string): boolean {
    if (rpcUrl.startsWith('/rpc/')) return true;
    if (typeof window === 'undefined') return false;
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
        if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
    }
    return headers;
}

/**
 * Attempts to create a working PublicClient by trying multiple RPC URLs in order.
 * Automatically prepends local proxy URL for better reliability.
 */
export async function createRpcProviderWithFallback(rpcUrls: string[], chainId: number): Promise<PublicClient> {
    if (!rpcUrls || rpcUrls.length === 0) throw new Error('No RPC URLs provided');

    // Simple chain lookup
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
    const market = getMarketByChainId(chainId);
    const slug = market?.alchemySlug;

    // Prepend local proxy URL to the list if we have a slug
    const augmentedUrls = slug ? [`/rpc/${slug}`, ...rpcUrls] : rpcUrls;
    const uniqueUrls = Array.from(new Set(augmentedUrls));

    const transports = uniqueUrls.map(url => http(url, { fetchOptions: { headers: buildTransportHeaders(url) } }));

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
    if (!rpcUrls || rpcUrls.length === 0) throw new Error('No RPC URLs provided');
    
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
    const market = getMarketByChainId(chainId);
    const slug = market?.alchemySlug;
    
    // Prepend local proxy URL to the list if we have a slug
    const augmentedUrls = slug ? [`/rpc/${slug}`, ...rpcUrls] : rpcUrls;
    const uniqueUrls = Array.from(new Set(augmentedUrls));

    const transports = uniqueUrls.map(url => http(url, { fetchOptions: { headers: buildTransportHeaders(url) } }));

    return createPublicClient({
        chain,
        transport: fallback(transports),
    }) as any;
}
