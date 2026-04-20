import { ConnectKitProvider, useModal } from 'connectkit';
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
import { wagmiConfig } from './connectkit';

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
                <ConnectKitProvider theme="auto" mode="dark">
                    <Web3InternalProvider>{children}</Web3InternalProvider>
                </ConnectKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
};

const Web3InternalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const { disconnectAsync } = useDisconnect();
    const { open: isConnectModalOpen, setOpen: setConnectModalOpen } = useModal();
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
    const [accountOverride, setAccountOverride] = useState<string | null>(null);

    const effectiveAddress = accountOverride ?? address ?? null;

    const selectedNetwork = useMemo(() => MARKETS[selectedMarketKey] || DEFAULT_MARKET, [selectedMarketKey]);
    const allowedNetworks = useMemo(() => Object.values(MARKETS), []);

    useEffect(() => {
        if (!address) {
            setAccountOverride(null);
            return;
        }

        if (accountOverride && accountOverride.toLowerCase() === address.toLowerCase()) {
            setAccountOverride(null);
        }
    }, [address, accountOverride]);

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
        // Only attempt to bootstrap when we have a settled connection state
        // We avoid bootstrapping while isConnecting or isReconnecting to prevent transient states
        const isSettled = isConnected && !!effectiveAddress && !!chainId && !isConnecting && !isReconnecting;
        
        const sessionIdentity = isSettled 
            ? `${String(effectiveAddress).toLowerCase()}:${chainId}` 
            : (isConnected && !isConnecting && !isReconnecting ? null : lastSessionIdentity.current);

        // If we are disconnecting (isConnected became false), identity becomes null
        const finalIdentity = isConnected ? sessionIdentity : null;

        if (lastSessionIdentity.current === finalIdentity) {
            return;
        }

        const previousIdentity = lastSessionIdentity.current;
        lastSessionIdentity.current = finalIdentity;

        if (isSettled) {
            setIsProxyReady(false);

            setProxySessionIdentity({
                walletAddress: effectiveAddress as string,
                chainId: chainId,
            });

            bootstrapProxySession({
                walletAddress: effectiveAddress as string,
                chainId: chainId,
            }).then(() => {
                setIsProxyReady(true);
            }).catch((error) => {
                console.warn('[Web3Provider] Proxy session bootstrap failed', {
                    error: (error as any)?.message,
                });
                setIsProxyReady(false);
            });
        } else if (!isConnected && previousIdentity !== null) {
            // Only disconnect proxy if the wallet itself is disconnected
            setIsProxyReady(false);
            setProxySessionIdentity(null);

            if (!isDisconnectingRef.current) {
                disconnectProxySession().catch(() => { });
            }
        }
    }, [isConnected, isConnecting, isReconnecting, effectiveAddress, chainId]);

    useEffect(() => {
        if (!isConnected || !effectiveAddress || !isProxyReady) {
            return;
        }

        void flushPendingTransactionHashes(effectiveAddress).then((flushed) => {
            if (flushed > 0) {
                logger.info('[Web3Provider] Re-synced pending tx hashes', { count: flushed });
            }
        });
    }, [isConnected, effectiveAddress, isProxyReady]);

    const stateRef = React.useRef({ isConnected, connector, effectiveAddress, isProxyReady });
    useEffect(() => {
        stateRef.current = { isConnected, connector, effectiveAddress, isProxyReady };
    }, [isConnected, connector, effectiveAddress, isProxyReady]);

    useEffect(() => {
        const handleVisibilityChange = async () => {
            const { isConnected: refSubConnected, connector: refSubConnector, effectiveAddress: refSubAddress, isProxyReady: refSubProxyReady } = stateRef.current;
            
            if (document.visibilityState !== 'visible' || !refSubConnected || !refSubConnector) {
                return;
            }

            try {
                setIsSettlingAccount(true);

                const provider = await refSubConnector.getProvider();
                const accounts = await (provider as any)?.request?.({ method: 'eth_accounts' });
                const walletAddress = Array.isArray(accounts) && typeof accounts[0] === 'string'
                    ? accounts[0]
                    : null;

                if (walletAddress && walletAddress.toLowerCase() !== refSubAddress?.toLowerCase()) {
                    logger.info('[Web3Provider] Account re-synced from provider after visibility restore', {
                        previous: refSubAddress,
                        current: walletAddress,
                    });
                    setAccountOverride(walletAddress);
                }

                if (walletAddress && refSubProxyReady) {
                    void flushPendingTransactionHashes(walletAddress);
                }
            } catch (err) {
                logger.debug('[Web3Provider] Visibility restore sync failed (non-fatal)', err);
            } finally {
                setTimeout(() => setIsSettlingAccount(false), 200);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    const connectWallet = useCallback(() => {
        setConnectModalOpen(true);
    }, [setConnectModalOpen]);

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
                account: effectiveAddress,
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
