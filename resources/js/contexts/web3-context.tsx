import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';
import {
    getDefaultConfig,
    RainbowKitProvider,
    darkTheme,
    lightTheme,
    useConnectModal
} from '@rainbow-me/rainbowkit';
import {
    rabbyWallet,
    oneKeyWallet,
    walletConnectWallet,
    metaMaskWallet,
    trustWallet,
    baseAccount
} from '@rainbow-me/rainbowkit/wallets';
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
    http
} from 'wagmi';
import { useAppearance } from '@/hooks/use-appearance';
import type { MarketConfig } from '../constants/networks';
import { DEFAULT_MARKET, MARKETS, getMarketByChainId, SUPPORTED_CHAINS, getAlchemyRpcUrl } from '../constants/networks';
import { bootstrapProxySession, disconnectProxySession, setProxySessionIdentity } from '../services/api';
import { flushPendingTransactionHashes } from '../services/transactions-api';
import { buildTransportHeaders } from '../helpers/rpc-helper';
import logger from '../utils/logger';


const queryClient = new QueryClient();

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
const chains = SUPPORTED_CHAINS;

// Setup RainbowKit config with priority to Rabby and OneKey as requested
const config = getDefaultConfig({
    appName: 'LilSwap',
    projectId,
    chains,
    wallets: [
        {
            groupName: 'Recommended',
            wallets: [
                rabbyWallet,
                oneKeyWallet,
                metaMaskWallet,
                trustWallet,
                baseAccount,
                walletConnectWallet
            ],
        },
    ],
    transports: Object.fromEntries(
        SUPPORTED_CHAINS.map(chain => {
            const market = getMarketByChainId(chain.id);
            const rpcUrl = market ? getAlchemyRpcUrl(market.alchemySlug) : undefined;

            // For same-origin (proxied) RPCs, we MUST include the Laravel CSRF token
            const headers = rpcUrl ? buildTransportHeaders(rpcUrl) : {};

            return [chain.id, http(rpcUrl, {
                fetchOptions: { headers }
            })];
        })
    ),
    ssr: true,
});

interface Web3ContextType {
    account: string | null;
    chainId: number | null;
    isConnected: boolean;
    isConnecting: boolean;
    isReconnecting: boolean;
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
    const { resolvedAppearance } = useAppearance();

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider
                    theme={resolvedAppearance === 'dark' ? darkTheme() : lightTheme()}
                    locale="en-US"
                >
                    <Web3InternalProvider>{children}</Web3InternalProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
};

const Web3InternalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount();
    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const { disconnectAsync } = useDisconnect();

    const handleDisconnect = useCallback(async () => {
        setProxySessionIdentity(null);
        await disconnectProxySession();
        await disconnectAsync();
    }, [disconnectAsync]);

    const [isSettlingAccount, setIsSettlingAccount] = useState(false);
    const [isProxyReady, setIsProxyReady] = useState(false);
    const [selectedMarketKey, setSelectedMarketKey] = useState<string>(DEFAULT_MARKET.key);

    const selectedNetwork = useMemo(() => MARKETS[selectedMarketKey] || DEFAULT_MARKET, [selectedMarketKey]);
    const allowedNetworks = useMemo(() => Object.values(MARKETS), []);

    // Sync market selection with current chain
    useEffect(() => {
        if (chainId) {
            const newMarket = getMarketByChainId(chainId);
            if (newMarket && newMarket.key !== selectedMarketKey) {
                setSelectedMarketKey(newMarket.key);
            }
        }
    }, [chainId, selectedMarketKey]);

    // Track active session identity to avoid redundant bootstraps
    const lastSessionIdentity = React.useRef<string | null>(null);

    // Handle session and proxy identity
    useEffect(() => {
        const currentlyConnected = isConnected && !!address;
        const sessionIdentity = currentlyConnected ? `${String(address).toLowerCase()}:${chainId || 'none'}` : null;

        // Prevent redundant bootstraps or disconnect loops
        if (lastSessionIdentity.current === sessionIdentity) return;

        const previousIdentity = lastSessionIdentity.current;
        lastSessionIdentity.current = sessionIdentity;

        if (currentlyConnected) {
            // Mark as not ready until bootstrap completes
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
            // Only explicitly disconnect if we were previously connected
            setIsProxyReady(false);
            setProxySessionIdentity(null);
            disconnectProxySession().catch(() => { });
        }
    }, [isConnected, address, chainId]);

    useEffect(() => {
        if (!isConnected || !address || !isProxyReady) return;

        void flushPendingTransactionHashes(address).then((flushed) => {
            if (flushed > 0) {
                logger.info('[Web3Provider] Re-synced pending tx hashes', { count: flushed });
            }
        });
    }, [isConnected, address, isProxyReady]);

    // Re-verify account state on visibility change (re-sync with wallet)
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && isConnected && connector) {
                try {
                    setIsSettlingAccount(true);
                    if (address && isProxyReady) {
                        void flushPendingTransactionHashes(address);
                    }
                    // Wagmi useAccount is generally reactive, but we can force a refresh if needed
                } finally {
                    setTimeout(() => setIsSettlingAccount(false), 200);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isConnected, connector, address, isProxyReady]);

    const { openConnectModal } = useConnectModal();
    const connectWallet = useCallback(() => {
        openConnectModal?.();
    }, [openConnectModal]);

    const changeNetwork = useCallback(async (marketKey: string) => {
        const targetMarket = MARKETS[marketKey];
        if (!targetMarket || !switchChainAsync) return;

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
