import { useAppKit, useAppKitState } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    WagmiProvider,
    useAccount,
    useChainId,
    useSwitchChain,
    useDisconnect,
    usePublicClient,
    useWalletClient,
} from 'wagmi';
import type { MarketConfig } from '../constants/networks';
import { DEFAULT_MARKET, MARKETS, getMarketByChainId } from '../constants/networks';
import { bootstrapProxySession, disconnectProxySession, setProxySessionIdentity } from '../services/api';
import { flushPendingTransactionHashes } from '../services/transactions-api';
import logger from '../utils/logger';
import { wagmiConfig } from './appkit';

export { wagmiConfig };

const queryClient = new QueryClient();

interface Web3ContextType {
    account: string | null;
    chainId: number | null;
    isConnected: boolean;
    isConnecting: boolean;
    isReconnecting: boolean;
    isConnectModalOpen: boolean;
    isSettlingAccount: boolean;
    isProxyReady: boolean;
    connectWallet: () => void;
    disconnectWallet: () => Promise<void>;
    selectedNetwork: MarketConfig;
    setSelectedNetwork: (marketKey: string) => Promise<void>;
    availableNetworks: MarketConfig[];
    publicClient: any;
    walletClient: any;
}

export const Web3Context = createContext<Web3ContextType | null>(null);

export const useWeb3 = () => {
    const context = useContext(Web3Context);

    if (!context) {
        throw new Error('useWeb3 must be used within a Web3Provider');
    }

    return context;
};

export const Web3Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <Web3InternalProvider>{children}</Web3InternalProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
};

const Web3InternalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const { disconnectAsync } = useDisconnect();
    const { open: openAppKitModal } = useAppKit();
    const { open: isConnectModalOpen } = useAppKitState();
    const isDisconnectingRef = React.useRef(false);

    const handleDisconnect = useCallback(async () => {
        if (isDisconnectingRef.current) {
            return;
        }

        isDisconnectingRef.current = true;

        try {
            setProxySessionIdentity(null);
            await disconnectProxySession();
            await disconnectAsync();
        } finally {
            isDisconnectingRef.current = false;
        }
    }, [disconnectAsync]);

    const [isSettlingAccount, setIsSettlingAccount] = useState(false);
    const [isProxyReady, setIsProxyReady] = useState(false);
    const [selectedMarketKey, setSelectedMarketKey] = useState<string>(DEFAULT_MARKET.key);

    const selectedNetwork = useMemo(() => MARKETS[selectedMarketKey] || DEFAULT_MARKET, [selectedMarketKey]);
    const allowedNetworks = useMemo(() => Object.values(MARKETS), []);

    useEffect(() => {
        if (chainId) {
            const newMarket = getMarketByChainId(chainId);

            if (newMarket && newMarket.key !== selectedMarketKey) {
                setSelectedMarketKey(newMarket.key);
            }
        }
    }, [chainId, selectedMarketKey]);

    const lastSessionIdentity = React.useRef<string | null>(null);

    useEffect(() => {
        const currentlyConnected = isConnected && !!address;
        const sessionIdentity = currentlyConnected ? `${String(address).toLowerCase()}:${chainId || 'none'}` : null;

        if (lastSessionIdentity.current === sessionIdentity) {
            return;
        }

        const previousIdentity = lastSessionIdentity.current;
        lastSessionIdentity.current = sessionIdentity;

        if (currentlyConnected) {
            setIsProxyReady(false);

            setProxySessionIdentity({
                walletAddress: address as string,
                chainId: chainId || null,
            });

            bootstrapProxySession({
                walletAddress: address as string,
                chainId: chainId || null,
            }).then(() => {
                setIsProxyReady(true);
            }).catch((error) => {
                console.warn('[Web3Provider] Proxy session bootstrap failed', {
                    error: (error as any)?.message,
                });
                setIsProxyReady(false);
            });
        } else if (previousIdentity !== null) {
            setIsProxyReady(false);
            setProxySessionIdentity(null);

            if (!isDisconnectingRef.current) {
                disconnectProxySession().catch(() => { });
            }
        }
    }, [isConnected, address, chainId]);

    useEffect(() => {
        if (!isConnected || !address || !isProxyReady) {
            return;
        }

        void flushPendingTransactionHashes(address).then((flushed) => {
            if (flushed > 0) {
                logger.info('[Web3Provider] Re-synced pending tx hashes', { count: flushed });
            }
        });
    }, [isConnected, address, isProxyReady]);

    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && isConnected && connector) {
                try {
                    setIsSettlingAccount(true);

                    await bootstrapProxySession({
                        walletAddress: address ?? null,
                        chainId: chainId ?? null,
                    });

                    if (address && isProxyReady) {
                        void flushPendingTransactionHashes(address);
                    }
                } finally {
                    setTimeout(() => setIsSettlingAccount(false), 200);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isConnected, connector, address, chainId, isProxyReady]);

    const connectWallet = useCallback(() => {
        void (async () => {
            try {
                await bootstrapProxySession({
                    walletAddress: address ?? null,
                    chainId: chainId ?? null,
                });
            } catch (error) {
                logger.warn('[Web3Provider] Pre-connect proxy bootstrap failed', {
                    error: (error as any)?.message,
                });
            }

            await openAppKitModal();
        })();
    }, [openAppKitModal, address, chainId]);

    const changeNetwork = useCallback(async (marketKey: string) => {
        const targetMarket = MARKETS[marketKey];

        if (!targetMarket || !switchChainAsync) {
            return;
        }

        try {
            await switchChainAsync({ chainId: targetMarket.chainId });
        } catch (error) {
            logger.error('[Web3Provider] Network switch failed:', error);
        }
    }, [switchChainAsync]);

    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();

    return (
        <Web3Context.Provider
            value={{
                account: address || null,
                chainId: chainId || null,
                isConnected,
                isConnecting,
                isReconnecting,
                isConnectModalOpen: Boolean(isConnectModalOpen),
                isSettlingAccount,
                isProxyReady,
                connectWallet,
                disconnectWallet: handleDisconnect,
                selectedNetwork,
                setSelectedNetwork: changeNetwork,
                availableNetworks: allowedNetworks,
                publicClient,
                walletClient,
            }}
        >
            {children}
        </Web3Context.Provider>
    );
};
