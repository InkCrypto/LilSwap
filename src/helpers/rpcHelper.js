import { ethers } from 'ethers';

/**
 * Attempts to create a working RPC provider by trying multiple RPC URLs in order.
 * Returns the first successful provider or the last attempted one if all fail.
 *
 * @param {string[]} rpcUrls - Array of RPC URLs to try
 * @param {number} timeout - Timeout in ms for testing each RPC (default: 5000)
 * @returns {Promise<ethers.JsonRpcProvider>} Working RPC provider
 */
export async function createRpcProviderWithFallback(rpcUrls, timeout = 5000) {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    const errors = [];

    for (const rpcUrl of rpcUrls) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);

            // Test the connection with a timeout
            const blockNumberPromise = provider.getBlockNumber();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), timeout)
            );

            await Promise.race([blockNumberPromise, timeoutPromise]);

            return provider;
        } catch (error) {
            const errorMsg = `${rpcUrl}: ${error.message}`;
            errors.push(errorMsg);
            console.warn(`❌ RPC failed: ${errorMsg}`);
        }
    }

    // All RPCs failed - return the first one as fallback
    console.error('All RPCs failed. Using first URL as fallback:', rpcUrls[0]);
    console.error('Errors:', errors);
    return new ethers.JsonRpcProvider(rpcUrls[0]);
}

/**
 * Creates a synchronous RPC provider (doesn't test connection)
 * Falls back to next URL only if provider creation throws an error
 *
 * @param {string[]} rpcUrls - Array of RPC URLs to try
 * @returns {ethers.JsonRpcProvider} RPC provider
 */
export function createRpcProvider(rpcUrls) {
    if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error('No RPC URLs provided');
    }

    for (const rpcUrl of rpcUrls) {
        try {
            return new ethers.JsonRpcProvider(rpcUrl);
        } catch (error) {
            console.warn(`Failed to create provider for ${rpcUrl}:`, error.message);
        }
    }

    // Fallback to first URL
    return new ethers.JsonRpcProvider(rpcUrls[0]);
}
