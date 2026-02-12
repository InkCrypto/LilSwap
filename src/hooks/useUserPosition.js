import { useState, useCallback, useEffect, useRef } from 'react';
import { useWeb3 } from '../context/web3Context';
import { getUserPosition } from '../services/api';

/**
 * Hook para buscar e gerenciar a posição agregada do usuário na Aave
 * @returns {Object} { supplies, borrows, summary, loading, error, refresh }
 */
export const useUserPosition = () => {
    const { account, selectedNetwork } = useWeb3();
    const [data, setData] = useState({ supplies: [], borrows: [], marketAssets: [], summary: null });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const cacheRef = useRef({ data: null, timestamp: 0, key: '' });
    const fetchTimeoutRef = useRef(null);

    const CACHE_TTL = 10000; // 10 seconds cache
    const DEBOUNCE_DELAY = 500; // 500ms debounce

    const refresh = useCallback(async (force = false) => {
        if (!account || !selectedNetwork?.chainId) {
            setData({ supplies: [], borrows: [], marketAssets: [], summary: null });
            return;
        }

        const cacheKey = `${account}-${selectedNetwork.chainId}`;
        const now = Date.now();

        // Check cache first
        if (!force &&
            cacheRef.current.key === cacheKey &&
            cacheRef.current.data &&
            (now - cacheRef.current.timestamp) < CACHE_TTL) {
            console.log('[useUserPosition] Using cached data');
            setData(cacheRef.current.data);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const position = await getUserPosition(account, selectedNetwork.chainId);
            const newData = {
                supplies: position.supplies || [],
                borrows: position.borrows || [],
                marketAssets: position.marketAssets || [],
                summary: position.summary || null
            };

            // Update cache
            cacheRef.current = {
                data: newData,
                timestamp: Date.now(),
                key: cacheKey
            };

            setData(newData);
        } catch (err) {
            console.error('Error fetching user position:', err);
            const errorMsg = err.message || 'Falha ao carregar posições na Aave';

            // Provide more specific error messages
            if (errorMsg.includes('rate limit')) {
                setError('RPC rate limit atingido. Aguarde alguns segundos e tente novamente.');
            } else if (errorMsg.includes('CALL_EXCEPTION')) {
                setError('Erro ao consultar Aave. Tente novamente em alguns segundos.');
            } else {
                setError(errorMsg);
            }
        } finally {
            setLoading(false);
        }
    }, [account, selectedNetwork?.chainId]);

    // Refresh automático com debounce quando conta ou rede muda
    useEffect(() => {
        if (fetchTimeoutRef.current) {
            clearTimeout(fetchTimeoutRef.current);
        }

        fetchTimeoutRef.current = setTimeout(() => {
            refresh();
        }, DEBOUNCE_DELAY);

        return () => {
            if (fetchTimeoutRef.current) {
                clearTimeout(fetchTimeoutRef.current);
            }
        };
    }, [refresh]);

    return {
        ...data,
        loading,
        error,
        lastFetch,
        refresh
    };
};
