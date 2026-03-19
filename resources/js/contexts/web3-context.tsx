import React, { createContext, useContext, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { ethers } from 'ethers';
import { createAppKit, useAppKitProvider, useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet, bsc, polygon, base, arbitrum, avalanche } from '@reown/appkit/networks';
import { DEFAULT_NETWORK, NETWORKS, getNetworkByChainId, NetworkConfig } from '../constants/networks';
import { createRpcProvider } from '../helpers/rpc-helper';
import { bootstrapProxySession, disconnectProxySession, setProxySessionIdentity } from '../services/api';
import logger from '../utils/logger';

interface Web3ContextType {
    provider: ethers.BrowserProvider | null;
    account: string | null;
    connectWallet: () => Promise<void>;
    disconnectWallet: () => Promise<void>;
    selectedNetwork: NetworkConfig;
    setSelectedNetwork: (networkKey: string) => Promise<void>;
    availableNetworks: NetworkConfig[];
    networkRpcProvider: ethers.JsonRpcProvider | null;
    isConnecting: boolean;
    modal: any;
}

export const Web3Context = createContext<Web3ContextType | null>(null);

export const useWeb3 = () => {
    const context = useContext(Web3Context);
    if (!context) {
        throw new Error('useWeb3 must be used within a Web3Provider');
    }
    return context;
};

const projectId = (import.meta as any).env.VITE_REOWN_PROJECT_ID || 'b8480dbf6f1c429fb1e3fcbefa80c920';
const appKitNetworks: any[] = [mainnet, arbitrum, polygon, base, bsc, avalanche];

const metadata = {
    name: 'LilSwap',
    description: 'DeFi Portfolio Optimization for Aave',
    url: window.location.origin,
    icons: [window.location.origin + '/favicon.png']
};

const appKitConfig = {
    adapters: [new EthersAdapter()],
    networks: appKitNetworks as [any, ...any[]],
    metadata,
    projectId,
    features: {
        analytics: true,
        email: false,
        socials: []
    },
    enableInjected: true,
    enableEIP6963: true,
    enableCoinbase: false,
    themeMode: 'dark' as const,
    featuredWalletIds: [
        '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
        '1aedbcfc1f31aade56ca34c38b0a1607b41cccfa3de93c946ef3b4ba2dfab11c', // OneKey
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',  // MetaMask
        '163d2cf19babf05eb8962e9748f9ebe613ed52ebf9c8107c9a0f104bfcf161b3',  // Brave
    ],
    includeWalletIds: [
        '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
        '1aedbcfc1f31aade56ca34c38b0a1607b41cccfa3de93c946ef3b4ba2dfab11c', // OneKey
        'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',  // MetaMask
        '163d2cf19babf05eb8962e9748f9ebe613ed52ebf9c8107c9a0f104bfcf161b3',  // Brave
    ]
};

const modal = createAppKit(appKitConfig);

export const Web3Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { address, isConnected } = useAppKitAccount();
    const { walletProvider } = useAppKitProvider('eip155');
    const { chainId } = useAppKitNetwork();

    const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [selectedNetworkKey, setSelectedNetworkKey] = useState<string>(DEFAULT_NETWORK.key);
    const [isConnecting, setIsConnecting] = useState(false);

    const selectedNetwork = useMemo(() => NETWORKS[selectedNetworkKey] || DEFAULT_NETWORK, [selectedNetworkKey]);
    const allowedNetworks = useMemo(() => Object.values(NETWORKS), []);

    const networkRpcProvider = useMemo(() => {
        const rpcUrls = selectedNetwork?.rpcUrls;
        if (!rpcUrls || rpcUrls.length === 0) return null;
        return createRpcProvider(rpcUrls);
    }, [selectedNetwork]);

    useEffect(() => {
        if (isConnected && address && walletProvider) {
            setAccount(address);
            // Re-create provider on walletProvider or chainId change to avoid stale network cache in ethers 6
            const newProvider = new ethers.BrowserProvider(walletProvider as any);
            setProvider(newProvider);
            setProxySessionIdentity({
                walletAddress: address,
                chainId: chainId ? Number(chainId) : null,
            });
        } else {
            setAccount(null);
            setProvider(null);
            setProxySessionIdentity(null);
        }
    }, [isConnected, address, walletProvider, chainId]);

    useEffect(() => {
        if (chainId) {
            const newNetwork = getNetworkByChainId(chainId);
            if (newNetwork) {
                setSelectedNetworkKey(newNetwork.key);
            }
        }
    }, [chainId]);

    useEffect(() => {
        if (!isConnected || !address) {
            setProxySessionIdentity(null);
            return;
        }

        setProxySessionIdentity({
            walletAddress: address,
            chainId: chainId ? Number(chainId) : null,
        });

        bootstrapProxySession({
            walletAddress: address,
            chainId: chainId ? Number(chainId) : null,
        }).catch((error) => {
            logger.warn('[Web3Provider] Proxy session bootstrap failed', {
                error: (error as any)?.message,
            });
        });
    }, [isConnected, address, chainId]);

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
            await disconnectProxySession();
            await modal.disconnect();
            setAccount(null);
            setProvider(null);
        } catch (error) {
            logger.error('[Web3Provider] Disconnect failed:', error);
        }
    }, []);

    const changeNetwork = useCallback(async (networkKey: string) => {
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
