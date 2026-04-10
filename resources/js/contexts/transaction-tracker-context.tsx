import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Hex } from 'viem';
import { getMarketByKey } from '../constants/networks';
import { createRpcProvider } from '../helpers/rpc-helper';
import logger from '../utils/logger';
import { useToast } from './toast-context';
import { useWeb3 } from './web3-context';

export interface PendingTransaction {
    hash: string;
    chainId: number;
    description: string;
    status: 'pending' | 'success' | 'error';
    timestamp: number;
    marketKey: string;
    fromTokenSymbol?: string;
    toTokenSymbol?: string;
    revertReason?: string;
    txStatus?: string;
}

interface TransactionTrackerContextType {
    transactions: PendingTransaction[];
    addTransaction: (tx: Omit<PendingTransaction, 'status' | 'timestamp'>) => void;
    isSheetOpen: boolean;
    setSheetOpen: (open: boolean) => void;
    activeCount: number;
}

const TransactionTrackerContext = createContext<TransactionTrackerContextType | undefined>(undefined);

export const useTransactionTracker = () => {
    const context = useContext(TransactionTrackerContext);

    if (!context) {
        throw new Error('useTransactionTracker must be used within a TransactionTrackerProvider');
    }

    return context;
};

export const TransactionTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { account } = useWeb3();
    const prevAccountRef = useRef(account);
    const [transactions, setTransactions] = useState<PendingTransaction[]>([]);
    const [isSheetOpen, setSheetOpen] = useState(false);
    const { addToast, updateToast } = useToast();
    const toastMap = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        if (account !== prevAccountRef.current) {
            setSheetOpen(false);
            setTransactions([]);
            prevAccountRef.current = account;
        }
    }, [account]);

    const activeCount = transactions.filter((tx) => tx.status === 'pending').length;

    const addTransaction = useCallback((tx: Omit<PendingTransaction, 'status' | 'timestamp'>) => {
        const newTx: PendingTransaction = {
            ...tx,
            status: 'pending',
            timestamp: Date.now(),
        };

        setTransactions((prev) => [newTx, ...prev]);

        const toastId = addToast({
            title: 'Transaction Submitted',
            message: tx.description,
            type: 'loading',
            duration: 0,
            action: {
                label: 'View',
                onClick: () => setSheetOpen(true),
            },
        });

        toastMap.current.set(tx.hash, toastId);
    }, [addToast]);

    useEffect(() => {
        if (activeCount === 0) {
            return;
        }

        const checkPendingTransactions = async () => {
            const pending = transactions.filter((tx) => tx.status === 'pending');

            for (const tx of pending) {
                try {
                    const market = getMarketByKey(tx.marketKey);

                    if (!market) {
                        logger.warn(`[TransactionTracker] No market config found for key: ${tx.marketKey}`);
                        continue;
                    }

                    const provider = createRpcProvider(market.rpcUrls, tx.chainId);
                    let receipt = null;

                    try {
                        receipt = await provider.getTransactionReceipt({ hash: tx.hash as Hex });
                    } catch (err: any) {
                        if (err.name === 'TransactionReceiptNotFoundError' || err.message?.includes('not found')) {
                            continue;
                        }

                        throw err;
                    }

                    if (receipt) {
                        const isSuccess = receipt.status === 'success';

                        setTransactions((prev) => prev.map((item) =>
                            item.hash === tx.hash ? { ...item, status: isSuccess ? 'success' : 'error' } : item
                        ));

                        if (isSuccess) {
                            logger.info('[TransactionTracker] Transaction successful, triggering position refresh');
                            window.dispatchEvent(new CustomEvent('lilswap:refresh-positions'));
                        }

                        const toastId = toastMap.current.get(tx.hash);

                        if (toastId) {
                            updateToast(toastId, {
                                title: isSuccess ? 'Transaction Confirmed' : 'Transaction Failed',
                                type: isSuccess ? 'success' : 'error',
                                duration: 5000,
                            });
                            toastMap.current.delete(tx.hash);
                        } else {
                            addToast({
                                title: isSuccess ? 'Transaction Confirmed' : 'Transaction Failed',
                                message: tx.description,
                                type: isSuccess ? 'success' : 'error',
                                action: {
                                    label: 'View',
                                    onClick: () => setSheetOpen(true),
                                },
                            });
                        }
                    } else {
                        const elapsed = Date.now() - tx.timestamp;
                        const toastId = toastMap.current.get(tx.hash);

                        if (toastId && elapsed > 120000) {
                            updateToast(toastId, {
                                title: 'Still Processing...',
                                message: 'This transaction is taking a bit longer to confirm. You can safely close this; we will update your history as soon as it completes.',
                                type: 'info',
                                duration: 8000,
                            });
                            toastMap.current.delete(tx.hash);
                        }
                    }
                } catch (error) {
                    logger.warn(`[TransactionTracker] Failed to track transaction ${tx.hash}`, error);
                }
            }
        };

        const intervalId = window.setInterval(checkPendingTransactions, 6000);
        void checkPendingTransactions();

        return () => window.clearInterval(intervalId);
    }, [transactions, activeCount, addToast, updateToast]);

    return (
        <TransactionTrackerContext.Provider value={{
            transactions,
            addTransaction,
            isSheetOpen,
            setSheetOpen,
            activeCount,
        }}
        >
            {children}
        </TransactionTrackerContext.Provider>
    );
};
