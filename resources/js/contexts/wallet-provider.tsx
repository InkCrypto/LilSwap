import React from 'react';
import type { ReactNode } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { wagmiAdapter, reownProjectId } from './wagmi-config';
import { SUPPORTED_CHAINS } from '../constants/networks';

const metadata = {
    name: 'LilSwap',
    description: 'Swap Tokens & Positions with little fees & effort',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://app.lilswap.xyz',
    icons: [
        typeof window !== 'undefined'
            ? `${window.location.origin}/favicon.png`
            : 'https://app.lilswap.xyz/favicon.png',
    ],
};

createAppKit({
    adapters: [wagmiAdapter],
    projectId: reownProjectId,
    networks: [...SUPPORTED_CHAINS],
    metadata,
    features: {
        analytics: false,
        email: false,
        socials: false,
        swaps: false,
        onramp: false,
    },
    allowUnsupportedChain: false,
    enableCoinbase: false,
    featuredWalletIds: [
        '18388be9ac2d02726dbac9777c96efaac06d744b26d580fccdd4127a6d01fd1', // Rabby
        '1aedbcfc1f31aade56ca34c38b0a1607b41cccfa3de93c946ef3b4ba2dfab11c', // OneKey
    ],
});

interface WalletProviderProps {
    children: ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
    return <>{children}</>;
};
