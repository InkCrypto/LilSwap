import logger from '../utils/logger.js';
/**
 * Retry a promise-based function with exponential backoff
 * Useful for handling temporary RPC provider issues
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 500)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 3000)
 * @param {Function} options.onRetry - Callback on retry (receives attempt number and error)
 * @returns {Promise} Result of the function call
 */
export async function retryWithBackoff(fn, options = {}) {
    const {
        maxAttempts = 3,
        initialDelay = 500,
        maxDelay = 3000,
        onRetry = null,
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Check for rate limit errors (429, Too Many Requests)
            const isRateLimitError =
                error.message?.includes('429') ||
                error.message?.includes('Too Many Requests') ||
                error.message?.includes('rate limit') ||
                error.code === 'CALL_EXCEPTION' ||
                error.message?.includes('Failed to fetch');

            // Don't retry on certain errors (e.g., user rejection, insufficient funds)
            if (error.code === 'ACTION_REJECTED' || error.code === 'INSUFFICIENT_FUNDS') {
                throw error;
            }

            // If this was the last attempt, throw the error
            if (attempt === maxAttempts) {
                throw error;
            }

            // Calculate delay with exponential backoff
            // Use longer delays for rate limit errors
            const baseDelay = isRateLimitError ? initialDelay * 2 : initialDelay;
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

            // Call retry callback if provided
            if (onRetry) {
                onRetry(attempt, error);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * Specialized retry for RPC contract calls
 * Handles common CALL_EXCEPTION errors with appropriate retry logic
 */
export async function retryContractCall(contractCallFn, contractName = 'Contract', options = {}) {
    return retryWithBackoff(contractCallFn, {
        maxAttempts: 5,
        initialDelay: 800,
        maxDelay: 5000,
        onRetry: (attempt, error) => {
            logger.warn(`[Retry ${attempt}/5] ${contractName} call failed:`, error.code || error.message);
        },
        ...options,
    });
}
