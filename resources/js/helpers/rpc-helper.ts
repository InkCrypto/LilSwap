import { ethers } from 'ethers';
import logger from '../utils/logger';

function getCsrfToken(): string | null {
    if (typeof document === 'undefined') {
return null;
}

    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || null;
}

function isSameOriginRpcUrl(rpcUrl: string): boolean {
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

function buildProviderConnection(rpcUrl: string): string | ethers.FetchRequest {
    if (!isSameOriginRpcUrl(rpcUrl)) {
        return rpcUrl;
    }

    const request = new ethers.FetchRequest(rpcUrl);
    request.setHeader('X-Requested-With', 'XMLHttpRequest');

    const csrfToken = getCsrfToken();

    if (csrfToken) {
        request.setHeader('X-CSRF-TOKEN', csrfToken);
    }

    return request;
}

/**
 * Attempts to create a working RPC provider by trying multiple RPC URLs in order.
 */
export async function createRpcProviderWithFallback(rpcUrls: string[], timeout: number = 5000): Promise<ethers.JsonRpcProvider> {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    const errors: string[] = [];

    for (const rpcUrl of rpcUrls) {
        try {
            const provider = new ethers.JsonRpcProvider(buildProviderConnection(rpcUrl), undefined, { staticNetwork: true });

            const blockNumberPromise = provider.getBlockNumber();
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), timeout)
            );

            await Promise.race([blockNumberPromise, timeoutPromise]);

            return provider;
        } catch (error: any) {
            const errorMsg = `${rpcUrl}: ${error.message}`;
            errors.push(errorMsg);
            logger.warn(`❌ RPC failed: ${errorMsg}`);
        }
    }

    logger.error('All RPCs failed. Using first URL as fallback:', rpcUrls[0]);
    logger.error('Errors:', errors);

    return new ethers.JsonRpcProvider(rpcUrls[0], undefined, { staticNetwork: true });
}

/**
 * Creates a synchronous RPC provider (doesn't test connection)
 */
export function createRpcProvider(rpcUrls: string[]): ethers.JsonRpcProvider {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    for (const rpcUrl of rpcUrls) {
        try {
            return new ethers.JsonRpcProvider(buildProviderConnection(rpcUrl), undefined, { staticNetwork: true });
        } catch (error: any) {
            logger.warn(`Failed to create provider for ${rpcUrl}:`, error.message);
        }
    }

    return new ethers.JsonRpcProvider(buildProviderConnection(rpcUrls[0]), undefined, { staticNetwork: true });
}
