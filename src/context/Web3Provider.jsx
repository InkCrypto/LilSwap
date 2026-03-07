import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { createAppKit, useAppKitProvider, useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet, bsc, polygon, base, arbitrum } from '@reown/appkit/networks';
import { Web3Context } from './web3Context.js';
import { DEFAULT_NETWORK, NETWORKS, getNetworkByChainId } from '../constants/networks.js';
import { createRpcProvider } from '../helpers/rpcHelper.js';
import logger from '../utils/logger.js';

// Get Project ID from env, or use a default one for development/testing if not set
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || 'b8480dbf6f1c429fb1e3fcbefa80c920';

// Define networks for AppKit
const appKitNetworks = [mainnet, arbitrum, polygon, base, bsc];

// Initialize AppKit configuration
const appKitConfig = {
    adapters: [new EthersAdapter()],
    networks: appKitNetworks,
    projectId,
    features: {
        analytics: true,
        email: false,
        socials: []
    },
    // Re-enable injected wallets (MetaMask, Rabby, etc.) natively in the modal.
    // Provider routing is now isolated via the context so hijacking won't occur.
    enableInjected: true,
    enableEIP6963: true,
    enableCoinbase: false,
    themeMode: 'dark'
};

// Create modal instance outside component to prevent re-renders
const modal = createAppKit(appKitConfig);

export const Web3Provider = ({ children }) => {
    // Official AppKit React hooks
    const { address, isConnected } = useAppKitAccount();
    const { walletProvider } = useAppKitProvider('eip155');
    const { chainId } = useAppKitNetwork();

    const [provider, setProvider] = useState(null);
    const [account, setAccount] = useState(null);
    const [selectedNetworkKey, setSelectedNetworkKey] = useState(DEFAULT_NETWORK.key);
    const [isConnecting, setIsConnecting] = useState(false);

    const selectedNetwork = useMemo(() => NETWORKS[selectedNetworkKey] || DEFAULT_NETWORK, [selectedNetworkKey]);
    const allowedNetworks = useMemo(() => [NETWORKS.ETHEREUM, NETWORKS.BASE, NETWORKS.POLYGON, NETWORKS.BNB], []);

    const networkRpcProvider = useMemo(() => {
        const rpcUrls = selectedNetwork?.rpcUrls;
        if (!rpcUrls || rpcUrls.length === 0) return null;
        return createRpcProvider(rpcUrls);
    }, [selectedNetwork]);

    // Update internal state when AppKit account or provider changes
    useEffect(() => {
        if (isConnected && address && walletProvider) {
            setAccount(address);
            // Since we disabled direct injected wallets in AppKit, walletProvider
            // here will reliably be the one the user explicitly chose in the modal.
            setProvider(new ethers.BrowserProvider(walletProvider));
        } else {
            setAccount(null);
            setProvider(null);
        }
    }, [isConnected, address, walletProvider]);

    // Update network when AppKit chain changes
    useEffect(() => {
        if (chainId) {
            const newNetwork = getNetworkByChainId(chainId);
            if (newNetwork) {
                setSelectedNetworkKey(newNetwork.key);
            }
        }
    }, [chainId]);

    const connectWallet = useCallback(async () => {
        try {
            setIsConnecting(true);
            await modal.open();
        } catch (error) {
            logger.error('[Web3Provider] Connection failed:', error);
            throw error;
        } finally {
            setIsConnecting(false);
        }
    }, []);

    const disconnectWallet = useCallback(async () => {
        try {
            await modal.disconnect();
            setAccount(null);
            setProvider(null);
            logger.debug('[Web3Provider] Wallet disconnected');
        } catch (error) {
            logger.error('[Web3Provider] Disconnect failed:', error);
        }
    }, []);

    const changeNetwork = useCallback(async (networkKey) => {
        const targetNetwork = NETWORKS[networkKey];
        if (!targetNetwork) return;

        try {
            const appKitNetwork = appKitNetworks.find(n => n.id === targetNetwork.chainId);
            if (appKitNetwork) {
                await modal.switchNetwork(appKitNetwork);
            }
        } catch (error) {
            logger.error('[Web3Provider] Network switch failed:', error);
        }
    }, []);

    return (
        <Web3Context.Provider
            value={{
                provider,
                account,
                connectWallet,
                disconnectWallet,
                selectedNetwork,
                setSelectedNetwork: changeNetwork,
                availableNetworks: allowedNetworks,
                networkRpcProvider,
                isConnecting,
                modal
            }}
        >
            {children}
        </Web3Context.Provider>
    );
};
