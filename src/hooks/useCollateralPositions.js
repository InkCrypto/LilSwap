import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ethers } from 'ethers';
import { ADDRESSES } from '../constants/addresses.js';
import { ABIS } from '../constants/abis.js';
import { DEFAULT_NETWORK } from '../constants/networks.js';
import { retryContractCall } from '../helpers/retryHelper.js';
import logger from '../utils/logger.js';

export const useCollateralPositions = ({ account, provider, networkRpcProvider, fromToken, addLog, selectedNetwork }) => {
    const [supplyBalance, setSupplyBalance] = useState(null);
    const [formattedSupply, setFormattedSupply] = useState('0');
    const [allowance, setAllowance] = useState(BigInt(0));
    const [isPositionLoading, setIsPositionLoading] = useState(false);

    // Guard against EVM precompile addresses (1–0xff) being mistakenly stored as aToken addresses.
    // These come from stale/cross-chain backend data and are not real contracts.
    const isValidATokenAddress = (addr) => {
        if (!addr || addr === ethers.ZeroAddress) return false;
        try { return BigInt(addr) > BigInt(0xff); } catch (_) { return false; }
    };

    // format BigInt balance to decimal string avoiding exponential notation
    const formatUnitsFixed = (balance, decimals) => {
        const s = ethers.formatUnits(balance, decimals);
        if (!/[eE]/.test(s)) return s;
        const b = balance.toString();
        if (decimals === 0) return b;
        const intPart = b.length > decimals ? b.slice(0, -decimals) : '0';
        let frac = b.length > decimals ? b.slice(-decimals) : b.padStart(decimals, '0');
        frac = frac.replace(/0+$/, '');
        return frac ? `${intPart}.${frac}` : intPart;
    };

    const abortControllerRef = useRef(null);
    const isMountedRef = useRef(true);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.SWAP_COLLATERAL_ADAPTER) return null;
        try { return ethers.getAddress(networkAddresses.SWAP_COLLATERAL_ADAPTER); }
        catch (error) { return null; }
    }, [networkAddresses?.SWAP_COLLATERAL_ADAPTER]);

    const readProvider = useMemo(() => networkRpcProvider || provider, [networkRpcProvider, provider]);

    const fetchPositionData = useCallback(async () => {
        if (!account || !readProvider || !fromToken) return;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setIsPositionLoading(true);

        try {
            if (signal.aborted) return;

            // 🔥 FAST PATH: Use backend balance directly if available
            if (fromToken.amount) {
                const backendBalance = BigInt(fromToken.amount);
                setSupplyBalance(backendBalance);
                const formatted = formatUnitsFixed(backendBalance, fromToken.decimals);
                setFormattedSupply(formatted);
                addLog?.(`[Collateral] ${fromToken.symbol} balance: ${formatted} (from server)`, 'success');

                if (!adapterAddress) {
                    setAllowance(BigInt(0));
                    setIsPositionLoading(false);
                    return;
                }

                try {
                    let aTokenAddr = fromToken.aTokenAddress;
                    if (!isValidATokenAddress(aTokenAddr)) {
                        // DATA_PROVIDER.getReserveTokensAddresses is immune to Aave v3.1 struct changes
                        const dataProvider = new ethers.Contract(networkAddresses.DATA_PROVIDER, ABIS.DATA_PROVIDER, readProvider);
                        const underlyingAsset = fromToken.underlyingAsset || fromToken.address;
                        const tokenAddresses = await dataProvider.getReserveTokensAddresses(underlyingAsset);
                        aTokenAddr = tokenAddresses.aTokenAddress;
                    }
                    const aTokenContract = new ethers.Contract(aTokenAddr, ABIS.ERC20, readProvider);
                    const currentAllowance = await aTokenContract.allowance(account, adapterAddress);
                    if (signal.aborted || !isMountedRef.current) return;
                    setAllowance(currentAllowance);
                } catch (error) {
                    logger.warn('[useCollateralPositions] Allowance check failed:', error.message);
                }

                setIsPositionLoading(false);
                return;
            }

            // SLOW PATH
            const providerNetwork = await readProvider.getNetwork();
            const providerChainId = Number(providerNetwork.chainId);
            const expectedChainId = selectedNetwork?.chainId || DEFAULT_NETWORK.chainId;

            if (providerChainId !== expectedChainId) {
                const errorMsg = `provider chain mismatch: expected ${expectedChainId}, got ${providerChainId}`;
                addLog?.(errorMsg, 'error');
                throw new Error(errorMsg);
            }

            // Get aToken address
            let aTokenAddr = fromToken.aTokenAddress;
            // DATA_PROVIDER.getReserveTokensAddresses is immune to Aave v3.1 struct changes
            const dataProvider = new ethers.Contract(networkAddresses.DATA_PROVIDER, ABIS.DATA_PROVIDER, readProvider);
            if (!isValidATokenAddress(aTokenAddr)) {
                const underlyingAsset = fromToken.underlyingAsset || fromToken.address;
                const tokenAddresses = await dataProvider.getReserveTokensAddresses(underlyingAsset);
                aTokenAddr = tokenAddresses.aTokenAddress;
            }

            if (!isValidATokenAddress(aTokenAddr)) {
                throw new Error(`No aToken address found for ${fromToken.symbol}`);
            }

            const aTokenContract = new ethers.Contract(aTokenAddr, ABIS.ERC20, readProvider);

            // Fetch it fresh from chain
            const balance = await retryContractCall(
                () => aTokenContract.balanceOf(account),
                `${fromToken.symbol} aToken balance`,
                { maxAttempts: 5, initialDelay: 800 }
            );

            if (signal.aborted || !isMountedRef.current) return;

            setSupplyBalance(balance);
            const formatted = formatUnitsFixed(balance, fromToken.decimals);
            setFormattedSupply(formatted);

            addLog?.(`[Collateral] ${fromToken.symbol} balance: ${formatted}`, 'success');

            if (!adapterAddress) {
                setAllowance(BigInt(0));
                setIsPositionLoading(false);
                return;
            }

            // Check allowance
            const currentAllowance = await retryContractCall(
                () => aTokenContract.allowance(account, adapterAddress),
                `${fromToken.symbol} aToken allowance`,
                { maxAttempts: 3, initialDelay: 500 }
            );

            if (signal.aborted || !isMountedRef.current) return;

            setAllowance(currentAllowance);

        } catch (error) {
            if (error.name !== 'AbortError' && !signal.aborted) {
                logger.error('[fetchPositionData]', error);
            }
        } finally {
            if (!signal.aborted && isMountedRef.current) setIsPositionLoading(false);
        }
    }, [account, readProvider, fromToken, addLog, networkAddresses, adapterAddress, selectedNetwork]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, []);

    // Reset stale state immediately when fromToken changes — avoids using previous token's allowance/balance
    useEffect(() => {
        setAllowance(BigInt(0));
        setSupplyBalance(null);
        setFormattedSupply('0');
    }, [fromToken?.symbol, fromToken?.address]);

    useEffect(() => {
        if (account && readProvider && fromToken) {
            const timer = setTimeout(() => fetchPositionData(), 500);
            return () => clearTimeout(timer);
        }
    }, [account, readProvider, fromToken, fetchPositionData]);

    return {
        supplyBalance,
        formattedSupply,
        allowance,
        fetchPositionData,
        isPositionLoading,
    };
};
