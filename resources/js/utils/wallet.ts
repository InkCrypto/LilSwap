import logger from './logger';

/**
 * Converts a numeric chainId to hex format required by wallet_switchEthereumChain
 */
export const toHexChainId = (chainId: number | string): string => {
    return '0x' + parseInt(chainId.toString()).toString(16);
};

/**
 * Requests the user's wallet to switch to a specific chain
 */
export const requestChainSwitch = async (chainId: number | string, provider: any = null): Promise<boolean> => {
    const eipProvider = provider?.provider || provider || (typeof window !== 'undefined' ? (window as any).ethereum : null);

    if (!eipProvider || !eipProvider.request) {
        throw new Error('No wallet provider found. Please connect your wallet.');
    }

    const chainHex = typeof chainId === 'string' && chainId.startsWith('0x')
        ? chainId
        : toHexChainId(chainId);

    logger.debug('Requesting chain switch', { chainId, chainHex });

    try {
        await eipProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainHex }]
        });

        logger.info('Chain switch successful', { chainId: chainHex });

        return true;
    } catch (switchError: any) {
        if (switchError.code === 4902) {
            const errorMsg = `Chain ${chainId} is not configured in your wallet. Please add it manually.`;
            logger.warn('Chain not found in wallet', { chainId, code: switchError.code });

            throw new Error(errorMsg);
        }

        if (switchError.code === 4001) {
            const errorMsg = 'You rejected the chain switch request.';
            logger.info('User rejected chain switch', { chainId });

            throw new Error(errorMsg);
        }

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
 */
export const getCurrentChainId = async (provider: any = null): Promise<number> => {
    const eipProvider = provider?.provider || provider || (typeof window !== 'undefined' ? (window as any).ethereum : null);

    if (!eipProvider || !eipProvider.request) {
        throw new Error('No wallet provider found');
    }

    const chainIdHex = await eipProvider.request({ method: 'eth_chainId' });

    return parseInt(chainIdHex, 16);
};
