import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { Web3Context } from './web3Context.js';
import { DEFAULT_NETWORK, NETWORKS } from '../constants/networks.js';
import { createRpcProvider } from '../helpers/rpcHelper.js';

import logger from '../utils/logger.js';
export const Web3Provider = ({ children }) => {
    const [provider, setProvider] = useState(() => {
        if (typeof window === 'undefined' || !window.ethereum) {
            return null;
        }
        return new ethers.BrowserProvider(window.ethereum);
    });
    const [account, setAccount] = useState(null);
    const [selectedNetworkKey, setSelectedNetworkKey] = useState(DEFAULT_NETWORK.key);
    // Initialize from localStorage - ONLY for manual disconnect by user
    const [manuallyDisconnected, setManuallyDisconnected] = useState(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('walletManuallyDisconnected') === 'true';
    });

    const selectedNetwork = useMemo(() => NETWORKS[selectedNetworkKey] || DEFAULT_NETWORK, [selectedNetworkKey]);
    const allowedNetworks = useMemo(() => [NETWORKS.ETHEREUM, NETWORKS.BASE, NETWORKS.POLYGON, NETWORKS.BNB], []);

    const networkRpcProvider = useMemo(() => {
        const rpcUrls = selectedNetwork?.rpcUrls;
        if (!rpcUrls || rpcUrls.length === 0) {
            return null;
        }

        logger.debug('[Web3Provider] Creating RPC provider for:', selectedNetwork.label);
        logger.debug('[Web3Provider] Available RPCs:', rpcUrls);
        logger.debug('[Web3Provider] Using primary RPC:', rpcUrls[0]);

        return createRpcProvider(rpcUrls);
    }, [selectedNetwork]);

    const initializeProvider = useCallback(() => {
        if (typeof window === 'undefined' || !window.ethereum) {
            return null;
        }
        return new ethers.BrowserProvider(window.ethereum);
    }, []);

    useEffect(() => {
        if (!provider) {
            return undefined;
        }

        let mounted = true;

        const autoConnect = async () => {
            try {
                // Skip auto-connect if user manually disconnected
                if (manuallyDisconnected) {
                    return;
                }
                const accounts = await provider.listAccounts();
                if (!mounted || accounts.length === 0) {
                    return;
                }
                const address = await accounts[0].getAddress();
                if (mounted) {
                    setAccount(address);
                }
            } catch (error) {
                logger.error('Auto-connect failed:', error);
            }
        };

        // Detect and sync current chain from wallet
        const syncChainFromWallet = async () => {
            try {
                if (!window.ethereum) return;

                const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
                const chainId = parseInt(chainIdHex, 16);

                logger.debug('[Web3Provider] Detected wallet chain:', chainId);

                // Find matching network by chainId
                const matchingNetwork = Object.entries(NETWORKS).find(
                    ([_, network]) => network.chainId === chainId
                );

                if (matchingNetwork) {
                    const [networkKey] = matchingNetwork;
                    logger.debug('[Web3Provider] Syncing to network:', networkKey);
                    setSelectedNetworkKey(networkKey);
                } else {
                    logger.warn('[Web3Provider] Unknown chainId:', chainId);
                }
            } catch (error) {
                logger.error('[Web3Provider] Failed to sync chain:', error);
            }
        };

        autoConnect();
        syncChainFromWallet(); // Sync chain on mount and provider change

        const handleAccountsChanged = (accounts) => {
            if (accounts.length > 0) {
                // Accounts available - wallet unlocked or user connected
                setAccount(accounts[0]);
                // If user reconnected via wallet, clear manual disconnect flag
                if (manuallyDisconnected) {
                    setManuallyDisconnected(false);
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('walletManuallyDisconnected');
                    }
                }
            } else {
                // Accounts unavailable - could be wallet lock OR manual disconnect
                // DON'T set localStorage here - we can't distinguish the two scenarios
                // Just clear the account state
                setAccount(null);
            }
        };

        const handleChainChanged = async (chainIdHex) => {
            logger.debug('[Web3Provider] Chain changed event:', chainIdHex);

            // Do NOT re-initialize the entire Ethers provider here.
            // Destroying the provider reference forces all React Context consumers to unmount/remount,
            // which destroys the `prevAddressRef` in our hooks and causes UI flickering.
            // Ethers v6 and the new selectedNetworkKey will handle the data change naturally.

            // Update selectedNetwork based on new chain
            const chainId = parseInt(chainIdHex, 16);
            const matchingNetwork = Object.entries(NETWORKS).find(
                ([_, network]) => network.chainId === chainId
            );

            if (matchingNetwork) {
                const [networkKey] = matchingNetwork;
                logger.debug('[Web3Provider] Network changed to:', networkKey);
                setSelectedNetworkKey(networkKey);
            }
        };

        if (window.ethereum) {
            window.ethereum.on('accountsChanged', handleAccountsChanged);
            window.ethereum.on('chainChanged', handleChainChanged);
        }

        return () => {
            mounted = false;
            if (window.ethereum) {
                window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
                window.ethereum.removeListener('chainChanged', handleChainChanged);
            }
        };
    }, [provider, initializeProvider, manuallyDisconnected]);

    const connectWallet = useCallback(async () => {
        // Clear manual disconnect flag when user explicitly connects
        if (typeof window !== 'undefined') {
            localStorage.removeItem('walletManuallyDisconnected');
        }
        setManuallyDisconnected(false);

        let activeProvider = provider;
        if (!activeProvider) {
            activeProvider = initializeProvider();
            if (!activeProvider) {
                throw new Error('No wallet detected! Please install MetaMask or another Web3 wallet.');
            }
            setProvider(activeProvider);
        }

        // Try request() first (EIP-1193 standard), fallback to send()
        let accounts;
        try {
            if (window.ethereum?.request) {
                accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            } else {
                accounts = await activeProvider.send('eth_requestAccounts', []);
            }
        } catch (error) {
            // User rejected or error occurred
            throw new Error(error.message || 'Failed to connect wallet');
        }

        if (!accounts?.length) {
            throw new Error('No account returned by the wallet.');
        }

        const address = accounts[0];
        setAccount(address);
        return address;
    }, [provider, initializeProvider]);

    const disconnectWallet = useCallback(() => {
        setAccount(null);
        setManuallyDisconnected(true);

        // Persist MANUAL disconnect to localStorage - distinguishes from wallet lock
        if (typeof window !== 'undefined') {
            localStorage.setItem('walletManuallyDisconnected', 'true');
        }

        // Try experimental wallet_revokePermissions (MetaMask 10.17.0+)
        if (window.ethereum?.request) {
            window.ethereum.request({
                method: 'wallet_revokePermissions',
                params: [{ eth_accounts: {} }],
            }).catch(() => {
                // Silently fail - not all wallets support this method
                logger.debug('[Web3Provider] wallet_revokePermissions not supported');
            });
        }

        logger.debug('[Web3Provider] Wallet manually disconnected by user (auto-reconnect disabled)');
    }, []);

    return (
        <Web3Context.Provider
            value={{
                provider,
                account,
                connectWallet,
                disconnectWallet,
                selectedNetwork,
                setSelectedNetwork: setSelectedNetworkKey,
                availableNetworks: allowedNetworks,
                networkRpcProvider,
            }}
        >
            {children}
        </Web3Context.Provider>
    );
};
