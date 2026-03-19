import { Coffee } from 'lucide-react';
import React, { useState } from 'react';
import { useApiMeta } from '../contexts/api-meta-context';
import { DonateModal } from './donate-modal';

// This will be provided by Vite in development/build
// In Laravel, we can also inject it via Inertia if needed
const APP_VERSION = __APP_VERSION__;

const AppFooter: React.FC = () => {
    const { apiVersion, isApiUp } = useApiMeta();
    const [isDonateOpen, setIsDonateOpen] = useState(false);

    return (
        <footer className="sticky bottom-0 z-40 border-t border-border-light dark:border-border-dark bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-sm">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2.5 flex flex-col items-center gap-2 text-[11px] text-slate-500 dark:text-slate-500">
                <div className="flex items-center gap-3 flex-wrap justify-center">
                    <span className="font-mono">v{APP_VERSION}</span>

                    {apiVersion && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span className="font-mono text-slate-400">API v{apiVersion}</span>
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isApiUp ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                <span className={`${isApiUp ? 'text-green-500' : 'text-red-500'} font-medium`}>
                                    {isApiUp ? 'Operational' : 'Offline'}
                                </span>
                            </div>
                        </>
                    )}

                    <span className="text-slate-300 dark:text-slate-700">·</span>

                    <a
                        href="https://lilswap.xyz/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors font-medium"
                    >
                        Docs
                    </a>

                    <a
                        href="https://github.com/InkCrypto/LilSwap"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        title="View on GitHub"
                    >
                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                        </svg>
                    </a>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-slate-400">© {new Date().getFullYear()} InkCrypto Finance</span>

                    <span className="text-slate-300 dark:text-slate-700">·</span>

                    <button
                        onClick={() => setIsDonateOpen(true)}
                        className="flex items-center gap-1.5 text-slate-400 hover:text-primary-hover dark:hover:text-primary-hover transition-colors font-medium group"
                    >
                        <Coffee className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                        Donate
                    </button>
                </div>

                <DonateModal isOpen={isDonateOpen} onClose={() => setIsDonateOpen(false)} />
            </div>
        </footer>
    );
};

export default AppFooter;
