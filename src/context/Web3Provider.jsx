import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { Web3Context } from './web3Context.js';
import { DEFAULT_NETWORK, NETWORKS } from '../constants/networks.js';
import { createRpcProvider } from '../helpers/rpcHelper.js';

export const Web3Provider = ({ children }) => {
    const [provider, setProvider] = useState(() => {
        if (typeof window === 'undefined' || !window.ethereum) {
            return null;
        }
        return new ethers.BrowserProvider(window.ethereum);
    });
    const [account, setAccount] = useState(null);
    const [selectedNetworkKey, setSelectedNetworkKey] = useState(DEFAULT_NETWORK.key);
    // Initialize from localStorage - persist disconnect state across page reloads
    const [userDisconnected, setUserDisconnected] = useState(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('walletDisconnected') === 'true';
    });

    const selectedNetwork = useMemo(() => NETWORKS[selectedNetworkKey] || DEFAULT_NETWORK, [selectedNetworkKey]);
    const allowedNetworks = useMemo(() => [NETWORKS.ETHEREUM, NETWORKS.BASE, NETWORKS.POLYGON, NETWORKS.BNB], []);

    const networkRpcProvider = useMemo(() => {
        const rpcUrls = selectedNetwork?.rpcUrls;
        if (!rpcUrls || rpcUrls.length === 0) {
            return null;
        }

        console.log('[Web3Provider] Creating RPC provider for:', selectedNetwork.label);
        console.log('[Web3Provider] Available RPCs:', rpcUrls);
        console.log('[Web3Provider] Using primary RPC:', rpcUrls[0]);

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
                if (userDisconnected) {
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
                console.error('Auto-connect failed:', error);
            }
        };

        // Detect and sync current chain from wallet
        const syncChainFromWallet = async () => {
            try {
                if (!window.ethereum) return;

                const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
                const chainId = parseInt(chainIdHex, 16);

                console.log('[Web3Provider] Detected wallet chain:', chainId);

                // Find matching network by chainId
                const matchingNetwork = Object.entries(NETWORKS).find(
                    ([_, network]) => network.chainId === chainId
                );

                if (matchingNetwork) {
                    const [networkKey] = matchingNetwork;
                    console.log('[Web3Provider] Syncing to network:', networkKey);
                    setSelectedNetworkKey(networkKey);
                } else {
                    console.warn('[Web3Provider] Unknown chainId:', chainId);
                }
            } catch (error) {
                console.error('[Web3Provider] Failed to sync chain:', error);
            }
        };

        autoConnect();
        syncChainFromWallet(); // Sync chain on mount and provider change

        const handleAccountsChanged = (accounts) => {
            if (accounts.length > 0) {
                setAccount(accounts[0]);
            } else {
                // User disconnected from wallet extension
                setAccount(null);
                setUserDisconnected(true);
                if (typeof window !== 'undefined') {
                    localStorage.setItem('walletDisconnected', 'true');
                }
            }
        };

        const handleChainChanged = async (chainIdHex) => {
            console.log('[Web3Provider] Chain changed event:', chainIdHex);

            const nextProvider = initializeProvider();
            if (nextProvider) {
                setProvider(nextProvider);
            }

            // Update selectedNetwork based on new chain
            const chainId = parseInt(chainIdHex, 16);
            const matchingNetwork = Object.entries(NETWORKS).find(
                ([_, network]) => network.chainId === chainId
            );

            if (matchingNetwork) {
                const [networkKey] = matchingNetwork;
                console.log('[Web3Provider] Network changed to:', networkKey);
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
    }, [provider, initializeProvider, userDisconnected]);

    const connectWallet = useCallback(async () => {
        // Clear disconnect flag from localStorage when user manually connects
        if (typeof window !== 'undefined') {
            localStorage.removeItem('walletDisconnected');
        }
        setUserDisconnected(false);

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
        setUserDisconnected(true);

        // Persist disconnect state to localStorage to prevent auto-reconnect on page reload
        if (typeof window !== 'undefined') {
            localStorage.setItem('walletDisconnected', 'true');
        }

        // Try experimental wallet_revokePermissions (MetaMask 10.17.0+)
        // This is optional and not supported by all wallets
        if (window.ethereum?.request) {
            window.ethereum.request({
                method: 'wallet_revokePermissions',
                params: [{ eth_accounts: {} }],
            }).catch(() => {
                // Silently fail - not all wallets support this method
                console.log('[Web3Provider] wallet_revokePermissions not supported');
            });
        }

        console.log('[Web3Provider] Wallet disconnected (local state cleared, auto-reconnect disabled)');
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
