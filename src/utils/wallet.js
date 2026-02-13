import logger from './logger';

/**
 * Converts a numeric chainId to hex format required by wallet_switchEthereumChain
 * @param {number} chainId - Numeric chain ID (e.g., 8453)
 * @returns {string} Hex chain ID (e.g., "0x2105")
 */
export const toHexChainId = (chainId) => {
    return '0x' + parseInt(chainId).toString(16);
};

/**
 * Requests the user's wallet to switch to a specific chain
 * @param {number|string} chainId - Chain ID (numeric or hex string)
 * @returns {Promise<boolean>} True if switch was successful
 * @throws {Error} If wallet not found or user rejects the request
 */
export const requestChainSwitch = async (chainId) => {
    if (!window.ethereum) {
        throw new Error('No injected wallet found. Please install MetaMask or another Web3 wallet.');
    }

    const chainHex = typeof chainId === 'string' && chainId.startsWith('0x')
        ? chainId
        : toHexChainId(chainId);

    logger.debug('Requesting chain switch', { chainId, chainHex });

    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainHex }]
        });

        logger.info('Chain switch successful', { chainId: chainHex });
        return true;
    } catch (switchError) {
        // Error code 4902: chain not added to wallet
        if (switchError.code === 4902) {
            const errorMsg = `Chain ${chainId} is not configured in your wallet. Please add it manually.`;
            logger.warn('Chain not found in wallet', { chainId, code: switchError.code });
            throw new Error(errorMsg);
        }

        // Error code 4001: user rejected the request
        if (switchError.code === 4001) {
            const errorMsg = 'You rejected the chain switch request.';
            logger.info('User rejected chain switch', { chainId });
            throw new Error(errorMsg);
        }

        // Other errors
        logger.error('Failed to switch chain', {
            chainId,
            code: switchError.code,
            message: switchError.message
        });
        throw switchError;
    }
};

/**
 * Get the current chain ID from the wallet
 * @returns {Promise<number>} Current chain ID
 */
export const getCurrentChainId = async () => {
    if (!window.ethereum) {
        throw new Error('No injected wallet found');
    }

    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    return parseInt(chainIdHex, 16);
};
