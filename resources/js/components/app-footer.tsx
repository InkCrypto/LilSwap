import { Coffee, Globe } from 'lucide-react';
import React, { useState } from 'react';
import { useApiMeta } from '../contexts/api-meta-context';
import { DonateModal } from './donate-modal';
import { VerifyDonationModal } from './verify-donation-modal';

const APP_VERSION = __APP_VERSION__;


const AppFooter: React.FC = () => {
    const { apiVersion } = useApiMeta();
    const [isDonateOpen, setIsDonateOpen] = useState(false);
    const [isVerifyOpen, setIsVerifyOpen] = useState(false);
    const [autoVerifyData, setAutoVerifyData] = useState<{ txHash: string; chainId: number } | null>(null);

    const handleDonated = (txHash: string, chainId: number) => {
        setIsDonateOpen(false);
        setAutoVerifyData({ txHash, chainId });
        setIsVerifyOpen(true);
    };

    return (
        <footer className="relative z-40 bg-background-light dark:bg-background-dark">
            <div className="max-w-480 mx-auto px-6 py-2 text-slate-500">
                <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm">
                    <div className="flex items-center gap-5">
                        <span className="whitespace-nowrap">© {new Date().getFullYear()} InkCrypto</span>
                        <div className="flex items-center gap-4">
                            <a
                                href="https://lilswap.xyz/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-slate-600 dark:hover:text-white transition-colors"
                                aria-label="Website"
                            >
                                <Globe className="w-5 h-5" strokeWidth={1.8} />
                            </a>
                            <a
                                href="https://x.com/LilSwap_"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-slate-600 dark:hover:text-white transition-colors"
                            >
                                <svg className="w-4.5 h-4.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z" />
                                </svg>
                            </a>
                            <a
                                href="https://github.com/InkCrypto/LilSwap"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-slate-600 dark:hover:text-white transition-colors"
                            >
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                                </svg>
                            </a>
                            <a
                                href="https://defillama.com/protocol/lilswap"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-slate-600 dark:hover:text-white transition-all group"
                                aria-label="DeFiLlama"
                            >
                                <img 
                                    src="/icons/defillama.svg" 
                                    alt="DeFiLlama" 
                                    className="w-5 h-5 group-hover:scale-110 transition-transform"
                                />
                            </a>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsDonateOpen(true)}
                        className="mx-auto flex items-center gap-1.5 font-semibold text-primary transition-colors hover:text-primary-hover dark:text-[#2EBDE3] dark:hover:text-[#67d4ef]"
                    >
                        <Coffee className="w-4 h-4" />
                        Donate
                    </button>

                    <div className="flex items-center justify-end gap-3 font-mono text-[13px]">
                        <span>App v{APP_VERSION}</span>
                        {apiVersion && (
                            <>
                                <span className="text-slate-300 dark:text-slate-700">|</span>
                                <span>API v{apiVersion}</span>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex md:hidden items-center justify-center gap-x-2 text-[13px] py-2 whitespace-nowrap">
                    <span className="opacity-80">© {new Date().getFullYear()} InkCrypto</span>
                    <span className="opacity-20">|</span>
                    <button
                        onClick={() => setIsDonateOpen(true)}
                        className="flex items-center gap-1 font-bold text-primary transition-colors hover:text-primary-hover dark:text-[#2EBDE3] dark:hover:text-[#67d4ef]"
                    >
                        <Coffee className="w-3.5 h-3.5" />
                        Donate
                    </button>
                    <span className="opacity-20">|</span>
                    <div className="flex items-center gap-2">
                        <a
                            href="https://lilswap.xyz/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                        >
                            <span className="sr-only">Website</span>
                            <Globe className="w-4 h-4" strokeWidth={1.8} />
                        </a>
                        <a
                            href="https://x.com/LilSwap_"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                        >
                            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932zm-1.292 19.49h2.039L6.486 3.24H4.298l13.311 17.403z" />
                            </svg>
                        </a>
                        <a
                            href="https://github.com/InkCrypto/LilSwap"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                        >
                            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                            </svg>
                        </a>
                        <a
                            href="https://defillama.com/protocol/lilswap"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-all group"
                            aria-label="DeFiLlama"
                        >
                            <img 
                                src="/icons/defillama.svg" 
                                alt="DeFiLlama" 
                                className="w-4 h-4 group-hover:scale-110 transition-transform"
                            />
                        </a>
                    </div>
                </div>
            </div>

            <DonateModal
                isOpen={isDonateOpen}
                onClose={() => setIsDonateOpen(false)}
                onDonated={handleDonated}
                onOpenVerify={() => setIsVerifyOpen(true)}
            />

            <VerifyDonationModal
                isOpen={isVerifyOpen}
                onClose={() => {
                    setIsVerifyOpen(false);
                    setAutoVerifyData(null);
                }}
                initialHash={autoVerifyData?.txHash}
                initialChainId={autoVerifyData?.chainId}
                onOpenDonate={() => setIsDonateOpen(true)}
            />
        </footer>
    );
};

export default AppFooter;
