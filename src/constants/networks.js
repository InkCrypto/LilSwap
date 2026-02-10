export const NETWORKS = {
    BASE: {
        key: 'BASE',
        label: 'Base',
        shortLabel: 'Base',
        chainId: 8453,
        hexChainId: '0x2105',
        explorer: 'https://basescan.org',
        rpcUrls: ['https://mainnet.base.org'],
        addresses: {
            POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
            ADAPTER: '0xb12e82DF057BF16ecFa89D7D089dc7E5C1Dc057B',
            DATA_PROVIDER: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac',
            AUGUSTUS: {
                V5: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
                V6_2: '0x6a000f200059e1213d2a795f0f087e561e4c2026',
            },
            TOKENS: {
                USDC: {
                    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    decimals: 6,
                    symbol: 'USDC',
                    debtAddress: '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28',
                },
                WETH: {
                    address: '0x4200000000000000000000000000000000000006',
                    decimals: 18,
                    symbol: 'WETH',
                    debtAddress: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E',
                },
            },
            PARASWAP_API: 'https://api.paraswap.io',
        },
    },
};

export const DEFAULT_NETWORK = NETWORKS.BASE;

export const getNetworkByChainId = (chainId) => {
    if (!chainId && chainId !== 0) {
        return DEFAULT_NETWORK;
    }
    const numericId = typeof chainId === 'string' ? Number(chainId) : chainId;
    return (
        Object.values(NETWORKS).find((network) => network.chainId === numericId) || DEFAULT_NETWORK
    );
};

export const getNetworkByKey = (key) => NETWORKS[key] || DEFAULT_NETWORK;
