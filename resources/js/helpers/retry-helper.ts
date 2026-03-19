import logger from '../utils/logger';

interface RetryOptions {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
}

/**
 * Retries an asynchronous function with exponential backoff.
 * Useful for blockchain calls that might fail due to transient RPC issues.
 *
 * @param fn - The async function to retry
 * @param label - A descriptive label for logging
 * @param options - Configuration for retry logic
 */
export const retryContractCall = async <T>(
    fn: () => Promise<T>,
    label: string = 'Contract Call',
    options: RetryOptions = {}
): Promise<T> => {
    const {
        maxAttempts = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        factor = 2
    } = options;

    let delay = initialDelay;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            // Don't retry if the user rejected the transaction
            if (error.code === 'ACTION_REJECTED' || (error.message && error.message.includes('user rejected'))) {
                throw error;
            }

            if (attempt === maxAttempts) {
                logger.error(`[Retry] ${label} failed after ${maxAttempts} attempts:`, error);

                throw error;
            }

            logger.warn(`[Retry] ${label} attempt ${attempt} failed. Retrying in ${delay}ms...`, { error: error.message });
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            delay = Math.min(delay * factor, maxDelay);
        }
    }

    throw lastError;
};
