import { getAddress, parseAbi } from 'viem';
import { useCallback, useState } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import logger from '../utils/logger';
import { isUserRejectedError } from '../utils/logger';

interface UseCollateralToggleActionsProps {
    account: string | null;
    selectedNetwork: any;
    addLog?: (message: string, type?: string) => void;
    onTxSent?: (hash: string) => void;
    onSuccess?: () => void;
}

export const useCollateralToggleActions = ({
    account,
    selectedNetwork,
    addLog,
    onTxSent,
    onSuccess,
}: UseCollateralToggleActionsProps) => {
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    const [isActionLoading, setIsActionLoading] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;
    const poolAddress = networkAddresses.POOL;
    const chainId = targetNetwork.chainId;

    const toggleCollateral = useCallback(async (assetAddress: string, useAsCollateral: boolean) => {
        if (!account || !walletClient || !poolAddress) {
            const missing = !account ? 'account' : !walletClient ? 'walletClient' : 'poolAddress';
            logger.error(`[useCollateralToggleActions] Cannot toggle: ${missing} is missing`, {
                account: !!account,
                hasWallet: !!walletClient,
                pool: poolAddress
            });
            setTxError(`Connection error: ${missing} not found. Please try again.`);
            setIsActionLoading(false);
            return;
        }

        setTxError(null);
        setIsActionLoading(true);

        try {
            // Ensure correct network
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== chainId) {
                await walletClient.switchChain({ id: chainId });
            }

            addLog?.(`${useAsCollateral ? 'Enabling' : 'Disabling'} collateral...`, 'info');

            logger.debug('[useCollateralToggleActions] Sending transaction', {
                pool: poolAddress,
                asset: assetAddress,
                useAsCollateral,
                account
            });

            const hash = await walletClient.writeContract({
                account: getAddress(account),
                address: getAddress(poolAddress),
                abi: parseAbi(ABIS.POOL),
                functionName: 'setUserUseReserveAsCollateral',
                args: [getAddress(assetAddress), useAsCollateral],
            });

            addLog?.('Transaction broadcasted. Waiting for confirmation...', 'warning');
            onTxSent?.(hash);

            const receipt = await publicClient?.waitForTransactionReceipt({ hash });

            if (receipt?.status === 'reverted') {
                throw new Error('Transaction reverted on-chain.');
            }

            addLog?.(`Successfully ${useAsCollateral ? 'enabled' : 'disabled'} collateral!`, 'success');
            onSuccess?.();

        } catch (error: any) {
            if (isUserRejectedError(error)) {
                addLog?.('Cancelled by user.', 'warning');
            } else {
                const message = error.shortMessage || error.message || 'Transaction failed';
                setTxError(message);
                addLog?.(`Error: ${message}`, 'error');
                logger.error('[useCollateralToggleActions] Toggle failed', { error, assetAddress, useAsCollateral });
            }
        } finally {
            setIsActionLoading(false);
        }
    }, [account, walletClient, poolAddress, chainId, addLog, onTxSent, onSuccess, publicClient]);

    return {
        isActionLoading,
        txError,
        toggleCollateral,
        clearError: () => setTxError(null),
    };
};
