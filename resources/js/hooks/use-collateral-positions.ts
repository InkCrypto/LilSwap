import { getAddress, formatUnits, parseAbi, zeroAddress } from 'viem';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ABIS } from '../constants/abis';
import { ADDRESSES } from '../constants/addresses';
import { DEFAULT_NETWORK } from '../constants/networks';
import { retryContractCall } from '../helpers/retry-helper';
import logger from '../utils/logger';
import { useWeb3 } from '../contexts/web3-context';

interface UseCollateralPositionsProps {
    account: string | null;
    fromToken: any;
    addLog?: (message: string, type?: string) => void;
    selectedNetwork: any;
}

export const useCollateralPositions = ({
    account,
    fromToken,
    addLog,
    selectedNetwork
}: UseCollateralPositionsProps) => {
    const { publicClient } = useWeb3();
    const [supplyBalance, setSupplyBalance] = useState<bigint | null>(null);
    const [formattedSupply, setFormattedSupply] = useState('0');
    const [allowance, setAllowance] = useState(BigInt(0));
    const [isPositionLoading, setIsPositionLoading] = useState(false);

    const isValidATokenAddress = (addr: string) => {
        if (!addr || addr === zeroAddress) {
            return false;
        }

        try {
            return BigInt(addr) > BigInt(0xff);
        } catch {
            return false;
        }
    };

    const formatUnitsFixed = (balance: bigint, decimals: number) => {
        const s = formatUnits(balance, decimals);

        if (!/[eE]/.test(s)) {
            return s;
        }

        const b = balance.toString();

        if (decimals === 0) {
            return b;
        }

        const intPart = b.length > decimals ? b.slice(0, -decimals) : '0';
        let frac = b.length > decimals ? b.slice(-decimals) : b.padStart(decimals, '0');
        frac = frac.replace(/0+$/, '');

        return frac ? `${intPart}.${frac}` : intPart;
    };

    const abortControllerRef = useRef<AbortController | null>(null);
    const isMountedRef = useRef(true);
    const targetNetwork = selectedNetwork || DEFAULT_NETWORK;
    const networkAddresses = targetNetwork.addresses || ADDRESSES;

    const adapterAddress = useMemo(() => {
        if (!networkAddresses?.SWAP_COLLATERAL_ADAPTER) {
            return null;
        }

        try {
            return getAddress(networkAddresses.SWAP_COLLATERAL_ADAPTER);
        } catch {
            return null;
        }
    }, [networkAddresses?.SWAP_COLLATERAL_ADAPTER]);

    // Use PublicClient for read operations
    const readClient = publicClient;

    const fetchPositionData = useCallback(async () => {
        if (!account || !readClient || !fromToken) {
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setIsPositionLoading(true);

        try {
            if (signal.aborted) {
                return;
            }

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
                        aTokenAddr = await readClient.readContract({
                            address: getAddress(networkAddresses.DATA_PROVIDER),
                            abi: parseAbi(ABIS.DATA_PROVIDER),
                            functionName: 'getReserveTokensAddresses',
                            args: [getAddress(fromToken.underlyingAsset || fromToken.address)],
                        }).then((res: any) => res[0]); // first element is aTokenAddress
                    }

                    const currentAllowance = await readClient.readContract({
                        address: getAddress(aTokenAddr),
                        abi: parseAbi(ABIS.ERC20),
                        functionName: 'allowance',
                        args: [getAddress(account), getAddress(adapterAddress)],
                    });

                    if (signal.aborted || !isMountedRef.current) {
                        return;
                    }

                    setAllowance(currentAllowance as bigint);
                } catch (error: any) {
                    logger.warn('[useCollateralPositions] Allowance check failed:', error.message);
                }

                setIsPositionLoading(false);

                return;
            }

            // Verify chainId via publicClient if needed, but Wagmi usually handles this
            const providerChainId = await readClient.getChainId();
            const expectedChainId = selectedNetwork?.chainId || DEFAULT_NETWORK.chainId;

            if (providerChainId !== expectedChainId) {
                const errorMsg = `provider chain mismatch: expected ${expectedChainId}, got ${providerChainId}`;
                addLog?.(errorMsg, 'error');

                throw new Error(errorMsg);
            }

            let aTokenAddr = fromToken.aTokenAddress;

            if (!isValidATokenAddress(aTokenAddr)) {
                const underlyingAsset = fromToken.underlyingAsset || fromToken.address;
                const tokenAddresses = await readClient.readContract({
                    address: getAddress(networkAddresses.DATA_PROVIDER),
                    abi: parseAbi(ABIS.DATA_PROVIDER),
                    functionName: 'getReserveTokensAddresses',
                    args: [getAddress(underlyingAsset)],
                }) as any;
                aTokenAddr = tokenAddresses[0] || tokenAddresses.aTokenAddress;
            }

            if (!isValidATokenAddress(aTokenAddr)) {
                throw new Error(`No aToken address found for ${fromToken.symbol}`);
            }

            const balance = await retryContractCall(
                () => readClient.readContract({
                    address: getAddress(aTokenAddr),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'balanceOf',
                    args: [getAddress(account)],
                }),
                `${fromToken.symbol} aToken balance`,
                { maxAttempts: 5, initialDelay: 800 }
            );

            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setSupplyBalance(balance as bigint);
            const formatted = formatUnitsFixed(balance as bigint, fromToken.decimals);
            setFormattedSupply(formatted);

            addLog?.(`[Collateral] ${fromToken.symbol} balance: ${formatted}`, 'success');

            if (!adapterAddress) {
                setAllowance(BigInt(0));
                setIsPositionLoading(false);

                return;
            }

            const currentAllowance = await retryContractCall(
                () => readClient.readContract({
                    address: getAddress(aTokenAddr),
                    abi: parseAbi(ABIS.ERC20),
                    functionName: 'allowance',
                    args: [getAddress(account), getAddress(adapterAddress)],
                }),
                `${fromToken.symbol} aToken allowance`,
                { maxAttempts: 3, initialDelay: 500 }
            );

            if (signal.aborted || !isMountedRef.current) {
                return;
            }

            setAllowance(currentAllowance as bigint);

        } catch (error: any) {
            if (error.name !== 'AbortError' && !signal.aborted) {
                logger.error('[fetchPositionData]', error);
            }
        } finally {
            if (!signal.aborted && isMountedRef.current) {
                setIsPositionLoading(false);
            }
        }
    }, [account, readClient, fromToken, addLog, networkAddresses, adapterAddress, selectedNetwork]);

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;

            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    useEffect(() => {
        setAllowance(BigInt(0));
        setSupplyBalance(null);
        setFormattedSupply('0');
    }, [fromToken?.symbol, fromToken?.address]);

    useEffect(() => {
        if (account && readClient && fromToken) {
            const timer = setTimeout(() => fetchPositionData(), 500);

            return () => clearTimeout(timer);
        }
    }, [account, readClient, fromToken, fetchPositionData]);

    return {
        supplyBalance,
        formattedSupply,
        allowance,
        fetchPositionData,
        isPositionLoading,
    };
};
