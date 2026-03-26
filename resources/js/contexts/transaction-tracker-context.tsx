import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { getNetworkByChainId } from '../constants/networks';
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
    networkKey?: string;
    revertReason?: string;
}

interface TransactionTrackerContextType {
    transactions: PendingTransaction[];
    addTransaction: (tx: Omit<PendingTransaction, 'status' | 'timestamp'>) => void;
    apiHistory: any[];
    isLoadingHistory: boolean;
    hasMore: boolean;
    loadHistory: (walletAddress: string, isLoadMore?: boolean, isSilent?: boolean) => Promise<void>;
    isSheetOpen: boolean;
    setSheetOpen: (open: boolean) => void;
    activeCount: number;
    isSyncingHistory: boolean;
    lastSyncTime: number | null;
}

const TransactionTrackerContext = createContext<TransactionTrackerContextType | undefined>(undefined);

export const useTransactionTracker = () => {
    const context = useContext(TransactionTrackerContext);
    
    if (!context) {
        throw new Error('useTransactionTracker must be used within a TransactionTrackerProvider');
    }

    return context;
};

const STORAGE_KEY = 'lilswap.transactionHistory';

export const TransactionTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { account } = useWeb3();
    const prevAccountRef = useRef(account);
    const resolvedStorageKey = account ? `${STORAGE_KEY}_${account}` : STORAGE_KEY;

    const [transactions, setTransactions] = useState<PendingTransaction[]>(() => {
        try {
            // Lazy load specific to current account, if available
            if (typeof window !== 'undefined' && window.localStorage) {
                const storedKey = account ? `${STORAGE_KEY}_${account}` : STORAGE_KEY;
                const stored = window.localStorage.getItem(storedKey);
                
                if (stored) {
                    return JSON.parse(stored);
                }
            }
        } catch (e) {
            console.warn('Failed to load transaction history', e);
        }

        return [];
    });
    
    // API History States
    const [apiHistory, setApiHistory] = useState<any[]>([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isSyncingHistory, setIsSyncingHistory] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
    
    // Use refs to avoid loadHistory dependency loops
    const isFetchingRef = useRef(false);
    const [isSheetOpen, setSheetOpen] = useState(false);
    const { addToast, updateToast } = useToast();
    const toastMap = useRef<Map<string, number>>(new Map());

    // Reset state on account switch
    useEffect(() => {
        if (account !== prevAccountRef.current) {
            // Clear API History & Load state
            setApiHistory([]);
            setPage(0);
            setHasMore(true);
            
            // Try load local pending for the new active wallet
            try {
                if (typeof window !== 'undefined' && window.localStorage) {
                    const storedKey = account ? `${STORAGE_KEY}_${account}` : STORAGE_KEY;
                    const stored = window.localStorage.getItem(storedKey);
                    setTransactions(stored ? JSON.parse(stored) : []);
                }
            } catch (e) {
                setTransactions([]);
            }

            prevAccountRef.current = account;
        }
    }, [account]);

    // Persist to local storage
    useEffect(() => {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                // Keep only last 50 transactions to avoid bloat
                const toStore = transactions.slice(0, 50);
                window.localStorage.setItem(resolvedStorageKey, JSON.stringify(toStore));
            }
        } catch (e) {
            console.warn('Failed to save transaction history', e);
        }
    }, [transactions]);
    
    // Auto-cleanup local records that are already confirmed in the API history
    useEffect(() => {
        if (apiHistory.length > 0 && transactions.length > 0) {
            const apiHashes = new Set(apiHistory.map(tx => tx.tx_hash.toLowerCase()));
            const toRemove = transactions.filter(t => apiHashes.has(t.hash.toLowerCase()));
            
            if (toRemove.length > 0) {
                setTransactions(prev => prev.filter(t => !apiHashes.has(t.hash.toLowerCase())));
                // Also remove from toast tracking if they were there
                toRemove.forEach(t => toastMap.current.delete(t.hash));
            }
        }
    }, [apiHistory]);

    const activeCount = transactions.filter(t => t.status === 'pending').length;

    const addTransaction = useCallback((tx: Omit<PendingTransaction, 'status' | 'timestamp'>) => {
        const newTx: PendingTransaction = {
            ...tx,
            status: 'pending',
            timestamp: Date.now()
        };
        // Add to beginning of list
        setTransactions(prev => [newTx, ...prev]);

        // Show Loading Toast and track it
        const toastId = addToast({
            title: 'Transaction Submitted',
            message: tx.description,
            type: 'loading',
            duration: 0, // Keep it open until confirmed or failed
            action: {
                label: 'View',
                onClick: () => setSheetOpen(true)
            }
        });
        toastMap.current.set(tx.hash, toastId);
    }, [addToast]);

    const loadHistory = useCallback(async (walletAddress: string, isLoadMore: boolean = false, isSilent: boolean = false) => {
        if (!walletAddress || isFetchingRef.current || (!hasMore && isLoadMore)) return;

        isFetchingRef.current = true;
        if (isSilent) {
            setIsSyncingHistory(true);
        } else {
            setIsLoadingHistory(true);
        }
        try {
            const { getUserTransactionsHistory } = await import('../services/api');
            const limit = 20;
            const currentPage = isLoadMore ? page + 1 : 0;
            const offset = currentPage * limit;

            const response = await getUserTransactionsHistory(walletAddress, limit, offset);
            const fetchedTxs = response?.transactions || [];

            setApiHistory(prev => isLoadMore ? [...prev, ...fetchedTxs] : fetchedTxs);
            setPage(currentPage);
            setHasMore(fetchedTxs.length === limit);
            if (!isLoadMore) setLastSyncTime(Date.now());
        } catch (error) {
            logger.error('Failed to load transaction history in Context', error);
        } finally {
            setIsLoadingHistory(false);
            setIsSyncingHistory(false);
            isFetchingRef.current = false;
        }
    }, [page, hasMore]);

    // Polling mechanism for pending transactions
    useEffect(() => {
        if (activeCount === 0) {
            return;
        }

        const checkPendingTransactions = async () => {
            const pending = transactions.filter(t => t.status === 'pending');
            
            for (const tx of pending) {
                try {
                    const network = getNetworkByChainId(tx.chainId);
                    
                    if (!network) {
                        continue;
                    }
                    
                    const provider = createRpcProvider(network.rpcUrls);
                    const receipt = await provider.getTransactionReceipt(tx.hash);
                    
                    if (receipt) {
                        const isSuccess = receipt.status === 1;
                        
                        setTransactions(prev => prev.map(t => 
                            t.hash === tx.hash ? { ...t, status: isSuccess ? 'success' : 'error' } : t
                        ));

                        // Show/Update Toast Notification
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
                                    onClick: () => setSheetOpen(true)
                                }
                            });
                        }
                    } else {
                        // Still pending — Check if it's taking too long (> 2 minutes)
                        const elapsed = Date.now() - tx.timestamp;
                        const toastId = toastMap.current.get(tx.hash);
                        
                        if (toastId && elapsed > 120000) {
                            // Update the toast to be non-intrusive and allow it to clear
                            updateToast(toastId, {
                                title: 'Still Processing...',
                                message: 'This transaction is taking a bit longer to confirm. You can safely close this; we\'ll update your history as soon as it completes.',
                                type: 'info',
                                duration: 8000,
                            });
                            // Remove from map so we don't keep spamming updates
                            toastMap.current.delete(tx.hash);
                        }
                    }
                } catch (error) {
                    logger.warn(`[TransactionTracker] Failed to track transaction ${tx.hash}`, error);
                }
            }
        };

        const intervalId = setInterval(checkPendingTransactions, 6000);
        
        // Initial check immediately
        checkPendingTransactions();

        return () => clearInterval(intervalId);
    }, [transactions, activeCount, addToast]);

    // Background history sync when sheet is open
    useEffect(() => {
        if (!isSheetOpen || !account) return;

        // Poll every 30 seconds
        const intervalId = setInterval(() => {
            loadHistory(account, false, true);
        }, 30000);

        return () => clearInterval(intervalId);
    }, [isSheetOpen, account, loadHistory]);

    return (
        <TransactionTrackerContext.Provider value={{
            transactions,
            addTransaction,
            apiHistory,
            isLoadingHistory,
            hasMore,
            loadHistory,
            isSheetOpen,
            setSheetOpen,
            activeCount,
            isSyncingHistory,
            lastSyncTime
        }}>
            {children}
        </TransactionTrackerContext.Provider>
    );
};
