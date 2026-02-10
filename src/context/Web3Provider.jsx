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

    const selectedNetwork = useMemo(() => NETWORKS[selectedNetworkKey] || DEFAULT_NETWORK, [selectedNetworkKey]);
    const allowedNetworks = useMemo(() => [NETWORKS.BASE, NETWORKS.ETHEREUM, NETWORKS.POLYGON, NETWORKS.BNB], []);

    const networkRpcProvider = useMemo(() => {
        const rpcUrls = selectedNetwork?.rpcUrls;
        if (!rpcUrls || rpcUrls.length === 0) {
            return null;
        }

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

        autoConnect();

        const handleAccountsChanged = (accounts) => {
            if (accounts.length > 0) {
                setAccount(accounts[0]);
            } else {
                setAccount(null);
            }
        };

        const handleChainChanged = () => {
            const nextProvider = initializeProvider();
            if (nextProvider) {
                setProvider(nextProvider);
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
    }, [provider, initializeProvider]);

    const connectWallet = useCallback(async () => {
        let activeProvider = provider;
        if (!activeProvider) {
            activeProvider = initializeProvider();
            if (!activeProvider) {
                throw new Error('No wallet detected!');
            }
            setProvider(activeProvider);
        }

        const accounts = await activeProvider.send('eth_requestAccounts', []);
        if (!accounts?.length) {
            throw new Error('No account returned by the wallet.');
        }

        const address = accounts[0];
        setAccount(address);
        return address;
    }, [provider, initializeProvider]);

    return (
        <Web3Context.Provider
            value={{
                provider,
                account,
                connectWallet,
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
